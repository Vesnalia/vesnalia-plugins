/**
 * Minimal Markdown ⇄ Jira wiki markup for Data Center REST v2.
 * Descriptions and comments are plain strings (wiki), not ADF.
 */

function escapeWiki(text: string): string {
  return text.replace(/([*_\[\]{}|\\])/g, "\\$1");
}

/** Convert a small Markdown subset to Jira wiki markup. */
export function markdownToWiki(markdown: string): string {
  const source = markdown.replace(/\r\n/g, "\n").trim();
  if (source.length === 0) return "";

  const lines = source.split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLang = "";

  for (const line of lines) {
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inCode) {
        out.push("{code}");
        inCode = false;
        codeLang = "";
      } else {
        codeLang = fence[1] ?? "";
        out.push(codeLang.length > 0 ? `{code:${codeLang}}` : "{code}");
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1]!.length, 6);
      out.push(`h${level}. ${inlineMarkdownToWiki(heading[2]!)}`);
      continue;
    }

    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) {
      const depth = Math.floor(bullet[1]!.length / 2) + 1;
      out.push(`${"*".repeat(depth)} ${inlineMarkdownToWiki(bullet[2]!)}`);
      continue;
    }

    const numbered = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (numbered) {
      const depth = Math.floor(numbered[1]!.length / 2) + 1;
      out.push(`${"#".repeat(depth)} ${inlineMarkdownToWiki(numbered[2]!)}`);
      continue;
    }

    if (line.trim() === "") {
      out.push("");
      continue;
    }

    out.push(inlineMarkdownToWiki(line));
  }

  if (inCode) out.push("{code}");
  return out.join("\n");
}

function inlineMarkdownToWiki(text: string): string {
  let result = text;
  result = result.replace(/`([^`]+)`/g, (_, code: string) => `{{${code}}}`);
  // Protect bold so the italic pass does not rewrite *bold*.
  const bold: string[] = [];
  result = result.replace(/\*\*([^*]+)\*\*/g, (_, inner: string) => {
    bold.push(`*${escapeWiki(inner)}*`);
    return `\0BOLD${bold.length - 1}\0`;
  });
  result = result.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, (_, pre: string, inner: string) =>
    `${pre}_${escapeWiki(inner)}_`,
  );
  result = result.replace(/\0BOLD(\d+)\0/g, (_, index: string) => bold[Number(index)] ?? "");
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) =>
    `[${label}|${url}]`,
  );
  return result;
}

/** Convert Jira wiki markup (or plain text) to Markdown. */
export function wikiToMarkdown(value: unknown): string {
  if (typeof value !== "string") return "";
  const source = value.replace(/\r\n/g, "\n").trim();
  if (source.length === 0) return "";

  const lines = source.split("\n");
  const out: string[] = [];
  let inCode = false;

  for (const line of lines) {
    if (/^\{code(?::[^}]*)?\}$/i.test(line.trim())) {
      out.push("```");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }

    const heading = line.match(/^h([1-6])\.\s+(.*)$/i);
    if (heading) {
      out.push(`${"#".repeat(Number(heading[1]))} ${inlineWikiToMarkdown(heading[2]!)}`);
      continue;
    }

    const bullet = line.match(/^(\*+)\s+(.*)$/);
    if (bullet) {
      out.push(`${"  ".repeat(bullet[1]!.length - 1)}- ${inlineWikiToMarkdown(bullet[2]!)}`);
      continue;
    }

    const numbered = line.match(/^(#+)\s+(.*)$/);
    if (numbered && !/^h[1-6]\./i.test(line)) {
      out.push(
        `${"  ".repeat(numbered[1]!.length - 1)}1. ${inlineWikiToMarkdown(numbered[2]!)}`,
      );
      continue;
    }

    out.push(inlineWikiToMarkdown(line));
  }

  if (inCode) out.push("```");
  return out.join("\n").trim();
}

function inlineWikiToMarkdown(text: string): string {
  let result = text;
  result = result.replace(/\{\{([^}]+)\}\}/g, "`$1`");
  result = result.replace(/\*([^*]+)\*/g, "**$1**");
  result = result.replace(/_([^_]+)_/g, "*$1*");
  result = result.replace(/\[([^|\]]+)\|([^\]]+)\]/g, "[$1]($2)");
  return result;
}
