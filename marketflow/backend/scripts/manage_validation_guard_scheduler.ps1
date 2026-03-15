param(
    [ValidateSet("install", "remove", "status")]
    [string]$Action = "status",
    [string]$TaskName = "MarketFlowValidationGuardDaily",
    [string]$Time = "",
    [ValidateSet("QQQ", "SPY")]
    [string]$MarketProxy = "QQQ"
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $scriptDir

function Get-PolicyTime {
    param([string]$BackendDirPath)
    $policyPath = Join-Path $BackendDirPath "config\validation_guard_policy_v1.json"
    if (-not (Test-Path $policyPath)) {
        return "18:30"
    }
    try {
        $policy = Get-Content $policyPath -Raw | ConvertFrom-Json
        $t = [string]$policy.schedule.daily_run_time_local
        if ([string]::IsNullOrWhiteSpace($t)) { return "18:30" }
        return $t
    } catch {
        return "18:30"
    }
}

if ([string]::IsNullOrWhiteSpace($Time)) {
    $Time = Get-PolicyTime -BackendDirPath $backendDir
}

if (-not (Test-Path (Join-Path $backendDir "scripts\build_validation_snapshot.py"))) {
    Write-Host "build_validation_snapshot.py not found under backend/scripts" -ForegroundColor Red
    exit 1
}

$runnerCmd = Join-Path $backendDir "run_validation_guard_task.cmd"
if (-not (Test-Path $runnerCmd)) {
    Write-Host "run_validation_guard_task.cmd not found: $runnerCmd" -ForegroundColor Red
    exit 1
}

$taskCommand = "`"$runnerCmd`" $MarketProxy"

function Show-Status {
    schtasks /Query /TN $TaskName /V /FO LIST
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Task not found: $TaskName" -ForegroundColor Yellow
        return $false
    }
    return $true
}

if ($Action -eq "install") {
    Write-Host "Installing task: $TaskName at $Time (MarketProxy=$MarketProxy)" -ForegroundColor Cyan
    schtasks /Create /TN $TaskName /SC DAILY /ST $Time /RL LIMITED /F /TR $taskCommand
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to create task." -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "Task installed successfully." -ForegroundColor Green
    Show-Status | Out-Null
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
    Write-Host "Install example:" -ForegroundColor DarkGray
    Write-Host "  powershell -ExecutionPolicy Bypass -File backend/scripts/manage_validation_guard_scheduler.ps1 -Action install -MarketProxy QQQ"
    exit 0
}
