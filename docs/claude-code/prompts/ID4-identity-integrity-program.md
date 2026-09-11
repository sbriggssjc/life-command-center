# ID4 — Identity integrity program: standing detectors, one resolver framework, and a plan per defect class (dia + gov + LCC Opps)

**Repo: `life-command-center`** (and the Dialysis/government repos' ingesters, read-only). **Send after ID1's
response has been reconciled.** This prompt reuses ID1's registry/resolver design; it doesn't invent a second one.
**Builds detectors only.** No merges, backfills, or canonical rewrites; those are per-class follow-ups Scott approves.

**Read first:**
- `CLAUDE.md` → Core doctrines → "TRUTH IS FIXED AT ITS SOURCE OF RECORD"
- `docs/audits/ID0_IDENTITY_VALUE_DOMAIN_PROBE_2026-09-11.md` (the evidence and the probe SQL)
- `docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md` (ID1's output)
- `docs/architecture/data-coherence-invariants.md`: **I6, I11, and the new I13 / I14 / I15**
- `docs/os/PLANNED-BACKLOG.md` §P0d: ID2, ID3a–f, D1–D5
- `docs/architecture/ownership-truth-pipeline-state.md`
- the B6a/I11 alerting path (`lcc_check_feed_freshness`)

## Why this, why now

Scott: *"ensure there's protection and cleaning code in place to make sure we aren't operating a database with
divergent naming and connections and structures that prevent it from operating intelligently and as designed… one
intelligent and reconciled source of truth for all properties… free from oversights or other gaps in logic."*

The ID0 probe shows that the dialysis operator split is one instance of a class present in both domain DBs:

- gov agencies (SSA 4+ spellings, VA 5+)
- owner-entity duplicates (gov `true_owners` 1,278 collapsible names; 81 + 115 identical-canonical groups
  that nothing merges)
- county/city casing (gov: 832 split county/state pairs)
- guarantor legal entities (dia)
- broker duplicates (dia: 116 groups)
- a truncated import (CMS 2,450/2,450)

Two of the data-coherence contract's invariants had standing detectors before today, and the identity class had
none. **A one-time cleanup decays. Protection means detectors that run on their own and writers that cannot mint
a variant.**

## 1. Standing detectors (I13 / I14 / I15), on all three DBs

Build these as views/functions plus a scheduled check that opens a deduped alert through the existing I11 path
(the same pattern as `lcc_check_feed_freshness`):

- **I13 identity.**
  - For each registered identity column: the normalized-collapse count (the ID0 probe, with `\y` word
    boundaries), the identical-canonical groups, and the orphan rate (text present, FK null).
  - The list of identity columns is a **registry table** (table, column, entity kind, canonical FK column,
    expected state). It is not hard-coded, so a new database or column is onboarded by adding a row. This
    extends the contract's new-database onboarding checklist.
- **I14 vocabulary.** For each registered attribute domain: values outside the reference list, and case/format
  splits.
- **I15 import completeness.** For each registered bulk load: rows written vs the source count, and the
  truncation signature (a count equal to a page or limit size, or identical counts across partitions loaded
  within N seconds).
- **Alert on trend, not only thresholds.** A collapse count that rises week over week means a writer is
  minting variants. The detector must name the column; the writer inventory (§2) names the culprit.
- **Measure the baseline now,** and record it in the audit so every later fix shows the number moving
  (doctrine: a fix isn't fixed until the population moves).

## 2. Writer inventory, all identity columns

Extend ID1's writer inventory from operators to every column in the §1 registry, across dia, gov, and LCC Opps
(sidebar capture, SF sync, OM/email intake, CoStar, GSA/FRPP ingest, the CMS ingester, and manual SQL). Per
column, record which writers call a resolver and which write raw text. **This is the list the resolver framework
has to cover.**

## 3. One resolver framework (design, reusing ID1)

Generalize ID1's operator design into one pattern for every entity kind:

- canonical registry (per kind or a shared one; justify)
- alias table with provenance
- parent/child links for legal entities and brands (a subsidiary guarantor links, it doesn't merge)
- a JS resolver with a lock-step SQL mirror that fails closed to a review lane
- a DB-level guard on each identity column (FK plus trigger or constraint) so a raw write can't land

Specify:

- **how canonical ids cross databases,** e.g. an LCC Opps identity hub with domain references, or domain
  registries with an LCC crosswalk (choose, and justify against existing doctrine and `ownership-truth-pipeline-state`)
- **reference sources for each kind:** federal agency/bureau codes for gov agencies, CMS CCN/chain for clinics,
  parcel/APN for properties, SEC/legal names for guarantors
- **the review-lane design,** so ambiguity like `RICHMOND FIELD OFFICE (VA)` reaches a human once and the answer
  becomes an alias permanently

## 4. Per-class plans (ID3a–f), ranked

For each class:

- measured size, and which consumers or reports are wrong today (with an example chart or number)
- the reference source
- the merge/link rules and expected auto-vs-review split
- the consumer switch and the parity check

Rank by reporting blast radius. The draft order is ID3a agency → ID3b owners → ID3d guarantors → ID3e
vocabularies → ID3c brokers → ID3f property duplicates; re-rank on evidence. Each class becomes its own build
prompt after Scott approves its plan.

## 5. What NOT to do

- No merges, alias writes, backfills, or canonical renames in this prompt.
- No normalization in any consumer (renderer, view `CASE`, export map) except a labelled temporary bridge with a
  backlog row.
- Don't schedule a detector until it has run green once under real credentials (the D1h lesson).
- Don't fork ID1's resolver.

## Guard + ship

- Tests for the detectors (normalization with `\y`, identical-canonical grouping, truncation signature) and the
  registry-driven onboarding.
- Detector migrations applied, reading only.
- Full suite green. Branch → PR → CI → merge. `api/` touched → redeploy BOTH Railway services.

## Ship + record

- `docs/audits/ID4_IDENTITY_INTEGRITY_BASELINE_2026-09.md`: the baseline numbers per column per DB, the writer
  inventory, the framework design, and the ranked class plans.
- `data-coherence-invariants.md`: detector status for I13/I14/I15.
- `PLANNED-BACKLOG.md` §P0d: ID3a–f states and sizes, and one build row per class.
- `STATUS.md`.

Your reply should include the baseline table, the detector schedule and alert path, the framework decision (with
the cross-DB id choice), the ranked class plans, and the 👤 decisions for Scott.
