# Item #4 v3.2 — dedupe + junk filter on missing_recorded_owner

**Branch:** `audit/04-dedupe-and-junk-filter`
**Migrations:** Already live on dia + gov via Supabase MCP at 2026-05-17.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/04-dedupe-and-junk-filter

node audit/patches/04-next-best-action-dedupe-and-junk-filter/apply.mjs --dry
node audit/patches/04-next-best-action-dedupe-and-junk-filter/apply.mjs --apply

git add -A
git commit -F audit/patches/04-next-best-action-dedupe-and-junk-filter/COMMIT_MSG.txt

git checkout main
git merge --no-ff audit/04-dedupe-and-junk-filter -m "Merge audit/04-dedupe-and-junk-filter: dedupe + junk filter"
git push origin main
```

## Verify after deploy

```powershell
$resp = curl.exe -H "X-LCC-Key: $env:LCC_API_KEY" `
  "https://tranquil-delight-production-633f.up.railway.app/api/admin?_route=next-best-action&limit=15"
$resp | ConvertFrom-Json | Select-Object -ExpandProperty items |
  Format-Table rank, source_domain, gap_severity, property_id, @{n='value';e={$_.gap_value -as [long]}}, gap_label
```

Expected: no more `[7 dup records]`-style hidden duplicates, no more
`property #NNN` or `Juru Pa Va Lley`-style junk in top ranks.
