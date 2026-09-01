# B6d-cms-escalation — dia has five scheduled producers and had no surface over any of them

> 📍 **CANONICAL PAGE: [`../architecture/producer-health-and-ci-enforcement.md`](../architecture/producer-health-and-ci-enforcement.md)** — one door into the whole B6 arc (live producer state, CI enforcement status per repo, and the traps already paid for). **This file is EVIDENCE for its date.** Where it and the canonical page disagree, the page wins.

**Date:** 2026-09-01 · **Repos:** `Dialysis` (build), `life-command-center` (docs)
**DB:** Dialysis_DB `zqzrriwuavgrquhisnoa` · **Contract:** I4 (structural half) · **Playbook:** Class 21

---

## 0. The finding outranks the view

The brief said: *if enumerating the schedulers turns up producers nobody knew were scheduled — or
scheduled producers that have never run — that is the finding.* It did, and it is worse than
"never run":

> **The FRED ingestion workflow has run GREEN 16 consecutive times since 2026-08-10 and has
> written ZERO rows. It has never written a row in its entire 20-run history.**

It was added on **2026-08-07, explicitly to fix a silent FRED stall** (PR #7363, *"Add FRED
ingestion scheduler + staleness watchdog (fixes silent stall)"*). It has been silently stalled
since birth.

Three independent surfaces each held half the truth and none of them met:

| surface | what it said | correct? |
|---|---|---|
| GitHub Actions | `conclusion: success` ×16 | yes — the *job* exited 0 |
| `dia_check_fred_staleness` → `lcc_health_alerts` | alert **316 open since 2026-08-16**, *"DGS10 … 27 days behind"* | yes — the *data* is stale |
| any producer-health surface | — | **did not exist** |

**The workflow prints the staleness verdict in its own log on every single run and passes anyway.**

### Root cause, reproduced locally

```
File "src/gpt_usage_logger.py", line 12, in <module>
    from postgrest.exceptions import APIError
ModuleNotFoundError: No module named 'postgrest'
```

Importing **any** `src.*` module runs `src/__init__.py` → `utils_shared` → `match_utils` →
`gpt_usage_logger` (→ `postgrest`) and `supabase_helpers` (→ `supabase`). The workflow installs
only `requests python-dotenv`. Both packages are **already pinned in `requirements.txt`**
(`postgrest>=0.19.3`, `supabase>=2.13.0`) — CI just never installs them.

Reproduced in a clean venv: `pip install requests python-dotenv` → `ModuleNotFoundError`;
adding `supabase` → `IMPORT OK`.

### ⚠️ Why it was GREEN: `| tee` without `pipefail`

```bash
python -m src.ingest_fred_to_dialysis $ARGS 2>&1 | tee fred_run.log
```

`shell: bash -e` exits on error, but **a pipeline reports the status of its LAST command** — `tee`,
which always succeeds. Measured directly:

```
without pipefail -> exit 0
with pipefail    -> exit 1
```

This also **defeated the script's own guard**. `ingest_fred_to_dialysis` ends with
`sys.exit(0 if result["total_written"] > 0 else 1)` — a correct, deliberate honest-count check that
**never executes**, because the process dies at import long before `ingest()` is called.

### ⚠️ The 2026-08-07 "recovery" was not the workflow

Alert 308 (95 days stale) was raised and resolved on 2026-08-07, which reads like the workflow
working once. It did not. The only write to `economic_indicators` that day:

| minute | rows |
|---|---:|
| 2026-08-07 **19:59** | 86 |

Workflow runs 3 and 4 finished at **19:47** and **19:55**. Neither overlaps. **The 86 rows came
from a hand-run outside CI.** Every series has been frozen at that write ever since:

| series | max observation | days behind |
|---|---|---:|
| DGS10 | 2026-08-05 | 27 |
| MORTGAGE30US | 2026-08-06 | 26 |
| FEDFUNDS / UNRATE | 2026-07-01 | 62 |
| CPIAUCSL | 2026-06-01 | 92 |

**Durable rule: a green scheduled job that has never moved its output has not been verified, it has
been assumed.** Check the output delta against the run window before reading a run history as
evidence of work — the same rule this repo already applies to workers, applied to CI.

---

## 1. The structural gap

Measured live, 2026-09-01:

| | gov | **dia** |
|---|---|---|
| producer health view | ✅ `v_pipeline_task_health` | ❌ **did not exist** |
| run table | `run_log` (5,813 rows) | `ingestion_tracker` (292 rows) |
| producer-registry objects | ✅ | ❌ **zero** |
| `feed_freshness_registry` | per-feed, graded (B6d) | **5 rows, TABLE-keyed, all `expected_max_age_days = 45`** |

So the only instrument pointing at any dia producer was a **45-day freshness bound on a downstream
table** — a monitor of the symptom standing in for a monitor of the cause. It cannot distinguish
*the producer failed* from *the source published nothing*, which is exactly why the CMS outage ran
65 days.

### ⚠️ Enumerating from the tracker would have rebuilt the blindness

The brief's central trap, confirmed. `ingestion_tracker` shows five distinct `source` values — but
they are not five producers:

| tracker `source` | what it actually is |
|---|---|
| `cms_ingestion` | the real producer ✅ |
| `ingestion_lock` | the **janitor** (78 rows) |
| `CMS` | the **watermark writer** — 50 rows, **all zero-duration, all `rows_upserted` null** |
| `patient_month_backfill` | a one-shot, **1 row**, env-flag triggered |
| `email` | dead since 2026-04-02 (2 rows) |

A tracker-derived registry registers **three CMS-pipeline internals plus a one-shot plus a dead
lane**, and misses **every one of the four real blind producers**. The registry is therefore seeded
from the **schedulers** — Railway cron services, `scripts/cron/*`, `.github/workflows/*`.

### The declared set: 5 scheduled producers, 1 of which can be seen

| producer | scheduler | schedule | emits a run row? |
|---|---|---|---|
| `cms_ingestion` | Railway cron | `0 6 * * *` | ✅ **yes** |
| `public_record_ingest` | Railway cron | `0 7 * * *` | ❌ no |
| `metadata_backfill_queue` | Railway cron ⚠️ **unconfirmed** | (script says weekly) | ❌ no |
| `fred_ingest` | GH Actions | `30 11 * * 1-5` | ❌ no |
| `salesforce_object_sync` | GH Actions | `0 7 1 1,7 *` | ❌ no |

**Four of five write no run ledger at all** — verified by reading the modules, not inferred:
`public_record_ingest.py`, `assessor_enrichment.py`, `ingest_fred_to_dialysis.py` and
`sf_object_sync.py` contain **zero** `ingestion_tracker` / `run_log` writes.

Two further findings from the enumeration:

- **`fred-ingest-daily.yml` is not in `INFRASTRUCTURE.md`'s job map at all** — a scheduled producer
  nobody documented. (That doc's own header is dated *"Last reviewed: 2026-05-16"*; the workflow
  landed 2026-08-07.)
- **`scripts/cron/metadata-backfill-queue.sh` has no documented scheduler.** Its header says
  *"Recommended schedule: weekly (Railway cron)"* and the job map does not list it. Either it is
  scheduled and undocumented, or it was never wired. **Registered with
  `scheduler_confirmed = false`; the operator must confirm in the Railway dashboard.**

---

## 2. What shipped

`supabase/migrations/20260901120000_dia_b6d_cms_escalation_producer_health.sql` (applied live):

- **`dia_producer_registry`** — the declared set, seeded from the schedulers. Two CHECK constraints
  do the honesty work: a producer with `emits_run_row = false` **must** carry a
  `blindness_reason`, and one that claims to emit **must** carry a tracker mapping.
- **`v_dia_producer_health`** — registry `LEFT JOIN` `ingestion_tracker`. A producer with no run
  row **emits a row saying so**; it never vanishes.

### It is a port with a column mapping, and one deliberate divergence

gov's view enumerates *logged* steps, which is sound there because B6a made every guarded step
emit — so the logged set **is** the declared set. **dia has had no such fix**, so an explicit
registry is required. That is the structural difference, and it is why this is not a copy.

Second divergence: gov sizes its expectation purely from **observed** p90 gaps. dia sizes from the
**declared** schedule first, with observed p90 shown alongside as corroboration (B6d's rule).
Observed-only cannot size a producer that has never run — which is four of five here.

| column | why it exists |
|---|---|
| `last_success_at` **vs** `last_rows_written_at` | ⚠️ rule 2e. dia's `success` is not trustworthy. |
| `last_error` **vs** `last_janitor_note` | `error_log` is the **process**'s, `error_summary` the **janitor**'s (B6d-cms-step). Never merged. |
| `expected_max_age_days` + `cadence_basis` | `declared_schedule` / `measured_p90` / **`cannot_be_sized_from_data`** |
| `blindness_reason` | a blind producer states *why* it is blind |
| `severity_rank` | worst first; read this and `status`, never `last_outcome` alone |

---

## 3. First honest run

```
producer_key             status          last_outcome  last_success  last_rows_written  expected  basis
fred_ingest              no_run_ledger   —             —             —                  4.20      declared_schedule
metadata_backfill_queue  no_run_ledger   —             —             —                  21.00     declared_schedule
public_record_ingest     no_run_ledger   —             —             —                  3.00      declared_schedule
salesforce_object_sync   no_run_ledger   —             —             —                  546.00    declared_schedule
cms_ingestion            running         started       2026-04-04    2026-08-31          3.00      declared_schedule
```

Two readings that only exist because the columns were kept separate:

- **`cms_ingestion`: `last_success_at` 2026-04-04, `last_rows_written_at` 2026-08-31.** The
  producer has not recorded a clean `success` since April, yet it moved rows yesterday — via
  `partial` runs. Both facts are true; a single "success" column lies either way. This is rule 2e
  made visible rather than asserted.
- **`p90_gap_days = 30.44` against a declared cadence of 1 day.** The 30-day throttle B6d-cms
  removed is still legible in the run history — a 30× divergence between declared and achieved
  cadence. This is precisely why both are shown.

### ⚠️ `last_error` is blank, and that is stated, not hidden

`error_summary` was NULL on 47 of 47 runs until B6d-cms-step gave it a writer; `error_log` is
populated on 78 rows but historically carries **janitor** text that overwrote the diagnostic slot.
So `last_error` will read thin for a while. **That is honest, and it must not be read as "no
errors."** It fills as B6d-cms-step's channel separation takes effect.

### No alert shipped (rule 2f)

`success` is not yet trustworthy on dia — 50 zero-duration watermark rows wear it, and until
`WATERMARK_RUN_STATUS` reaches the running Railway build they keep doing so. An alerting surface
over that would manufacture false all-clears. **View first; alert when `success` means success.**

---

## 4. Verification

- ✅ **The view lists every scheduled producer**, including four that have never written a run row.
- ✅ **Positive control** — three synthetic producers in a rolled-back transaction:
  `_pc_silenced` (maps to a source last seen 2026-04-02, daily expectation) → **`overdue`,
  `is_overdue = true`, `age_days = 152`**; `_pc_neverran` (claims to emit, no rows) →
  **`never_ran`**; and the **negative control** `_pc_tolerant` — *the same rows*, expectation
  widened to 400 days → **`ok`, `is_overdue = false`**. The detector discriminates; it does not
  merely always fire. **Residue after rollback: 0.**
- ✅ **Honest cadences.** Only `cms_ingestion` has observed gaps (11 observations, p90 30.44). The
  other four report `gap_observations = 0` and are sized from their declared schedule; nothing is
  presented as measured that was not measured.
- ✅ **Guards:** `tests/test_b6d_cms_escalation_producer_health.py` — 14 tests, **14/14 mutations
  verified RED**, comments stripped before matching.

Two guard defects were found and fixed **by the mutation pass**, both from families already
documented:

- ⚠️ **A file-wide grep for `exit 1` passed its own mutation.** `exit 1` legitimately appears twice
  in the FRED workflow — the secrets-verification step and the new fail-on-stale branch — so
  deleting the new one left the guard green. **Re-anchored on the step**, sliced by its `- name:`
  header rather than a line number. (The B6c-dup lesson, recurring.)
- ⚠️ **Comment-stripping is load-bearing here and was verified as such.** The fix's own comments
  name `pipefail`, `postgrest` and every column under test. A dedicated mutation — *remove the
  `set -o pipefail` code, keep every comment that mentions it* — goes **RED**.

---

## 5. FRED workflow fix (the finding)

`.github/workflows/fred-ingest-daily.yml`, three changes:

1. **Install `supabase>=2.13.0`** alongside `requests python-dotenv` — the import chain's real
   requirement, verified in a clean venv.
2. **`set -o pipefail`** before the `| tee` pipeline. This is the durable half: even if the import
   chain grows another dependency, the job now goes **RED** instead of green.
3. **Fail when the watchdog still reports `stale` after a run.** The RPC response was already
   being fetched and printed; the step only warned. Its floor is 10 days, well beyond FRED's
   publication lag, so a weekend cannot trip it.

⚠️ **Not claimed:** the workflow has not been re-run here. The import fix is verified locally
(`IMPORT OK`) and the masking is verified directly (`exit 0` → `exit 1`), but the next scheduled
tick at `30 11 * * 1-5` is what proves it end to end. Expected outcome: either rows land and alert
316 auto-resolves, or the job goes **red** — both are progress over 16 silent greens. The backfill
of the 2026-08-06 → present gap is a `workflow_dispatch` with `observation_start=2026-08-06`.

---

## 6. Named, not built

| id | what | why not here |
|---|---|---|
| **B6d-cms-escalation-emit** | Make the four blind producers emit a run row (port B6a's `record_skip` / `run_guarded_task`). | This is the fix that turns four `no_run_ledger` rows into real monitoring. Doing it for one producer only would be half a pattern; it belongs as one coherent unit. |
| **B6d-cms-escalation-alert** | Alert off `v_dia_producer_health` into `lcc_health_alerts`. | Rule 2f — blocked on `success` becoming trustworthy. |
| **B6d-cms-escalation-metadata** | Confirm whether `metadata-backfill-queue` is wired in Railway. | Operator step; not visible from the repo. |
| **B6d-cms-escalation-infradoc** | `INFRASTRUCTURE.md` job map is missing `fred-ingest-daily` and `metadata-backfill-queue`, and is dated 2026-05-16. | Its staleness is *why* the enumeration had to be done from the repo and not from the doc. |

**The instrument is built and positive-controlled. What it revealed on its first honest run — a
producer green 16 times over while writing nothing — is the point.**
