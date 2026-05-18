# QA-02 — Edge Function allowlist + completeness-rail null-crash fix

**Severity: critical.** Closes the SHOWSTOPPER discovered during the
in-browser QA pass on 2026-05-18: every detail-panel feature shipped
this sprint was silently broken in production.

QA-01 already fixed the Express-side allowlist (`api/_shared/allowlist.js`)
but that file is **not** on the production code path — Vercel rewrites
`/api/gov-query` → `/api/admin?_route=edge-data` → the
`data-query` Edge Function on Supabase project `zqzrriwuavgrquhisnoa`.
The Edge Function's own `GOV_READ_TABLES` / `DIA_READ_TABLES` sets were
the real allowlist, and they were missing every sprint-era view.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-02-allowlist-edge-rail-fix
node audit/patches/qa-02-allowlist-edge-rail-fix/apply.mjs --dry
node audit/patches/qa-02-allowlist-edge-rail-fix/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-02-allowlist-edge-rail-fix/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-02-allowlist-edge-rail-fix -m "Merge audit/qa-02-allowlist-edge-rail-fix: SHOWSTOPPER allowlist + rail crash fix"
git push origin main
```

## What this patch does

The Edge Function side has already been deployed live during the QA
session (v14 on project `zqzrriwuavgrquhisnoa`). The `apply.mjs` script
mostly bookkeeps:

1. **Verifies** `supabase/functions/data-query/index.ts` contains the
   QA-02 sentinel (the new view entries). Fails loudly if the on-disk
   source somehow regressed away from what's deployed.
2. **Verifies** `detail.js` contains the QA-04 sentinel
   (`missing_fields` null-filter). Same — fails loudly on regression.
3. **Adds** a one-line comment above the `DATA_QUERY_EDGE_URL` constant
   in `api/admin.js` noting which Supabase project hosts the live
   function. Prevents the v10-to-wrong-project mistake from happening
   again (it cost ~20 min during the QA pass).
4. **Updates** `AUDIT_PROGRESS.md` with the QA-02 / QA-04 closeout.

## Three-layer verification of the fix

Captured live during the session:

| Layer | Before deploy | After deploy |
|---|---|---|
| SQL (via Supabase MCP) | view returns rows | view returns rows |
| PostgREST (anonymous read) | row visible | row visible |
| Frontend `govQuery` | `{data:[], count:0}` then `403 Read access denied` | `{count:17459}` for `v_property_completeness`, `{count:5184}` for `v_next_best_action` |
| Detail panel `_udCache.completeness` | `null` | `{score:57, band:"fair", missing_fields:[…6 fields…]}` |
| Detail panel `_udCache.nextAction` | `null` | `{gap_type:"missing_recorded_owner", gap_value:990M, …}` |
| Completeness rail render | crash on `null.key` | renders 6 chips, score 57, band "fair" |
| Next-action bar render | hidden (cache null) | renders "Open SoS →" with $990M value meta |

## Affected views, by domain

**GOV** (added to `GOV_READ_TABLES` in the Edge Function):
- `v_property_completeness` — Item #6 completeness rail
- `v_next_best_action` — Item #8 next-action bar (detail panel)
- `v_property_value_signal` — NBA value FK
- `v_gap_agency_drift` — A-5 widget + #8 B-2 dispatcher
- `v_gap_orphan_sale_owner` — NBA orphan branch
- `llc_research_queue` — NBA llc branch

**DIA** (added to `DIA_READ_TABLES` in the Edge Function):
- Same six as gov, plus:
- `v_gap_lease_tenant_drift` — #8 B-4 dispatcher
- `v_gap_chain_drift` — #8 B-4 dispatcher

## Why the NBA Home rail still worked through this whole sprint

It calls `/api/admin?_route=next-best-action` which uses `domainQuery`
server-side, **bypassing the allowlist**. That's the one code path
with the working DB access. Everything else (detail panel,
per-action dispatchers, Agency Drift widget) goes through `govQuery` /
`diaQuery` browser-side → `/api/gov-query` → Vercel rewrite →
Edge Function → allowlist → silent empty / 403.

## Smoke test after Vercel redeploys

1. Hard-reload the app.
2. Click any property in the NBA Home rail.
3. **Completeness rail** should appear directly under the tab bar —
   band chip ("fair"/"good"/etc) + the top-6 highest-weight missing
   field chips.
4. **Sticky next-action bar** should appear at the bottom with the
   gap-specific CTA ("Open SoS →" / "Use lease value →" / "Backlink
   sale →" depending on `gap_type`).
5. Open Research page → if the Agency Drift widget exists on this
   surface it should now render rows instead of an empty state.

## Follow-ups (separate patches)

Captured in the QA report (`outputs/lcc-qa-pass-2026-05-18.docx`),
queued by priority:

- **P0** — Dia `v_next_best_action` times out (Postgres 57014). Home
  rail header shows "⚠ partial · 10 shown · 65 total open".
- **P0** — `govQuery('property_intel')` 403 every time — gov has no
  `property_intel` table, only `v_property_intel` (already in
  allowlist). Frontend asks for the wrong name.
- **P0** — `govQuery('v_ownership_chain')` 400 — gov view has no
  `property_id` column. Frontend selector is dia-shaped.
- **P1** — "Open Activities" stat conflicts: 0 (Home) vs 23 (Pipeline)
  vs 7,402 (Metrics).
- **P1** — Sync error count: Pipeline says "1 outlook failing",
  Metrics says "0".
- **P1** — Public REITs in `llc_research_queue` (Brandywine Realty
  Trust at NBA #9 + #10).
- **P1** — Same-entity duplicates in `llc_research_queue`.
- **P2** — Casing: "Dod" → "DOD"/"DoD", "Ave Se" → "Ave SE",
  cluster label "townebank" → "Townebank".
- **P2** — Calendar zero-duration events ("5:40 AM – 5:40 AM").
- **P2** — Home inbox cards lack inline actions (Inbox page has them).
- **P2** — AI Copilot FAB has no visible label / aria-label.
