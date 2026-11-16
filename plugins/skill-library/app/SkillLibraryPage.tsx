import { useState } from "react";
import type { PluginNavPanelProps } from "@vesnalia/plugin-sdk/app";
import { useAliaNavigate, useRpc } from "@vesnalia/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { CreateSkillDialog } from "./CreateSkillDialog";
import { RegistryPanel } from "./RegistryPanel";
import {
  LoadingBox,
  SkillEditor,
  SkillListItems,
  useSkills,
} from "./SkillEditor";
import type { Skill } from "./types";
import type { rpcContract } from "../server";

export function SkillLibraryPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { skills, error, refetch } = useSkills(rpc);
  const navigate = useAliaNavigate();
  const [tab, setTab] = useState<"library" | "registry">("library");
  const [filter, setFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedId = (() => {
    const first = subPath.split("/")[0] ?? "";
    return first === "" ? null : decodeURIComponent(first);
  })();
  const selected = (skills ?? []).find((skill) => skill.id === selectedId) ?? null;

  const selectSkill = (skill: Skill) => {
    setNotice(null);
    navigate.toPluginPanel("library", { subPath: skill.id });
  };

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2500);
  };

  return (
    <div className="h-full min-h-0 flex-1 overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-4 pb-4 pt-3 md:px-5 md:pt-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {(["library", "registry"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={cn(
                  "rounded px-3 py-1 text-sm capitalize",
                  tab === value
                    ? "bg-accent font-medium"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <p className="ml-auto text-xs text-muted-foreground">
            {skills === null ? "" : `${skills.length} skills discovered`}
          </p>
        </div>
        {error === null ? null : (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {notice === null ? null : (
          <p className="mb-2 text-sm text-muted-foreground">{notice}</p>
        )}
        {tab === "registry" ? (
          <RegistryPanel onInstalled={refetch} />
        ) : (
          <div className="flex min-h-0 flex-1 gap-4">
            <div className="hidden w-64 shrink-0 md:block">
              <SkillListItems
                skills={skills}
                selectedId={selectedId}
                onSelect={selectSkill}
                filter={filter}
                onFilter={setFilter}
                showNewButton
                onNew={() => setCreateOpen(true)}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {selected === null ? (
                <LoadingBox>
                  Select a skill from the list to view or edit it, or create a
                  new one.
                </LoadingBox>
              ) : (
                <SkillEditor
                  key={selected.id}
                  rpc={rpc}
                  skill={selected}
                  onDeleted={() => {
                    navigate.toPluginPanel("library", { subPath: "" });
                    refetch();
                  }}
                  onCopied={flash}
                />
              )}
            </div>
          </div>
        )}
      </div>
      <CreateSkillDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async ({ name, description }) => {
          await rpc.call("createSkill", { name, description });
          refetch();
          flash(`Created skill "${name}".`);
        }}
      />
    </div>
  );
}

export default SkillLibraryPage;
