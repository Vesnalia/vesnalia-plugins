import type { AliaPluginApi } from '@vesnalia/plugin-sdk';
import { hostContract, rpcContract, type GraphProject, type GraphThread } from './contract.js';

export default async function plugin(alia: AliaPluginApi) {
  const host = alia.hosts.experimental_client({ contract: hostContract });
  async function snapshot() {
    const [projects, threads] = await Promise.all([alia.sdk.projects.list(), alia.sdk.threads.list({ limit: 10000 })]);
    const results: GraphProject[] = [];
    const placed = new Set<string>();
    const asThread = (thread: typeof threads[number], scope: GraphThread['scope']): GraphThread => ({
      id: thread.id, title: thread.title ?? thread.titleFallback ?? thread.id,
      status: thread.status, path: thread.environmentPath ?? null, archivedAt: thread.archivedAt ?? null, scope,
    });
    for (const project of projects) {
      if (project.kind !== 'standard') continue;
      for (const source of project.sources) {
        let scan: { trees: GraphProject['trees']; branches: string[]; error: string | null };
        try { scan = await host.call('scan', { root: source.path }, { hostId: source.hostId }); }
        catch (cause) { scan = { trees: [], branches: [], error: cause instanceof Error ? cause.message.slice(0, 250) : 'Host unavailable' }; }
        const paths = new Set(scan.trees.map(tree => tree.path));
        const related = threads.filter(thread => thread.projectId === project.id && thread.environmentHostId === source.hostId && !!thread.environmentPath && paths.has(thread.environmentPath));
        for (const thread of related) placed.add(thread.id);
        results.push({ id: project.id, name: project.name, root: source.path, hostId: source.hostId, ...scan, threads: related.map(thread => asThread(thread, 'checkout')) });
      }
    }
    const unplacedThreads = threads.filter(thread => !placed.has(thread.id)).map(thread => asThread(thread, thread.projectId === 'proj_personal' ? 'personal' : 'unmatched'));
    return { projects: results, unplacedThreads, generatedAt: new Date().toISOString() };
  }
  alia.rpc.register(rpcContract, {
    graph_snapshot: snapshot,
    graph_inspect: async ({ root, path, branch, hostId }) => {
      const projects = await alia.sdk.projects.list();
      if (!projects.some(project => project.kind === 'standard' && project.sources.some(source => source.path === root && source.hostId === hostId))) throw new Error('Source is not a registered project checkout.');
      return host.call('inspect', { root, path, branch }, { hostId });
    },
  });
  alia.cli.register({ name: 'branch-graph', summary: 'Read the local Git worktree graph', commands: [{ name: 'snapshot', summary: 'Print graph snapshot as JSON', usage: 'alia branch-graph snapshot --json' }], async run(argv) {
    if (argv[0] === 'snapshot') return { exitCode: 0, stdout: JSON.stringify(await snapshot()) };
    return { exitCode: 0, stdout: 'Usage: VesnALIA branch-graph snapshot --json' };
  } });
}
