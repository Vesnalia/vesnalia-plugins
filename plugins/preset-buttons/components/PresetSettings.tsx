import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  useRealtime,
  useRpc,
  type ExperimentalProviderModelPickerValue,
} from "@vesnalia/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import { BUILT_IN_SETS, type Preset } from "../lib/presets";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IconPicker } from "@/components/IconPicker";
import { findIcon } from "@/lib/icons";

const PRESETS_CHANGED = "presets-changed";
const MAX_PRESETS = 8;

type ActivePresets = {
  setName: string;
  isCustom: boolean;
  presets: Preset[];
  warning: string | null;
};

function copyPresets(presets: readonly Preset[]): Preset[] {
  return presets.map((preset) => ({ ...preset }));
}

/**
 * RPC inputs must be JSON values. Optional TypeScript properties may be
 * absent, but they may not be present with `undefined` as their value.
 */
function jsonPreset(preset: Preset): Preset {
  return {
    id: preset.id,
    label: preset.label,
    icon: preset.icon,
    providerId: preset.providerId,
    model: preset.model,
    ...(preset.reasoningLevel === undefined
      ? {}
      : { reasoningLevel: preset.reasoningLevel }),
    ...(preset.serviceTier === undefined
      ? {}
      : { serviceTier: preset.serviceTier }),
    ...(preset.permissionMode === undefined
      ? {}
      : { permissionMode: preset.permissionMode }),
  };
}

function pickerValue(preset: Preset): ExperimentalProviderModelPickerValue {
  return {
    providerId: preset.providerId,
    model: preset.model,
    reasoningLevel: preset.reasoningLevel ?? "medium",
    ...(preset.serviceTier === undefined
      ? {}
      : { serviceTier: preset.serviceTier }),
  };
}

type PresetEditorRowProps = {
  preset: Preset;
  index: number;
  count: number;
  pending: boolean;
  onChange(next: Preset): void;
  onMove(direction: -1 | 1): void;
  onRemove(): void;
};

function PresetEditorRow({
  preset,
  index,
  count,
  pending,
  onChange,
  onMove,
  onRemove,
}: PresetEditorRowProps) {
  return (
    <li className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
          {index + 1}
        </span>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Button label</span>
          <input
            type="text"
            value={preset.label}
            maxLength={24}
            disabled={pending}
            onChange={(event) => onChange({ ...preset, label: event.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            placeholder="Button label"
          />
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={pending || index === 0}
            aria-label={`Move ${preset.label || `button ${index + 1}`} up`}
            onClick={() => onMove(-1)}
          >
            ↑
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={pending || index === count - 1}
            aria-label={`Move ${preset.label || `button ${index + 1}`} down`}
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-destructive"
            disabled={pending || count === 1}
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Button icon
        </span>
        <span className="flex items-center gap-2">
          <IconPicker
            value={preset.icon}
            disabled={pending}
            onSelect={(name) => onChange({ ...preset, icon: name })}
          />
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground">
            {findIcon(preset.icon)?.baseName ?? preset.icon}
          </span>
        </span>
      </label>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Provider, model, and reasoning
        </p>
        <ProviderModelPicker
          value={pickerValue(preset)}
          disabled={pending}
          className="w-full"
          onChange={(next) => {
            const { serviceTier: _previousServiceTier, ...withoutServiceTier } =
              preset;
            onChange({
              ...withoutServiceTier,
              providerId: next.providerId,
              model: next.model,
              reasoningLevel: next.reasoningLevel,
              ...(next.serviceTier === undefined
                ? {}
                : { serviceTier: next.serviceTier }),
            });
          }}
        />
      </div>
    </li>
  );
}

export function PresetSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<ActivePresets | null>(null);
  const [draft, setDraft] = useState<Preset[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const refetch = useCallback(() => {
    rpc.call("presets_get").then(
      (next) => {
        setState(next);
        if (!dirtyRef.current) setDraft(copyPresets(next.presets));
        setFailure(null);
      },
      (cause: unknown) => {
        setFailure(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }, [rpc]);

  useEffect(refetch, [refetch]);
  useRealtime(PRESETS_CHANGED, refetch);

  const choose = async (label: string) => {
    setPending(true);
    try {
      const result = await rpc.call("presets_set", { label });
      setState(result);
      setDraft(copyPresets(result.presets));
      dirtyRef.current = false;
      setDirty(false);
      setFailure(null);
      toast.success(`Preset set: ${result.setName}`);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const update = (index: number, preset: Preset) => {
    setDraft((current) =>
      current?.map((item, itemIndex) => (itemIndex === index ? preset : item)) ?? null,
    );
    dirtyRef.current = true;
    setDirty(true);
  };

  const move = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      if (current === null) return null;
      const next = [...current];
      const target = index + direction;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    dirtyRef.current = true;
    setDirty(true);
  };

  const remove = (index: number) => {
    setDraft((current) => current?.filter((_, itemIndex) => itemIndex !== index) ?? null);
    dirtyRef.current = true;
    setDirty(true);
  };

  const add = () => {
    setDraft((current) => {
      if (current === null || current.length >= MAX_PRESETS) return current;
      const source = current.at(-1) ?? BUILT_IN_SETS[0]!.presets[0]!;
      return [
        ...current,
        {
          ...source,
          id: `preset-${Date.now()}`,
          label: `Preset ${current.length + 1}`,
        },
      ];
    });
    dirtyRef.current = true;
    setDirty(true);
  };

  const reset = () => {
    if (state === null) return;
    setDraft(copyPresets(state.presets));
    dirtyRef.current = false;
    setDirty(false);
    setFailure(null);
  };

  const save = async () => {
    if (draft === null) return;
    if (draft.some((preset) => preset.label.trim() === "")) {
      setFailure("Every preset button needs a label.");
      return;
    }
    if (draft.some((preset) => preset.icon.trim() === "")) {
      setFailure("Every preset button needs an icon name.");
      return;
    }
    setPending(true);
    try {
      const result = await rpc.call("presets_save_custom", {
        presets: draft.map(jsonPreset),
      });
      setState(result);
      setDraft(copyPresets(result.presets));
      dirtyRef.current = false;
      setDirty(false);
      setFailure(null);
      toast.success("Custom preset buttons saved", {
        description: "Open New thread to use them immediately.",
      });
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-5">
      {state === null || draft === null ? (
        <p className="text-sm text-muted-foreground">Loading presets…</p>
      ) : (
        <>
          {state.warning === null ? null : (
            <p
              role="alert"
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-destructive"
            >
              {state.warning}
            </p>
          )}

          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Starting sets
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Active: <span className="text-foreground">{state.setName}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {BUILT_IN_SETS.map((set) => (
                <Button
                  key={set.id}
                  type="button"
                  size="sm"
                  variant={state.setName === set.label ? "default" : "outline"}
                  className={cn(
                    "h-8 shrink-0",
                    state.setName === set.label && "pointer-events-none",
                  )}
                  disabled={pending}
                  aria-label={`${set.label}. ${set.description}`}
                  onClick={() => void choose(set.label)}
                >
                  {set.label.split(" — ")[0]}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Button editor</p>
                <p className="text-xs text-muted-foreground">
                  {draft.length} of {MAX_PRESETS} buttons
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || draft.length >= MAX_PRESETS}
                onClick={add}
              >
                Add button
              </Button>
            </div>

            <ol className="space-y-2">
              {draft.map((preset, index) => (
                <PresetEditorRow
                  key={preset.id}
                  preset={preset}
                  index={index}
                  count={draft.length}
                  pending={pending}
                  onChange={(next) => update(index, next)}
                  onMove={(direction) => move(index, direction)}
                  onRemove={() => remove(index)}
                />
              ))}
            </ol>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending || !dirty}
                onClick={reset}
              >
                Discard changes
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={pending || !dirty}
                onClick={() => void save()}
              >
                {pending ? "Saving…" : "Save as my presets"}
              </Button>
            </div>
          </div>
        </>
      )}

      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
    </div>
  );
}
