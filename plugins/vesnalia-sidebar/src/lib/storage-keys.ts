// Lower priorities are evicted first. Existing keys and versions are durable.
export const STORAGE_KEYS = {
  // Runtime start stamps for duration labels.
  workingSince: { key: "alia-sidebar:working-since:v1", evictionPriority: 10 },
  // Last RPC inbox order.
  inboxOrder: { key: "alia-sidebar:inbox-order-cache:v1", evictionPriority: 20 },
  // Last RPC lifecycle rows.
  lifecycle: { key: "alia-sidebar:lifecycle-cache:v1", evictionPriority: 30 },
  // Expanded child parent IDs.
  childExpansion: { key: "alia-sidebar:child-expansion:v1", evictionPriority: 40 },
  // Collapsed project IDs.
  projectCollapse: { key: "alia-sidebar:project-collapse:v1", evictionPriority: 50 },
  // Selected projects in this window's session storage; empty means all.
  projectScope: { key: "alia-sidebar:project-scope:v1", evictionPriority: 85 },
  // Project shortcuts saved on this device, in pin order.
  pinnedProjects: { key: "alia-sidebar:pinned-projects:v1", evictionPriority: 90 },
  // Project slots in the Active shelf's project view, on this device.
  projectOrder: { key: "alia-sidebar:project-order:v1", evictionPriority: 88 },
  environmentCollapse: { key: "alia-sidebar:environment-collapse:v1", evictionPriority: 55 },
  environmentGrouping: { key: "alia-sidebar:environment-grouping:v1", evictionPriority: 71 },
  // Whether a project with one Active thread still gets a header.
  singleThreadProjectGrouping: { key: "alia-sidebar:single-thread-project-grouping:v1", evictionPriority: 72 },
  // Shelf disclosure booleans.
  shelfExpansion: { key: "alia-sidebar:shelf-expansion:v1", evictionPriority: 60 },
  // Active shelf sort mode.
  activeSort: { key: "alia-sidebar:active-sort:v1", evictionPriority: 70 },
  // Last RPC sidebar settings.
  settings: { key: "alia-sidebar:settings-cache:v1", evictionPriority: 80 },
  // Read-only legacy project grouping migration.
  activeGrouping: { key: "alia-sidebar:active-grouping:v1", evictionPriority: 65 },
  // Machine selected for port links on this device.
  portLinkHost: { key: "alia-sidebar:port-link-host:v1", evictionPriority: 75 },
} as const;

export const PLUGIN_STORAGE_KEYS = Object.values(STORAGE_KEYS)
  .sort((a, b) => a.evictionPriority - b.evictionPriority)
  .map(({ key }) => key);
