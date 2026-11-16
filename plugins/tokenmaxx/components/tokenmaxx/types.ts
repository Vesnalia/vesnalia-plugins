import type { PluginState } from "../../server";

export type TokenmaxxState = PluginState;
export type Snapshot = NonNullable<PluginState["snapshot"]>;
export type Account = Snapshot["accounts"][number];
export type UsageSnapshot = Snapshot["usage"][number];
export type UsageWindow = UsageSnapshot["windows"][number];
export type ProviderState = Snapshot["providers"][number];
export type ProviderId = ProviderState["provider"];
export type Tokens = NonNullable<PluginState["tokens"]>;
export type Timeframe = Tokens["timeframes"][number];
