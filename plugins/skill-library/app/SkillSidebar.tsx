import { useState } from "react";
import { useAliaNavigate } from "@vesnalia/plugin-sdk/app";
import { SkillListItems } from "./SkillEditor";
import type { Skill } from "./types";

export function SkillSidebar({
  skills,
  subPath,
}: {
  skills: Skill[] | null;
  subPath: string;
}) {
  const navigate = useAliaNavigate();
  const [filter, setFilter] = useState("");
  const selectedId = (() => {
    const first = subPath.split("/")[0] ?? "";
    return first === "" ? null : decodeURIComponent(first);
  })();
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-2">
      <SkillListItems
        skills={skills}
        selectedId={selectedId}
        filter={filter}
        onFilter={setFilter}
        onSelect={(skill) => navigate.toPluginPanel("library", { subPath: skill.id })}
      />
    </div>
  );
}
