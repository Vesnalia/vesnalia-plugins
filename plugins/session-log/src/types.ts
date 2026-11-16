import type { PluginBrowserAliaSdk } from "@vesnalia/plugin-sdk/app";

type TimelineRead = Awaited<ReturnType<PluginBrowserAliaSdk["threads"]["timeline"]>>;
/** A whole window of the timeline: the latest one, or an older page. */
export type TimelineResponse = Exclude<TimelineRead, { delta: unknown }>;
/** VesnALIA's answer to `afterTag`: what changed since the latest window that carried that tag. */
export type TimelineDeltaResponse = Extract<TimelineRead, { delta: unknown }>;
export type TimelineDelta = TimelineDeltaResponse["delta"];
export type TimelineRow = TimelineResponse["rows"][number];
export type TimelinePage = TimelineResponse["timelinePage"];
export type ActiveThinking = NonNullable<TimelineResponse["activeThinking"]>;
export type ThreadEventRow = Awaited<ReturnType<PluginBrowserAliaSdk["threads"]["events"]["list"]>>[number];

export type SessionLogSdk = Pick<PluginBrowserAliaSdk, "subscribe"> & {
  threads: Pick<PluginBrowserAliaSdk["threads"], "timeline" | "get"> & {
    events: Pick<PluginBrowserAliaSdk["threads"]["events"], "list">;
  };
};
