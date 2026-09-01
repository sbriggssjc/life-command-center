# B6d-assessor-marker — give the assessor drain a trace, then read it

**Repo: `dialysisproject` (Dialysis).** DB: **Dialysis_DB `zqzrriwuavgrquhisnoa`**.

## The finding this comes from

`python -m src.assessor_enrichment --from-queue 25` was run manually on 2026-09-01 — its first
execution ever — and returned:

```
{ "processed": 25, "enriched": 0, "fields_updated": 0, "errors": 0,
  "source": "queue", "elapsed_sec": 114.8 }
```

Verified live afterwards:

| probe | result |
|---|---|
| `attempts > 0` in `property_metadata_backfill_queue` | **0 of 1,365 rows** |
| `last_attempt_at` / `last_error` set | **0 / 0** — the columns exist and *nothing has ever written them* |
| open-row gaps | `land_area` 409 · `year_built` 404 · `building_size` 108 · `tenant` 95 — **unchanged** |
| `properties` rows written by the run | **0** |
| `max(enqueued_at)` | **2026-05-21** — one-shot, no enqueuer |

**114.8 s / 25 = ~4.6 s per property.** That is real elapsed work, so the worker is reaching
*something* — but it records nothing on **either** outcome.

## What is being asked

**Only the marker. Do not schedule anything. Do not build an enqueuer. Do not "fix" the yield.**

The blocking problem is not that the yield is zero — it may legitimately be zero. It is that
**"the assessor has no coverage for these parcels" and "every call is failing" are currently
indistinguishable**, and they have opposite remedies (retire the lane vs. fix the adapter).

### Unit 1 — record the attempt and the reason, on every row, on both outcomes

Per property processed, write to `property_metadata_backfill_queue`:

- `attempts = attempts + 1`
- `last_attempt_at = now()`
- `last_error` — **the reason, on the empty path too, not only on an exception.** Distinguish at
  minimum: the request was never made (and why — no county adapter, unsupported state, missing
  parcel id), the request was made and the source returned no record, the source returned a record
  carrying none of the requested fields, the request failed (HTTP status / exception class).
  ⚠️ **A single label covering two of these is the P181 defect** — a genuine "no coverage" and a
  hopeless "no adapter" must not wear the same string.
- On a genuine fill: `status`, `resolved_at`, and the fields actually written.

**Design notes, from what this repo has already paid for:**

- ⚠️ **Dated and expiring** (P136). A parcel checked-and-empty today may be resolvable later; the
  marker must let the row re-enter selection after a stated interval rather than excluding it
  forever. State the interval and why.
- ⚠️ **The selection must READ the marker**, or the marker changes nothing — `--from-queue N` must
  prefer never-attempted rows, then least-recently-attempted, and must be able to page. Verify by
  the identical-ids test: **two consecutive runs of 25 must not return the same 25 rows.** That
  test is the deliverable, not a nice-to-have.
- **Both branches write** (B6a's `record_skip` lesson): a row the worker decides to skip must emit,
  never vanish.

### Unit 2 — re-run 25 and report the reason distribution

Then run `--from-queue 25` twice and report:

1. The `last_error` reason distribution across the 25.
2. Proof the second run selected **different** rows.
3. Whether `enriched` moved at all.

**Then give a verdict with the reasons attached: retire the lane, or name the adapter fix.**
⚠️ **Judge the marginal yield, not the raw gap count** — **703 of the original 1,365 rows (51%)
reached `captured` with 0 attempts**, i.e. they self-resolved through other ingestion paths. The
question is what the assessor adds *beyond* that, not how many gaps exist.

**A verdict of "retire it" is a perfectly good outcome and should be stated plainly if the reasons
support it.** A documented ceiling beats a job that runs weekly and produces nothing — and the ~646
genuine remaining gaps then stay open for a different source rather than being falsely owned.

## Guardrails

- **Do not add a cron.** The sequence is strict and the schedule is last:
  **marker → verdict → producer → cron** (backlog B6d-assessor-marker / -verdict / -producer).
  The queue has no enqueuer (`max(enqueued_at)` = 2026-05-21), so a schedule would drain 662 rows
  once and run empty forever regardless of what the marker finds.
- ⚠️ **The Dialysis repo's `ci.yml` cannot fail** — `|| echo` used 5×, so 3,042 collected tests are
  not enforced by any merge gate (backlog **B6e-ci-mask**). **Do not touch the masking here**, and
  do not rely on CI to catch a regression: run the tests locally and say so.
- **Assert on the state delta**, never on the worker's own tally: `attempts` per row,
  `last_error` populated, distinct row ids across two runs, `properties` fields actually written.
  ⚠️ `errors: 0` alongside `enriched: 0` is exactly what this job already reports while doing
  nothing.
- Never fabricate a field value the source did not state.

## Report back

The reason distribution, the two-run distinct-ids proof, the verdict (retire / fix, and which
adapter), and anything the sweep turned up that outranks the task.
