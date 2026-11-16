// Turns a post into a short-video beat sheet. Deterministic: it reuses the
// post's own sentences, so nothing is invented. Timing assumes ~2.6 spoken
// words per second.
import { extractFeatures, type PostContext } from "./features";
import { RANKING } from "./xalgo";

export interface Beat {
  label: string;
  spoken: string;
  onScreen: string;
  seconds: number;
}

export interface VideoScript {
  totalSeconds: number;
  beats: Beat[];
  notes: string[];
  markdown: string;
}

const WPS = 2.6;
const URL_RE = /\bhttps?:\/\/[^\s)]+|\b[a-z0-9-]+\.(?:com|io|ai|co|org|net|app|dev|ly|me|xyz)\b(?:\/[^\s)]*)?/gi;

function sentences(text: string): string[] {
  const clean = text.replace(URL_RE, "").replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1").replace(/\s+/g, " ").trim();
  return clean.match(/[^.!?]+[.!?]+["')\]]?|[^.!?]+$/g)?.map((s) => s.trim()).filter((s) => s.length > 2) ?? [clean];
}

function secs(text: string, min = 1.5): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(min, Math.round((words / WPS) * 2) / 2);
}

function onScreen(text: string, maxWords = 7): string {
  const words = text.replace(/[.!?]+$/, "").split(/\s+/).filter(Boolean);
  return (words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}…` : words.join(" "));
}

export function videoScript(text: string, ctx?: PostContext): VideoScript {
  const f = extractFeatures(text);
  const parts = sentences(text);
  const hookSource = parts[0] ?? text;
  const hookWords = hookSource.split(/\s+/);
  const hook = hookWords.length > 14 ? `${hookWords.slice(0, 12).join(" ")}…` : hookSource;
  const bodyParts = parts.slice(1);
  const question = bodyParts.find((s) => s.endsWith("?")) ?? (f.questions > 0 ? parts.find((s) => s.endsWith("?")) : undefined);
  const bodyBeats = bodyParts.filter((s) => s !== question).slice(0, 4);
  const cta = question ?? "Reply with the one thing you'd change. I read every one.";

  const beats: Beat[] = [
    { label: "Hook (0-2s)", spoken: hook, onScreen: onScreen(hook), seconds: Math.max(2, secs(hook)) },
    ...bodyBeats.map((s, i) => ({ label: `Beat ${i + 1}`, spoken: s, onScreen: onScreen(s), seconds: secs(s) })),
    { label: "Ask", spoken: cta, onScreen: onScreen(cta, 8), seconds: Math.max(2.5, secs(cta)) },
    { label: "Hold", spoken: "(silence, keep the question on screen)", onScreen: onScreen(cta, 8), seconds: 2 },
  ];
  let total = beats.reduce((a, b) => a + b.seconds, 0);
  const notes: string[] = [];
  const minSecs = RANKING.minVideoDurationMs / 1000;
  if (total < minSecs) {
    const pad = Math.ceil((minSecs - total) * 2) / 2 + 0.5;
    const hold = beats[beats.length - 1]!;
    hold.seconds += pad;
    total += pad;
    notes.push(`Padded the final hold so the video clears ${minSecs}s: only videos over ${minSecs}s count as a video for the quality-view head.`);
  }
  notes.push("Burn the on-screen text in as captions: most feed plays start muted, and the on-screen line is what earns the first 2 seconds of dwell.");
  notes.push("Shoot 9:16 or 1:1 so it fills the feed; keep faces or the key number in the middle 80% for the timeline crop.");
  notes.push("Say the hook before any intro or logo. The scored heads are video-open, dwell, and reply, not completion.");
  if (bodyBeats.length === 0) notes.push("The post has one sentence, so the script has no middle beats. Add one concrete example and re-run.");
  notes.push("Post the video as an original with the text as the caption, and put any link in the first reply.");

  const rows = beats.map((b) => `| ${b.label} | ${b.seconds.toFixed(1)}s | ${b.spoken} | ${b.onScreen} |`);
  const markdown = [
    `Video script (~${Math.round(total)}s)`,
    "",
    "| Beat | Time | Say | On screen |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    ...notes.map((n) => `- ${n}`),
  ].join("\n");
  return { totalSeconds: Math.round(total * 2) / 2, beats, notes, markdown };
}
