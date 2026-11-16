import fs from 'node:fs/promises';
import path from 'node:path';
import type { AliaPluginApi, PluginRpcHandlers } from '@vesnalia/plugin-sdk';
import { createAccountPoolPlugin as createPlugin, type AccountPoolPluginOptions } from './server.js';
import { accountPoolRpcContract } from './rpc.js';
import { managementRpcContract } from './management-wire.js';
export { helloResponse, type AccountPoolPluginOptions } from './server.js';

export function createAccountPoolPlugin(options: AccountPoolPluginOptions = {}) {
  return async (alia: AliaPluginApi) => {
    let handlers: PluginRpcHandlers<typeof managementRpcContract>;
    let key: string;
    const withGrant = async <T>(action: (token: string) => Promise<T>): Promise<T> => {
      const grant = await handlers['management.unlock']({ key, scope: 'manage', ttlSeconds: 900 });
      try { return await action(grant.token); }
      finally { await handlers['management.lock']({ token: grant.token }); }
    };
    const api: AliaPluginApi = {
      ...alia,
      rpc: { register(contract, registered, registrationOptions) {
        if (Object.hasOwn(contract, 'management.unlock')) handlers = registered as unknown as typeof handlers;
        const wrapped = Object.fromEntries(Object.entries(registered).map(([method, handler]) => [method,
          Object.hasOwn(accountPoolRpcContract, method) ? (input: unknown) => withGrant(async token => {
            const result = await handlers['management.call']({ token, method, input });
            if (!result.ok) throw Error('Test operator grant refused');
            return result.result;
          }) : handler,
        ])) as typeof registered;
        alia.rpc.register(contract, wrapped, registrationOptions);
      } },
      cli: { register(registration) {
        alia.cli.register({ ...registration, run: (argv, context) => withGrant(async token =>
          registration.run(['management', 'execute', '--request', JSON.stringify({ token, argv })], context)),
        });
      } },
    };
    await createPlugin(options)(api);
    key = (await fs.readFile(path.join(alia.server.experimental_dataDir, 'plugins', alia.pluginId, 'secrets', 'accounts', 'management', 'operator.env'), 'utf8')).trim().split('=')[1]!;
  };
}
