// alia-plugin-clickable-local-link - backend entry.
//
// POST /api/v1/plugins/clickable-local-link/http/open  { path, reveal? }
// Opens a local document in its default Mac app, or a folder in Finder.
// Anything that could run code (scripts, apps, unknown file types) is never
// opened: it is only revealed (selected) in Finder.
import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

/** Extensions that open in their app on click. Everything else is revealed. */
export const OPEN_EXTENSIONS = new Set([
  "doc", "docx", "rtf", "odt", "pages",
  "xls", "xlsx", "csv", "ods", "numbers",
  "ppt", "pptx", "odp", "key",
  "pdf",
  "png", "jpg", "jpeg", "gif", "heic", "heif", "webp", "tif", "tiff", "bmp",
  "mp3", "m4a", "wav", "mp4", "mov", "webm",
  "zip",
]);

const requestSchema = z
  .object({
    path: z.string().min(2).max(4096),
    reveal: z.boolean().optional(),
  })
  .strict();

type Action = "open" | "reveal";

function extensionOf(target: string): string {
  const base = path.basename(target);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

/** Directory extensions macOS treats as programs, installers or plug-ins. */
const EXECUTABLE_BUNDLES = new Set([
  "app", "bundle", "framework", "plugin", "kext", "pkg", "mpkg", "prefpane",
  "saver", "workflow", "action", "appex", "xpc", "systemextension", "qlgenerator",
  "mdimporter", "service", "wdgt", "osax", "component", "vst", "vst3", "au",
]);

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide on the REAL path: a symlink named "report.pdf" that points to a
 * script or an app must not be opened, because `open` follows the link.
 */
export async function decide(target: string, reveal: boolean): Promise<{ action: Action; path: string }> {
  const real = await realpath(target);
  if (reveal) return { action: "reveal", path: real };
  const info = await stat(real);
  const ext = extensionOf(real);
  if (info.isDirectory()) {
    // Plain folders (also "Q3.2026") open in Finder. Anything that looks like
    // an app or installer bundle is only revealed.
    const looksExecutable =
      EXECUTABLE_BUNDLES.has(ext) ||
      (await exists(path.join(real, "Contents", "Info.plist"))) ||
      (await exists(path.join(real, "Contents", "MacOS")));
    return { action: looksExecutable ? "reveal" : "open", path: real };
  }
  return { action: OPEN_EXTENSIONS.has(ext) ? "open" : "reveal", path: real };
}

function runOpen(target: string, action: Action): Promise<void> {
  const args = action === "reveal" ? ["-R", target] : [target];
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/open", args, { timeout: 10_000 }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

export default async function plugin(alia: AliaPluginApi) {
  alia.settings.define({
    language: {
      type: "select",
      label: "Language / Язык",
      description: "Language of error messages. System follows your computer's language; anything other than Russian shows English.",
      options: ["System", "English", "Русский"],
      default: "System",
    },
  });

  alia.http.route("POST", "/open", async (c) => {
    if (process.platform !== "darwin") {
      return c.json({ ok: false, error: "Only macOS is supported" }, 501);
    }
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: "Bad request" }, 400);
    }
    const target = path.normalize(parsed.data.path);
    if (!path.isAbsolute(target) || target.includes("\0")) {
      return c.json({ ok: false, error: "Path must be absolute" }, 400);
    }
    let decision: { action: Action; path: string };
    try {
      decision = await decide(target, parsed.data.reveal === true);
    } catch {
      return c.json({ ok: false, error: "Not found", path: target }, 404);
    }
    const { action } = decision;
    try {
      await runOpen(decision.path, action);
    } catch (error) {
      alia.log.warn(`open failed for ${target}: ${String(error)}`);
      return c.json({ ok: false, error: "Could not open", path: target }, 500);
    }
    return c.json({ ok: true, action, path: target });
  });

  alia.log.info("loaded");
  alia.onDispose(() => alia.log.info("disposed"));
}
