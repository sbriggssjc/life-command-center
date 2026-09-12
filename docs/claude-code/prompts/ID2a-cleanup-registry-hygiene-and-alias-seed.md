# ID2a-cleanup — Finish the operator registry: merge the duplicates, parent the subsidiaries, seed aliases from the registry, and empty the fake review queue

**Repo: `life-command-center`.** Small, surgical follow-on to ID2a (merged). Dialysis_DB only. Writes are
reviewed and reversible; the parity gate from ID2a still applies.

**Read first:** `docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md` §5 and §11 (Scott's settled decisions) ·
`docs/audits/ID4_IDENTITY_INTEGRITY_BASELINE_2026-09.md` · `docs/os/PLANNED-BACKLOG.md` §P0d rows **ID2a**,
**ID2a-cleanup**, ID2b, ID3i · the ID2a migrations (`20260911200000`, `…200100`, `…200200`) ·
`api/_shared/operator-normalize.js` and its SQL mirror · `CLAUDE.md` Core doctrines.

## Why this, why now

ID2a shipped the substrate and the backfill (9,307 of 11,804 properties carry `operator_id`; guards live). Cowork's
live check on 2026-09-12 found its registry-hygiene half unfinished, and the review lane mostly fake:

1. **Duplicates and junk survive inside `kind='company'` (59 rows).** `Us Renal Care Inc` ×2 (ids 2, 57) alongside
   canonical `US Renal Care` (73); `Dialysis Clinic Inc` (3) alongside `Dialysis Clinic, Inc.` (79); `DaVita
   Dialysis` (28); `Satellite Dialysis` (58). Clinic-level rows sit as companies: `BMA Quincy`, `BMA OF NORTH
   CHARLOTTE INC`, `DCI East Gainesville`, `KNICKERBOCKER DIALYSIS, INC` — **BMA and Knickerbocker are Fresenius
   subsidiaries: parent them, don't merge them** (the guarantor lesson — legal identity is a credit fact). Person
   and junk rows too: `Family Video`, `Robert Video`-class noise (`Robert Young`, `Cheryl Ann Cunnings`,
   `FERNANDO RAUDALES`), `C/O ST. FRANCIS HOSPITAL`, `D/B/A PERRY DIALYSIS CENTER`. Only **1** row has a parent.
   Every one of these carries **0 properties**, so nothing reported today is wrong — but they are selectable in any
   UI and re-mintable.
2. **The review queue is 75% not review work.** Of 1,020 open rows, **683 are `Independent` and 84 are `Other`** —
   classifications, not operators.
3. **The remaining ~253 are known operators the resolver can't see.** `Northwest Kidney Centers` 25,
   `Kaiser Permanente` 20, `Wake Forest University` 20, `Atlantis Healthcare Group` 18 — all present in `operators`,
   none in the 42-row alias table, because the resolver still only knows the six hard-coded families.

## 1. Seed aliases from the registry itself (do this first — it shrinks everything else)

Every canonical registry row's own name, plus its `dba_names`, becomes an alias (exact and normalized), with
`source='registry_seed'`. Then re-run the resolver over the review queue in report mode: report how many of the
253 non-category rows resolve. Apply, and record the before/after queue depth.

## 2. Categories out of the queue and out of `company`

`Independent`, `Other`, `None`, `State Owned` resolve to the **classification** path (an `operator_class` column on
`properties`, or the existing `kind='category'` rows referenced by a separate column — pick one, justify it, and say
what consumers read). They must never again land in a human queue. `Kaiser Permanente` and `UnitedHealthcare`
(`kind='payer'`) are payers, not operators: decide whether a property's payer belongs in its own column, and if so
file it rather than building it here.

## 3. Merge duplicates, parent subsidiaries and brands

- Merge exact duplicates into the canonical row via `merged_into_operator_id` (retire, never delete), adding each
  retired name as an alias so old text still resolves.
- Parent, don't merge: `BMA *` and `KNICKERBOCKER DIALYSIS` → Fresenius Medical Care; `DCI East Gainesville` → DCI;
  `DaVita at Home` stays a DaVita child (already correct); `DaVita Dialysis` is a spelling variant → alias of DaVita.
- Person, junk and clinic-name rows with 0 properties: reclassify (`kind='junk'` or equivalent) with a note. Don't
  delete — something minted them, and the record is the evidence.
- **Leave the two `non_operator` piped rows alone** — they are ID3i's multi-tenant artifacts.

## 4. Guard the gap that let this happen

The registry can still be extended by hand with anything. Add a check that fails when a `kind='company'` row has no
alias, no properties, and no parent — the shape every junk row here has — and surface it in the ID3a-class detector
(ID4 decision: prove detectors on one class first, then generalize).

## 5. Parity and what NOT to do

Parity gate: property counts per canonical operator must not move except by the merges above; report before/after per
operator and stop if anything else shifts. No consumer switch (ID2b). No gov work (ID3a). No new normalizer.

## Guard + ship

Tests: registry-seeded aliases, category routing, retired-id resolution, parent-not-merge for subsidiaries, and the
orphan-company check. Full suite green. Branch → PR → CI → merge → redeploy BOTH Railway services.

## Ship + record

Report: alias count before/after, review queue before/after (with the category split called out), merges and parents
applied, the parity table, and any row you could not classify. Update `PLANNED-BACKLOG.md` §P0d (ID2a-cleanup, ID2b
readiness), `STATUS.md`, `CURRENT-STATE.md`.
