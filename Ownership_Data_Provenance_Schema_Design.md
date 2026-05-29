# Ownership Data Provenance & Responsibility Tracking — Schema Design

**Date:** May 29, 2026 | **Context:** dia + gov ownership data quality (closes audit gap **G15**) | **Companion to:** `Lease_Data_Provenance_Schema_Design.md`, `OWNERSHIP_AND_SALES_AUDIT_2026-05-23.md`

---

## Problem Statement

Ownership identity on a property (`recorded_owner`, `true_owner`, the
`ownership_history` chain) is written by **many sources of very different
trust**: county recorder deeds, Secretary-of-State filings, CoStar/CREXi
sidebar captures, OM extractions, and manual analyst edits. Before this work:

- No way to tell whether `recorded_owner_name` came from a county deed vs a
  CoStar scrape vs an OM flyer.
- No protection against a low-trust source (sidebar) overwriting a high-trust
  value (county deed) during ingestion.
- Owner rows fragmented (the same entity under name variants) — see G4/G13.
- No documented source-priority for ownership fields (this gap = **G14**).

This matters because the recorded/true owner drives BD targeting, ownership-
history continuity, and outreach — a wrong owner sends the wrong pitch to the
wrong party.

---

## Architecture Overview

Ownership provenance **reuses the existing cross-domain provenance fabric**
(built for leases/sales in Phase 1, 2026-04-25) rather than adding parallel
tables. The same three artifacts on **LCC Opps** govern ownership writes:

| Artifact | Role for ownership |
|---|---|
| `field_provenance` | Append-only log of every cross-table ownership-field write — `(target_database, target_table, record_pk_value, field_name)` → source, confidence, source_run_id, decision (`write\|skip\|conflict\|superseded`). |
| `field_source_priority` | Per-field source ranking (lower priority number = higher trust). Covers the ownership identity surface (see below). |
| `lcc_merge_field()` | Single guard function: records provenance + returns the write/skip/conflict decision. Writers consult it; in `record_only` mode the UPDATE still runs. |

Reconciliation views (shared): `v_field_provenance_current` (latest
authoritative per field), `v_field_provenance_conflicts` (open same-priority
disagreements), `v_field_provenance_actionable` (skip/conflict under
warn/strict), `v_field_provenance_unranked` (Phase-4 drift detector — written
triples with no priority rule; should trend to 0).

### Source Tier Hierarchy (ownership)

Mirrors the lease doc's tiering, specialized for ownership. **A lower-number
tier never gets overwritten by a higher-number tier.**

| Priority | Source | Trust rationale |
|---|---|---|
| 1 | `manual_edit` / `manual_resolution` | Analyst-verified; always wins. |
| 3 | `recorded_deed` | The legal instrument of transfer. |
| 5–10 | `county_records` | Assessor/recorder of record. |
| 15 | `opencorporates` / `mi_lara` (SOS) | Secretary-of-State filings (managers, agents, filing status, state of incorporation). |
| 20 | `shell_chain_research` | Verified shell→parent chain. |
| 30 | `cms_chain_org` | CMS operator-org linkage (dia). |
| 45 | `om_extraction` | Offering-memorandum stated owner. |
| 50 | `rca_sidebar` | RCA capture. |
| 55–60 | `costar_sidebar` | CoStar aggregator. |
| 65–70 | `crexi_sidebar` / `crexi_sidebar_description` | CREXi aggregator / free-text. |

This is the audit's **G14** ladder — `county > SOS > sidebar > OM` — made
concrete. (Manual + recorded_deed sit above county; SOS = opencorporates/
mi_lara.)

### Ownership fields under provenance

Ranked across `dia`/`gov` as applicable (81 rules + the G14 `ownership_source`
addition, 2026-05-29):

- **Identity:** `recorded_owner_name`, `recorded_owner_id`, `true_owner_id`,
  `property_ownership_type` (on `properties`); `recorded_owner_id`,
  `new_owner`, `prior_owner`, `ownership_start`, `ownership_end`,
  `ownership_source` (on `ownership_history`).
- **SOS / LLC enrichment** (on `recorded_owners`): `state_of_incorporation`
  (dia) / `filing_state` (gov), `manager_name`, `manager_role`,
  `registered_agent_name`, `registered_agent_address`, `filing_date`,
  `filing_status`.

`recorded_owner_mailing_address` (named in the audit) is not currently written
by any source, so it carries no rule — it will be added automatically the
moment a writer populates it (the `v_field_provenance_unranked` detector
surfaces unranked writers).

---

## How writes flow

1. A source (sidebar/OM/county/SOS/manual) attempts to write an ownership
   field.
2. The writer (or a backfill) calls `lcc_merge_field()` with the field, source,
   value, and confidence.
3. `lcc_merge_field` looks up `field_source_priority` for that
   `(target_table, field_name)`, compares the incoming source's priority to the
   current authoritative source recorded in `field_provenance`, and returns:
   - `write` — incoming source is ≥ trust of the current value → apply.
   - `skip` — incoming source is lower trust → keep existing (logged).
   - `conflict` — same priority, different value → surfaced for review.
4. Every decision is appended to `field_provenance` with `source_run_id` so any
   change is **traceable and reversible**.

Enforcement is staged per rule via `enforce_mode` (`record_only → warn →
strict`). Ownership rules are currently `record_only` (observe before
blocking), consistent with the lease/sales rollout.

---

## Integrity guarantees that complement provenance

Provenance decides *which source wins a field*. Separate structural guards
keep the ownership **graph** correct (built across the C5/A6/B4 tracks):

- `chk_oh_start_end_order` CHECK — ownership periods can't end before they start.
- `auto_close_prior_open_ownership` trigger (A6a) — a new open period closes the
  prior open one (forward-close).
- `excl_oh_no_overlap` EXCLUDE (C5) — no two active, non-grandfathered periods
  on a property may overlap in time.
- `v_sales_chain_breaks` + nightly ownership-chain-tick (B4/G13) — surfaces
  seller(N) ≠ buyer(N-1) discontinuities as research tasks.
- Write-time entity dedup (C4/G4) + owner-merge-tick (B2) — collapse owner-name
  variants so provenance arbitrates *one* canonical owner, not fragments.

---

## Relationship to the audit gaps

| Gap | This doc's relevance |
|---|---|
| **G14** | Ownership-field source-priority rules — documented + completed here. |
| G4 / G13 | Entity dedup feeds clean canonical owners into the provenance matrix. |
| G7 | `dia.properties.unified_id` links a property to its canonical owner entity (LCC `entities`). |
| G15 | **This document** — the ownership analogue of the lease provenance design. |

---

## Quick reference

```sql
-- Ownership source-priority ladder for a field
SELECT target_table, source, priority, enforce_mode
FROM field_source_priority
WHERE field_name = 'recorded_owner_name' ORDER BY target_table, priority;

-- Any unranked ownership writers (should be empty)
SELECT * FROM v_field_provenance_unranked
WHERE field_name ILIKE '%owner%' AND source NOT LIKE 'cleanup_run_%';

-- Open ownership-field conflicts pending review
SELECT * FROM v_field_provenance_conflicts WHERE field_name ILIKE '%owner%';
```
