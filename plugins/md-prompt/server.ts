import { cliCommand, defineCli, defineRpcContract, type AliaPluginApi } from '@vesnalia/plugin-sdk';
import { z } from 'zod';

const modeSchema = z.enum(['on', 'off', 'toggle']);
const statusSchema = z.object({ enabled: z.boolean() });

export const rpcContract = defineRpcContract({
  setMode: { input: z.object({ mode: modeSchema }).strict(), output: statusSchema },
});

export default function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    enabled: {
      type: 'boolean',
      label: 'Markdown highlighting',
      description: 'Style Markdown and code as you type. Your prompt text stays exactly as typed.',
      default: true,
    },
  });

  // Serialize read-modify-write toggles arriving from different windows.
  let pending = Promise.resolve();
  function setMode(mode: z.infer<typeof modeSchema>) {
    const result = pending.then(async () => {
      const current = await settings.get();
      return settings.experimental_set({ enabled: mode === 'toggle' ? !current.enabled : mode === 'on' });
    });
    pending = result.then(() => undefined, () => undefined);
    return result;
  }
  alia.rpc.register(rpcContract, { setMode: ({ mode }) => setMode(mode) });

  function command(mode: z.infer<typeof modeSchema> | 'status') {
    return cliCommand({
      summary: mode === 'status' ? 'Show the saved Markdown highlighting mode' : `Set Markdown highlighting: ${mode}`,
      options: { json: { type: 'boolean', description: 'Emit machine-readable JSON' } },
      async run(input) {
        const result = mode === 'status' ? await settings.get() : await setMode(mode);
        return {
          exitCode: 0,
          stdout: input.options.json ? JSON.stringify(result) : `Markdown highlighting is ${result.enabled ? 'on' : 'off'}.`,
        };
      },
    });
  }
  alia.cli.register(defineCli({
    name: 'md-prompt',
    summary: 'Control live Markdown highlighting in VesnALIA composers',
    commands: {
      status: command('status'), on: command('on'), off: command('off'), toggle: command('toggle'),
    },
  }));
}
