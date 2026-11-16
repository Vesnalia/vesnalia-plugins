import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import type {AliaPluginApi} from '@vesnalia/plugin-sdk';
import {z} from 'zod';

export const updateStateSchema = z.object({
  operationId: z.uuid(), startedAt: z.number().int().nonnegative(),
  hostId: z.string().min(1), terminalId: z.string().nullable(),
  state: z.enum(['starting', 'running', 'succeeded', 'failed', 'unknown']),
}).strict();
export const updateStatusSchema = updateStateSchema.nullable();
type UpdateState = z.infer<typeof updateStateSchema>;
const KEY = 'update-operation-v1';
const active = (value: UpdateState | null) => value && !['succeeded', 'failed'].includes(value.state);
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** The VesnALIA machine terminal, rather than this reloadable factory, owns the updater. */
export class PoolUpdate {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private alia: AliaPluginApi, private now = Date.now) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn); this.tail = result.catch(() => {}); return result;
  }
  private async read(): Promise<UpdateState | null> {
    const raw = await this.alia.storage.kv.get(KEY);
    return raw == null ? null : updateStateSchema.parse(raw);
  }
  private async refresh(): Promise<UpdateState | null> {
    const value = await this.read();
    if (!active(value)) return value;
    try {
      if (value!.terminalId === null) {
        const matches=(await this.alia.sdk.terminals.list({scope:{kind:'host_path',hostId:value!.hostId}})).sessions
          .filter(terminal=>terminal.hostId===value!.hostId&&terminal.title===`Pool update ${value!.operationId}`);
        if(matches.length!==1)return {...value!,state:'unknown'};
        value!.terminalId=matches[0]!.id;
      }
      const terminal = await this.alia.sdk.terminals.get({terminalId: value!.terminalId});
      const state = terminal.status === 'exited'
        ? terminal.exitCode === 0 ? 'succeeded' : 'failed'
        : terminal.status === 'disconnected' ? 'unknown' : 'running';
      const next = {...value!, state} as UpdateState;
      await this.alia.storage.kv.set(KEY, next);
      return next;
    } catch { return {...value!, state: 'unknown'}; }
  }
  status() { return this.serial(() => this.refresh()); }
  start() { return this.serial(async () => {
    const existing = await this.refresh();
    if (active(existing)) return existing;
    const alia = this.alia;
    const plugin = (await alia.sdk.plugins.list()).plugins.find(value => value.id === alia.pluginId);
    const hostId = (await alia.sdk.system.config()).primaryHostId;
    if (!plugin?.enabled || !hostId) throw Error('Pool update is unavailable on this server');
    // Git installations retain the repository scripts alongside the plugin.
    // No command, path, version or host is accepted from the browser.
    const script = path.resolve(plugin.rootDir, '../../scripts/upgrade-pool.sh');
    if (!(await fs.stat(script)).isFile()) throw Error('Installed pool updater is missing');
    const loopback = new URL(alia.server.loopbackBaseUrl);
    if (loopback.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(loopback.hostname)) throw Error('Pool update requires the local server');
    // Check the independent session queue barrier before any interruption.
    if (!(await alia.sdk.plugins.list()).plugins.some(value=>value.id==='pool-maintenance'&&value.enabled))
      throw Error('Enable the session maintenance plugin before updating the pool');
    const value: UpdateState = {operationId: randomUUID(), startedAt: this.now(), hostId, terminalId: null, state: 'starting'};
    // VesnALIA removes the previous Git checkout during update. Freeze this accepted
    // updater outside that cache, including its imports and working directory.
    const operationRoot=path.join(alia.server.experimental_dataDir,'plugins',alia.pluginId,'updates',value.operationId);
    await fs.mkdir(operationRoot,{recursive:true,mode:0o700});
    for(const name of ['upgrade-pool.sh','upgrade_pool.py','pool_session_pause.py','upgrade_pool_sandbox.py']){
      const target=path.join(operationRoot,name);
      await fs.copyFile(path.join(path.dirname(script),name),target,constants.COPYFILE_EXCL);
      await fs.chmod(target,0o600);
    }
    const operatorKeyFile=path.join(alia.server.experimental_dataDir,'plugins',alia.pluginId,'secrets','accounts','management','operator.env');
    const frozenScript=path.join(operationRoot,'upgrade-pool.sh');
    await alia.storage.kv.set(KEY, value);
    try {
      const terminal = await alia.sdk.terminals.create({cols:100,rows:28,
        title:`Pool update ${value.operationId}`,
        scope:{kind:'host_path',hostId,cwd:operationRoot},
        start:{mode:'command',command:`env ALIA_SERVER_URL=${quote(loopback.origin)} bash ${quote(frozenScript)} --pause-sessions --operator-key-file ${quote(operatorKeyFile)}`}});
      const next: UpdateState = {...value,terminalId:terminal.id,state:'running'};
      await alia.storage.kv.set(KEY,next);
      return next;
    } catch {
      // Creation can have succeeded despite a lost response. Never launch twice.
      await alia.storage.kv.set(KEY,{...value,state:'unknown'});
      throw Error('Update launch outcome is unknown; inspect the VesnALIA machine terminal before retrying');
    }
  }); }
}
