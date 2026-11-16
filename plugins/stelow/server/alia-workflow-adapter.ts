import { ExecutionAdapter, assertCapabilities } from "../lib/execution-adapter.mjs";
import { ALIA_NATIVE_CAPABILITIES } from "../lib/alia-workflow-capabilities.mjs";

export interface AliaWorkflowTool {
  run(input: { recipe: unknown; context: unknown }): Promise<unknown>;
  status(handle: unknown): Promise<unknown>;
  resume(handle: unknown, input?: unknown): Promise<unknown>;
  cancel(handle: unknown): Promise<unknown>;
  result(handle: unknown): Promise<unknown>;
}

export interface AliaWorkflowCapabilities {
  adapter: "alia-workflows";
  capabilities: Record<string, boolean>;
}

/**
 * VesnALIA's native workflow binding. The host injects the tool because the
 * Workflows plugin is optional; this module contains no import-time dependency
 * on its plugin ID or SDK and remains safe to load when Workflows is absent.
 */
function createAliaWorkflowAdapterFromTool(tool: AliaWorkflowTool): ExecutionAdapter {
  const report: AliaWorkflowCapabilities = {
    adapter: "alia-workflows",
    capabilities: { ...ALIA_NATIVE_CAPABILITIES },
  };
  return new ExecutionAdapter({
    name: report.adapter,
    capabilities: () => report,
    run: (recipe, context) => {
      if (recipe.write_policy === "workspace") throw new Error("workspace-writing recipes require host file claims or sequential coordination");
      if (recipe.id === "scope-batch") throw new Error("scope-batch requires prepared file claims and a parent merge; native fan-out is disabled");
      assertCapabilities(recipe.required_capabilities ?? [], report);
      return tool.run({ recipe, context });
    },
    status: (handle) => tool.status(handle),
    resume: (handle, input) => tool.resume(handle, input),
    cancel: (handle) => tool.cancel(handle),
    result: (handle) => tool.result(handle),
  });
}

/** Capability detection is deliberately an injected query, not a plugin scan. */
export function createAliaWorkflowAdapter(tool: AliaWorkflowTool | null): ExecutionAdapter | null {
  if (!tool) return null;
  return createAliaWorkflowAdapterFromTool(tool);
}
