$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $rootDir

if (-not (Test-Path ".\data")) {
  New-Item -ItemType Directory -Path ".\data" | Out-Null
}

$dbPath = Join-Path $rootDir "data\cache.db"
$env:CACHE_DB_PATH = $dbPath

Write-Host "[INFO] ROOT=$rootDir"
Write-Host "[INFO] CACHE_DB_PATH=$env:CACHE_DB_PATH"

python .\scripts\init_cache_db.py
python .\collectors\collect_market.py
python .\collectors\collect_cboe.py
python .\collectors\collect_fred.py
python .\build_macro_snapshot.py
python .\scripts\check_db_health.py

if (Test-Path $dbPath) {
  $size = (Get-Item $dbPath).Length
  Write-Host "[OK] cache.db exists: $dbPath (bytes=$size)"
} else {
  Write-Host "[ERR] cache.db not found: $dbPath"
  exit 1
}
