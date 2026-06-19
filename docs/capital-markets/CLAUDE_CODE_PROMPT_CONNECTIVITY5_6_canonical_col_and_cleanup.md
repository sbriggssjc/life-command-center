# Claude Code prompt — CONNECTIVITY #5 + #6: retire the dormant back-ref column + clean the residue

> The final cleanup pass closing the connectivity arc (`CONNECTIVITY_GAP_AUDIT_2026-06-17.md`),
> after #1 (bridge), #2 (dia owners), #4 (gov owners), #3 (SF reconcile). Both are small,
> reversible, no-hard-delete. The gate has GROUNDED both live — read the grounding. Receipts-
> first; gated; reversible; surface-don't-delete.

## #5 — `lcc_canonical_entity_id`: RETIRE (document; do NOT populate)
GROUNDING: the column is **0% populated** (0/6,821 dia, 0 gov), and the back-reference it was
designed to hold (true_owner → its LCC canonical entity) now lives AUTHORITATIVELY in
`external_identities(<dia|gov>, true_owner)` (the bridge from #1, `entity_id ↔
external_id=true_owner_id`, verified complete). Only one passthrough view references the column
(dia `v_true_owners_effective_role` — a `SELECT` passthrough, no logic).
- **Decision: retire, do not populate.** Populating a denormalized domain-side copy would
  require a cross-DB LCC→domain write and would DRIFT as entities merge (the exact failure mode
  flagged for `current_property_count`) — for a value that's already derivable by joining
  `external_identities`. There is no consumer that can't reach LCC.
- **Action (conservative):** mark the column **deprecated** in a migration comment +
  `CLAUDE.md` — "intentionally unpopulated; canonical back-ref = `external_identities(domain,
  true_owner)`." DROP only if you first confirm no application code SELECTs it (grep the repo)
  AND repoint/recreate `v_true_owners_effective_role` to not reference it. If any doubt on the
  grep, leave the column + the deprecation note (a documented decision satisfies "don't leave a
  designed connection undecided"). Do the same check on gov.
- **Gate:** the decision is documented; if dropped, the one view is repointed and nothing app-
  side referenced it; if kept, it's clearly marked deprecated. No data written.

## #6 — clean the residue (all reversible, NO hard-delete)
GROUNDING (dia, live; **ground gov symmetrically before acting**):
- **196 dia orphan true_owners** (referenced by no recorded_owner / property / ownership_history)
  — but **19 carry a `salesforce_id`** (CRM-tracked real owners → KEEP, never delete). The
  other **177** are unused.
- **105 dia artifact-named active owners** (artifact-shaped names — the pre-guard residue + #2
  leftovers; the bridge view already excludes them, so they're unbridged noise in the table).
- **cms artifact:** 345 valid `external_identities(cms, medicare_ccn)` ids parked on **3 junk
  placeholder entities** ("Property link approved" / "Clinic lead outcome recorded" / "Research
  outcome saved") — R35 retyped the identities correctly but left the junk entities holding
  them.
- **#2/#4 stragglers:** the 2 dia + 24 gov artifact-named + 5 gov merged-recorded-owner rows.

Cleanup actions (reuse the existing junk/review + merge machinery — do NOT fork):
1. **Artifact-named active owners (dia 105 + gov equivalent + the #2/#4 stragglers):** soft-flag
   to the junk/review lane (`metadata.junk_name_flagged` / a terminal `junk_confirmed`,
   reversible) so they leave the active universe but stay recoverable. They're already
   bridge-excluded; this just quarantines the table noise. NEVER hard-delete (names may be
   recoverable real owners on review).
2. **Orphan true_owners (177 dia no-SF + gov equivalent):** these are unused but may be merge
   duplicates of active owners. Surface same-canonical orphans to the existing merge lane
   (`v_lcc_canonical_twin_candidates` / `v_lcc_merge_candidates`); soft-flag the genuinely-
   abandoned remainder (`metadata.orphan_reviewed`) — do NOT delete. **KEEP all 19 (+ gov) that
   carry a `salesforce_id`** untouched (CRM-linked).
3. **cms junk entities (3):** soft-flag the 3 placeholder entities (`junk_name_reviewed` /
   `junk_confirmed`, reversible) so they leave any active lane. The 345 `cms, medicare_ccn`
   identities are VALID clinic ids — leave them parked (do NOT delete) and **document a separate
   re-homing follow-up** (attach each CCN to its real clinic/property entity — a distinct job,
   not this pass). The R35 forward guard already stops new ones.
4. **gov stragglers:** the 24 artifact names → junk/review; the 5 merged-recorded-owner rows →
   confirm they point at a valid survivor (the resolver already canonicalizes), soft-flag if
   genuinely stranded.

## My gate (read-only)
- #5: decision documented (deprecated-or-dropped); if dropped, view repointed + no app
  reference; no data written.
- #6: artifact-named owners + cms junk entities soft-flagged (reversible, recoverable), counts
  reconcile to the grounding; orphans surfaced to merge / soft-flagged with the **SF-linked
  ones untouched**; the 345 cms CCN ids preserved (not deleted) with the re-homing follow-up
  documented; ZERO hard-deletes anywhere; everything reversible by tag.

## Guardrails
- Receipts-first; reversible (metadata flags / ledger); **no hard-delete** (every value here is
  potentially recoverable — artifact names on review, CCN ids are valid, orphans may be merge
  dups). Reuse the junk_entity_name / merge-candidate / decision lanes; don't fork. Ground gov
  symmetrically before acting on it. ≤12 api/*.js. Bump `?v=` if any lane render changes.
- Net: the connectivity arc closes — the dormant column is decided, and the table residue is
  quarantined (reversibly) so the owner universe the bridge exposes is clean, with the one
  genuinely-separate job (cms CCN re-homing) documented rather than rushed.
