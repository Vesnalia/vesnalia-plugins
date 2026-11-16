import { definePluginApp } from '@vesnalia/plugin-sdk/app';
import { registerTablerIcons } from './icons.ts';
import { mountSignal } from './effects.ts';

export default definePluginApp(app => {
  registerTablerIcons(app);
  app.contentScripts.register({ id: 'kujo-signal', mount: mountSignal });
});
