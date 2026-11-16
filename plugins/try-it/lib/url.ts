// The person testing is usually on a phone, where these addresses go nowhere.
const LOCAL = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

export function urlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `"${raw}" is not a URL.`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `Only http and https links open on a phone, got ${url.protocol}`;
  if (LOCAL.test(url.hostname)) {
    return `${url.hostname} only works on the server. Publish it first, for example with \`alia connect expose <port>\`, then pass the public URL.`;
  }
  return null;
}

export type CheckResult = "pass" | "fail" | "skip";

export interface TryItAnswer {
  results: { check: string; result: CheckResult }[];
  note: string;
}

export function summarize(answer: TryItAnswer): string {
  const failed = answer.results.filter((r) => r.result === "fail");
  const lines = [failed.length > 0 ? `Tester found ${failed.length} problem(s).` : "Tester found no problems."];
  for (const r of answer.results) lines.push(`- ${r.result.toUpperCase()}: ${r.check}`);
  if (answer.note.trim() !== "") lines.push("", `Tester's note: ${answer.note.trim()}`);
  return lines.join("\n");
}
