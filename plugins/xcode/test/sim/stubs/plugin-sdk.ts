/**
 * Runtime stand-in for `@vesnalia/plugin-sdk`'s two value exports.
 *
 * The plugin's `types/alia-plugin-sdk.d.ts` is a declaration file with no runtime
 * behind it — VesnALIA supplies the implementation in-process. Under vitest the two
 * values the plugin actually imports are trivially reproducible, so this stub
 * is a faithful stand-in rather than a mock: `defineRpcContract` really is
 * identity in the host, and the byte ceiling really is this number.
 */

/** The host's own value, from `@vesnalia/plugin-sdk`. */
export const PLUGIN_CLI_OUTPUT_MAX_BYTES = 1_048_576;

export function defineRpcContract<T>(contract: T): T {
  return contract;
}

/**
 * The host's own `experimental_defineHostEntry`, reproduced: it only stamps
 * the API version and copies the declared parts.
 */
export function experimental_defineHostEntry<T extends {
  contract: unknown;
  handlers: unknown;
  experimental_signals?: unknown;
  dispose?: unknown;
}>(args: T): T & { experimental_apiVersion: 1 } {
  return {
    experimental_apiVersion: 1,
    contract: args.contract,
    handlers: args.handlers,
    ...(args.experimental_signals === undefined
      ? {}
      : { experimental_signals: args.experimental_signals }),
    ...(args.dispose === undefined ? {} : { dispose: args.dispose }),
  } as T & { experimental_apiVersion: 1 };
}

export type AliaPluginApi = unknown;
export type JsonValue = unknown;
