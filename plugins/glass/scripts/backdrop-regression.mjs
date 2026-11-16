// Pixel regression for the actual composited global backdrop; isolated VesnALIA only.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.GLASS_TEST_ALIA_URL;
if (!base) throw new Error('Set GLASS_TEST_ALIA_URL to an isolated VesnALIA server.');
const executablePath = process.env.GLASS_TEST_CHROME_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : { args: ['--enable-unsafe-swiftshader'] }) });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
async function rpc(method, input = null) {
  const response = await page.request.post(`${base}/api/v1/plugins/glass/rpc/${method}`, { data: input });
  const body = await response.json(); assert.equal(body.ok, true); return body.result;
}
let previous;
const id = `pixel-check-${Date.now()}`;
try {
  await page.goto(`${base}/`);
  previous = await rpc('getConfig');
  await rpc('setConfig', { enabled: true, animate: false, blur: 0, dim: 0, grain: 0 });
  const shots = [], hostShots = [];
  for (const [label, color] of [['red', '1.0,0.0,0.0'], ['blue', '0.0,0.0,1.0']]) {
    await rpc('saveShader', { shader: { id, name: 'Pixel check', source: `void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(${color},1.0); }` }, activate: true });
    // Wait for the independent content script poll, then test its composited
    // output above the app chrome without changing any internal layer order.
    await page.waitForTimeout(1400);
    await page.evaluate(() => { document.querySelector('[data-glass-backdrop]').style.zIndex = '-1'; });
    hostShots.push(await page.screenshot({ clip: { x: 950, y: 350, width: 40, height: 40 } }));
    await page.evaluate(() => { document.querySelector('[data-glass-backdrop]').style.zIndex = '999999'; });
    assert.ok(await page.locator('[data-glass-backdrop] canvas').count());
    if (label === 'red') console.log('Graphics renderer:', await page.evaluate(() => {
      const gl = document.querySelector('[data-glass-backdrop] canvas').getContext('webgl');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }));
    shots.push(await page.screenshot({ clip: { x: 450, y: 350, width: 40, height: 40 } }));
    console.log(`Captured ${label} shader composited output`);
  }
  assert.equal(shots[0].equals(shots[1]), false, 'Changing red to blue must change the visible global backdrop; an opaque fallback must not cover the shader.');
  assert.equal(hostShots[0].equals(hostShots[1]), false, 'The actual VesnALIA reading surface must reveal the selected backdrop.');
  // Context loss should reveal the fallback, and a restored context should
  // recover the selected shader without another settings edit.
  await page.evaluate(() => { window.__glassTestContext = document.querySelector('[data-glass-backdrop] canvas').getContext('webgl').getExtension('WEBGL_lose_context'); window.__glassTestContext.loseContext(); });
  await page.waitForTimeout(100);
  const fallback = await page.screenshot({ clip: { x: 450, y: 350, width: 40, height: 40 } });
  assert.equal(fallback.equals(shots[1]), false, 'Context loss must reveal a usable fallback.');
  await page.evaluate(() => window.__glassTestContext.restoreContext());
  await page.waitForTimeout(200);
  const restored = await page.screenshot({ clip: { x: 450, y: 350, width: 40, height: 40 } });
  assert.ok(restored.equals(shots[1]), 'The selected shader must reappear after context restoration.');
  console.log('PASS shader changes affect visible pixels; context loss fallback and recovery work');
} finally {
  if (previous) { await rpc('deleteShader', { id }); const { customShaders, ...settings } = previous; await rpc('setConfig', settings); }
  await browser.close();
}
