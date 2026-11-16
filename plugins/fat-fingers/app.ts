// alia-plugin-fat-fingers — frontend entry.
//
// The whole plugin is one stylesheet (app.css) that enlarges VesnALIA's icons on a
// phone. The content script below exists to switch it on and off cleanly:
//
//   - VesnALIA keeps an imported app.css active only while a plugin has something
//     mounted, and a content-script generation counts. With no slot to render,
//     this script is what keeps the stylesheet alive.
//   - Every rule in app.css is scoped to `html[data-fat-fingers]`. The script
//     sets that attribute on mount and removes it on dispose, so disabling or
//     reloading the plugin drops the scaling immediately, and devtools shows at
//     a glance whether it is active.
//
// Which screens count as a phone is decided in CSS, with the same media query
// VesnALIA itself uses for its coarse-pointer sizing, so the scaling follows VesnALIA's
// own idea of mobile rather than a second one.
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import "./app.css";

export const ACTIVE_ATTRIBUTE = "data-fat-fingers";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "scale-icons",
    mount({ signal }) {
      const root = document.documentElement;
      root.setAttribute(ACTIVE_ATTRIBUTE, "");

      // Idempotent: the host may call the disposer after the abort listener
      // already ran, and a second removal is a no-op.
      const clear = () => {
        root.removeAttribute(ACTIVE_ATTRIBUTE);
      };
      signal.addEventListener("abort", clear, { once: true });
      return clear;
    },
  });
});
