# Quick rerun of just the 4 final failures from the bulk recovery
# (multi-tenant medical OMs that needed entity address column patched).
#
# Loads LCC_API_KEY from .env.local with quote-stripping (matches the loader
# logic in Run-IntakeRecovery.ps1). Without quote stripping, a value of the
# form `LCC_API_KEY="abc123"` produces `"abc123"` (with literal quotes)
# which the Railway middleware rejects as 401 Unauthorized.
$rawKey = (Get-Content .env.local | Where-Object { $_ -match '^LCC_API_KEY=' } | Select-Object -First 1) -replace '^LCC_API_KEY=', ''
$rawKey = $rawKey.Trim()
if (($rawKey.StartsWith('"') -and $rawKey.EndsWith('"')) -or
    ($rawKey.StartsWith("'") -and $rawKey.EndsWith("'"))) {
  $rawKey = $rawKey.Substring(1, $rawKey.Length - 2)
}
$env:LCC_API_KEY    = $rawKey
$env:LCC_BASE_URL   = "https://tranquil-delight-production-633f.up.railway.app"
$env:LCC_WORKSPACE  = 'a0000000-0000-0000-0000-000000000001'

$ids = @(
  '2df833c4-83ae-436f-9287-e1088912a3a6',  # 250 Pettit Ave Bellmore NY (Fresenius multi-tenant)
  'bb041bc0-e850-455b-8078-a6323a61e5b2',  # 24931 Kelly Rd Eastpointe MI (Nephrology Center)
  '14ad93c9-765f-475f-9781-718e0212b788',  # 2701 Francis Lewis Blvd Flushing NY (US Renal Care)
  'b9018b18-43c1-48ff-98cc-97b38102a21e'   # 671 HIOAKS RD Richmond VA (DaVita + Richmond Nephrology)
)

$headers = @{
  'Content-Type'    = 'application/json'
  'X-LCC-Key'       = $env:LCC_API_KEY
  'X-LCC-Workspace' = $env:LCC_WORKSPACE
}

foreach ($id in $ids) {
  Write-Host -NoNewline "$id ... "
  try {
    $body = @{ intake_id = $id } | ConvertTo-Json
    $resp = Invoke-WebRequest -Uri "$($env:LCC_BASE_URL)/api/intake?_route=promote" `
      -Method POST -Headers $headers -Body $body -UseBasicParsing
    $r = $resp.Content | ConvertFrom-Json
    if ($r.propagated) {
      Write-Host "OK domain=$($r.domain) property_id=$($r.domain_property_id)" -ForegroundColor Green
    } else {
      Write-Host "FAIL propagated=false" -ForegroundColor Red
      $r.pipeline_summary | ConvertTo-Json -Compress
    }
  } catch {
    Write-Host "ERROR $($_.Exception.Message)" -ForegroundColor Red
  }
}
