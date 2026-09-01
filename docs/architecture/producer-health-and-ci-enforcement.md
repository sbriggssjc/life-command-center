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

| | before (`73f1418`) | after (`fd724a5`) |
|---|---|---|
| collected | 3,110 / **5 errors** | **3,128 / 0 errors** |
| **executed** | **0** | **3,128** |
| duration | 22 s | 6 m 12 s |
| conclusion | success (masked) | success (**still masked**) |

**3,065 passed · 55 failed · 7 skipped · 1 xfailed** — the first true measurement the repo has had.
✅ The **import check is unmasked and green on a real runner**, so it is a genuine gate.

⚠️ **The state is MEASURED, NOT ENFORCED, and that is sharper than the old one.** 55 real failures
are visible on `main` and still cannot fail a merge — previously nobody could mistake the badge for a
gate; now the job runs 3,128 real tests, reports red, and merges green. → **B6e-ci-openpyxl** (~12 of
55 are one `openpyxl` cross-module stub leak) then **B6e-ci-unmask**, in that order.

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
