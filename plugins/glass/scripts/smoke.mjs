// Run only against an isolated VesnALIA instance. This creates/deletes test shaders
// and changes that instance's appearance settings.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.env.GLASS_TEST_ALIA_URL;
if (!base) throw new Error('Set GLASS_TEST_ALIA_URL to an isolated VesnALIA instance; never use your normal VesnALIA server.');
const shots = '.impeccable/review';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const errors = [];
async function open(width, height, scheme = 'light') {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, isMobile: width < 768, hasTouch: width < 768 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/plugins/glass/glass`);
  await page.getByRole('heading', { name: 'Backdrop library' }).waitFor();
  await page.waitForFunction(() => !!document.querySelector('style[data-glass]')?.textContent);
  return page;
}
async function rpc(page, method, input = null) {
  const body = await page.evaluate(async ({ method, input }) => {
    const response = await fetch(`/api/v1/plugins/glass/rpc/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    return response.json();
  }, { method, input });
  assert.equal(body.ok, true, JSON.stringify(body)); return body.result;
}
const opaque = (color) => /^rgb\([^)]*\)$/.test(color) || /, 1\)$/.test(color);
try {
  const desktop = await open(1360, 1050, 'dark');
  await rpc(desktop, 'setConfig', { enabled: true, opacity: 55, sidebarOpacity: 60, modalFrost: true, modalBlur: 0, animate: false });
  for (const width of [320, 390, 600, 767]) {
    const page = await open(width, 844);
    await page.waitForTimeout(100);
    const backgrounds = await page.locator('[data-sidebar=inset], [data-sidebar=panel], [role=dialog]').evaluateAll((elements) => elements.map((e) => getComputedStyle(e).backgroundColor));
    assert.ok(backgrounds.every(opaque), `${width}px leaks: ${backgrounds.join(', ')}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
    await page.getByRole('button', { name: 'Toggle sidebar (Ctrl + \\)', exact: true }).click();
    await page.waitForTimeout(250);
    assert.ok(opaque(await page.locator('[data-sidebar=panel]').evaluate((e) => getComputedStyle(e).backgroundColor)));
    await page.close();
  }
  // The same window regains the saved transparency above VesnALIA's compact breakpoint.
  const resize = await open(390, 844);
  await resize.setViewportSize({ width: 1024, height: 844 });
  await resize.waitForFunction(() => getComputedStyle(document.querySelector('[data-sidebar=inset]')).backgroundColor.endsWith('0.55)'));
  await resize.close();
  console.log('PASS compact opacity at 320, 390, 600, 767px; desktop restoration; no overflow');

  await desktop.getByRole('tab', { name: 'Shader', exact: true }).click();
  const source = desktop.getByLabel('Fragment shader');
  const starter = await source.inputValue();
  await source.fill('void mainImage(out vec4 color, in vec2 fragCoord) { color = nonsense; }');
  await desktop.getByRole('button', { name: 'Preview shader', exact: true }).click();
  await desktop.locator('.glass-compiler-error').waitFor();
  assert.equal(await desktop.getByRole('button', { name: 'Save & use', exact: true }).isEnabled(), false);
  assert.notEqual((await rpc(desktop, 'getConfig')).style, 'custom');
  await desktop.getByLabel('Import shader file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"name":"bad"}') });
  await desktop.getByRole('alert').filter({ hasText: 'version 1' }).waitFor();
  const testName = `Smoke shader ${Date.now()}`;
  await desktop.getByLabel('Import shader file').setInputFiles({ name: 'sample.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, name: testName, source: starter + '\n' })) });
  await desktop.getByRole('button', { name: 'Preview shader', exact: true }).click();
  await desktop.waitForFunction(() => [...document.querySelectorAll('button')].find(e => e.textContent === 'Save & use')?.disabled === false);
  // Editing even a valid preview invalidates its save eligibility.
  await source.fill(starter + '\n// edited');
  assert.equal(await desktop.getByRole('button', { name: 'Save & use', exact: true }).isEnabled(), false);
  await desktop.getByRole('button', { name: 'Preview shader', exact: true }).click();
  await desktop.getByRole('button', { name: 'Save & use', exact: true }).click();
  await desktop.getByRole('status').filter({ hasText: 'saved and selected' }).waitFor();
  const saved = await rpc(desktop, 'getConfig');
  const shader = saved.customShaders.find(item => item.name === testName);
  assert.ok(shader); assert.equal(saved.activeShaderId, shader.id);
  await desktop.reload(); await desktop.getByRole('button', { name: `Edit ${testName}`, exact: true }).waitFor();
  await desktop.getByRole('button', { name: 'Reset settings…', exact: true }).click();
  await desktop.getByRole('button', { name: 'Reset all settings', exact: true }).click();
  await desktop.waitForTimeout(300);
  const reset = await rpc(desktop, 'getConfig');
  assert.equal(reset.enabled, false); assert.ok(reset.customShaders.some(item => item.id === shader.id));
  await desktop.getByRole('button', { name: `Remove ${testName}`, exact: true }).click();
  assert.ok((await rpc(desktop, 'getConfig')).customShaders.some(item => item.id === shader.id));
  await desktop.getByRole('button', { name: 'Remove shader', exact: true }).click();
  await desktop.waitForTimeout(300);
  assert.ok(!(await rpc(desktop, 'getConfig')).customShaders.some(item => item.id === shader.id));
  console.log('PASS invalid GLSL/import; preview gate; edit invalidation; save/reload; reset retention; confirmed removal');

  await rpc(desktop, 'setConfig', { enabled: true, opacity: 82, sidebarOpacity: 94, modalBlur: 20, animate: false, style: 'silk', palette: 'dusk' });
  await desktop.close();
  // One capture matrix of the final appearance plus lower controls and editor.
  for (const [name, width, height, scheme] of [['desktop',1360,1050,'dark'],['desktop-light',1360,1050,'light'],['mobile',390,844,'light'],['tablet',768,1024,'dark']]) {
    const page = await open(width, height, scheme); await page.waitForTimeout(250);
    await page.screenshot({ path: `${shots}/${name}.png` });
    if (name === 'mobile') {
      await page.getByRole('button', { name: 'Toggle sidebar (Ctrl + \\)', exact: true }).click(); await page.waitForTimeout(300);
      await page.screenshot({ path: `${shots}/mobile-sidebar.png` });
      await page.getByRole('button', { name: 'Toggle sidebar (Ctrl + \\)', exact: true }).click(); await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'Show right panel', exact: true }).click(); await page.waitForTimeout(300);
      await page.screenshot({ path: `${shots}/mobile-right-panel.png` });
      await page.reload(); await page.getByRole('button', { name: 'Edit appearance', exact: true }).click();
      await page.screenshot({ path: `${shots}/mobile-controls.png` });
    }
    if (name === 'desktop') {
      await page.locator('.glass-panel').evaluate(e => { e.scrollTop = e.scrollHeight; });
      await page.screenshot({ path: `${shots}/desktop-library.png` });
      await page.getByRole('button', { name: 'Add shader', exact: true }).click();
      await page.getByRole('button', { name: 'Preview shader', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('button')].find(e => e.textContent === 'Save & use')?.disabled === false);
      await page.locator('.glass-panel').evaluate(e => { e.scrollTop = 0; });
      await page.screenshot({ path: `${shots}/desktop-shader.png` });
    }
    await page.close();
  }
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log('PASS capture matrix; zero browser runtime errors');
} finally { await browser.close(); }
