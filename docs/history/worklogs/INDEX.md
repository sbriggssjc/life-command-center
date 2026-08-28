# Archived per-round worklogs (moved from the repo root, 2026-08-27)

**31 one-off worklog files** that had accumulated at the repo root were moved here verbatim.
Nothing was edited or deleted — this is archival, not lossy cleanup.

## Why they moved

The root held 100 `.md` files, 31 of them single-round worklogs. The **P141 consolidation
(2026-08-26) swept `docs/` and never looked at the repo root**, so these sat outside every index —
including `PLANNED-BACKLOG.md`, which is supposed to be the one place unbuilt work lives.

## ⚠️ Seven of them carried unfinished work. It is now in the backlog.

Before moving anything, all 31 were scanned for open-work markers; 24 were clean and 7 were not.
Everything actionable was extracted into `docs/os/PLANNED-BACKLOG.md` **P10** as rows
**K13–K20**, each keeping its original measurement:

| backlog row | recovered from | what it is |
|---|---|---|
| **K13** | `CAPMARKETS_TAB_PACKET_WORKLOG.md` | `cm_gov_sold_cap_by_term_dot` uses the **old term ladder**, not `firm_term_years_at_sale` — 1,368 sales bucket differently; `cap_5to10` labelled `6-10` |
| **K14** | same | `cm_gov_lease_termination_rate_m/_q` can pick a **corrupt partial snapshot** as its active denominator (Feb-2019: 11 lease keys vs ~8,050) |
| **K15** | same | the corrupt source months themselves — `gsa_snapshots` 2019-02, `gsa_inventory_snapshot_lines` 2019-02 / 2022-10 / 2022-11 |
| **K16** | same | `cm_gov_rent_price_psf_q` has **no display policy**; pre-1997 is unreliable. Scott's call: crop at 1997-06-30 or 2003-01-01 |
| **K17** | same | `cm_gov_market_turnover_m` — export crops at 2012 in code, but the gov `cm_view_registry` has no `display_from`, so DB and export disagree |
| **K18** | same | `cm_gov_core_cap_rate_dots` keeps a lease-derived fallback that **currently plots 0 rows** — fine today, a leak for future unbackfilled sales |
| **K19** | `GOVERNMENT_SELLER_SENTIMENT_WORKLOG.md` | the gov `_8q` / `6+ yr` fix was **never mirrored to dia** (recorded as intent, no evidence it landed) |
| **K20** | `DOSSIER_LOCATION_TRADE_AREA_23654_WORKLOG.md` | Prompt 16 item 3 — the **Census-radius demographics write** for dia 23654 — never completed |

The other four flagged files (`DOSSIER_RENT_FIX`, `PROMPT_33_MCP_OAUTH_ROOT_MOUNT`,
`PROMPT_04_LOAN_PROPAGATION`, `GOV_LEASE_TERMINATION_RATE`) matched on the words *follow-up* /
*next steps* / *remaining* but their items were **already closed in the same file** — read in full,
nothing carried.

## The lesson worth keeping

**A consolidation scoped to a directory will miss whatever sits outside it.** P141 was thorough
inside `docs/` and still left five measured, unfixed Capital-Markets chart defects invisible for
seventeen days. When consolidating, **enumerate by file type across the whole repo, not by folder**
— and grep the candidates for open-work markers *before* moving them, never after.

## Contents

| file | last dated entry | title |
|---|---|---|
| `CAPMARKETS_TAB_PACKET_WORKLOG.md` | 2026-08-11 | Capital Markets Tab Packet Worklog ⚠️ K13–K18 |
| `GOVERNMENT_SELLER_SENTIMENT_WORKLOG.md` | 2026-08-12 | Government Seller Sentiment Worklog ⚠️ K19 |
| `DOSSIER_LOCATION_TRADE_AREA_23654_WORKLOG.md` | 2026-08-03 | Dossier Location & Trade Area — property 23654 ⚠️ K20 |
| `PROMPT_39_WORKLOG.md` | 2026-08-11 | Government Case for Renewal Source Rebuild |
| `GOVERNMENT_MARKET_TURNOVER_WORKLOG.md` | 2026-08-11 | Government Market Turnover Worklog |
| `GOV_LEASE_TERMINATION_RATE_WORKLOG.md` | 2026-08-11 | Government Lease Termination Rate Worklog |
| `SALESFORCE_BUYER_PARENT_MAPPING_WORKLOG.md` | 2026-08-10 | Salesforce Buyer Parent Mapping Worklog |
| `PROMPT_35_WORKLOG.md` | 2026-08-04 | Deliverable Naming + Save Location Doctrine |
| `PROMPT_34_WORKLOG.md` | 2026-08-04 | Regenerate Blank BOV Master Templates |
| `PROMPT_31_WORKLOG.md` | 2026-08-04 | Property-record consolidation + sale reconciliation |
| `PROMPT_31_32_APPLY_WORKLOG.md` | 2026-08-04 | Prompt 31 + 32 live migration apply |
| `PROMPT_27_WORKLOG.md` | 2026-08-03 | Prompt 27 Worklog |
| `PROMPT_26_WORKLOG.md` | 2026-08-03 | Prompt 26 Worklog |
| `PROMPT_25_WORKLOG.md` | 2026-08-03 | Prompt 25 Worklog |
| `PROMPT_24_WORKLOG.md` | 2026-08-03 | Intent/Resolution Audit |
| `PROMPT_21_WORKLOG.md` | 2026-08-03 | Copilot Studio MCP Pivot |
| `PROMPT_05_RESOLVER_BY_PROPERTY_ID_WORKLOG.md` | 2026-08-01 | Resolver by Property ID |
| `DOSSIER_DOCUMENT_SOURCES_WORKLOG.md` | 2026-08-01 | Dossier Document Sources Worklog |
| `DOSSIER_RENT_FIX_WORKLOG.md` | — | Dossier Rent Fix Worklog |
| `DOSSIER_DEBT_GRAPH_FIX_WORKLOG.md` | — | Dossier Debt / Graph Fix Worklog |
| `PROMPT_38_MCP_OAUTH_WELLKNOWN_SUFFIX_WORKLOG.md` | — | LCC connector errors after MCP_BASE_URL is set |
| `PROMPT_33_MCP_OAUTH_ROOT_MOUNT_WORKLOG.md` | — | MCP OAuth Root Mount Worklog |
| `PROMPT_32_OLLAMA_CLEAN_ASSIST_WORKLOG.md` | — | Ollama Cleaning-Assist Worklog |
| `PROMPT31_DATA_INTEGRITY_P2_WORKLOG.md` | — | Data-Integrity P2 Worklog |
| `PROMPT_30_WORKLOG.md` | — | Data-integrity audit |
| `PROMPT_29_WORKLOG.md` | — | Comps Pull and Export Polish |
| `PROMPT_28_WORKLOG.md` | — | Comps Workbook Hotfix and Appraisal Quality |
| `PROMPT_23_WORKLOG.md` | — | Comps Engine Plain-Language Robustness |
| `PROMPT_22_MCP_UNIFICATION_WORKLOG.md` | — | MCP Unification Worklog |
| `PROMPT_04_LOAN_PROPAGATION_WORKLOG.md` | — | Loan Propagation Worklog |
| `PROMPT_03_BROKER_ROLE_ATTRIBUTION_WORKLOG.md` | — | Broker Role Attribution Worklog |

> Three of these are referenced from live docs (`CAPMARKETS_TAB_PACKET_WORKLOG.md`,
> `DOSSIER_DEBT_GRAPH_FIX_WORKLOG.md`, `PROMPT_34_WORKLOG.md`). Those references now need the
> `docs/history/worklogs/` prefix.

---

## `ownership_sales_remediation/` — archived 2026-08-28

**32 dated session statuses, 2026-05-23 → 2026-05-29**, from the Track A/B/C ownership & sales
remediation campaign (29 done / 2 partial / 1 handoff). Moved here from `docs/ownership_sales_remediation/`.

🚨 **Read `ownership_sales_remediation/README.md` FIRST.** Several files assert things that are now
false — most dangerously that the A9b contacts cutover was *"not executed"* (it shipped 2026-05-29)
and that `gov.unified_contacts` is the live store (LCC Opps is; gov is a frozen snapshot). Every
file predates the Vercel→Railway retirement, and the retired Vercel host **still answers**.

**Eleven open items were extracted to `docs/os/PLANNED-BACKLOG.md` §P14 (M1–M11) before the move.**
Nothing was lost; nothing here is a work queue.

## Root ownership/sales/provenance cluster — archived 2026-08-28

Twelve `.md` files moved from the **repo root** into `docs/history/` (the doc map's rule is that the
root is code and config). The six `2026-05-21` files are indexed as a set by
`../DATA_AUDIT_SESSION_INDEX_2026-05-21.md`, which the move makes correct rather than breaking.

⚠️ **`SPEC_research_task_generator_2026-05-21.md` carries a banner and you must read it** — its cron
snippets target the **retired-but-live Vercel host**, and its auto-close is the A5a truncation defect
that falsely closed 5,763 tasks.

**Fourteen further open items were extracted to `PLANNED-BACKLOG.md` §P14b (R1–R14)**, including an
entire **unexecuted Supabase 3→1 consolidation plan** that had no backlog row anywhere.
**Relocated rather than archived** (still-live reference): `docs/architecture/ownership-data-provenance.md`,
`docs/architecture/lease-data-provenance.md`, `docs/architecture/supabase-consolidation-plan.md`,
and the comps-definition audit + its three companions → `docs/audits/`.

## Infra / hosting / monitoring cluster — archived 2026-08-28 (cleanup pass 2)

Fifteen root `.md` files read in full, then dispositioned. **Root `.md` count 50 → 35.**
**23 open items were extracted to `docs/os/PLANNED-BACKLOG.md` §P14c (I1–I23) BEFORE any move.**

**RELOCATED (still-live reference, not history):** `docs/architecture/infrastructure-topology.md` ·
`docs/architecture/hosting-cost-strategy.md` · `docs/architecture/supabase-consolidation-phase0-inventory.md` ·
`docs/setup/RUNBOOK_lcc_deployment.md` · `docs/setup/DEPLOYMENT_SIGNOFF_TEMPLATE.md`.

**ARCHIVED with mandatory-read banners** — every one of these misleads within a paragraph:
`ROLLOUT_2026-03.md` (**AD6 locks in Vercel**; names 8 `api/*.js` files that no longer exist) ·
`ROLLOUT_STATUS_waves_2026-08.md` (**renamed to end a name collision** — the live one is
`docs/audits/ROLLOUT_STATUS.md`; this root copy had zero inbound references) ·
`RENDER_MIGRATION_PLAN.md` · `VERIFICATION-SUMMARY-v14.md` (**implies LCC can write to Salesforce; it
cannot**) · `GAPS_AND_FINDINGS_REGISTER_2026-05.md` · `worklogs/AUDIT_PROGRESS_2026-05.md` ·
`worklogs/HEALTH_ALERTS_TRIAGE_2026-06-01.md` (**reads as "alerting is healthy"; it was not**) ·
`worklogs/PIPELINE_CONTROL_ANALYSIS_2026-04-01.md` ·
`worklogs/GOOGLE_ALERT_LEAD_INGEST_INVESTIGATION_2026-08-10.md` ·
`worklogs/RAILWAY_HEALTHCHECK_INVESTIGATION_2026-08-10.md` (clean, no banner needed).

⚠️ **Two obsolete WORKFLOW workarounds are bannered off** — `AUDIT_PROGRESS` and
`GAPS_AND_FINDINGS_REGISTER` both prescribe writing files via `bash python open('w')` because
*"sandbox writes are invisible to Windows git"*. That was a 2026-05 mount artifact. **Adopting it
today would silently slow every session down.**

⚠️ **`I3` is the cautionary tale of this pass.** The Supavisor pooler move was filed **only as a
pointer from `PLANNED-BACKLOG.md` into `GAPS_AND_FINDINGS_REGISTER.md` P-1** — it had no row of its
own. **A pointer into a file you are about to archive is not a filing.** Repointed in the same change.
