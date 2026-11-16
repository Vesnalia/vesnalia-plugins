import { execFile } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { experimental_defineHostEntry } from "@vesnalia/plugin-sdk";
import { hostContract } from "./contract";
import { createLocalBridge } from "./local-bridge";
import {
  captureTimeoutMs,
  permissionTimeoutMs,
  resourceTtlMs,
  maxPngBytes,
} from "./limits";

const execFileAsync = promisify(execFile);
const pending = new Map<string, () => Promise<void>>();
let capturing = false;
let bridge: Awaited<ReturnType<typeof createLocalBridge>> | null = null;
let bridgeCleanup: (() => Promise<void>) | null = null;
let bridgeStart: Promise<void> | null = null;
let bridgeTimer: ReturnType<typeof setTimeout> | null = null;

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    localBridge: async (_input, context) => {
      if (process.platform !== "darwin") return null;
      if (!bridge && !bridgeStart) {
        bridgeStart = (async () => {
          const candidate = await createLocalBridge();
          let lease;
          try {
            lease = context.experimental_retainWorker();
          } catch (error) {
            await candidate.close();
            throw error;
          }
          bridge = candidate;
          bridgeCleanup = async () => {
            if (bridge !== candidate) return;
            if (bridgeTimer) clearTimeout(bridgeTimer);
            bridge = null;
            bridgeCleanup = null;
            bridgeTimer = null;
            try {
              await candidate.close();
            } finally {
              await lease.dispose();
            }
          };
        })().finally(() => {
          bridgeStart = null;
        });
      }
      await bridgeStart;
      if (!bridge) throw new Error("Could not connect to this Mac.");
      if (bridgeTimer) clearTimeout(bridgeTimer);
      bridgeTimer = setTimeout(() => {
        void bridgeCleanup?.().catch(() => {});
      }, resourceTtlMs);
      return {
        port: bridge.port,
        token: bridge.token,
        identity: bridge.identity,
      };
    },
    capture: async ({ captureId }, context) => {
      if (process.platform !== "darwin")
        throw new Error("Choose a Mac for native screenshots.");
      if (capturing)
        throw new Error(
          "A screenshot is already in progress on this Mac. Finish it or press Escape.",
        );
      capturing = true;
      const directory = join(context.experimental_paths.tempDir, captureId);
      const path = join(directory, "screenshot.png");
      let retained = false;
      try {
        const permission = await execFileAsync(
          "/usr/bin/osascript",
          [
            "-l",
            "JavaScript",
            "-e",
            'ObjC.import("CoreGraphics"); ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []]); ObjC.bindFunction("CGRequestScreenCaptureAccess", ["bool", []]); $.CGPreflightScreenCaptureAccess() || $.CGRequestScreenCaptureAccess()',
          ],
          { signal: context.signal, timeout: permissionTimeoutMs },
        );
        if (permission.stdout.trim() !== "true") {
          throw new Error(
            "macOS has not granted screen recording access to the VesnALIA host process. Enable it in System Settings → Privacy & Security → Screen & System Audio Recording, then restart that process and retry.",
          );
        }
        await mkdir(directory, { mode: 0o700 });
        try {
          await execFileAsync(
            "/usr/sbin/screencapture",
            ["-i", "-s", "-x", "-t", "png", path],
            { signal: context.signal, timeout: captureTimeoutMs },
          );
        } catch (error) {
          context.signal.throwIfAborted();
          const failure = error as {
            code?: number;
            stderr?: string;
            killed?: boolean;
            message?: string;
          };
          if (failure.killed)
            throw new Error(
              "Screenshot selection timed out. Click the camera to try again.",
            );
          if (failure.code === 1 && !failure.stderr?.trim())
            return { status: "cancelled" as const };
          const detail = (
            failure.stderr?.trim() ||
            failure.message ||
            "Unknown capture error"
          ).slice(0, 500);
          throw new Error(
            `macOS could not save the selected screenshot: ${detail}`,
          );
        }
        const file = await stat(path).catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (!file?.size) return { status: "cancelled" as const };
        if (file.size > maxPngBytes)
          throw new Error("Screenshot exceeds 10 MB. Select a smaller area.");
        const lease = context.experimental_retainWorker();
        const cleanup = async () => {
          clearTimeout(timer);
          try {
            await rm(directory, { recursive: true, force: true });
          } catch (error) {
            timer = setTimeout(() => {
              void cleanup().catch(() => {});
            }, resourceTtlMs);
            throw error;
          }
          pending.delete(captureId);
          await lease.dispose();
        };
        let timer = setTimeout(() => {
          void cleanup().catch(() => {});
        }, resourceTtlMs);
        pending.set(captureId, cleanup);
        retained = true;
        return { status: "captured" as const, path, sizeBytes: file.size };
      } finally {
        try {
          if (!retained) await rm(directory, { recursive: true, force: true });
        } finally {
          capturing = false;
        }
      }
    },
    release: async ({ captureId }) => {
      await pending.get(captureId)?.();
      return null;
    },
  },
  dispose: async () => {
    await bridgeStart?.catch(() => {});
    const results = await Promise.allSettled([
      bridgeCleanup?.(),
      ...[...pending.values()].map((cleanup) => cleanup()),
    ]);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length)
      throw new AggregateError(
        errors,
        "Could not clean up screenshot resources",
      );
  },
});
