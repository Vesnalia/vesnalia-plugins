// alia-plugin-hmm-floating-terminal — backend.
//
// VesnALIA already owns the PTYs: `alia.sdk.terminals` starts a session and the host
// streams it at `/ws/terminals/<id>`. This server therefore only decides *which*
// sessions a scope has, and creates or closes them; the frontend attaches to the
// host socket directly instead of proxying every byte through the plugin.
//
// The scope is the project's checkout, not a thread. A thread-scoped session
// would vanish the moment the user opened another thread in the same project,
// stranding a running dev script in a scope nothing links back to.
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

/** Marks the sessions this plugin owns, so terminals opened in VesnALIA's own panel
 *  are never hijacked by the floating window. Tabs are `<TITLE> <n>`. */
const TITLE = "Hmm floating terminal";

/** Every scope is a project: VesnALIA has no thread without one, and the window is
 *  hidden wherever no project is open. */
const scopeInput = z.object({ projectId: z.string().min(1) }).strict();

const tabOutput = z
  .object({ terminalId: z.string(), label: z.string(), cwd: z.string() })
  .strict();

export const rpcContract = defineRpcContract({
  session_list: {
    input: scopeInput,
    output: z.object({ tabs: z.array(tabOutput) }).strict(),
  },
  session_create: {
    input: scopeInput.extend({
      cols: z.number().int().min(1),
      rows: z.number().int().min(1),
    }),
    output: tabOutput,
  },
  session_close: {
    input: z.object({ terminalId: z.string().min(1) }).strict(),
    output: z.object({}).strict(),
  },
});

/** `"Floating terminal 3"` → `"Terminal 3"`; anything else stays as it is. */
function labelOf(title: string): string {
  return title.startsWith(TITLE) ? `Terminal${title.slice(TITLE.length)}` : title;
}

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");

  // ponytail: the project's default source wins; add a source picker if a
  // multi-checkout project ever needs a terminal per checkout.
  const scopeOf = async (projectId: string) => {
    const { sources } = await alia.sdk.projects.get({ projectId });
    const source = sources.find((one) => one.isDefault) ?? sources[0];
    if (source === undefined) {
      throw new Error("Project has no checkout to open a terminal in");
    }
    return {
      kind: "host_path",
      hostId: source.hostId,
      cwd: source.path,
    } as const;
  };

  /** The plugin's own live sessions in one scope, in VesnALIA's order. */
  const own = async (projectId: string) => {
    const { sessions } = await alia.sdk.terminals.list({
      scope: await scopeOf(projectId),
    });
    return sessions.filter(
      (session) =>
        session.title !== null &&
        session.title.startsWith(TITLE) &&
        (session.status === "running" || session.status === "starting"),
    );
  };

  alia.rpc.register(rpcContract, {
    // Reopening the window reattaches to the live shells: closing it must not
    // cost the user their history, their ssh session, or a running build.
    session_list: async ({ projectId }) => ({
      tabs: (await own(projectId)).map((session) => ({
        terminalId: session.id,
        label: labelOf(session.title ?? TITLE),
        cwd: session.initialCwd,
      })),
    }),

    session_create: async ({ cols, rows, projectId }) => {
      const taken = new Set(
        (await own(projectId)).map((session) => session.title),
      );
      let index = 1;
      while (taken.has(`${TITLE} ${index}`)) {
        index += 1;
      }
      const title = `${TITLE} ${index}`;
      const created = await alia.sdk.terminals.create({
        cols,
        rows,
        scope: await scopeOf(projectId),
        title,
      });
      alia.log.info(`opened ${created.id} in ${created.initialCwd}`);
      return {
        terminalId: created.id,
        label: labelOf(title),
        cwd: created.initialCwd,
      };
    },

    session_close: async ({ terminalId }) => {
      await alia.sdk.terminals.close({ terminalId, mode: "force" });
      return {};
    },
  });

  alia.onDispose(() => {
    alia.log.info("disposed");
  });
}
