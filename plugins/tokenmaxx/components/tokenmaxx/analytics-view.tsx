import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PROVIDER_LABEL, formatCount, formatTokens, formatUsd } from "./format";
import type { Timeframe, Tokens } from "./types";

const TIMEFRAME_LABEL: Record<string, string> = {
  "1h": "1 hour",
  "5h": "5 hours",
  "24h": "24 hours",
  "7d": "7 days",
  "31d": "31 days",
};

const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <div className="text-muted-foreground text-xs">{label}</div>
    <div className="mt-0.5 font-semibold text-lg tabular-nums">{value}</div>
    {hint === undefined ? null : <div className="text-muted-foreground text-xs">{hint}</div>}
  </div>
);

const BucketChart = ({ timeframe }: { timeframe: Timeframe }) => {
  const peak = timeframe.buckets.reduce((highest, value) => Math.max(highest, value), 0);
  const spanMs = timeframe.bucketMs * timeframe.buckets.length;

  if (peak === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No tokens recorded in the last {TIMEFRAME_LABEL[timeframe.key] ?? timeframe.key}.
      </p>
    );
  }

  return (
    <figure className="space-y-1.5">
      <div
        className="flex h-24 items-end gap-px"
        role="img"
        aria-label={`Token throughput over the last ${TIMEFRAME_LABEL[timeframe.key] ?? timeframe.key}, peaking at ${formatTokens(peak)} tokens per bucket.`}
      >
        {timeframe.buckets.map((value, index) => {
          const agoMs = (timeframe.buckets.length - index) * timeframe.bucketMs;
          const minutes = Math.round(agoMs / 60_000);
          return (
            <div
              key={`${timeframe.key}-${index}`}
              className="min-w-px flex-1 rounded-t-[2px] bg-primary/70 transition-[height] duration-500 ease-out motion-reduce:transition-none"
              style={{ height: `${Math.max(2, (value / peak) * 100)}%` }}
              title={`${formatCount(value)} tokens · ${minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`} ago`}
            />
          );
        })}
      </div>
      <figcaption className="flex justify-between text-muted-foreground text-xs">
        <span>{spanMs >= 86_400_000 ? `${Math.round(spanMs / 86_400_000)}d ago` : `${Math.round(spanMs / 3_600_000)}h ago`}</span>
        <span>peak {formatTokens(peak)} / bucket</span>
        <span>now</span>
      </figcaption>
    </figure>
  );
};

const CostSplit = ({ timeframe }: { timeframe: Timeframe }) => {
  const parts = [
    { cost: timeframe.costInput, label: "Input", tokens: timeframe.totalInput },
    { cost: timeframe.costOutput, label: "Output", tokens: timeframe.totalOutput },
    { cost: timeframe.costCached, label: "Cache read", tokens: timeframe.totalCached },
    {
      cost: timeframe.costCacheCreation,
      label: "Cache write",
      tokens: timeframe.totalCacheCreation,
    },
  ];
  const peak = parts.reduce((highest, part) => Math.max(highest, part.cost), 0);

  return (
    <div className="space-y-2">
      {parts.map((part) => (
        <div key={part.label} className="space-y-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">{part.label}</span>
            <span className="tabular-nums">
              {formatTokens(part.tokens)} · {formatUsd(part.cost)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${peak === 0 ? 0 : (part.cost / peak) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export const AnalyticsView = ({ tokens }: { tokens: Tokens | null }) => {
  const [selected, setSelected] = useState("24h");

  if (tokens === null || tokens.timeframes.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          No token analytics yet. tokenmaxx counts tokens as responses stream through the proxy, so
          run codex or claude once and this fills in.
        </CardContent>
      </Card>
    );
  }

  const timeframe =
    tokens.timeframes.find((entry) => entry.key === selected) ?? tokens.timeframes[0];
  if (timeframe === undefined) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Analytics timeframe">
        {tokens.timeframes.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={entry.key === timeframe.key}
            onClick={() => setSelected(entry.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              entry.key === timeframe.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {TIMEFRAME_LABEL[entry.key] ?? entry.key}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Tokens"
          value={formatTokens(timeframe.totalTokens)}
          hint={`${formatCount(timeframe.totalTokens)} exact`}
        />
        <Stat
          label="Cost at API list prices"
          value={formatUsd(timeframe.costUsd)}
          hint="What this traffic would have cost on API pricing"
        />
        <Stat label="Right now" value={`${formatTokens(tokens.nowPerHour)}/h`} />
        <Stat label="Peak" value={`${formatTokens(timeframe.peakPerHour)}/h`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Throughput</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <BucketChart timeframe={timeframe} />
          <CostSplit timeframe={timeframe} />
        </CardContent>
      </Card>

      {timeframe.byProvider.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle>By provider</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {timeframe.byProvider.map((entry) => (
              <div key={entry.provider} className="rounded-lg border border-border p-3">
                <div className="font-medium text-sm">{PROVIDER_LABEL[entry.provider]}</div>
                <div className="mt-1 flex items-baseline justify-between text-sm tabular-nums">
                  <span>{formatTokens(entry.tokens)} tokens</span>
                  <span className="text-muted-foreground">{formatUsd(entry.costUsd)}</span>
                </div>
                <div className="mt-1 text-muted-foreground text-xs tabular-nums">
                  in {formatTokens(entry.input)} · out {formatTokens(entry.output)} · cache read{" "}
                  {formatTokens(entry.cached)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {timeframe.models.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle>By model</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Cache read</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...timeframe.models]
                  .sort((left, right) => right.costUsd - left.costUsd)
                  .map((model) => (
                    <TableRow key={`${model.provider}-${model.model}`}>
                      <TableCell className="font-medium">
                        {model.model}
                        <span className="ml-2 text-muted-foreground text-xs">
                          {PROVIDER_LABEL[model.provider]}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatTokens(model.input)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatTokens(model.output)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatTokens(model.cached)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatUsd(model.costUsd)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
