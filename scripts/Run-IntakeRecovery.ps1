# ============================================================================
# Run-IntakeRecovery.ps1 — PowerShell wrapper for the intake recovery scripts.
#
# Loads env vars from .env.local (KEY=VALUE pairs, blank lines + # comments OK),
# sets them as process-level env vars, then runs the requested mode.
#
# Usage:
#   .\scripts\Run-IntakeRecovery.ps1 -Mode SmokeSafe         # read-only smoke test
#   .\scripts\Run-IntakeRecovery.ps1 -Mode Smoke             # smoke test (writes 1)
#   .\scripts\Run-IntakeRecovery.ps1 -Mode Recover           # bulk recovery (writes ~230)
#   .\scripts\Run-IntakeRecovery.ps1 -Mode AuditCorrectness  # cross-check 24h promotions
#
# Optional flags:
#   -Limit 5             # only process first N intakes (Recover mode)
#   -ThrottleMs 500      # ms between requests (Recover mode)
#   -LookbackHours 48    # how far back to audit (AuditCorrectness mode, default 24)
#   -EnvFile path        # use a different env file (default: .env.local)
# ============================================================================

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('SmokeSafe','Smoke','Recover','AuditCorrectness')]
  [string]$Mode,
  [int]$Limit = 0,
  [int]$ThrottleMs = 250,
  [int]$LookbackHours = 24,
  [string]$EnvFile = '.env.local'
)

$ErrorActionPreference = 'Stop'

# Resolve repo root (parent of this script's directory)
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path $EnvFile)) {
  Write-Host "Env file not found: $EnvFile" -ForegroundColor Red
  Write-Host "Either:" -ForegroundColor Yellow
  Write-Host "  - Place .env.local in the repo root, OR"
  Write-Host "  - Run: vercel env pull .env.local --environment=production"
  exit 1
}

Write-Host "Loading env from $EnvFile..." -ForegroundColor DarkGray
$loaded = 0
Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#')) {
    $eq = $line.IndexOf('=')
    if ($eq -gt 0) {
      $key = $line.Substring(0, $eq).Trim()
      $val = $line.Substring($eq + 1).Trim()
      # Strip surrounding quotes if present
      if (($val.StartsWith('"') -and $val.EndsWith('"')) -or
          ($val.StartsWith("'") -and $val.EndsWith("'"))) {
        $val = $val.Substring(1, $val.Length - 2)
      }
      [Environment]::SetEnvironmentVariable($key, $val, 'Process')
      $loaded++
    }
  }
}
Write-Host "Loaded $loaded env vars." -ForegroundColor DarkGray

# Verify required vars
foreach ($req in @('LCC_API_KEY','LCC_BASE_URL')) {
  if (-not [Environment]::GetEnvironmentVariable($req, 'Process')) {
    Write-Host "Missing required env var: $req" -ForegroundColor Red
    exit 1
  }
}
Write-Host ""

switch ($Mode) {
  'SmokeSafe' {
    Remove-Item Env:LIMIT -ErrorAction SilentlyContinue
    Remove-Item Env:THROTTLE_MS -ErrorAction SilentlyContinue
    Remove-Item Env:DRY_RUN -ErrorAction SilentlyContinue
    $env:SAFE = '1'
    node scripts/smoke-test-promote.mjs
  }
  'Smoke' {
    Remove-Item Env:LIMIT -ErrorAction SilentlyContinue
    Remove-Item Env:THROTTLE_MS -ErrorAction SilentlyContinue
    Remove-Item Env:DRY_RUN -ErrorAction SilentlyContinue
    Remove-Item Env:SAFE -ErrorAction SilentlyContinue
    node scripts/smoke-test-promote.mjs
  }
  'Recover' {
    # Always reset these so a previous invocation's values don't leak in
    # (PowerShell process env vars persist across `node` calls in the same
    # session). Set them only when the user explicitly passes the flag.
    if ($Limit -gt 0)      { $env:LIMIT       = "$Limit" }       else { Remove-Item Env:LIMIT       -ErrorAction SilentlyContinue }
    if ($ThrottleMs -gt 0) { $env:THROTTLE_MS = "$ThrottleMs" }  else { Remove-Item Env:THROTTLE_MS -ErrorAction SilentlyContinue }
    Remove-Item Env:DRY_RUN -ErrorAction SilentlyContinue
    node scripts/recover-stalled-intakes.mjs
  }
  'AuditCorrectness' {
    # Cross-check each recently-promoted intake's extraction snapshot
    # against the resolved domain property. Writes a CSV next to the script.
    if ($LookbackHours -gt 0) { $env:LOOKBACK_HOURS = "$LookbackHours" } else { Remove-Item Env:LOOKBACK_HOURS -ErrorAction SilentlyContinue }
    node scripts/audit-promotion-correctness.mjs
  }
}

exit $LASTEXITCODE
