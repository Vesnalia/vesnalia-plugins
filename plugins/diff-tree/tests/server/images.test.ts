// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin from "../../src/server/index";

it("routes image reads through the environment's enrolled host and confined workspace", async () => {
  let handlers!: Record<string, (input: any) => Promise<any>>;
  const disposed: (() => void)[] = [];
  const call = vi.fn(async (_method: string, _input: unknown, _options: { hostId: string; signal: AbortSignal }) => ({ kind: "missing" }));
  const environment = vi.fn(async () => ({ path: "/remote/project", hostId: "remote-host", isGitRepo: true }));
  plugin({ settings: { define: vi.fn() }, onDispose: (dispose: () => void) => disposed.push(dispose), hosts: { experimental_client: () => ({ call }) }, sdk: { environments: { get: environment } }, rpc: { register: (_contract: unknown, methods: typeof handlers) => { handlers = methods; } } } as unknown as BbPluginApi);
  await handlers.imageFile({ environmentId: "selected-environment", path: "image.png" });
  expect(environment).toHaveBeenCalledWith({ environmentId: "selected-environment", signal: expect.any(AbortSignal) });
  expect(call).toHaveBeenCalledWith("imageFile", { workspace: "/remote/project", path: "image.png" }, { hostId: "remote-host", signal: expect.any(AbortSignal) });
  const target = { type: "range", from: "a".repeat(40), to: "b".repeat(40) };
  await handlers.imageDiff({ environmentId: "selected-environment", path: "image.png", previousPath: "old.png", target });
  expect(call).toHaveBeenLastCalledWith("imageDiff", { workspace: "/remote/project", path: "image.png", previousPath: "old.png", target }, { hostId: "remote-host", signal: expect.any(AbortSignal) });
  disposed.forEach(dispose => dispose());
  expect(call.mock.calls[0][2].signal.aborted).toBe(true);
});
