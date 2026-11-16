// Состояния скиллов по результатам скана папок одной машины. Чистые функции —
// ничего не читает с диска, покрывается тестами.
import type { SkillState } from "./contract.js";

export interface SkillLocationScan {
  id: string;
  path: string;
  exists: boolean;
  /** Дом CLI на машине есть, а папки скиллов пока нет — раскатка её создаст. */
  parentExists?: boolean;
  entries: {
    name: string;
    kind: "dir" | "symlink";
    target: string | null;
    hash: string | null;
    mtime: number | null;
    hasSkillMd: boolean;
    /** Tree size in bytes; 0 when unknown (old snapshots). */
    bytes?: number;
    /** Size and file count as the VesnALIA host-daemon counts them (junk included). */
    aliaBytes?: number;
    aliaFiles?: number;
    /** node_modules / .venv / __pycache__ … inside the tree. */
    junk?: boolean;
  }[];
}

export interface SkillRow {
  name: string;
  locationId: string;
  state: SkillState;
  hash: string | null;
  mtime: number | null;
  canonicalMtime: number | null;
}

/**
 * Hash and mtime the per-machine canon matrix should compare. A CLI-home tree
 * that is not the canon (project symlink) is what the agent actually reads.
 */
export function effectiveCanonStamp(
  name: string,
  canonHash: string | null,
  canonMtime: number | null,
  locations: SkillLocationScan[],
): { hash: string | null; mtime: number | null } {
  for (const location of locations) {
    if (location.id === "agents" || !location.exists) continue;
    const entry = location.entries.find((item) => item.name === name && item.hasSkillMd);
    if (entry?.hash != null && entry.hash !== canonHash) {
      return { hash: entry.hash, mtime: entry.mtime };
    }
  }
  return { hash: canonHash, mtime: canonMtime };
}

export function effectiveCanonHash(
  name: string,
  canonHash: string | null,
  locations: SkillLocationScan[],
): string | null {
  return effectiveCanonStamp(name, canonHash, null, locations).hash;
}

export type CanonCellState = "same" | "differs" | "missing" | "newer" | "stale";

/** Per-machine labels for the canon matrix. Newest mtime among differing hashes is "newer"; the rest are "stale". */
export function classifyCanonHostStates(
  hosts: Array<{ hash: string | null | undefined; mtime: number | null | undefined }>,
): CanonCellState[] {
  const present = hosts.flatMap((item, index) =>
    item.hash == null ? [] : [{ index, hash: item.hash, mtime: item.mtime ?? null }],
  );
  if (present.length === 0) return hosts.map(() => "missing");
  if (new Set(present.map((item) => item.hash)).size === 1) {
    return hosts.map((item) => (item.hash == null ? "missing" : "same"));
  }
  const dated = present.filter((item) => item.mtime !== null);
  const maxMtime = dated.length === 0 ? null : Math.max(...dated.map((item) => item.mtime as number));
  const newestHashes = new Set(dated.filter((item) => item.mtime === maxMtime).map((item) => item.hash));
  const ranked = maxMtime !== null && newestHashes.size === 1;
  return hosts.map((item) => {
    if (item.hash == null) return "missing";
    if (!ranked) return "differs";
    return newestHashes.has(item.hash) ? "newer" : "stale";
  });
}

export type SkillActionMode = "adopt" | "link" | "take" | "delete" | "unlink";

export interface SkillAction {
  mode: SkillActionMode;
  label: string;
  /** Ручное действие: в «Применить все правила» не попадает — решение за человеком. */
  manual?: true;
}

/**
 * Что делать со скиллами в каждой папке. Живых домов два — канон
 * `~/.agents/skills` и `~/.claude/skills` (Claude Code читает только свой дом,
 * поэтому там симлинки).
 * - `canon` — сам канон;
 * - `link` — CLI читает только свою папку: копия заменяется симлинком в канон;
 * - `native` — CLI сам читает канон: копия просто удаляется, симлинк не нужен;
 * - `own` — свой дом со своим реестром: реальные папки не трогаем вовсе;
 * - `drop` — папку не используем вовсе: убираем и копии, и ссылки.
 */
export type LocationPolicy = "canon" | "link" | "native" | "own" | "drop";

export const LOCATION_POLICY: Record<string, LocationPolicy> = {
  agents: "canon",
  claude: "link",
  // VesnALIA держит свой реестр скиллов и заносит в него только реальные папки
  // ~/.vesnalia/skills — симлинк оттуда просто исчезает из списка alia-user, и скилл
  // пропадает из сессий VesnALIA. Поэтому эту папку правила не трогают.
  alia: "own",
  qwen: "link",
  codex: "native",
  cursor: "native",
  opencode: "native",
  // Antigravity/Gemini: скиллы здесь не держим, канон и .claude закрывают всё.
  "gemini-config": "drop",
};

export function locationPolicy(locationId: string): LocationPolicy {
  return LOCATION_POLICY[locationId] ?? "link";
}

/** Путь папки в домашнем каталоге — для интерфейса и CLI-вывода. */
export const LOCATION_PATH: Record<string, string> = {
  agents: "~/.agents/skills",
  claude: "~/.claude/skills",
  codex: "~/.codex/skills",
  "gemini-config": "~/.gemini/config/skills",
  alia: "~/.vesnalia/skills",
  opencode: "~/.config/opencode/skills",
  cursor: "~/.cursor/skills",
  qwen: "~/.qwen/skills",
};

export function locationPath(locationId: string): string {
  return LOCATION_PATH[locationId] ?? locationId;
}

/** VesnALIA host-daemon will not stage a skill tree larger than this into `$`. */
export const ALIA_INJECT_MAX_BYTES = 10 * 1024 * 1024;

/** VesnALIA host-daemon limit on files in one skill tree. */
export const ALIA_INJECT_MAX_FILES = 1000;

export function aliaInjectTooHeavy(bytes: number, files = 0): boolean {
  return bytes > ALIA_INJECT_MAX_BYTES || files > ALIA_INJECT_MAX_FILES;
}

/** Why VesnALIA would refuse this tree, or null. Human text for reports. */
export function aliaTreeProblem(bytes: number, files = 0): string | null {
  if (bytes > ALIA_INJECT_MAX_BYTES) {
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ — больше лимита ALIA 10 МБ, ALIA не примет скилл`;
  }
  if (files > ALIA_INJECT_MAX_FILES) return `${files} файлов — больше лимита ALIA ${ALIA_INJECT_MAX_FILES}, ALIA не примет скилл`;
  return null;
}

/**
 * What `$` actually stages: the real `~/.vesnalia/skills` copy if it exists,
 * otherwise the canon size that fan-out would copy there.
 */
export function aliaInjectBytes(canonBytes: number, aliaDirBytes: number | null): number {
  if (aliaDirBytes != null && aliaDirBytes > 0) return aliaDirBytes;
  return canonBytes;
}

/** Детерминированное действие по строке: null — правила нет (расходятся с равной датой). */
export function resolveRowAction(row: SkillRow): SkillAction | null {
  const policy = locationPolicy(row.locationId);
  // Дом со своим реестром разбирает сам его хозяин: автоматических правил нет.
  if (policy === "own" && row.state !== "stray-link") return null;
  const leavesLink = policy === "link";
  if (row.state === "stray-link") return { mode: "unlink", label: "Убрать ссылку" };
  // Дубль реестра VesnALIA: убирать или нет — зависит от того, запускает ли человек
  // этот CLI вне VesnALIA, поэтому правило не автоматическое.
  if (row.state === "alia-registry") return { mode: "unlink", label: "Убрать ссылку", manual: true };
  if (row.state === "only-here") {
    return { mode: "adopt", label: leavesLink ? "За канон" : "Перенести в канон" };
  }
  // Живая ссылка в проект: в канон копируем содержимое, саму ссылку не трогаем.
  if (row.state === "linked-external") {
    if (row.canonicalMtime === null) {
      return { mode: "adopt", label: leavesLink ? "За канон" : "Скопировать в канон" };
    }
    if (row.mtime !== null && row.canonicalMtime !== null && row.mtime > row.canonicalMtime) {
      return { mode: "take", label: "В канон (копия новее)" };
    }
    return null;
  }
  if (row.state === "copy") {
    return leavesLink
      ? { mode: "link", label: "Симлинк" }
      : { mode: "delete", label: "Удалить" };
  }
  if (row.state === "diverged") {
    if (row.mtime !== null && row.canonicalMtime !== null && row.mtime > row.canonicalMtime) {
      return { mode: "take", label: "В канон (копия новее)" };
    }
    if (row.mtime !== null && row.canonicalMtime !== null && row.canonicalMtime > row.mtime) {
      return {
        mode: "link",
        label: leavesLink ? "Заменить копию (канон новее)" : "Удалить копию (канон новее)",
      };
    }
    return null;
  }
  return null;
}

/**
 * Канон — папка "agents". Каждый скилл в остальных папках получает состояние:
 * симлинк в канон — "linked", ссылка в проект без канона — "only-here",
 * ссылка в проект с другим содержимым — "linked-external", реальная
 * копия — "copy" или "diverged" (по хешу папки скилла).
 * В папке с политикой "drop" любая ссылка — "stray-link": её надо убрать.
 * Особый случай: канон сам ссылается на реальную папку (симлинк в ~/.vesnalia/skills
 * и т.п.) — тогда эта реальная папка помечается "canonical-source": переносить
 * её нельзя, получится петля симлинков.
 */
export function computeSkillRows(
  canonicalPath: string,
  locations: SkillLocationScan[],
): SkillRow[] {
  const canonical = locations.find((item) => item.id === "agents");
  // имя → хеш скилла в каноне (учитываем и симлинки канона) и путь-цель канон-симлинка.
  const canonicalHashes = new Map<string, string | null>();
  const canonicalMtimes = new Map<string, number | null>();
  const canonicalTargets = new Set<string>();
  for (const entry of canonical?.entries ?? []) {
    if (!entry.hasSkillMd) continue;
    canonicalHashes.set(entry.name, entry.hash);
    canonicalMtimes.set(entry.name, entry.mtime);
    if (entry.kind === "symlink" && entry.target !== null) canonicalTargets.add(entry.target);
  }
  const rows: SkillRow[] = [];
  const prefix = canonicalPath.endsWith("/") ? canonicalPath : `${canonicalPath}/`;
  // Дом скиллов VesnALIA: ссылки сюда — это те же скиллы, которые VesnALIA и так подставляет
  // в свои сессии, поэтому в списке провайдера они выглядят вторым экземпляром.
  const aliaHome = locations.find((item) => item.id === "alia")?.path ?? null;
  const aliaPrefix = aliaHome === null ? null : aliaHome.endsWith("/") ? aliaHome : `${aliaHome}/`;
  for (const location of locations) {
    if (location.id === "agents" || !location.exists) continue;
    const policy = locationPolicy(location.id);
    for (const entry of location.entries) {
      let state: SkillState;
      if (entry.kind === "symlink") {
        if (policy === "drop") {
          state = "stray-link";
        } else if (entry.target !== null && entry.target.startsWith(prefix)) {
          state = "linked";
        } else if (aliaPrefix !== null && entry.target !== null && entry.target.startsWith(aliaPrefix)) {
          state = "alia-registry";
        } else if (!canonicalHashes.has(entry.name)) {
          // Ссылка в проект — тот же кандидат в канон, что и папка «только здесь».
          if (!entry.hasSkillMd) continue;
          state = "only-here";
        } else if (canonicalHashes.get(entry.name) === entry.hash) {
          continue;
        } else {
          state = "linked-external";
        }
      } else if (!entry.hasSkillMd) {
        continue; // мусор без SKILL.md не скилл
      } else if (canonicalTargets.has(`${location.path}/${entry.name}`)) {
        state = "canonical-source";
      } else if (!canonicalHashes.has(entry.name)) {
        state = "only-here";
      } else {
        state = canonicalHashes.get(entry.name) === entry.hash ? "copy" : "diverged";
      }
      rows.push({
        name: entry.name,
        locationId: location.id,
        state,
        hash: entry.hash,
        mtime: entry.mtime,
        canonicalMtime: canonicalMtimes.get(entry.name) ?? null,
      });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.locationId.localeCompare(b.locationId));
}

export interface PromoteToCanonOp {
  hostId: string;
  locationId: string;
  name: string;
  mode: "adopt" | "take";
}

/**
 * Newest tree wins: copy it into that machine's ~/.agents/skills. Git sync
 * then carries it to the others. Equal dates with different hashes stay manual.
 * Plugin-provided names and VesnALIA's own home are left alone.
 */
export function planPromoteToCanon(
  hosts: Array<{ hostId: string; locations: SkillLocationScan[]; pluginNames?: string[] }>,
): PromoteToCanonOp[] {
  const pluginNames = new Set(hosts.flatMap((host) => host.pluginNames ?? []));
  type Version = {
    hostId: string;
    locationId: string;
    name: string;
    hash: string;
    mtime: number;
    fromCanon: boolean;
  };
  const versions: Version[] = [];
  for (const host of hosts) {
    const canon = host.locations.find((item) => item.id === "agents");
    const canonPath = canon?.path ?? "";
    for (const entry of canon?.entries ?? []) {
      if (!entry.hasSkillMd || entry.hash == null || entry.mtime == null) continue;
      versions.push({
        hostId: host.hostId,
        locationId: "agents",
        name: entry.name,
        hash: entry.hash,
        mtime: entry.mtime,
        fromCanon: true,
      });
    }
    for (const row of computeSkillRows(canonPath, host.locations)) {
      if (locationPolicy(row.locationId) === "own") continue;
      if (row.state !== "only-here" && row.state !== "linked-external" && row.state !== "diverged") {
        continue;
      }
      if (row.hash == null || row.mtime == null) continue;
      versions.push({
        hostId: host.hostId,
        locationId: row.locationId,
        name: row.name,
        hash: row.hash,
        mtime: row.mtime,
        fromCanon: false,
      });
    }
  }
  const ops: PromoteToCanonOp[] = [];
  for (const name of [...new Set(versions.map((item) => item.name))].sort((a, b) => a.localeCompare(b))) {
    if (pluginNames.has(name)) continue;
    const candidates = versions.filter((item) => item.name === name);
    const maxMtime = Math.max(...candidates.map((item) => item.mtime));
    const top = candidates.filter((item) => item.mtime === maxMtime);
    if (new Set(top.map((item) => item.hash)).size !== 1) continue;
    if (top.some((item) => item.fromCanon)) continue;
    const winner = [...top].sort(
      (a, b) => a.hostId.localeCompare(b.hostId) || a.locationId.localeCompare(b.locationId),
    )[0]!;
    const localCanon = candidates.find((item) => item.hostId === winner.hostId && item.fromCanon);
    if (localCanon?.hash === winner.hash) continue;
    ops.push({
      hostId: winner.hostId,
      locationId: winner.locationId,
      name,
      mode: localCanon === undefined ? "adopt" : "take",
    });
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Раскатка канона по домам CLI: канон — источник правды, дома получают его
// копии и ссылки.

/**
 * Что раскатка уже разложила по домам в прошлый раз. Нужна, чтобы отличить
 * новый скилл в доме («его ещё не раскатывали») от удалённого человеком
 * («раскатывали, а теперь его нет»).
 */
export interface FanOutState {
  entries: Record<string, { hash: string | null; mirrored?: boolean }>;
}

export type FanOutOpKind =
  /** Поставить в доме симлинк на канон (Claude Code читает только свою папку). */
  | "link"
  /** Положить в доме реальную копию канона (VesnALIA заносит в реестр только папки). */
  | "mirror"
  /** Убрать из дома то, чего в каноне больше нет. */
  | "drop"
  /** Забрать в канон скилл, которого там ещё нет. */
  | "pull"
  /** Человек удалил скилл в доме — убрать его из канона, и удаление разъедется. */
  | "retire";

export interface FanOutOp {
  kind: FanOutOpKind;
  locationId: string;
  name: string;
  /** Человеческая причина — идёт в журнал бэкапов и в отчёт. */
  reason: string;
}

export interface FanOutPlan {
  ops: FanOutOp[];
  /** Имена канона после применения плана — это и есть следующее состояние. */
  nextState: FanOutState;
  /** Имена, которые уже отдаёт плагин-маркетплейс: их не дублируем. */
  skippedByPlugin: string[];
  /** Скиллы, которые VesnALIA не примет даже без мусора: в дом VesnALIA не кладём. */
  blocked: { name: string; reason: string }[];
}

export interface FanOutInput {
  canonicalPath: string;
  locations: SkillLocationScan[];
  /** Имена скиллов, которые CLI и так получает из плагинов-маркетплейсов. */
  pluginNames: string[];
  state: FanOutState;
}

interface Entry {
  name: string;
  kind: "dir" | "symlink";
  target: string | null;
  hash: string | null;
  mtime: number | null;
  hasSkillMd: boolean;
  bytes?: number;
  junk?: boolean;
}

function skillEntries(location: SkillLocationScan | undefined): Map<string, Entry> {
  const map = new Map<string, Entry>();
  for (const entry of location?.entries ?? []) {
    if (!entry.hasSkillMd) continue;
    map.set(entry.name, entry);
  }
  return map;
}

function withSlash(dir: string): string {
  return dir.endsWith("/") ? dir : `${dir}/`;
}

/**
 * План приведения домов к канону. Правила владельца: при расхождении побеждает
 * более свежая правка, удаление разъезжается по всем машинам, а имена, которые
 * отдаёт плагин-маркетплейс, в дома не дублируются.
 */
export function planFanOut(input: FanOutInput): FanOutPlan {
  const { canonicalPath, locations, state } = input;
  const plugins = new Set(input.pluginNames);
  const canonical = skillEntries(locations.find((item) => item.id === "agents"));
  const ops: FanOutOp[] = [];
  const skippedByPlugin: string[] = [];
  const retired = new Set<string>();
  const pulled = new Set<string>();
  const blocked: FanOutPlan["blocked"] = [];

  // Дом VesnALIA — единственный, где человек заводит и удаляет скиллы руками через
  // интерфейс, поэтому только он может забрать скилл в канон и увести в архив.
  const alia = locations.find((item) => item.id === "alia");
  const aliaEntries = skillEntries(alia);
  const aliaPrefix = alia === undefined ? null : withSlash(alia.path);

  for (const [name, canon] of canonical) {
    // Канон уже ссылается в дом VesnALIA: там и лежит настоящая папка, зеркалить нечего.
    const sourceInAlia =
      canon.kind === "symlink" && aliaPrefix !== null && canon.target?.startsWith(aliaPrefix) === true;
    const mirror = aliaEntries.get(name);
    // Плагин-маркетплейс уже отдаёт этот скилл в сессии VesnALIA — зеркало было бы
    // вторым экземпляром того же в списке навыков.
    const fromPlugin = plugins.has(name);
    if (fromPlugin && !skippedByPlugin.includes(name)) skippedByPlugin.push(name);
    // Канон сам по себе (мусор при копировании отбрасывается) больше лимита VesnALIA:
    // копия в дом VesnALIA только сломает старт чатов. Ничего не делаем, сообщаем.
    const canonProblem = aliaTreeProblem(canon.bytes ?? 0);
    if (alia !== undefined && alia.exists && !sourceInAlia && !fromPlugin && canonProblem !== null) {
      blocked.push({ name, reason: canonProblem });
    } else if (alia !== undefined && alia.exists && !sourceInAlia && !fromPlugin) {
      if (mirror === undefined) {
        // «Удалён человеком» — только если этот скилл мы туда раскладывали.
        // Скилл, который раньше пропускали (его отдавал плагин), просто не
        // зеркалили: его отсутствие ничего не значит и канон трогать нельзя.
        if (state.entries[name]?.mirrored === true) {
          ops.push({ kind: "retire", locationId: "alia", name, reason: "удалён в ALIA" });
          retired.add(name);
        } else {
          ops.push({ kind: "mirror", locationId: "alia", name, reason: "нет в доме ALIA" });
        }
      } else if (mirror.hash !== canon.hash) {
        const canonNewer = (canon.mtime ?? 0) >= (mirror.mtime ?? 0);
        if (canonNewer) {
          ops.push({ kind: "mirror", locationId: "alia", name, reason: "канон новее" });
        } else {
          ops.push({ kind: "pull", locationId: "alia", name, reason: "правка в ALIA новее" });
        }
      } else if (mirror.junk === true && mirror.kind === "dir") {
        // Хеш мусор не учитывает, а VesnALIA переносит его целиком: перекладываем чистую копию.
        ops.push({ kind: "mirror", locationId: "alia", name, reason: "в копии ALIA мусор (node_modules и т.п.)" });
      }
    }
    if (retired.has(name)) continue;

    for (const location of locations) {
      if (location.id === "agents" || location.id === "alia") continue;
      if (!location.exists && location.parentExists !== true) continue;
      if (locationPolicy(location.id) !== "link") continue;
      if (fromPlugin) continue;
      const here = skillEntries(location).get(name);
      if (here === undefined) {
        ops.push({ kind: "link", locationId: location.id, name, reason: "нет в доме" });
        continue;
      }
      // Реальная копия — это разбор правил вкладки «Скиллы», не дело раскатки.
      if (here.kind !== "symlink") continue;
      const target = here.target ?? "";
      const pointsToCanon =
        target.startsWith(withSlash(canonicalPath)) || target === `${canonicalPath}/${name}`;
      // Живая ссылка в проект: не переставляем на канон. Битая без SKILL.md
      // в skillEntries не попадает — её ставит ветка «нет в доме».
      if (!pointsToCanon) continue;
    }
  }

  // Скиллы дома VesnALIA, которых в каноне нет: новый — забираем, знакомый — значит
  // канон его потерял (например, удаление приехало синком), убираем зеркало.
  for (const [name, entry] of aliaEntries) {
    if (canonical.has(name)) continue;
    if (entry.kind === "symlink") continue;
    if (state.entries[name]?.mirrored === true) {
      ops.push({ kind: "drop", locationId: "alia", name, reason: "убран из канона" });
    } else {
      ops.push({ kind: "pull", locationId: "alia", name, reason: "новый скилл ALIA" });
      pulled.add(name);
    }
  }

  // Ссылки на скиллы, которых в каноне больше нет.
  for (const location of locations) {
    if (location.id === "agents" || !location.exists) continue;
    if (locationPolicy(location.id) !== "link") continue;
    for (const entry of location.entries) {
      if (entry.kind !== "symlink") continue;
      const target = entry.target;
      // Ссылка без цели — битая: канон, на который она смотрела, уже удалён.
      const pointsToCanon =
        target === null ||
        target.startsWith(withSlash(canonicalPath)) ||
        target === `${canonicalPath}/${entry.name}`;
      if (!pointsToCanon) continue;
      if (canonical.has(entry.name) && !retired.has(entry.name)) continue;
      ops.push({ kind: "drop", locationId: location.id, name: entry.name, reason: "нет в каноне" });
    }
  }

  const nextNames = new Set<string>([...canonical.keys(), ...pulled]);
  for (const name of retired) nextNames.delete(name);
  const entries: FanOutState["entries"] = {};
  for (const name of [...nextNames].sort()) {
    // Помним не только содержимое, но и факт «мы это зеркалили в дом VesnALIA»:
    // иначе смена правил выглядит как удаление скилла человеком.
    const mirrored =
      alia !== undefined &&
      alia.exists &&
      !plugins.has(name) &&
      canonical.get(name)?.kind !== "symlink";
    entries[name] = {
      hash: canonical.get(name)?.hash ?? aliaEntries.get(name)?.hash ?? null,
      mirrored,
    };
  }

  return { ops, nextState: { entries }, skippedByPlugin, blocked };
}

/** blocked — не копировать: VesnALIA всё равно не примет, reason объясняет почему. */
export type ServerAliaMirrorOp = { name: string; reason: string; blocked?: boolean };

/**
 * Plan copies into the VesnALIA server's user-skill root (`dataDir/skills`).
 * Does not pull or retire: those belong to enrolled machines' canons.
 */
export function planServerAliaMirror(input: {
  canon: Array<{ name: string; kind: "dir" | "symlink"; hash: string | null; mtime: number | null; bytes?: number }>;
  dest: Array<{ name: string; kind: "dir" | "symlink"; hash: string | null; mtime: number | null; junk?: boolean }>;
  pluginNames: string[];
}): ServerAliaMirrorOp[] {
  const plugins = new Set(input.pluginNames);
  const destByName = new Map(input.dest.map((item) => [item.name, item]));
  const ops: ServerAliaMirrorOp[] = [];
  for (const canon of input.canon) {
    if (plugins.has(canon.name) || canon.kind === "symlink" || canon.hash === null) continue;
    const dest = destByName.get(canon.name);
    if (dest?.kind === "symlink") continue;
    const problem = aliaTreeProblem(canon.bytes ?? 0);
    if (problem !== null) {
      ops.push({ name: canon.name, reason: problem, blocked: true });
      continue;
    }
    if (dest === undefined || dest.hash === null) {
      ops.push({ name: canon.name, reason: "нет на сервере ALIA" });
      continue;
    }
    if (dest.hash === canon.hash) {
      if (dest.junk === true) ops.push({ name: canon.name, reason: "в копии на сервере ALIA мусор (node_modules и т.п.)" });
      continue;
    }
    if ((canon.mtime ?? 0) >= (dest.mtime ?? 0)) {
      ops.push({ name: canon.name, reason: "канон новее" });
    }
  }
  return ops;
}

export function enrolledHostIsAliaServer(
  hosts: Array<{ hostname: string; status: string }>,
  serverHostname: string,
): boolean {
  const want = serverHostname.trim().toLowerCase();
  if (want === "") return false;
  return hosts.some((item) => item.status === "connected" && item.hostname.trim().toLowerCase() === want);
}
