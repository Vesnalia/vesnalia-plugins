import { readFileSync } from "node:fs";
import { loadPluginApp } from "@vesnalia/plugin-sdk/testing/app";
import { describe, expect, it } from "vitest";

describe("Pokemon Catcher branding", () => {
	it("uses its Pokeball icon for plugin branding and the sidebar panel", async () => {
		const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
		const app = await loadPluginApp(() => import("./app"));

		expect(manifest.alia.branding.icon).toBe("./icons/pokeball.svg");
		expect(readFileSync(new URL(manifest.alia.branding.icon, import.meta.url), "utf8")).toContain("<svg");
		expect(app.icons.map(({ name }) => name)).toContain("PokemonCatcherPokeball");
		expect(app.navPanels[0]?.icon).toBe("PokemonCatcherPokeball");
	});
});
