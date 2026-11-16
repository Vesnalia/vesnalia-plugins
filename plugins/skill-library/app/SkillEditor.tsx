import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Markdown, useRealtime } from "@vesnalia/plugin-sdk/app";
import type { PluginRpcClient } from "@vesnalia/plugin-sdk/app";
import type { rpcContract } from "../server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Skill } from "./types";

export type SkillsRpc = PluginRpcClient<typeof rpcContract>;

export function useSkills(rpc: SkillsRpc) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc
      .call("listSkills", {})
      .then((result) => {
        setSkills(result.skills);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("skills-changed", refetch);
  return { skills, error, refetch };
}

export function LoadingBox({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

export function scopeLabel(scope: string): string {
  switch (scope) {
    case "provider-user":
      return "Provider user";
    case "provider-project":
      return "Provider project";
    case "alia-user":
      return "My skills";
    case "alia-project":
      return "Project skills";
    case "alia-builtin":
      return "Built-in";
    case "shared-user":
      return "Shared user";
    case "shared-project":
      return "Shared project";
    case "plugin":
      return "Plugin";
    default:
      return scope;
  }
}

export function SkillListItems({
  skills,
  selectedId,
  onSelect,
  filter,
  onFilter,
  showNewButton,
  onNew,
}: {
  skills: Skill[] | null;
  selectedId: string | null;
  onSelect: (skill: Skill) => void;
  filter: string;
  onFilter: (value: string) => void;
  showNewButton?: boolean;
  onNew?: () => void;
}) {
  const needle = filter.trim().toLowerCase();
  const filtered = (skills ?? []).filter(
    (skill) =>
      needle === "" ||
      skill.name.toLowerCase().includes(needle) ||
      (skill.description ?? "").toLowerCase().includes(needle),
  );
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          value={filter}
          onChange={(event) => onFilter(event.target.value)}
          placeholder="Filter skills…"
          aria-label="Filter skills"
          className="h-8 w-full rounded-md border border-border bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
        />
        {showNewButton ? (
          <Button size="sm" className="shrink-0" onClick={onNew}>
            <Icon name="Plus" className="size-4" />
            New
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {skills === null ? (
          <LoadingBox>Loading skills…</LoadingBox>
        ) : filtered.length === 0 ? (
          <LoadingBox>
            {needle === "" ? "No skills discovered." : "No matches."}
          </LoadingBox>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((skill) => (
              <li key={skill.id}>
                <button
                  type="button"
                  onClick={() => onSelect(skill)}
                  className={cn(
                    "w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent",
                    selectedId === skill.id && "bg-accent",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {skill.name}
                    </span>
                    {!skill.manageable ? (
                      <Icon
                        name="Lock"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {scopeLabel(skill.scope)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type ContentState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      content: string;
      revision: string;
      files: string[];
      truncated: boolean;
    };

export function SkillEditor({
  rpc,
  skill,
  onDeleted,
  onCopied,
}: {
  rpc: SkillsRpc;
  skill: Skill;
  onDeleted: () => void;
  onCopied: (message: string) => void;
}) {
  const [state, setState] = useState<ContentState>({ kind: "loading" });
  const [draft, setDraft] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [saveState, setSaveState] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    setState({ kind: "loading" });
    setDraft(null);
    setSaveState({ kind: "idle" });
    Promise.all([
      rpc.call("getSkillContent", { skillId: skill.id }),
      rpc.call("listSkillFiles", { skillId: skill.id }),
    ]).then(
      ([content, files]) => {
        if (id !== requestId.current) return;
        setState({
          kind: "ready",
          content: content.content,
          revision: content.revision,
          files: files.files,
          truncated: files.truncated,
        });
      },
      (cause: unknown) => {
        if (id !== requestId.current) return;
        setState({
          kind: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      },
    );
  }, [rpc, skill.id]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty =
    state.kind === "ready" && draft !== null && draft !== state.content;
  const editable = skill.manageable;

  const save = useCallback(() => {
    if (state.kind !== "ready" || !editable || draft === null || dirty === false)
      return;
    setSaveState({ kind: "saving" });
    rpc
      .call("saveSkill", {
        skillId: skill.id,
        content: draft,
        revision: state.revision,
      })
      .then(
        (result) => {
          setState({
            kind: "ready",
            content: draft,
            revision: result.revision,
            files: state.files,
            truncated: state.truncated,
          });
          setDraft(null);
          setSaveState({ kind: "saved" });
          window.setTimeout(() => setSaveState({ kind: "idle" }), 2500);
        },
        (cause: unknown) => {
          setSaveState({
            kind: "error",
            message:
              cause instanceof Error ? cause.message : String(cause),
          });
        },
      );
  }, [state, draft, dirty, editable, rpc, skill.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const confirmDelete = useCallback(() => {
    if (
      !window.confirm(
        `Delete skill "${skill.name}"? Its files are removed from disk.`,
      )
    )
      return;
    rpc.call("deleteSkill", { skillId: skill.id }).then(
      () => onDeleted(),
      (cause: unknown) =>
        setSaveState({
          kind: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    );
  }, [rpc, skill.id, skill.name, onDeleted]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            {skill.name}
            {!editable ? (
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                Read-only
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {skill.filePath}
          </p>
        </div>
        {editable ? (
          <Button size="sm" onClick={save} disabled={!dirty || saveState.kind === "saving"}>
            <Icon name="Save" className="size-4" />
            Save
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            navigator.clipboard
              .writeText(skill.filePath)
              .then(() => onCopied("Path copied."))
              .catch(() => onCopied("Could not copy path."));
          }}
        >
          <Icon name="Copy" className="size-4" />
          Copy path
        </Button>
        {editable ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={confirmDelete}
          >
            <Icon name="Trash2" className="size-4" />
            Delete
          </Button>
        ) : null}
      </div>
      {saveState.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {saveState.message}
        </p>
      ) : null}
      {state.kind === "loading" ? <LoadingBox>Loading SKILL.md…</LoadingBox> : null}
      {state.kind === "error" ? <LoadingBox>{state.message}</LoadingBox> : null}
      {state.kind === "ready" ? (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <button
              type="button"
              className={cn("rounded px-1.5 py-0.5 hover:bg-accent", !preview && "bg-accent")}
              onClick={() => setPreview(false)}
            >
              Edit
            </button>
            <button
              type="button"
              className={cn("rounded px-1.5 py-0.5 hover:bg-accent", preview && "bg-accent")}
              onClick={() => setPreview(true)}
            >
              Preview
            </button>
            <span>
              {dirty ? "Unsaved changes · " : ""}
              {saveState.kind === "saving"
                ? "Saving…"
                : saveState.kind === "saved"
                  ? "Saved"
                  : ""}
            </span>
            <span className="ml-auto">{state.files.length} file(s)</span>
          </div>
          {preview ? (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border p-4 text-sm">
              <Markdown content={draft ?? state.content} />
            </div>
          ) : (
            <textarea
              value={draft ?? state.content}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              readOnly={!editable}
              aria-label={`Edit ${skill.name} SKILL.md`}
              className="min-h-0 flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-sm leading-relaxed outline-none focus-visible:border-ring"
            />
          )}
          {state.truncated ? (
            <p className="text-xs text-muted-foreground">
              File list truncated; only SKILL.md is editable here.
            </p>
          ) : null}
          {state.files.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {state.files.map((file) => (
                <span
                  key={file}
                  className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  {file}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
