import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useRpc } from "@vesnalia/plugin-sdk/app";
import type { ExperimentalThreadActionTabProps, JsonValue } from "@vesnalia/plugin-sdk/app";
import type { rpcContract, SearchHitResult, SearchResult } from "../server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchStore } from "../lib/search-store";

const DEBOUNCE_MS = 200;

function initialQuery(params: JsonValue | null): string {
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const query = params.query;
    if (typeof query === "string") return query.slice(0, 500);
  }
  return "";
}

function Toggle({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "size-7 font-mono text-xs text-muted-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </Button>
  );
}

function HitRow({
  hit,
  active,
  onSelect,
}: {
  hit: SearchHitResult;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          active && "bg-accent",
        )}
      >
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {hit.role === "user" ? "You" : "Assistant"}
        </span>
        <span className="line-clamp-2 break-words">
          <span className="text-muted-foreground">{hit.before}</span>
          <mark className="rounded-sm bg-yellow-400/40 text-foreground">{hit.match}</mark>
          <span className="text-muted-foreground">{hit.after}</span>
        </span>
      </button>
    </li>
  );
}

export function SearchPanel({
  threadId,
  params,
}: ExperimentalThreadActionTabProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [query, setQuery] = useState(() => initialQuery(params));
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // -1 until the user picks a hit; new results never move the chat on their own.
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  // Paint highlights immediately as the user types; the hit list follows.
  useEffect(() => {
    searchStore.set({ query, caseSensitive, regex });
  }, [query, caseSensitive, regex]);
  useEffect(() => () => searchStore.clear(), []);

  useEffect(() => {
    const trimmed = query;
    if (trimmed.length === 0) {
      requestId.current += 1;
      setResult(null);
      setError(null);
      setLoading(false);
      setCursor(-1);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      rpc
        .call("search", { threadId, query: trimmed, caseSensitive, regex })
        .then(
          (next) => {
            if (id !== requestId.current) return;
            searchStore.setRowOrder(next.rowOrder);
            setResult(next);
            setError(null);
            setCursor(-1);
            searchStore.set({ current: null });
          },
          (cause: unknown) => {
            if (id !== requestId.current) return;
            setError(cause instanceof Error ? cause.message : String(cause));
          },
        )
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [rpc, threadId, query, caseSensitive, regex]);

  const hits = useMemo(() => result?.hits ?? [], [result]);

  const goTo = useCallback(
    (index: number) => {
      if (hits.length === 0) return;
      const wrapped = ((index % hits.length) + hits.length) % hits.length;
      setCursor(wrapped);
      const hit = hits[wrapped]!;
      searchStore.requestJump({ rowId: hit.rowId, topRowId: hit.topRowId, index: hit.index });
    },
    [hits],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goTo(event.shiftKey ? cursor - 1 : cursor + 1);
    } else if (event.key === "Escape" && query.length > 0) {
      event.preventDefault();
      setQuery("");
    }
  };

  const summary = (() => {
    if (query.length === 0) return "Type to search this chat.";
    if (result === null) return loading ? "Searching…" : "";
    if (result.invalidRegex) return "Invalid regular expression.";
    if (result.totalMatches === 0) {
      return result.truncated ? "No matches in searched history (search incomplete)." : "No matches.";
    }
    const position = cursor >= 0 ? `${cursor + 1} of ` : "";
    const messages = `${result.matchedMessages} message${result.matchedMessages === 1 ? "" : "s"}`;
    return `${position}${result.totalMatches} match${result.totalMatches === 1 ? "" : "es"} in ${messages}${result.truncated ? " (results truncated)" : ""}`;
  })();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Find in chat"
            aria-label="Find in chat"
            className="pl-8"
          />
        </div>
        <Toggle active={caseSensitive} label="Match case" onClick={() => setCaseSensitive((value) => !value)}>
          Aa
        </Toggle>
        <Toggle active={regex} label="Use regular expression" onClick={() => setRegex((value) => !value)}>
          .*
        </Toggle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Previous match"
          disabled={hits.length === 0}
          onClick={() => goTo(cursor - 1)}
        >
          <Icon name="ChevronLeft" className="size-4 rotate-90" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Next match"
          disabled={hits.length === 0}
          onClick={() => goTo(cursor + 1)}
        >
          <Icon name="ChevronRight" className="size-4 rotate-90" />
        </Button>
      </div>
      <p role="status" className="px-3 py-1.5 text-xs text-muted-foreground">
        {error ?? summary}
      </p>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1 pb-2">
        {hits.map((hit, index) => (
          <HitRow
            key={`${hit.rowId}:${hit.index}`}
            hit={hit}
            active={index === cursor}
            onSelect={() => goTo(index)}
          />
        ))}
      </ul>
    </div>
  );
}
