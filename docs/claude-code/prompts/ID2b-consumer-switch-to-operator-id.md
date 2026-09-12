# ID2b — Move the consumers onto `operator_id`: measure every surface, switch it, prove the numbers

**Repo: `life-command-center`** (owner of Dialysis_DB per the 2026-09-12 ownership table). The identity substrate is
live; this is the step that makes the canonical truth reach the places people read. **Every switch is measured
before and after — a surface whose numbers move for any reason other than merging known variants is a defect, not
a win.**

**Read first:** `CLAUDE.md` → Core doctrines → "TRUTH IS FIXED AT ITS SOURCE OF RECORD" and "ONE REPO OWNS EACH
DATABASE'S OBJECTS" · `docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md` §5.5 and §11 (Scott's canonical-name
decisions) · `docs/os/PLANNED-BACKLOG.md` §P0d ID2a, ID2a-cleanup, ID2b, ID3i · `docs/architecture/EXEC-BRIEFS-SPEC.md`
§9 design rule 4 · the ID2a migrations · `api/_shared/operator-normalize.js` · `mcp/comps-tools.js`.

## Why this, why now (live, Cowork 2026-09-12)

`dia.properties.operator_id` is populated on **9,449 of 11,804** properties, guarded on write, with a 207-row alias
table and a 71-row review queue. The registry is clean: DaVita 4,435 · Fresenius Medical Care 3,769 · US Renal Care
465 · DCI 301 · ARA 244 · Satellite 92, with brands and subsidiaries parented rather than merged.

**But almost nothing reads it.** Measured live: **45 views in Dialysis_DB reference an operator text column and never
mention `operator_id`.** In the repo, at least 12 modules do the same, including `mcp/comps-tools.js`,
`api/_shared/dossier-generator.js`, `api/_shared/market-brief-facts.js`, `api/_shared/rent-projection.js`,
`api/_shared/team-context.js` and `api/_handlers/sidebar-pipeline.js`. So the operator split Scott flagged is still
live in every report; only the storage layer is fixed.

## 1. Inventory first (report before changing anything)

List every consumer of an operator text column — the 45 views, the repo modules, the CM chart catalog/exports, the
MCP tools, the dossier, the market-brief producers. For each: what it does with the value (group, filter, join,
display, fuzzy-match), and the numbers it produces today for the top 6 operators. **That table is the parity
baseline.** Anything you cannot measure, say so rather than switching it blind.

## 2. Switch by category, not by file

- **Grouping and aggregation** (the CM `cm_dialysis_*` views, cap-rate bands, counts): group on `operator_id`,
  display via the registry's canonical name. This is where the fragmentation disappears — expect exactly the merges
  ID2a's parity table predicts (`Fresenius` 3,733 + `Fresenius Medical Care` 36 → one bucket of 3,769) and nothing
  else.
- **Display** (dossier, exports, emails): canonical name from the registry, with the CM export layer's
  `display: 'short_operator'` map seeded so chart labels keep reading `Fresenius` (Scott's decision, ID1 §11).
- **Filtering** (`query_comps` by operator/tenant): accept the canonical id *and* any alias, so an old saved query
  or a broker typing "Fresenius" still works.
- **⚠️ Fuzzy comp matching is different — do not quietly change it.** `mcp/comps-tools.js` scores comps with
  `operatorTier()` over joined tenant/operator/agency text. Switching that to an id changes **which comps are
  selected**, not just how they are labelled. Measure a before/after comp set for at least 5 real subjects
  (including a DaVita and a Fresenius property, and one whose operator is in the 71-row review queue) and report the
  differences per subject. If the id-based selection differs, say so and stop there for that surface — Scott decides
  whether comp selection should change.
- **The 2,355 properties with no `operator_id`** (blank or unresolved): every switched surface states how it treats
  them — they must not silently vanish from a count that used to include them. Report the row-count delta per surface.

## 3. Unblock the market brief

With grouping switched, `api/_shared/market-brief-facts.js` keys per-operator facts on `operator_id` and drops the
`operator_identity_pending:ID2` gap MB-b was told to render. Re-run the P-SQL tick's dry run and report the new
per-operator bands — the fragments (`Fresenius` n=63 vs `Fresenius Medical Care` n=12, `DaVita` vs `DaVita Dialysis`)
must collapse into one band each.

## 4. What NOT to do

No changes to the registry, aliases, guard or backfill (ID2a is done). No gov work (ID3a-e, ID3e). No multi-tenant
restructuring (ID3i). No new normalizer, and no display-layer name map beyond the existing `short_operator` token.

## Guard + ship

Tests: grouping parity fixtures, alias-accepting filters, the no-`operator_id` bucket, and a guard that fails if a
new view or module groups on an operator text column. Full suite green. Branch → PR → CI → merge → redeploy BOTH
Railway services.

## Ship + record

Report: the inventory table with before/after per surface, the comp-selection comparison for the 5 subjects, the
market-brief bands after the switch, and any surface you deliberately left alone with the reason. Update
`PLANNED-BACKLOG.md` §P0d (ID2b, MB1e), `docs/architecture/EXEC-BRIEFS-SPEC.md` §9, `STATUS.md`, `CURRENT-STATE.md`.
