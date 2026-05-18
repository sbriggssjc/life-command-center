# QA-01 — Allowlist missing-views fix (SHOWSTOPPER)

**Severity: critical.** Every detail-panel feature shipped this sprint
was silently broken because the views were missing from the API proxy's
allowlist. Single-file fix.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-01-allowlist-missing-views
node audit/patches/qa-01-allowlist-missing-views/apply.mjs --dry
node audit/patches/qa-01-allowlist-missing-views/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-01-allowlist-missing-views/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-01-allowlist-missing-views -m "Merge audit/qa-01-allowlist-missing-views: SHOWSTOPPER allowlist fix"
git push origin main
```

## What was broken

Click any property in the LCC app right now and the detail panel
shows the tabs but **no completeness rail at the top** and **no
sticky next-action bar at the bottom**. They're rendered but
`display: none` because `_udCache.completeness` and `_udCache.nextAction`
are both `null`. The fetches succeed (HTTP 200) but return empty
arrays, so the frontend silently hides the rails.

Verified at three layers:
- **SQL** (via MCP): all views return correct data for the test property.
- **PostgREST** (via `SET LOCAL ROLE authenticated`): auth sees the row.
- **Frontend** (via `govQuery`): `{data: [], count: 0}` — silent empty.

The smoking gun: `api/_shared/allowlist.js` has a hard whitelist of
table/view names. Unlisted names get an empty response from the proxy
(NOT a 4xx). Every view we created this sprint was missing from it:

- `v_property_completeness`
- `v_next_best_action`
- `v_property_value_signal`
- `v_gap_agency_drift` (gov)
- `v_gap_lease_tenant_drift` (dia)
- `v_gap_chain_drift` (dia)
- `v_gap_orphan_sale_owner`
- `llc_research_queue`

The NBA Home rail worked because it calls `/api/admin?_route=next-best-action`
which uses `domainQuery` server-side, bypassing the allowlist entirely.

## Smoke test after Railway redeploys

1. Hard-reload the app.
2. Click any property in the NBA Home rail.
3. **The completeness rail should now appear directly under the tab bar**,
   showing the band chip + missing field chips.
4. **The sticky next-action bar should appear at the bottom** with the
   gap-specific CTA ("Open SoS →" / "Use lease value →" / "Backlink sale →"
   etc.).
5. Open Research page → Agency Drift widget — should now show rows
   instead of an empty state.

## Other findings from the QA pass (queued, separate patches)

| Finding | Impact |
|---|---|
| Dia NBA query times out (Postgres 57014) | NBA Home rail shows only gov; "65 total open" instead of thousands |
| "Open Activities = 0" vs "View all 7396 items" | Stat-card and list count disagree on Home |
| LLC research queue contains public REITs | Brandywine Realty Trust appears on the rail; SoS lookup is useless for public REITs |
| Same entity duplicated in queue | "Brandywine Realty Trust" + "Brandywine Realty Trust JV MSD Partners" — needs dedupe |
| Inbox cards have only "Open in Outlook ↗" | No inline "Mark processed" / "Promote" — forces a tab-switch per email |
| Agency casing "Dod" | Should be "DOD" / "DoD" — inconsistent |
| Detail panel header wraps to 4 lines for one agency name | Layout issue |
