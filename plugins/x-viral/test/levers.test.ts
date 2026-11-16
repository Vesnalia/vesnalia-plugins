import { describe, expect, it } from "vitest";
import { suggestions } from "../lib/autoresearch";
import { diffStats, unifiedPatch } from "../lib/diff";
import { checkImage } from "../lib/image";
import { opportunities, reachable } from "../lib/opportunities";
import { rewritePrompt } from "../lib/prompt";
import { scorePost } from "../lib/scorer";
import { videoScript } from "../lib/video";

const PLAIN = "Shipped a new onboarding flow today. Activation went from 31% to 47% in two weeks.\n\nThe change: we cut the signup form from 9 fields to 3.";

describe("suggestions", () => {
  it("never lists a transform that would not change the post", () => {
    const list = suggestions(scorePost("One long opening sentence with no boundary that keeps going and going for well over ninety characters without any period"));
    expect(list.find((s) => s.id === "hook-on-its-own-line")).toBeUndefined();
  });
});

describe("opportunities", () => {
  it("projects every missing content lever with a positive delta", () => {
    const report = scorePost(PLAIN);
    const list = opportunities(report);
    expect(list.map((o) => o.id)).toContain("ask-a-question");
    expect(list.map((o) => o.id)).not.toContain("add-a-number");
    expect(list.every((o) => o.projectedScore > report.score)).toBe(true);
  });
  it("reaches green when everything lands", () => {
    const report = scorePost(PLAIN);
    const ceiling = reachable(report);
    expect(ceiling.score).toBeGreaterThanOrEqual(65);
    expect(ceiling.assumes.length).toBeGreaterThan(0);
  });
  it("drops the question lever once a question exists", () => {
    const list = opportunities(scorePost(`${PLAIN}\n\nWhat would you cut first?`));
    expect(list.find((o) => o.id === "ask-a-question")).toBeUndefined();
  });
});

describe("diff", () => {
  it("emits a unified patch with one hunk", () => {
    const patch = unifiedPatch("a\nb\nc", "a\nB\nc\nd");
    expect(patch).toContain("--- a/post.txt");
    expect(patch).toContain("@@ -1,3 +1,4 @@");
    expect(patch).toContain("-b\n+B");
    expect(diffStats("a\nb\nc", "a\nB\nc\nd")).toEqual({ added: 2, removed: 1 });
  });
});

describe("video", () => {
  it("builds hook, beats and ask from the post and clears 10 seconds", () => {
    const v = videoScript(PLAIN);
    expect(v.beats[0]!.label).toMatch(/Hook/);
    expect(v.beats.some((b) => b.label === "Ask")).toBe(true);
    expect(v.totalSeconds).toBeGreaterThanOrEqual(10);
    expect(v.markdown).toContain("| Hook");
  });
  it("uses the post's own question as the ask", () => {
    const v = videoScript(`${PLAIN}\n\nWhich field would you cut first?`);
    expect(v.beats.find((b) => b.label === "Ask")?.spoken).toContain("Which field");
  });
});

describe("image", () => {
  it("passes a 16:9 jpeg", () => {
    const c = checkImage({ width: 1600, height: 900, bytes: 400_000, type: "image/jpeg" });
    expect(c.verdict).toBe("good");
    expect(c.ratioLabel).toBe("16:9");
    expect(c.feed.cropped).toBe(false);
  });
  it("flags a panorama and an oversized file", () => {
    const c = checkImage({ width: 3000, height: 800, bytes: 9_000_000, type: "image/png" });
    expect(c.feed.cropped).toBe(true);
    expect(c.verdict).toBe("bad");
    expect(c.warnings.join(" ")).toMatch(/2:1/);
  });
});

describe("prompt", () => {
  it("includes the post, the score, and the levers", () => {
    const report = scorePost(PLAIN);
    const p = rewritePrompt({ text: PLAIN, context: { authorFollowers: 500 }, score: report.score, reachable: 70, opportunities: opportunities(report) });
    expect(p).toContain("x-viral-autoresearch");
    expect(p).toContain(PLAIN);
    expect(p).toContain("End with a question");
  });
});

describe("video file check", async () => {
  const { checkVideo } = await import("../lib/image");
  it("passes a 15s vertical mp4", () => {
    const c = checkVideo({ width: 1080, height: 1920, bytes: 20_000_000, type: "video/mp4", durationSeconds: 15 });
    expect(c.verdict).toBe("good");
    expect(c.ratioLabel).toBe("9:16");
    expect(c.clearsRankingMinimum).toBe(true);
  });
  it("flags a short clip, a long clip, and a bad format", () => {
    const short = checkVideo({ width: 1280, height: 720, bytes: 1_000_000, type: "video/mp4", durationSeconds: 6 });
    expect(short.clearsRankingMinimum).toBe(false);
    expect(short.verdict).toBe("ok");
    const long = checkVideo({ width: 1280, height: 720, bytes: 1_000_000, type: "video/x-msvideo", durationSeconds: 200 });
    expect(long.verdict).toBe("bad");
    expect(long.warnings.join(" ")).toMatch(/2:20/);
    expect(long.warnings.join(" ")).toMatch(/not accepted/);
  });
});
