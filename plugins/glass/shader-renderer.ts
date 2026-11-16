import type { GlassConfig } from "./config";
import { resolvePalette, rgbOf } from "./colors";
import { shaderFragment, SHADER_OPTIONS } from "./shaders";

const VERTEX = "attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }";
export const RENDER_BUDGET = {
  low: { pixels: 250_000, fps: 15 }, balanced: { pixels: 600_000, fps: 24 }, high: { pixels: 1_200_000, fps: 30 },
};
export function renderSize(width: number, height: number, budget: number): [number, number] {
  const w = Math.max(1, width), h = Math.max(1, height);
  const scale = Math.min(1, Math.sqrt(budget / (w * h)), 4096 / Math.max(w, h));
  return [Math.max(1, Math.floor(w * scale)), Math.max(1, Math.floor(h * scale))];
}

export type ShaderRenderer = {
  canvas: HTMLCanvasElement;
  update: (config: GlassConfig, accent?: readonly [number, number, number]) => boolean;
  pause: () => void;
  dispose: () => void;
};
type Options = { onError?: (message: string) => void; onReady?: () => void; still?: boolean };

// One program at a time. A failed compilation never replaces the last working
// program. All listeners, frames, shader objects, and buffers belong to this rig.
export function createShaderRenderer(container: HTMLElement, options: Options = {}): ShaderRenderer | null {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { width: "100%", height: "100%", display: "block" });
  let gl: WebGLRenderingContext | null = null;
  try { gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power" }); } catch { /* fallback below */ }
  if (!gl) { options.onError?.("WebGL is unavailable in this browser. A still backdrop is shown."); return null; }
  const gpu = gl;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let uniforms: Record<string, WebGLUniformLocation | null> = {};
  let source = "", disposed = false, lost = false, paused = false;
  let raf: number | null = null, lastFrame = -Infinity, elapsed = 13.7, lastTime: number | null = null;
  let config: GlassConfig | null = null;
  let accent: readonly [number, number, number] = [139, 145, 232];
  let colors: number[][] = [];
  function stop() { if (raf !== null) cancelAnimationFrame(raf); raf = null; lastTime = null; }
  function compile(fragment: string): boolean {
    const shaders: WebGLShader[] = [];
    const next = gpu.createProgram();
    if (!next) { options.onError?.("Couldn’t create the shader. Try a lower quality setting."); return false; }
    try {
      for (const [type, code] of [[gpu.VERTEX_SHADER, VERTEX], [gpu.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gpu.createShader(type);
        if (!shader) throw new Error("Couldn’t allocate the shader.");
        shaders.push(shader); gpu.shaderSource(shader, code); gpu.compileShader(shader);
        if (!gpu.getShaderParameter(shader, gpu.COMPILE_STATUS)) throw new Error((gpu.getShaderInfoLog(shader) || "Shader compilation failed.").slice(0, 3000));
        gpu.attachShader(next, shader);
      }
      gpu.linkProgram(next);
      if (!gpu.getProgramParameter(next, gpu.LINK_STATUS)) throw new Error((gpu.getProgramInfoLog(next) || "Shader linking failed.").slice(0, 3000));
      if (!buffer) {
        buffer = gpu.createBuffer();
        if (!buffer) throw new Error("Couldn’t allocate the shader buffer.");
        gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
        gpu.bufferData(gpu.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gpu.STATIC_DRAW);
      }
      gpu.useProgram(next); gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
      const attribute = gpu.getAttribLocation(next, "aPos");
      gpu.enableVertexAttribArray(attribute); gpu.vertexAttribPointer(attribute, 2, gpu.FLOAT, false, 0, 0);
      if (program) gpu.deleteProgram(program);
      program = next; source = fragment;
      uniforms = Object.fromEntries(["uRes", "uTime", "uStyle", "uC0", "uC1", "uC2", "uBase", "iResolution", "iTime", "iMouse", "uColorA", "uColorB", "uColorC"].map((name) => [name, gpu.getUniformLocation(next, name)]));
      return true;
    } catch (error) {
      gpu.deleteProgram(next);
      options.onError?.(error instanceof Error ? error.message : "Couldn’t compile this shader.");
      return false;
    } finally { for (const shader of shaders) gpu.deleteShader(shader); }
  }
  function draw(now: number) {
    raf = null;
    if (disposed || lost || paused || !config || !program || document.hidden) return;
    const animate = config.animate && !motion.matches && !options.still;
    const budget = RENDER_BUDGET[config.quality];
    if (animate && now - lastFrame < 1000 / budget.fps) { raf = requestAnimationFrame(draw); return; }
    const [w, h] = renderSize(container.clientWidth, container.clientHeight, options.still ? 80_000 : budget.pixels);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gpu.viewport(0, 0, w, h); }
    if (animate && lastTime !== null) elapsed += Math.min((now - lastTime) / 1000, .1) * config.speed / 100;
    lastTime = now; lastFrame = now;
    gpu.useProgram(program);
    gpu.uniform2f(uniforms.uRes, w, h); gpu.uniform3f(uniforms.iResolution, w, h, 1);
    gpu.uniform1f(uniforms.uTime, elapsed); gpu.uniform1f(uniforms.iTime, elapsed); gpu.uniform4f(uniforms.iMouse, 0, 0, 0, 0);
    gpu.uniform1f(uniforms.uStyle, SHADER_OPTIONS.findIndex((item) => item.id === config!.style));
    for (const [index, names] of [[0, ["uC0", "uColorA"]], [1, ["uC1", "uColorB"]], [2, ["uC2", "uColorC"]]] as const) {
      const color = colors[index]!;
      for (const name of names) gpu.uniform3f(uniforms[name], color[0]! / 255, color[1]! / 255, color[2]! / 255);
    }
    gpu.uniform3f(uniforms.uBase, .016, .02, .045);
    gpu.drawArrays(gpu.TRIANGLES, 0, 3);
    if (animate) raf = requestAnimationFrame(draw);
  }
  const refresh = () => { stop(); lastFrame = -Infinity; draw(performance.now()); };
  const onLost = (event: Event) => { event.preventDefault(); lost = true; stop(); options.onError?.("Graphics were paused by your browser. Reopen this page or choose a still backdrop."); };
  const onRestore = () => {
    lost = false; program = null; buffer = null; source = "";
    if (config) update(config, accent);
  };
  function update(next: GlassConfig, themeAccent = rgbOf("--primary", [139, 145, 232])) {
    if (disposed || lost) return false;
    let fragment: string;
    try { fragment = shaderFragment(next); } catch (error) { options.onError?.((error as Error).message); return false; }
    if (source !== fragment && !compile(fragment)) return false;
    config = next; accent = themeAccent; colors = resolvePalette(config, accent); paused = false;
    refresh(); options.onReady?.(); return true;
  }
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
  observer?.observe(container);
  canvas.addEventListener("webglcontextlost", onLost); canvas.addEventListener("webglcontextrestored", onRestore);
  document.addEventListener("visibilitychange", refresh); motion.addEventListener("change", refresh);
  container.appendChild(canvas);
  return {
    canvas, update, pause: () => { paused = true; stop(); },
    dispose: () => {
      if (disposed) return;
      disposed = true; stop(); observer?.disconnect();
      document.removeEventListener("visibilitychange", refresh); motion.removeEventListener("change", refresh);
      canvas.removeEventListener("webglcontextlost", onLost); canvas.removeEventListener("webglcontextrestored", onRestore);
      if (program) gpu.deleteProgram(program); if (buffer) gpu.deleteBuffer(buffer);
      gpu.getExtension("WEBGL_lose_context")?.loseContext(); canvas.remove();
    },
  };
}
