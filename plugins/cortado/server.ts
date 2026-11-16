// alia-plugin-cortado: three themes, declared in package.json under `alia.themes`.
// VesnALIA reads the stylesheet and code theme from the manifest, so the backend
// has nothing to do. VesnALIA still requires a server entry.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default function plugin(_alia: AliaPluginApi) {}
