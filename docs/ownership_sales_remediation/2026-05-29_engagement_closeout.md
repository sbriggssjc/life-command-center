# Ownership & Sales Remediation — Engagement Closeout & Index

Date: 2026-05-29. Single source of truth for the remediation driven by
`OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md`. Everything safely and
testably deliverable from the remote (Claude-on-the-web) environment is
complete; the two remaining items are documented workstation handoffs.

## The three original symptoms → all fixed + structurally protected

| Symptom | Resolution | Structural guard (prevents regression) |
|---|---|---|
| Duplicate sales rows for one sale | dedup backfill + tick | `sales-dedup-tick` (15-min) + `ux_sales_dedup` partial unique index on `dedup_natural_key` |
| Sales transactions missing many elements | B8 completeness tile + C9 ingest contract | `validate*` contract on **all** curated writers (the anti-regression gate) |
| Ownership history "not in unison" | overlap cleanup + chain repair | `chk_oh_start_end_order` CHECK + `auto_close_prior_open_ownership` trigger (A6a) + **`excl_oh_no_overlap` EXCLUDE** (C5) |
| (bonus) deed_records orphans / synthetic | A4 backfill | dia/gov deed CHECK guards; new writes link at insert |
| (bonus) properties.latest_* drift | recompute | nightly recompute cron |

## Plan status — final

- ✅ **DONE / RESOLVED (29):** F1-F4, C1, C2, C3 (N/A), C4, C5, C6, C8, B1, B2, B4, B5, B6, B7, B8, A1, A2, A3, A4, A5, A6, A7, A8 (N/A), B3 (N/A)
- ⏳ **PARTIAL — documented remaining scope (2):**
  - **C9** — writer-validation sweep COMPLETE (deed-parser, OM promoter, RCM/LoopNet, CoStar sidebar all route through the ingest contract). Only the optional `commit_*` orchestrator convenience remains — a nicety, not a gap.
  - **A9** — A9a gov→hub data migration DONE (hub = 29,634 rows: 13,403 owners + 16,034 SF + 197 originals). A9b phases 1–2 (schema + value parity) DONE; hub is cutover-ready (column-diff clean, create-path verified email-safe). The flag-gated `govQuery→opsQuery` cutover (phases 3–7) is a workstation task — see the runbook below.
- 🛠 **WORKSTATION HANDOFFS (2):**
  - **A9b cutover flip** — turnkey runbook ready (`2026-05-29_a9b_cutover_runbook.md`). Needs UI/Vercel runtime testing + a flip decision.
  - **C7 SOS adapters** — framework scaffolded in `llc-research.js`; per-state adapters need live SOS-site access (all 5 endpoints 403 from the remote env) + the code's "verify-live-before-enable" contract. Build from a workstation, FL bulk-mirror first.

## Workstation scripts delivered (dry-run-first, reversible, audit-wrapped)

| Script | Purpose | Reversal |
|---|---|---|
| `scripts/A9a_migrate_gov_owner_contacts.mjs` | gov→hub contacts migration (`--scope=owners\|sf\|all`) | `DELETE FROM unified_contacts WHERE field_sources ? '_a9a_migrated'` |
| `scripts/A9b_backfill_parity_cols.mjs` | backfill the 4 parity columns gov→hub | columns are additive; values re-derivable from gov |

## Migrations applied this engagement

| Migration | DB | Effect |
|---|---|---|
| `20260527180000_dia_c5_phase2_ownership_exclude.sql` | dia | `excl_oh_no_overlap` EXCLUDE + `overlap_grandfathered` flag (617 grandfathered) |
| `20260527190000_lcc_a9b_unified_contacts_parity_columns.sql` | LCC Opps | +4 parity columns on `unified_contacts` |

## Audit-log inventory (LCC Opps `audit_run_log`)

| log_id | run_id | db | rows |
|---:|---|---|---:|
| 38 | C9_phase2_deed_parser_migration | all | 0 |
| 39 | C9_phase2_om_promoter_migration | all | 0 |
| 40 | C9_phase2_rcm_loopnet_migration | all | 0 |
| 41 | C9_phase2_sidebar_migration | all | 0 |
| 42 | C5_phase2_final_exclude | dia | 617 |
| 44 | A9a_script_authored | gov | 0 |
| 47 | A9a_gov_owner_contacts_applied | gov | 13,403 |
| 50 | A9a_gov_sf_contacts | gov | 16,034 |
| 51 | A9b_phase1a_parity_columns | lcc_opps | 0 |
| 52 | A9b_phase1b_parity_backfill | lcc_opps | 16,946 |

## Deploy reminders (carried, not yet confirmed live by me)

- **lead-ingest Edge Function** (Dialysis_DB ref `zqzrriwuavgrquhisnoa`) — redeploy to activate the RCM/LoopNet lead-name sanitization on the primary path: `supabase functions deploy lead-ingest --project-ref zqzrriwuavgrquhisnoa`. (Vercel fallback already covered on merge.)

## Session-doc index (`docs/ownership_sales_remediation/`)

C-track: `c2`, `c4`, `c5`, `c5p2prep`, `c5p2final`, `c8`, `c9`, `c9p2_deed_parser`, `c9p2_om_promoter`, `c9p2_rcm_loopnet`, `c9p2_sidebar` · B-track: `b3_investigation`, `b6`, `b8` · A-track: `a4b`, `a6a`, `a7`, `a9a`, `a9b_cutover_design`, `a9b_cutover_runbook`, `a8_closure` · C7: `c7_status` · This index: `engagement_closeout`.

## Next-session entry points

1. **A9b flip** — run the cutover runbook on a workstation/staging (delta re-sync → flag-gated repoint → test → flip → monitor).
2. **C7 adapters** — FL Sunbiz bulk-mirror first, from a context with SOS access.
3. **C9 orchestrators** — optional `commit_*` convenience layer (low priority).
