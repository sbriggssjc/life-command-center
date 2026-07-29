# Session Handoff — Data-Integrity & Pipeline Hardening (2026-05-21)

Companion to `GAPS_AND_FINDINGS_REGISTER.md` (the per-finding status list). This is the
"what shipped + what you need to do" summary.

---

## 1. Already LIVE — no action needed (DB changes, all reversible)

These were applied directly to the Supabase databases this session and are in effect now.

**Dialysis DB (`zqzrriwuavgrquhisnoa`)**
- **P-4** `auto_link_and_refresh_property_queue` hardened: in-use-medicare_id guard, per-row + per-linker exception isolation, unconditional MV refresh, dead no-arg overloads dropped, cron `*/1`→`*/15`.
- **P-5** `dia_auto_merge_property_duplicates` batch 50→20 (stops the `ingestion_log` lock-mutex timeout) + `auto_merge_property_failures` alert. Cron updated.
- **P-5b** `dia_merge_property` cascade-aware twin-dedup (leases / available_listings / sales_transactions / property_public_records + their RESTRICT grandchildren). Verified 3× clean 20/20. Hourly cron drains the remaining ~80 dup groups.
- **P-8** `dia_auto_consolidate_listings` now alerts (`auto_consolidate_listings_failures`) instead of swallowing failures.

**Government DB (`scknotsqkcheojiaewwh`)**
- **O-11** `propagate_parcel_owner_to_property` + `parcel_owner_xref` ledger + `v_recorded_vs_assessor_owner_divergence` view + cron `propagate-parcel-owner-to-property`. Backfilled all 9,409 assessor owners → 8,624 corroborate, 561 diverge (361 research leads enqueued).
- **P-6** `lcc_data_hygiene_sweep` per-step BEGIN/EXCEPTION isolation + `data_hygiene_sweep_step_error` alert (the bare-dup FK guard itself was already extended in R4-3).

**LCC Opps (`xengecqvemvfknjvbvrq`)**
- **P-9** 6 high-frequency crons staggered to distinct minute offsets via `cron.alter_job` (was 6 firing on :00 → now max 1/min). Validated against the "job startup timeout" failures.

**P-7** verified (no change needed): cron-failure alerting is live + scheduled on all three DBs.

---

## 2. CODE — needs commit + deploy

All files verified: parse clean, intact (line-count matches HEAD).

| File | Change | Finding |
|------|--------|---------|
| `api/_handlers/intake-matcher.js` | `review_needed`→`review_required` | P-2 |
| `api/intake.js` | promote status `promoted`→`finalized` | P-2 |
| `api/_shared/own-firm-addresses.js` (new) | `isOwnFirmAddress()` denylist helper | P-3 |
| `api/_handlers/sidebar-pipeline.js` | own-firm-address guard in `upsertDomainProperty` | P-3 |
| `api/_handlers/intake-extractor.js` | subject-property prompt instruction | P-3 |
| `api/admin.js` | `sos-writeback` route, domain-aware `llc-research-queue`, `generate-research-tasks` route + `fetchNbaFeed` | O-5, O-9 |
| `extension/sidepanel.js` | SOS research-queue + "SOS → Owner" write-back affordance | O-5 |
| `supabase/functions/data-query/index.ts` | allowlist `v_next_best_research`, `v_ownership_coverage` (gov+dia) | O-9 |
| `vercel.json` | rewrites for `/api/sos-writeback`, `/api/generate-research-tasks` | O-5, O-9 |
| `GAPS_AND_FINDINGS_REGISTER.md` + spec docs | documentation | — |

> NOTE: `api/_shared/llc-research.js` (SOS_DIRECT_ADAPTERS framework) was already committed earlier.

---

## 3. YOUR ACTION CHECKLIST

### a. Pre-commit integrity sweep (IMPORTANT — see §4)
The Cowork file-editing tool truncated several files mid-session (all repaired). Before committing, confirm nothing is truncated:
```powershell
# from repo root
Get-ChildItem -Recurse -Include *.js -File | Where-Object { $_.FullName -notmatch 'node_modules' } | ForEach-Object { node --check $_.FullName 2>&1 | ForEach-Object { Write-Host "FAIL $($_)" } }
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'));console.log('vercel.json OK')"
```
(Every tracked `.js` parsed clean at end of session; this is belt-and-suspenders.)

### b. Commit + push (feature branch per your rules — never main directly)
```
git checkout -b claude/pipeline-hardening-2026-05-21 origin/main
git add api/ extension/ supabase/functions/data-query/index.ts vercel.json *.md
git commit -m "Round 77: pipeline hardening — intake status fix (P-2), own-firm guard (P-3), SOS sidebar write-back (O-5), research-task generator (O-9)"
git push origin claude/pipeline-hardening-2026-05-21
```
Then merge to main via your PR flow.

### c. Deploy Vercel
Deploy the branch/main so the new admin.js routes (`sos-writeback`, `generate-research-tasks`), the intake status fix, and the own-firm guard go live. Confirm `ls api/*.js | wc -l` ≤ 12 (currently 12 — at the Hobby limit; no new function files were added).

### d. Redeploy the `data-query` edge function to the DIA project
The allowlist change lives in `supabase/functions/data-query/index.ts` and the function is hosted on the **Dialysis_DB** project (`zqzrriwuavgrquhisnoa`), per CLAUDE.md:
```
supabase functions deploy data-query --project-ref zqzrriwuavgrquhisnoa
```
Without this, `generate-research-tasks` will 403 on `v_next_best_research`.

### e. Enable the connection pooler (P-1 — the one outage fix still outstanding)
Point the app + edge functions at the **Supavisor transaction-mode pooler (port 6543)** instead of the direct connection (5432). This removes the PostgREST per-request connection churn that, with cron simultaneity, caused the outage. The cron staggering (P-9) addressed the simultaneity half; this is the other half.

### f. Post-deploy: schedule the research-task generator crons (on LCC Opps)
Only after (c)+(d) are live (otherwise these 404 and trip the cron-health alert):
```sql
SELECT cron.schedule('generate-research-tasks','35 6 * * *',
  $$SELECT public.lcc_cron_post('/api/admin?_route=generate-research-tasks&domain=both&limit=2000','{}'::jsonb,'vercel')$$);
SELECT cron.schedule('generate-research-tasks-inc','9-59/30 * * * *',
  $$SELECT public.lcc_cron_post('/api/admin?_route=generate-research-tasks&domain=both&limit=300','{}'::jsonb,'vercel')$$);
```
(`9,39` avoids the minute marks the other LCC crons were staggered onto in P-9.)

### g. Verify after deploy
- Hit `POST /api/generate-research-tasks?domain=both&limit=50` once → `research_tasks` should populate; top rows match top of `v_next_best_research`.
- SOS sidebar: open the LCC sidebar → "Research Queue" → "Look up SOS" on a top owner → scan the SOS page → "SOS → Owner" → confirm the `recorded_owners` row gets agent/manager/filing fields and the `llc_research_queue` row flips to `done`.
- Watch `lcc_health_alerts` for the new alert kinds (they should stay quiet).

---

## 4. Environment note — file-tool truncation
The Cowork Edit/Write tool intermittently wrote **truncated files** on this mount this session (6 files; all rebuilt from HEAD via bash and verified). The insidious one: `api/admin.js` lost `function stripNullsLocal`, which silently broke the `sos-writeback` route at runtime — `node --check` passed because a missing *reference* isn't a syntax error. **Lesson baked into §3a:** after any tool edit, verify line-count vs HEAD AND that referenced helpers still exist, not just that it parses.

---

## 5. Still open (future session — deploy/credential-gated, not doable from Cowork)
- **O-2** Owner→Salesforce link/create route — needs SF API creds + deploy.
- **O-7b** Deed-scraper depth (capture `recording_date`, situs/APN, persist `property_id` at fetch) — Python scraper, must run against live county sites. See `SPEC_deed_county_ingestion_fix.md`.
- **O-8** Address-canonical matcher — deliberately deferred; has no fuel until O-5/O-7 feeds populate owner addresses.
- **O-4** dia `unified_contacts` cross-domain home — infra decision.
- **O-5 long tail** Per-state SOS auto-adapters (FL Sunbiz bulk-file first); sidebar workhorse covers all states now.
