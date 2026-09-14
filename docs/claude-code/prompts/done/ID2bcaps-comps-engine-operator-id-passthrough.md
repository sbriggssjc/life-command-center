# ID2b-caps — Carry `operator_id` through the comps engine's output so the cap-rate bands stop fragmenting (without touching comp selection)

**Repo: `life-command-center`** (owns Dialysis_DB). Small, surgical, and it closes the defect that started the whole
identity thread. **Add a field; do not change an existing one** — that is what keeps comp selection untouched.

**Read first:** `docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md` §11 (canonical names) · `docs/os/PLANNED-BACKLOG.md`
§P0d ID2a, ID2b, **ID2b-c / ID2b-cm / ID2b-remaining**, MB1e · `api/_handlers/market-brief-psql-tick.js` (the cap-band
section, ~L353–375) · `api/_shared/market-brief-facts.js` (`cap_rate_ttm_band` fact keys, ~L160–170) ·
`mcp/comps-tools.js` (`operatorTier()`, `compTenantText()`) · the dia `rpc_query_comps` definition and its
`comp_tenant(chain_canonical, operator, tenant)` expression · `CLAUDE.md` Core doctrines.

## Why this, why now (live dry run, Cowork 2026-09-12)

ID2b switched `v_market_brief_cms_operator_counts` to `operator_id` — real work, but that view feeds the **clinic
counts**, which are currently withheld anyway behind the CMS staleness gate (MB1d). **The defect Scott originally
flagged is unchanged.** Today's dry run against the deployed build still returns:

| fact | n |
|---|---|
| `cap_rate_ttm_band:fresenius` | 63 |
| `cap_rate_ttm_band:fresenius_medical_care` | 11 |
| `cap_rate_ttm_band:davita` | 67 |
| `cap_rate_ttm_band:davita_dialysis` | 9 |

Root cause: the bands group on the **text** the comps RPC returns (`comp_tenant`, i.e.
`coalesce(chain_canonical, operator, tenant)`), and the fact key is `normKey(operator_text)`. The canonical
`operator_id` exists on 9,449 properties and never reaches the engine's output, so every consumer of the engine —
the brief, BOV workbooks, comps exports — re-fragments the same way.

## 1. Add resolved operator fields to the engine's output (additive only)

Extend `rpc_query_comps` (and the views behind it) to return, per comp row, `operator_id` and `operator_canonical`
resolved through `dia.properties.operator_id` → the registry (survivor-aware, so a retired id resolves to its
canonical row). **Leave `comp_tenant`, `tenant` and every existing field byte-identical.** Rows with no
`operator_id` return NULL in the new fields and keep their text — they are not dropped and not guessed.

**Why additive matters:** `mcp/comps-tools.js` scores comps with `operatorTier()` over the existing text fields. If
the text changes, comp *selection* changes. Adding fields cannot change selection, and this prompt is done when that
is proven, not assumed: run a before/after comp set for 5 real subjects (a DaVita property, a Fresenius property,
one whose operator sits in the 71-row review queue, one non-dialysis-operator property, one with no `operator_id`)
and show the sets are identical. If any set differs, stop and report — ID2b-c is where selection changes get decided.

## 2. Group the bands on the id

In the tick: group per-operator cap-rate bands on `operator_id`, label from `operator_canonical`, and key the fact
`cap_rate_ttm_band:<operator_id>` (keep a stable alias so the superseding chain from today's text-keyed facts is
clean — supersede the old fragments rather than leaving them live alongside the merged band). Comps with no
`operator_id` aggregate into the whole-market band only, and the fact states how many comps that was — never a
silent drop.

**Expected result, and the gate:** `fresenius` 63 + `fresenius_medical_care` 11 → **one Fresenius Medical Care band,
n=74**; `davita` 67 + `davita_dialysis` 9 → **one DaVita band, n=76**. The whole-market band (n≈167) must not move.
Anything else means the resolution moved a comp it shouldn't have — report and stop.

## 3. Then the rest of the engine's consumers

With the fields available, say (don't necessarily switch here) what each remaining engine consumer would take to
move: the BOV/comps workbook generator, the CM `cm_dialysis_*` views (ID2b-cm), the dossier. Size each one. That
list is what makes ID2b-remaining finishable rather than a standing 85-view backlog row.

## 4. What NOT to do

Don't change `comp_tenant`/`tenant` text. Don't touch `operatorTier()` or any selection scoring. No registry,
alias, guard or backfill changes. No gov work. Don't flip `MARKET_BRIEF_PSQL` here — MB-b owns that.

## Guard + ship

Tests: the RPC returns the new fields with existing fields unchanged (byte-compare a fixture row), band grouping on
id with the expected merges, NULL-`operator_id` handling, supersede of the old text-keyed fact keys, and the
5-subject selection-identity check as a recorded fixture. Full suite green. Branch → PR → CI → merge → redeploy BOTH
Railway services.

## Ship + record

Re-run the tick's dry run against the deployed build and paste the band facts — that output is the proof. Update
`PLANNED-BACKLOG.md` §P0d (ID2b, ID2b-caps, MB1e, and the sized list for ID2b-remaining),
`docs/architecture/EXEC-BRIEFS-SPEC.md` §9, `STATUS.md`, `CURRENT-STATE.md`.
