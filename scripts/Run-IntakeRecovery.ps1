# ============================================================================
# Run-IntakeRecovery.ps1 — PowerShell wrapper for the intake recovery scripts.
#
# Loads env vars from .env.local (KEY=VALUE pairs, blank lines + # comments OK),
# sets them as process-level env vars, then runs the requested mode.
#
# Usage:
#   .\scripts\Run-IntakeRecovery.ps1 -Mode SmokeSafe   # read-only smoke test
#   .\scripts\Run-IntakeRecovery.ps1 -Mode Smoke       # smoke test (writes 1)
#   .\scripts\Run-IntakeRecovery.ps1 -Mode Recover     # bulk recovery (writes ~230)
#
# Optional flags:
#   -Limit 5            # only process first N intakes (Recover mode)
#   -ThrottleMs 500     # ms between requests (Recover mode)
#   -EnvFile path       # use a different env file (default: .env.local)
# ============================================================================

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('SmokeSafe','Smoke','Recover')]
  [string]$Mode,
  [int]$Limit = 0,
  [int]$ThrottleMs = 250,
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
    $env:SAFE = '1'
    node scripts/smoke-test-promote.mjs
  }
  'Smoke' {
    $env:SAFE = $null
    node scripts/smoke-test-promote.mjs
  }
  'Recover' {
    if ($Limit -gt 0)      { $env:LIMIT       = "$Limit" }
    if ($ThrottleMs -gt 0) { $env:THROTTLE_MS = "$ThrottleMs" }
    node scripts/recover-stalled-intakes.mjs
  }
}

exit $LASTEXITCODE
