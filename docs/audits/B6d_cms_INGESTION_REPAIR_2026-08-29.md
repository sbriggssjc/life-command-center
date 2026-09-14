# B6d-cms — the CMS ingestion outage: a 30-day throttle on a daily cron, latched by its own crashes

> 📍 **CANONICAL PAGE: [`../architecture/producer-health-and-ci-enforcement.md`](../architecture/producer-health-and-ci-enforcement.md)** — one door into the whole B6 arc (live producer state, CI enforcement status per repo, and the traps already paid for). **This file is EVIDENCE for its date.** Where it and the canonical page disagree, the page wins.

**Date:** 2026-08-29 · **Repo:** `Dialysis` (code) · **DB:** dia `zqzrriwuavgrquhisnoa`
**Parent:** `docs/audits/B6d_FEED_EXPECTATION_GRADING_2026-08-29.md` §11 · **Backlog:** `B6d-cms`
**Status:** cause NAMED and FIXED in code. **Not verified live — the fix ships on the next Railway
`cms-ingestion` run, and one question remains for Scott (§7).**

---

## 1. Result

`medicare_clinics` has not been ingested since **2026-06-25**; `source_last_seen` reads
**65 days** stale against a 45-day bound. The cause is **two coupled code defects**, neither of
which ever recorded an error:

| # | Defect | Effect |
|---|---|---|
| **1** | `run_cms_ingestion.main` gated the run behind **`if days_ago >= 30`** | A calendar throttle capping a **daily** cron at ~**one** ingest per month |
| **2** | `get_last_ingestion_meta` took the newest tracker row **of any status** | A run killed mid-flight recorded the new dataset date and **suppressed its own retry** |

Together they form a latch: the gate opens ~every 31 days → the run starts → it is killed →
the crash re-arms both gates → silence for another 30 days. **Fix 2 is required for fix 1 to
work**, or the pipeline would run daily and then skip on a watermark written by a crashed run.

**The SLA was never the problem and was not touched.** The feed's own history is p50 2d / p90
18.5d / **max 41d ever**; current age 65d is above the largest gap it has ever had. A bound above
a feed's observed maximum is not a mis-sized bound — it is the only reason this was found.

---

## 2. ⚠️ Three premises in the brief were wrong, and each one mattered

**2a. `cms-ingestion-daily.yml` does not exist.** It was **deliberately deleted** on 2026-07-29
(`5d54fd7`, W1.5b) because it ran compute/egress that fails on the GH free plan and duplicated the
Railway cron. Ingestion has run on the **Railway `cms-ingestion` cron service** (`0 6 * * *`) since
2026-05-16. `INFRASTRUCTURE.md` records this correctly; the brief, and the
`feed_freshness_registry.expectation_basis` B6d wrote hours earlier, both still name the retired
workflow. Chasing GitHub Actions logs would have found nothing.

**2b. "40 failed + 16 abandoned, still trying daily" is not 56 failed ingestions.** Those totals
**lump `source='ingestion_lock'` janitor rows in with pipeline rows**. Split by source: 27 failed +
6 abandoned are `cms_ingestion`; 13 + 10 are the lock's own bookkeeping. More importantly the runs
are **not daily** — distinct attempt-days in the last 100:

```
2026-06-13, 06-24, 06-25, 07-26, 07-30, 08-26, 08-27   →  7 of 100
```

Spacing 06-25 → 07-26 → 08-26 is **31 days**. That regularity is the throttle, and it was visible
in the calendar before any code was read.

**2c. "We attempted and the runs failed" — no failure carries a CMS error.** Every `failed` /
`abandoned` row's `error_log` is a janitor artifact:

- `"Orphaned run detected: stuck in 'started' for 23.8h / 48.0h"`
- `"Reclaimed by ingestion_lock after 0.0h stale"`

**Zero rows carry a Python traceback.** `run_cms_ingestion` wraps the work in try/except and writes
`release_ingestion_lock(status="failed", error=str(exc))` — so an *exception* would have been
recorded. Nothing was. **The process is being killed, not failing** (see §7).

---

## 3. What is actually working — the measurement that reframed everything

The Railway cron is healthy and **CMS egress works**. `cms_dataset_updates` — written by
`cms_signature.persist_signature` on both the skip and proceed paths — was fetched on **99 of the
last 100 days, including today 2026-08-29 at 06:02:25 UTC**, the `0 6 * * *` slot.

So the pipeline **starts daily, reaches CMS, and successfully reads the dataset signature**. It
then declines to do any work. This killed an earlier hypothesis (Railway Hobby credit exhaustion,
which the month-end clustering superficially fit) and pointed at a gate rather than an outage.

**Rule: before blaming the platform, find something the job writes on every run.** A daily
side-effect row is a heartbeat; here it separated "not running" from "running and skipping" in one
query.

---

## 4. The mechanism, precisely

`src/run_cms_ingestion.py::main`:

```python
skip, sig = maybe_skip_if_unchanged(supa, dataset_name="cms_patient_counts", ...)
if skip: return
days_ago = days_since_last_ingestion("cms")
if days_ago >= 30 or args.force_run:        # ← the throttle
    run_cms_ingestion(...)
else:
    return                                   # "recently run; skipping"
```

`days_since_last_ingestion` → `get_last_ingestion_meta()` in
`src/ingest_medicare_clinics.py`, which queried:

```python
.eq("dataset_id", "cms_medicare_clinics")
.order("started_at", desc=True).limit(1)     # ← no run_status filter
```

**The newest row of any status becomes "the last ingestion."** The abandoned 2026-08-27 row carries
`dataset_modified_date = 2026-08-25 22:34:32` — CMS's actual publish — so it also poisons the
*content* gate inside `run_cms_ingestion`:

```
if last_dataset and cms_updated <= last_dataset:  # 08-25 <= 08-25 → SKIP
```

⚠️ **A crashed run therefore suppresses the retry for exactly the publication it failed to
ingest.** This is the most dangerous half: removing the throttle alone would not have fixed the
outage.

The third gate is fine and was left alone — `_get_latest_clinic_ts()` reads
`medicare_clinics.created_at` (max 2026-05-13), so `cms_updated 08-25 > 05-13` correctly proceeds.

---

## 5. The fix

Three changes in `Dialysis`, all narrow:

1. **`src/run_cms_ingestion.py`** — the calendar throttle is **removed**. Change detection is
   content-based and already lives inside `run_cms_ingestion()` (`SKIP-GATE [dataset_date]`,
   `SKIP-GATE [last_run_date]`), and `scripts/cron/cms-ingestion.sh` already documents that "a run
   that finds nothing new exits in seconds, so a daily Railway cron is safe." The throttle
   prevented those gates from ever being consulted. `days_ago` is retained as a **log line only**.
2. **`src/ingest_medicare_clinics.py`** — `INGESTED_RUN_STATUSES = ("success",)` and the watermark
   query filters on it. Deliberately excludes `partial` (did not finish the dataset) and `recorded`
   (marks a run that *skipped*) as well as the crash statuses: **when in doubt this must fail OPEN
   and re-run, never suppress.**
3. **`src/ingestion_lock.py`** — the reclaim message reported `"stale"` unconditionally, producing
   the self-contradicting `"after 0.0h stale"`. It now reports the real reason. Honesty fix only.

**Not changed:** the SLA, the patient-counts feed, the lock's coordination semantics, and the
`force=force or force_refresh` self-reclaim (§7).

**Guard:** `tests/test_b6d_cms_ingestion_throttle.py` — 8 tests, **all four mutations verified
RED** (restore the throttle → 1 red; drop the status filter → 3 red; admit `partial` → 1 red;
hardcode `"stale"` → 1 red). Source assertions **strip comments first**, because the fix's own
comments quote `days_ago >= 30` verbatim — a naive grep would report the bug it just removed (the
A5c / N18 / B6c-dup lesson). A positive control asserts the stripper can still see real code.

---

## 6. ⚠️ The escalation gap (§3b of the brief) — answered: it is structural

**This pipeline is in no producer registry.** B6a made *skipped* pipeline steps visible via
`run_log` → `v_pipeline_task_health`, but that surface is **gov-side**, and the CMS pipeline writes
to **`ingestion_tracker`**, which no health view watches. So:

- A run that is **killed** leaves an `abandoned` row and **alerts nobody**.
- The `feed_stale` freshness alert was the *only* thing that could ever catch this — and because
  the feed's bound is 45 days, it could not fire until 45 days in. **It took two months.**

**A failing producer should be louder than a stale table.** The freshness monitor is a
last-resort backstop measuring a *symptom*; nothing watched the *cause*. This is B6a's Class 21 one
layer over: B6a fixed "a skipped step emits nothing"; here **the step emits, into a table with no
consumer.**

Filed as **B6d-cms-escalation** (not built here — it is a new detector with its own reversibility
and dedup story, and bundling it would make it impossible to tell which change moved the number).
The cheapest honest version: alert on any `ingestion_tracker` row that reaches `abandoned`, and on
`max(started_at) - max(started_at where run_status='success')` exceeding the feed's own cadence.

---

## 7. 👤 What remains for Scott — one question I cannot answer from here

**The fix removes the throttle. It does not explain why each attempt died.** The evidence says the
process is **killed**, not failing: no traceback anywhere, and the lock is never released (the
`finally`/`except` release path never ran). The likely candidates, in order:

1. **Railway container memory (OOM).** The `medicare_ingestion` step downloads and validates ~50k
   CMS rows and legitimately runs ~45 minutes; an OOM kill produces exactly this signature — no
   Python error, no lock release. The Hobby plan is the smallest tier.
2. **A Railway cron one-shot execution ceiling** cutting the ~45-minute step short.

**The check is one place I cannot reach:** Railway dashboard → `cms-ingestion` service → the deploy
logs for **2026-08-26 and 2026-08-27, 06:00–07:00 UTC**. Look for `OOMKilled` / `SIGKILL` / an
abrupt end with no `"Cron complete"`.

⚠️ **Do not set `FORCE_RUN=true` as the retry.** It bypasses the content gates *and* propagates
`force=True` into `acquire_ingestion_lock`, which then **force-reclaims the pipeline's own
just-opened tracker rows** — that is the origin of the `"Reclaimed after 0.0h stale"` rows and it
corrupts the very record needed to diagnose the next failure. With this fix, a plain **Redeploy**
is enough: the run proceeds on its own because CMS (08-25) is newer than the last *successful*
ingest (06-25). That self-reclaim is a real defect, left unfixed deliberately (**B6d-cms-lock**) —
it is lock semantics, not the outage, and it deserves its own change.

**Sandbox limits, stated:** the agent proxy denies `data.cms.gov` (`connect_rejected`), so the
pipeline could not be run end-to-end here, and Railway logs are not reachable. This is diagnosis
plus a code fix, not a verified restart.

---

## 8. Verification — what to read, and what NOT to

Run **after** the next Railway `cms-ingestion` execution:

| Check | Expected |
|---|---|
| `max(medicare_clinics.source_last_seen)` | advances past **2026-06-25** — the state delta |
| `feed_stale` alert for `medicare_clinics` | **auto-resolves** (read the alert ledger, not the run log) |
| `ingestion_tracker` newest `cms_medicare_clinics` | `run_status='success'` with **non-zero `rows_upserted`** |
| attempt cadence | **daily** rows, not one per month |

⚠️ **Read `rows_upserted`, never `rows_fetched`** — a run that fetched and upserted nothing is not
a success, and this tracker carries both.

⚠️ **`medicare_clinics.updated_at` is NOT the freshness signal.** Its max is 2026-08-13 and 8,288
rows were touched in 70 days — by the reconciled-econ denorm writer, not by ingestion. Only
`source_last_seen` (the registry's `ts_column`) tracks CMS. Reading `updated_at` would have
reported this feed healthy throughout the outage.

⚠️ **`facility_patient_counts` is a different feed and is NOT broken.** CMS publishes it ~annually;
`cms_dataset_updates` shows `cms_patient_counts` last modified **2026-03-24**, checked daily since.
It is annual, not stale — do not "fix" it because it also looks old.

---

## 9. Durable lessons

- **A calendar throttle inside a scheduled job is a second, invisible schedule** — and when the two
  disagree, the cron's schedule is a lie. Here `0 6 * * *` met `days_ago >= 30`; the code won.
- **A watermark that counts crashed runs converts one failure into a permanent outage.** Any
  "have we already done this?" check must be keyed on **runs that actually landed data**, and must
  fail OPEN. This is the repo's own *assert on the state delta, never the run's existence* rule,
  applied to the gate rather than the report.
- **A janitor's message is not a diagnosis.** Four separate artifacts here (two orphan sweeps, a
  lock reclaim, and a hardcoded `"stale"`) described the *cleanup*, and the absence of a real error
  was itself the strongest evidence — it ruled out every exception path and pointed at a kill.
- **Find the job's daily side-effect before concluding it is not running.** `cms_dataset_updates`
  turned "the platform is broken" into "the pipeline is skipping" in one query.
