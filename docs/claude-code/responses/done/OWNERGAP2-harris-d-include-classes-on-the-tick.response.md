# Response — OWNERGAP2-harris-d: expose `include_classes` on the resolve tick, exact-situs only

**Prompt:** `docs/claude-code/prompts/done/OWNERGAP2-harris-d-include-classes-on-the-tick.md`

## What shipped

1. **`include_classes` query param on the tick** (`GET/POST /api/ownergap2-owner-resolve-tick`).
   Comma-separated, upper-cased, validated against a closed allowlist
   (`HARRIS_PDATA_INCLUDABLE_CLASSES = {'C2'}` in `ownergap2-harris-pdata-match.js`) via the new
   `parseIncludeClasses()`. An unknown token 400s with `{error:'invalid_include_classes', invalid, allowed}`
   rather than being silently dropped or silently admitted. Default (param absent) is unchanged —
   F1/F2 only. The resolved classes are threaded to `fetchHarrisPdataForProperty` →
   `resolveHarrisFromPdata` → `buildHarrisPdataCandidates({includeClasses})` (already existed from
   harris-c; nothing there changed) and echoed back on the summary as `include_classes`.

2. **Exact-situs-only rule for admitted classes.** `buildHarrisPdataCandidates` now stamps each
   candidate with `admittedViaIncludeClass` (true only when the row's own `state_class` is NOT
   F1/F2 and was admitted purely because it's in `includeClasses`) and `stateClass`.
   `resolveHarrisPdataMatch` checks that flag per matched row: if it's true and the match arm is
   anything other than `'exact'` (range_start / range_contains / any `_via_alias` variant), the row
   is dropped into `nearMisses` with `reason: 'class_admitted_requires_exact_situs'` instead of
   being accepted. F1/F2 rows are untouched — every existing arm still applies to them, so this is
   scoped to widened classes only, never a global tightening.

3. **Citation carries `state_class`.** `buildPdataCitation` now includes
   `state_class: first?.stateClass ?? null`, so a ledger row resolved via a widened class is
   distinguishable from a default F1/F2 resolution without re-deriving it from `raw`. It rides
   through to `dia_ownergap2_resolution_log.citation` and the `recorded_owners.notes` JSON blob
   unchanged (`ownergap2-owner-writeback.js` stores the whole citation object as-is).

4. **Tests** (`test/ownergap2-harris-hcad-pdata.test.mjs`, +4): an includeClasses-admitted C2 row
   resolves on exact house-number match and its citation carries `state_class:'C2'`; the same row
   is **refused** (not resolved) when the staged location is a range that merely *contains* the
   queried house, with the near-miss reason `class_admitted_requires_exact_situs`; a default-class
   (F1) row with the identical range-shaped location still resolves normally (`matchArm !==
   'exact'`), proving the gate is C2-scoped, not a blanket tightening; `parseIncludeClasses`
   validates/upper-cases/rejects unknown tokens. Full suite: `node --test
   test/ownergap2-harris-hcad-pdata.test.mjs` → 45/45 pass (was 41; the 4 harris-c tests that
   already covered the default-includeClasses wiring were untouched and still pass).

## What was NOT done, on purpose

- **No change to `scripts/hcad-pdata-load.mjs`** (the loader). Prohibited by the prompt; untouched.
- **No live dry run against the two named targets** (`380 E Little York Rd` / acct
  `0222430000049`; `10311 S Post Oak Rd` / acct `0440360000028`) — this session has no egress to
  Dialysis_DB. That step (§4 of the prompt: run `GET
  /api/ownergap2-owner-resolve-tick?jurisdiction=harris&include_classes=C2`, expect 2 resolved of
  the 29 still open, Scott reads, Cowork applies) is Cowork's live step, unchanged from the
  prompt's sequencing.
- **Did not check whether `380 E Little York Rd` has a C2 sibling on the same street number** (the
  prompt's open question) — that's a live-data question this session cannot answer without DB
  access. If a sibling exists, the existing multi-owner ambiguity gate
  (`byOwner.size > 1 → needs_parcel_discriminator`) already refuses rather than guessing; no new
  code was needed for that case, since it was never scoped to the includeClasses widening
  specifically.
- **No redeploy** — Railway redeploy + `/version` confirmation is an operator step outside this
  session's reach, called out explicitly as prohibited-here in the prompt's own text ("Redeploy
  both Railway services and confirm `/version`" is listed under Cowork's follow-through, not this
  unit's deliverable).
