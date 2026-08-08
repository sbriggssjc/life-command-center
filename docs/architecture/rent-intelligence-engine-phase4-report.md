# Rent Intelligence Engine — Phase 4 Report (Serving) + Build Close-Out

**DB:** dia `zqzrriwuavgrquhisnoa` · **Repo:** life-command-center ·
**Branch:** `claude/rent-intelligence-discovery-t7t0ey` · **Date:** 2026-08-08

> Final phase. Serving layer shipped; the engine build is complete. Remaining work is external
> dependencies (flagged) + the deferred consumer call-site migration.

## 4a. Basis-aware CM variants

Published defaults (`cm_dialysis_rent_box_q`, `_rent_price_psf_q`, `_rent_price_per_chair_q`) are
**untouched — byte-identical** (the CM export reads specific named views; no wildcard, so new views
don't alter it). Added three `_with_modeled` variants, each gated **conf≥0.7 AND basis IN
(contract,stated,projected)** — convention basis structurally excluded — and each carrying a
`basis_scope` label column so no series is ever unlabeled:

- `cm_dialysis_rent_box_q_with_modeled` — quarterly rent-PSF box drawn from timeline rent at dated
  market events (lease signings + sales).
- `cm_dialysis_rent_price_psf_q_with_modeled` / `_per_chair_q_with_modeled` — rent component sourced
  from the timeline at the sale year instead of only an in-place documented lease.

**Acceptance (2023+ revival):**

| view | metric | default | with_modeled |
|---|---|---|---|
| rent_box_q | populated quarters (2023+) | **4** | **14** (all) |
| rent_price_psf_q | rent_n (2023+) | 1,400 | 1,474 |

Full CM + comps + MCP suites green (412/412); published views verified byte-identical.

## 4b. MCP tool `get_property_rent_timeline`

Registered in `mcp/server.js` (`TOOL_DEFINITIONS` + handler) and documented in `mcp/README.md`.
Same auth/resolution pattern as `query_comps`/`get_property_context` (`resolveSubject`, `diaQuery`).

- Args: `{ property_id | address | query, year_range: "YYYY-YYYY", include_superseded }`.
- Returns per-year `rent_annual`, `rent_psf`, `lease_phase`, `basis`, `confidence`, and a compact
  `provenance` summary (`summarizeRentProvenance`), plus a `basis_mix` roll-up, `current_version`,
  `year_span`, `rba_sf`.
- Default = current version only; `include_superseded` returns the full forked history for audit.

**Acceptance — #22023 round-trips:** it carries **v1 (superseded, 31 rows) + v2 (current, 31 rows)**
from two legitimate Phase-2 rebuilds. Default query returns v2 with correct per-year basis/confidence
(2011 contract 1.00, 2016 projected 0.70, 2021 contract 1.00 evidence-override, 2026 option_1
projected 0.65); `include_superseded` returns both versions.

**Consumer migration DEFERRED (as scoped):** BOV / cap-rate anchoring reading the timeline instead of
ad-hoc `rent_at_sale` is a separately-reviewed change sequenced after the post-#1638 workbook
regeneration. The tool ships now; the README flags this. comps-engine + bov/bov-government skills
reference the tool as the rent-anchoring source of record.

## 4c. Coverage stats (packet layer) — reconciles to 12,371

- `cm_dia_rent_coverage_summary` — portfolio partition, **sums exactly to the 12,371 universe**:

  | class | properties |
  |---|---|
  | evidence_timeline | 4,316 |
  | convention_shell | 424 |
  | research_backlog_no_intercept | 6,098 |
  | no_tenant_no_evidence | 1,533 |
  | **TOTAL** | **12,371** ✓ |

- `cm_dia_rent_coverage_by_year` — per-year basis mix (contract/stated/projected/convention).
- `cm_dia_rent_research_backlog` — the **6,098 no-intercept shells by tenant × state** (1,337 cells,
  ranked) so the backlog is actionable, not just counted. Backlog total reconciles to 6,098.

## Engine build — close-out

| Phase | Delivered |
|---|---|
| 1 Discovery | evidence inventory, structure census, conflict scan, reuse assessment |
| 2 Spine | `property_rent_timeline` + conventions + confidence ladder + builder; 4,316 evidence + 424 shell properties; value-prop canonicalized + gated; NM audit CIS-ready |
| 3 Reconciliation | `dia_reconcile_rent_evidence` (corroborate/classify/fork) + non-blocking intake hooks + Teams surfacing; acceptance clean |
| 4 Serving | basis-aware CM variants, `get_property_rent_timeline` MCP tool, coverage stats |

**Verified end-to-end:** DaVita curve round-trips (correct 10% steps, evidence override, option decay);
reconciliation classifies + forks (v1 preserved) or queues; rent-box 2023+ revived 4→14; coverage
reconciles to 12,371; full suite green; published charts byte-identical.

## Remaining external dependencies (flagged, not blockers)

1. **CIS national export** — required to certify `is_northmarq` (local SF certifies only 3/53) and to
   flip `cm_dialysis_value_prop_24m` to `published=true`. Drops into `dia_nm_cis_closings` with zero
   rework; `attribution_certified` auto-computes.
2. **Ongoing rent-evidence ingestion cadence** — the timeline improves as OM/sale/lease evidence
   flows through the Phase-3 hooks (which corroborate/fork automatically). The 6,098-shell backlog
   shrinks only as new evidence or per-cohort rent lands.
3. **Deferred consumer call-site migration** — BOV/cap-rate anchoring → `get_property_rent_timeline`,
   sequenced after post-#1638 regeneration.
4. **Optional:** if a published CM chart ever surfaces a `_with_modeled` variant via a client tile,
   add it to the `data-query` edge allowlist + redeploy (not needed today — MCP/packet read via
   service key).

*Rent Intelligence Engine build complete.*
