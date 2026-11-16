// alia-plugin-section-load-more — backend entry.
//
// The plugin is frontend-only; the server declares the two settings the
// sidebar controller reads through useSettings().
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi) {
  alia.settings.define({
    visibleThreads: {
      type: "number",
      label: "Threads shown per section",
      description: "Top-level threads a custom section shows before Load more.",
      default: 10,
    },
    loadMoreStep: {
      type: "number",
      label: "Threads per Load more",
      description: "Threads each Load more click reveals.",
      default: 10,
    },
  });
}
