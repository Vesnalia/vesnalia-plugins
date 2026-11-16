import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

// VesnALIA requires a default-exported backend factory, even for frontend-only viewers.
export default function plugin(_alia: AliaPluginApi) {}
