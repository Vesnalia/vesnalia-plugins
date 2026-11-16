// alia-plugin-ui-scale — frontend entry.
//
// Scales the VesnALIA UI on this device only. The VesnALIA app sizes text and spacing in
// rem, so the plugin sets the root font size. The value lives in
// localStorage: every browser, desktop window, and phone keeps its own scale.
import { useEffect, useState } from "react";
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "alia-plugin-ui-scale:percent";
/** Same-tab change signal; the `storage` event only fires in other tabs. */
const CHANGE_EVENT = "alia-plugin-ui-scale:change";
const MIN = 50;
const MAX = 200;
const STEP = 5;
const DEFAULT = 100;
const PRESETS = [75, 90, 100, 110, 125, 150];

function clamp(percent: number): number {
  return Math.min(MAX, Math.max(MIN, Math.round(percent)));
}

function readPercent(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed) : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function writePercent(percent: number): void {
  const next = clamp(percent);
  try {
    if (next === DEFAULT) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // Storage can be unavailable (private mode). Apply for this session only.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
}

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * iOS zooms in when a focused field's font is below 16px, which a scale
 * below 100% causes. `maximum-scale=1` stops that zoom on iOS but keeps
 * pinch-to-zoom. Other platforms would lose pinch-to-zoom, so skip them.
 */
function preventIosFocusZoom(): () => void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta === null || !isIos()) return () => {};
  const original = meta.content;
  if (!/maximum-scale/.test(original)) {
    meta.content = `${original}, maximum-scale=1`;
  }
  return () => {
    meta.content = original;
  };
}

function ScaleSettings() {
  const [percent, setPercent] = useState(readPercent);

  useEffect(() => {
    const sync = () => setPercent(readPercent());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const set = (next: number) => {
    setPercent(clamp(next));
    writePercent(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          aria-label="Decrease scale"
          disabled={percent <= MIN}
          onClick={() => set(percent - STEP)}
        >
          −
        </Button>
        <input
          type="range"
          className="flex-1 accent-current"
          aria-label="UI scale"
          min={MIN}
          max={MAX}
          step={STEP}
          value={percent}
          onChange={(event) => set(Number(event.currentTarget.value))}
        />
        <Button
          variant="outline"
          size="sm"
          aria-label="Increase scale"
          disabled={percent >= MAX}
          onClick={() => set(percent + STEP)}
        >
          +
        </Button>
        <span className="w-12 text-right text-sm tabular-nums">{percent}%</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            variant={preset === percent ? "default" : "outline"}
            size="sm"
            onClick={() => set(preset)}
          >
            {preset}%
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        This setting applies to this device and browser only. It is not
        synced to other clients.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "apply-scale",
    mount({ signal }) {
      const root = document.documentElement;
      const original = root.style.fontSize;
      const apply = () => {
        const percent = readPercent();
        root.style.fontSize = percent === DEFAULT ? original : `${percent}%`;
      };
      apply();
      window.addEventListener(CHANGE_EVENT, apply, { signal });
      window.addEventListener("storage", apply, { signal });
      const restoreViewport = preventIosFocusZoom();
      return () => {
        root.style.fontSize = original;
        restoreViewport();
      };
    },
  });

  app.slots.settingsSection({
    id: "scale",
    title: "UI scale",
    description: "Make the VesnALIA interface bigger or smaller on this device.",
    component: ScaleSettings,
  });
});
