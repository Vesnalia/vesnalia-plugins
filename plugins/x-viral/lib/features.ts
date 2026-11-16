// Text and context feature extraction. Pure; no VesnALIA imports.

export interface PostContext {
  /** Post carries a still image. */
  hasImage?: boolean;
  /** Post carries a video. */
  hasVideo?: boolean;
  videoSeconds?: number;
  /** Post is a reply to another post. */
  isReply?: boolean;
  /** Post is a plain repost (retweet). */
  isRepost?: boolean;
  /** Post quotes another post. */
  isQuote?: boolean;
  /** Author follower count. */
  authorFollowers?: number;
  /** Home-timeline impressions the post has received so far. */
  impressions?: number;
  /** Hours since the post was published (0 = about to publish). */
  postAgeHours?: number;
  /** Viewer follows the author (in-network). */
  inNetwork?: boolean;
  /** Viewer and author follow each other. */
  mutualFollow?: boolean;
  /** The author has posted this same text before. */
  duplicateText?: boolean;
  /** Audience is a topic-scoped feed rather than For You. */
  topicFeed?: boolean;
}

export interface Features {
  chars: number;
  words: number;
  lines: number;
  paragraphs: number;
  firstLine: string;
  firstLineChars: number;
  urls: string[];
  hasLink: boolean;
  linkOnly: boolean;
  hashtags: number;
  mentions: number;
  leadingMention: boolean;
  questions: number;
  replyPrompt: boolean;
  engagementBait: boolean;
  spamMarkers: boolean;
  capsRatio: number;
  emojis: number;
  exclamations: number;
  hasNumbers: boolean;
  listStructure: boolean;
  opinion: boolean;
  utility: boolean;
  story: boolean;
  news: boolean;
  threadHook: boolean;
  nsfw: boolean;
  abuse: boolean;
  repeatedChars: boolean;
}

const URL_RE = /\bhttps?:\/\/[^\s)]+|\b[a-z0-9-]+\.(?:com|io|ai|co|org|net|app|dev|ly|me|xyz)\b(?:\/[^\s)]*)?/gi;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /(^|\s)@[A-Za-z0-9_]{1,15}\b/g;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

const BAIT_RE =
  /\b(like|rt|retweet|repost|share|bookmark)\s+(if|this|for|and)\b|\bfollow\s+(me|for|back)\b|\bfollow\s*4\s*follow\b|\btag\s+(a|someone|your)\b|\bcomment\s+below\b|\bdrop\s+a\s+(like|❤️|🔥)|\b(rt|retweet)\s+to\b/i;
const SPAM_RE =
  /\blink\s+in\s+bio\b|\bdm\s+me\b|\bclick\s+here\b|\bguaranteed\b|\bfree\s+money\b|\bgiveaway\b|\bairdrop\b|\b100%\s+legit\b|\bearn\s+\$?\d+\s*(k|\/day|\/week|per)\b|\bmake\s+money\s+fast\b/i;
const QUESTION_PROMPT_RE =
  /\b(what do you think|thoughts\?|agree\?|disagree\?|am i wrong|what would you add|which one|tell me|reply with|what's yours|what are you|how do you|do you)\b/i;
const OPINION_RE =
  /\b(unpopular opinion|hot take|controversial|nobody talks about|everyone is wrong|stop doing|is dead|is overrated|is underrated|the truth is|wrong about|actually)\b/i;
const UTILITY_RE =
  /\b(how to|how i|guide|tips?|steps?|framework|checklist|template|playbook|lessons?|mistakes?|save this|bookmark this|cheat ?sheet|breakdown|here's (what|how|why))\b/i;
const STORY_RE =
  /\b(i (was|had|built|spent|lost|quit|got|learned|made|failed|tried|used to)|years? ago|today i|last (week|month|year)|when i|my (first|biggest|worst))\b/i;
const NEWS_RE = /\b(breaking|just in|announced|announcing|launch(ed|ing)?|new:)\b/i;
const THREAD_RE = /🧵|\bthread\b|\b1\/\d*\b|\(1\/|\bthread:?$/i;
const NSFW_RE = /\b(nsfw|porn|nudes?|onlyfans|xxx|explicit)\b/i;
const ABUSE_RE = /\b(kill (yourself|them)|kys|i('ll| will) (kill|hurt)|deserve to die|subhuman)\b/i;
const LIST_RE = /^\s*(?:[-•*]|\d+[.)]|\d+\/)\s+\S/m;

export function extractFeatures(rawText: string): Features {
  const text = rawText.replace(/\r\n/g, "\n").trim();
  const lines = text.split("\n").map((line) => line.trim());
  const nonEmpty = lines.filter((line) => line !== "");
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim() !== "").length;
  const firstLine = nonEmpty[0] ?? "";
  const urls = text.match(URL_RE) ?? [];
  const withoutUrls = text.replace(URL_RE, "").trim();
  const letters = withoutUrls.replace(/[^\p{L}]/gu, "");
  const upper = withoutUrls.replace(/[^\p{Lu}]/gu, "");
  const words = withoutUrls.split(/\s+/).filter((w) => w !== "").length;
  return {
    chars: text.length,
    words,
    lines: nonEmpty.length,
    paragraphs,
    firstLine,
    firstLineChars: firstLine.length,
    urls,
    hasLink: urls.length > 0,
    linkOnly: urls.length > 0 && withoutUrls.length < 15,
    hashtags: (text.match(HASHTAG_RE) ?? []).length,
    mentions: (text.match(MENTION_RE) ?? []).length,
    leadingMention: /^@[A-Za-z0-9_]{1,15}\b/.test(text),
    questions: (withoutUrls.match(/\?/g) ?? []).length,
    replyPrompt: QUESTION_PROMPT_RE.test(withoutUrls),
    engagementBait: BAIT_RE.test(withoutUrls),
    spamMarkers: SPAM_RE.test(withoutUrls),
    capsRatio: letters.length >= 12 ? upper.length / letters.length : 0,
    emojis: (text.match(EMOJI_RE) ?? []).length,
    exclamations: (withoutUrls.match(/!/g) ?? []).length,
    hasNumbers: /\d/.test(withoutUrls),
    listStructure: LIST_RE.test(text) && nonEmpty.length >= 3,
    opinion: OPINION_RE.test(withoutUrls),
    utility: UTILITY_RE.test(withoutUrls),
    story: STORY_RE.test(withoutUrls),
    news: NEWS_RE.test(withoutUrls),
    threadHook: THREAD_RE.test(withoutUrls),
    nsfw: NSFW_RE.test(withoutUrls),
    abuse: ABUSE_RE.test(withoutUrls),
    repeatedChars: /(.)\1{4,}/.test(withoutUrls) || /(!{3,}|\?{3,})/.test(withoutUrls),
  };
}

export function normalizeContext(ctx: PostContext | undefined): Required<PostContext> {
  return {
    hasImage: ctx?.hasImage ?? false,
    hasVideo: ctx?.hasVideo ?? false,
    videoSeconds: ctx?.videoSeconds ?? 0,
    isReply: ctx?.isReply ?? false,
    isRepost: ctx?.isRepost ?? false,
    isQuote: ctx?.isQuote ?? false,
    authorFollowers: ctx?.authorFollowers ?? 500,
    impressions: ctx?.impressions ?? 0,
    postAgeHours: ctx?.postAgeHours ?? 0,
    inNetwork: ctx?.inNetwork ?? false,
    mutualFollow: ctx?.mutualFollow ?? false,
    duplicateText: ctx?.duplicateText ?? false,
    topicFeed: ctx?.topicFeed ?? false,
  };
}
