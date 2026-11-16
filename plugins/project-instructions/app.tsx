import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useAliaContext,
  useRealtime,
  useRpc,
} from "@vesnalia/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface ProjectRow {
  id: string;
  name: string;
  instructions: string;
}

function ProjectInstructionsSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const { projectId } = useAliaContext();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Every edited project keeps its own draft, so switching away and back does
  // not throw away typing that was never saved.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [maxLength, setMaxLength] = useState(4096);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    const result = await rpc.call("listProjects");
    setProjects(result.projects);
    setMaxLength(result.maxLength);
    setSelectedId((current) => current ?? projectId ?? result.projects[0]?.id ?? null);
    setIsLoading(false);
  }, [rpc, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime("changed", () => {
    void load();
  });

  const selected = projects.find((project) => project.id === selectedId);
  const saved = selected?.instructions ?? "";
  const draft = selectedId !== null && selectedId in drafts ? drafts[selectedId] : saved;
  const isDirty = selected !== undefined && draft.trim() !== saved;
  const isTooLong = draft.trim().length > maxLength;

  function edit(text: string) {
    if (!selectedId) return;
    setDrafts((current) => ({ ...current, [selectedId]: text }));
  }

  function discard() {
    if (!selectedId) return;
    setDrafts(({ [selectedId]: _dropped, ...rest }) => rest);
  }

  async function save() {
    if (!selectedId || isTooLong) return;
    setIsSaving(true);
    try {
      await rpc.call("save", { projectId: selectedId, text: draft });
      setProjects((rows) =>
        rows.map((row) =>
          row.id === selectedId ? { ...row, instructions: draft.trim() } : row,
        ),
      );
      discard();
      toast.success(draft.trim() ? "Instructions saved" : "Instructions cleared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading projects...</p>;
  }

  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground">No projects yet.</p>;
  }

  const unsavedElsewhere = Object.keys(drafts).filter((id) => id !== selectedId).length;

  return (
    <div className="space-y-3">
      <Select value={selectedId ?? undefined} onValueChange={setSelectedId}>
        <SelectTrigger className="w-full sm:w-72">
          <SelectValue placeholder="Choose a project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
              {project.instructions ? " ·" : ""}
              {project.id in drafts ? " (unsaved)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Textarea
        value={draft}
        onChange={(event) => edit(event.target.value)}
        rows={12}
        spellCheck={false}
        placeholder="Instructions added to every thread in this project. Leave empty to remove."
        className="font-mono text-xs leading-relaxed"
      />

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!isDirty || isSaving || isTooLong}
        >
          {isSaving ? "Saving..." : "Save"}
        </Button>
        {isDirty ? (
          <Button size="sm" variant="ghost" onClick={discard} disabled={isSaving}>
            Discard
          </Button>
        ) : null}
        <span
          className={
            isTooLong ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {draft.trim().length} / {maxLength}
          {isTooLong ? " (too long to save)" : ""}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Applies when a thread next starts a provider session. Side chats never
        receive plugin instructions.
        {unsavedElsewhere > 0
          ? ` Unsaved changes in ${unsavedElsewhere} other project${unsavedElsewhere === 1 ? "" : "s"}.`
          : ""}
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "project-instructions",
    title: "Project instructions",
    description:
      "Text added to the system prompt of every thread in the chosen project. Stored in VesnALIA, never in the repository.",
    component: ProjectInstructionsSettings,
  });
});
