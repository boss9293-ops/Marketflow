param(
  [string]$ProjectRoot = "",
  [string]$LogPath = "",
  [string]$SlackWebhookUrl = "",
  [switch]$EnableAlert
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
}
if ([string]::IsNullOrWhiteSpace($LogPath)) {
  $LogPath = Join-Path $ProjectRoot "logs\daily_job.log"
}

New-Item -ItemType Directory -Force -Path (Split-Path $LogPath -Parent) | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $LogPath -Value "[$stamp] daily job start"

function Write-Log([string]$msg) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $LogPath -Value "[$ts] $msg"
}

function Run-Step([string]$name, [scriptblock]$block) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  & $block
  $sw.Stop()
  Write-Log "$name latency_ms=$($sw.ElapsedMilliseconds)"
}

function Send-SlackFailure([string]$message) {
  if (-not $EnableAlert) { return }
  if ([string]::IsNullOrWhiteSpace($SlackWebhookUrl)) { return }
  try {
    $payload = @{ text = $message } | ConvertTo-Json -Depth 3
    Invoke-RestMethod -Method Post -Uri $SlackWebhookUrl -Body $payload -ContentType "application/json" | Out-Null
    Write-Log "slack alert sent"
  } catch {
    Write-Log "slack alert failed: $($_.Exception.Message)"
  }
}

try {
  Set-Location $ProjectRoot
  if (-not (Test-Path ".\data")) {
    New-Item -ItemType Directory -Path ".\data" | Out-Null
  }
  $env:CACHE_DB_PATH = (Join-Path $ProjectRoot "data\cache.db")
  Write-Log "CACHE_DB_PATH=$env:CACHE_DB_PATH"
  Write-Log "ENABLE_ALERT=$EnableAlert"

  Run-Step "collect_market" { python collectors/collect_market.py; if ($LASTEXITCODE -ne 0) { throw "collect_market failed: exit=$LASTEXITCODE" } }
  Run-Step "collect_cboe" { python collectors/collect_cboe.py; if ($LASTEXITCODE -ne 0) { throw "collect_cboe failed: exit=$LASTEXITCODE" } }
  Run-Step "collect_fred" { python collectors/collect_fred.py; if ($LASTEXITCODE -ne 0) { throw "collect_fred failed: exit=$LASTEXITCODE" } }
  Run-Step "build_macro_snapshot" { python build_macro_snapshot.py; if ($LASTEXITCODE -ne 0) { throw "build_macro_snapshot failed: exit=$LASTEXITCODE" } }

  Write-Log "daily job success"
  exit 0
}
catch {
  $msg = "Macro Snapshot Failed - $($_.Exception.Message)"
  Write-Log $msg
  Send-SlackFailure $msg
  exit 1
}
