// Feed-display checks for an attached image. The thresholds come from X's
// media help pages (formats, size caps, timeline crop bounds), not from the
// ranking repo, which only sees `has_media` and the multimodal embedding.

export interface ImageInfo {
  width: number;
  height: number;
  bytes: number;
  type: string;
}

export interface ImageCheck {
  ratio: number;
  ratioLabel: string;
  verdict: "good" | "ok" | "bad";
  /** How the single-image feed card will show it. */
  feed: { cropped: boolean; displayRatio: number; note: string };
  warnings: string[];
  recommendations: string[];
}

import { RANKING } from "./xalgo";

const RANKING_MIN_VIDEO_SECONDS = RANKING.minVideoDurationMs / 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_GIF_BYTES = 15 * 1024 * 1024;
const WIDE_LIMIT = 2; // 2:1
const TALL_LIMIT = 3 / 4; // 3:4
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function label(ratio: number): string {
  const known: [number, string][] = [
    [16 / 9, "16:9"],
    [3 / 2, "3:2"],
    [4 / 3, "4:3"],
    [1, "1:1"],
    [4 / 5, "4:5"],
    [3 / 4, "3:4"],
    [9 / 16, "9:16"],
    [2, "2:1"],
  ];
  const near = known.find(([r]) => Math.abs(r - ratio) < 0.03);
  return near ? near[1] : `${ratio.toFixed(2)}:1`;
}

export function checkImage(info: ImageInfo): ImageCheck {
  const ratio = info.width / info.height;
  const warnings: string[] = [];
  const recommendations: string[] = [];
  let displayRatio = ratio;
  let cropped = false;
  let note = "Shown uncropped in the feed.";

  if (ratio > WIDE_LIMIT) {
    cropped = true;
    displayRatio = WIDE_LIMIT;
    note = "Wider than 2:1: the feed crops the sides to 2:1. Anything at the edges is lost.";
    warnings.push(note);
  } else if (ratio < TALL_LIMIT) {
    cropped = true;
    displayRatio = TALL_LIMIT;
    note = "Taller than 3:4: the feed crops top and bottom to 3:4. Keep the subject centred.";
    warnings.push(note);
  }
  if (!OK_TYPES.includes(info.type)) warnings.push(`Format ${info.type || "unknown"} is not accepted; use JPEG, PNG, WEBP, or GIF.`);
  const cap = info.type === "image/gif" ? MAX_GIF_BYTES : MAX_BYTES;
  if (info.bytes > cap) warnings.push(`File is ${(info.bytes / 1024 / 1024).toFixed(1)} MB, over the ${cap / 1024 / 1024} MB cap; it will be rejected or recompressed.`);
  if (info.width < 600) warnings.push(`Width ${info.width}px is under 600px; the feed upscales it and it will look soft.`);
  if (info.width < 1200 && info.width >= 600) recommendations.push("Export at 1200px wide or more so it stays sharp on high-density screens.");
  if (info.type === "image/png" && info.bytes > 1.5 * 1024 * 1024) recommendations.push("Large PNGs get recompressed to JPEG on upload; export a JPEG yourself to control the quality.");
  if (Math.abs(ratio - 16 / 9) > 0.05 && Math.abs(ratio - 1) > 0.05 && Math.abs(ratio - 4 / 5) > 0.05 && !cropped) {
    recommendations.push("16:9 (1600×900) or 1:1 (1080×1080) fill the feed card most predictably; 4:5 gives the most vertical space uncropped.");
  }
  if (ratio < 1 && !cropped) recommendations.push("Tall images take more feed height, which helps dwell, but check the crop on the thread view (16:9 preview).");

  const verdict: ImageCheck["verdict"] =
    warnings.some((w) => /not accepted|over the/.test(w)) ? "bad" : warnings.length > 0 ? "ok" : "good";
  return { ratio, ratioLabel: label(ratio), verdict, feed: { cropped, displayRatio, note }, warnings, recommendations };
}

// ---- Video ----------------------------------------------------------------
// Caps and ratios from X's video help pages; the 10 s threshold is the ranking
// repo's MinVideoDurationMs (home-mixer/params/param.rs).

export interface VideoInfo extends ImageInfo {
  durationSeconds: number;
}

export interface VideoCheck extends ImageCheck {
  durationSeconds: number;
  /** Clears the ranking code's minimum duration for a video-quality view. */
  clearsRankingMinimum: boolean;
}

const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 140; // 2:20 for standard accounts
const MIN_VIDEO_SECONDS = 0.5;
const VIDEO_WIDE_LIMIT = 2.39;
const VIDEO_TALL_LIMIT = 1 / 2.39;
const OK_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export function checkVideo(info: VideoInfo): VideoCheck {
  const ratio = info.width / info.height;
  const warnings: string[] = [];
  const recommendations: string[] = [];
  let displayRatio = ratio;
  let cropped = false;
  let note = "Plays at its native ratio in the feed.";
  const minRank = RANKING_MIN_VIDEO_SECONDS;

  if (ratio > WIDE_LIMIT) {
    cropped = true;
    displayRatio = WIDE_LIMIT;
    note = "Wider than 2:1: the feed letterboxes or crops the sides. Keep the subject centred.";
    warnings.push(note);
  } else if (ratio < TALL_LIMIT) {
    cropped = true;
    displayRatio = TALL_LIMIT;
    note = "Taller than 3:4: the feed shows a 3:4 window until tapped; put the hook text in the middle.";
    recommendations.push(note);
  }
  if (ratio > VIDEO_WIDE_LIMIT || ratio < VIDEO_TALL_LIMIT) warnings.push("Aspect ratio is outside 1:2.39 to 2.39:1 and will be rejected.");
  if (!OK_VIDEO_TYPES.includes(info.type)) warnings.push(`Format ${info.type || "unknown"} is not accepted; upload MP4 (H.264 + AAC) or MOV.`);
  if (info.bytes > MAX_VIDEO_BYTES) warnings.push(`File is ${(info.bytes / 1024 / 1024).toFixed(0)} MB, over the 512 MB cap.`);
  if (info.durationSeconds > MAX_VIDEO_SECONDS) warnings.push(`Runs ${Math.round(info.durationSeconds)}s, over the 2:20 cap for standard accounts.`);
  if (info.durationSeconds < MIN_VIDEO_SECONDS) warnings.push("Shorter than 0.5s; it will be rejected.");
  const clearsRankingMinimum = info.durationSeconds > minRank;
  if (!clearsRankingMinimum) {
    warnings.push(`Runs ${info.durationSeconds.toFixed(1)}s. Only videos over ${minRank}s count for the video-quality-view head in the ranking code; add a held end card to clear it.`);
  }
  if (info.width < 720 && info.height < 720) warnings.push(`Only ${info.width}×${info.height}; export at 720p or higher so the feed does not soften it.`);
  if (info.durationSeconds > 45) recommendations.push("Over 45s: front-load the hook and the ask; the scored heads are video-open, dwell, and reply, not completion.");
  if (Math.abs(ratio - 9 / 16) > 0.05 && Math.abs(ratio - 1) > 0.05 && Math.abs(ratio - 16 / 9) > 0.05) {
    recommendations.push("9:16 or 1:1 fill the most feed height; 16:9 (1280×720) is the safe landscape choice.");
  }
  if (ratio > 1.05) recommendations.push("Landscape takes the least feed height; a 1:1 or 4:5 crop earns more dwell per scroll.");
  recommendations.push("Burn captions in: feed playback starts muted.");

  const verdict: VideoCheck["verdict"] =
    warnings.some((w) => /rejected|over the|not accepted/.test(w)) ? "bad" : warnings.length > 0 ? "ok" : "good";
  return {
    ratio,
    ratioLabel: label(ratio),
    verdict,
    feed: { cropped, displayRatio, note },
    warnings,
    recommendations,
    durationSeconds: Math.round(info.durationSeconds * 10) / 10,
    clearsRankingMinimum,
  };
}
