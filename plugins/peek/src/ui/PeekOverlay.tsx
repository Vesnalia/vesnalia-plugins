// The preview modal.
//
// Mounted once per window as an app overlay, so it can open over the store
// without the store knowing about it. The content script tells it which card
// was clicked by display name; this component resolves that to a catalog entry
// and renders the backend's impact report.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Markdown, useRpc } from "@vesnalia/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PEEK_OPEN_EVENT, type PeekOpenDetail } from "./store-decorator";
import type { rpcContract } from "../../server";
import type { PeekEntryRef, PeekReport, PeekSurface } from "../types";

type LoadState =
  | { phase: "idle" }
  | { phase: "loading"; displayName: string }
  | { phase: "ready"; report: PeekReport }
  | { phase: "error"; displayName: string; message: string };

/** A fact's provenance, kept visible so a heuristic never reads as certainty. */
function ConfidenceTag({ confidence }: { confidence: "declared" | "detected" }) {
  return (
    <span
      className="shrink-0 rounded-sm border border-border px-1 py-px text-[10px] uppercase tracking-wide text-subtle-foreground"
      title={
        confidence === "declared"
          ? "Read from the plugin's manifest."
          : "Found by reading the plugin's code without running it."
      }
    >
      {confidence}
    </span>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
        {count === undefined ? null : <span className="ml-1.5 text-subtle-foreground">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function Row({
  where,
  label,
  detail,
  high,
  confidence,
}: {
  where: string;
  label: string;
  detail: string | null;
  high: boolean;
  confidence: "declared" | "detected";
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm",
        high && "border-destructive/40",
      )}
    >
      <span className="mt-px w-28 shrink-0 text-xs font-medium text-muted-foreground">{where}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-foreground">{label}</span>
        {detail === null ? null : (
          <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">{detail}</span>
        )}
      </span>
      {high ? (
        <span className="mt-px shrink-0 rounded-sm bg-destructive/10 px-1 py-px text-[10px] uppercase tracking-wide text-destructive">
          wide access
        </span>
      ) : null}
      <ConfidenceTag confidence={confidence} />
    </li>
  );
}

function SurfaceList({ surfaces }: { surfaces: PeekSurface[] }) {
  if (surfaces.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
        No interface changes found.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {surfaces.map((surface, index) => (
        <Row
          key={`${surface.kind}-${surface.detail ?? index}`}
          where={surface.where}
          label={surface.label}
          detail={surface.detail}
          high={surface.risk === "high"}
          confidence={surface.confidence}
        />
      ))}
    </ul>
  );
}

function ReportBody({
  report,
  onOpenScreenshot,
}: {
  report: PeekReport;
  onOpenScreenshot: (index: number) => void;
}) {
  const { entry } = report;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{entry.marketplaceDisplayName}</span>
        {entry.author === null ? null : <span>· {entry.author}</span>}
        {report.manifest?.version === undefined || report.manifest?.version === null ? null : (
          <span>· v{report.manifest.version}</span>
        )}
        {entry.installed ? <span className="text-foreground">· already installed</span> : null}
        {entry.compatible ? null : (
          <span className="text-destructive">· incompatible{entry.incompatibleReason === null ? "" : `: ${entry.incompatibleReason}`}</span>
        )}
      </div>

      <Section title="Changes to your VesnALIA interface" count={report.surfaces.length}>
        <SurfaceList surfaces={report.surfaces} />
      </Section>

      {report.settings.length === 0 ? null : (
        <Section title="Settings it adds" count={report.settings.length}>
          <ul className="space-y-1.5">
            {report.settings.map((setting, index) => (
              <Row
                key={setting.key ?? index}
                where={setting.type ?? "setting"}
                label={setting.label ?? setting.key ?? "Unnamed setting"}
                detail={setting.secret ? "stored as a secret" : setting.key}
                high={false}
                confidence={setting.confidence}
              />
            ))}
          </ul>
        </Section>
      )}

      {report.capabilities.length === 0 ? null : (
        <Section title="What it can do" count={report.capabilities.length}>
          <ul className="space-y-1.5">
            {report.capabilities.map((capability) => (
              <Row
                key={capability.id}
                where={capability.risk === "high" ? "Wide access" : "Capability"}
                label={capability.label}
                detail={capability.detail}
                high={capability.risk === "high"}
                confidence={capability.confidence}
              />
            ))}
          </ul>
        </Section>
      )}

      {report.commands.length === 0 ? null : (
        <Section title="CLI commands" count={report.commands.length}>
          <ul className="space-y-1.5">
            {report.commands.map((command) => (
              <Row
                key={command.name}
                where="Terminal"
                label={`alia ${command.name}`}
                detail={command.subcommands.length === 0 ? command.summary : command.subcommands.join(", ")}
                high={false}
                confidence={command.confidence}
              />
            ))}
          </ul>
        </Section>
      )}

      {report.skills.length === 0 ? null : (
        <Section title="Skills it gives your agents" count={report.skills.length}>
          <ul className="space-y-1.5">
            {report.skills.map((skill) => (
              <Row
                key={skill.name}
                where="Agents"
                label={skill.name}
                detail={skill.description}
                high={false}
                confidence="declared"
              />
            ))}
          </ul>
        </Section>
      )}

      {report.themes.length === 0 ? null : (
        <Section title="Themes" count={report.themes.length}>
          <ul className="space-y-1.5">
            {report.themes.map((theme) => (
              <li
                key={theme.id ?? theme.name}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{theme.name}</span>
                <span className="flex shrink-0 gap-1" aria-hidden="true">
                  {theme.swatches.map((swatch, index) => (
                    <span
                      key={index}
                      className="size-4 rounded-sm border border-border"
                      style={{ background: swatch }}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {entry.screenshots.length === 0 ? null : (
        <Section title="Screenshots" count={entry.screenshots.length}>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {entry.screenshots.map((screenshot, index) => (
              <button
                key={screenshot}
                type="button"
                onClick={() => onOpenScreenshot(index)}
                aria-label={`View screenshot ${index + 1} of ${entry.screenshots.length} full size`}
                className="shrink-0 cursor-zoom-in rounded-md border border-border transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <img src={screenshot} alt="" className="h-40 rounded-[calc(var(--radius)-2px)] object-cover" />
              </button>
            ))}
          </div>
        </Section>
      )}

      {entry.overview === null ? null : (
        <Section title="What the author says">
          <div className="rounded-md border border-border bg-card px-3 py-2">
            <Markdown content={entry.overview} />
          </div>
        </Section>
      )}

      {report.warnings.length === 0 ? null : (
        <Section title="What this preview could not tell you">
          <ul className="space-y-1 text-sm text-muted-foreground">
            {report.warnings.map((warning) => (
              <li key={warning} className="flex gap-2">
                <span aria-hidden="true">—</span>
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="border-t border-border pt-3 text-xs text-subtle-foreground">
        Read {report.source.filesRead} file{report.source.filesRead === 1 ? "" : "s"} from{" "}
        {report.source.via}
        {report.source.resolved === null ? "" : ` (${report.source.resolved})`} without installing or
        running anything.
        {report.source.note === null ? "" : ` ${report.source.note}`}
      </p>
    </div>
  );
}

/**
 * Full-size screenshot viewer. Rendered as a sibling of the report dialog
 * rather than nested inside it, so each one owns its own dismissable layer:
 * Escape and outside clicks close the viewer and leave the report open.
 */
function ScreenshotViewer({
  screenshots,
  index,
  onIndexChange,
  onClose,
  pluginName,
}: {
  screenshots: string[];
  index: number | null;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  pluginName: string;
}) {
  const count = screenshots.length;
  const step = useCallback(
    (delta: number) => {
      if (index === null || count === 0) return;
      onIndexChange((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  useEffect(() => {
    if (index === null || count < 2) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [count, index, step]);

  const current = index === null ? null : screenshots[index] ?? null;
  return (
    <Dialog
      open={current !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="w-[min(94vw,80rem)] max-w-[min(94vw,80rem)] gap-3">
        <DialogHeader className="sr-only">
          <DialogTitle>{`${pluginName} screenshot ${(index ?? 0) + 1} of ${count}`}</DialogTitle>
          <DialogDescription>
            {count < 2 ? "Press Escape to close." : "Use the arrow keys to move between screenshots."}
          </DialogDescription>
        </DialogHeader>
        {current === null ? null : (
          <img
            src={current}
            alt={`${pluginName} screenshot ${(index ?? 0) + 1}`}
            className="max-h-[78vh] w-full rounded-md border border-border object-contain"
          />
        )}
        {count < 2 ? null : (
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" onClick={() => step(-1)} aria-label="Previous screenshot">
              ‹
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {(index ?? 0) + 1} / {count}
            </span>
            <Button variant="outline" size="sm" onClick={() => step(1)} aria-label="Next screenshot">
              ›
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PeekOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ phase: "idle" });
  const [entries, setEntries] = useState<PeekEntryRef[] | null>(null);
  const [screenshotIndex, setScreenshotIndex] = useState<number | null>(null);

  const load = useCallback(
    async (detail: PeekOpenDetail) => {
      setState({ phase: "loading", displayName: detail.displayName });
      try {
        const known = entries ?? (await rpc.call("peek_entries", null)).entries;
        if (entries === null) setEntries(known);
        const matches = known.filter((entry) => entry.displayName === detail.displayName);
        const match =
          matches.length > 1 && detail.author !== null
            ? matches.find((entry) => entry.author === detail.author) ?? matches[0]
            : matches[0];
        if (match === undefined) {
          throw new Error(`"${detail.displayName}" is not in the plugin catalog Peek can read.`);
        }
        const { report } = await rpc.call("peek_report", {
          entryId: match.entryId,
          marketplace: match.marketplace,
        });
        setState({ phase: "ready", report });
      } catch (cause) {
        setState({
          phase: "error",
          displayName: detail.displayName,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [entries, rpc],
  );

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<PeekOpenDetail>).detail;
      if (detail === undefined || detail === null) return;
      setOpen(true);
      setScreenshotIndex(null);
      void load(detail);
    };
    window.addEventListener(PEEK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(PEEK_OPEN_EVENT, onOpen);
  }, [load]);

  const title = useMemo(() => {
    if (state.phase === "ready") return state.report.entry.displayName;
    if (state.phase === "loading" || state.phase === "error") return state.displayName;
    return "Preview";
  }, [state]);

  const description =
    state.phase === "ready" ? state.report.entry.description : "What this plugin would change if you installed it.";

  const screenshots = state.phase === "ready" ? state.report.entry.screenshots : [];

  const report = (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setScreenshotIndex(null);
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {state.phase === "loading" ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Reading the plugin without installing it…
          </p>
        ) : null}
        {state.phase === "error" ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : null}
        {state.phase === "ready" ? (
          <ReportBody report={state.report} onOpenScreenshot={setScreenshotIndex} />
        ) : null}
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      {report}
      <ScreenshotViewer
        screenshots={screenshots}
        index={screenshotIndex}
        onIndexChange={setScreenshotIndex}
        onClose={() => setScreenshotIndex(null)}
        pluginName={title}
      />
    </>
  );
}
