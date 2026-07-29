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
- **`field-provenance-prune` cron: FIXED** — 2026-07-29 04:30 run `succeeded` (the nightly timeout/FK failures
  have stopped).
- **Matcher v2.1** precision fixes (word-boundary, digest exclusion) live.
- **Address-resolution engine** live; the reconciliation backlog for the open pipeline is clear.

## ⚠️ Open items (mostly your PA tenant — gate before rollout)
| Item | Severity | Owner | Notes |
|---|---|---|---|
| **To-Do flows failing daily** (`To Do - Life Command Center Sync`, `Unflag Completed Email Tasks`) | error | 🧑 | Root-caused: a deleted/renamed Microsoft To-Do list → 404. Repair the list reference; fixes both. Blocks these being in anyone's rollout bundle. |
| **NEW: `SF -> LCC: Daily Bulk File Backfill`** fails at `Apply_to_each` | error | 🧑 | Same benign class — an empty/edge-case collection into a loop. Shared file-backfill flow, not spine-critical. Add a null-guard / "length > 0" condition before the loop. |
| **`feed:gov:loans` stale** (31d vs 30d SLA) | warn | 🤖+🧑 | Loans ingest may have stopped; investigate the GOV loans job. Non-blocking. |

## 📐 Known/expected — not errors
- **`bd_opportunities.property_address` is null** for all deals — by design: the SF address can't flow through
  the connector (formula FLS + no relationship traversal). Addresses live on the **entity** records via the
  reconciliation engine, which is where matching/geocoding read them. Not a defect.
- **8 flagged-open deals remain** — all **non-Team-Briggs owners** (out of scope); the TB open backlog is 0.
- Several long-cadence GOV/DIA ingests show "last ran N days ago" — expected for quarterly/annual feeds; the two
  dialysis ones (`cms_ingestion` 33d, `email` 118d) are worth a confirm.

## 🔨 Remaining hardening (🤖-drivable, low priority, non-blocking)
- Function `search_path` pinning + revoke-execute-from-anon across all 3 DBs (WARN-level).
- DIA Postgres 15 → current (advisor `vulnerable_postgres_version`).
- Actor-identity reconciliation (broker `users` rows read "Scott Briggs") — needed for per-broker *attribution*,
  not for cadence. Tracked in TEAM-ROLLOUT "Known gaps".

## Verdict
The **core LCC and the deal-intelligence spine are working as designed** — data is flowing, correct, and
self-healing. The rollout gate is not yet clear only because of **your-tenant PA-flow errors** (To-Do + backfill)
and a couple of low-priority hardening items. None is a defect in the LCC engine itself. Clear the PA-flow errors
and confirm the two dialysis feeds, and the system is rollout-ready.
