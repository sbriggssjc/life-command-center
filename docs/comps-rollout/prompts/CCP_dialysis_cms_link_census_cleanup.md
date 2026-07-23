# Claude Code Prompt — Dialysis CMS-Link Conflict + Census Plausibility Cleanup (Dialysis_DB)

## Context
Two source-data problems surfaced during the comps build. Both have existing review machinery on the DB
(`v_cms_property_link_conflict`, `v_cms_property_link_conflict_review`, `v_property_cms_link_suspect`,
`property_cms_link`). Fix the concrete cases, then generalize with a plausibility check — **verify before
mutating; route genuinely-ambiguous ones to review; never fabricate.**

## Part 1 — Medicare CCN 152689 on the wrong property
Measured live:
- `properties.medicare_id = '152689'` is held by **property 25766** (`1705 E Industrial Dr`).
- **Property 23423** (`504 6th Ave`, Terre Haute — the address that matches CMS clinic 152689) has
  `medicare_id = NULL`, so its CMS census/quality never propagate (this is what left 23423's chairs/patients
  blank in the comp export until a manual backfill).
- `property_cms_link` has **no row** for 152689.

Do:
1. Verify 152689's official CMS facility address (via `medicare_clinics` / CMS source) — confirm it is
   `504 6th Ave` (23423), not `1705 E Industrial Dr` (25766).
2. If confirmed, move the link: clear `properties.medicare_id` on 25766, set it on 23423, and write the
   authoritative row in `property_cms_link` (with provenance + a `property_cms_link_history` entry). Then
   re-derive 23423's `total_chairs`/`latest_patient_count`/`ttm_total_treatments` from the CCN so the comp
   pulls it natively (superseding the manual backfill).
3. Find 25766's correct CCN (it's a real clinic at 1705 E Industrial Dr) — if determinable, link it; else
   enqueue it to the existing CMS link-review queue rather than leaving a known-wrong link.
4. Check `v_cms_property_link_conflict` for **other** CCN-on-wrong-property cases and report the count; apply
   the same verify-then-move only where the CMS address unambiguously matches, else enqueue for review.

## Part 2 — Census plausibility (treatments vs chairs) reconciliation
Measured live (derived census = `ttm_total_treatments / 156`, i.e. 3×/wk × 52):
- `1935 Thompson Rd` (12 chairs): TTM 31,356 → census 201 (≈2,613 treatments/chair/yr vs a ~936 physical max).
- `209 Highland Ave` (60 chairs): TTM 124,800 → census 800, **but** `latest_patient_count` = 710 (disagree).
- `1809 Avenue H` (20 chairs): TTM 39,624 → census 254.
All exceed the `census_suppressed` 10×-chairs cap, so the comp correctly hides them — but the root cause is
either **multi-CCN treatment aggregation onto one property** or a **chairs undercount**, not a display bug.

Do:
1. For each property whose derived census exceeds the plausibility cap (build the full list, not just these 3),
   determine whether `ttm_total_treatments` aggregates **multiple CCNs** mapped to the property (sum across
   `facility_patient_counts` / `medicare_clinics` for that property) — if so, that's expected for a true
   multi-CCN campus and the chairs should reflect all CCNs; reconcile chairs to the CCN set.
2. Where `latest_patient_count` and the TTM-implied census disagree beyond a tolerance (e.g. 209 Highland:
   710 vs 800), record which source is authoritative and why.
3. Do **not** overwrite chairs/treatments with a guess. Where the data can be reconciled from CCN sources,
   fix it (fill-NULL / correct with provenance). Where it can't, write the case to a **census plausibility
   review queue** (reuse an existing clinic review-queue table or add `dia_census_review_queue`) with the
   numbers, so the dialysis workflow resolves it. Report how many reconciled vs enqueued.

## Verify / report
- Re-pull the DaVita/dialysis sold comps: 23423 (Terre Haute) now sources chairs/patients natively; the
  Coos Bay/Waterbury/Birmingham census either shows a reconciled plausible value or is transparently
  suppressed-and-queued (not silently blank).
- Report: 152689 move + any other CCN-conflict count; census cases reconciled vs enqueued; residual review-queue size.

## Guardrails
- Verify against CMS source before moving any CCN; enqueue when ambiguous. Never fabricate chairs/treatments.
- Fill-NULL / correct-with-provenance / supersede — never hard-delete; snapshot every mutated row to a backup
  table (as in the prior dialysis cleanup). Idempotent, reversible, dry-run first.
