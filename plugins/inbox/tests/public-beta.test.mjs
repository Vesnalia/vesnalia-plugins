import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakePluginHost } from '@vesnalia/plugin-sdk/testing';
import plugin from '../server.ts';

test('public beta cannot enable remote actions through old Telegram reply settings', async () => {
  const { alia, harness } = createFakePluginHost({
    pluginId: 'inbox',
    settings: { telegramReplies: true, telegramBotToken: 'synthetic-test-token', telegramChatId: '123' },
  });
  try {
    await plugin(alia);
    assert.equal(harness.registrations.services.some(service => service.name === 'telegram-inbound'), false);
  } finally {
    await harness.lifecycle.dispose();
  }
});
