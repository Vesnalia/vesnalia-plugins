import type { PluginDispatchInput } from "@vesnalia/plugin-sdk";
import { detect, type Finding } from "./detect.ts";

// VesnALIA stores uploaded attachments under a relative project path. Absolute paths
// refer to runtime files, which are not available through this API.
export async function scanAttachments(
  blocks: PluginDispatchInput["blocks"],
  read: (path: string) => Promise<Uint8Array>,
): Promise<Finding[]> {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.type !== "localFile" || /^(?:[\\/]|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(block.path) || seen.has(block.path)) continue;
    seen.add(block.path);
    const bytes = await read(block.path);
    // A BOM distinguishes UTF-16 text from binary files with NUL bytes.
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : null;
    if (utf16 === null && bytes.includes(0)) continue;
    let content: string;
    try {
      content = new TextDecoder(utf16 ?? "utf-8", { fatal: true }).decode(bytes);
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;
    const findings = detect(content);
    // One positive file is enough to reject; do not read more private data.
    if (findings.length > 0) return findings;
  }
  return [];
}
