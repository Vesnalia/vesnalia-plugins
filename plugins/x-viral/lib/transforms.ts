// Candidate edits the autoresearch loop can try. Text transforms rewrite the
// post; context transforms change how it is published (media, original vs
// reply) and are reported as projections rather than applied to the text.
import type { Features, PostContext } from "./features";
import { SOURCES } from "./xalgo";

export interface TransformResult {
  text: string;
  context: Required<PostContext>;
  /** Text to post as the first reply (e.g. the link moved out of the body). */
  replyText?: string;
  note: string;
}

export interface Transform {
  id: string;
  kind: "text" | "context";
  title: string;
  why: string;
  source?: string;
  applies(f: Features, c: Required<PostContext>): boolean;
  apply(text: string, c: Required<PostContext>): TransformResult;
}

const URL_RE = /\bhttps?:\/\/[^\s)]+|\b[a-z0-9-]+\.(?:com|io|ai|co|org|net|app|dev|ly|me|xyz)\b(?:\/[^\s)]*)?/gi;
const BAIT_CLAUSE_RE =
  /\s*(?:\band\s+)?(?:\b(?:like|rt|retweet|repost|share|bookmark)\s+(?:if|this|for|and)\b|\bfollow\s+(?:me|for|back)\b|\bfollow\s*4\s*follow\b|\btag\s+(?:a|someone|your)\b|\bcomment\s+below\b|\bdrop\s+a\s+(?:like|❤️|🔥)|\b(?:rt|retweet)\s+to\b)[^.,!?\n]*[.,!?]?/gi;
const SPAM_CLAUSE_RE =
  /\s*(?:\band\s+)?(?:\blink\s+in\s+bio\b|\bdm\s+me\b|\bclick\s+here\b|\bguaranteed\b|\bfree\s+money\b|\bgiveaway\b|\bairdrop\b|\b100%\s+legit\b|\bmake\s+money\s+fast\b)[^.,!?\n]*[.,!?]?/gi;

/** Runs `edit` with URLs swapped for dot-free placeholders so sentence boundaries never split a URL. */
function withUrlsProtected(text: string, edit: (safe: string) => string): string {
  const urls: string[] = [];
  const safe = text.replace(URL_RE, (url) => {
    urls.push(url);
    return `\u0000URL${urls.length - 1}\u0000`;
  });
  return edit(safe).replace(/\u0000URL(\d+)\u0000/g, (_, i: string) => urls[Number(i)] ?? "");
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sentences(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?]+["')\]]?|[^.!?\n]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

export const TRANSFORMS: Transform[] = [
  {
    id: "move-link-to-reply",
    kind: "text",
    title: "Move the link to the first reply",
    why: "Open-link is weighted 0.2 while reply is 5.0; a link in the body drags down predicted like/reply/dwell. The body should earn the engagement, the reply carries the URL.",
    source: SOURCES.weights,
    applies: (f) => f.hasLink && !f.linkOnly,
    apply(text, context) {
      const urls = text.match(URL_RE) ?? [];
      const body = tidy(text.replace(URL_RE, "").replace(/\(\s*\)/g, ""));
      return {
        text: body,
        context,
        replyText: urls.join("\n"),
        note: `Moved ${urls.length} link(s) out of the body.`,
      };
    },
  },
  {
    id: "strip-hashtags",
    kind: "text",
    title: "Remove the hashtags",
    why: "Retrieval now works on semantic IDs of the post's content, not keywords. Hashtag clusters only add spam-shaped features.",
    source: SOURCES.candidate,
    applies: (f) => f.hashtags >= 2,
    apply(text, context) {
      const trailingStripped = text.replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, "");
      const inlineStripped = trailingStripped.replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, "$1$2");
      return { text: tidy(inlineStripped), context, note: "Removed hashtags." };
    },
  },
  {
    id: "remove-engagement-bait",
    kind: "text",
    title: "Cut the engagement bait",
    why: "'Like if / RT if / follow me' lifts not-interested and report propensity, weighted -43.2 and -234.",
    source: SOURCES.weights,
    applies: (f) => f.engagementBait,
    apply(text, context) {
      return { text: tidy(withUrlsProtected(text, (t) => t.replace(BAIT_CLAUSE_RE, ""))), context, note: "Removed bait phrasing." };
    },
  },
  {
    id: "remove-spam-phrases",
    kind: "text",
    title: "Cut spam phrasing",
    why: "'Link in bio', 'DM me', 'guaranteed' and giveaway language feed the spam classifier that drops non-follower delivery.",
    source: SOURCES.vfRegistry,
    applies: (f) => f.spamMarkers,
    apply(text, context) {
      return { text: tidy(withUrlsProtected(text, (t) => t.replace(SPAM_CLAUSE_RE, ""))), context, note: "Removed spam phrasing." };
    },
  },
  {
    id: "trim-leading-mention",
    kind: "text",
    title: "Drop the leading @mention",
    why: "A post that starts with @user is a reply, and OONRetweetReplyFilter drops replies for everyone who does not follow you.",
    source: SOURCES.oonFilter,
    applies: (f) => f.leadingMention,
    apply(text, context) {
      return {
        text: tidy(text.replace(/^(@[A-Za-z0-9_]{1,15}\s*)+/, "")),
        context: { ...context, isReply: false },
        note: "Removed leading mention so the post is an original.",
      };
    },
  },
  {
    id: "trim-mentions",
    kind: "text",
    title: "Remove the @mention pile",
    why: "Three or more mentions is a spam feature and an explicit scarecrow rule when paired with a link.",
    source: SOURCES.lowQualityUrl,
    applies: (f) => f.mentions >= 3,
    apply(text, context) {
      return { text: tidy(text.replace(/(^|\s)@[A-Za-z0-9_]{1,15}\b/g, "$1")), context, note: "Removed mentions." };
    },
  },
  {
    id: "sentence-case",
    kind: "text",
    title: "Stop shouting",
    why: "All-caps reads as spam/rage and lifts not-interested and mute propensity.",
    applies: (f) => f.capsRatio > 0.5,
    apply(text, context) {
      const lowered = text.replace(/\b[A-Z]{3,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
      return { text: tidy(lowered), context, note: "Converted caps to sentence case." };
    },
  },
  {
    id: "calm-punctuation",
    kind: "text",
    title: "Calm the punctuation",
    why: "Exclamation runs and repeated characters are low-quality features in the duplicate-text and spam rules.",
    source: SOURCES.copypasta,
    applies: (f) => f.repeatedChars || f.exclamations >= 4,
    apply(text, context) {
      const calmed = text.replace(/!{2,}/g, "!").replace(/\?{2,}/g, "?").replace(/([^\d\s])\1{3,}/g, "$1$1");
      return { text: tidy(calmed), context, note: "Reduced punctuation runs." };
    },
  },
  {
    id: "hook-on-its-own-line",
    kind: "text",
    title: "Put the hook on its own line",
    why: "The first line decides the scroll-stop; isolating a short opener lowers predicted not-dwelled and lifts dwell.",
    applies: (f) => f.firstLineChars > 90 && f.chars >= 120,
    apply(text, context) {
      const [first, ...rest] = text.split("\n");
      const parts = sentences(first ?? "");
      if (parts.length < 2) return { text, context, note: "No sentence boundary in the first line." };
      const hook = parts[0] ?? "";
      const remainder = parts.slice(1).join(" ");
      return {
        text: tidy([hook, "", remainder, ...rest].join("\n")),
        context,
        note: "Split the opening sentence onto its own line.",
      };
    },
  },
  {
    id: "add-paragraph-breaks",
    kind: "text",
    title: "Break the wall of text",
    why: "Predicted dwell seconds are a continuous head; long posts earn it only when readers keep going, and paragraph breaks keep them going.",
    applies: (f) => f.chars > 280 && f.paragraphs <= 1,
    apply(text, context) {
      const broken = withUrlsProtected(text.replace(/\n/g, " "), (t) => {
        const parts = sentences(t);
        const paragraphs: string[] = [];
        for (let i = 0; i < parts.length; i += 2) paragraphs.push(parts.slice(i, i + 2).join(" "));
        return paragraphs.join("\n\n");
      });
      return { text: tidy(broken), context, note: "Added paragraph breaks every two sentences." };
    },
  },
  {
    id: "add-reply-prompt",
    kind: "text",
    title: "End with a question for the reader",
    why: "Reply is weighted 5.0, ten times a like. A genuine question roughly doubles predicted reply rate. Rewrite the placeholder in your own voice.",
    source: SOURCES.weights,
    applies: (f) => f.questions === 0 && !f.replyPrompt && f.chars >= 40 && !f.linkOnly,
    apply(text, context) {
      return {
        text: tidy(`${text}\n\nWhat would you add?`),
        context,
        note: "Appended a reply prompt (placeholder wording).",
      };
    },
  },
  {
    id: "attach-image",
    kind: "context",
    title: "Attach an image",
    why: "Photo-expand is a scored head and media lifts predicted dwell; the multimodal embedding also improves retrieval.",
    source: SOURCES.weights,
    applies: (_, c) => !c.hasImage && !c.hasVideo,
    apply: (text, context) => ({ text, context: { ...context, hasImage: true }, note: "Projected with an image attached." }),
  },
  {
    id: "attach-video",
    kind: "context",
    title: "Attach a 10s+ video",
    why: "Video-open and watch-time heads are scored; only videos over 10 seconds count toward the video-quality-view threshold.",
    source: SOURCES.weights,
    applies: (_, c) => !c.hasVideo,
    apply: (text, context) => ({
      text,
      context: { ...context, hasVideo: true, hasImage: false, videoSeconds: Math.max(context.videoSeconds, 15) },
      note: "Projected with a 15s video attached.",
    }),
  },
  {
    id: "post-as-original",
    kind: "context",
    title: "Post it as an original, not a reply or repost",
    why: "OONRetweetReplyFilter drops out-of-network replies and reposts before scoring; originals are the only format that can leave your follower graph.",
    source: SOURCES.oonFilter,
    applies: (_, c) => c.isReply || c.isRepost,
    apply: (text, context) => ({
      text: tidy(text.replace(/^(@[A-Za-z0-9_]{1,15}\s*)+/, "")),
      context: { ...context, isReply: false, isRepost: false },
      note: "Projected as an original post.",
    }),
  },
  {
    id: "post-fresh",
    kind: "context",
    title: "Publish fresh (under 24h for the cold-start slot, 48h hard cap)",
    why: "AgeFilter drops anything over 48 hours; the new-author cold-start boost only considers posts under 24 hours old.",
    source: SOURCES.ageFilter,
    applies: (_, c) => c.postAgeHours > 24,
    apply: (text, context) => ({ text, context: { ...context, postAgeHours: 0 }, note: "Projected as a fresh post." }),
  },
  {
    id: "avoid-duplicate",
    kind: "context",
    title: "Do not repost the same text",
    why: "Repeated identical text is clustered by the bbq_duplicate_text job and labeled COPYPASTA_SPAM.",
    source: SOURCES.copypasta,
    applies: (_, c) => c.duplicateText,
    apply: (text, context) => ({ text, context: { ...context, duplicateText: false }, note: "Projected as unique text." }),
  },
];
