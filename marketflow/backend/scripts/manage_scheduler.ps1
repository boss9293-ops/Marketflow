param(
    [ValidateSet("install", "remove", "status")]
    [string]$Action = "status",
    [string]$TaskName = "MarketFlowPipelineDaily",
    [string]$Time = "08:30",
    [string]$PythonExe = "python"
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $scriptDir

if (-not (Test-Path (Join-Path $backendDir "run_pipeline_scheduled.py"))) {
    Write-Host "run_pipeline_scheduled.py not found under backend directory: $backendDir" -ForegroundColor Red
    exit 1
}

$runnerCmd = Join-Path $backendDir "run_pipeline_task.cmd"
if (-not (Test-Path $runnerCmd)) {
    Write-Host "run_pipeline_task.cmd not found: $runnerCmd" -ForegroundColor Red
    exit 1
}

$taskCommand = "`"$runnerCmd`""

function Show-Status {
    schtasks /Query /TN $TaskName /V /FO LIST
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Task not found: $TaskName" -ForegroundColor Yellow
        return $false
    }
    return $true
}

if ($Action -eq "install") {
    Write-Host "Installing task: $TaskName at $Time" -ForegroundColor Cyan
    schtasks /Create /TN $TaskName /SC DAILY /ST $Time /RL LIMITED /F /TR $taskCommand
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to create task." -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "Task installed successfully." -ForegroundColor Green
    Show-Status
    exit 0
}

if ($Action -eq "remove") {
    Write-Host "Removing task: $TaskName" -ForegroundColor Yellow
    schtasks /Delete /TN $TaskName /F
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to remove task or task not found." -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "Task removed successfully." -ForegroundColor Green
    exit 0
}

Write-Host "Task status: $TaskName" -ForegroundColor Cyan
$ok = Show-Status
if (-not $ok) {
    exit 0
}
