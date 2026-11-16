param([ValidateSet('start', 'stop', 'install', 'status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskWorkspace = Split-Path -Parent (Split-Path -Parent $taskRoot)
$taskTools = Join-Path $taskWorkspace 'work\alia-build-tools\node_modules\alia-app\dist'
$taskApp = Join-Path $taskTools 'alia-app.js'
$taskCli = Join-Path $taskTools 'alia.js'
$taskData = Join-Path $taskWorkspace 'work\alia-validation-windows-data'
$taskUrl = 'http://127.0.0.1:49986'
if (-not (Test-Path -LiteralPath $taskApp -PathType Leaf)) { throw 'Task-local ALIA 0.46.0 is missing; see docs/vnext-testing.md.' }
function Assert-ValidationHost {
    $taskRuntime = Get-Content -Raw -LiteralPath (Join-Path $taskData 'alia-app-runtime.json') | ConvertFrom-Json
    if ($taskRuntime.serverUrl -ne $taskUrl -or [IO.Path]::GetFullPath($taskRuntime.entryPath) -ne [IO.Path]::GetFullPath($taskApp)) { throw 'Validation host identity does not match.' }
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskRuntime.pid)"
    if (-not $taskProcess -or -not $taskProcess.CommandLine.Contains($taskApp) -or -not $taskProcess.CommandLine.Contains($taskData)) { throw 'Validation launcher process does not match.' }
}
$taskPreviousData = $env:ALIA_DATA_DIR
$taskPreviousUrl = $env:ALIA_SERVER_URL
$taskPreviousTelemetry = $env:ALIA_TELEMETRY
Push-Location -LiteralPath $taskRoot
try {
    $env:ALIA_DATA_DIR = $taskData
    $env:ALIA_SERVER_URL = $taskUrl
    $env:ALIA_TELEMETRY = 'false'
    switch ($Action) {
        start { node $taskApp --data-dir $taskData --server-bind-host 127.0.0.1 --server-port 49986 --host-daemon-port 49987 --no-in-app-updates start }
        stop { Assert-ValidationHost; node $taskApp --data-dir $taskData stop }
        install {
            Assert-ValidationHost
            $taskHealth = Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 5
            node $taskCli plugin install $taskRoot --yes
        }
        status { Assert-ValidationHost; node $taskCli plugin list }
    }
    if ($LASTEXITCODE -ne 0) { throw "ALIA command failed ($LASTEXITCODE)." }
} finally {
    $env:ALIA_DATA_DIR = $taskPreviousData
    $env:ALIA_SERVER_URL = $taskPreviousUrl
    $env:ALIA_TELEMETRY = $taskPreviousTelemetry
    Pop-Location
}
