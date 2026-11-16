// The preset strip.
//
// Position and capability pull in opposite directions here, and this component
// is how they are reconciled:
//
//   * POSITION. The buttons sit in the composer's bottom action row on wider
//     screens and above the prompt form on phones — host DOM, and no plugin
//     slot renders in either location.
//
//   * CAPABILITY. Applying a preset needs `useComposer()`, which is only
//     available to a component the host mounts inside a composer. A content
//     script has the DOM but not that React context.
//
// So the host mounts this component as a composer banner (which supplies the
// context), and the component renders its UI through a portal into a container
// it moves between those two locations. The banner's own DOM position stays a hidden
// marker (see `anchorRef`) rather than empty: with more than one composer on
// the page at once — e.g. this plugin's own strip on the page behind the Quick
// Thread plugin's dialog, which embeds a second one — that marker is what lets
// each instance find *its own* composer's anchors instead of colliding on
// whichever one a plain `document.querySelector` happens to hit first.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  experimental_Icon as Icon,
  useComposer,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import type { Preset } from "../lib/presets";
import { cn } from "../lib/utils";

/** The channel server.ts publishes on when the configured set changes. */
const PRESETS_CHANGED = "presets-changed";

type ActivePresets = {
  setName: string;
  isCustom: boolean;
  presets: Preset[];
  warning: string | null;
};

/** BB's composer trigger for provider, model and reasoning — the strip's left anchor. */
const MODEL_TRIGGER_SELECTOR = 'button[aria-label*="Provider, model" i]';

/**
 * The Prompt Enhancer plugin's own action group, when that plugin is
 * installed — the strip's right anchor. Absent entirely when it is not.
 */
const ENHANCER_GROUP_SELECTOR = '[aria-label="Prompt enhancer"]';

/**
 * Wraps every composer instance, exactly one per instance — including the
 * banner slot, not just the `<form data-promptbox>` further inside it (that
 * one sits three levels below a banner's own DOM position, so it cannot be
 * reached with `.closest()` from here; verified live against the running
 * host, not assumed from source). Scoping every query to the nearest one of
 * these is what keeps this component from colliding with a *different*
 * composer's anchors when more than one is on the page at once — e.g. the
 * background thread still mounted behind the Quick Thread plugin's dialog,
 * which embeds a second `new-thread` composer. An unscoped
 * `document.querySelector` finds whichever composer happens to come first in
 * the DOM, so two PresetStrip instances would both grab the same trigger: one
 * composer ends up with a doubled-up strip, the other with none.
 */
const COMPOSER_ROOT_SELECTOR = "[data-app-composer]";
const PROMPT_FORM_SELECTOR = "form[data-promptbox]";
const PHONE_QUERY = "(max-width: 768px)";

/** Long enough to cover the composer's own re-render after we apply a preset. */
const SELF_INFLICTED_CHANGE_MS = 2000;

const BUTTON_CLASS = cn(
  // 32px tall on a fine pointer, 36px on a coarse one: comfortably tappable
  // without pushing the footer row taller than BB's own controls beside it.
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border",
  "bg-transparent px-2 text-xs font-medium text-muted-foreground",
  "transition-colors duration-150 hover:duration-0 hover:bg-state-hover hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-50",
  "aria-pressed:border-primary aria-pressed:bg-state-active aria-pressed:text-foreground",
  "max-md:pointer-coarse:h-9 max-md:pointer-coarse:px-2.5",
);

/**
 * The buttons in a single, never-wrapping row. Every button already carries
 * `shrink-0` (see BUTTON_CLASS), so this never shrinks or drops to a second
 * line — the model trigger is the one built to give way (it already
 * truncates its own label under real constraint), not this strip.
 */
const STRIP_CLASS = cn(
  "flex flex-nowrap items-center gap-1",
  "max-md:flex-wrap max-md:justify-center max-md:pointer-coarse:gap-1.5",
);

/** One-line summary used for the button's tooltip and accessible name. */
function describePreset(preset: Preset): string {
  const parts = [preset.providerId, preset.model];
  if (preset.reasoningLevel !== undefined) parts.push(preset.reasoningLevel);
  if (preset.serviceTier !== undefined) parts.push(`${preset.serviceTier} tier`);
  if (preset.permissionMode !== undefined) parts.push(preset.permissionMode);
  return `${preset.label} — ${parts.join(" · ")}`;
}

export function PresetStrip() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const [state, setState] = useState<ActivePresets | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // A detached node is a valid portal target, so the UI can render before the
  // host's row exists. The effect below is what puts it in the document.
  //
  // On wider screens, `shrink-0` + `ml-auto` holds its full natural size (never
  // shrinks, never wraps) and pushes itself flush against the right edge of
  // the model-trigger's own flex row. The `ml-auto` is what makes that
  // right edge — not the model trigger's own varying width — the stable
  // reference point: when provider/model text gets longer or shorter, the
  // trigger's box resizes (it already truncates its own label rather than
  // overflow), but the auto margin just eats or gives back that difference,
  // so the strip (and the Prompt Enhancer icon right after it) never moves.
  const [portalHost] = useState(() => {
    const host = document.createElement("div");
    host.className = "ml-auto flex shrink-0 items-center";
    return host;
  });
  // Rendered in this instance's own natural banner position (never portalled),
  // purely so `.closest(COMPOSER_ROOT_SELECTOR)` can find *this* composer.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const appliedAt = useRef(0);

  const refetch = useCallback(() => {
    rpc.call("presets_get").then(setState, (cause: unknown) => {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    });
  }, [rpc]);

  useEffect(refetch, [refetch]);
  // A settings write anywhere — the settings UI, `bb plugin config`, the CLI —
  // republishes here, so the four buttons change without a reload.
  useRealtime(PRESETS_CHANGED, refetch);

  // On phones, place the strip before this composer's prompt form, with room
  // between the buttons and the input. On wider screens, keep it in the footer
  // between the model trigger and Prompt Enhancer icon.
  //
  // Both live in the same action-row group as siblings, so the model trigger's
  // own parent is the insertion point. Inserting before the enhancer (rather
  // than simply appending after the trigger) is what keeps the strip pinned
  // between the two even if the host or another plugin adds something else to
  // that group later. Without an enhancer installed, the strip lands right
  // after the model trigger — still the same DOM position, just with no
  // right-hand neighbor to sit before yet. (The strip's *visual* stability —
  // staying flush right regardless of the model trigger's width — comes from
  // `ml-auto` on the portal host above, not from this DOM position.)
  useEffect(() => {
    const sync = () => {
      const scopeRoot = anchorRef.current?.closest<HTMLElement>(COMPOSER_ROOT_SELECTOR);
      if (scopeRoot == null) return;

      if (window.matchMedia(PHONE_QUERY).matches) {
        const form = scopeRoot.querySelector<HTMLElement>(PROMPT_FORM_SELECTOR);
        if (form == null || form.parentElement == null) return;
        portalHost.className = "mb-2 flex w-full justify-center";
        if (portalHost.parentElement !== form.parentElement || portalHost.nextElementSibling !== form) {
          form.parentElement.insertBefore(portalHost, form);
        }
        return;
      }

      portalHost.className = "ml-auto flex shrink-0 items-center";

      const modelTrigger = scopeRoot.querySelector<HTMLElement>(MODEL_TRIGGER_SELECTOR);
      const group = modelTrigger?.parentElement;
      if (modelTrigger == null || group == null) return;

      const enhancer = scopeRoot.querySelector<HTMLElement>(ENHANCER_GROUP_SELECTOR);
      // Only trust the enhancer as the right anchor when it shares the model
      // trigger's own row — otherwise it belongs to some other composer.
      const anchor = enhancer?.parentElement === group ? enhancer : null;

      const inPlace =
        portalHost.parentElement === group &&
        (anchor == null || portalHost.nextElementSibling === anchor);
      if (inPlace) return;

      group.insertBefore(portalHost, anchor ?? modelTrigger.nextSibling);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      portalHost.remove();
    };
  }, [portalHost]);

  // Pressing a button is not the only way the harness can change: the model and
  // reasoning pickers above are the user's own controls. Watch the trigger so a
  // manual change drops the highlight — an unknown state, never a wrong claim.
  // Keyed on the resolved set so the observer attaches once the strip is live.
  // Scoped through this instance's own composer root for the same reason the
  // position effect is: an unscoped lookup can watch a different composer's
  // trigger when more than one is mounted at once.
  useEffect(() => {
    const scopeRoot = anchorRef.current?.closest<HTMLElement>(COMPOSER_ROOT_SELECTOR);
    const trigger = scopeRoot?.querySelector(MODEL_TRIGGER_SELECTOR);
    if (trigger == null) return;
    const observer = new MutationObserver(() => {
      if (Date.now() - appliedAt.current < SELF_INFLICTED_CHANGE_MS) return;
      setActiveId(null);
    });
    observer.observe(trigger, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [state]);

  const presets = state?.presets ?? [];

  const apply = async (preset: Preset) => {
    setApplyingId(preset.id);
    appliedAt.current = Date.now();
    try {
      const settled = await composer.experimental_setSelection({
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
      });
      setActiveId(preset.id);
      setFailure(null);
      // The composer reconciles against the live catalogue, so a preset whose
      // model the provider no longer lists lands somewhere else. Say so rather
      // than let the highlight imply the request was honoured exactly.
      if (settled.model !== undefined && settled.model !== preset.model) {
        toast.warning(`${preset.label} adjusted`, {
          description: `The composer reconciled this preset to ${settled.providerId ?? "?"} · ${settled.model}.`,
        });
      }
    } catch (cause) {
      setActiveId(null);
      toast.error(`${preset.label} could not be applied`, {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setApplyingId(null);
    }
  };

  const stripLabel =
    state === null
      ? null
      : state.warning === null
        ? `Presets: ${state.setName}`
        : `Presets: ${state.setName}. ${state.warning}`;

  // The anchor renders unconditionally, in this instance's own natural banner
  // position, so the effects above can find this composer's root as soon as
  // this component mounts — even before the presets have loaded. The portal
  // host is already the flex row, so the strip and the warning glyph render
  // as its direct children rather than nested one deeper.
  return (
    <>
      <span ref={anchorRef} aria-hidden className="hidden" />
      {state !== null &&
        createPortal(
          <>
            <div className={STRIP_CLASS} role="group" aria-label={stripLabel ?? undefined}>
              {presets.map((preset) => {
                const summary = describePreset(preset);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={BUTTON_CLASS}
                    aria-pressed={activeId === preset.id}
                    aria-label={summary}
                    title={summary}
                    disabled={applyingId !== null}
                    onClick={() => {
                      void apply(preset);
                    }}
                  >
                    <Icon
                      name={preset.icon}
                      aria-hidden
                      className="size-3.5 shrink-0 max-md:pointer-coarse:size-4"
                    />
                    <span className="truncate">{preset.label}</span>
                  </button>
                );
              })}
            </div>
            {state.warning === null ? null : (
              <Icon
                name="AlertTriangle"
                className="ml-1 size-3.5 shrink-0 text-destructive"
                aria-label={state.warning}
              />
            )}
            {failure === null ? null : (
              <span role="alert" className="sr-only">
                {failure}
              </span>
            )}
          </>,
          portalHost,
        )}
    </>
  );
}
