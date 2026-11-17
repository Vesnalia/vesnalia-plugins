import { useEffect, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import { BBS_FONT_FAMILY } from "./font";
import { HANGUP_COPY, type HangupReason } from "./noCarrier";

export type BbsState = "idle" | "dialing" | "online" | "no-carrier";

export interface BbsFrameProps {
  /** Drives the LED, the status text and the power-on animation. */
  state: BbsState;
  /** The xterm.js host element, e.g. `<div ref={hostRef} />`. */
  children: ReactNode;
  /** CRT effects on/off. Persist the user's choice; default it to true. */
  crt: boolean;
  onCrtChange: (next: boolean) => void;
  /** Modem sound. The toggle only renders when `onSoundChange` is given. */
  sound?: boolean;
  onSoundChange?: (next: boolean) => void;
  /** Overrides the default status line ("ONLINE · NODE 3 · PHREAK" etc.). */
  statusText?: string;
  /** Current xterm fontSize; keeps scanlines lined up with VGA pixel rows. */
  fontSize?: number;
  /** Forces animation off (it is already off under prefers-reduced-motion). */
  reducedMotion?: boolean;
  /** When set, shows the NO CARRIER / BUSY dialog over the screen. */
  hangup?: { reason: HangupReason; onAction: () => void; onDismiss?: () => void } | null;
  className?: string;
  /** Extra status-bar controls (zoom, fullscreen); they stay visible in fullscreen. */
  controls?: ReactNode;
  /** The frame root, e.g. for `requestFullscreen()`. */
  frameRef?: Ref<HTMLDivElement>;
  /** `fill`: the screen area takes all spare height (a full page). Default `content`. */
  layout?: "content" | "fill";
  /** The box the glass is centred in; measure it to fit the grid. */
  slotRef?: Ref<HTMLDivElement>;
}

const DEFAULT_STATUS: Record<BbsState, string> = {
  idle: "Ready",
  dialing: "Dialing…",
  online: "Online · 2400 baud",
  "no-carrier": "No carrier",
};

/**
 * The monitor around the BBS terminal: bezel, glass, CRT overlays, status
 * bar with LED and toggles, and the NO CARRIER dialog. Needs theme.css.
 */
export function BbsFrame(props: BbsFrameProps) {
  const { state, crt, sound, onSoundChange, hangup, fontSize = 16 } = props;
  const actionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (hangup) actionRef.current?.focus();
  }, [hangup]);

  const style = {
    "--aliabbs-scanline": `${Math.max(2, Math.round(fontSize / 8))}px`,
    "--aliabbs-font": BBS_FONT_FAMILY,
  } as CSSProperties;

  const copy = hangup ? HANGUP_COPY[hangup.reason] : null;

  return (
    <div
      ref={props.frameRef}
      className={["aliabbs-frame", props.className].filter(Boolean).join(" ")}
      data-state={state}
      data-crt={crt ? "on" : "off"}
      data-motion={props.reducedMotion ? "off" : "on"}
      data-layout={props.layout ?? "content"}
      style={style}
    >
      <div className="aliabbs-screen-slot" ref={props.slotRef}>
        <div className="aliabbs-screen" data-power={state === "dialing" ? "on" : "off"}>
          <div className="aliabbs-term">{props.children}</div>
          <div className="aliabbs-crt-glow" aria-hidden="true" />
          <div className="aliabbs-crt-overlay" aria-hidden="true" />
          {hangup && copy && (
            <div className="aliabbs-hangup" data-headline={copy.headline} role="alertdialog" aria-labelledby="aliabbs-hangup-h">
              <div className="aliabbs-hangup-box">
                <p className="aliabbs-hangup-headline" id="aliabbs-hangup-h">
                  {copy.headline}
                </p>
                <p className="aliabbs-hangup-detail">{copy.detail}</p>
                <button ref={actionRef} type="button" className="aliabbs-button" onClick={hangup.onAction}>
                  {copy.action}
                </button>
                {hangup.onDismiss && (
                  <button type="button" className="aliabbs-button" onClick={hangup.onDismiss}>
                    Close
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="aliabbs-statusbar">
        <span className="aliabbs-led" aria-hidden="true" />
        <span className="aliabbs-status-text" role="status">
          {props.statusText ?? DEFAULT_STATUS[state]}
        </span>
        {props.controls}
        {onSoundChange && (
          <button type="button" className="aliabbs-switch" aria-pressed={!!sound} onClick={() => onSoundChange(!sound)}>
            Sound
          </button>
        )}
        <button type="button" className="aliabbs-switch" aria-pressed={crt} onClick={() => props.onCrtChange(!crt)}>
          CRT
        </button>
      </div>
    </div>
  );
}
