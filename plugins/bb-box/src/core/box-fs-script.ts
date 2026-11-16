import type { GuestOs } from "../transports/types.ts";

export const LIST_CAP = 5_000;
export const OPEN_BYTES = 4 * 1024 * 1024;
export const IMAGE_BYTES = 2 * 1024 * 1024;
export const RANGE_BYTES = 256 * 1024;
export const CORPUS_BYTES = 8 * 1024 * 1024;
export const CORPUS_FILE_BYTES = 512 * 1024;
export const NAME_CAP = 20_000;
export const SEARCH_FILE_BYTES = 2 * 1024 * 1024;
export const SEARCH_PER_FILE = 40;
const WARM_NAME_BUDGET = NAME_CAP * 64;
const WARM_MARGIN = 256 * 1024;
export const WARM_OUT = Math.ceil(CORPUS_BYTES / 3) * 4 + WARM_NAME_BUDGET + WARM_MARGIN;

const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

export function sh(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function ps(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function posixHash(): string {
  return (
    "alia_files_hash() {\n" +
    "  if command -v sha256sum >/dev/null 2>&1; then sha256sum < \"$1\" | cut -d ' ' -f 1\n" +
    "  else shasum -a 256 < \"$1\" | cut -d ' ' -f 1\n" +
    "  fi\n" +
    "}\n"
  );
}

function posixStat(probe: string): string {
  return (
    `if stat -c '%s' ${probe} >/dev/null 2>&1; then\n` +
    "  alia_files_stat() { stat -L -c '%s %Y' \"$1\" 2>/dev/null || echo '0 0'; }\n" +
    "else\n" +
    "  alia_files_stat() { stat -L -f '%z %m' \"$1\" 2>/dev/null || echo '0 0'; }\n" +
    "fi\n"
  );
}

function posixB64(): string {
  return "alia_files_b64() { printf '%s' \"$1\" | base64 | tr -d '\\n'; }\n";
}

export function homeScript(os: GuestOs): string {
  if (os === "windows") {
    return (
      "$aliaFilesHome = [Environment]::GetFolderPath('UserProfile'); " +
      "if (-not $aliaFilesHome) { $aliaFilesHome = $HOME }; " +
      '"HOME`t" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$aliaFilesHome))'
    );
  }
  return "printf 'HOME\\t%s\\n' \"$(printf '%s' \"$HOME\" | base64 | tr -d '\\n')\"";
}

export function listScript(os: GuestOs, path: string): string {
  if (os === "windows") return windowsList(path);
  return posixList(path);
}

function posixList(path: string): string {
  return (
    "set -ef\n" +
    `alia_files_dir=${sh(path)}\n` +
    "if [ ! -d \"$alia_files_dir\" ]; then printf 'ERR\\tunreadable\\n'; exit 0; fi\n" +
    posixStat('"$alia_files_dir"') +
    posixB64() +
    "alia_files_n=0\n" +
    "find \"$alia_files_dir\" -mindepth 1 -maxdepth 1 -print | while IFS= read -r alia_files_path; do\n" +
    "  [ -n \"$alia_files_path\" ] || continue\n" +
    "  case \"$alia_files_path\" in \"$alia_files_dir\"/*) ;; *) continue ;; esac\n" +
    "  [ -e \"$alia_files_path\" ] || [ -L \"$alia_files_path\" ] || continue\n" +
    "  alia_files_n=$((alia_files_n + 1))\n" +
    `  if [ \"$alia_files_n\" -gt ${LIST_CAP} ]; then printf 'TRUNC\\n'; break; fi\n` +
    "  if [ -d \"$alia_files_path\" ]; then alia_files_kind=D\n" +
    "  elif [ -f \"$alia_files_path\" ]; then alia_files_kind=F\n" +
    "  else alia_files_kind=O; fi\n" +
    "  set -- $(alia_files_stat \"$alia_files_path\")\n" +
    "  alia_files_name=${alia_files_path##*/}\n" +
    "  printf 'ENT\\t%s\\t%s\\t%s\\t%s\\n' \"$alia_files_kind\" \"$1\" \"$2\" \"$(alia_files_b64 \"$alia_files_name\")\"\n" +
    "done\n"
  );
}

function windowsList(path: string): string {
  return (
    `$aliaFilesDir = ${ps(path)}; ` +
    "if (-not (Test-Path -LiteralPath $aliaFilesDir -PathType Container)) { \"ERR`tunreadable\"; exit 0 }; " +
    "$aliaFilesItems = @(Get-ChildItem -LiteralPath $aliaFilesDir -Force -ErrorAction SilentlyContinue); " +
    `$aliaFilesTake = [Math]::Min($aliaFilesItems.Count, ${LIST_CAP}); ` +
    "for ($aliaFilesI = 0; $aliaFilesI -lt $aliaFilesTake; $aliaFilesI++) { " +
    "$aliaFilesIt = $aliaFilesItems[$aliaFilesI]; " +
    "$aliaFilesKind = $(if ($aliaFilesIt.Attributes -band [IO.FileAttributes]::Directory) { 'D' } else { 'F' }); " +
    "$aliaFilesSize = $(if ($null -eq $aliaFilesIt.Length) { 0 } else { [int64]$aliaFilesIt.Length }); " +
    "$aliaFilesWhen = [int64]([DateTimeOffset]$aliaFilesIt.LastWriteTimeUtc).ToUnixTimeSeconds(); " +
    "$aliaFilesName = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$aliaFilesIt.Name)); " +
    "\"ENT`t$aliaFilesKind`t$aliaFilesSize`t$aliaFilesWhen`t$aliaFilesName\" }; " +
    `if ($aliaFilesItems.Count -gt ${LIST_CAP}) { 'TRUNC' }`
  );
}

export function readScript(os: GuestOs, path: string): string {
  if (os === "windows") return windowsRead(path);
  return posixRead(path);
}

function posixMime(): string {
  const arms = Object.entries(IMAGE_MIME)
    .map(([ext, mime]) => `${ext}) alia_files_mime=${sh(mime)} ;;`)
    .join("\n");
  return (
    "alia_files_lower=$(printf '%s' \"$alia_files_path\" | tr '[:upper:]' '[:lower:]')\n" +
    "alia_files_ext=${alia_files_lower##*.}\n" +
    "alia_files_mime=\n" +
    "case \"$alia_files_ext\" in\n" +
    `${arms}\n` +
    "esac\n"
  );
}

function posixRead(path: string): string {
  return (
    "set -ef\n" +
    `alia_files_path=${sh(path)}\n` +
    "if [ ! -e \"$alia_files_path\" ] && [ ! -L \"$alia_files_path\" ]; then printf 'MISSING\\n'; exit 0; fi\n" +
    "if [ -d \"$alia_files_path\" ]; then printf 'DIR\\n'; exit 0; fi\n" +
    "if [ ! -f \"$alia_files_path\" ]; then printf 'ERR\\tnot-a-file\\n'; exit 0; fi\n" +
    posixStat('"$alia_files_path"') +
    posixHash() +
    posixMime() +
    "set -- $(alia_files_stat \"$alia_files_path\")\n" +
    "alia_files_size=$1\n" +
    "alia_files_sum=$(alia_files_hash \"$alia_files_path\")\n" +
    `alia_files_limit=${OPEN_BYTES}\n` +
    "[ -n \"$alia_files_mime\" ] && alia_files_limit=" +
    `${IMAGE_BYTES}\n` +
    "if [ \"$alia_files_size\" -gt \"$alia_files_limit\" ]; then printf 'LARGE\\t%s\\t%s\\n' \"$alia_files_size\" \"$alia_files_sum\"; exit 0; fi\n" +
    "if [ -n \"$alia_files_mime\" ]; then\n" +
    "  printf 'IMAGE\\t%s\\t%s\\t%s\\n' \"$alia_files_mime\" \"$alia_files_size\" \"$alia_files_sum\"\n" +
    "  base64 < \"$alia_files_path\" | tr -d '\\n'\n" +
    "  printf '\\n'\n" +
    "  exit 0\n" +
    "fi\n" +
    "alia_files_raw=$(head -c 8192 \"$alia_files_path\" | wc -c | tr -cd '0-9')\n" +
    "alia_files_kept=$(head -c 8192 \"$alia_files_path\" | tr -d '\\000' | wc -c | tr -cd '0-9')\n" +
    "if [ \"$alia_files_raw\" != \"$alia_files_kept\" ]; then printf 'BINARY\\t%s\\t%s\\n' \"$alia_files_size\" \"$alia_files_sum\"; exit 0; fi\n" +
    "printf 'TEXT\\t%s\\t%s\\n' \"$alia_files_size\" \"$alia_files_sum\"\n" +
    "base64 < \"$alia_files_path\" | tr -d '\\n'\n" +
    "printf '\\n'\n"
  );
}

function windowsRead(path: string): string {
  const arms = Object.entries(IMAGE_MIME)
    .map(([ext, mime]) => `'${ext}' { '${mime}' }`)
    .join(" ");
  return (
    `$aliaFilesPath = ${ps(path)}; ` +
    "if (-not (Test-Path -LiteralPath $aliaFilesPath)) { 'MISSING'; exit 0 }; " +
    "$aliaFilesItem = Get-Item -LiteralPath $aliaFilesPath -Force; " +
    "if ($aliaFilesItem.PSIsContainer) { 'DIR'; exit 0 }; " +
    "if (-not $aliaFilesItem.PSIsContainer -and -not (Test-Path -LiteralPath $aliaFilesPath -PathType Leaf)) { \"ERR`tnot-a-file\"; exit 0 }; " +
    "$aliaFilesSize = [int64]$aliaFilesItem.Length; " +
    "$aliaFilesSum = (Get-FileHash -Algorithm SHA256 -LiteralPath $aliaFilesPath).Hash.ToLower(); " +
    "$aliaFilesExt = [IO.Path]::GetExtension($aliaFilesPath).TrimStart('.').ToLowerInvariant(); " +
    `$aliaFilesMime = switch ($aliaFilesExt) { ${arms} default { '' } }; ` +
    `$aliaFilesLimit = ${OPEN_BYTES}; if ($aliaFilesMime) { $aliaFilesLimit = ${IMAGE_BYTES} }; ` +
    "if ($aliaFilesSize -gt $aliaFilesLimit) { \"LARGE`t$aliaFilesSize`t$aliaFilesSum\"; exit 0 }; " +
    "$aliaFilesBytes = [IO.File]::ReadAllBytes($aliaFilesPath); " +
    "if ($aliaFilesMime) { \"IMAGE`t$aliaFilesMime`t$aliaFilesSize`t$aliaFilesSum\"; [Convert]::ToBase64String($aliaFilesBytes); exit 0 }; " +
    "$aliaFilesBinary = $false; $aliaFilesScan = [Math]::Min(8192, $aliaFilesBytes.Length); " +
    "for ($aliaFilesI = 0; $aliaFilesI -lt $aliaFilesScan; $aliaFilesI++) { if ($aliaFilesBytes[$aliaFilesI] -eq 0) { $aliaFilesBinary = $true; break } }; " +
    "if ($aliaFilesBinary) { \"BINARY`t$aliaFilesSize`t$aliaFilesSum\"; exit 0 }; " +
    "\"TEXT`t$aliaFilesSize`t$aliaFilesSum\"; [Convert]::ToBase64String($aliaFilesBytes)"
  );
}

export function rangeScript(os: GuestOs, path: string, start: number, length: number): string {
  const from = Math.max(0, Math.floor(start));
  const take = Math.min(RANGE_BYTES, Math.max(1, Math.floor(length)));
  if (os === "windows") {
    return (
      `$aliaFilesPath = ${ps(path)}; $aliaFilesStart = ${from}; $aliaFilesTake = ${take}; ` +
      "if (-not (Test-Path -LiteralPath $aliaFilesPath -PathType Leaf)) { \"ERR`tmissing\"; exit 0 }; " +
      "$aliaFilesSize = [int64](Get-Item -LiteralPath $aliaFilesPath).Length; " +
      "$aliaFilesSum = (Get-FileHash -Algorithm SHA256 -LiteralPath $aliaFilesPath).Hash.ToLower(); " +
      "if ($aliaFilesStart -ge $aliaFilesSize) { $aliaFilesTake = 0 }; " +
      "if ($aliaFilesStart + $aliaFilesTake -gt $aliaFilesSize) { $aliaFilesTake = $aliaFilesSize - $aliaFilesStart }; " +
      "$aliaFilesEnd = $aliaFilesStart + $aliaFilesTake; " +
      "\"RANGE`t$aliaFilesStart`t$aliaFilesEnd`t$aliaFilesSize`t$aliaFilesSum\"; " +
      "if ($aliaFilesTake -gt 0) { " +
      "$aliaFilesStream = [IO.File]::Open($aliaFilesPath, 'Open', 'Read', 'ReadWrite'); " +
      "try { $aliaFilesStream.Position = $aliaFilesStart; $aliaFilesBuf = New-Object byte[] $aliaFilesTake; [void]$aliaFilesStream.Read($aliaFilesBuf, 0, $aliaFilesTake); [Convert]::ToBase64String($aliaFilesBuf) } finally { $aliaFilesStream.Close() } }"
    );
  }
  return (
    "set -ef\n" +
    `alia_files_path=${sh(path)}\n` +
    `alia_files_start=${from}\n` +
    `alia_files_take=${take}\n` +
    "if [ ! -f \"$alia_files_path\" ]; then printf 'ERR\\tmissing\\n'; exit 0; fi\n" +
    posixStat('"$alia_files_path"') +
    posixHash() +
    "set -- $(alia_files_stat \"$alia_files_path\")\n" +
    "alia_files_size=$1\n" +
    "alia_files_sum=$(alia_files_hash \"$alia_files_path\")\n" +
    "if [ \"$alia_files_start\" -ge \"$alia_files_size\" ]; then alia_files_take=0; fi\n" +
    "if [ $((alia_files_start + alia_files_take)) -gt \"$alia_files_size\" ]; then alia_files_take=$((alia_files_size - alia_files_start)); fi\n" +
    "alia_files_end=$((alia_files_start + alia_files_take))\n" +
    "printf 'RANGE\\t%s\\t%s\\t%s\\t%s\\n' \"$alia_files_start\" \"$alia_files_end\" \"$alia_files_size\" \"$alia_files_sum\"\n" +
    "if [ \"$alia_files_take\" -gt 0 ]; then tail -c +$((alia_files_start + 1)) \"$alia_files_path\" | head -c \"$alia_files_take\" | base64 | tr -d '\\n'; printf '\\n'; fi\n"
  );
}

export type WriteMode = "guard" | "overwrite";

export function writeScript(os: GuestOs, path: string, expected: string, mode: WriteMode): string {
  if (os === "windows") return windowsWrite(path, expected, mode);
  return posixWrite(path, expected, mode);
}

function posixKeep(): string {
  return (
    "alia_files_ino() { stat -c '%i' \"$1\" 2>/dev/null || stat -f '%i' \"$1\" 2>/dev/null || echo 0; }\n" +
    "alia_files_bits() { stat -c '%a' \"$1\" 2>/dev/null || stat -f '%OLp' \"$1\" 2>/dev/null || echo 644; }\n" +
    "alia_files_link() {\n" +
    "  alia_files_ok=0\n" +
    "  if ln -T \"$1\" \"$1.bbprobe\" 2>/dev/null; then\n" +
    "    rm -f \"$1.bbprobe\"\n" +
    "    if ln -T \"$1\" \"$2\" 2>/dev/null; then alia_files_ok=1; fi\n" +
    "  else\n" +
    "    if ln \"$1\" \"$2\" 2>/dev/null; then alia_files_ok=1; fi\n" +
    "  fi\n" +
    "  if [ \"$alia_files_ok\" -eq 1 ]; then return 0; fi\n" +
    "  return 1\n" +
    "}\n" +
    "alia_files_same() {\n" +
    "  alia_files_a=$(alia_files_ino \"$1\")\n" +
    "  alia_files_b=$(alia_files_ino \"$2\")\n" +
    "  if [ \"$alia_files_a\" = \"$alia_files_b\" ] && [ \"$alia_files_a\" != 0 ]; then return 0; fi\n" +
    "  if cmp -s \"$1\" \"$2\"; then return 0; fi\n" +
    "  return 1\n" +
    "}\n" +
    "alia_files_keep() {\n" +
    "  alia_files_n=0\n" +
    "  while [ \"$alia_files_n\" -lt 100 ]; do\n" +
    "    if [ \"$alia_files_n\" -eq 0 ]; then alia_files_slot=\"$1.conflict\"\n" +
    "    else alia_files_slot=\"$1.conflict-$((alia_files_n + 1))\"\n" +
    "    fi\n" +
    "    alia_files_n=$((alia_files_n + 1))\n" +
    "    if [ -e \"$alia_files_slot\" ] || [ -L \"$alia_files_slot\" ]; then continue; fi\n" +
    "    alia_files_hold=$(mktemp \"$(dirname -- \"$1\")/.alia-files.XXXXXX\") || return 1\n" +
    "    cat < \"$2\" > \"$alia_files_hold\" || { rm -f \"$alia_files_hold\"; return 1; }\n" +
    "    if [ -f \"$1\" ]; then chmod \"$(alia_files_bits \"$1\")\" \"$alia_files_hold\" 2>/dev/null || true; fi\n" +
    "    if alia_files_link \"$alia_files_hold\" \"$alia_files_slot\"; then\n" +
    "      if [ -f \"$alia_files_slot\" ] && [ ! -L \"$alia_files_slot\" ]; then\n" +
    "        if alia_files_same \"$alia_files_hold\" \"$alia_files_slot\"; then rm -f \"$alia_files_hold\"; return 0; fi\n" +
    "        rm -f \"$alia_files_slot\" \"$alia_files_hold\"\n" +
    "        return 1\n" +
    "      fi\n" +
    "      alia_files_inner=\"$alia_files_slot/$(basename \"$alia_files_hold\")\"\n" +
    "      if [ -f \"$alia_files_inner\" ] && [ ! -L \"$alia_files_inner\" ]; then\n" +
    "        if alia_files_same \"$alia_files_hold\" \"$alia_files_inner\"; then rm -f \"$alia_files_inner\"; fi\n" +
    "      fi\n" +
    "    elif [ ! -e \"$alia_files_slot\" ] && [ ! -L \"$alia_files_slot\" ]; then\n" +
    "      if (set -C; : > \"$alia_files_slot\"); then\n" +
    "        if cat < \"$alia_files_hold\" > \"$alia_files_slot\"; then\n" +
    "          chmod \"$(alia_files_bits \"$alia_files_hold\")\" \"$alia_files_slot\" 2>/dev/null || true\n" +
    "          if alia_files_same \"$alia_files_hold\" \"$alia_files_slot\"; then rm -f \"$alia_files_hold\"; return 0; fi\n" +
    "        fi\n" +
    "        rm -f \"$alia_files_slot\" \"$alia_files_hold\"\n" +
    "        return 1\n" +
    "      fi\n" +
    "    fi\n" +
    "    rm -f \"$alia_files_hold\"\n" +
    "  done\n" +
    "  return 1\n" +
    "}\n"
  );
}

function posixWrite(path: string, expected: string, mode: WriteMode): string {
  return (
    "set -ef\n" +
    `alia_files_path=${sh(path)}\n` +
    `alia_files_mode=${sh(mode)}\n` +
    `alia_files_expected=${sh(expected)}\n` +
    posixHash() +
    posixStat("'/'") +
    posixKeep() +
    "alia_files_tmp=$(mktemp)\n" +
    "cat > \"$alia_files_tmp\"\n" +
    "if [ -d \"$alia_files_path\" ]; then rm -f \"$alia_files_tmp\"; printf 'ERR\\tis-directory\\n'; exit 0; fi\n" +
    "if [ -f \"$alia_files_path\" ]; then\n" +
    "  if [ \"$alia_files_mode\" = guard ]; then\n" +
    "    alia_files_now=$(alia_files_hash \"$alia_files_path\")\n" +
    "    if [ \"$alia_files_now\" != \"$alia_files_expected\" ]; then\n" +
    "      alia_files_keep \"$alia_files_path\" \"$alia_files_tmp\" || { rm -f \"$alia_files_tmp\"; printf 'ERR\\tfailed\\n'; exit 0; }\n" +
    "      rm -f \"$alia_files_tmp\"\n" +
    "      printf 'CONFLICT\\t%s\\n' \"$alia_files_now\"\n" +
    "      exit 0\n" +
    "    fi\n" +
    "  fi\n" +
    "  cat < \"$alia_files_tmp\" > \"$alia_files_path\"\n" +
    "elif [ -e \"$alia_files_path\" ] || [ -L \"$alia_files_path\" ]; then\n" +
    "  if [ \"$alia_files_mode\" = guard ]; then\n" +
    "    alia_files_keep \"$alia_files_path\" \"$alia_files_tmp\" || { rm -f \"$alia_files_tmp\"; printf 'ERR\\tfailed\\n'; exit 0; }\n" +
    "    rm -f \"$alia_files_tmp\"\n" +
    "    printf 'CONFLICT\\t\\n'\n" +
    "    exit 0\n" +
    "  fi\n" +
    "  cat < \"$alia_files_tmp\" > \"$alia_files_path\"\n" +
    "elif [ \"$alia_files_mode\" = guard ]; then\n" +
    "  alia_files_keep \"$alia_files_path\" \"$alia_files_tmp\" || { rm -f \"$alia_files_tmp\"; printf 'ERR\\tfailed\\n'; exit 0; }\n" +
    "  rm -f \"$alia_files_tmp\"\n" +
    "  printf 'CONFLICT\\t\\n'\n" +
    "  exit 0\n" +
    "else\n" +
    "  mkdir -p -- \"$(dirname -- \"$alia_files_path\")\"\n" +
    "  cat < \"$alia_files_tmp\" > \"$alia_files_path\"\n" +
    "fi\n" +
    "alia_files_sum=$(alia_files_hash \"$alia_files_tmp\")\n" +
    "set -- $(alia_files_stat \"$alia_files_tmp\")\n" +
    "rm -f \"$alia_files_tmp\"\n" +
    "printf 'WRITTEN\\t%s\\t%s\\n' \"$alia_files_sum\" \"$1\"\n"
  );
}

function windowsWrite(path: string, expected: string, mode: WriteMode): string {
  return (
    "$ErrorActionPreference = 'Stop'; $aliaFilesTmp = $null; try { " +
    `$aliaFilesPath = ${ps(path)}; $aliaFilesMode = ${ps(mode)}; $aliaFilesExpected = ${ps(expected)}; ` +
    "function AliaFilesKeep($aliaFilesLive, $aliaFilesFrom) { " +
    "$aliaFilesSlots = @($aliaFilesLive + '.conflict'); " +
    "for ($aliaFilesN = 2; $aliaFilesN -le 100; $aliaFilesN++) { $aliaFilesSlots += ($aliaFilesLive + '.conflict-' + $aliaFilesN) }; " +
    "foreach ($aliaFilesSlot in $aliaFilesSlots) { " +
    "try { " +
    "$aliaFilesOut = [IO.File]::Open($aliaFilesSlot, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None); " +
    "try { $aliaFilesIn = [IO.File]::Open($aliaFilesFrom, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read); " +
    "try { $aliaFilesIn.CopyTo($aliaFilesOut) } finally { $aliaFilesIn.Close() } } finally { $aliaFilesOut.Close() }; " +
    "return $true } catch {} }; return $false }; " +
    "$aliaFilesTmp = [IO.Path]::GetTempFileName(); " +
    "$aliaFilesStream = [IO.File]::Create($aliaFilesTmp); " +
    "try { [Console]::OpenStandardInput().CopyTo($aliaFilesStream) } finally { $aliaFilesStream.Close() }; " +
    "if (Test-Path -LiteralPath $aliaFilesPath -PathType Container) { Remove-Item -LiteralPath $aliaFilesTmp -Force; \"ERR`tis-directory\"; exit 0 }; " +
    "if (Test-Path -LiteralPath $aliaFilesPath -PathType Leaf) { " +
    "if ($aliaFilesMode -eq 'guard') { " +
    "$aliaFilesNow = (Get-FileHash -Algorithm SHA256 -LiteralPath $aliaFilesPath).Hash.ToLower(); " +
    "if ($aliaFilesNow -ne $aliaFilesExpected) { " +
    "if (-not (AliaFilesKeep $aliaFilesPath $aliaFilesTmp)) { Remove-Item -LiteralPath $aliaFilesTmp -Force; \"ERR`tfailed\"; exit 0 }; " +
    "Remove-Item -LiteralPath $aliaFilesTmp -Force; \"CONFLICT`t$aliaFilesNow\"; exit 0 } }; " +
    "try { [IO.File]::Copy($aliaFilesTmp, $aliaFilesPath, $true) } catch { Remove-Item -LiteralPath $aliaFilesTmp -Force -ErrorAction SilentlyContinue; \"ERR`tfailed\"; exit 0 } " +
    "} elseif ($aliaFilesMode -eq 'guard') { " +
    "if (-not (AliaFilesKeep $aliaFilesPath $aliaFilesTmp)) { Remove-Item -LiteralPath $aliaFilesTmp -Force; \"ERR`tfailed\"; exit 0 }; " +
    "Remove-Item -LiteralPath $aliaFilesTmp -Force; \"CONFLICT`t\"; exit 0 } " +
    "else { " +
    "$aliaFilesDir = [IO.Path]::GetDirectoryName($aliaFilesPath); " +
    "if ($aliaFilesDir) { [void][IO.Directory]::CreateDirectory($aliaFilesDir) }; " +
    "try { [IO.File]::Copy($aliaFilesTmp, $aliaFilesPath, $true) } catch { Remove-Item -LiteralPath $aliaFilesTmp -Force -ErrorAction SilentlyContinue; \"ERR`tfailed\"; exit 0 } }; " +
    "$aliaFilesHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $aliaFilesTmp).Hash.ToLower(); " +
    "$aliaFilesSize = (Get-Item -LiteralPath $aliaFilesTmp).Length; " +
    "Remove-Item -LiteralPath $aliaFilesTmp -Force; " +
    "\"WRITTEN`t$aliaFilesHash`t$aliaFilesSize\" } finally { if ($null -ne $aliaFilesTmp) { Remove-Item -LiteralPath $aliaFilesTmp -Force -ErrorAction SilentlyContinue } }"
  );
}

export function createScript(os: GuestOs, path: string, kind: "file" | "directory"): string {
  if (os === "windows") {
    const make =
      kind === "directory"
        ? "[void][IO.Directory]::CreateDirectory($aliaFilesPath)"
        : "$aliaFilesDir = [IO.Path]::GetDirectoryName($aliaFilesPath); if ($aliaFilesDir) { [void][IO.Directory]::CreateDirectory($aliaFilesDir) }; [IO.File]::WriteAllBytes($aliaFilesPath, [byte[]]@())";
    return (
      `$aliaFilesPath = ${ps(path)}; ` +
      "if (Test-Path -LiteralPath $aliaFilesPath) { \"ERR`texists\"; exit 0 }; " +
      `${make}; ` +
      "'OK'"
    );
  }
  const make =
    kind === "directory"
      ? "mkdir -p -- \"$alia_files_path\""
      : "mkdir -p -- \"$(dirname -- \"$alia_files_path\")\" && : > \"$alia_files_path\"";
  return (
    "set -ef\n" +
    `alia_files_path=${sh(path)}\n` +
    "if [ -e \"$alia_files_path\" ] || [ -L \"$alia_files_path\" ]; then printf 'ERR\\texists\\n'; exit 0; fi\n" +
    `${make}\n` +
    "printf 'OK\\n'\n"
  );
}

export function renameScript(os: GuestOs, from: string, to: string): string {
  if (os === "windows") {
    return (
      `$aliaFilesFrom = ${ps(from)}; $aliaFilesTo = ${ps(to)}; ` +
      "if (-not (Test-Path -LiteralPath $aliaFilesFrom)) { \"ERR`tmissing\"; exit 0 }; " +
      "if (Test-Path -LiteralPath $aliaFilesTo) { \"ERR`texists\"; exit 0 }; " +
      "$aliaFilesDir = [IO.Path]::GetDirectoryName($aliaFilesTo); " +
      "if ($aliaFilesDir) { [void][IO.Directory]::CreateDirectory($aliaFilesDir) }; " +
      "Move-Item -LiteralPath $aliaFilesFrom -Destination $aliaFilesTo; 'OK'"
    );
  }
  return (
    "set -ef\n" +
    `alia_files_from=${sh(from)}\n` +
    `alia_files_to=${sh(to)}\n` +
    "if [ ! -e \"$alia_files_from\" ] && [ ! -L \"$alia_files_from\" ]; then printf 'ERR\\tmissing\\n'; exit 0; fi\n" +
    "if [ -e \"$alia_files_to\" ] || [ -L \"$alia_files_to\" ]; then printf 'ERR\\texists\\n'; exit 0; fi\n" +
    "mkdir -p -- \"$(dirname -- \"$alia_files_to\")\"\n" +
    "mv -- \"$alia_files_from\" \"$alia_files_to\"\n" +
    "printf 'OK\\n'\n"
  );
}

export function deleteScript(os: GuestOs, path: string, home: string): string {
  if (os === "windows") {
    return (
      `$aliaFilesPath = ${ps(path)}; $aliaFilesHome = ${ps(home)}; ` +
      "$aliaFilesFull = [IO.Path]::GetFullPath($aliaFilesPath); " +
      "if ($aliaFilesFull -match '^[A-Za-z]:\\\\$' -or $aliaFilesFull -eq $aliaFilesHome) { \"ERR`trefused\"; exit 0 }; " +
      "if (-not (Test-Path -LiteralPath $aliaFilesPath)) { \"ERR`tmissing\"; exit 0 }; " +
      "Remove-Item -LiteralPath $aliaFilesPath -Recurse -Force; 'OK'"
    );
  }
  return (
    "set -ef\n" +
    `alia_files_path=${sh(path)}\n` +
    `alia_files_home=${sh(home)}\n` +
    "if [ \"$alia_files_path\" = / ] || [ \"$alia_files_path\" = \"$alia_files_home\" ]; then printf 'ERR\\trefused\\n'; exit 0; fi\n" +
    "if [ ! -e \"$alia_files_path\" ] && [ ! -L \"$alia_files_path\" ]; then printf 'ERR\\tmissing\\n'; exit 0; fi\n" +
    "rm -rf -- \"$alia_files_path\"\n" +
    "printf 'OK\\n'\n"
  );
}

export interface SearchFlags {
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
  readonly hidden: boolean;
}

export function searchScript(os: GuestOs, root: string, query: string, flags: SearchFlags): string {
  if (os === "windows") return windowsSearch(root, query, flags);
  return posixSearch(root, query, flags);
}

function posixSearch(root: string, query: string, flags: SearchFlags): string {
  const smart = flags.matchCase || /[A-Z]/.test(query);
  const rgFlags = [
    "--json",
    "--null",
    "--no-ignore",
    "--max-columns",
    "240",
    "--max-filesize",
    String(SEARCH_FILE_BYTES),
    "--max-count",
    String(SEARCH_PER_FILE + 1),
    "-g",
    "!.git/**",
    "-g",
    "!node_modules/**",
    "-g",
    "!vendor/**",
    flags.hidden ? "--hidden" : "",
    flags.regex ? "" : "-F",
    flags.wholeWord ? "-w" : "",
    smart ? "-s" : "-S",
  ]
    .filter(Boolean)
    .map(sh)
    .join(" ");
  const grepCase = smart ? "" : "-i";
  const grepFixed = flags.regex ? "" : "-F";
  const grepWord = flags.wholeWord ? "-w" : "";
  const hidden = flags.hidden ? "" : "--exclude-dir='.[!.]*' --exclude-dir='..?*' --exclude='.[!.]*' --exclude='..?*'";
  const findHidden = flags.hidden ? "" : "-name '.[!.]*' -prune -o -name '..?*' -prune -o ";
  const grepFlags = `$alia_files_bin ${grepCase} ${grepFixed} ${grepWord} -m ${SEARCH_PER_FILE + 1}`;
  return (
    "set -f\n" +
    `cd -- ${sh(root)} || { printf 'ERR\\tunreadable\\n'; exit 0; }\n` +
    "alia_files_tmp=$(mktemp)\n" +
    "if command -v rg >/dev/null 2>&1; then\n" +
    `  rg ${rgFlags} -- ${sh(query)} . > \"$alia_files_tmp\" 2>/dev/null\n` +
    "  alia_files_status=$?\n" +
    "  printf 'ENGINE\\trg\\n'\n" +
    "  cat \"$alia_files_tmp\"\n" +
    "  if [ \"$alia_files_status\" -gt 1 ]; then printf 'ERR\\tfailed\\n'; fi\n" +
    "else\n" +
    "  alia_files_bin=\n" +
    "  grep --help 2>&1 | grep -q binary-files && alia_files_bin=--binary-files=without-match\n" +
    "  if printf 'x\\n' | grep --null -h -e x >/dev/null 2>&1; then\n" +
    `    grep -RInH --null ${grepFlags} --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=vendor ${hidden} -e ${sh(query)} . > \"$alia_files_tmp\" 2>/dev/null\n` +
    "    alia_files_status=$?\n" +
    "  else\n" +
    "    alia_files_status=0\n" +
    "    alia_files_list=$(mktemp)\n" +
    "    alia_files_hits=$(mktemp)\n" +
    "    : > \"$alia_files_tmp\"\n" +
    `    find . \\( -name .git -o -name node_modules -o -name vendor \\) -prune -o ${findHidden}-type f -print > \"$alia_files_list\"\n` +
    "    while IFS= read -r alia_files_one; do\n" +
    "      [ -f \"$alia_files_one\" ] || continue\n" +
    `      grep -nh ${grepFlags} -e ${sh(query)} -- \"$alia_files_one\" > \"$alia_files_hits\" 2>/dev/null\n` +
    "      alia_files_one_status=$?\n" +
    "      if [ \"$alia_files_one_status\" -gt 1 ]; then alia_files_status=2; fi\n" +
    "      while IFS= read -r alia_files_hit; do\n" +
    "        printf '%s\\0%s\\n' \"$alia_files_one\" \"$alia_files_hit\"\n" +
    "      done < \"$alia_files_hits\" >> \"$alia_files_tmp\"\n" +
    "    done < \"$alia_files_list\"\n" +
    "    rm -f \"$alia_files_list\" \"$alia_files_hits\"\n" +
    "  fi\n" +
    "  printf 'ENGINE\\tgrep\\n'\n" +
    "  cat \"$alia_files_tmp\"\n" +
    "  if [ \"$alia_files_status\" -gt 1 ]; then printf 'ERR\\tfailed\\n'; fi\n" +
    "fi\n" +
    "rm -f \"$alia_files_tmp\"\n"
  );
}

function windowsSearch(root: string, query: string, flags: SearchFlags): string {
  const smart = flags.matchCase || /[A-Z]/.test(query);
  const rgExtra = [
    flags.hidden ? "--hidden" : "",
    flags.regex ? "" : "-F",
    flags.wholeWord ? "-w" : "",
    smart ? "-s" : "-S",
    "--max-count",
    String(SEARCH_PER_FILE + 1),
  ]
    .filter(Boolean)
    .join(" ");
  const hiddenTest = flags.hidden ? "$true" : "('\\' + $_.FullName.Substring($aliaFilesRoot.Length)) -notmatch '\\\\\\.'";
  return (
    `$aliaFilesRoot = ${ps(root)}; $aliaFilesQuery = ${ps(query)}; ` +
    "$aliaFilesRegex = " +
    (flags.regex ? "$true" : "$false") +
    "; $aliaFilesWhole = " +
    (flags.wholeWord ? "$true" : "$false") +
    "; $aliaFilesSmart = " +
    (smart ? "$true" : "$false") +
    "; " +
    "if (-not (Test-Path -LiteralPath $aliaFilesRoot -PathType Container)) { \"ERR`tunreadable\"; exit 0 }; " +
    "Set-Location -LiteralPath $aliaFilesRoot; " +
    "if (Get-Command rg -ErrorAction SilentlyContinue) { " +
    "\"ENGINE`trg\"; & rg --json --null --no-ignore --max-columns 240 --max-filesize " +
    String(SEARCH_FILE_BYTES) +
    " -g '!.git/**' -g '!node_modules/**' -g '!vendor/**' " +
    rgExtra +
    " -- $aliaFilesQuery .; if ($LASTEXITCODE -gt 1) { \"ERR`tfailed\" }; exit 0 }; " +
    "\"ENGINE`tgrep\"; " +
    "$aliaFilesPattern = $aliaFilesQuery; if (-not $aliaFilesRegex) { $aliaFilesPattern = [regex]::Escape($aliaFilesPattern) }; " +
    "if ($aliaFilesWhole) { $aliaFilesPattern = '\\b(?:' + $aliaFilesPattern + ')\\b' }; " +
    "$aliaFilesSeen = 0; " +
    "Get-ChildItem -LiteralPath $aliaFilesRoot -Recurse -File -Force -ErrorAction SilentlyContinue | " +
    "Where-Object { $_.FullName -notmatch '\\\\(\\.git|node_modules|vendor)\\\\' -and $_.Length -le " +
    `${SEARCH_FILE_BYTES} -and (${hiddenTest}) } | ` +
    "Select-Object -First 3000 | ForEach-Object { " +
    "$aliaFilesFile = $_.FullName; $aliaFilesRel = $aliaFilesFile.Substring($aliaFilesRoot.Length).TrimStart('\\'); " +
    "$aliaFilesN = 0; $aliaFilesInFile = 0; " +
    "Get-Content -LiteralPath $aliaFilesFile -ErrorAction SilentlyContinue | ForEach-Object { " +
    `$aliaFilesN++; if ($aliaFilesSeen -ge 2000 -or $aliaFilesInFile -ge ${SEARCH_PER_FILE + 1}) { return }; ` +
    "$aliaFilesLine = $_; try { $aliaFilesHit = if ($aliaFilesSmart) { $aliaFilesLine -cmatch $aliaFilesPattern } else { $aliaFilesLine -imatch $aliaFilesPattern } } catch { $aliaFilesHit = $false }; " +
    "if ($aliaFilesHit) { $aliaFilesInFile++; $aliaFilesSeen++; ($aliaFilesRel + ':' + $aliaFilesN + ':' + $aliaFilesLine) } } }"
  );
}

const SKIP_EXT = "png jpg jpeg gif webp ico bmp exe dll so dylib zip gz tar wasm pdf mp4 mov mp3 wav class jar woff woff2 ttf otf 7z rar iso dmg";

export function warmScript(os: GuestOs, root: string): string {
  if (os === "windows") return windowsWarm(root);
  return posixWarm(root);
}

function posixWarm(root: string): string {
  const skip = SKIP_EXT.split(" ")
    .map((ext) => `${ext}) continue ;;`)
    .join("\n");
  return (
    "set -f\n" +
    `cd -- ${sh(root)} || { printf 'ERR\\tunreadable\\n'; exit 0; }\n` +
    posixStat(".") +
    posixB64() +
    "alia_files_n=0\n" +
    "find . \\( -name .git -o -name node_modules -o -name vendor \\) -prune -o -type f -print | {\n" +
    "alia_files_out=0\n" +
    "while IFS= read -r alia_files_path; do\n" +
    "  case \"$alia_files_path\" in ./*) ;; *) continue ;; esac\n" +
    "  [ -f \"$alia_files_path\" ] || continue\n" +
    "  alia_files_rel=${alia_files_path#./}\n" +
    "  alia_files_n=$((alia_files_n + 1))\n" +
    `  if [ \"$alia_files_n\" -gt ${NAME_CAP} ]; then printf 'MORE\\n'; break; fi\n` +
    "  alia_files_name=$(alia_files_b64 \"$alia_files_rel\")\n" +
    "  if [ $((alia_files_out + ${#alia_files_name} + 16)) -ge " + WARM_NAME_BUDGET + " ]; then printf 'MORE\\n'; break; fi\n" +
    "  printf 'NAME\\t%s\\n' \"$alia_files_name\"\n" +
    "  alia_files_out=$((alia_files_out + ${#alia_files_name} + 16))\n" +
    "done\n" +
    "}\n" +
    "alia_files_used=0\n" +
    "find . \\( -name .git -o -name node_modules -o -name vendor \\) -prune -o -type f -print | {\n" +
    "alia_files_out=0\n" +
    "while IFS= read -r alia_files_path; do\n" +
    "  case \"$alia_files_path\" in ./*) ;; *) continue ;; esac\n" +
    "  [ -f \"$alia_files_path\" ] || continue\n" +
    `  if [ \"$alia_files_used\" -ge ${CORPUS_BYTES} ]; then printf 'MORE\\n'; break; fi\n` +
    "  alia_files_rel=${alia_files_path#./}\n" +
    "  alia_files_lower=$(printf '%s' \"$alia_files_rel\" | tr '[:upper:]' '[:lower:]')\n" +
    "  alia_files_ext=${alia_files_lower##*.}\n" +
    "  case \"$alia_files_ext\" in\n" +
    `${skip}\n` +
    "  esac\n" +
    "  set -- $(alia_files_stat \"$alia_files_path\")\n" +
    `  if [ \"$1\" -gt ${CORPUS_FILE_BYTES} ]; then printf 'MORE\\n'; continue; fi\n` +
    "  alia_files_raw=$(head -c 8192 \"$alia_files_path\" | wc -c | tr -cd '0-9')\n" +
    "  alia_files_kept=$(head -c 8192 \"$alia_files_path\" | tr -d '\\000' | wc -c | tr -cd '0-9')\n" +
    "  [ \"$alia_files_raw\" = \"$alia_files_kept\" ] || continue\n" +
    "  alia_files_body=$(base64 < \"$alia_files_path\" | tr -d '\\n')\n" +
    "  alia_files_need=$((${#alia_files_body} + ${#alia_files_rel} + 96))\n" +
    `  if [ $((alia_files_out + alia_files_need)) -ge ${WARM_OUT - WARM_NAME_BUDGET} ]; then printf 'MORE\\n'; break; fi\n` +
    "  printf 'FILE\\t%s\\t%s\\t%s\\n' \"$(alia_files_b64 \"$alia_files_rel\")\" \"$1\" \"$2\"\n" +
    "  printf '%s\\n' \"$alia_files_body\"\n" +
    "  printf 'ENDFILE\\n'\n" +
    "  alia_files_out=$((alia_files_out + alia_files_need))\n" +
    "  alia_files_used=$((alia_files_used + $1))\n" +
    "done\n" +
    "}\n" +
    "printf 'DONE\\n'\n"
  );
}

function windowsWarm(root: string): string {
  return (
    `$aliaFilesRoot = ${ps(root)}; ` +
    "if (-not (Test-Path -LiteralPath $aliaFilesRoot -PathType Container)) { \"ERR`tunreadable\"; exit 0 }; " +
    "$aliaFilesSkip = @('.git','node_modules','vendor'); " +
    "$aliaFilesN = 0; " +
    "Get-ChildItem -LiteralPath $aliaFilesRoot -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object { " +
    "$aliaFilesRel = $_.FullName.Substring($aliaFilesRoot.Length).TrimStart('\\'); " +
    "$aliaFilesParts = $aliaFilesRel.Split('\\'); " +
    "$aliaFilesOut = $false; foreach ($aliaFilesPart in $aliaFilesParts) { if ($aliaFilesSkip -contains $aliaFilesPart) { $aliaFilesOut = $true } }; " +
    "if ($aliaFilesOut) { return }; " +
    `$aliaFilesN++; if ($aliaFilesN -gt ${NAME_CAP}) { 'MORE'; return }; ` +
    '"NAME`t" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($aliaFilesRel)) }; ' +
    "'MORE'; 'DONE'"
  );
}

export function namesScript(os: GuestOs, root: string): string {
  if (os === "windows") {
    return (
      `$aliaFilesRoot = ${ps(root)}; ` +
      "if (-not (Test-Path -LiteralPath $aliaFilesRoot -PathType Container)) { \"ERR`tunreadable\"; exit 0 }; " +
      "$aliaFilesN = 0; " +
      "Get-ChildItem -LiteralPath $aliaFilesRoot -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { " +
      "$aliaFilesRel = $_.FullName.Substring($aliaFilesRoot.Length).TrimStart('\\'); " +
      "if ($aliaFilesRel -eq '' -or $aliaFilesRel -match '(\\.git|node_modules|vendor)(\\\\|$)') { return }; " +
      `$aliaFilesN++; if ($aliaFilesN -gt ${NAME_CAP}) { 'TRUNC'; return }; ` +
      "$aliaFilesTag = if ($_.PSIsContainer) { 'DIR' } else { 'NAME' }; " +
      "$aliaFilesTag + \"`t\" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($aliaFilesRel)) }"
    );
  }
  return (
    "set -f\n" +
    `cd -- ${sh(root)} || { printf 'ERR\\tunreadable\\n'; exit 0; }\n` +
    posixB64() +
    "alia_files_n=0\n" +
    "find . \\( -name .git -o -name node_modules -o -name vendor \\) -prune -o \\( -type d -o -type f \\) -print | while IFS= read -r alia_files_path; do\n" +
    "  case \"$alia_files_path\" in ./*) ;; *) continue ;; esac\n" +
    "  alia_files_n=$((alia_files_n + 1))\n" +
    `  if [ \"$alia_files_n\" -gt ${NAME_CAP} ]; then printf 'TRUNC\\n'; break; fi\n` +
    "  if [ -d \"$alia_files_path\" ]; then printf 'DIR\\t%s\\n' \"$(alia_files_b64 \"${alia_files_path#./}\")\"; else printf 'NAME\\t%s\\n' \"$(alia_files_b64 \"${alia_files_path#./}\")\"; fi\n" +
    "done\n"
  );
}
