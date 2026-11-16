#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/alia-terminal-jobs-smoke.XXXXXX")"
test_root="$(cd "$test_root" && pwd -P)"
app="$repo_root/node_modules/alia-app-host/dist/alia-app.js"
cli="$repo_root/node_modules/alia-app-host/dist/alia.js"
current_app_pid=""
current_data=""
current_port=""
current_daemon_port=""
git_pid=""
path_source="$test_root/path-source"
fixture_group=""

free_port() {
  node -e 'const server=require("node:net").createServer(); server.listen(0,"127.0.0.1",()=>{ console.log(server.address().port); server.close(); });'
}

run_bounded() {
  local limit="$1"
  shift
  "$@" &
  local pid=$!
  local started=$SECONDS
  while kill -0 "$pid" 2>/dev/null; do
    if (( SECONDS - started >= limit )); then
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 0.1
  done
  wait "$pid"
}

alia_cli() {
  env -u ALIA_CLI -u ALIA_ENVIRONMENT_ID -u ALIA_PROJECT_ID -u ALIA_THREAD_ID \
    ALIA_SERVER_URL="http://127.0.0.1:$current_port" ALIA_HOST_DAEMON_PORT="$current_daemon_port" \
    "$cli" "$@"
}

stop_server() {
  set +e
  if [[ -n "$current_data" ]]; then
    run_bounded 15 env -u ALIA_CLI -u ALIA_ENVIRONMENT_ID -u ALIA_PROJECT_ID -u ALIA_THREAD_ID -u ALIA_SERVER_URL \
      "$app" --data-dir "$current_data" --server-port "$current_port" \
      --host-daemon-port "$current_daemon_port" stop >/dev/null 2>&1
  fi
  if [[ -n "$current_app_pid" ]] && kill -0 "$current_app_pid" 2>/dev/null; then
    kill -TERM "$current_app_pid" 2>/dev/null || true
    sleep 1
    kill -KILL "$current_app_pid" 2>/dev/null || true
  fi
  [[ -z "$current_app_pid" ]] || wait "$current_app_pid" 2>/dev/null || true
  current_app_pid=""
  current_data=""
  set -e
}

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  stop_server
  if [[ -n "$git_pid" ]] && kill -0 "$git_pid" 2>/dev/null; then
    kill -TERM "$git_pid" 2>/dev/null || true
    wait "$git_pid" 2>/dev/null || true
  fi
  if [[ -n "$fixture_group" ]]; then
    kill -KILL -- "-$fixture_group" 2>/dev/null || true
  fi
  if (( status == 0 )); then
    rm -rf "$test_root"
  else
    printf 'Disposable smoke evidence remains at %s\n' "$test_root" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

copy_plugin_source() {
  local destination="$1"
  mkdir -p "$destination"
  cp "$repo_root/package.json" "$repo_root/package-lock.json" "$repo_root/server.ts" \
    "$repo_root/host.ts" "$repo_root/README.md" "$repo_root/LICENSE" "$destination/"
  cp -R "$repo_root/src" "$repo_root/dist" "$repo_root/skills" "$destination/"
}

make_path_source() {
  copy_plugin_source "$path_source"
  mkdir -p "$path_source/node_modules"
  cp -R "$repo_root/node_modules/zod" "$path_source/node_modules/"
}

make_git_source() {
  local checkout="$test_root/git-source"
  copy_plugin_source "$checkout"
  git -C "$checkout" init -q -b main
  git -C "$checkout" add .
  git -C "$checkout" -c user.name=Smoke -c user.email=smoke@example.invalid commit -q -m smoke
  git clone -q --bare "$checkout" "$test_root/git-source.git"
  git --git-dir="$test_root/git-source.git" update-server-info
}

start_git_server() {
  local port
  port="$(free_port)"
  python3 -m http.server "$port" --bind 127.0.0.1 --directory "$test_root" \
    >"$test_root/git-http.log" 2>&1 &
  git_pid=$!
  local ready=0
  for _ in $(seq 1 50); do
    if git ls-remote "http://127.0.0.1:$port/git-source.git" main >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.1
  done
  [[ "$ready" -eq 1 ]] || { printf 'Temporary Git server did not start\n' >&2; return 1; }
  git_source="http://127.0.0.1:$port/git-source.git"
}

start_server() {
  local mode="$1"
  current_data="$test_root/data-$mode"
  current_port="$(free_port)"
  current_daemon_port="$(free_port)"
  local server_log="$test_root/server-$mode.log"
  "$app" --data-dir "$current_data" --server-port "$current_port" \
    --host-daemon-port "$current_daemon_port" start >"$server_log" 2>&1 &
  current_app_pid=$!
  local ready=0
  local started=$SECONDS
  while (( SECONDS - started < 60 )); do
    if ! kill -0 "$current_app_pid" 2>/dev/null; then
      printf 'Disposable ALIA server exited before readiness. Log: %s\n' "$server_log" >&2
      return 1
    fi
    if run_bounded 5 alia_cli plugin list --json >"$test_root/readiness-$mode.out" 2>&1; then
      ready=1
      break
    fi
    sleep 0.25
  done
  [[ "$ready" -eq 1 ]] || {
    printf 'Disposable ALIA server did not become ready. Log: %s\n' "$server_log" >&2
    return 1
  }
}

wait_for_delivery() {
  local job_id="$1"
  local output="$2"
  local delivered=0
  for _ in $(seq 1 120); do
    alia_cli terminal-job show "$job_id" --json >"$output"
    if node -e 'const v=require(process.argv[1]); process.exit(v.delivery.state === "delivered" ? 0 : 1)' "$output"; then
      delivered=1
      break
    fi
    sleep 0.25
  done
  [[ "$delivered" -eq 1 ]] || { printf 'job notification was not delivered\n' >&2; return 1; }
}

set_thread_model() {
  local thread_id="$1"
  local model_id="$2"
  node --no-warnings - "$current_data/alia.db" "$thread_id" "$model_id" <<'NODE'
const { DatabaseSync } = require("node:sqlite");
const [databasePath, threadId, modelId] = process.argv.slice(2);
const db = new DatabaseSync(databasePath);
const result = db.prepare("UPDATE threads SET model_override = ?, updated_at = ? WHERE id = ?").run(modelId, Date.now(), threadId);
if (result.changes !== 1) throw new Error(`could not set the model for ${threadId}`);
db.close();
NODE
}

backdate_job() {
  local job_id="$1"
  node --no-warnings - "$current_data/plugins/terminal-jobs/data.db" "$job_id" <<'NODE'
const { DatabaseSync } = require("node:sqlite");
const [databasePath, jobId] = process.argv.slice(2);
const db = new DatabaseSync(databasePath);
const result = db.prepare("UPDATE jobs SET updated_at = ? WHERE job_id = ?").run(Date.now() - 2 * 86_400_000, jobId);
if (result.changes !== 1) throw new Error(`could not backdate ${jobId}`);
db.close();
NODE
}

prune_and_assert_deleted() {
  local job_id="$1"
  local directory="$2"
  local output="$3"
  backdate_job "$job_id"
  alia_cli terminal-job prune --older-than-days 1 --delete --json >"$output"
  node - "$output" "$job_id" <<'NODE'
const result = require(process.argv[2]);
const jobId = process.argv[3];
if (!result.results.some((item) => item.jobId === jobId && item.action === "deleted")) {
  throw new Error(`prune did not delete ${jobId}`);
}
NODE
  [[ ! -e "$directory" ]] || { printf 'prune left artifact directory %s\n' "$directory" >&2; return 1; }
  if alia_cli terminal-job show "$job_id" --json >"$test_root/pruned-show.out" 2>&1; then
    printf 'prune left database row %s\n' "$job_id" >&2
    return 1
  fi
}

assert_processes_running() {
  node - "$@" <<'NODE'
const pids = process.argv.slice(2).map(Number);
for (const pid of pids) {
  try { process.kill(pid, 0); } catch { throw new Error(`fixture process ${pid} is not running`); }
}
NODE
}

assert_processes_stopped() {
  node - "$@" <<'NODE'
const pids = process.argv.slice(2).map(Number);
const running = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
(async () => {
  for (let attempt = 0; attempt < 100 && pids.some(running); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const survivors = pids.filter(running);
  if (survivors.length > 0) throw new Error(`terminal stop left processes: ${survivors.join(", ")}`);
})().catch((error) => { console.error(error); process.exit(1); });
NODE
}

smoke_mode() {
  local mode="$1"
  local source="$2"
  start_server "$mode"

  run_bounded 120 alia_cli plugin install "$source" --yes
  alia_cli plugin list --json >"$test_root/plugins-$mode.json"
  node - "$test_root/plugins-$mode.json" <<'NODE'
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const plugins = Array.isArray(value) ? value : value.plugins;
const item = plugins.find((plugin) => plugin.id === "terminal-jobs");
if (!item || item.status !== "running") throw new Error("terminal-jobs did not start");
NODE

  alia_cli terminal-job --help >"$test_root/help-$mode.txt"
  grep -F "alia terminal-job list" "$test_root/help-$mode.txt" >/dev/null
  grep -F "alia terminal-job prune" "$test_root/help-$mode.txt" >/dev/null

  alia_cli machine list --json >"$test_root/machines-$mode.json"
  machine_id="$(node -e 'const v=require(process.argv[1]); const xs=Array.isArray(v)?v:v.machines; if(!xs?.[0]?.id) throw Error("no disposable machine"); process.stdout.write(xs[0].id)' "$test_root/machines-$mode.json")"
  alia_cli project create --name "Terminal jobs smoke $mode" --root "$test_root/git-source" --machine "$machine_id" --json >"$test_root/project-$mode.json"
  alia_cli provider list --machine "$machine_id" --json >"$test_root/providers-$mode.json"
  read -r project_id provider_id < <(node - "$test_root/project-$mode.json" "$test_root/providers-$mode.json" <<'NODE'
const fs = require("node:fs");
const rawProject = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const project = rawProject.project ?? rawProject;
const raw = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const providers = Array.isArray(raw) ? raw : raw.providers;
const provider = providers.find((item) => item.available !== false);
if (!project.id || !provider) throw new Error("no disposable project/provider available");
console.log(project.id, provider.id);
NODE
  )
  model_id="terminal-jobs-smoke"
  node - "$current_data/config.json" "$provider_id" "$model_id" <<'NODE'
const fs = require("node:fs");
const [configPath, providerId, model] = process.argv.slice(2);
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
config.customModels = [{ providerId, model, displayName: "Terminal jobs smoke" }];
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
NODE
  alia_cli settings reload >/dev/null
  alia_cli provider models "$provider_id" --machine "$machine_id" --json >"$test_root/models-$mode.json"
  node -e 'const v=require(process.argv[1]); const id=process.argv[2]; const xs=Array.isArray(v)?v:v.models; if(!xs?.some((m)=>typeof m === "string" ? m === id : m.id === id)) throw Error("disposable custom model is missing")' "$test_root/models-$mode.json" "$model_id"
  alia_cli thread spawn --project "$project_id" --provider "$provider_id" --model "$model_id" \
    --prompt "Scheduled smoke owner" --send-at 7d --json >"$test_root/thread-$mode.json"
  thread_id="$(node -e 'const v=require(process.argv[1]); process.stdout.write(v.id)' "$test_root/thread-$mode.json")"
  set_thread_model "$thread_id" "$model_id"
  artifact_root="$test_root/artifacts-$mode"
  alia_cli terminal-job run --machine "$machine_id" --notify-thread "$thread_id" --title "public smoke" \
    --artifact-root "$artifact_root" --json -- /bin/sh -c 'printf smoke-ok' >"$test_root/job-$mode.json"
  terminal_id="$(node -e 'const v=require(process.argv[1]); process.stdout.write(v.terminal.id)' "$test_root/job-$mode.json")"
  job_id="$(node -e 'const v=require(process.argv[1]); process.stdout.write(v.jobId)' "$test_root/job-$mode.json")"
  run_bounded 45 alia_cli terminal wait "$terminal_id" --exit --timeout 40 --json >"$test_root/wait-$mode.json"

  wait_for_delivery "$job_id" "$test_root/final-$mode.json"

  alia_cli terminal-job list --limit 1 --json >"$test_root/list-$mode.json"
  alia_cli terminal-job prune --older-than-days 1 --json >"$test_root/prune-$mode.json"
  node - "$test_root/final-$mode.json" "$test_root/list-$mode.json" "$artifact_root/$job_id" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [finalPath, listPath, directory] = process.argv.slice(2);
const final = JSON.parse(fs.readFileSync(finalPath, "utf8"));
const list = JSON.parse(fs.readFileSync(listPath, "utf8"));
if (final.outcome.result !== "success" || final.delivery.state !== "delivered") throw new Error("job did not settle successfully");
if (JSON.stringify(list).includes("/bin/sh") || JSON.stringify(list).includes("smoke-ok")) throw new Error("list exposed argv");
const launch = JSON.parse(fs.readFileSync(path.join(directory, "launch.json"), "utf8"));
const outcome = JSON.parse(fs.readFileSync(path.join(directory, "outcome.json"), "utf8"));
if (launch.schemaVersion !== 1 || outcome.schemaVersion !== 1) throw new Error("artifact schema changed");
for (const file of ["launch.json", "output.log", "outcome.json"]) {
  if ((fs.statSync(path.join(directory, file)).mode & 0o777) !== 0o600) throw new Error(`${file} mode is not 0600`);
}
if ((fs.statSync(directory).mode & 0o777) !== 0o700) throw new Error("job directory mode is not 0700");
NODE

  prune_and_assert_deleted "$job_id" "$artifact_root/$job_id" "$test_root/prune-delete-$mode.json"

  if [[ "$mode" == "path" ]]; then
    alia_cli terminal-job run --machine "$machine_id" --notify-thread "$thread_id" --title "missing prune" \
      --artifact-root "$artifact_root" --json -- true >"$test_root/missing-job.json"
    missing_terminal_id="$(node -e 'const v=require(process.argv[1]); process.stdout.write(v.terminal.id)' "$test_root/missing-job.json")"
    missing_job_id="$(node -e 'const v=require(process.argv[1]); process.stdout.write(v.jobId)' "$test_root/missing-job.json")"
    run_bounded 45 alia_cli terminal wait "$missing_terminal_id" --exit --timeout 40 --json >"$test_root/missing-wait.json"
    wait_for_delivery "$missing_job_id" "$test_root/missing-final.json"
    missing_directory="$artifact_root/$missing_job_id"
    rm -rf "$missing_directory"
    prune_and_assert_deleted "$missing_job_id" "$missing_directory" "$test_root/prune-missing.json"

    stop_pid_file="$test_root/terminal-stop.pids"
    # The target shell, not this smoke-test shell, expands the process IDs.
    # shellcheck disable=SC2016
    alia_cli terminal-job run --machine "$machine_id" --notify-thread "$thread_id" --title "terminal stop" \
      --artifact-root "$artifact_root" --json -- /bin/sh -c \
      'sleep 60 & echo "$$ $!" > "$1"; wait' terminal-stop "$stop_pid_file" \
      >"$test_root/stop-job.json"
    stop_terminal_id="$(node -e 'const v=require(process.argv[1]); process.stdout.write(v.terminal.id)' "$test_root/stop-job.json")"
    stop_ready=0
    for _ in $(seq 1 100); do
      if [[ -s "$stop_pid_file" ]]; then
        stop_ready=1
        break
      fi
      sleep 0.05
    done
    [[ "$stop_ready" -eq 1 ]] || { printf 'terminal-stop fixture did not start\n' >&2; return 1; }
    read -r stop_parent_pid stop_grandchild_pid <"$stop_pid_file"
    fixture_group="$stop_parent_pid"
    assert_processes_running "$stop_parent_pid" "$stop_grandchild_pid"
    alia_cli terminal stop "$stop_terminal_id" --json >"$test_root/stop-result.json"
    run_bounded 45 alia_cli terminal wait "$stop_terminal_id" --exit --timeout 40 --json >"$test_root/stop-wait.json"
    assert_processes_stopped "$stop_parent_pid" "$stop_grandchild_pid"
    fixture_group=""
  fi

  stop_server
  printf 'isolated %s install smoke passed\n' "$mode"
}

make_path_source
make_git_source
start_git_server
smoke_mode path "path:$path_source"
smoke_mode git "$git_source"
