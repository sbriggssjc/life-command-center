# Producer health & CI enforcement — the canonical entry point

> **START HERE for: is our ingestion actually running? does anything watch it? does CI enforce
> anything?** One door into the **B6 arc** (B6a → B6e, 2026-08-28 → 09-01, fourteen audits), which
> found that most of our monitoring measured *symptoms* while nothing watched *causes*.
>
> **The audits stay as EVIDENCE — this page is the live state, the decisions already made, and the
> traps already paid for.** Where this page and an audit disagree, **this page wins** and the audit
> gets a supersession note in the same change.

**Live state 2026-09-01 · backlog `B6*` / `PR*` · invariants `I4`, `I11` · playbook Classes 21, 31.**

---

## 1. The one thing to carry away

**Every producer failure in this arc reported success.** Not one errored, not one alerted, and
several ran green for weeks or months while writing nothing:

| producer | how long it was dead | what reported healthy |
|---|---|---|
| CMS ingestion | **67 days** | cron green; a 30-day throttle keyed on last **ATTEMPT**, so a failure bought 30 days of silence |
| `fred_ingest` | **since its first run** | 16 consecutive green scheduled runs; `\| tee` without `pipefail` returned tee's exit code |
| `public_record_ingest` | ~1,950 failures/day | the service reported success |
| gov `sam_lease_opportunities` | 33 days | the feed's own SLA was mis-sized, so nothing fired |
| Dialysis test suite | **the repo's entire history** | `\|\| echo` after a pytest that aborted at collection |

> **The rule: assert on the STATE DELTA — rows written, queue drained, population changed — never on
> a worker's own tally, its exit status, a green cron, or a green badge.**

## 2. Live producer state (dia)

`dia_producer_registry` + `v_dia_producer_health`, built in B6d-cms-escalation because
`ingestion_tracker` had **no health view consuming it**.

| producer | scheduled | state |
|---|---|---|
| `cms_ingestion` | ✅ | **the only dia producer that writes a run row.** Repaired B6d-cms; `source_last_seen` moved 2026-06-25 → 08-31 |
| `fred_ingest` | ✅ | ✅ **verified alive 2026-09-01** — `max(created_at)` 15:31, `max(observation_date)` 2026-08-28, 8,316 → 8,336 rows |
| `public_record_ingest` | ✅ | running, ⚠️ **but it is a GENERATOR, not an acquisition path** — see §4 |
| `salesforce_object_sync` | ✅ | **twice a year (1 Jan / 1 Jul)** — a failure is invisible for months |
| `metadata_backfill_queue` | ❌ | **RETIRED 2026-09-01.** Ran once manually: 25 processed, 0 enriched, 0 errors, 0 trace |

⚠️ **Three of these five still write NO run row**, so a failure is invisible to the health view →
**B6e-ledger**, **B6d-cms-escalation-emit**. **A registry built from the run table rebuilds the
blindness one level up** — `fred_ingest` was found only because the registry was enumerated from the
**scheduler**, not from `ingestion_tracker`.

**Open health alerts (LCC Opps): 14 total**, largest `sidebar_promote_pipeline_failed` (4),
`resolver_calibration_drift` (3), `lcc_health_red` (3); **`feed_stale` is down to 1** (SAM, blocked
on a 401 → **B6d-sam**) from 4 at the start of the arc.

## 3. CI enforcement — where each repo actually stands

| repo | does a red suite block a merge? | notes |
|---|---|---|
| **life-command-center** | ✅ **yes** | `npm test` is a bare unmasked `run:` and a **required check** since 2026-08-27; all 7 workflows carry `timeout-minutes`. **Verified clean 2026-09-01** — its `exit 0` / `\|\| true` are deliberate control flow inside `set -euo pipefail` |
| **Dialysis** | ❌ **no** | the suite **now runs** (first time ever, PR #7389) but the pytest line is **still masked** |
| **government-lease** | ❓ unmeasured | not swept |

### The Dialysis milestone, and the state it leaves

| | collected | errors | **executed** | pass | fail |
|---|---:|---:|---:|---:|---:|
| `73f1418` (pre-#7389) | 3,110 | 5 | **0** | — | — |
| `c80f778` (#7389) | 3,128 | 0 | 3,128 | 3,065 | 55 |
| **`eac8668` (#7390)** | 3,128 | 0 | **3,128** | **3,106** | **14** |

**7 skipped · 1 xfailed throughout.** ✅ The **import check is unmasked and green on a real runner**,
so it is a genuine gate, and **`timeout-minutes` now bounds all four jobs**, sized from a measured
run (Tests 7 m 58 s → 20) rather than guessed — they were inheriting the **6-hour** default.

⚠️ **`executed` held at 3,128 across every step — nothing was hidden to make the failure count
fall.** That is the number that makes the rest trustworthy, and it is the one to demand of any
"we fixed the tests" claim.

⚠️ **The state is still MEASURED, NOT ENFORCED.** 14 real failures are visible on `main` and cannot
fail a merge, because the pytest line keeps its `|| echo`. → **B6e-ci-red14**, then
**B6e-ci-unmask**, in that order. **Unmasking against known red ships a gate red on day one — the
documented trap.**

### 🎯 Two techniques from #7390 worth reusing

**1. Isolation before traceback.** One `pytest <file>` per failing file split 55 into **36 pollution
/ 19 genuine before a single traceback was read**. `test_master_sheet` + `test_work_product_base` are
**21 passed alone, 21 failed in the suite, on identical source** — *that comparison, not the error
text, is what proves harness-vs-product.* Error messages describe the symptom; isolation identifies
the class. (It also corrected the estimate: the cluster was **36, not the ~12** counted from error
strings.)

**2. ⚠️ Restoring a stub RELOCATES the damage — check for that before declaring the fix.** Putting
the genuine `openpyxl` back created a new defect: a fixture doing
`sys.modules["openpyxl"].Workbook = DummyWorkbook` and never restoring it was **harmless while the
module was a throwaway stub and permanently rebinds the real package once it is back.** The existing
snapshot could not see it — **it ran at COLLECTION time; the write happens at RUN time.** The same
shape in `dateutil` surfaced as **`quarantine_dead_ends` silently deleting 0 rows instead of 1, in a
module that never mentions `dateutil`** — i.e. a test harness reaching into *data* behaviour. Three
layers were all required: sys.modules objects · attributes on the real module · symbols already bound
into `src.*` globals by a `from X import Y` executed inside the stub window.

### The remaining 14 — and the one group that needs a decision, not a fix

All 14 fail **in isolation**, so they are genuine test-vs-code disagreements rather than harness
pollution. ⚠️ **`git log` cannot adjudicate them — every file traces to one squashed import merge
(`8c67444`), so there is no "which side moved last."** The evidence has to come from the code and
the data.

| group | n | treatment |
|---|---:|---|
| `financial_ground_truth` | 3 | ⚠️ **measure, do not change** — see below |
| `listing_broker_update` | 2 | a real product bug → **B6e-ci-listing-broker** |
| `handle_natural_language_query` | 2 | known drift |
| `backfill_*` | 3 | most likely straightforward |
| `clinic_history` / `clinic_alert_date` / `reverse_cms_propagation` / `run_summary_gate` | 4 | one each |

⚠️ **The `financial_ground_truth` three risk the `dialysis_econ_reconciled_v1` calibration if
guessed at — but they are MEASURABLE.** `clinic_econ_reconciled` is live and current: **81,105 rows
/ 8,281 clinics / FY2011–2026, a single `model_version_id = 21`, computed 2026-09-01**, with
`avg blended_rate_per_treatment 375.47` and `avg reconciled_revenue_per_treatment 380.14`. **The
right output is a three-way comparison — test constant vs code output vs live reconciled value —
distinguishing a stale test, drifted code, and two internally-consistent things describing different
scopes. The decision stays Scott's.**

**The governing rule for all 14: establish whether the TEST or the CODE is wrong before changing
either.** Twice in this arc a red test was stale and the code was correct; *"make the test pass"* is
the expensive error. And **`executed` must stay at 3,128** — a fix that cuts failures by cutting what
runs is the defect this whole arc exists to close.

### What the suite has already caught

🔴 **A real product bug, within hours of first running.** `update_database.update_field` normalises a
broker name to `listing_broker_id` only if `resolved_field == "listing_broker_id"` — **but the alias
is the identity mapping, so the branch is dead.** Filed, not guessed at, because both columns exist
and flipping either side changes a write path (**B6e-ci-listing-broker**). **That is the argument for
finishing the unmask.**

⚠️ **Do not unmask before the red is cleared** — gating a never-enforced suite is the documented
*"never green once on `main`"* trap. **The import check is the model: unmask one line, prove it green
on `main`, then it counts.**

### The masking idioms — grep the SHAPE, never one spelling

`|| echo` · `| tee` without `set -o pipefail` · `2>/dev/null` · `continue-on-error: true` ·
`exit 0` · `|| true`.

⚠️ **`|| echo` is worse than `| tee` because it looks deliberate.** And 🎯 **the cruellest instance
found: `python -c "import src.main" 2>/dev/null || echo` — the repo already had the detector that
would have caught FRED's `ModuleNotFoundError`, and had muzzled it.** **Before adding a detector,
check whether one exists and is silenced.**

⚠️ **A guard written for an INSTANCE does not cover the CLASS** — B6e found a pipefail guard scoped
to the one file the previous audit was looking at, using a file-wide `find()` rather than a step
anchor. Replaced with a class-wide, step-anchored guard.

## 4. ⚠️ The lane that is running and must NOT be wired

`public_record_ingest` is green, scheduled, and **generates its values**: no county fetch on either
domain — dia asks **gpt-4o to recall** parcel facts; gov snapshots the assessor **portal homepage**.
**Fixing a producer's RELIABILITY says nothing about the VALIDITY of what it produces**, and B6d-pri
repaired the throughput of a generator without that question being asked.

**Full detail: [`public-records-source-lane.md`](public-records-source-lane.md).** Its output reached
~8,800 curated dia rows and every `tax_delinquent` value in both domains as **zeros** before
PR1a/PR1b nulled them.

## 5. Traps paid for — do not re-walk these

- **A monitor's THRESHOLD is part of the monitor.** 10 of 23 feeds carried a default 45-day bound
  that was never a measurement; two "mis-sized SLAs" were **genuine outages** (B6d).
- **⚠️ "The SLA must be wrong" is the comfortable reading and it was wrong both times.** Before
  widening a bound, prove the feed's current age is within its own observed range.
- **A skipped step must EMIT, not vanish** (B6a, I4) — and *"no rows"* ≠ *"no runs"*: a skip that
  writes nothing is indistinguishable from a cron that stopped.
- **Retire an expectation by removing the BOUND, never the row** — dropping a feed off the surface
  makes its open alert permanent.
- **A negative-marker worker reads like a stall while everything works** (P136/A5); a
  re-discovery tally reads like throughput while nothing moves (P159a). **Both are the same mistake:
  asserting on the convenient counter.**
- **Run an unscheduled producer ONCE, manually, before wiring a cron to it.** The assessor drain's
  three defects — silent success, no cursor, no producer — were all visible in one manual run and
  **none was visible from the code, the flag, or a green cron.**
- **`| tee` without `pipefail` returns tee's status.** In bash a pipeline's status is its *last*
  command.
- ⚠️ **Merged is not running; green is not enforced; and a green check that finished AFTER the merge
  is neither.** Four merge-before-CI instances were recorded in two days.

## 6. Where else to look

| for | read |
|---|---|
| the invariants | `data-coherence-invariants.md` — **I4** (a producer emits even when it skips), **I11** (a monitor must alert on its own blindness) |
| the detector catalogue | `../audits/DEAD_END_AUDIT_PLAYBOOK.md` — **Class 21**, **Class 31** |
| the public-records lane | `public-records-source-lane.md` |
| the assessor decision | `property-metadata-coverage.md` (⚠️ carries a queue-scoped superseded verdict) |
| open rows | `../os/PLANNED-BACKLOG.md` — `B6*`, `PR*` |
| the evidence | `../audits/B6*.md` — fourteen audits, newest-first in `../claude-code/STATUS.md` |
