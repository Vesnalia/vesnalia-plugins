// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { createShaderRenderer, renderSize } from './shader-renderer';
import { STARTER_SHADER } from './shaders';
let bad = false, programId = 0;
const gpu = {
  VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLES: 8,
  createProgram: vi.fn(() => ({ id: ++programId })), createShader: vi.fn(() => ({})), createBuffer: vi.fn(() => ({})),
  shaderSource: vi.fn(), compileShader: vi.fn(), attachShader: vi.fn(), linkProgram: vi.fn(),
  getShaderParameter: vi.fn(() => !bad), getProgramParameter: vi.fn(() => true),
  getShaderInfoLog: vi.fn(() => 'ERROR: 0:2: invalid expression'), getProgramInfoLog: vi.fn(),
  useProgram: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(), getAttribLocation: vi.fn(() => 0), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
  getUniformLocation: vi.fn(() => ({})), viewport: vi.fn(), uniform1f: vi.fn(), uniform2f: vi.fn(), uniform3f: vi.fn(), uniform4f: vi.fn(),
  drawArrays: vi.fn(), deleteProgram: vi.fn(), deleteShader: vi.fn(), deleteBuffer: vi.fn(), getExtension: vi.fn(),
};
const media = Object.assign(new EventTarget(), { matches: false });
beforeEach(() => {
  bad = false; media.matches = false; vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => media);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gpu as unknown as WebGLRenderingContext);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 42)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
function host() { const element = document.createElement('div'); document.body.append(element); return element; }
it('bounds render size for large displays and invalid zero dimensions', () => {
  const [w, h] = renderSize(20000, 10000, 600000);
  expect(w * h).toBeLessThanOrEqual(600000); expect(Math.max(w,h)).toBeLessThanOrEqual(4096);
  expect(renderSize(0,0,600000)).toEqual([1,1]);
});
it('retains the valid program on compile failure and releases owned GPU resources on disposal', () => {
  const element = host(), onError = vi.fn();
  const rig = createShaderRenderer(element, { onError })!;
  expect(rig.update(DEFAULT_CONFIG, [100,100,100])).toBe(true);
  const original = gpu.createProgram.mock.results[0]!.value;
  bad = true;
  expect(rig.update({ ...DEFAULT_CONFIG, style: 'custom', activeShaderId: 'draft', customShaders: [{ id: 'draft', name: 'Draft', source: STARTER_SHADER }] }, [100,100,100])).toBe(false);
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('invalid expression'));
  expect(gpu.deleteProgram).not.toHaveBeenCalledWith(original);
  rig.dispose(); rig.dispose();
  expect(gpu.deleteProgram).toHaveBeenCalledWith(original); expect(gpu.deleteBuffer).toHaveBeenCalledTimes(1); expect(element.children).toHaveLength(0);
});
it('stops on hidden/reduced-motion/context loss and recovers after restoration', () => {
  const element = host(), onError = vi.fn(), onReady = vi.fn();
  const rig = createShaderRenderer(element, { onError, onReady })!;
  rig.update(DEFAULT_CONFIG, [100,100,100]);
  expect(requestAnimationFrame).toHaveBeenCalled();
  vi.mocked(requestAnimationFrame).mockClear();
  media.matches = true; media.dispatchEvent(new Event('change'));
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  media.matches = false;
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  rig.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  expect(rig.update(DEFAULT_CONFIG)).toBe(false);
  rig.canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(onReady).toHaveBeenCalledTimes(2);
  rig.dispose();
  const calls = gpu.drawArrays.mock.calls.length; media.dispatchEvent(new Event('change'));
  expect(gpu.drawArrays.mock.calls).toHaveLength(calls);
});
