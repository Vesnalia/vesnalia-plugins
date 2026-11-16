import type { PluginSidebarProject, PluginSidebarSection } from "@vesnalia/plugin-sdk/app";

import type { Chat } from "@/lib/model";

/** What the editor counts and offers: the list's chats, projects and sections. */
export interface EditorData {
  rows: readonly Chat[];
  /** Projects with chats, in order of use. */
  projects: readonly PluginSidebarProject[];
  sections: readonly PluginSidebarSection[];
  now: number;
}
