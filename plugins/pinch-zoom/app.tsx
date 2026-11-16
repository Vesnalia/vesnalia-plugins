/**
 * FNXC:PinchZoom 2026-11-13-12:39:
 * Frontend entry for the Pinch Zoom plugin.
 * User requirement: change the app text size and the terminal text size with pinch/zoom gestures.
 * - The content script (lib/gestures.ts) owns gestures and applies sizes to the page.
 * - The settings section shows the current sizes with step buttons and resets, for devices without a pinch gesture and to undo an accidental pinch.
 *
 * FNXC:PinchZoom 2026-11-13-13:11:
 * Plugin settings (scope, composer and terminal ratios) are only readable through `useSettings()`, so an app overlay that renders nothing bridges them into the shared store for the content script.
 */
import { useEffect, useSyncExternalStore } from "react";
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { mountPinchZoom } from "./lib/gestures";
import {
  formatValue,
  parseConfig,
  TEXT_SCALE_DEFAULT,
  TEXT_SCALE_STEP,
  valueOf,
} from "./lib/zoom-core";
import {
  getZoomSnapshot,
  setZoomConfig,
  setZoomState,
  setZoomValue,
  subscribeZoom,
} from "./lib/zoom-store";

function useZoomSnapshot() {
  return useSyncExternalStore(subscribeZoom, getZoomSnapshot, getZoomSnapshot);
}

/** Pushes the plugin settings into the store whenever they change. Renders nothing. */
function SettingsBridge() {
  const { values, isLoading } = useSettings();
  useEffect(() => {
    if (!isLoading) setZoomConfig(parseConfig(values as Record<string, unknown>));
  }, [values, isLoading]);
  return null;
}

function SizeRow(props: {
  label: string;
  value: string;
  onSmaller: () => void;
  onLarger: () => void;
  onReset: () => void;
  isDefault: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium">{props.label}</div>
        <div className="text-xs text-muted-foreground tabular-nums">{props.value}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Smaller ${props.label.toLowerCase()}`}
          onClick={props.onSmaller}
        >
          A−
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Larger ${props.label.toLowerCase()}`}
          onClick={props.onLarger}
        >
          A+
        </Button>
        <Button variant="ghost" size="sm" disabled={props.isDefault} onClick={props.onReset}>
          Reset
        </Button>
      </div>
    </div>
  );
}

function SettingsSection() {
  const { state, config } = useZoomSnapshot();
  const text = state.textScale;
  const terminalPx = valueOf(state, config, "terminal");
  // Composer size relative to bb's default, in either scope.
  const composer = Math.round(text * config.composerRatio * 100) / 100;
  return (
    <div className="flex flex-col">
      <SizeRow
        label="Text size"
        value={`${formatValue("text", text)}${config.scope === "app" ? " of the whole app" : " of chat"} · composer ${formatValue("text", composer)}`}
        onSmaller={() => setZoomValue("text", text - TEXT_SCALE_STEP)}
        onLarger={() => setZoomValue("text", text + TEXT_SCALE_STEP)}
        onReset={() => setZoomValue("text", TEXT_SCALE_DEFAULT)}
        isDefault={text === TEXT_SCALE_DEFAULT}
      />
      <SizeRow
        label="Terminal text size"
        value={`${formatValue("terminal", terminalPx)}${state.terminalAdjust === 1 ? " (follows text size)" : " (fine-tuned on this device)"}`}
        onSmaller={() => setZoomValue("terminal", terminalPx - 1)}
        onLarger={() => setZoomValue("terminal", terminalPx + 1)}
        onReset={() => setZoomState({ ...state, terminalAdjust: 1 })}
        isDefault={state.terminalAdjust === 1}
      />
      <p className="pt-2 text-xs text-muted-foreground">
        Pinch over a terminal to fine-tune terminal text; pinch anywhere else to
        resize text. On a desktop, pinch the trackpad or hold Ctrl and scroll.
        These sizes are saved on this device only; the settings above apply to
        every device.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "pinch-zoom",
    mount({ signal }) {
      return mountPinchZoom(signal);
    },
  });
  app.slots.experimental_appOverlay({
    id: "settings-bridge",
    component: SettingsBridge,
  });
  app.slots.settingsSection({
    id: "sizes",
    title: "Current sizes",
    description: "Sizes on this device.",
    component: SettingsSection,
  });
});
