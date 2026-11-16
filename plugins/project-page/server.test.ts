import { afterEach, expect, test } from "vitest";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@vesnalia/plugin-sdk/testing";
import plugin from "./server";
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });
async function setup({ files = ['README.md'], fail = false, size = 10 } = {}) {
  const { alia, harness } = createFakePluginHost({
    pluginId: 'project-page',
    sdk: { projects: {
      get: async () => ({ id: 'p1', name: 'Project', createdAt: 0, updatedAt: 0, kind: 'standard', gitRemoteUrl: 'git@github.com:jem/project.git', sources: [{ id: 'source', projectId: 'p1', hostId: 'remote-host', path: '/repo', isDefault: true, type: 'local_path', createdAt: 0, updatedAt: 0 }] }),
      files: async () => { if (fail) throw new Error('Host is offline'); return { files: files.map(path => ({ name: path, path })), truncated: false }; },
      fileContent: async () => ({ content: '# Real readme', contentEncoding: 'utf8', mimeType: 'text/markdown', sizeBytes: size }),
    } },
  });
  plugin(alia); disposers.push(() => harness.lifecycle.dispose()); return harness;
}
test('reads from the project source host and returns the shared page contract', async () => {
  const h = await setup();
  const page = await h.behavior.callRpc('page', { projectId: 'p1' });
  expect(page).toMatchObject({ readme: { path: 'README.md', content: '# Real readme' }, error: null, repositoryUrl: 'https://github.com/jem/project' });
  expect(h.inspection.sdk.callsTo('projects.fileContent')[0]?.[0]).toEqual({ projectId: 'p1', hostId: 'remote-host', path: 'README.md' });
});
test('distinguishes missing README from unavailable host and oversized content', async () => {
  const missing = await setup({ files: [] });
  expect(await missing.behavior.callRpc('page', { projectId: 'p1' })).toMatchObject({ readme: null, error: null });
  const offline = await setup({ fail: true });
  expect(await offline.behavior.callRpc('page', { projectId: 'p1' })).toMatchObject({ readme: null, error: 'Host is offline' });
  const huge = await setup({ size: 600000 });
  expect(await huge.behavior.callRpc('page', { projectId: 'p1' })).toMatchObject({ readme: null, error: expect.stringContaining('too large') });
});
test('imports only public SDK surfaces', async () => {
  const result = await experimental_scanPublicSdkOnly(process.cwd(), { allow: [/^react$/] });
  expect(result.violations).toEqual([]); expect(result.privateDependencies).toEqual([]);
});
