import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { ArtifactDirective } from "@/components/ArtifactDirective";
import { ArtifactsPage } from "@/components/ArtifactsPage";

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "artifacts", title: "Artifacts", icon: "artifacts/sparkles", path: "artifacts", component: ArtifactsPage });
  app.slots.messageDirective({ id: "artifact", component: ArtifactDirective });
});
