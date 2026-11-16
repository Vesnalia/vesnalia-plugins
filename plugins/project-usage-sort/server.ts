// alia-plugin-project-usage-sort — keeps VesnALIA's project order sorted by how often
// each project is used.
//
// Usage is read from thread activity: every thread adds a weight that halves
// every `halfLifeDays`, so a project used often and recently rises to the top.
// The result is written to the two places VesnALIA keeps a project order:
//   - the server's project order (`projects.reorder`), which the project
//     pickers and plugin sidebars such as VesnALIA Sidebar list projects in;
//   - the built-in thread list's `sidebar.sectionOrder` UI preference.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import {
  planReorder,
  rankProjects,
  rewriteSectionOrder,
  sameOrder,
  type ProjectUsage,
  type UsageThread,
} from "./ranking";

const SECTION_ORDER_KEY = "sidebar.sectionOrder";

interface SortResult {
  ranked: (ProjectUsage & { name: string })[];
  projectMoves: number;
  sectionOrderChanged: boolean;
}

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    autoSort: {
      type: "boolean",
      label: "Sort automatically every hour",
      description: "Off keeps the current order until you run `alia project-usage-sort apply`.",
      default: true,
    },
    halfLifeDays: {
      type: "number",
      label: "Usage half-life (days)",
      description: "A thread used this many days ago counts half as much as one used today. Smaller favors recent work.",
      default: 14,
    },
    includeChildThreads: {
      type: "boolean",
      label: "Count child threads",
      description: "Off counts only threads you started, so orchestration fan-out does not inflate a project.",
      default: false,
    },
  });

  async function listThreads(): Promise<UsageThread[]> {
    const [active, archived] = await Promise.all([
      alia.sdk.threads.list({}),
      alia.sdk.threads.list({ archived: true }),
    ]);
    return [...active, ...archived].map((thread) => ({
      projectId: thread.projectId,
      parentThreadId: thread.parentThreadId,
      updatedAt: thread.updatedAt,
    }));
  }

  async function rank(): Promise<{ currentIds: string[]; ranked: SortResult["ranked"] }> {
    const { halfLifeDays, includeChildThreads } = await settings.get();
    const [projects, threads] = await Promise.all([alia.sdk.projects.list({}), listThreads()]);
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const currentIds = projects.map((project) => project.id);
    const ranked = rankProjects(currentIds, threads, {
      now: Date.now(),
      halfLifeDays,
      includeChildThreads,
    }).map((usage) => ({ ...usage, name: names.get(usage.projectId) ?? usage.projectId }));
    return { currentIds, ranked };
  }

  async function applySectionOrder(rankedIds: string[]): Promise<boolean> {
    // A concurrent drag in the sidebar bumps the revision; retry once on top of it.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { preferences } = await alia.sdk.system.uiPreferences.list();
      const entry = preferences[SECTION_ORDER_KEY];
      const next = rewriteSectionOrder(entry.value, rankedIds);
      if (sameOrder(entry.value, next)) return false;
      try {
        await alia.sdk.system.uiPreferences.set({
          key: SECTION_ORDER_KEY,
          value: next,
          expectedRevision: entry.revision,
        });
        return true;
      } catch (error) {
        if (attempt === 1) throw error;
        alia.log.warn(`sectionOrder changed while sorting; retrying: ${String(error)}`);
      }
    }
    return false;
  }

  let running: Promise<SortResult> | null = null;
  async function sortNow(): Promise<SortResult> {
    const { currentIds, ranked } = await rank();
    const rankedIds = ranked.map((usage) => usage.projectId);
    const moves = planReorder(currentIds, rankedIds);
    for (const move of moves) {
      await alia.sdk.projects.reorder(move);
    }
    const sectionOrderChanged = await applySectionOrder(rankedIds);
    alia.log.info(`sorted projects by usage: ${moves.length} move(s), sectionOrder ${sectionOrderChanged ? "updated" : "unchanged"}`);
    return { ranked, projectMoves: moves.length, sectionOrderChanged };
  }
  // The schedule, install hook, and CLI can overlap; share one run.
  function sortOnce(): Promise<SortResult> {
    running ??= sortNow().finally(() => {
      running = null;
    });
    return running;
  }

  alia.background.schedule("sort-projects", "17 * * * *", async () => {
    if (!(await settings.get()).autoSort) return;
    await sortOnce();
  });

  alia.onInstall(async () => {
    await sortOnce();
  });

  function formatRanking(ranked: SortResult["ranked"]): string {
    const width = Math.max(...ranked.map((usage) => usage.name.length), 4);
    return ranked
      .map((usage, index) => {
        const last = usage.lastUsedAt === null ? "-" : new Date(usage.lastUsedAt).toISOString().slice(0, 10);
        return `${String(index + 1).padStart(2)}. ${usage.name.padEnd(width)}  score ${usage.score.toFixed(2).padStart(6)}  threads ${String(usage.threadCount).padStart(4)}  last ${last}`;
      })
      .join("\n");
  }

  const usage = [
    "Usage:",
    "  VesnALIA project-usage-sort preview [--json]   Show the usage ranking without changing anything",
    "  VesnALIA project-usage-sort apply [--json]     Sort the project order by usage now",
  ].join("\n");

  alia.cli.register({
    name: "project-usage-sort",
    summary: "Sort VesnALIA's project order by how often each project is used",
    commands: [
      {
        name: "preview",
        summary: "Show the usage ranking without changing anything",
        usage: "alia project-usage-sort preview [--json]",
      },
      {
        name: "apply",
        summary: "Sort the project order by usage now",
        usage: "alia project-usage-sort apply [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...rest] = argv.filter((arg) => arg !== "--json");
      if (rest.length > 0) return { exitCode: 1, stderr: usage };
      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "preview": {
          const { ranked } = await rank();
          return { exitCode: 0, stdout: json ? JSON.stringify(ranked) : formatRanking(ranked) };
        }
        case "apply": {
          const result = await sortOnce();
          const summary = `Moved ${result.projectMoves} project(s); sidebar section order ${result.sectionOrderChanged ? "updated" : "already sorted"}.`;
          return {
            exitCode: 0,
            stdout: json ? JSON.stringify(result) : `${formatRanking(result.ranked)}\n\n${summary}`,
          };
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });
}
