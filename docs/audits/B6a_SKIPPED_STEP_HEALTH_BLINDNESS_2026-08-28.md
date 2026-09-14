# B6a — a SKIPPED step emits nothing, and the health view was built on emitted rows

> 📍 **CANONICAL PAGE: [`../architecture/producer-health-and-ci-enforcement.md`](../architecture/producer-health-and-ci-enforcement.md)** — one door into the whole B6 arc (live producer state, CI enforcement status per repo, and the traps already paid for). **This file is EVIDENCE for its date.** Where it and the canonical page disagree, the page wins.

**2026-08-28 · gov `scknotsqkcheojiaewwh` · playbook Class 21 · contract I4 · backlog B6a**

B6 found four ingestion producers dead since March–April 2026 behind an all-green health
surface, and named the mechanism: `pipeline_runner` guards the GSA diff on a local folder that
is always empty on CI, so the guarded step is never invoked, writes no `run_log` row, and has no
row in `v_pipeline_task_health`.

**The class is real and is now closed. Two things in the framing were wrong, and both mattered
to the fix.** No producer was restarted (B6b owns that); only visibility moved.

---

## 1. What shipped

| | |
|---|---|
| `sql/20260828_gov_b6a_feed_registry_producer_coverage.sql` | the four dead producers registered in the **existing** R56 registry, + a structured row filter, + a grant fix |
| `sql/20260828_gov_b6a_pipeline_task_health_cadence.sql` | `v_pipeline_task_health` gains `skipped`, `age_days`, `last_success_at`, `skip_reason`, `skip_declared`, `is_overdue` |
| `src/pipeline_runner.py` | `record_skip` / `run_guarded_task` — **both branches of a guard now write**; honest summary counters |
| `tests/unit/test_b6a_skipped_step_health.py` | 23 tests, **18 mutations verified RED**, comments stripped before matching |

**No new registry was built.** Three already exist (`feed_freshness_registry`,
`data_freshness_monitor.SOURCES`, `v_pipeline_task_health`); a fourth would have been the drift
this repo warns about a dozen times.

---

## 2. ⚠️ The registry the brief asked for already existed, wired end to end

R56 (`sql/20260620_gov_r56_feed_freshness.sql`) already does everything §1 of the brief
described: `feed_freshness_registry` names each feed's table, timestamp column and cadence SLA;
`compute_feed_freshness()` reads `max(ts_column)` and flags `is_stale`; LCC mirrors it cross-DB
(crons 140/141) and `lcc_check_feed_freshness()` opens a **deduped, auto-resolving**
`lcc_health_alerts` row. It is not theoretical — `feed_stale` has fired **8 times** historically.

**It reported a clean bill of health over four dead producers for one reason: nobody registered
them.** 14 feeds were registered. These four were not:

| producer | rows | last write | age |
|---|---:|---|---:|
| `gsa_lease_change_facts` | 356,291 | 2026-03-11 | 170d |
| `gsa_lease_timeline` | 16,471 | 2026-03-11 | 170d |
| `prospect_leads` (`lead_source='ownership_change'`) | 7,729 | 2026-03-31 | 150d |
| `property_sale_events` | 5,208 | 2026-04-06 | 144d |

All four now read **stale** against a 45-day SLA. Feeds 14 → 18, stale 1 → 5, and the 14
pre-existing rows are **unchanged in both directions** (0 lost, 0 altered).

### ⚠️ The registry is TABLE-keyed, and a producer is not a table

`prospect_leads` is the proof, and it is why this shipped a filter rather than four plain rows:

| reading of the same table | latest | age | would alert |
|---|---|---:|---|
| whole table (what a plain registry row reports) | 2026-08-28 | **0d** | **no** |
| `lead_source='ownership_change'` (the registered feed) | 2026-03-31 | **150d** | **yes** |

**A plain row would have been GREEN over a dead producer** — the registry's own version of the
failure it exists to catch. A table with several producers is fresh whenever *any* of them
writes. **Before quoting a feed as fresh, ask how many producers write that table.**

The filter is **structured** (`filter_column` + `filter_value`, through `%I` and `%L`), never
free SQL: `compute_feed_freshness` is `SECURITY DEFINER` and runs dynamic `EXECUTE`, so a
`where_sql` column would be a privilege-escalation vector for anyone who can write the registry.
A **both-or-neither CHECK** enforces the pair, because a half-set filter silently widens the feed
back to the whole table.

**Function signature deliberately unchanged** — `v_feed_freshness` is `SELECT * FROM
compute_feed_freshness()` and LCC's `lcc_finalize_feed_freshness` parses the returned keys, so
changing `RETURNS TABLE` would force a DROP of both and churn the cross-DB contract.

**Grant fix, in scope because this change extends the surface.** The registry — config for a
`SECURITY DEFINER` function — carried `INSERT/UPDATE/DELETE/TRUNCATE` for **anon** and
`authenticated`. Any anon caller could repoint a feed at an arbitrary table/column (the function
runs as owner and returns `max()` of it) or delete the registry and silently disable every
freshness alert. Revoked; `SELECT` retained, because the LCC cross-DB pull reads it as anon.

---

## 3. ⚠️ "No row" was only half the mechanism, and the worse half is a STALE GREEN ROW

`gsa_ingest_+_diff` is **not absent** from `v_pipeline_task_health`. It carries:

```
step_name        = gsa_ingest_+_diff
status           = ok
last_outcome     = "Task completed"
last_outcome_at  = 2026-06-22          -- 67 days ago
```

…on a step whose own history says it ran **every 7 days**. `status` was derived purely from the
last outcome's `event_type`, with **no comparison to when that outcome should have been
superseded**, so a step that succeeded once in June read identically to one that succeeded this
morning — and the ORDER BY sorted it below the fresh rows.

**B6's recommendation #2 was "the view should enumerate declared steps, not logged ones." That
would not have caught this one — it was never missing.** Both statements are true and they
compose: the skip emits nothing *for that run*, so what survives is a stale historical success.
Either way the missing dimension is **cadence**, not enumeration.

### ⚠️ The evidence was inside the green row's own payload

`find_latest_gsa_inventory` logged, six consecutive weeks running:

```json
{"message": "Task completed", "details": {"result": null, "duration_seconds": 0}}
```

`result: null` **is** the guard about to skip. The view projected `details->>'error'` and never
`details->>'result'`. **A guard's outcome is often already recorded in the successful row that
precedes it.**

---

## 4. The fix is at the emission point — which is why no step registry was needed

Adding a `skipped` status to the schema changes nothing while the runner still returns early
without writing. `record_skip` / `run_guarded_task` make **both branches of a guard write**, and
once every guarded step emits, **the LOGGED set IS the declared set**. The enumeration problem
dissolves rather than needing a registry to solve it.

Five guard sites rewired: the GSA folder guard, and the four env-key guards (FRED, SAM, Census,
Geocodio) which previously wrote a bare `log.info` and nothing else.

**`declared` has no default, deliberately.** It is the §2b distinction:

- **declared** — a skip somebody chose. A missing optional API key. The GSA folder, which
  `.github/workflows/ci.yml` *already documents* as always empty on CI **because the weekly
  `gsa-sync` job owns that work end-to-end** via `gsa_auto_sync`. Healthy; must be **visible**,
  must not alert.
- **undeclared** — the finding.

If `declared` acquired a default, every future guard would silently inherit somebody else's
judgement. **Not emitted for scope selection**: a monthly task on a weekly run was never supposed
to execute, and recording it as skipped every week would be both noisy and wrong.

**Honest counters.** `build_summary`'s `tasks_skipped` previously counted **dry runs**, which is
why a real skip had nowhere to be recorded. Split into `tasks_skipped` / `tasks_dry_run`, plus
**`tasks_skipped_undeclared`** — the number that means something. A bare total is a re-discovery
tally that reads the same whether the pipeline is healthy or quietly broken (P159a).

---

## 5. ⚠️ The cadence statistic was measured, not chosen

`is_overdue` = `age_days > 3 × the step's own p90 inter-run gap` over its last 12 terminal
outcomes. No registry, no hand-maintained SLA per step.

**p90, not the median.** The median is deflated by **clustered runs**:

| step | median gap | p90 gap | age | median rule | p90 rule |
|---|---:|---:|---:|---|---|
| `census_demographics` (monthly) | 3.99d | 28.78d | 23d | **flags — wrong** | correct (no flag) |
| `step_2_gsa_lease_ingestion` (monthly) | 3.72d | 30.99d | 23d | **flags — wrong** | correct (no flag) |
| `gsa_ingest_+_diff` (weekly, dead) | 7.00d | 7.00d | 67d | flags | **flags — correct** |

`census_demographics` fires several times inside one monthly window, so its median gap describes
intra-cluster spacing, not its cadence. A rule that false-positives healthy steps is how an
operator learns to stop reading the surface.

**Below 3 observed gaps, `is_overdue` is NULL — never false.** `geocode_properties` (quarterly,
one recorded gap) reports `expected_max_age_days = NULL, is_overdue = NULL`. *Cannot be sized*
and *sized and fine* are different facts (P180).

The `× 3` multiplier tolerates two consecutive misses and flags around the third.

---

## 6. Verification

**Acceptance (§3): the four known-dead producers read RED.** 170 / 170 / 150 / 144 days against a
45-day SLA.

**Equivalence, both directions.** Feed registry: 14 pre-existing feeds, **0 changed, 0 lost**, 4
added. View: **0 lost, 0 changed** across every pre-existing column (`step_name`,
`last_outcome_at`, `status`, `last_outcome`, `last_error`), 70 rows before and after.

**Positive control (§2a) — the detector was SEEN going red on a deliberate silence**, in a
self-rolling-back transaction, **0 residue**:

```
CTRL1 healthy weekly   : status=ok  age=1   p90=7.00  obs=6  expected=21.00  overdue=f
CTRL2 silenced +60d    : status=ok  age=61              expected=21.00  overdue=t
CTRL3 declared skip    : status=skipped  reason=gsa_download_folder_empty  declared=t
CTRL4 undeclared skip  : status=skipped  reason=unexpected_guard           declared=f
```

CTRL1→CTRL2 is the same step, same cadence, only older — so the transition is the detector
firing, not a difference in the data. CTRL3/CTRL4 are §2b: **a declared skip does not alert, an
undeclared one does.**

**Negative controls on the registry filter.** A half-set filter is rejected by the CHECK. A
hostile `filter_value` of `x' or true--` returns `status='no_data'` — treated as a literal,
matching nothing, not as SQL.

**Guards.** 23 tests; **all 18 mutations verified RED**. Two were caught blind by the mutation
run and strengthened: asserting `'Task skipped'` appeared *anywhere* in the view passed over its
removal from the terminal-message allowlist (the status CASE arms quote it too), and asserting a
constraint *name* passed over a deleted CHECK (the `DROP … IF EXISTS` line carries the name).
**Comments and docstrings are stripped before matching**, positive-controlled — both migration
headers quote the broken pattern at length while explaining the fix (the A5c/N18 defect).

**Suite.** 715 pass. 10 `test_sos_detail_fetcher` failures and 7 intake collection errors are
**pre-existing** — identical with this change stashed.

---

## 7. ⚠️ Found on the way, NAMED AND SIZED, NOT FIXED

### 7a. The cross-DB freshness monitor has evaluated nothing since 2026-07-26

Registering the four producers makes them stale on gov's own view immediately. The **alert** is
downstream, and it is currently broken for an unrelated reason — **a three-layer silence chain
in which every layer reports success**:

1. gov `v_feed_freshness` is correct and current. It says `sam_lease_opportunities` is 32d stale.
2. LCC crons **140/141** fire daily and record `succeeded`, but
   `lcc_domain_feed_freshness.synced_at` is stuck at **2026-07-26** (gov) / **2026-07-29** (dia).
   `lcc_finalize_feed_freshness` consumes only `status_code = 200` and **silently drops anything
   else**, returning `(0, 0)` — indistinguishable from "nothing to do".
3. `lcc_check_feed_freshness` excludes mirror rows older than 3 days, so with a stale mirror it
   evaluates **zero** gov/dia feeds and returns `new_alerts: 0, stale: []`.

**The staleness guard on the mirror is itself the silent failure: when the sync stops, the check
stops checking, and reports nothing wrong.** That is Class 21 one level up. Live proof: gov reads
a stale feed today and **no `feed_stale` alert is open** (last one 2026-07-24). Filed as
**B6a-follow-up**; not fixed here because mixing an LCC repair into a gov instrument change makes
it impossible to tell which one moved the number (§2e).

### 7b. Ten `step_NN_*` steps of `src/run_pipeline.py` read overdue at 121–150 days

True, not noise: CI runs `pipeline_runner`, not that 9-step orchestrator. Whether it should be
retired or scheduled is a separate call.

### 7c. The GSA skip is documented and compensated — it is NOT why the four producers died

`ci.yml` already carries a comment saying `find_latest_gsa` "reads from a local `data/gsa/`
folder, which does not exist on the ephemeral GH runner — so monthly silently no-ops on
inventory", and a separate weekly `gsa-sync` job does that work. That is why
`gsa_leases_snapshot` and `gsa_lease_events` both read **fresh**.

**So the skipped step is a genuine instance of the class and was NOT the load-bearing cause of
the four-producer blindness.** They died from B6 §8(a) — `gsa_lease_change_facts` and
`gsa_lease_timeline` are written only by `ingest_gsa_historical.py`, which has **no scheduled
caller at all** — and nobody saw it because **no instrument watched those four tables**. Both
fixes were needed; only one of them was the reason.

---

## 8. The durable lessons

1. **A failed step is a red row; a skipped step is no row — and a stale success is a GREEN row.**
   A health surface must compute against **expected**, not observed.
2. **The fix is at the emission point, not the vocabulary.** Once both branches of a guard write,
   the logged set is the declared set and the enumeration problem disappears.
3. **A legitimate skip must be declarable**, or the surface becomes the noise it replaces —
   and the declaration must have **no default**.
4. **A producer is not a table.** A table-keyed freshness registry reads fresh whenever any of
   its producers writes; the dead lane inside it is invisible.
5. **Measure the statistic before choosing it.** p50 vs p90 is the difference between a detector
   and a nuisance, and the data said which.
6. **A detector that has never been seen firing is a claim.** Silence something on purpose,
   watch it go red, restore.
7. **Check the registries you already have before building one.** Three existed. The honest fix
   was config rows plus a filter, not a subsystem.
