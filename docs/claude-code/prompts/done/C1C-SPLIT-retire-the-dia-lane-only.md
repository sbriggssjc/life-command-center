# C1C-SPLIT — make the C1c retirement scopeable, then retire the dia lane only

## Why this exists

`supabase/migrations/20260908130300_lcc_c1c_retire_sf_lanes.sql` merged to `main`
on 2026-09-08 and **was never applied** (backlog **C1C-UNAPPLIED**; found by the
DEPLOY2 detector's first live catch, 9 of 9 declared objects absent from LCC Opps).
It cannot simply be applied now, because its own safety premise is half false.

C1c's header states the retirement is safe *because* C1b sets `gate_pass` permanently
false so *"nothing will mint into these two lanes ever again."* Measured live
2026-09-16:

| lane | domain | queued | minted in the 8 days since C1b | premise |
|---|---|---|---|---|
| `true_owner_needs_salesforce` | dialysis | **838** | **1** (2026-09-12) | **holds** |
| `owner_needs_salesforce` | government | **1,851** | **175** — 2 / 1 / 10 / **156** / 1 / 5 across 09-08→09-15 | **fails** |

The gov lane is still being fed because **C1b's gov gate guards the wrong arm**
(backlog **C1B-GOV-GATE**): the live government `v_ownership_gaps` carries exactly one
`lane_no_consumer` marker and it sits on **`owner_needs_sos`**, while the
`owner_needs_salesforce` arm still has the ordinary value/placeholder predicate.
Retiring the gov lane today is a one-time drop that refills within days — the PR1e /
N15d lesson that a backfill and a fixed producer are indistinguishable until the
producer runs.

The "no consumer" half **does** hold for dia, and was checked rather than inherited:
the lane shows 298 `completed` rows, but **every one carries a fully NULL `outcome`**
(no `action`, no `outcome`, no `terminal`; last touched 2026-09-02). That is a bulk
status flip, not a human working the lane.

## The blocker

`lcc_c1c_retire_sf_lanes(p_dry_run, p_batch_tag, p_limit)` has **no way to scope which
lane it retires**. Its plan CTE selects `research_type = any(public._lcc_c1c_lane_types())`,
and that function is a hardcoded `array['owner_needs_salesforce','true_owner_needs_salesforce']`.
So as shipped it is all-or-nothing, and "all" is currently wrong.

✅ **Good news, measured:** lane and domain are **1:1** —
`owner_needs_salesforce` is 1,851 rows, **all** `domain='government'`;
`true_owner_needs_salesforce` is 838 rows, **all** `domain='dialysis'`. So a lane-list
parameter is sufficient. **Do not add a domain parameter** — it would be a second way
to say the same thing, and two selectors that must agree is a defect waiting to happen.

## What to build

A migration that adds lane scoping to `lcc_c1c_retire_sf_lanes`, and nothing else.

* New parameter **`p_research_types text[] default null`**, where `null` means
  `public._lcc_c1c_lane_types()` — so every existing caller and the reversal runbook
  keep working unchanged.
* ⚠️ **Validate the argument against `_lcc_c1c_lane_types()` and reject anything else.**
  This function writes to `research_tasks`; a typo'd or arbitrary lane name must raise,
  not silently retire zero rows (a no-op that looks like a success is the failure shape
  this whole arc keeps paying for). An empty array is also an error, not "retire all".
* ⚠️ **Adding a parameter with a default creates an OVERLOAD, it does not replace.**
  `create or replace` will leave BOTH the 3-arg and 4-arg signatures live, and the next
  caller resolves to whichever Postgres picks — the 42725 trap this repo has already
  filed (N15g). **`drop function` the old signature explicitly first**, then create, then
  **assert in the same migration** that exactly one `lcc_c1c_retire_sf_lanes` row exists
  in `pg_proc`. Do not trust the DROP; assert it.
* Keep `p_dry_run boolean default true` first and unchanged. The dry-run-default is the
  safety property of this function; do not reorder the parameter list.
* Do not change `lcc_c1c_reopen_tasks`, `lcc_c1c_reopen_relinked`, `lcc_c1c_unretire`,
  `v_lcc_c1c_retired_watch` or the retire log. `lcc_c1c_reopen_relinked()` is already
  dia-only by design (it hardcodes `('dialysis','true_owner_needs_salesforce')`), which
  is consistent with retiring dia first — say so in the migration header rather than
  treating it as a coincidence.

## Out of scope — do not do these

* ⛔ **Do not retire, gate, or otherwise touch `owner_needs_salesforce` (government).**
  It is blocked on C1B-GOV-GATE.
* ⛔ **Do not fix the gov gate here, and above all do not fix it by re-applying this
  repo's `supabase/migrations/government/` copy of C1b.** `government-lease` owns that
  database (ID3a-d), and that directory's README exists because re-applying its files
  restores known-bad state.
* ⛔ Do not modify `_lcc_c1c_lane_types()` to drop the gov lane. The lane list is the
  *domain of valid arguments*; narrowing it would silently change what `null` means for
  every existing caller and would erase the record that gov is in scope later.
* Do not renumber or rewrite `20260908130300` itself. Ship a new migration on top —
  editing an already-merged migration file is how the two directories in this repo
  drifted from their databases in the first place.

## Running it

⚠️ **CC's sandbox has no Supabase egress — this was measured on the DEPLOY2 run.** So:

* Ship the migrations. **Do not claim a live result you could not obtain**; state plainly
  that the live apply and run are pending, the way the DEPLOY2 response correctly did.
* **Cowork will apply and run it live**, in this order, and the response should say this
  is the expected sequence:
  1. apply `20260908130300` (DDL only — it defines functions and runs nothing inline)
  2. apply the new scoping migration
  3. `select lcc_c1c_retire_sf_lanes(true, 'c1c-dia-<date>', null, array['true_owner_needs_salesforce'])`
     — dry run, confirm the write set is **838** and **0** gov rows
  4. same call with `p_dry_run => false`
  5. re-read `v_lcc_research_lane_summary` and confirm dia reads 0 open and
     **gov is unchanged at ~1,851**
* State the expected numbers in your response so step 3 has something to be checked
  against. ⚠️ **If the dry run returns anything other than 838 dia / 0 gov, that is a
  stop, not a rounding difference** — re-measure before writing.

## Acceptance

1. A test asserting the 4-arg form retires ONLY the named lane, and that a lane name
   outside `_lcc_c1c_lane_types()` **raises** rather than no-ops.
2. A test asserting **exactly one** `lcc_c1c_retire_sf_lanes` signature exists after the
   migration (the overload trap, positive-controlled).
3. A test asserting the default (`null`) argument still covers both lanes — the reversal
   runbook and any future gov retirement depend on it.
4. `lcc_c1c_unretire(p_batch_tag)` still reverses a scoped batch. Assert it, do not
   assume it: the batch tag is the only handle on a 838-row write.

## Deliverables

* `supabase/migrations/` — the scoping migration (root, `lcc_` prefix, LCC Opps).
* `test/` — the four assertions above, in whichever existing suite covers the C1 family;
  do not start a new harness.
* `docs/os/PLANNED-BACKLOG.md` — update **C1C-UNAPPLIED**, and leave **C1B-GOV-GATE** and
  **C2** open with a note that C2 closes only when the dia lane is retired AND the gov
  lane has a real gate. Surgical row edits.
* `docs/claude-code/STATUS.md` — entry below the `---` after the Open-threads table.

## Reporting

State: the expected dry-run write set; that the live apply/run is pending and why; and
whether the overload assertion actually fired in a positive control. If any step was
skipped, emit that it was skipped.
