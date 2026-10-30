# Starts the RMC2 staging (test-data-only) instance on 127.0.0.1:5180.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-staging.ps1
# Options: -Port 5180  -DataDir test-results\staging-data  -ForceBuild
param(
  [int]$Port = 5180,
  [string]$DataDir = "test-results\staging-data",
  [switch]$ForceBuild
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($Port -eq 5173) { throw "Port 5173 is the real local instance. Use another port." }
$dataFull = [System.IO.Path]::GetFullPath((Join-Path $root $DataDir))
$realData = [System.IO.Path]::GetFullPath((Join-Path $root ".data")).TrimEnd('\')
if ($dataFull.TrimEnd('\') -ieq $realData -or $dataFull.StartsWith($realData + "\", [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use the real .data directory for staging."
}
if (-not (Test-Path (Join-Path $dataFull "STAGING_CREDENTIALS.txt"))) {
  throw "Run 'node scripts/staging-setup.mjs' first (no staging credentials found in $dataFull)."
}

# Keep only the converter setting from .env.local (values are never printed).
$envFile = Join-Path $root ".env.local"
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*RMC2_OFFICE_EXECUTABLE\s*=\s*(.+?)\s*$') {
      [Environment]::SetEnvironmentVariable("RMC2_OFFICE_EXECUTABLE", $Matches[1].Trim('"').Trim("'"), "Process")
    }
  }
}
# Staging must not inherit provider keys. On Windows an empty value deletes the variable and lets .env.local refill it,
# so pin an inert non-empty value instead.
foreach ($name in "CLOUDCONVERT_API_KEY", "OPENAI_API_KEY") { [Environment]::SetEnvironmentVariable($name, "disabled-in-staging", "Process") }
$env:RMC2_DATA_DIR = $dataFull
$env:RMC2_SEED_DEMO = "1"   # next start sets NODE_ENV=production, which would otherwise skip the demo seed

# ---- Mail (phase 1 real email, test inbox only) ----
# Next.js never lets .env.local override a variable already in the process environment, but on Windows
# setting a variable to "" REMOVES it, so clearing is not a barrier. Therefore: (1) clear every mail var,
# (2) refuse to start if any Next .env* file contains mail keys, (3) set explicit non-empty MODE/ENV.
foreach ($e in @(Get-ChildItem Env: | Where-Object { $_.Name -match '^(RMC2_MAIL_|RMC2_SMTP_)' })) {
  [Environment]::SetEnvironmentVariable($e.Name, $null, "Process")
}
foreach ($f in ".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local") {
  $p = Join-Path $root $f
  if ((Test-Path $p) -and (Select-String -Path $p -Pattern '^\s*(export\s+)?(RMC2_MAIL_|RMC2_SMTP_)' -Quiet)) {
    throw "$f contains RMC2_MAIL_/RMC2_SMTP_ keys. Mail settings belong only in .env.mail.test. Remove them from $f."
  }
}
$mailFile = Join-Path $root ".env.mail.test"
$mailLabel = "Mail: local (simulated)"
$env:RMC2_MAIL_MODE = "local"
$env:RMC2_MAIL_ENV = "staging"
if (Test-Path $mailFile) {
  foreach ($line in Get-Content $mailFile) {
    if ($line -match '^\s*(RMC2_MAIL_[A-Z_]+|RMC2_SMTP_[A-Z_]+)\s*=\s*(.*?)\s*$') {
      $val = $Matches[2]
      if ($val.Length -ge 2 -and (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'")))) { $val = $val.Substring(1, $val.Length - 2) }
      if ($val -ne "") { [Environment]::SetEnvironmentVariable($Matches[1], $val, "Process") }
    }
  }
  $env:RMC2_MAIL_ENV = "staging"   # forced regardless of the file
  if ($env:RMC2_MAIL_MODE -eq "smtp") {
    foreach ($req in "RMC2_SMTP_HOST", "RMC2_SMTP_PORT", "RMC2_SMTP_USER", "RMC2_SMTP_APP_PASSWORD", "RMC2_MAIL_FROM_ADDRESS", "RMC2_MAIL_REDIRECT_TO", "RMC2_MAIL_ALLOWLIST") {
      if (-not [Environment]::GetEnvironmentVariable($req, "Process")) { throw ".env.mail.test is missing $req (smtp mode needs it). Fix the file or remove it for simulated mail." }
    }
    $to = $env:RMC2_MAIL_REDIRECT_TO.Split(",")[0].Trim()
    $masked = if ($to.IndexOf("@") -gt 2) { $to.Substring(0, 2) + "***@..." } else { "***@..." }
    $dry = if ($env:RMC2_MAIL_DRY_RUN -eq "1") { ", DRY RUN" } else { ", LIVE" }
    $mailLabel = "Mail: smtp -> redirected to $masked$dry"
  } else {
    $env:RMC2_MAIL_MODE = "local"
  }
}
Write-Host $mailLabel

if ($ForceBuild -or -not (Test-Path (Join-Path $root ".next\BUILD_ID"))) {
  Write-Host "Building (npm run build)..."
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed." }
}

Write-Host "Staging data dir: $dataFull"
Write-Host "Starting on http://127.0.0.1:$Port (Ctrl+C to stop)"
& node (Join-Path $root "node_modules\next\dist\bin\next") start --hostname 127.0.0.1 --port $Port
