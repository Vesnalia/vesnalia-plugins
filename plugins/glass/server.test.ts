import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@vesnalia/plugin-sdk/testing';
import plugin from './server';
import { DEFAULT_CONFIG, readStoredConfig, wallpaperUrlSchema } from './config';

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
async function setup() {
  const host = createFakePluginHost({ pluginId: 'glass' });
  hosts.push(host);
  await plugin(host.alia);
  return host;
}
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });

describe('config contract and storage', () => {
  it('recovers individual invalid fields without losing other preferences', () => {
    expect(readStoredConfig({ opacity: 67, blur: 1000, style: 'image', imageUrl: 'https://example.com/a.jpg', animate: false }))
      .toMatchObject({ opacity: 67, blur: DEFAULT_CONFIG.blur, style: 'image', imageUrl: 'https://example.com/a.jpg', animate: false });
  });
  it('accepts bounded HTTP image URLs and rejects unsafe or incomplete input', () => {
    for (const value of ['', 'https://example.com/a.jpg', ' http://localhost:8080/a.png ']) expect(wallpaperUrlSchema.safeParse(value).success).toBe(true);
    for (const value of ['javascript:alert(1)', 'file:///tmp/wallpaper', 'data:image/svg+xml,a', '/relative.jpg', 'https://user:pass@example.com/a', 'https://example.com/' + 'a'.repeat(4096)]) expect(wallpaperUrlSchema.safeParse(value).success).toBe(false);
  });
  it('merges simultaneous window edits and retains unknown stored values', async () => {
    const { alia, harness } = await setup();
    await alia.storage.kv.set('config', { ...DEFAULT_CONFIG, futureOption: 'retain', blur: 'legacy-value' });
    await Promise.all([harness.behavior.callRpc('setConfig', { opacity: 64 }), harness.behavior.callRpc('setConfig', { dim: 42 })]);
    expect(await harness.behavior.callRpc('getConfig')).toMatchObject({ opacity: 64, dim: 42 });
    expect(await alia.storage.kv.get('config')).toMatchObject({ futureOption: 'retain', blur: 'legacy-value' });
    expect(harness.inspection.realtimeSignals).toEqual([{ channel: 'glass', payload: {} }, { channel: 'glass', payload: {} }]);
  });
  it('does not publish failed writes and keeps the queue usable', async () => {
    const { alia, harness } = await setup();
    vi.spyOn(alia.storage.kv, 'set').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(harness.behavior.callRpc('setConfig', { opacity: 61 })).rejects.toThrow();
    expect(harness.inspection.realtimeSignals).toHaveLength(0);
    await expect(harness.behavior.callRpc('setConfig', { dim: 22 })).resolves.toMatchObject({ opacity: DEFAULT_CONFIG.opacity, dim: 22 });
  });
  it('validates patches and resets only through the explicit reset operation', async () => {
    const { alia, harness } = await setup();
    await harness.behavior.callRpc('setConfig', { enabled: true, imageUrl: 'https://example.com/wallpaper.jpg' });
    await expect(harness.behavior.callRpc('setConfig', { surprise: true })).rejects.toThrow();
    await expect(harness.behavior.callRpc('setConfig', { opacity: 54 })).rejects.toThrow();
    expect(await harness.behavior.callRpc('resetConfig')).toEqual(DEFAULT_CONFIG);
    expect(await alia.storage.kv.get('config')).toBeUndefined();
  });
});

describe('shader library', () => {
  const shader = { id: 'my-shader', name: 'My shader', source: 'void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(1.0); }' };
  it('upserts concurrent shaders by ID without dropping appearance or other library entries', async () => {
    const { harness, alia } = await setup();
    await alia.storage.kv.set('config', { opacity: 68, futureOption: 'kept' });
    await Promise.all([
      harness.behavior.callRpc('saveShader', { shader, activate: true }),
      harness.behavior.callRpc('saveShader', { shader: { ...shader, id: 'second' }, activate: false }),
      harness.behavior.callRpc('setConfig', { dim: 40 }),
    ]);
    expect(await harness.behavior.callRpc('getConfig')).toMatchObject({ opacity: 68, dim: 40, style: 'custom', activeShaderId: shader.id, customShaders: [shader, { ...shader, id: 'second' }] });
    await harness.behavior.callRpc('saveShader', { shader: { ...shader, name: 'Renamed' }, activate: true });
    expect((await harness.behavior.callRpc('getConfig') as typeof DEFAULT_CONFIG).customShaders).toHaveLength(2);
    expect(await alia.storage.kv.get('config')).toMatchObject({ futureOption: 'kept' });
  });
  it('keeps the library through appearance reset and falls back when the selected shader is deleted', async () => {
    const { harness } = await setup();
    await harness.behavior.callRpc('saveShader', { shader, activate: true });
    expect(await harness.behavior.callRpc('resetConfig')).toEqual({ ...DEFAULT_CONFIG, customShaders: [shader] });
    await harness.behavior.callRpc('setConfig', { style: 'custom', activeShaderId: shader.id });
    expect(await harness.behavior.callRpc('deleteShader', { id: shader.id })).toMatchObject({ style: 'flow', activeShaderId: '', customShaders: [] });
    await expect(harness.behavior.callRpc('setConfig', { style: 'custom', activeShaderId: 'missing' })).rejects.toThrow();
  });
  it('rejects oversized/invalid code and full-library additions without writes or broadcasts', async () => {
    const { harness } = await setup();
    for (const source of ['alert(1)', 'void mainImage(){}\n#include "remote.glsl"', 'void mainImage(){}' + 'x'.repeat(16384)]) {
      await expect(harness.behavior.callRpc('saveShader', { shader: { ...shader, source }, activate: true })).rejects.toThrow();
    }
    expect(harness.inspection.realtimeSignals).toHaveLength(0);
    for (let index = 0; index < 8; index++) await harness.behavior.callRpc('saveShader', { shader: { ...shader, id: `shader-${index}` }, activate: false });
    await expect(harness.behavior.callRpc('saveShader', { shader, activate: true })).rejects.toThrow();
    expect(harness.inspection.realtimeSignals).toHaveLength(8);
    await expect(harness.behavior.callRpc('setConfig', { customShaders: [] })).rejects.toThrow();
    await expect(harness.behavior.callRpc('saveShader', { shader: { ...shader, id: 'shader-0' }, activate: true })).resolves.toMatchObject({ activeShaderId: 'shader-0' });
  });
});
