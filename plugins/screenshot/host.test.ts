import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExperimentalHostEntryHarness,
  experimental_createHostEntryHarness,
} from "@vesnalia/plugin-sdk/testing/host";
import entry from "./host";
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rm: vi.fn(fs.rm) };
});
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", () => {
  const execFile = (...args: unknown[]) => execute(...args);
  Object.defineProperty(execFile, Symbol.for("nodejs.util.promisify.custom"), {
    value: (...args: unknown[]) =>
      new Promise((resolve, reject) =>
        execute(
          ...args,
          (error: Error | null, stdout: string, stderr: string) =>
            error ? reject(error) : resolve({ stdout, stderr }),
        ),
      ),
  });
  return { execFile };
});
const captureId = "82cf39c2-3c52-4fbb-8a28-c3e87d9026cc";
let directory: string;
let harness: ExperimentalHostEntryHarness<typeof entry.contract, {}>;
const platform = process.platform;
beforeEach(async () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  directory = await mkdtemp(join(tmpdir(), "alia-screenshot-test-"));
  harness = experimental_createHostEntryHarness(entry, {
    experimental_paths: { dataDir: directory, tempDir: directory },
  });
  execute.mockReset();
  execute.mockImplementationOnce((_command, _args, _options, callback) =>
    callback(null, "true\n", ""),
  );
});
afterEach(async () => {
  await harness.experimental_dispose();
  await rm(directory, { recursive: true, force: true });
  Object.defineProperty(process, "platform", { value: platform });
});

it("runs the native area selector and keeps the PNG only until transfer finishes", async () => {
  execute.mockImplementation((_command, args, _options, callback) => {
    void writeFile(args.at(-1), "PNG").then(() => callback(null, "", ""));
  });
  const result = await harness.experimental_call("capture", { captureId });
  expect(result.status).toBe("captured");
  expect(execute.mock.calls[1]!.slice(0, 2)).toEqual([
    "/usr/sbin/screencapture",
    [
      "-i",
      "-s",
      "-x",
      "-t",
      "png",
      join(directory, captureId, "screenshot.png"),
    ],
  ]);
  expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);
  if (result.status !== "captured")
    throw new Error("Expected captured screenshot");
  expect(await readFile(result.path, "utf8")).toBe("PNG");
  await harness.experimental_call("release", { captureId });
  await expect(readFile(result.path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
});

it("treats Escape as cancellation and removes temporary files", async () => {
  execute.mockImplementation((_command, _args, _options, callback) =>
    callback(Object.assign(new Error("Cancelled"), { code: 1 }), "", ""),
  );
  expect(await harness.experimental_call("capture", { captureId })).toEqual({
    status: "cancelled",
  });
  expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
  await expect(
    readFile(join(directory, captureId, "screenshot.png")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("preserves the actual capture failure instead of assuming a permission error", async () => {
  execute.mockImplementation((_command, _args, _options, callback) =>
    callback(
      Object.assign(new Error("No display"), {
        code: 1,
        stderr: "could not create image from display",
      }),
      "",
      "could not create image from display",
    ),
  );
  await expect(
    harness.experimental_call("capture", { captureId }),
  ).rejects.toThrow("could not create image from display");
  expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
});

it("rejects non-Mac hosts before invoking a command", async () => {
  Object.defineProperty(process, "platform", { value: "linux" });
  await expect(
    harness.experimental_call("capture", { captureId }),
  ).rejects.toThrow("Choose a Mac");
  expect(execute).not.toHaveBeenCalled();
});

it("checks screen recording permission before opening the crosshair", async () => {
  execute.mockReset();
  execute.mockImplementation((_command, _args, _options, callback) =>
    callback(null, "false\n", ""),
  );
  await expect(
    harness.experimental_call("capture", { captureId }),
  ).rejects.toThrow("has not granted screen recording");
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0][0]).toBe("/usr/bin/osascript");
});

it("retains a failed cleanup so a later release can retry it", async () => {
  execute.mockImplementation((_command, args, _options, callback) => {
    void writeFile(args.at(-1), "PNG").then(() => callback(null, "", ""));
  });
  const result = await harness.experimental_call("capture", { captureId });
  if (result.status !== "captured") throw new Error("Expected screenshot");
  vi.mocked(rm).mockRejectedValueOnce(new Error("File temporarily busy"));
  await expect(
    harness.experimental_call("release", { captureId }),
  ).rejects.toThrow("File temporarily busy");
  expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);
  await harness.experimental_call("release", { captureId });
  expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
  await expect(readFile(result.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("shares one local connection across concurrent discovery requests and disposes it", async () => {
  const [first, second] = await Promise.all([
    harness.experimental_call("localBridge", null),
    harness.experimental_call("localBridge", null),
  ]);
  expect(first).toEqual(second);
  expect(first).not.toBeNull();
  expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);
  await harness.experimental_dispose();
  expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
});
