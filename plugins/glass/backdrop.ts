import { configSchema, type GlassConfig as Config } from "./config";
import { rgbOf } from "./colors";
import { createShaderRenderer, type ShaderRenderer } from "./shader-renderer";
import { isShaderStyle } from "./shaders";
import { cssBackdrop } from "./preview";
import { surfaceCss } from "./surfaces";

async function callRpc<T>(
  pluginId: string,
  method: string,
  input: unknown,
  signal: AbortSignal,
): Promise<T | null> {
  try {
    const res = await fetch(`/api/v1/plugins/${pluginId}/rpc/${method}`, {
      signal,
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; result?: T };
    return json.ok && json.result !== undefined ? json.result : null;
  } catch {
    return null;
  }
}

// Animated film grain (SVG turbulence tile, jittered via steps()).
const GRAIN_URI = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;

export function mountGlass({
  pluginId,
  signal,
}: {
  pluginId: string;
  signal: AbortSignal;
}): () => void {
  if (signal.aborted) return () => {};
  let disposed = false;
  const request = new AbortController();
  // Layer root: backdrop (shader canvas OR css layer) → grain → scrim.
  const rootLayer = document.createElement("div");
  rootLayer.setAttribute("data-glass-backdrop", "");
  rootLayer.setAttribute("aria-hidden", "true");
  Object.assign(rootLayer.style, {
    position: "fixed",
    inset: "0",
    zIndex: "-1",
    pointerEvents: "none",
    display: "none",
    overflow: "hidden",
  } satisfies Partial<CSSStyleDeclaration>);

  const shaderWrap = document.createElement("div");
  shaderWrap.dataset.glassLayer = "shader";
  Object.assign(shaderWrap.style, {
    position: "absolute",
    inset: "-6%",
    display: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  const cssLayer = document.createElement("div");
  cssLayer.dataset.glassLayer = "fallback";
  Object.assign(cssLayer.style, {
    position: "absolute",
    inset: "-10%",
    display: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  const grainLayer = document.createElement("div");
  Object.assign(grainLayer.style, {
    position: "absolute",
    inset: "-16px",
    backgroundImage: GRAIN_URI,
    mixBlendMode: "overlay",
    opacity: "0",
    animation: "glass-grain 0.9s steps(4) infinite",
  } satisfies Partial<CSSStyleDeclaration>);

  const scrim = document.createElement("div");
  Object.assign(scrim.style, {
    position: "absolute",
    inset: "0",
    background: "rgba(0,0,0,0.3)",
  } satisfies Partial<CSSStyleDeclaration>);

  // Positioned siblings paint in DOM order. Keep the opaque fallback below
  // the shader so successful WebGL output is visible, while context loss can
  // reveal the fallback simply by hiding the shader layer.
  rootLayer.append(cssLayer, shaderWrap, grainLayer, scrim);
  document.body.appendChild(rootLayer);

  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-glass", "");
  document.head.appendChild(styleEl);

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let rig: ShaderRenderer | null = null;
  let shaderUnavailable = false;
  let cfg: Config | null = null;
  let lastTokenCss = "";
  // Theme accent, cached per apply() — never probe the DOM per frame.
  let accent: readonly [number, number, number] = [124, 134, 232];

  const compact = matchMedia("(max-width: 767.98px)");
  function stopShader() { rig?.pause(); }

  function apply(next: Config) {
    if (disposed || signal.aborted) return;
    cfg = next;
    if (!next.enabled) {
      rootLayer.style.display = "none";
      stopShader();
      if (styleEl.textContent) styleEl.textContent = "";
      lastTokenCss = "";
      return;
    }
    rootLayer.style.display = "block";
    // Read the host theme without sampling our own translucent overrides.
    if (styleEl.sheet) styleEl.sheet.disabled = true;
    accent = rgbOf("--primary", [124, 134, 232]);
    const canvas = rgbOf("--canvas", [11, 12, 14]);
    if (styleEl.sheet) styleEl.sheet.disabled = false;

    const tokenCss = surfaceCss(next, canvas);
    if (tokenCss !== lastTokenCss) {
      lastTokenCss = tokenCss;
      styleEl.textContent = tokenCss;
    }

    // Use a CSS fallback behind the canvas, including after context loss.
    const isShader = isShaderStyle(next.style);
    cssLayer.style.display = "block";
    cssLayer.style.background = cssBackdrop(isShader ? { ...next, style: "glow" } : next, accent);
    cssLayer.style.filter = next.style === "image" ? "none" : `blur(${next.blur}px)`;
    shaderWrap.style.display = isShader && !compact.matches ? "block" : "none";
    stopShader();
    if (isShader && !compact.matches) {
      shaderWrap.style.filter = `blur(${Math.round(next.blur / 3)}px) saturate(1.2)`;
      if (!rig && !shaderUnavailable) {
        rig = createShaderRenderer(shaderWrap, {
          onError: () => { shaderWrap.style.opacity = "0"; },
          onReady: () => { shaderWrap.style.opacity = "1"; },
        });
        shaderUnavailable = !rig;
      }
      rig?.update(next, accent);
    }
    grainLayer.style.opacity = String(next.grain / 100);
    grainLayer.style.animationPlayState =
      next.animate && !reducedMotion.matches && !document.hidden ? "running" : "paused";
    scrim.style.background = `rgba(0,0,0,${(next.dim / 100).toFixed(2)})`;
  }

  // One request at a time; polling remains independent of React panel mounts.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  const tick = async () => {
    if (disposed || signal.aborted || inFlight) return;
    clearTimeout(timer);
    if (document.hidden) return;
    inFlight = true;
    try {
      const next = await callRpc<unknown>(pluginId, "getConfig", null, request.signal);
      const parsed = configSchema.safeParse(next);
      if (!disposed && !signal.aborted && parsed.success && JSON.stringify(parsed.data) !== JSON.stringify(cfg)) apply(parsed.data);
    } finally {
      inFlight = false;
      if (!disposed && !signal.aborted && !document.hidden) timer = setTimeout(() => void tick(), 1200);
    }
  };
  const refreshVisuals = () => { if (cfg) apply(cfg); };
  const onVisibility = () => { refreshVisuals(); if (!document.hidden) void tick(); else clearTimeout(timer); };
  const onCompact = () => { refreshVisuals(); };
  const themeObserver = new MutationObserver(refreshVisuals);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  reducedMotion.addEventListener("change", refreshVisuals);
  document.addEventListener("visibilitychange", onVisibility);
  compact.addEventListener("change", onCompact);
  void tick();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    request.abort();
    clearTimeout(timer);
    themeObserver.disconnect();
    reducedMotion.removeEventListener("change", refreshVisuals);
    document.removeEventListener("visibilitychange", onVisibility);
    compact.removeEventListener("change", onCompact);
    signal.removeEventListener("abort", dispose);
    stopShader();
    rig?.dispose();
    rig = null;
    styleEl.remove();
    rootLayer.remove();
  };
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
