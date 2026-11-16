// alia-plugin-skill-library — Skill Library plugin frontend entry.
//
// Compiled by `alia plugin build` into dist/app.js + dist/app.css. React and
// @vesnalia/plugin-sdk/app are provided by the VesnALIA app at load time (never
// bundled), so this file must be loaded by VesnALIA, not imported directly.
import { useRpc, definePluginApp } from "@vesnalia/plugin-sdk/app";
import { SkillLibraryPage } from "./app/SkillLibraryPage";
import { SkillSidebar } from "./app/SkillSidebar";
import { useSkills } from "./app/SkillEditor";

// The default export must be definePluginApp(...); VesnALIA interprets it after
// loading the bundle. navPanel adds a page to the left sidebar rail, and
// experimental_sidebar replaces the thread list with the skill list while
// this panel's route is active.
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "library",
    title: "Skill Library",
    icon: "BookOpen",
    path: "library",
    component: SkillLibraryPage,
    experimental_sidebar: function SkillLibrarySidebar(props) {
      const rpc = useRpc();
      const { skills } = useSkills(rpc);
      return <SkillSidebar skills={skills} subPath={props.subPath} />;
    },
  });
});
