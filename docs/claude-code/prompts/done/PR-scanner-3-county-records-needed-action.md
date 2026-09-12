# PR-scanner-3 — `county_records_needed`, the sixth action on the ownership-history lane

**Repo: `life-command-center`.** gov domain (`v_lcc_ownership_history_lane_split` lives on LCC Opps;
the properties themselves are gov). **Read first:** `docs/architecture/ownership-history-lane.md`
(the canonical page for this lane — sections 2–4 especially), `docs/architecture/research-workbench.md`
§7b/§7c (the sizing this prompt is built from), `docs/architecture/public-records-source-lane.md` §7/§7a
(what PR-scanner-1/2 already shipped and why it matters here), `docs/os/PLANNED-BACKLOG.md` rows
`PR-scanner-3`, `PR-scanner-1`, `PR-scanner-2`, `PR-scanner-5`.

## Why this, why now

Scott's own manual research workflow (netronline → assessor → recorder → SOS → cross-reference) was
wired end to end 2026-09-10 (`PR-scanner-writeback`): the extension's sidepanel now writes real
`parcel_records`/`tax_records`/`deed_records`/`llc_member`/`llc_manager` rows when someone scans a
county or SOS page. **It has never been used — zero rows on either domain, nine days after shipping**
(re-confirmed live 2026-09-12). That is not a build defect; it is the predictable result of there
being no signal anywhere telling Scott (or anyone) *which* property is worth the five minutes of manual
lookup. `county_records_needed` is that signal: a sixth action on the ownership-history lane's existing
split, alongside `agrees`/`mismatch`/`sponsor_spe`/`no_records`/`all_guarded`, naming the specific
population that has no public record to draw from at all.

**Measured live 2026-09-12 (Cowork), unblocking research-workbench.md §7b's three open items:**

- Of gov's 68 `human_actionable` tasks in `v_lcc_ownership_history_lane_split` with `action` in
  (`mismatch`, `all_guarded`), joined on `source_record_id` = gov `properties.property_id` against
  gov's own `parcel_records`/`tax_records`/`deed_records` — **excluding** the `ai_gpt4o_presumed`/
  `ai_recall_gpt` model leg (§2a of `public-records-source-lane.md`; only `costar_sidebar` parcel/tax
  rows and any `deed_records` row count as trustworthy) — **27 of 68 (40%) carry no trustworthy public
  record on file at all.**
- `all_guarded` rows are deliberately part of the 68, not excluded — "every transfer on file was
  guard-rejected" and "no record exists at all" are different reasons for the same stuck state, and
  this action exists to tell them apart, never to re-litigate A4/A4b's retirement logic.
- This is a DIFFERENT population from `v_lcc_ownership_chain_apply_blocked` (currently
  `ambiguous_entity`/`no_entity`/`placeholder`/`repeat_transfer_unrepresentable`, ~207 links) — that
  view is entity-IDENTITY-blocked residue, a different defect entirely. Do not conflate the two.

## 1. Re-measure before building (numbers move)

Re-run the 68-task query and the trustworthy-record join live before writing the migration — this is a
2026-09-12 snapshot and the open lane moves as A2/A3 apply tasks. Also re-check whether the
`ai_gpt4o_presumed` classification in `parcel_records`/`tax_records`/`deed_records` is still the correct
exclusion filter (§2a of `public-records-source-lane.md` names the exact `raw_payload->>'source'`
values) — do not assume the split found here is stable without checking it against the live rows.

## 2. Build

- Add `county_records_needed` as a sixth action inside `v_lcc_ownership_history_lane_split` (or the
  underlying function/view it's built from) — a property whose `action` would otherwise be `mismatch`
  or `all_guarded` AND which has no trustworthy `parcel_records`/`tax_records`/`deed_records` row
  reclassifies to `county_records_needed`. This is a RECLASSIFICATION within the existing split, not a
  new lane, new table, or new `research_type` — mirror A3's `sponsor_spe` precedent exactly (a fifth
  action added the same way).
- The value gate is the split's EXISTING `human_actionable` floor (`lcc_chain_human_value_floor()`) —
  do not invent a new floor or repeat the $500k literal a fourth time.
- The card/surface for this action should point at the sidepanel scan flow PR-scanner-1/2 already built
  (assessor/recorder/SOS) and, where the resolver already knows the county, PR-scanner-5's
  `/api/recorder-portal` "go here next" link (confirm PR-scanner-5's UI wiring status before assuming
  it's clickable — its backlog row says the route is live but the sidepanel button may still be
  unwired; check live, don't assume from the row's date).
- Nothing here changes PR-scanner-1/2's writers themselves — this prompt is purely the ranking/routing
  signal on top of an already-working capture path.

## 3. What NOT to do

No new `research_type`/`research_workbench_lanes` row (§7b's own decided-but-not-executed note — fold
into the existing split, don't parallel it). No touching `v_lcc_ownership_chain_apply_blocked` or its
identity-blocked population — that's a different defect (`OWN-T0`/`A2a`/`B1a` territory), not this
prompt's. No Salesforce write-back for anything a scan captures (`PR-scanner-4`, blocked on an operator
Connected-App decision, unrelated to this prompt). No building against dia — this lane has no
`v_ownership_transitions_portfolio` on dia, so no dia task can ever be drafted here (per `ownership-
history-lane.md` §5 row `B1-dia`); this prompt is gov-only by construction, same as the rest of the
lane.

## Guard + ship

Tests: a property with `mismatch`/`all_guarded` AND zero trustworthy public records reclassifies to
`county_records_needed`; a property with the same action but a real `costar_sidebar`/`deed_records` row
stays `mismatch`/`all_guarded` (must NOT flip); the `ai_gpt4o_presumed`/`ai_recall_gpt` leg must NOT
count as a real record (fixture with only a model-leg row should still classify
`county_records_needed`); `no_records` (already-retired) rows must never appear in this action (a
regression here would mean A4's retirement is being undone). Full suite green.

## Ship + record

Report: population size (both a re-measured 68/27 style ratio and the fleet-wide gov equivalent if it
differs from the `human_actionable`-only slice), the predicted-vs-actual `open_tasks` delta before/after
shipping (research-workbench.md §7b item 3 — the one number this prompt's own drafting session could
not measure without the migration existing). Update `PLANNED-BACKLOG.md` (`PR-scanner-3`,
`research-workbench.md` §7b/§7c cross-reference), `STATUS.md`, `ownership-history-lane.md` §5 ("what is
left" table — this closes or narrows a row there).
