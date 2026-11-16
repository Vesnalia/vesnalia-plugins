// Heuristic stand-in for Phoenix: estimates per-action probabilities from
// post features, then combines them exactly the way RankingScorer does
// (weighted sum → offset → OON discount → cold-start boost) using the
// production weights in lib/xalgo.ts.
import {
  extractFeatures,
  normalizeContext,
  type Features,
  type PostContext,
} from "./features";
import { NEGATIVE_SUM, RANKING, SOURCES, WEIGHTS } from "./xalgo";

export type Head =
  | "favorite"
  | "reply"
  | "retweet"
  | "quote"
  | "share"
  | "shareViaDm"
  | "shareViaCopyLink"
  | "dwell"
  | "dwellTimeSecs"
  | "click"
  | "openLink"
  | "photoExpand"
  | "videoOpen"
  | "followAuthor"
  | "notInterested"
  | "muteAuthor"
  | "blockAuthor"
  | "report"
  | "notDwelled";

export type Heads = Record<Head, number>;

/** Typical per-impression propensities on X for an unremarkable post. */
export const BASE_HEADS: Heads = {
  favorite: 0.03,
  reply: 0.004,
  retweet: 0.006,
  quote: 0.001,
  share: 0.002,
  shareViaDm: 0.001,
  shareViaCopyLink: 0.0005,
  dwell: 0.3,
  dwellTimeSecs: 2.0,
  click: 0.02,
  openLink: 0.0,
  photoExpand: 0.0,
  videoOpen: 0.0,
  followAuthor: 0.0005,
  notInterested: 0.0005,
  muteAuthor: 0.0001,
  blockAuthor: 0.00005,
  report: 0.00002,
  notDwelled: 0.5,
};

export interface Signal {
  id: string;
  label: string;
  why: string;
  source?: string;
  effect: "positive" | "negative" | "mixed";
  multipliers: Partial<Heads>;
}

type Rule = (f: Features, c: Required<PostContext>) => Signal | null;

const RULES: Rule[] = [
  (f) =>
    f.questions > 0 || f.replyPrompt
      ? {
          id: "asks-a-question",
          label: "Invites replies",
          why: "Reply weight is 5.0, ten times a like (0.5). Anything that lifts P(reply) is the single biggest lever in the weighted sum.",
          source: SOURCES.weights,
          effect: "positive",
          multipliers: { reply: 2.0, dwellTimeSecs: 1.1 },
        }
      : null,
  (f) =>
    f.opinion
      ? {
          id: "strong-opinion",
          label: "Takes a position",
          why: "Contrarian framing lifts replies and quotes (both weighted 5.0) but also raises negative-feedback risk (not-interested -43.2, block -31.2).",
          source: SOURCES.weights,
          effect: "mixed",
          multipliers: { reply: 1.6, quote: 1.8, favorite: 1.1, notInterested: 1.3, blockAuthor: 1.3 },
        }
      : null,
  (f) =>
    f.utility
      ? {
          id: "utility-content",
          label: "Useful, save-worthy content",
          why: "Share-via-copy-link is weighted 20.0 and share-via-DM 5.0. Practical content is what people copy and send.",
          source: SOURCES.weights,
          effect: "positive",
          multipliers: { shareViaCopyLink: 1.8, shareViaDm: 1.5, share: 1.5, retweet: 1.3, dwellTimeSecs: 1.3 },
        }
      : null,
  (f) =>
    f.story
      ? {
          id: "personal-story",
          label: "First-person story",
          why: "Narrative raises dwell (the model predicts dwell seconds, weighted 0.004/sec) and follow-author (4.0).",
          source: SOURCES.weights,
          effect: "positive",
          multipliers: { dwellTimeSecs: 1.4, dwell: 1.15, followAuthor: 1.8, reply: 1.2, notDwelled: 0.85 },
        }
      : null,
  (f) =>
    f.hasNumbers && !f.spamMarkers
      ? {
          id: "specific-numbers",
          label: "Concrete numbers",
          why: "Specificity reads as credible and shareable; it lifts repost and copy-link propensity.",
          effect: "positive",
          multipliers: { retweet: 1.25, shareViaCopyLink: 1.3, favorite: 1.1 },
        }
      : null,
  (f) =>
    f.listStructure
      ? {
          id: "scannable-list",
          label: "Scannable structure",
          why: "Lists and line breaks keep readers on the post, lifting predicted dwell and cutting not-dwelled.",
          effect: "positive",
          multipliers: { dwellTimeSecs: 1.3, dwell: 1.1, notDwelled: 0.85, shareViaCopyLink: 1.2 },
        }
      : null,
  (f) =>
    f.news
      ? {
          id: "news-framing",
          label: "News framing",
          why: "Timely framing lifts reposts and quotes, but the 48-hour AgeFilter means it must land fast.",
          source: SOURCES.ageFilter,
          effect: "positive",
          multipliers: { retweet: 1.4, quote: 1.3, click: 1.2 },
        }
      : null,
  (f) =>
    f.threadHook
      ? {
          id: "thread-hook",
          label: "Thread opener",
          why: "Only the first post of a thread is ranked for non-followers; DedupConversationFilter keeps one branch per conversation, so the opener must carry the whole hook.",
          source: SOURCES.dedupConversation,
          effect: "mixed",
          multipliers: { click: 1.5, dwellTimeSecs: 1.2, retweet: 0.95 },
        }
      : null,
  (f) =>
    f.firstLineChars > 0 && f.firstLineChars <= 90 && f.lines > 1
      ? {
          id: "tight-hook",
          label: "Short first line",
          why: "The first line decides whether the viewer stops scrolling; a short hook lowers P(not dwelled) (-0.02) and lifts dwell.",
          effect: "positive",
          multipliers: { notDwelled: 0.85, dwell: 1.15, dwellTimeSecs: 1.1 },
        }
      : null,
  (f) =>
    f.chars > 280 && f.paragraphs <= 1
      ? {
          id: "wall-of-text",
          label: "Wall of text",
          why: "Long posts without paragraph breaks lose the dwell they could earn; readers bounce before the model's dwell prediction pays off.",
          effect: "negative",
          multipliers: { notDwelled: 1.25, dwell: 0.85, favorite: 0.9 },
        }
      : null,
  (f) =>
    f.chars > 280 && f.paragraphs > 1
      ? {
          id: "long-form",
          label: "Long-form with breaks",
          why: "Predicted dwell seconds are a continuous head (0.004/sec); well-structured long posts earn more of it.",
          effect: "positive",
          multipliers: { dwellTimeSecs: 1.6, click: 1.3, notDwelled: 1.05 },
        }
      : null,
  (f) =>
    f.chars > 0 && f.chars < 40 && !f.hasLink
      ? {
          id: "very-short",
          label: "Very short post",
          why: "Under ~40 characters there is little to dwell on; only a sharp one-liner or a question earns engagement.",
          effect: "negative",
          multipliers: { dwellTimeSecs: 0.6, dwell: 0.8, shareViaCopyLink: 0.7 },
        }
      : null,
  (f) =>
    f.hasLink && !f.linkOnly
      ? {
          id: "external-link",
          label: "External link in body",
          why: "Open-link is weighted only 0.2 and pulls the viewer off-platform, which the model reads as lower like/reply/dwell. Bad-URL verdicts can also earn a SPAM_HIGH_RECALL label.",
          source: SOURCES.lowQualityUrl,
          effect: "mixed",
          multipliers: { openLink: 40, favorite: 0.75, reply: 0.75, retweet: 0.75, dwell: 0.85, dwellTimeSecs: 0.8, report: 1.3 },
        }
      : null,
  (f) =>
    f.linkOnly
      ? {
          id: "link-only",
          label: "Link with no substance",
          why: "A bare link gives the model nothing to predict engagement from and matches the low-quality-URL spam rule pattern.",
          source: SOURCES.lowQualityUrl,
          effect: "negative",
          multipliers: { openLink: 40, favorite: 0.4, reply: 0.4, retweet: 0.5, dwell: 0.5, dwellTimeSecs: 0.4, notInterested: 1.5, report: 2 },
        }
      : null,
  (f) =>
    f.hashtags >= 2
      ? {
          id: "hashtag-cluster",
          label: `${f.hashtags} hashtags`,
          why: "Hashtag clusters are a classic spam feature; they raise predicted not-interested/report and add nothing to the semantic-ID retrieval that now replaces keyword matching.",
          source: SOURCES.candidate,
          effect: "negative",
          multipliers: { favorite: 0.85, notInterested: 1.4, report: 1.4, muteAuthor: 1.2 },
        }
      : null,
  (f) =>
    f.engagementBait
      ? {
          id: "engagement-bait",
          label: "Engagement bait",
          why: "'Like if / RT if / follow me' phrasing lifts negative-feedback heads far more than it lifts likes; report is weighted -234.",
          source: SOURCES.weights,
          effect: "negative",
          multipliers: { favorite: 1.05, notInterested: 2.2, report: 2.5, muteAuthor: 1.6, blockAuthor: 1.4 },
        }
      : null,
  (f) =>
    f.spamMarkers
      ? {
          id: "spam-phrases",
          label: "Spam phrasing",
          why: "'Link in bio', 'DM me', 'guaranteed', giveaways: these phrases drive the Grox spam classifier and the SpamHighRecall visibility rules that drop out-of-network delivery.",
          source: SOURCES.vfRegistry,
          effect: "negative",
          multipliers: { notInterested: 2.5, report: 4, muteAuthor: 2, blockAuthor: 2, favorite: 0.7 },
        }
      : null,
  (f) =>
    f.capsRatio > 0.5
      ? {
          id: "shouting",
          label: "Mostly capital letters",
          why: "All-caps reads as spam or rage to the model and raises not-interested / mute propensity.",
          effect: "negative",
          multipliers: { notInterested: 1.5, muteAuthor: 1.4, favorite: 0.85 },
        }
      : null,
  (f) =>
    f.emojis >= 6 || f.repeatedChars || f.exclamations >= 4
      ? {
          id: "noisy-formatting",
          label: "Emoji / punctuation noise",
          why: "Heavy emoji, repeated characters and exclamation runs are low-quality signals in the spam and duplicate-text rules.",
          source: SOURCES.copypasta,
          effect: "negative",
          multipliers: { notInterested: 1.3, report: 1.3, favorite: 0.9 },
        }
      : null,
  (f) =>
    f.mentions >= 3
      ? {
          id: "mention-spam",
          label: `${f.mentions} @mentions`,
          why: "Mass mentions are a spam feature, and mentioning non-followers with a low-quality link is an explicit scarecrow rule.",
          source: SOURCES.lowQualityUrl,
          effect: "negative",
          multipliers: { report: 1.6, notInterested: 1.4, muteAuthor: 1.3 },
        }
      : null,
  (_, c) =>
    c.hasImage && !c.hasVideo
      ? {
          id: "has-image",
          label: "Image attached",
          why: "Photo-expand is a scored head (0.05) and media lifts predicted dwell; posts with media also feed the CLIP/multimodal embedding that retrieval uses.",
          source: SOURCES.weights,
          effect: "positive",
          multipliers: { photoExpand: 60, dwell: 1.3, dwellTimeSecs: 1.3, favorite: 1.15, notDwelled: 0.85 },
        }
      : null,
  (_, c) =>
    c.hasVideo
      ? {
          id: "has-video",
          label: c.videoSeconds >= 10 ? "Video (10s+)" : "Short video",
          why: "Video-open is a scored head (0.07) and watch time drives the dwell heads. VQV only counts for videos over 10s (and is currently weighted 0).",
          source: SOURCES.weights,
          effect: "positive",
          multipliers: { videoOpen: 100, dwell: 1.4, dwellTimeSecs: c.videoSeconds >= 10 ? 2.2 : 1.6, favorite: 1.1, notDwelled: 0.8 },
        }
      : null,
  (_, c) =>
    c.isQuote
      ? {
          id: "quote-post",
          label: "Quote post",
          why: "Quotes are original posts (not filtered like OON replies/reposts) and earn the quoted-click head; they piggyback on the quoted post's context.",
          source: SOURCES.oonFilter,
          effect: "positive",
          multipliers: { click: 1.4, quote: 1.2, reply: 1.2 },
        }
      : null,
  (f, c) =>
    f.nsfw
      ? {
          id: "nsfw-text",
          label: "Adult-content markers",
          why: "NsfwTextTweetLabelDropRule and the NSFW high-recall rules drop or interstitial the post for non-followers.",
          source: SOURCES.vfRegistry,
          effect: "negative",
          multipliers: { report: 3, notInterested: 2, favorite: c.inNetwork ? 1 : 0.6 },
        }
      : null,
];

export interface Gate {
  id: string;
  severity: "drop" | "downrank" | "warn";
  title: string;
  detail: string;
  source: string;
}

export function evaluateGates(f: Features, c: Required<PostContext>): Gate[] {
  const gates: Gate[] = [];
  if (c.isRepost) {
    gates.push({
      id: "oon-repost",
      severity: "drop",
      title: "Reposts never reach non-followers",
      detail: "OONRetweetReplyFilter removes reposts from accounts the viewer does not follow before scoring. A repost only circulates inside your own follower graph, at a 0.75 discount.",
      source: SOURCES.oonFilter,
    });
  }
  if (c.isReply || f.leadingMention) {
    gates.push({
      id: "oon-reply",
      severity: "drop",
      title: "Replies never reach non-followers",
      detail: "OONRetweetReplyFilter drops out-of-network replies. SelfReplyChainFilter also drops replies directed at accounts the viewer does not follow. Post the idea as an original post instead.",
      source: SOURCES.oonFilter,
    });
  }
  if (c.postAgeHours > RANKING.maxPostAgeHours) {
    gates.push({
      id: "too-old",
      severity: "drop",
      title: "Older than 48 hours",
      detail: "AgeFilter removes every candidate older than 48 hours, in-network or not. Virality has a hard two-day window.",
      source: SOURCES.ageFilter,
    });
  }
  if (f.abuse) {
    gates.push({
      id: "violent-speech",
      severity: "drop",
      title: "Violent or abusive language",
      detail: "FosnrViolentSpeechDropRule / FosnrAbuseDropRule drop the post outright once Grox labels it.",
      source: SOURCES.vfRegistry,
    });
  }
  if (f.nsfw) {
    gates.push({
      id: "nsfw",
      severity: "downrank",
      title: "Adult-content signals",
      detail: "NSFW high-recall rules drop out-of-network delivery and can label the account; followers may still see it behind an interstitial.",
      source: SOURCES.vfRegistry,
    });
  }
  if (c.duplicateText) {
    gates.push({
      id: "copypasta",
      severity: "downrank",
      title: "Duplicate text",
      detail: "The bbq_duplicate_text scheduled query labels repeated text clusters COPYPASTA_SPAM, which the SpamTweetLabelRule reads.",
      source: SOURCES.copypasta,
    });
  }
  if (f.spamMarkers || (f.hasLink && f.mentions >= 1 && f.linkOnly)) {
    gates.push({
      id: "spam-high-recall",
      severity: "downrank",
      title: "Spam-rule exposure",
      detail: "SpamHighRecallDropRule only applies to non-followers: followers still see the post, everyone else does not.",
      source: SOURCES.vfRegistry,
    });
  }
  if (f.linkOnly) {
    gates.push({
      id: "link-only",
      severity: "warn",
      title: "Nothing to rank but a link",
      detail: "Phoenix scores the text and media; a bare URL gives it nothing.",
      source: SOURCES.candidate,
    });
  }
  return gates;
}

export interface Term {
  head: Head;
  probability: number;
  weight: number;
  contribution: number;
}

export interface Multipliers {
  /** 0.75 for out-of-network delivery (or 0.5 on topic feeds). Applied once. */
  oon: number;
  /** Mutual-follow originals get reply weight 5 + 15. */
  mutualReplyBoost: boolean;
  /** Eligible for the new-author cold-start slot boost. */
  coldStartEligible: boolean;
  /** Author-diversity decay note for the viewer's second+ post from this author. */
  authorDiversityDecay: number;
}

export interface ScoreReport {
  text: string;
  context: Required<PostContext>;
  features: Features;
  heads: Heads;
  terms: Term[];
  weighted: { positive: number; negative: number; combined: number };
  multipliers: Multipliers;
  gates: Gate[];
  signals: Signal[];
  /** Headline: projected out-of-network (viral) reach, 0-100. */
  score: number;
  /** Same post as seen by existing followers, 0-100. */
  inNetworkScore: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function estimateHeads(f: Features, c: Required<PostContext>): { heads: Heads; signals: Signal[] } {
  const heads: Heads = { ...BASE_HEADS };
  const signals: Signal[] = [];
  for (const rule of RULES) {
    const signal = rule(f, c);
    if (signal === null) continue;
    signals.push(signal);
    for (const [head, mult] of Object.entries(signal.multipliers) as [Head, number][]) {
      heads[head] = heads[head] * mult;
    }
  }
  for (const head of Object.keys(heads) as Head[]) {
    if (head === "dwellTimeSecs") heads[head] = clamp(heads[head], 0, 60);
    else heads[head] = clamp(heads[head], 0, 0.95);
  }
  return { heads, signals };
}

export function weightedTerms(heads: Heads, c: Required<PostContext>): Term[] {
  const originalPost = !c.isReply && !c.isRepost;
  const replyWeight =
    c.mutualFollow && c.inNetwork && originalPost
      ? WEIGHTS.reply + WEIGHTS.bidirectionalFollowReplyBoost
      : WEIGHTS.reply;
  const pairs: [Head, number][] = [
    ["favorite", WEIGHTS.favorite],
    ["reply", replyWeight],
    ["retweet", WEIGHTS.retweet],
    ["quote", WEIGHTS.quote],
    ["share", WEIGHTS.share],
    ["shareViaDm", WEIGHTS.shareViaDm],
    ["shareViaCopyLink", WEIGHTS.shareViaCopyLink],
    ["dwell", WEIGHTS.dwell],
    ["dwellTimeSecs", WEIGHTS.contDwellTime],
    ["click", WEIGHTS.click],
    ["openLink", WEIGHTS.openLink],
    ["photoExpand", WEIGHTS.photoExpand],
    ["videoOpen", WEIGHTS.videoOpen],
    ["followAuthor", WEIGHTS.followAuthor],
    ["notInterested", WEIGHTS.notInterested],
    ["muteAuthor", WEIGHTS.muteAuthor],
    ["blockAuthor", WEIGHTS.blockAuthor],
    ["report", WEIGHTS.report],
    ["notDwelled", WEIGHTS.notDwelled],
  ];
  return pairs.map(([head, weight]) => ({
    head,
    probability: heads[head],
    weight,
    contribution: heads[head] * weight,
  }));
}

/** Mirrors RankingScorer::offset_score minus the constant offset (which only shifts every post equally). */
function offsetCombined(combined: number): number {
  if (combined >= 0) return combined;
  const totalSum = Object.values(WEIGHTS).reduce<number>((acc, w) => acc + Math.abs(w), 0);
  return ((combined + NEGATIVE_SUM) / totalSum) * 0.01 - 0.01;
}

/** Maps a weighted score onto 0-100: a baseline post lands near 35, a 4x post near 80. */
const SCALE_K = 0.107;
export function toScore100(weighted: number): number {
  if (weighted <= 0) return 0;
  return Math.round(100 * (1 - Math.exp(-weighted / SCALE_K)) * 10) / 10;
}

/**
 * `boost` multiplies heads after the feature rules run; the opportunities
 * module uses it to project "what if this post also had signal X".
 */
export function scorePost(text: string, ctx?: PostContext, boost?: Partial<Heads>): ScoreReport {
  const context = normalizeContext(ctx);
  const features = extractFeatures(text);
  const { heads, signals } = estimateHeads(features, context);
  if (boost) {
    for (const [head, mult] of Object.entries(boost) as [Head, number][]) {
      heads[head] = head === "dwellTimeSecs" ? clamp(heads[head] * mult, 0, 60) : clamp(heads[head] * mult, 0, 0.95);
    }
  }
  const terms = weightedTerms(heads, context);
  const positive = terms.filter((t) => t.contribution >= 0).reduce((a, t) => a + t.contribution, 0);
  const negative = terms.filter((t) => t.contribution < 0).reduce((a, t) => a - t.contribution, 0);
  const combined = offsetCombined(positive - negative);
  const gates = evaluateGates(features, context);
  const originalPost = !context.isReply && !context.isRepost;
  const coldStartEligible =
    context.authorFollowers <= RANKING.coldStart.followerCap &&
    context.impressions < RANKING.coldStart.impressionThreshold &&
    context.postAgeHours * 3600 <= RANKING.coldStart.maxPostAgeSecs &&
    originalPost;
  const multipliers: Multipliers = {
    oon: context.topicFeed ? RANKING.topicOonWeightFactor : RANKING.oonWeightFactor,
    mutualReplyBoost: context.mutualFollow && context.inNetwork && originalPost,
    coldStartEligible,
    authorDiversityDecay:
      (1 - RANKING.authorDiversityFloor) * RANKING.authorDiversityDecay + RANKING.authorDiversityFloor,
  };

  const worst = gates.reduce<"none" | "warn" | "downrank" | "drop">((acc, g) => {
    const rank = { none: 0, warn: 1, downrank: 2, drop: 3 };
    return rank[g.severity] > rank[acc] ? g.severity : acc;
  }, "none");
  const gateFactor = worst === "drop" ? 0 : worst === "downrank" ? 0.35 : 1;
  const coldStartBonus = coldStartEligible && worst !== "drop" ? 1.15 : 1;

  const inNetworkWeighted = combined * (originalPost ? 1 : multipliers.oon);
  const oonWeighted = combined * multipliers.oon * gateFactor * coldStartBonus;

  return {
    text,
    context,
    features,
    heads,
    terms,
    weighted: { positive, negative, combined },
    multipliers,
    gates,
    signals,
    score: toScore100(oonWeighted),
    inNetworkScore: toScore100(inNetworkWeighted),
  };
}
