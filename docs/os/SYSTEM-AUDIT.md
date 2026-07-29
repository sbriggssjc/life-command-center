# LCC System Audit — pre-rollout verification

_2026-07-29. The "is everything working as designed?" gate that must clear before any team member is onboarded
(see TEAM-ROLLOUT.md). Re-run this audit before lifting the rollout hold._

## ✅ Deal-intelligence spine — HEALTHY (verified live)
| Check | Result |
|---|---|
| Backbone deals synced | **592** (219 won / 339 lost / 40 open) |
| Open pipeline | **40** open (self-syncing every 30 min) |
| Team roster edges | **192** team (`sf_opp_team`) + **50** email-derived |
| Matcher attributions | **186** deal-attributed emails (v2.1, city-anchored) |
| Cadence-scan / weekly-digest | live; owner-scoping verified (team vs per-broker) |
| Entity reconciliation | **0 open Team-Briggs flagged** (all 7 resolved; real addresses on entities) |

Sync → roster → matcher → cadence → digest is connected end-to-end and producing correct data.

## ✅ Fixes verified holding
- **Security advisors: 0 ERRORs across all 3 DBs** (OPS/GOV/DIA; 928 cleared) — verified no engine breakage.
  _(Re-check 2026-07-29: OPS had regressed to **2** ERRORs — two tables created after the 07-28 sweep with RLS
  off. Fixed via `20260729120000_rls_enable_two_stragglers_ops.sql`; **OPS back to 0**. See ERROR-TRIAGE Slice 6.)_
- **`field-provenance-prune` cron: FIXED** — 2026-07-29 04:30 run `succeeded` (the nightly timeout/FK failures
  have stopped).
- **Matcher v2.1** precision fixes (word-boundary, digest exclusion) live.
- **Address-resolution engine** live; the reconciliation backlog for the open pipeline is clear.

## ✅ Rollout-gate PA-flow items — CLEARED 2026-07-29
| Item | Status | Notes |
|---|---|---|
| **To-Do flows failing daily** (`To Do - Life Command Center Sync`, `Unflag Completed Email Tasks`) | ✅ resolved | Confirmed RETIRED (2026-07-20/21 native-Flagged-email rework), **turned OFF**. No failures since. |
| **`LCC To-Do Completion Poll`** 404 | ✅ fixed+tested | Was hard-coding the Flagged-email `folderId`; now resolves it each run (`Get_Lists`+filter `wellknownListName=flaggedEmails`) + empty-guard. Saved, tested green. |
| **`SF -> LCC: Daily Bulk File Backfill`** fails at `Apply_to_each` | ✅ fixed+tested | Not the loop — the manifest `HTTP` body used `@json(concat(...))` → invalid JSON on special-char filenames / null versions. Rebuilt as native JSON body. **Test run ingested 4 files to `stored`, no failure.** |
| **`feed:gov:loans` stale** (~36d vs 30d SLA) | ⚠️ warn / 🧑 | External upstream GOV loans pull halted ~06-23; restart the source. Non-blocking (deal-spine is OPS). |
| **`LoopNet_Power_Automate`** flow_failure (07-28) | ⚠️ warn / 🧑 | Likely stale `*.vercel.app` host; repoint RCM/LoopNet backfill to Railway. Low priority. |

## 📐 Known/expected — not errors
- **`bd_opportunities.property_address` is null** for all deals — by design: the SF address can't flow through
  the connector (formula FLS + no relationship traversal). Addresses live on the **entity** records via the
  reconciliation engine, which is where matching/geocoding read them. Not a defect.
- **8 flagged-open deals remain** — all **non-Team-Briggs owners** (out of scope); the TB open backlog is 0.
- Several long-cadence GOV/DIA ingests show "last ran N days ago" — expected for quarterly/annual feeds; the two
  dialysis ones (`cms_ingestion` 33d, `email` 118d) are worth a confirm.

## 🔨 Remaining hardening — mostly DONE since first audit
- ✅ Function `search_path` pinning **done** (all 3 DBs); ✅ EXECUTE revoked from anon/authenticated on SD
  functions **done**; ✅ RLS regression on 2 OPS tables **fixed**. Security audit effectively complete — 0 ERRORs.
- 🧑 DIA Postgres 15 → current (`vulnerable_postgres_version`) — dashboard/infra upgrade, still pending.
- Actor-identity reconciliation: ✅ DB foundation **done** (broker identities fixed, `lcc_actor_for_mailbox`,
  self-heal trigger). Per-broker *attribution* goes live when the intake code change deploys (🧑). Not needed for cadence.

## Verdict (updated 2026-07-29)
The **core LCC and the deal-intelligence spine are working as designed**, and the **rollout-gate PA-flow errors are
now cleared** (To-Do zombies off, Completion Poll fixed, Bulk File Backfill fixed + test-ingested). Remaining items
are non-blocking: the DIA PG patch (dashboard), the gov:loans upstream restart, one stale LoopNet host, and
deploying the per-broker attribution code (cadence works without it). **The system is rollout-ready** pending
those housekeeping items and a final go/no-go.
