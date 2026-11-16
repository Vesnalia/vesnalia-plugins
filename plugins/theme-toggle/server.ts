// alia-plugin-theme-toggle — light/dark plus the VesnALIA palette from one button.
//
// The palette lives on the server (alia.sdk.theme); light/dark is a client-side
// setting (localStorage `alia.theme`), so app.tsx owns that half.
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

// VesnALIA's built-in palettes: the catalog only reports custom and plugin themes.
const BUILT_IN = [
  { id: "default", name: "Default" },
  { id: "nord", name: "Nord" },
  { id: "dracula", name: "Dracula" },
  { id: "solarized", name: "Solarized" },
  { id: "gruvbox", name: "Gruvbox" },
  { id: "catppuccin", name: "Catppuccin" },
];

const themeList = z.object({
  activeId: z.string(),
  themes: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const rpcContract = defineRpcContract({
  state: { input: z.null(), output: themeList },
  select: { input: z.object({ themeId: z.string() }), output: themeList },
});

export default async function plugin(alia: AliaPluginApi) {
  async function read() {
    const catalog = await alia.sdk.theme.catalog();
    const themes = [
      ...BUILT_IN,
      ...catalog.custom.map((id) => ({ id, name: id })),
      // Plugin theme ids are already namespaced (plugin:<pluginId>:<id>).
      ...catalog.plugins.map((t) => ({ id: t.id, name: t.name })),
    ];
    return { activeId: catalog.active.themeId, themes, catalog };
  }

  async function apply(themeId: string) {
    const { catalog } = await read();
    // selection requires faviconColor — carry the current one over unchanged.
    await alia.sdk.theme.set({ themeId, faviconColor: catalog.active.faviconColor });
    const next = await read();
    return { activeId: next.activeId, themes: next.themes };
  }

  alia.rpc.register(rpcContract, {
    async state() {
      const { activeId, themes } = await read();
      return { activeId, themes };
    },
    async select({ themeId }) {
      return apply(themeId);
    },
  });
}
