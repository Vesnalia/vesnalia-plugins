// alia-plugin-x-viral — scores a post against the open-source X For You
// ranking algorithm and runs an autoresearch loop (propose edit → score →
// keep if better) to improve it. Pure logic lives in lib/; this file wires
// RPC (for the sidebar page), the `alia x-viral` CLI, and two agent tools.
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { autoresearch, suggestions, type AutoresearchResult, type Suggestion } from "./lib/autoresearch";
import { unifiedPatch } from "./lib/diff";
import { formatAutoresearch, formatReport } from "./lib/format";
import { opportunities, reachable, type Opportunity, type Reachable } from "./lib/opportunities";
import { videoScript, type VideoScript } from "./lib/video";
import { scorePost, type ScoreReport } from "./lib/scorer";
import type { PostContext } from "./lib/features";
import { RANKING, WEIGHTS } from "./lib/xalgo";

export const contextSchema = z
  .object({
    hasImage: z.boolean().optional(),
    hasVideo: z.boolean().optional(),
    videoSeconds: z.number().min(0).max(36_000).optional(),
    isReply: z.boolean().optional(),
    isRepost: z.boolean().optional(),
    isQuote: z.boolean().optional(),
    authorFollowers: z.number().int().min(0).optional(),
    impressions: z.number().int().min(0).optional(),
    postAgeHours: z.number().min(0).optional(),
    inNetwork: z.boolean().optional(),
    mutualFollow: z.boolean().optional(),
    duplicateText: z.boolean().optional(),
    topicFeed: z.boolean().optional(),
  })
  .strict();

const textSchema = z.string().trim().min(1).max(25_000);

export interface ScoreResponse {
  report: ScoreReport;
  suggestions: Suggestion[];
  opportunities: Opportunity[];
  reachable: Reachable;
  markdown: string;
}
export interface AutoresearchResponse {
  result: AutoresearchResult;
  /** Unified patch from the original to the improved post, for the diff viewer. */
  patch: string;
  opportunities: Opportunity[];
  reachable: Reachable;
  markdown: string;
}

export const rpcContract = defineRpcContract({
  score: {
    input: z.object({ text: textSchema, context: contextSchema.optional() }),
    output: z.custom<ScoreResponse>((v) => typeof v === "object" && v !== null),
  },
  autoresearch: {
    input: z.object({
      text: textSchema,
      context: contextSchema.optional(),
      maxIterations: z.number().int().min(1).max(25).optional(),
    }),
    output: z.custom<AutoresearchResponse>((v) => typeof v === "object" && v !== null),
  },
  video: {
    input: z.object({ text: textSchema, context: contextSchema.optional() }),
    output: z.custom<VideoScript>((v) => typeof v === "object" && v !== null),
  },
});

/** RPC results must be strict JSON: drop `undefined` fields (e.g. replyText, source). */
function asJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function runScore(text: string, context?: PostContext): ScoreResponse {
  const report = scorePost(text, context);
  const list = suggestions(report).filter((s) => s.delta > 0);
  const levers = opportunities(report);
  const ceiling = reachable(report);
  return asJson({
    report,
    suggestions: list,
    opportunities: levers,
    reachable: ceiling,
    markdown: formatReport(report, { suggestions: list, opportunities: levers, reachable: ceiling }),
  });
}

export function runAutoresearch(text: string, context?: PostContext, maxIterations?: number): AutoresearchResponse {
  const result = autoresearch(text, context, { maxIterations });
  const levers = opportunities(result.final);
  const ceiling = reachable(result.final);
  return asJson({
    result,
    patch: unifiedPatch(result.original.text, result.final.text),
    opportunities: levers,
    reachable: ceiling,
    markdown: formatAutoresearch(result, { opportunities: levers, reachable: ceiling }),
  });
}

export function runVideo(text: string, context?: PostContext): VideoScript {
  return asJson(videoScript(text, context));
}

/** Parses `alia x-viral` flags into a PostContext; the rest of argv is the post text. */
export function parseCliArgs(argv: string[]): { text: string; context: PostContext; json: boolean; iterations?: number; verbose: boolean } {
  const context: PostContext = {};
  const words: string[] = [];
  let json = false;
  let verbose = false;
  let iterations: number | undefined;
  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const [flag, inline] = arg.startsWith("--") ? arg.slice(2).split("=", 2) : [null, undefined];
    const next = () => (inline !== undefined ? inline : argv[++i]);
    switch (flag) {
      case null:
        words.push(arg);
        break;
      case "json": json = true; break;
      case "verbose": verbose = true; break;
      case "image": context.hasImage = true; break;
      case "video": context.hasVideo = true; context.videoSeconds = inline !== undefined ? num(inline) ?? 15 : 15; break;
      case "reply": context.isReply = true; break;
      case "repost": context.isRepost = true; break;
      case "quote": context.isQuote = true; break;
      case "mutual": context.mutualFollow = true; context.inNetwork = true; break;
      case "in-network": context.inNetwork = true; break;
      case "duplicate": context.duplicateText = true; break;
      case "topic-feed": context.topicFeed = true; break;
      case "followers": context.authorFollowers = num(next()); break;
      case "impressions": context.impressions = num(next()); break;
      case "age-hours": context.postAgeHours = num(next()); break;
      case "iterations": iterations = num(next()); break;
      default:
        words.push(arg);
    }
  }
  return { text: words.join(" ").replace(/\\n/g, "\n").trim(), context, json, iterations, verbose };
}

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");

  alia.rpc.register(rpcContract, {
    score: ({ text, context }) => runScore(text, context),
    autoresearch: ({ text, context, maxIterations }) => runAutoresearch(text, context, maxIterations),
    video: ({ text, context }) => runVideo(text, context),
  });

  const usage = [
    "Usage:",
    '  VesnALIA x-viral score "<post text>" [flags]         Score a post and list suggestions',
    '  VesnALIA x-viral autoresearch "<post text>" [flags]  Iteratively rewrite until the score stops rising',
    '  VesnALIA x-viral video "<post text>"                 Turn the post into a short-video beat sheet',
    "  VesnALIA x-viral weights                              Print the production ranking weights",
    "",
    "Flags: --image  --video[=secs]  --reply  --repost  --quote  --mutual  --in-network",
    "       --followers N  --impressions N  --age-hours N  --duplicate  --topic-feed",
    "       --iterations N (autoresearch)  --verbose  --json",
    "Use \\n inside the quoted text for line breaks.",
  ].join("\n");

  alia.cli.register({
    name: "x-viral",
    summary: "Score a post against the X For You algorithm and autoresearch a better version",
    commands: [
      { name: "score", summary: "Score a post (0-100) with the reasons and ranked suggestions", usage: 'alia x-viral score "<post text>" [--image] [--video] [--reply] [--followers N] [--json]' },
      { name: "autoresearch", summary: "Loop: propose edit → rescore → keep if better; prints the improved post", usage: 'alia x-viral autoresearch "<post text>" [--iterations N] [--json]' },
      { name: "video", summary: "Turn a post into a 10-30s video script (hook, beats, ask) using its own sentences", usage: 'alia x-viral video "<post text>" [--json]' },
      { name: "weights", summary: "Print the ranking weights mirrored from home-mixer/params/param.rs", usage: "alia x-viral weights [--json]" },
    ],
    async run(argv) {
      const [command, ...rest] = argv;
      const parsed = parseCliArgs(rest);
      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "weights":
          return {
            exitCode: 0,
            stdout: parsed.json
              ? JSON.stringify({ weights: WEIGHTS, ranking: RANKING })
              : Object.entries(WEIGHTS).map(([k, v]) => `${k.padEnd(32)} ${v}`).join("\n"),
          };
        case "score": {
          if (parsed.text === "") return { exitCode: 1, stderr: `Missing post text.\n${usage}` };
          const out = runScore(parsed.text, parsed.context);
          return {
            exitCode: 0,
            stdout: parsed.json
              ? JSON.stringify(out)
              : formatReport(out.report, { suggestions: out.suggestions, opportunities: out.opportunities, reachable: out.reachable, verbose: parsed.verbose }),
          };
        }
        case "autoresearch": {
          if (parsed.text === "") return { exitCode: 1, stderr: `Missing post text.\n${usage}` };
          const out = runAutoresearch(parsed.text, parsed.context, parsed.iterations);
          return { exitCode: 0, stdout: parsed.json ? JSON.stringify(out) : out.markdown };
        }
        case "video": {
          if (parsed.text === "") return { exitCode: 1, stderr: `Missing post text.\n${usage}` };
          const out = runVideo(parsed.text, parsed.context);
          return { exitCode: 0, stdout: parsed.json ? JSON.stringify(out) : out.markdown };
        }
        default:
          return { exitCode: 1, stderr: usage };
      }
    },
  });

  alia.agents.registerTool({
    name: "x_viral_score",
    description:
      "Score a draft X post 0-100 against the open-source For You ranking algorithm (weighted engagement heads, out-of-network discount, visibility gates). Returns the breakdown, the signals the model would read, and suggestions each with its projected score.",
    instructions:
      "For any request to score, evaluate, rank, or improve an X/Twitter post, call x_viral_score first; use x_viral_autoresearch to get an improved version and its new score. Pass context flags (image, video, reply, followers) when the user states them.",
    presentation: { label: { pending: "Scoring post against the X algorithm", completed: "Scored post against the X algorithm" } },
    parameters: z.object({ text: textSchema, context: contextSchema.optional() }),
    async execute({ text, context }) {
      const out = runScore(text, context);
      return out.markdown;
    },
  });

  alia.agents.registerTool({
    name: "x_viral_autoresearch",
    description:
      "Run the autoresearch loop on a draft X post: try each candidate edit, rescore with the X algorithm model, keep only edits that raise the score, and return the original score, every kept step, the improved post, and its new score.",
    presentation: { label: { pending: "Autoresearching post edits", completed: "Autoresearched post edits" } },
    parameters: z.object({
      text: textSchema,
      context: contextSchema.optional(),
      maxIterations: z.number().int().min(1).max(25).optional(),
    }),
    async execute({ text, context, maxIterations }) {
      return runAutoresearch(text, context, maxIterations).markdown;
    },
  });

  alia.agents.registerTool({
    name: "x_viral_video_script",
    description:
      "Turn a draft X post into a 10-30 second video beat sheet (hook, beats, ask, on-screen captions, timing) built from the post's own sentences, with feed-specific production notes.",
    presentation: { label: { pending: "Drafting video script", completed: "Drafted video script" } },
    parameters: z.object({ text: textSchema, context: contextSchema.optional() }),
    async execute({ text, context }) {
      return runVideo(text, context).markdown;
    },
  });
}
