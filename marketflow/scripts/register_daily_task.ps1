param(
  [string]$TaskName = "MarketFlow_MacroDailyJob",
  [string]$RunTime = "18:00",
  [string]$ProjectRoot = "",
  [string]$PythonExe = "python",
  [string]$SlackWebhookUrl = "",
  [switch]$EnableAlert
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
}

$dailyScript = Join-Path $ProjectRoot "scripts\daily_job.ps1"
$logPath = Join-Path $ProjectRoot "logs\daily_job.log"

$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$dailyScript`" -ProjectRoot `"$ProjectRoot`" -LogPath `"$logPath`""
if ($EnableAlert -and -not [string]::IsNullOrWhiteSpace($SlackWebhookUrl)) {
  $arg += " -EnableAlert -SlackWebhookUrl `"$SlackWebhookUrl`""
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
$trigger = New-ScheduledTaskTrigger -Daily -At $RunTime
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "MarketFlow macro collectors + snapshot job" -Force | Out-Null
Write-Host "Scheduled task registered: $TaskName at $RunTime"
Write-Host "Log path: $logPath"
if ($EnableAlert) {
  Write-Host "Alert mode: ON"
} else {
  Write-Host "Alert mode: OFF (deferred)"
}
