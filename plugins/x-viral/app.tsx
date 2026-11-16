// alia-plugin-x-viral — sidebar page: paste a post, score it, autoresearch it,
// check an image for the feed, draft a video script, hand off to an agent.
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, ReactNode } from "react";
import { definePluginApp, experimental_Diff as Diff, useAliaNavigate, useRpc } from "@vesnalia/plugin-sdk/app";
import type { AutoresearchResponse, ScoreResponse, rpcContract } from "./server";
import type { PostContext } from "./lib/features";
import { checkImage, checkVideo, type ImageCheck, type VideoCheck } from "./lib/image";
import { rewritePrompt } from "./lib/prompt";
import type { VideoScript } from "./lib/video";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "x-viral:draft";
const GREEN = 65;

interface Draft {
  text: string;
  ctx: PostContext;
  followersText: string;
  image: ImageCheck | VideoCheck | null;
  mediaKind: "image" | "video" | null;
}

function loadDraft(): Draft {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Draft>;
      return { image: null, mediaKind: null, ...parsed, text: parsed.text ?? "" } as Draft;
    }
  } catch {
    /* ignore */
  }
  return { text: "", ctx: { authorFollowers: 500 }, followersText: "500", image: null, mediaKind: null };
}

function tone(value: number): string {
  return value >= GREEN ? "text-emerald-600 dark:text-emerald-400" : value >= 35 ? "text-amber-600 dark:text-amber-400" : "text-destructive";
}

function ScoreBadge({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className={cn("text-3xl font-semibold tabular-nums", tone(value))}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-sm font-medium">
        {title}
        {hint ? <span className="ml-2 font-normal text-muted-foreground">{hint}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

function Delta({ value }: { value: number }) {
  return (
    <span className={cn("w-14 shrink-0 font-mono tabular-nums", value > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

function Page() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useAliaNavigate();
  const [draft] = useState<Draft>(loadDraft);
  const [text, setText] = useState(draft.text);
  const [ctx, setCtx] = useState<PostContext>(draft.ctx);
  const [followersText, setFollowersText] = useState(draft.followersText);
  const [image, setImage] = useState<ImageCheck | VideoCheck | null>(draft.image);
  const [mediaKind, setMediaKind] = useState<"image" | "video" | null>(draft.mediaKind);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [scored, setScored] = useState<ScoreResponse | null>(null);
  const [research, setResearch] = useState<AutoresearchResponse | null>(null);
  const [video, setVideo] = useState<VideoScript | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mediaName, setMediaName] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, ctx, followersText, image, mediaKind } satisfies Draft));
    } catch {
      /* storage unavailable */
    }
  }, [text, ctx, followersText, image, mediaKind]);

  const set = (patch: Partial<PostContext>) => setCtx((c) => ({ ...c, ...patch }));

  const reset = () => {
    setText("");
    setCtx({ authorFollowers: 500 });
    setFollowersText("500");
    setImage(null);
    setMediaKind(null);
    setMediaName(null);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    if (fileRef.current) fileRef.current.value = "";
    setScored(null);
    setResearch(null);
    setVideo(null);
    setError(null);
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    textareaRef.current?.focus();
  };

  const run = async (kind: "score" | "autoresearch" | "video", contextOverride?: PostContext) => {
    const context = contextOverride ?? ctx;
    if (text.trim() === "" || pending) return;
    setPending(true);
    setError(null);
    try {
      if (kind === "video") {
        setVideo(await rpc.call("video", { text, context }));
      } else {
        const score = await rpc.call("score", { text, context });
        setScored(score);
        setResearch(kind === "autoresearch" ? await rpc.call("autoresearch", { text, context }) : null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const useVersion = (next: string) => {
    setText(next);
    setResearch(null);
    setScored(null);
    window.requestAnimationFrame(() => {
      textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      textareaRef.current?.focus();
    });
  };

  /** Check a dropped/pasted/picked file, set the context, then score + autoresearch. */
  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setError(`"${file.name}" is not an image or video.`);
      return;
    }
    const url = URL.createObjectURL(file);
    const finish = (check: ImageCheck | VideoCheck, kind: "image" | "video", patch: Partial<PostContext>) => {
      setImage(check);
      setMediaKind(kind);
      setMediaName(file.name);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setImageUrl(url);
      const next = { ...ctx, ...patch };
      setCtx(next);
      setError(null);
      if (text.trim() !== "") void run("autoresearch", next);
    };
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => {
        const check = checkVideo({ width: v.videoWidth, height: v.videoHeight, bytes: file.size, type: file.type, durationSeconds: v.duration });
        finish(check, "video", { hasVideo: true, hasImage: false, videoSeconds: Math.round(v.duration) });
      };
      v.onerror = () => {
        setError("Could not read that file as a video; the browser may not decode this codec. Use an H.264 MP4 for a reliable check.");
        URL.revokeObjectURL(url);
      };
      v.src = url;
      return;
    }
    const img = new Image();
    img.onload = () => {
      finish(checkImage({ width: img.naturalWidth, height: img.naturalHeight, bytes: file.size, type: file.type }), "image", { hasImage: true, hasVideo: false });
    };
    img.onerror = () => {
      setError("Could not read that file as an image.");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
    event.target.value = "";
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(event.clipboardData.files ?? []).find((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (file) {
      event.preventDefault();
      handleFile(file);
    }
  };
  const clearMedia = () => {
    setImage(null);
    setMediaKind(null);
    setMediaName(null);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    set({ hasImage: false, hasVideo: false, videoSeconds: 0 });
  };

  const handOff = () => {
    if (!scored) return;
    navigate.toCompose({
      initialPrompt: rewritePrompt({
        text,
        context: ctx,
        score: scored.report.score,
        reachable: scored.reachable.score,
        opportunities: scored.opportunities,
        media: image
          ? `${mediaKind} ${image.ratioLabel}${"durationSeconds" in image ? `, ${image.durationSeconds}s` : ""}, verdict ${image.verdict}${image.warnings.length ? `; issues: ${image.warnings.join(" ")}` : ""}`
          : undefined,
      }),
      focusPrompt: true,
    });
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard unavailable; select the text and copy it manually.");
    }
  };

  const report = scored?.report ?? null;
  const busy = pending || text.trim() === "";

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-8 pt-3 md:px-5 md:pt-4">
        <p className="text-sm text-muted-foreground">
          Scores a draft against the open-source X For You ranking. Autoresearch applies every mechanical edit that raises the score; the content levers and the agent hand-off get it the rest of the way to green ({GREEN}+). Your draft is kept when you navigate away.
        </p>
        <div
          className={cn("mt-4 rounded-md border bg-background shadow-xs transition-colors", dragging ? "border-primary ring-2 ring-primary/30" : "border-input")}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
          onDrop={onDrop}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            placeholder="Write or paste the post. Drop the image or video you'd attach right here."
            aria-label="Post text"
            rows={6}
            className="w-full resize-y rounded-t-md bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
            {image ? (
              <span className="flex items-center gap-2">
                <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px] uppercase", image.verdict === "good" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : image.verdict === "ok" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-destructive/15 text-destructive")}>{mediaKind} {image.verdict}</span>
                <span className="truncate">{mediaName ?? "attached"} · {image.ratioLabel}{"durationSeconds" in image ? ` · ${image.durationSeconds}s` : ""}</span>
                <button type="button" className="rounded px-1 hover:bg-accent hover:text-foreground" onClick={clearMedia} aria-label="Remove media">×</button>
              </span>
            ) : (
              <span>{dragging ? "Drop to attach and score" : "Drop or paste an image or video to attach it; scoring runs automatically."}</span>
            )}
            <label className="cursor-pointer hover:text-foreground">
              browse…
              <input ref={fileRef} type="file" accept="image/*,video/*" className="sr-only" onChange={onPick} />
            </label>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Toggle label="Image" checked={ctx.hasImage ?? false} onChange={(v) => set({ hasImage: v })} />
          <Toggle label="Video (15s)" checked={ctx.hasVideo ?? false} onChange={(v) => set({ hasVideo: v, videoSeconds: v ? 15 : 0 })} />
          <Toggle label="Reply" checked={ctx.isReply ?? false} onChange={(v) => set({ isReply: v })} />
          <Toggle label="Quote" checked={ctx.isQuote ?? false} onChange={(v) => set({ isQuote: v })} />
          <Toggle label="Mutual follows" checked={ctx.mutualFollow ?? false} onChange={(v) => set({ mutualFollow: v, inNetwork: v })} />
          <label className="flex items-center gap-2 text-sm">
            Followers
            <Input
              type="text"
              inputMode="numeric"
              className="h-8 w-28"
              value={followersText}
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, "");
                setFollowersText(digits);
                set({ authorFollowers: digits === "" ? undefined : Number(digits) });
              }}
            />
          </label>
        </div>

        {image ? (
          <div className="mt-3 rounded-md border border-border bg-card p-3 text-sm">
            <h2 className="mb-2 text-sm font-medium">How the {mediaKind} shows in the feed</h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px] uppercase", image.verdict === "good" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : image.verdict === "ok" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-destructive/15 text-destructive")}>{image.verdict}</span>
              <span className="font-medium">{image.ratioLabel}</span>
              {"durationSeconds" in image ? (
                <span className={cn("font-mono text-xs", image.clearsRankingMinimum ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                  {image.durationSeconds}s {image.clearsRankingMinimum ? "· clears the 10s ranking minimum" : "· under the 10s ranking minimum"}
                </span>
              ) : null}
              <span className="text-muted-foreground">{image.feed.note}</span>
            </div>
            {imageUrl ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <figure>
                  <div className="overflow-hidden rounded-lg border border-border bg-muted" style={{ aspectRatio: String(image.feed.displayRatio) }}>
                    {mediaKind === "video" ? (
                      <video src={imageUrl} muted playsInline controls className="h-full w-full object-cover" />
                    ) : (
                      <img src={imageUrl} alt="Feed card preview" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <figcaption className="mt-1 text-xs text-muted-foreground">Feed card ({image.feed.cropped ? "cropped" : "uncropped"}){mediaKind === "video" ? ", muted autoplay" : ""}</figcaption>
                </figure>
                <figure>
                  <div className="overflow-hidden rounded-lg border border-border bg-muted" style={{ aspectRatio: "16 / 9" }}>
                    {mediaKind === "video" ? (
                      <video src={imageUrl} muted playsInline className="h-full w-full object-cover" />
                    ) : (
                      <img src={imageUrl} alt="Thread preview" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <figcaption className="mt-1 text-xs text-muted-foreground">Thread and link-card preview (16:9 crop)</figcaption>
                </figure>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Preview cleared on reload; the check result was kept. Choose the file again to see the crop.</p>
            )}
            {image.warnings.length > 0 || image.recommendations.length > 0 ? (
              <ul className="mt-3 space-y-1 text-muted-foreground">
                {image.warnings.map((w) => <li key={w} className="text-destructive">− {w}</li>)}
                {image.recommendations.map((r) => <li key={r}>+ {r}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => run("score")} disabled={busy}>Score</Button>
          <Button variant="secondary" onClick={() => run("autoresearch")} disabled={busy}>Autoresearch</Button>
          <Button variant="secondary" onClick={() => run("video")} disabled={busy}>Video script</Button>
          <Button variant="outline" onClick={handOff} disabled={busy || scored === null}>Hand off to an agent</Button>
          <Button variant="ghost" onClick={reset} disabled={pending || (text === "" && scored === null && research === null && video === null && image === null)}>Reset</Button>
        </div>
        {error === null ? null : <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

        {report === null ? null : (
          <>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <ScoreBadge value={report.score} label="Viral reach (non-followers)" />
              <ScoreBadge value={report.inNetworkScore} label="Followers-only view" />
              <ScoreBadge value={scored!.reachable.score} label="Reachable with content changes" />
            </div>
            <details className="mt-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">What the numbers mean</summary>
              <dl className="mt-2 space-y-2 text-muted-foreground">
                <div><dt className="font-medium text-foreground">Viral reach (0-100)</dt><dd>How the post ranks for people who do not follow you: the weighted sum times the 0.75 out-of-network factor, zeroed by any DROP gate, mapped so a plain post lands in the 30s and a strong one in the 70s. Green is {GREEN}+. A model estimate, not a view forecast.</dd></div>
                <div><dt className="font-medium text-foreground">Followers-only view</dt><dd>The same post for your followers: no out-of-network discount, stranger-only gates ignored, mutual-follow reply boost applied when set.</dd></div>
                <div><dt className="font-medium text-foreground">Reachable</dt><dd>The score if every content lever below landed and the best media was attached. If this is not green, no wording change will get there; the format or the idea has to change.</dd></div>
                <div><dt className="font-medium text-foreground">Weighted sum</dt><dd>What RankingScorer computes: estimated probability of each action times its production weight (reply 5, copy-link 20, like 0.5, report −234), positives minus negatives. Around 0.05 is ordinary, 0.2 exceptional, below 0 means negative feedback wins.</dd></div>
                <div><dt className="font-medium text-foreground">Deltas</dt><dd>Each suggestion or lever is applied on its own and rescored; the number is the change in viral reach. They do not add up, because edits interact.</dd></div>
                <div><dt className="font-medium text-foreground">Gates</dt><dd>DROP: a filter removes the post for non-followers before ranking, reach is 0. DOWNRANK: a spam or safety rule likely cuts non-follower delivery. WARN: advisory.</dd></div>
              </dl>
            </details>

            {report.gates.length > 0 ? (
              <Section title="Gates">
                <ul className="space-y-2">
                  {report.gates.map((g) => (
                    <li key={g.id} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
                      <span className={cn("mr-2 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase", g.severity === "drop" ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>{g.severity}</span>
                      <span className="font-medium">{g.title}</span>
                      <p className="mt-1 text-muted-foreground">{g.detail}</p>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{g.source}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            <Section title="What gets it to green" hint="content levers, each rescored on its own">
              <ul className="divide-y divide-border rounded-md border border-border bg-card">
                {scored!.opportunities.map((o) => (
                  <li key={o.id} className="flex gap-3 px-3 py-2 text-sm">
                    <Delta value={o.delta} />
                    <div>
                      <span className="font-medium">{o.title}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">→ {o.projectedScore}</span>
                      <p className="mt-0.5 text-muted-foreground">{o.howTo}</p>
                    </div>
                  </li>
                ))}
                {scored!.opportunities.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">Every content lever is already pulled.</li> : null}
              </ul>
              {scored!.reachable.assumes.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">Reachable {scored!.reachable.score} assumes: {scored!.reachable.assumes.join("; ")}.</p>
              ) : null}
            </Section>

            <Section title="Mechanical edits" hint="autoresearch applies these for you">
              <ul className="divide-y divide-border rounded-md border border-border bg-card">
                {scored!.suggestions.map((s) => (
                  <li key={s.id} className="flex gap-3 px-3 py-2 text-sm">
                    <Delta value={s.delta} />
                    <div>
                      <span className="font-medium">{s.title}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">→ {s.projectedScore}</span>
                      {s.kind === "context" ? <span className="ml-2 text-xs text-muted-foreground">publishing change</span> : null}
                      <p className="mt-0.5 text-muted-foreground">{s.why}</p>
                    </div>
                  </li>
                ))}
                {scored!.suggestions.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">No mechanical edit raises the score. Use the levers above or hand off to an agent.</li> : null}
              </ul>
            </Section>

            <Section title="Signals the model reads">
              <ul className="divide-y divide-border rounded-md border border-border bg-card">
                {report.signals.map((s) => (
                  <li key={s.id} className="px-3 py-2 text-sm">
                    <span className={cn("mr-2 font-mono", s.effect === "positive" ? "text-emerald-600 dark:text-emerald-400" : s.effect === "negative" ? "text-destructive" : "text-amber-600 dark:text-amber-400")}>{s.effect === "positive" ? "+" : s.effect === "negative" ? "−" : "±"}</span>
                    <span className="font-medium">{s.label}</span>
                    <p className="mt-0.5 text-muted-foreground">{s.why}</p>
                  </li>
                ))}
                {report.signals.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">Nothing distinctive: the model has little to work with.</li> : null}
              </ul>
            </Section>
          </>
        )}

        {research === null ? null : (
          <Section title={`Autoresearch: ${research.result.original.score} → ${research.result.final.score}`}>
            {research.result.steps.length === 0 ? (
              <p className="mb-3 text-sm text-muted-foreground">No mechanical edit improved the score. The levers above are what is left; hand off to an agent to have them written.</p>
            ) : (
              <>
                <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">
                  {research.result.steps.map((s) => (
                    <li key={s.iteration}>
                      <span className="font-medium">{s.title}</span> <span className="font-mono text-muted-foreground">{s.before} → {s.after}</span>
                    </li>
                  ))}
                </ol>
                <div className="overflow-hidden rounded-md border border-border">
                  <Diff patch={research.patch} path="post.txt" view="unified" overflow="wrap" showLineNumbers />
                </div>
              </>
            )}
            {research.result.replyText ? (
              <p className="mt-2 text-sm text-muted-foreground">Post as the first reply: <code>{research.result.replyText}</code></p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => useVersion(research.result.final.text)} disabled={research.result.steps.length === 0}>Use this version</Button>
              <Button variant="ghost" size="sm" onClick={() => copy(research.result.final.text)}>{copied ? "Copied" : "Copy"}</Button>
            </div>
          </Section>
        )}

        {video === null ? null : (
          <Section title={`Video script (~${video.totalSeconds}s)`} hint="built from the post's own sentences">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-1 pr-2">Beat</th><th className="py-1 pr-2">Time</th><th className="py-1 pr-2">Say</th><th className="py-1">On screen</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {video.beats.map((b) => (
                  <tr key={b.label} className="align-top">
                    <td className="py-1.5 pr-2 font-medium">{b.label}</td>
                    <td className="py-1.5 pr-2 font-mono text-xs">{b.seconds.toFixed(1)}s</td>
                    <td className="py-1.5 pr-2">{b.spoken}</td>
                    <td className="py-1.5 text-muted-foreground">{b.onScreen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {video.notes.map((n) => <li key={n}>- {n}</li>)}
            </ul>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => copy(video.markdown)}>{copied ? "Copied" : "Copy script"}</Button>
          </Section>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "x-viral",
    title: "X Viral",
    icon: "ChartColumn",
    path: "x-viral",
    component: Page,
  });
});
