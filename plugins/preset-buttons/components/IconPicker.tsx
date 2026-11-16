// The icon picker: browse and select an icon for a preset button.
//
// It is deliberately self-contained — no host dialog, popover, or menu
// dependency — because the host exposes no generic overlay primitive to a
// plugin, and the settings editor is a plain page section, not hosted chrome.
// So the picker manages its own open/armed state and renders an overlay
// absolutely positioned over the trigger (whose wrapper the row already
// positions relatively). Clicking outside or hitting Escape closes it; the
// arrow keys move a highlight, Enter commits it, and selection is committed
// synchronously via the caller's `onSelect` so a settings save can pick it up
// straight away.

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ICON_GROUPS, findIcon, type IconEntry } from "@/lib/icons";

/** Renders one registered icon glyph, honouring `className` for size and tint. */
function IconGlyph({ entry, className }: { entry: IconEntry; className?: string }) {
  const Comp = entry.component;
  return <Comp className={className} />;
}

type IconPickerProps = {
  value: string;
  onSelect: (name: string) => void;
  disabled?: boolean;
};

export function IconPicker({ value, onSelect, disabled }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset search and refocus whenever the picker (re)opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      searchRef.current?.focus();
    }
  }, [open]);

  // Click outside and Escape close the overlay.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The flat list of visible icons, grouped for rendering. An empty search
  // shows the whole pool; otherwise a filtered list. Matching rides on the
  // friendly `baseName`/`label`, never the prefixed registry key, so typing
  // "zap" finds `pb-Zap` without the user needing to know the prefix.
  const { groups, flat } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const groups: { group: string; icons: IconEntry[] }[] = [];
    const flat: IconEntry[] = [];
    for (const group of ICON_GROUPS) {
      const icons =
        needle === ""
          ? group.icons
          : group.icons.filter(
              (icon) =>
                icon.baseName.toLowerCase().includes(needle) ||
                icon.label.toLowerCase().includes(needle),
            );
      if (icons.length > 0) groups.push({ group: group.group, icons });
      flat.push(...icons);
    }
    return { groups, flat };
  }, [query]);

  // Clamp the highlight to a valid position whenever results change.
  useEffect(() => {
    setIndex((current) => (flat.length === 0 ? 0 : Math.min(current, flat.length - 1)));
  }, [flat.length]);

  const commit = (entry: IconEntry) => {
    onSelect(entry.name);
    setOpen(false);
  };

  const current = findIcon(value) ?? {
    name: value,
    baseName: value,
    label: value,
    group: "",
    component: ({ className }: { className?: string }) => (
      <span data-icon-root className={className} />
    ),
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    if (flat.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((i) => (i + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((i) => (i - 1 + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(flat[index]!);
    }
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0 rounded-md"
        disabled={disabled}
        aria-haspopup="grid"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        aria-label={`Choose icon${value ? ` (currently ${current.baseName})` : ""}`}
        onClick={() => setOpen((current) => !current)}
      >
        <IconGlyph entry={current} className="size-4" />
      </Button>

      {open ? (
        <div
          role="grid"
          aria-label="Choose an icon"
          className="absolute left-0 top-full z-40 mt-1 w-72 max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        >
          <div className="border-b border-border p-2">
            <input
              ref={searchRef}
              type="text"
              value={query}
              placeholder="Search icons…"
              aria-label="Search icons"
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
              onChange={(event) => {
                setQuery(event.target.value);
                setIndex(0);
              }}
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {flat.length === 0 ? (
              <p className="px-1 py-3 text-center text-sm text-muted-foreground">
                No icons match “{query}”.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.group} className="mb-2">
                  <p className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.group}
                  </p>
                  <div className="grid grid-cols-6 gap-1">
                    {group.icons.map((icon) => {
                      const position = flat.indexOf(icon);
                      const isSelected = icon.name === value;
                      const isHighlighted = position === index;
                      return (
                        <button
                          key={icon.name}
                          type="button"
                          role="gridcell"
                          aria-selected={isHighlighted}
                          aria-label={icon.label}
                          title={icon.label}
                          onClick={() => commit(icon)}
                          onMouseEnter={() => setIndex(position)}
                          className={cn(
                            "flex aspect-square items-center justify-center rounded-md border text-foreground focus-visible:outline-none",
                            isSelected && !isHighlighted
                              ? "border-primary bg-primary/10"
                              : "border-transparent",
                            isHighlighted
                              ? "border-primary bg-primary text-primary-foreground"
                              : "hover:bg-state-hover",
                          )}
                        >
                          <IconGlyph entry={icon} className="size-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
