import { definePluginApp } from '@vesnalia/plugin-sdk/app';
import dictionary from './dictionary.json';
import templateRules from './template-rules.json';
import contextRules from './context-rules.json';
import { mountChinese } from './localize';
export default definePluginApp((app) => {
  app.contentScripts.register({
    id: 'chinese-interface',
    mount: ({ signal }) => mountChinese(document, dictionary, signal, templateRules, contextRules),
  });
});
