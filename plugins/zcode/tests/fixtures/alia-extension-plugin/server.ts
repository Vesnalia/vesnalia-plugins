import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
export default function plugin(alia: AliaPluginApi) {
  alia.agents.registerTool({
    name: "ZCodeFixtureEcho",
    description: "fixture.echo: deterministic installed VesnALIA tool",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    presentation: {
      label: { pending: "Echoing", completed: "Echo" },
      icon: { glyph: "Terminal" },
    },
    execute() {
      return "ALIA_INSTALLED_TOOL_RESULT";
    },
  });
  alia.agents.configure(() => ({
    tools: ["ZCodeFixtureEcho"],
    skills: ["fixture-installed-skill"],
  }));
}
