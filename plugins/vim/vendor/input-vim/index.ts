import "./command-types.js";
import "./register.js";
import "./shared/text-utils.js";
import "./shared/motion-resolver.js";
import "./key-parser.js";
import "./vim-engine.js";
import "./handlers/input-handler.js";
import "./handlers/contenteditable-handler.js";
import "./element-detector.js";
import "./settings-manager.js";
import "./overlay.js";
import "./cursor-controller.js";
import "./focus-manager.js";
import "./event-interceptor.js";

type InputVimRuntime = {
  VimEngine: new () => {
    mode: string;
    parser: { reset(): void };
    onModeChange(callback: (mode: string) => void): void;
  };
  Overlay: new () => {
    init(): void;
    update(mode: string): void;
    updateCmd(command: string): void;
    setIndicatorEnabled(enabled: boolean): void;
    destroy(): void;
  };
  ElementDetector: { getHandler(element: Element): unknown };
  CursorController: {
    init(...args: unknown[]): void;
    update(): void;
  };
  FocusManager: {
    init(...args: unknown[]): void;
    dispose(): void;
    getActiveElement(): HTMLElement | null;
    markFocusSteal(): void;
    checkExistingFocus(): void;
  };
  EventInterceptor: {
    init(...args: unknown[]): void;
  };
};

export type InputVimController = {
  dispose(): void;
  setIndicatorEnabled(enabled: boolean): void;
};

export function installInputVim(
  signal: AbortSignal,
  options: { showModeIndicator?: boolean } = {},
): InputVimController {
  const runtime = (window as typeof window & { InputVim: InputVimRuntime }).InputVim;
  const engine = new runtime.VimEngine();
  const overlay = new runtime.Overlay();
  const getActiveElement = runtime.FocusManager.getActiveElement;
  const getHandler = runtime.ElementDetector.getHandler;
  const updateCursor = runtime.CursorController.update;

  overlay.init();
  overlay.setIndicatorEnabled(options.showModeIndicator ?? true);
  runtime.CursorController.init(overlay, engine, getActiveElement, getHandler, signal);
  runtime.FocusManager.init(engine, overlay, getHandler, updateCursor, signal);
  runtime.EventInterceptor.init(
    engine,
    overlay,
    getActiveElement,
    getHandler,
    updateCursor,
    runtime.FocusManager.markFocusSteal,
    signal,
  );

  engine.onModeChange((mode) => {
    overlay.update(mode);
    updateCursor();
    getActiveElement()?.setAttribute("data-input-vim", mode);
  });
  runtime.FocusManager.checkExistingFocus();

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      runtime.FocusManager.dispose();
      overlay.destroy();
    },
    setIndicatorEnabled(enabled) {
      overlay.setIndicatorEnabled(enabled);
    },
  };
}
