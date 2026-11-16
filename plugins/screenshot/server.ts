import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { hostContract, rpcContract } from "./contract";
import { captureRequestTimeoutMs, maxPngBytes } from "./limits";

export default function screenshotPlugin(alia: AliaPluginApi) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const host = alia.hosts.experimental_client({ contract: hostContract });
  const active = new Map<string, AbortController>();
  const cancelled = new Map<string, ReturnType<typeof setTimeout>>();
  alia.onDispose(() => {
    cancelled.forEach((timer) => clearTimeout(timer));
    cancelled.clear();
    active.forEach((controller) => controller.abort());
  });
  alia.rpc.register(rpcContract, {
    localBridges: async () => {
      const machines = (await alia.sdk.hosts.list()).filter(
        (machine) => machine.status === "connected",
      );
      const results = await Promise.allSettled(
        machines.map(async (machine) => {
          const bridge = await host.call("localBridge", null, {
            hostId: machine.id,
            timeoutMs: 10000,
          });
          return bridge ? { hostId: machine.id, ...bridge } : null;
        }),
      );
      return results.flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : [],
      );
    },
    cancel: async ({ captureId }) => {
      const controller = active.get(captureId);
      if (controller) controller.abort();
      else if (!cancelled.has(captureId)) {
        const timer = setTimeout(
          () => cancelled.delete(captureId),
          captureRequestTimeoutMs,
        );
        timer.unref();
        cancelled.set(captureId, timer);
      }
      return null;
    },
    capture: async ({ captureId, hostId, projectId }, context) => {
      if (cancelled.has(captureId)) {
        clearTimeout(cancelled.get(captureId));
        cancelled.delete(captureId);
        return { status: "cancelled" as const };
      }
      if (active.has(captureId))
        throw new Error("This screenshot is already in progress.");
      const controller = new AbortController();
      const signal = AbortSignal.any([
        controller.signal,
        context.experimental_signal,
      ]);
      active.set(captureId, controller);
      let captured = false;
      try {
        signal.throwIfAborted();
        const image = await host.call(
          "capture",
          { captureId },
          { hostId, signal, timeoutMs: captureRequestTimeoutMs },
        );
        if (image.status === "cancelled") return image;
        captured = true;
        const file = await alia.sdk.files.read({
          hostId,
          path: image.path,
          signal,
        });
        signal.throwIfAborted();
        if (file.contentEncoding !== "base64")
          throw new Error("The Mac returned an invalid screenshot.");
        const bytes = Buffer.from(file.content, "base64");
        if (bytes.length !== image.sizeBytes || bytes.length > maxPngBytes)
          throw new Error(
            "The screenshot transfer was incomplete or exceeded 10 MB. Try again.",
          );
        if (!bytes.subarray(0, pngSignature.length).equals(pngSignature))
          throw new Error(
            "The Mac returned an invalid PNG screenshot. Try again.",
          );
        const name = `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
        const uploaded = await alia.sdk.projects.attachments.upload({
          projectId,
          clientFile: bytes,
          filename: name,
          mimeType: "image/png",
        });
        signal.throwIfAborted();
        return {
          status: "captured" as const,
          path: uploaded.path,
          name,
          sizeBytes: bytes.length,
        };
      } catch (error) {
        if (signal.aborted) return { status: "cancelled" as const };
        throw error;
      } finally {
        active.delete(captureId);
        if (captured) {
          try {
            await host.call(
              "release",
              { captureId },
              { hostId, timeoutMs: 10000 },
            );
          } catch {
            alia.log.warn(
              "Temporary screenshot cleanup will retry on the Mac automatically",
            );
          }
        }
      }
    },
  });
}
