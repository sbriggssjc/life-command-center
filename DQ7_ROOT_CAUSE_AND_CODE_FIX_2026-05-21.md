# DQ-7 Root Cause + Recommended Code Fix (handoff)

**Date:** 2026-05-21
**Companion to:** `DATA_INTEGRITY_AUDIT_2026-05-20.md`, `DATA_INTEGRITY_REMEDIATION_LOG_2026-05-20.md`
**Status:** Diagnosis complete + DB-side remediation done & verified. The code change below is **recommended, NOT applied** — it touches the live OM-intake path and must be implemented on a feature branch and pass `pytest` before merge (per repo CLAUDE.md).

---

## Root cause (confirmed)

The duplicate placeholder `properties` rows in both the dia and gov databases were created by the **CoStar sidebar pipeline**, not the Python ingestion repos:

- **File:** `api/_handlers/sidebar-pipeline.js`
- **Function:** `upsertDomainProperty(domain, entity, metadata)` (def line ~2884)
- **Writer signature:** `data_source='costar_sidebar'`, writes to BOTH dia + gov `properties` (explains both DBs hit a day apart: gov 2026-05-17 12:27–12:30 UTC; dia 2026-05-18 01:35 UTC).

**Mechanism:** the "does this property already exist?" check (lines ~2950–3010) is a chain of best-effort `address=ilike.<…>&limit=1` lookups (normalized address → raw address → drop-city → suffix-stripped). When the captured address/city/state string drifts even slightly from what's stored, **every lookup misses and the function falls through to `POST /properties` (line ~3306), inserting a new row.** A batch/replay that re-captured ~49 addresses many times with drifting strings produced ~136 clones per address. The clones land with `status='active'`, so `investment_scorer.py` and `link_and_extract/backfill_propagation.py` then populated `investment_score` + `agency` — matching the audit signature.

The existing **race-recovery block** (lines ~3316–3357) re-looks-up and converts to UPDATE *only when the POST fails* — it was written to lean on a DB unique constraint that does not exist, so duplicate POSTs simply succeed.

---

## Why the "obvious" fixes are wrong here

- **A `UNIQUE(normalized_address, state)` index is NOT viable.** In the gov model one building address legitimately carries multiple per-lease `properties` rows (different agencies/suites). Audit confirmed **217 gov + 87 dia same-address groups that each have ≥2 substantive rows** — legitimate or needing human review, not duplicates. A hard unique index would reject these.
- **Adding `costar_sidebar` to `property_consolidation.BACKFILL_PROPERTY_SOURCES` is NOT advised.** That consolidation merges by `(address, city, state)`, which would wrongly fuse the same legitimate multi-lease buildings.

These were in the first-pass recommendation and are **retracted** after seeing the data shape.

---

## What was already done on the DB (verified, reversible)

- Quarantined the placeholder batches: dia 2,381 rows (`domain_classification_flag='duplicate_placeholder'`), gov 6,638 rows (`intel_status='junk_no_data'`), one survivor kept per address.
- Merged the genuine sparse duplicates: gov 4 + dia 19 (logged in `dq7_property_merge_map` / `dq7_property_merge_log`; gov repointed 3 child rows to survivors).
- **Backstop shipped instead of a unique index:** view `public.v_property_address_collisions` on BOTH DBs. It lists live (non-quarantined) properties sharing a normalized address+state, with `substantive_rows` so the consolidation UI can tell a sparse duplicate (`substantive_rows<=1`, auto-mergeable) from a legitimate multi-record building (`substantive_rows>=2`, human review). Currently surfaces 217 gov / 87 dia review groups.

---

## Recommended code fix (apply on a branch, test, then merge)

**Goal:** stop `upsertDomainProperty` from falling through to INSERT when a matching property already exists, without breaking legitimate multi-lease rows.

**Change 1 — make the existence check deterministic and key-aware** (replace the `&limit=1` fuzzy chain's *final decision*, ~lines 2950–3010 and the pre-INSERT point ~3305):

1. Compute `normAddr = normalizeAddress(address)` (already done, line 2950).
2. Query **all** candidates by `state=eq` + normalized address (not `limit=1`):
   - dia: match key = `(normAddr, state)`.
   - gov: match key = `(normAddr, state, lease_number)` **when `metadata.lease_number` is present** (so each per-lease row updates the right record); fall back to `(normAddr, state)` only when there is exactly **one** existing row for the address (avoid linking to the wrong lease).
3. If exactly one candidate matches the key → take the UPDATE path (reuse the existing `filterByFieldPriority` + `domainPatch` block).
4. If multiple candidates match and no `lease_number` disambiguates → **do not INSERT a new row**; log a warning and route to manual review (set `_lastDomainPropertyError='ambiguous_address_match'`). This converts a silent clone into a visible, reviewable event.

**Change 2 — store and compare a stable normalized key.** gov `properties` has a `normalized_address` column; dia does not. Recommend:
   - gov: populate `normalized_address` on write and query against it (`normalized_address=eq.<normAddr>`), not `address=ilike`.
   - dia: add a `normalized_address` column (migration) or query via the existing `dia_normalize_address()` SQL function through an RPC, so the lookup is exact rather than `ilike`-exact-by-accident.

**Change 3 — operational backstop (no schema risk).** Wire `v_property_address_collisions` into the existing consolidation UI as a "property address collisions" panel so new sparse duplicates (`substantive_rows<=1`) are caught and merged promptly instead of accumulating.

### Test plan before merge
- Unit: `upsertDomainProperty` with (a) exact re-capture → UPDATEs, no new row; (b) drifted address spelling, same lease → UPDATEs; (c) gov same address, different `lease_number` → INSERTs a distinct row (legit); (d) gov same address, no lease, one existing row → UPDATEs; (e) gov same address, multiple existing rows, no lease → no INSERT, flagged ambiguous.
- Regression: run the OM-intake integration tests; confirm no drop in successful property promotes.
- Post-deploy watch: `SELECT count(*) FROM v_property_address_collisions WHERE substantive_rows<=1;` should trend toward 0 and not grow after new sidebar captures.

---

*DB remediation is live and reversible. This code change is the durable recurrence fix and is intentionally left for engineer implementation + testing rather than applied blind from the audit session.*
