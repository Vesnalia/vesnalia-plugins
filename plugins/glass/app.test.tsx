// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, mountPluginContentScripts, renderSlot, type RenderedSlot } from '@vesnalia/plugin-sdk/testing/app';
import { DEFAULT_CONFIG, type GlassConfig } from './config';

let slot: RenderedSlot | undefined;
const app = await loadPluginApp(() => import('./app'));
const media = Object.assign(new EventTarget(), { matches: false });
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => media);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { slot?.lifecycle.unmount(); slot = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

it('shows a retryable load error before exposing editable settings', async () => {
  let fail = true;
  slot = renderSlot(app.navPanels[0]!, { subPath: '' }, { rpc: { getConfig: () => { if (fail) throw new Error('offline'); return DEFAULT_CONFIG; } } });
  await slot.findByText(/Couldn’t load settings/);
  expect(slot.queryByRole('switch', { name: /Enable transparency/ })).toBeNull();
  fail = false; fireEvent.click(slot.getByRole('button', { name: 'Try again' }));
  await slot.findByRole('switch', { name: /Enable transparency/ });
});

it('keeps newer edits over stale reads and overlapping save responses', async () => {
  let saved = { ...DEFAULT_CONFIG };
  const firstSave = deferred<typeof saved>();
  const staleRead = deferred<typeof saved>();
  let writes = 0, reads = 0;
  slot = renderSlot(app.navPanels[0]!, { subPath: '' }, { rpc: {
    getConfig: () => ++reads === 1 ? saved : staleRead.promise,
    setConfig: (patch) => { saved = { ...saved, ...(patch as Partial<GlassConfig>) }; return ++writes === 1 ? firstSave.promise : saved; },
  } });
  await slot.findByRole('slider', { name: 'Surface opacity' });
  await slot.behavior.emitRealtime('glass', {});
  fireEvent.change(slot.getByRole('slider', { name: 'Surface opacity' }), { target: { value: '65' } });
  fireEvent.change(slot.getByRole('slider', { name: 'Surface opacity' }), { target: { value: '72' } });
  fireEvent.change(slot.getByRole('slider', { name: 'Dimming' }), { target: { value: '41' } });
  await act(async () => { staleRead.resolve(DEFAULT_CONFIG); firstSave.resolve({ ...DEFAULT_CONFIG, opacity: 65 }); });
  await waitFor(() => expect(writes).toBe(2));
  expect((slot.getByRole('slider', { name: 'Surface opacity' }) as HTMLInputElement).value).toBe('72');
  expect(saved).toMatchObject({ opacity: 72, dim: 41 });
});

it('retains failed edits for retry and confirms reset before clearing preferences', async () => {
  let fail = true, resets = 0;
  let saved = { ...DEFAULT_CONFIG };
  slot = renderSlot(app.navPanels[0]!, { subPath: '' }, { rpc: {
    getConfig: () => saved,
    setConfig: (patch) => { if (fail) throw new Error('offline'); return saved = { ...saved, ...(patch as Partial<GlassConfig>) }; },
    resetConfig: () => { resets++; return DEFAULT_CONFIG; },
  } });
  fireEvent.click(await slot.findByRole('switch', { name: /Enable transparency/ }));
  await slot.findByText(/Changes haven’t been saved/);
  expect(slot.getByRole('switch', { name: /Enable transparency/ })).toHaveProperty('checked', true);
  fail = false; fireEvent.click(slot.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(saved.enabled).toBe(true));
  fireEvent.click(slot.getByRole('button', { name: 'Reset settings…' }));
  expect(resets).toBe(0);
  fireEvent.click(slot.getByRole('button', { name: 'Cancel' }));
  expect(resets).toBe(0);
  fireEvent.click(slot.getByRole('button', { name: 'Reset settings…' }));
  fireEvent.click(slot.getByRole('button', { name: 'Reset all settings' }));
  await waitFor(() => expect(resets).toBe(1));
});

it('validates wallpaper on apply rather than persisting incomplete keystrokes', async () => {
  const save = vi.fn((patch) => ({ ...DEFAULT_CONFIG, style: 'image', ...patch }));
  slot = renderSlot(app.navPanels[0]!, { subPath: '' }, { rpc: { getConfig: () => ({ ...DEFAULT_CONFIG, style: 'image' }), setConfig: save } });
  const input = await slot.findByLabelText('Wallpaper URL');
  fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(slot.getByRole('button', { name: 'Apply image' }));
  await slot.findByText(/Enter a complete HTTP or HTTPS image URL/);
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: 'https://example.com/wallpaper.jpg' } });
  fireEvent.click(slot.getByRole('button', { name: 'Apply image' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ imageUrl: 'https://example.com/wallpaper.jpg' }));
});

it('falls back without WebGL and removes nodes, listeners, and pending requests on disposal', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { ...DEFAULT_CONFIG, enabled: true } }) });
  vi.stubGlobal('fetch', fetcher);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'glass' });
  await waitFor(() => expect(document.querySelector('[data-glass-backdrop]')?.getAttribute('style')).toContain('display: block'));
  const root = document.querySelector('[data-glass-backdrop]') as HTMLElement;
  expect((root.querySelector('[data-glass-layer="fallback"]') as HTMLElement).style.display).toBe('block');
  const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
  await scripts.lifecycle.dispose();
  expect(signal.aborted).toBe(true);
  expect(document.querySelector('[data-glass-backdrop]')).toBeNull();
  expect(document.querySelector('style[data-glass]')).toBeNull();
});

it('ignores a config response arriving after the content script has been disposed', async () => {
  const response = deferred<Response>();
  vi.stubGlobal('fetch', () => response.promise);
  const scripts = await mountPluginContentScripts(app, { pluginId: 'glass' });
  await scripts.lifecycle.dispose();
  response.resolve(new Response(JSON.stringify({ ok: true, result: { ...DEFAULT_CONFIG, enabled: true } }), { status: 200 }));
  await act(async () => { await response.promise; });
  expect(document.querySelector('[data-glass-backdrop],style[data-glass]')).toBeNull();
});

it('refreshes a cross-window update that arrives while a save is in flight', async () => {
  let saved = { ...DEFAULT_CONFIG };
  const save = deferred<typeof saved>();
  slot = renderSlot(app.navPanels[0]!, { subPath: '' }, { rpc: {
    getConfig: () => saved,
    setConfig: () => save.promise,
  } });
  fireEvent.click(await slot.findByRole('switch', { name: /Enable transparency/ }));
  saved = { ...DEFAULT_CONFIG, enabled: true, dim: 49 };
  await slot.behavior.emitRealtime('glass', {});
  await act(async () => save.resolve({ ...DEFAULT_CONFIG, enabled: true }));
  await waitFor(() => expect(slot!.getByRole('slider', { name: 'Dimming' })).toHaveProperty('value', '49'));
});
