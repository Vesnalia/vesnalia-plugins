import { expect, it } from 'vitest';
import { createFakePluginHost, experimental_scanPublicSdkOnly } from '@vesnalia/plugin-sdk/testing';
import plugin from './server';
it('rejects invalid volume values',async()=>{
 const {alia,harness}=createFakePluginHost({pluginId:'typewriter'});
 plugin(alia);
 await expect(harness.behavior.setSettings({volume:101})).rejects.toThrow();
 await expect(harness.behavior.setSettings({volume:-1})).rejects.toThrow();
 await harness.behavior.setSettings({enabled:true,volume:50});
 await harness.lifecycle.dispose();
});
it('depends only on public SDK and declared packages',async()=>{
 const result=await experimental_scanPublicSdkOnly(process.cwd(), {allow:[/^react$/, /^fake-indexeddb\/auto$/]});
 expect(result.violations).toEqual([]);expect(result.privateDependencies).toEqual([]);
});
