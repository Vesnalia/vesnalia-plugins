// Structure and media: trees, JSON, one-file diffs, image comparison, hotspots on an image,
// cited sources and entity cards. Pure logic lives in ./structure/logic.ts; styles in structure.css.
import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { Markdown, experimental_Diff as AliaDiff, experimental_copyToClipboard, useAliaNavigate } from "@vesnalia/plugin-sdk/app";
import { ArrowUpRight, Building2, ChevronRight, Link2, MapPin, Package, User } from "lucide-react";
import { z } from "zod/v4";
import { Button, LoadedView, Skeleton, clamp, cx, fmt, useStreaming } from "./kit";
import { useThreadFile, type Loaded } from "../data";
import type { ExtraGroup } from "./types";
import {
  buildTree,
  diffPath,
  diffStats,
  domainOf,
  imageSource,
  jsonCopyText,
  jsonKind,
  jsonPath,
  jsonSummary,
  parseJsonValue,
  percent,
  shortUrl,
  webUrl,
  type TreeNode,
} from "./structure/logic";

const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;

/** Child components arrive as element nodes; read one prop without trusting the shape (it may be half-streamed). */
function propsOf(node: unknown): Record<string, unknown> {
  const props = (node as { props?: unknown } | null)?.props;
  return props && typeof props === "object" ? (props as Record<string, unknown>) : {};
}
const str = (value: unknown) => (typeof value === "string" ? value : "");

/* Disclosure lists (Tree, Json): Up/Down/Home/End move between rows, Right opens or steps in, Left closes or steps out. */
function onRowKeys(event: KeyboardEvent<HTMLElement>) {
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-row]"));
  const row = event.target as HTMLButtonElement;
  const i = rows.indexOf(row);
  if (i < 0) return;
  const expanded = row.getAttribute("aria-expanded");
  const go = (next: HTMLElement | null | undefined) => {
    event.preventDefault();
    next?.focus();
  };
  switch (event.key) {
    case "ArrowDown": return go(rows[i + 1]);
    case "ArrowUp": return go(rows[i - 1]);
    case "Home": return go(rows[0]);
    case "End": return go(rows.at(-1));
    case "ArrowRight":
      if (expanded === "false") row.click();
      return expanded === "true" ? go(rows[i + 1]) : event.preventDefault();
    case "ArrowLeft":
      if (expanded === "true") {
        row.click();
        return event.preventDefault();
      }
      return go(row.closest("li")?.parentElement?.closest("li")?.querySelector<HTMLElement>("[data-row]"));
  }
}

/** A set of keys the user flipped from their default open state. */
function useFlips(): [(key: string, byDefault: boolean) => boolean, (key: string) => void] {
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const isOpen = (key: string, byDefault: boolean) => flipped.has(key) !== byDefault;
  const flip = (key: string) =>
    setFlipped((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return [isOpen, flip];
}

// ---------------------------------------------------------------- Tree

const treeItem = z.union([z.string(), z.object({ label: z.string(), children: z.array(z.any()).optional(), note: z.string().optional() })]);

const Tree = defineComponent({
  name: "Tree",
  description: 'File or concept tree: path strings ("src/a.ts"; shared folders merge) or {label, children?, note?} nodes; folders fold.',
  props: z.object({ items: z.array(treeItem) }),
  component: ({ props }) => {
    const [isOpen, flip] = useFlips();
    const nodes = buildTree(props.items);
    if (nodes.length === 0) return <div className="aliaui aliaui-structure-tree" />;
    const branch = (list: TreeNode[], depth: number): ReactNode => (
      <ul className="aliaui-structure-branch">
        {list.map((node) => {
          const open = node.children !== null && isOpen(node.key, true);
          const name = <span className={cx("aliaui-structure-name", node.mono && "aliaui-mono")}>{node.label}</span>;
          const note = node.note ? <span className="aliaui-label aliaui-structure-note">{node.note}</span> : null;
          return (
            <li key={node.key}>
              {node.children === null ? (
                <div className="aliaui-structure-row">
                  <span className="aliaui-structure-gap" />
                  {name}
                  {note}
                </div>
              ) : (
                <button type="button" data-row className="aliaui-structure-row" aria-expanded={open} onClick={() => flip(node.key)}>
                  <ChevronRight {...ICON} className="aliaui-structure-chev" />
                  {name}
                  {note}
                  {open ? null : <span className="aliaui-label">{node.children.length}</span>}
                </button>
              )}
              {open && node.children && node.children.length > 0 ? branch(node.children, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
    return (
      <div className="aliaui aliaui-structure-tree" onKeyDown={onRowKeys}>
        {branch(nodes, 0)}
      </div>
    );
  },
});

// ---------------------------------------------------------------- Json

// shortcut: shows the first 200 entries of any one array or object, raise or page it if agents send bigger values.
const JSON_CAP = 200;

function JsonLeaf({ value }: { value: unknown }) {
  const kind = jsonKind(value);
  const text = kind === "string" ? JSON.stringify(value) : kind === "null" ? "null" : String(value);
  return <span className={`aliaui-structure-v aliaui-structure-v-${kind}`}>{text}</span>;
}

const Json = defineComponent({
  name: "Json",
  description: "Collapsible JSON explorer for an inline value (object, array, or a string holding JSON); the user can copy any path or value.",
  props: z.object({ value: z.any(), label: z.string().optional() }),
  component: ({ props }) => {
    const [isOpen, flip] = useFlips();
    const [selected, setSelected] = useState<(string | number)[] | null>(null);
    const [copied, setCopied] = useState<{ what: "path" | "value"; ok: boolean } | null>(null);
    const root = parseJsonValue(props.value);
    const label = props.label?.trim() || "value";
    const selectedKey = selected ? jsonPath(selected) : null;
    const pick = (path: (string | number)[]) => {
      setSelected(path);
      setCopied(null);
    };

    const row = (key: ReactNode, value: unknown, path: (string | number)[], depth: number): ReactNode => {
      const kind = jsonKind(value);
      const id = jsonPath(path);
      const container = kind === "array" || kind === "object";
      const open = container && isOpen(id, depth < 2);
      const entries: [string | number, unknown][] = !container
        ? []
        : kind === "array"
          ? (value as unknown[]).map((v, i) => [i, v])
          : Object.entries(value as object);
      return (
        <li key={id}>
          <button
            type="button"
            data-row
            className="aliaui-structure-row"
            aria-expanded={container ? open : undefined}
            aria-current={selectedKey === id ? "true" : undefined}
            onClick={() => {
              if (container) flip(id);
              pick(path);
            }}
          >
            {container ? <ChevronRight {...ICON} className="aliaui-structure-chev" /> : <span className="aliaui-structure-gap" />}
            <span className="aliaui-structure-key aliaui-mono">{key}</span>
            {container ? (
              <span className="aliaui-label">{open ? (kind === "array" ? "[" : "{") : jsonSummary(value)}</span>
            ) : (
              <JsonLeaf value={value} />
            )}
          </button>
          {open && entries.length > 0 ? (
            <ul className="aliaui-structure-branch">
              {entries.slice(0, JSON_CAP).map(([k, v]) => row(k, v, [...path, k], depth + 1))}
              {entries.length > JSON_CAP ? (
                <li className="aliaui-label aliaui-structure-more">{fmt(entries.length - JSON_CAP)} more not shown</li>
              ) : null}
            </ul>
          ) : null}
        </li>
      );
    };

    const copy = (what: "path" | "value") => {
      if (!selected) return;
      let value: unknown = root;
      for (const s of selected) value = (value as Record<string | number, unknown>)?.[s];
      const text = what === "path" ? jsonPath(selected) : jsonCopyText(value);
      void experimental_copyToClipboard({ text })
        .catch(() => false)
        .then((ok) => setCopied({ what, ok }));
    };
    const state = (what: "path" | "value") => (copied?.what === what ? (copied.ok ? "success" : "error") : undefined);

    return (
      <div className="aliaui aliaui-structure-json">
        <div onKeyDown={onRowKeys}>
          <ul className="aliaui-structure-branch">{row(label, root, [], 0)}</ul>
        </div>
        {selected ? (
          <div className="aliaui-structure-bar">
            <code className="aliaui-mono aliaui-structure-path">{jsonPath(selected)}</code>
            <Button state={state("path")} onClick={() => copy("path")}>
              {copied?.what === "path" ? (copied.ok ? "Path copied" : "Copy failed") : "Copy path"}
            </Button>
            <Button state={state("value")} onClick={() => copy("value")}>
              {copied?.what === "value" ? (copied.ok ? "Value copied" : "Copy failed") : "Copy value"}
            </Button>
          </div>
        ) : (
          <p className="aliaui-label aliaui-structure-hint">Select a row to copy its path or value.</p>
        )}
      </div>
    );
  },
});

// ---------------------------------------------------------------- Diff

const Diff = defineComponent({
  name: "Diff",
  description: "One file's unified diff (a patch with ---/+++ and @@ hunks); language names the file type when the patch has no file headers.",
  props: z.object({ patch: z.string(), language: z.string().optional() }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const patch = props.patch ?? "";
    const path = diffPath(patch, props.language);
    const { added, removed } = diffStats(patch);
    return (
      <figure className="aliaui aliaui-structure-diff">
        <figcaption className="aliaui-structure-diffhead">
          <span className="aliaui-mono aliaui-structure-path">{path}</span>
          <span className="aliaui-label">
            <span className="aliaui-structure-added">+{fmt(added)}</span> <span className="aliaui-structure-removed">-{fmt(removed)}</span>
          </span>
        </figcaption>
        {/* A half-written patch misparses: draw it once the block is complete. */}
        {streaming ? <Skeleton lines={4} /> : patch.trim() === "" ? null : <AliaDiff patch={patch} path={path} overflow="wrap" />}
      </figure>
    );
  },
});

// ---------------------------------------------------------------- shared media

/** An image as a src the browser can show: https used as is, a thread path read as a data URL. */
function useImage(src: unknown): Loaded<string> {
  const streaming = useStreaming();
  const source = imageSource(src);
  const file = useThreadFile(source?.kind === "file" ? source.path : null, { media: true });
  if (source === null)
    return streaming ? { state: "loading" } : { state: "error", error: "Give an https image URL or a file path in this thread." };
  return source.kind === "url" ? { state: "ready", value: source.url } : file;
}

function Picture({ loaded, alt, height = 180 }: { loaded: Loaded<string>; alt: string; height?: number }) {
  return (
    <LoadedView
      loaded={loaded}
      parse={(src) => src}
      empty={{ title: "No image" }}
      errorTitle={`${alt || "The image"} could not be shown`}
      skeleton={<Skeleton height={height} />}
    >
      {(src) => <img className="aliaui-structure-img" src={src} alt={alt} draggable={false} />}
    </LoadedView>
  );
}

/** Opens http(s) through VesnALIA (its browser preference); keeps the href for copy and modified clicks. */
function WebLink({ url, className, children }: { url: URL; className?: string; children: ReactNode }) {
  const navigate = useAliaNavigate();
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (navigate.openUrl(url.href)) event.preventDefault();
  };
  return (
    <a className={cx("aliaui-structure-link", className)} href={url.href} onClick={open} rel="noreferrer">
      {children}
    </a>
  );
}

function Segmented<T extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="aliaui-structure-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="aliaui-btn" aria-pressed={o.value === value} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Compare

const CompareImage = defineComponent({
  name: "CompareImage",
  description: "One image in a Compare: src is an https URL or a thread file path.",
  props: z.object({ src: z.string(), label: z.string().optional() }),
  component: () => null,
});

type Mode = "side" | "wipe" | "blink";

function Wipe({ under, over, overLabel, underLabel, disabled }: { under: string; over: string; overLabel: string; underLabel: string; disabled: boolean }) {
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width > 0) setPos(clamp(((event.clientX - box.left) / box.width) * 100, 0, 100));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2;
    const next = { ArrowLeft: pos - step, ArrowDown: pos - step, ArrowRight: pos + step, ArrowUp: pos + step, Home: 0, End: 100 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setPos(clamp(next, 0, 100));
  };
  return (
    <div
      className="aliaui-structure-stage"
      data-dragging={dragging || undefined}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        fromPointer(event);
      }}
      onPointerMove={(event) => dragging && fromPointer(event)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      <img className="aliaui-structure-img" src={under} alt={underLabel} draggable={false} />
      <img className="aliaui-structure-img aliaui-structure-over" src={over} alt={overLabel} draggable={false} style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <div
        className="aliaui-structure-handle"
        style={{ left: `${pos}%` }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`Wipe: ${overLabel} on the left, ${underLabel} on the right`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={`${Math.round(pos)}% ${overLabel}`}
        aria-disabled={disabled || undefined}
        onKeyDown={keys}
      />
    </div>
  );
}

const Compare = defineComponent({
  name: "Compare",
  description: "Before and after, or reference against candidates: images side by side, as a wipe or a blink; the first image is the reference.",
  props: z.object({ images: z.array(CompareImage.ref) }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const [mode, setMode] = useState<Mode>("side");
    const [pick, setPick] = useState(1);
    const [showReference, setShowReference] = useState(false);
    const items = (Array.isArray(props.images) ? props.images : []).map(propsOf);
    const labels = items.map((p, i) => str(p.label).trim() || (i === 0 ? "Reference" : items.length > 2 ? `Candidate ${i}` : "Candidate"));
    // Hooks per image need a fixed count: the first eight are read, which covers any sensible comparison.
    const loaded = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => useImage(items[i]?.src));
    const count = Math.min(items.length, 8);
    if (count === 0) return <div className="aliaui aliaui-structure-compare" />;
    const candidate = clamp(pick, 1, Math.max(1, count - 1));
    const ref = loaded[0]!;
    const cand = loaded[candidate]!;
    const pair = count > 1 && ref.state === "ready" && cand.state === "ready" ? [ref.value, cand.value] : null;
    const pairFallback = (
      <div className="aliaui-structure-grid">
        <Picture loaded={ref} alt={labels[0]!} />
        <Picture loaded={cand} alt={labels[candidate]!} />
      </div>
    );
    let stage: ReactNode;
    if (mode === "side" || count < 2) {
      stage = (
        <div className="aliaui-structure-grid">
          {items.slice(0, count).map((_, i) => (
            <figure key={i} className="aliaui-structure-shot">
              <Picture loaded={loaded[i]!} alt={labels[i]!} />
              <figcaption className="aliaui-label">
                {labels[i]}
                {i === 0 && count > 1 && labels[0] !== "Reference" ? ", reference" : ""}
              </figcaption>
            </figure>
          ))}
        </div>
      );
    } else if (mode === "wipe") {
      stage = pair ? (
        <>
          <Wipe over={pair[0]!} under={pair[1]!} overLabel={labels[0]!} underLabel={labels[candidate]!} disabled={streaming} />
          <p className="aliaui-label aliaui-structure-legend">
            <span>{labels[0]}</span>
            <span>{labels[candidate]}</span>
          </p>
        </>
      ) : (
        pairFallback
      );
    } else {
      const shown = showReference ? 0 : candidate;
      stage = pair ? (
        <>
          <button type="button" className="aliaui-structure-stage aliaui-structure-flip" disabled={streaming} onClick={() => setShowReference((v) => !v)}>
            <img className="aliaui-structure-img" src={pair[showReference ? 0 : 1]} alt={labels[shown]} draggable={false} />
          </button>
          <div className="aliaui-structure-legend">
            <span className="aliaui-label" aria-live="polite">
              Showing <strong className="aliaui-structure-strong">{labels[shown]}</strong>
            </span>
            <Button disabled={streaming} onClick={() => setShowReference((v) => !v)}>
              Show {labels[showReference ? candidate : 0]}
            </Button>
          </div>
        </>
      ) : (
        pairFallback
      );
    }
    return (
      <div className="aliaui aliaui-structure-compare">
        {count > 1 ? (
          <div className="aliaui-structure-tools">
            <Segmented<Mode>
              label="Compare mode"
              value={mode}
              disabled={streaming}
              onChange={setMode}
              options={[
                { value: "side", label: "Side by side" },
                { value: "wipe", label: "Wipe" },
                { value: "blink", label: "Blink" },
              ]}
            />
            {count > 2 && mode !== "side" ? (
              <Segmented<string>
                label="Candidate"
                value={String(candidate)}
                disabled={streaming}
                onChange={(v) => setPick(Number(v))}
                options={items.slice(1, count).map((_, i) => ({ value: String(i + 1), label: labels[i + 1]! }))}
              />
            ) : null}
          </div>
        ) : null}
        {stage}
      </div>
    );
  },
});

// ---------------------------------------------------------------- Hotspots

const Hotspot = defineComponent({
  name: "Hotspot",
  description: "A numbered pin on a Hotspots image: x and y are percent across and down; text is markdown shown when selected.",
  props: z.object({ x: z.number(), y: z.number(), title: z.string(), text: z.string().optional() }),
  component: () => null,
});

const Hotspots = defineComponent({
  name: "Hotspots",
  description: "Numbered pins on an image (https URL or thread file path); selecting a pin shows its text. List points in reading order.",
  props: z.object({ image: z.string(), points: z.array(Hotspot.ref) }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const [selected, setSelected] = useState(0);
    const image = useImage(props.image);
    const points = (Array.isArray(props.points) ? props.points : []).map(propsOf).filter((p) => str(p.title) !== "");
    const current = points[clamp(selected, 0, Math.max(0, points.length - 1))];
    const active = current ? points.indexOf(current) : -1;
    return (
      <figure className="aliaui aliaui-structure-hotspots">
        <div className="aliaui-structure-canvas">
          <Picture loaded={image} alt={`Image with ${points.length} numbered points`} height={220} />
          {image.state === "ready"
            ? points.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  className="aliaui-structure-pin"
                  style={{ left: `${percent(p.x)}%`, top: `${percent(p.y)}%` }}
                  aria-pressed={i === active}
                  aria-label={`${i + 1}: ${str(p.title)}`}
                  disabled={streaming}
                  onClick={() => setSelected(i)}
                >
                  {i + 1}
                </button>
              ))
            : null}
        </div>
        {current ? (
          <figcaption className="aliaui-structure-detail" aria-live="polite">
            <span className="aliaui-head">
              <span className="aliaui-structure-num">{active + 1}</span> {str(current.title)}
            </span>
            {str(current.text) ? <Markdown content={str(current.text)} className="aliaui-structure-md" /> : null}
          </figcaption>
        ) : null}
      </figure>
    );
  },
});

// ---------------------------------------------------------------- Sources

const sourceItem = z.union([z.string(), z.object({ url: z.string(), title: z.string().optional(), note: z.string().optional() })]);

const Sources = defineComponent({
  name: "Sources",
  description: "Numbered list of cited web pages, matching [1], [2] in the text; opens them in VesnALIA's browser.",
  props: z.object({ links: z.array(sourceItem) }),
  component: ({ props }) => {
    const links = (Array.isArray(props.links) ? props.links : []).map((item) =>
      typeof item === "string" ? { url: item } : { url: str(item?.url), title: str(item?.title), note: str(item?.note) },
    );
    return (
      <ol className="aliaui aliaui-structure-sources">
        {links.map((link, i) => {
          const url = webUrl(link.url);
          const title = link.title?.trim();
          return (
            <li key={i} className="aliaui-structure-source">
              <span className="aliaui-label aliaui-structure-index">{i + 1}</span>
              <div className="aliaui-structure-sourcebody">
                {url ? (
                  <WebLink url={url}>
                    <span>{title || shortUrl(url)}</span>
                    <ArrowUpRight {...ICON} className="aliaui-structure-out" />
                  </WebLink>
                ) : (
                  <span className="aliaui-structure-bad">{title || link.url}</span>
                )}
                <span className="aliaui-label">{url ? (title ? domainOf(url) : null) : "Not a web address, so it is not linked"}</span>
                {link.note ? <span className="aliaui-label">{link.note}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    );
  },
});

// ---------------------------------------------------------------- Entity

const KINDS = {
  product: { label: "Product", Icon: Package },
  place: { label: "Place", Icon: MapPin },
  person: { label: "Person", Icon: User },
  org: { label: "Organisation", Icon: Building2 },
  link: { label: "Link", Icon: Link2 },
} as const;

const factValue = (value: unknown) =>
  typeof value === "number" ? fmt(value) : typeof value === "boolean" ? (value ? "Yes" : "No") : str(value);

const Entity = defineComponent({
  name: "Entity",
  description: "A product, place, person or organisation at a glance: facts is an object of label to value; image is an https URL or thread file path.",
  props: z.object({
    name: z.string(),
    kind: z.enum(["product", "place", "person", "org", "link", "other"]).optional(),
    image: z.string().optional(),
    facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    url: z.string().optional(),
    note: z.string().optional(),
  }),
  component: ({ props }) => {
    const image = useImage(props.image);
    const kind = props.kind && props.kind !== "other" ? KINDS[props.kind] : null;
    const facts = props.facts && typeof props.facts === "object" ? Object.entries(props.facts) : [];
    const url = webUrl(props.url);
    const name = props.name ?? "";
    return (
      <article className="aliaui aliaui-well aliaui-structure-entity">
        {props.image ? (
          <div className="aliaui-structure-thumb">
            <Picture loaded={image} alt={name} height={96} />
          </div>
        ) : null}
        <div className="aliaui-structure-entitybody">
          <header className="aliaui-structure-entityhead">
            <h3 className="aliaui-head aliaui-structure-title">{name}</h3>
            {kind ? (
              <span className="aliaui-label aliaui-structure-kind">
                <kind.Icon {...ICON} />
                {kind.label}
              </span>
            ) : null}
          </header>
          {facts.length > 0 ? (
            <dl className="aliaui-structure-facts">
              {facts.map(([label, value]) => (
                <div key={label} className="aliaui-structure-fact">
                  <dt className="aliaui-label">{label}</dt>
                  <dd>{factValue(value)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {props.note ? <Markdown content={props.note} className="aliaui-structure-md" /> : null}
          {url ? (
            <WebLink url={url} className="aliaui-structure-entitylink">
              <span>{domainOf(url)}</span>
              <ArrowUpRight {...ICON} className="aliaui-structure-out" />
            </WebLink>
          ) : null}
        </div>
      </article>
    );
  },
});

// ---------------------------------------------------------------- group

const compareExample = `root = Stack([title, cmp])
title = TextContent("Hero image export: the new build drops colour")
cmp = Compare([before, after])
before = CompareImage("https://picsum.photos/id/1015/760/480", "Approved, 2026-10-10")
after = CompareImage("https://picsum.photos/id/1015/760/480?grayscale", "This build, 2026-10-12")`;

const hotspotsExample = `root = Stack([intro, bike])
intro = TextContent("Select a number to see what each part does.")
bike = Hotspots("https://upload.wikimedia.org/wikipedia/commons/4/41/Left_side_of_Flying_Pigeon.jpg", [p1, p2, p3, p4])
p1 = Hotspot(29, 28, "Basket", "Mounted on the fork, so it turns with the front wheel.")
p2 = Hotspot(65, 20, "Saddle", "Sprung leather saddle: set the height so your knee stays **slightly bent** at the bottom of each stroke.")
p3 = Hotspot(54, 69, "Chain guard", "A full case that keeps trousers out of the chain and the chain out of the rain.")
p4 = Hotspot(79, 84, "Kickstand", "Holds the bike upright when parked; flip it up before riding.")`;

export const structureGroup: ExtraGroup = {
  name: "Structure and media",
  notes: [
    "Images (Compare, Hotspots, Entity) take an https URL or a path to a file in this thread, such as a screenshot you saved.",
    "Child items are calls: Compare([CompareImage(src, label)]), Hotspots(image, [Hotspot(x, y, title, text)]).",
  ],
  components: [Tree, Json, Diff, Compare, CompareImage, Hotspots, Hotspot, Sources, Entity],
  examples: {
    Tree: `root = Stack([title, files])
title = TextContent("Files the change touches")
files = Tree(["src/worker/research.ts", "src/worker/index.ts", "src/research/forms.ts", "src/research/page.ts", {label: "migrations", note: "new", children: ["0004_answers.sql"]}])`,
    Json: `root = Stack([event])
event = Json({id: "evt_3PqK2v", type: "invoice.paid", livemode: false, created: 1791580000, data: {amount_paid: 4900, currency: "eur", customer: "cus_Q8x1", lines: [{description: "Pro plan, 1 seat", amount: 4900}], discount: null}, "request id": "req_7Ab9"}, "Webhook event")`,
    Diff: `root = Stack([title, fix])
title = TextContent("The fix: a missing email no longer throws")
fix = Diff("--- a/src/api/users.ts\\n+++ b/src/api/users.ts\\n@@ -40,3 +40,3 @@\\n export function display(user: User) {\\n-  return user.email.toLowerCase();\\n+  return (user.email ?? \\"\\").toLowerCase();\\n }")`,
    Compare: compareExample,
    CompareImage: compareExample,
    Hotspots: hotspotsExample,
    Hotspot: hotspotsExample,
    Sources: `root = Stack([text, cites])
text = TextContent("Rules for lights after dark differ by country [1]; the UK rules are set out in full in the Highway Code [2].")
cites = Sources([{url: "https://en.wikipedia.org/wiki/Bicycle_lighting", title: "Bicycle lighting", note: "Overview of the rules in several countries"}, {url: "https://www.gov.uk/guidance/the-highway-code/rules-for-cyclists-59-to-82", title: "The Highway Code: rules for cyclists (59 to 82)", note: "Rule 60 covers lights and reflectors"}, "https://www.cyclinguk.org/article/cycling-guide/lights"])`,
    Entity: `root = Stack([intro, bike])
intro = TextContent("A sample product card.")
bike = Entity("Flying Pigeon PA-02", "product", "https://upload.wikimedia.org/wikipedia/commons/4/41/Left_side_of_Flying_Pigeon.jpg", {Maker: "Flying Pigeon, Tianjin", "Made since": "1950", Frame: "Steel, 28 inch wheels", Gears: 1}, "https://en.wikipedia.org/wiki/Flying_Pigeon", "A single-speed roadster, one of the most produced bicycle models ever.")`,
  },
};
