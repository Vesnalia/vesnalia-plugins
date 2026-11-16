$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskWorkspace = Split-Path -Parent (Split-Path -Parent $taskRoot)
$taskCli = Join-Path $taskWorkspace 'work\alia-build-tools\node_modules\alia-app\dist\alia.js'
$taskData = Join-Path $taskWorkspace 'work\alia-dev-data'
if (-not (Test-Path -LiteralPath $taskCli -PathType Leaf)) {
    throw 'Task-local ALIA build tool is missing. See docs/vnext-testing.md.'
}
$taskOldData = $env:ALIA_DATA_DIR
$taskOldUrl = $env:ALIA_SERVER_URL
$taskOldTelemetry = $env:ALIA_TELEMETRY
Push-Location -LiteralPath $taskRoot
try {
    $env:ALIA_DATA_DIR = $taskData
    $env:ALIA_SERVER_URL = 'http://127.0.0.1:49886'
    $env:ALIA_TELEMETRY = 'false'
    node $taskCli plugin build
    if ($LASTEXITCODE -ne 0) { throw "ALIA build failed ($LASTEXITCODE)." }
} finally {
    $env:ALIA_DATA_DIR = $taskOldData
    $env:ALIA_SERVER_URL = $taskOldUrl
    $env:ALIA_TELEMETRY = $taskOldTelemetry
    Pop-Location
}
