import { describe, expect, it } from "vitest";
import { autoresearch, suggestions } from "../lib/autoresearch";
import { extractFeatures } from "../lib/features";
import { scorePost, toScore100 } from "../lib/scorer";
import { NEGATIVE_SUM, WEIGHTS } from "../lib/xalgo";

const PLAIN = "Shipped a new onboarding flow today. Activation went from 31% to 47% in two weeks.\n\nThe change: we cut the signup form from 9 fields to 3.";

describe("features", () => {
  it("detects links, hashtags, mentions, bait", () => {
    const f = extractFeatures("Check this out https://example.com/x #growth #startup @a @b @c like if you agree!!!");
    expect(f.hasLink).toBe(true);
    expect(f.hashtags).toBe(2);
    expect(f.mentions).toBe(3);
    expect(f.engagementBait).toBe(true);
    expect(f.repeatedChars).toBe(true);
  });
  it("treats a leading mention as a reply", () => {
    expect(extractFeatures("@someone totally agree").leadingMention).toBe(true);
  });
});

describe("scorer", () => {
  it("mirrors the production weights", () => {
    expect(WEIGHTS.reply).toBe(5);
    expect(WEIGHTS.shareViaCopyLink).toBe(20);
    expect(WEIGHTS.report).toBe(-234);
    expect(NEGATIVE_SUM).toBeCloseTo(43.2 + 31.2 + 58.8 + 234 + 0.02);
  });
  it("puts a baseline post in the middle and a strong post higher", () => {
    const plain = scorePost(PLAIN);
    expect(plain.score).toBeGreaterThan(20);
    expect(plain.score).toBeLessThan(80);
    const withQuestion = scorePost(`${PLAIN}\n\nWhat would you cut first?`);
    expect(withQuestion.score).toBeGreaterThan(plain.score);
  });
  it("drops out-of-network reach for replies and reposts", () => {
    expect(scorePost(PLAIN, { isReply: true }).score).toBe(0);
    expect(scorePost(PLAIN, { isRepost: true }).score).toBe(0);
    expect(scorePost(PLAIN, { isReply: true }).inNetworkScore).toBeGreaterThan(0);
  });
  it("drops posts older than 48 hours", () => {
    expect(scorePost(PLAIN, { postAgeHours: 49 }).gates.some((g) => g.id === "too-old")).toBe(true);
    expect(scorePost(PLAIN, { postAgeHours: 49 }).score).toBe(0);
  });
  it("penalizes engagement bait and hashtag clusters", () => {
    const baited = scorePost(`${PLAIN} Like if you agree! #growth #startup #saas`);
    expect(baited.score).toBeLessThan(scorePost(PLAIN).score);
  });
  it("applies the mutual-follow reply boost only to originals", () => {
    const original = scorePost(PLAIN, { inNetwork: true, mutualFollow: true });
    const reply = scorePost(PLAIN, { inNetwork: true, mutualFollow: true, isReply: true });
    expect(original.multipliers.mutualReplyBoost).toBe(true);
    expect(reply.multipliers.mutualReplyBoost).toBe(false);
    expect(original.terms.find((t) => t.head === "reply")?.weight).toBe(20);
  });
  it("flags cold-start eligibility for small fresh accounts", () => {
    expect(scorePost(PLAIN, { authorFollowers: 200 }).multipliers.coldStartEligible).toBe(true);
    expect(scorePost(PLAIN, { authorFollowers: 20_000 }).multipliers.coldStartEligible).toBe(false);
  });
  it("maps weighted scores monotonically onto 0-100", () => {
    expect(toScore100(-1)).toBe(0);
    expect(toScore100(0.046)).toBeGreaterThan(30);
    expect(toScore100(0.2)).toBeGreaterThan(toScore100(0.1));
    expect(toScore100(100)).toBeLessThanOrEqual(100);
  });
});

describe("autoresearch", () => {
  it("improves a weak post and reports every kept step", () => {
    const weak = "NEW BLOG POST!!! Read it here https://blog.example.com/post like if you agree and follow me for more #growth #startup #marketing";
    const out = autoresearch(weak);
    expect(out.final.score).toBeGreaterThan(out.original.score);
    expect(out.steps.length).toBeGreaterThan(0);
    expect(out.steps.every((s, i) => i === 0 || s.after > out.steps[i - 1]!.after)).toBe(true);
    expect(out.replyText).toContain("https://blog.example.com/post");
    expect(out.final.text).not.toMatch(/#growth/);
  });
  it("stops when nothing helps", () => {
    const good = `${PLAIN}\n\nWhat would you cut first?`;
    const out = autoresearch(good);
    expect(out.steps.length).toBe(0);
    expect(out.final.text).toBe(good);
  });
  it("lists context suggestions with projected deltas", () => {
    const list = suggestions(scorePost(PLAIN));
    const image = list.find((s) => s.id === "attach-image");
    expect(image?.kind).toBe("context");
    expect(image?.delta).toBeGreaterThan(0);
  });
});
