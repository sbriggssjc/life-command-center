# B6d-cms-step + B6d-pri-reason — the error channel works; the audit was pointed at a decoy column

**Date:** 2026-08-31 · **Repo:** Dialysis · **DB:** Dialysis_DB `zqzrriwuavgrquhisnoa`
**Backlog:** `B6d-cms-step`, `B6d-pri-reason` (bundled) · **Contract:** BUILD-TURN-PROTOCOL, I4

---

## 0. Headline

The brief's central claim — *"`error_summary` is NULL on 47 of 47 runs; the error CHANNEL has never
worked"* — **reproduces exactly and is measuring the wrong column.**

`ingestion_tracker` carries **two** error columns. `error_summary` is **vestigial: no code anywhere
in the repo writes it**, and it appears in no migration. The live column is **`error_log`**, and it
is populated on **18 of 18** `cms_ingestion` failures.

| column | written by | populated on cms_ingestion failures |
|---|---|---|
| `error_summary` | **nothing** (grep: 0 writers) | **0 / 18** |
| `error_log` | `finish_run(error_log=…)` | **18 / 18** |

The three capture paths the brief asks to be built **already exist and all write `error_log`**:
`run_cms_ingestion()`'s `except Exception:` writes **`traceback.format_exc()`**; `_install_termination_handler`
writes on SIGTERM/SIGINT; `_write_step_heartbeat` stamps `notes.current_step`.

**So §4a's prescribed fix is already implemented, and it would have produced nothing** — because
there is no exception. See §2.

---

## 1. ⚠️ Corrections to the brief, each measured

**1a. `error_summary` 47/47 NULL is correct and expected.** It is a decoy. Nothing writes it — the
only repo hits put a value into a `notes` dict or a `details` dict under that *key*, never the
column. Reading a column no writer targets returns a plausible, alarming zero (playbook Class 11:
*the zero is the instrument*). **The positive control is `error_log`, which is 18/18 on the same
rows.**

**1b. The two `started` rows with `finished_at` NULL are LOCK rows, not pipeline runs.** Both are
`source='ingestion_lock'`. This is the footgun already in the Dialysis `CLAUDE.md`: *"`ingestion_tracker`
counts LUMP THE LOCK'S OWN ROWS IN WITH PIPELINE RUNS. Always split by `source`."* Split:

| source | failed | abandoned | recorded | partial | started | success |
|---|---:|---:|---:|---:|---:|---:|
| `cms_ingestion` | 10 | 6 | 3 | 2 | 0 | **0** |
| `ingestion_lock` | 0 | 18 | 0 | 0 | **2** | 2 |
| `CMS` | 0 | 0 | 0 | 0 | 0 | 3 |
| `patient_month_backfill` | 0 | 0 | 0 | 0 | 0 | 1 |

**1c. §2's "six runs reported success while the data did not move" dissolves.** None of the six is
the CMS pipeline: 3 are `source='CMS'`, 2 are `ingestion_lock`, 1 is `patient_month_backfill`.
**Zero `cms_ingestion` runs have reported `success` in the entire window.** There is therefore no
"success on a no-op" defect to fix, and §4d's proposed third defect does not exist. The honest
statement is stronger: *this pipeline has not succeeded once since 2026-06-25.*

**1d. The count of `unknown_reason` rows was 437 in the brief and was 2,148 by the time it was
repaired** — it was growing at ~78/min throughout. See §3.

---

## 2. What actually happens: the janitor overwrites the diagnostic slot

Every populated `error_log` is a **janitor artifact**, not a cause:

```
2026-08-31 18:30:26 → 18:38:16  failed  "Reclaimed by ingestion_lock (force) after 0.1h in 'started'"
                                        notes: {"current_step":"medicare_ingestion",
                                                "heartbeat_at":"2026-08-31T18:38:14.995231+00:00"}
2026-08-27 06:12:43 → 08-28     abandoned "Orphaned run detected: stuck in 'started' for 23.8h"
2026-08-26 06:01:57 → 06:02:06  failed  "Reclaimed by ingestion_lock after 0.0h stale"   ← 9 SECONDS old
2026-06-25 13:29:55 → 19:28:47  partial "Failed steps: run_timeout"                      ← the pipeline's own
```

16 of 18 are janitor; 2 are the pipeline's own (`run_timeout`, June). **The pipeline never got to
write its own** — at the moment the janitor claimed each row it was still `run_status='started'`,
which is precisely the state that says none of the three capture paths ran.

**A SIGKILL leaves no traceback.** That is why two months of failures carry no cause, and it is why
adding exception capture around `medicare_ingestion` cannot produce the line the brief asks for.

⚠️ **The newest row's heartbeat is 2 seconds before it was declared failed** (18:38:14 vs 18:38:16),
and a **new `ingestion_lock` row was created 0.4s after** the reclaim. The run was alive when it was
marked dead; a second invocation force-reclaimed it. `error_log` reading `(force)` is the
`FORCE_RUN=true` self-sabotage the Dialysis `CLAUDE.md` already warns about — **recorded in the
database, and read by the brief as a crash.**

### 2a. ⚠️ Every "failed" run is a PAIR of rows created 27–61 ms apart

`06:01:57.299` **and** `.326`; `06:02:10.859` **and** `.893`; `13:02:32.200` **and** `.261`. One
invocation opens two `cms_ingestion` rows, and the lock sweep then reclaims one of them — so **a
share of the "10 failures" are manufactured by the instrumentation, not by the pipeline.** The
failure count the audit is built on is itself inflated. Sized, not fixed here (**`B6d-cms-doublerow`**).

### 2b. ⚠️ The orphan sweep has no `dataset_id` or `source` filter

`run_cms_ingestion.py:1608` selects **every** row in `started` status table-wide and marks it
`abandoned`. It can reclaim other pipelines' live runs. Sized, not fixed here (**`B6d-cms-orphan-scope`**).

---

## 3. B6d-pri-reason — a placeholder that LATCHES

**437 → 2,148 rows** carrying `reason='unknown_reason'`, `table_name='unknown'`,
`field_name='__record__'`. **The reason was never missing.** Every row's own payload carried it:

```json
"payload": {"pk": "182591", "fields": {
    "reason": "address_change", "table_name": "medicare_clinics",
    "field_name": "address", "address": "7205 DIXIE HIGHWAY",
    "old_value": {"value": "7205 Dixie Hwy"}}}
```

**100% recoverable** — 2,134 of 2,134 candidates resolved to `address_change` / `medicare_clinics` /
`address`.

**Mechanism, reproduced byte-for-byte.** `sanitize_pending_update` runs **twice**:

| pass | `payload` reachable? | result |
|---|---|---|
| 1 — bare record, not yet nested | no → `payload_fields = {}` | stamps `unknown_reason` / `unknown` |
| 2 — assembled row | **yes**, at `payload.fields.*` | `if not p.get("reason")` is **False** → placeholder kept |

The guard was a bare truthiness check, so **a value the function invented blocked the real one it
could now see.** The stored `file_name='auto:medicare_clinics:unknown_reason:noid'` is the
fingerprint: a local two-pass repro emits that string exactly.

**Fix** (`src/logging_helpers.py`): the function's own placeholders are treated as **absent, not as
answers**. `_PU_PLACEHOLDER_REASONS` / `_PU_PLACEHOLDER_TABLES` have one owner; recovery searches
both `payload.fields` and `payload`. **Nothing is fabricated** — a row with no real reason anywhere
still gets the placeholder (negative control asserted).

**Backfill:** `supabase/migrations/20260831190000_dia_b6d_cms_step_recover_pending_reason.sql` —
idempotent, re-runnable, reversible (priors in `notes.prior_*`, runbook in the header).
**Applied: 2,148 rows repaired and marked.** The brief's alternative ("mark them") was not needed —
the real value was on the row.

### 3a. ⚠️ These rows are NOISE, and that is a separate decision — sized, not taken

Read on named rows, every sampled `address_change` is a formatting normalisation, not a decision:

```
470 Bridgeport Ave   → 470 Bridgeport Avenue      4660 Central Wy → 4660 CENTRAL WAY
6 Fwy Dr             → 6 FREEWAY DRIVE            32291 Mission Trl → 32291 Mission Trail
16605 N 28Th Ave     → 16605 NORTH 28TH AVENUE    2814 Lee Blvd   → 2814 Lee Boulevard
```

212 of 1,678 are identical ignoring case+punctuation; the rest are abbreviation expansions. **One
row per clinic**, so it is bounded at ~8,547 — not unbounded — and would reach **~81% of the whole
`pending_updates` queue**. That is the Consumption-Layer noise failure: *never one item per captured
row*. **Value-gating this producer is Scott's call, not mine — filed as `B6d-pri-address-noise`.**
Making them legible was in scope; deciding they should not exist is not.

---

## 4. 🔴 The live finding that outranks both backlog rows

While this was being measured, a process was **writing to `pending_updates` at ~78 rows/min with no
`ingestion_tracker` row at all** (`tracker_rows_since 19:00 = 0`) — invisible to every surface built
on that table — and:

```
max(medicare_clinics.source_last_seen) = 2026-06-25 19:28:32   (unchanged)
clinics refreshed today                = 0
clinics diverted to review             = 2,148 and climbing
```

**It reads CMS, detects a change on each clinic, queues it for review, and never writes the clinic.**
`source_last_seen` — the metric the whole B6d arc verifies on — did not move. **The outage is not
only that runs are killed; when a run does proceed, the feed is converted into review rows instead of
being ingested.** Filed **`B6d-cms-divert`**, and it should be read before anything else in this arc.

---

## 5. What was and was not built

**Built:** the placeholder-latch fix + the 2,148-row reversible backfill + `tests/test_b6d_cms_step_placeholder_latch.py`
(9 tests, **7/7 mutations verified RED**, no-op detection on every mutation).

**Not built, deliberately:** exception capture around `medicare_ingestion` (already exists, would
capture nothing); a `success`/`rows_upserted` reconciliation (§1c — the defect does not exist); the
janitor and orphan-scope fixes (§2a/§2b — they change failure accounting and belong in their own
change, where the numbers they move are attributable).

⚠️ **Two guard defects found and fixed in this session's own tests, both from the repo's documented
families:** a comment-stripper that dropped whole lines containing string literals **deleted the
declaration it was asserting on**, making a real assertion unsatisfiable; and a source assertion
whose pattern contained a string literal (`p.get("table_name")`) **could never match literal-blanked
source and passed its own mutation.** *A stripper has to be chosen to fit what is being matched* —
literal-blanked for prose-sensitive greps, comments-only for patterns containing literals. The
table-name latch is now asserted **behaviourally** as well.

---

## 6. Verification

- ✅ `error_log` is the live channel, 18/18 populated; `error_summary` has **0 writers** repo-wide.
- ✅ Placeholder latch reproduced locally byte-identically (`auto:medicare_clinics:unknown_reason:noid`).
- ✅ Fix verified with negative controls: nothing real is overwritten; nothing is fabricated.
- ✅ 2,148 rows repaired; `unknown_reason` → 4 immediately after (producer still running).
- ✅ 35 tests green across the affected surface. ⚠️ The **full** suite cannot run in this sandbox
  (`flask`, and others, absent) — a pre-existing environment gap, unrelated to this change, and
  therefore **not a clean-suite claim**.
- ⚠️ **`max(medicare_clinics.source_last_seen)` is NOT expected to move from this change**, and did
  not. It is still **2026-06-25**.

**The single line the brief wanted — the exception text from `medicare_ingestion` — does not exist.**
Not because it was dropped, but because the process is killed rather than failing. The next step is
Railway deploy logs (OOM/restart evidence), which `ingestion_tracker` structurally cannot carry.

---

# 7. Second pass (2026-08-31, later) — the latch had two more doors

**Reconciliation first.** Everything in §0–§6 shipped in a parallel window as `68da552` and merged as
PR #7381; this branch equals `origin/main`, so none of it was re-done. What follows is what
**re-measuring afterwards** found, and it corrects two claims made above.

## 7.1 ⚠️ The "success on a no-op" defect DOES exist — §1 dismissed it on a true fact

§1 recorded: *"none of the 6 success runs is `cms_ingestion` — that pipeline has NEVER reported
success in the window, so the proposed 'success on a no-op' defect does not exist."* **Both halves of
the premise are correct and the conclusion is wrong**, because the reader does not filter on `source`:

```sql
-- get_last_ingestion_meta(), reproduced exactly
select ... from ingestion_tracker
 where dataset_id = 'cms_medicare_clinics'
   and run_status in ('success')        -- INGESTED_RUN_STATUSES
 order by started_at desc limit 1;
```

Live, that returns **`source='CMS'`, zero duration (`finished_at = started_at`), `rows_upserted`
NULL, `rows_inserted/updated/skipped = 0`, `dataset_modified_date = 2026-08-31 18:38:17`.**

So the watermark behind **both** change-detection skip-gates is, right now, a row that moved nothing.
Splitting by `source` was the correct instinct — it is what killed the "6 failed runs" inflation —
but the pipeline's own reader does not make that split, so a row filed under another `source` is
still this pipeline's watermark. **Split by the key the CONSUMER uses, not the one that best
explains the population.**

`set_last_run()` writes that row, hard-coding `"run_status": "success"` with `started_at ==
finished_at` and no counts. It is a **dataset-version stamp, not a run outcome** — and its own
docstring described a `run_successful=True -> 'success'` mapping the function has never had.

**Fixed** by giving the stamp its own status (`WATERMARK_RUN_STATUS = "watermark"`), which is in
`INGESTED_RUN_STATUSES` so the gate arms exactly as before. This is the §4d "introduce a distinct
outcome" branch, deliberately **not** the "tie it to `rows_upserted > 0`" branch: that would blank
the watermark (every historical `CMS` row has `rows_upserted` NULL), fail open, and re-ingest daily
— a behavioural change nobody has graded, and out of scope for a prompt whose §4e says it does not
fix the hang. The residual — *should a completed run that changed nothing arm the gate at all?* — is
filed as **B6d-cms-step-noop**, not silently taken.

## 7.2 ⚠️ B6d-pri's own comment is false in effect

`run_cms_ingestion.py` states, of the skip row it writes:

> `status='recorded'` … is deliberately NOT in `INGESTED_RUN_STATUSES`, so these rows can never
> re-arm the change-detection watermark the way a crashed run did (B6d-cms).

The row itself is correctly excluded. But the **same invocation** wrote the `CMS`/`success` row 0.4 s
earlier carrying the **identical** `dataset_modified_date`, and that one passes the filter. The fact
was laundered into the watermark through a second row under a different `source`. **An exclusion is
only as strong as the set of rows that can carry the same fact** — closing one door while a sibling
writer holds another open is the P157/P182 shape one layer up.

## 7.3 ⚠️ The reason was discarded on a channel the fix did not cover — 470 rows

§3's fix recovers a real reason from `payload` / `payload.fields`. It cannot help when the real
reason never reaches the payload at all, because it arrives as a **function argument**:

```python
# log_pending_update(), pre-fix
reason_value = str(update_data.get("reason") or reason or "").strip()
```

`or` takes any truthy payload value first — **including a placeholder an earlier pass stamped** — so
`'unknown_reason'` outranked the caller's real reason. Measured on the 470 residue rows: `reason` is
the placeholder at **column, `payload`, and `payload.fields` level simultaneously**, while their
producers pass real values (`reason="clinic_removed"`, `reason="status_unknown"`,
`reason="Unmatched CMS clinic - needs review"`, plus per-branch `notes`). §3 of this document is
literally right — *"the writer knows why it is queuing — that knowledge is being discarded at the
last step"* — it was just discarded one function further out than the fix reached.

**Fixed** by hoisting `_first_real` out of `sanitize_pending_update` to module scope
(`_pu_first_real`) and resolving `reason_value` through it across **both** channels. One
implementation, one vocabulary — the nested copy now delegates rather than being duplicated. When
neither channel carries a real value the original expression still runs, so a genuinely reasonless
write is unchanged and **nothing is invented**.

## 7.4 The janitor still owned `error_log` — `error_summary` now has its first writer

§2 diagnosed this precisely and did not change it. It is changed now, and the fix is the one §1's
"decoy column" finding hands you: the janitor is an **outside observer** — it did not run the job and
knows nothing about why it died — so its verdict belongs in `error_summary`, and `error_log` is
reserved for the process (its `except` handler and `_install_termination_handler`). Both janitors
moved (`ingestion_lock.acquire_ingestion_lock`, the orphan sweep in `run_cms_ingestion`).

The decoy stops being a decoy and the two columns state two different facts:

| column | owner | meaning |
|---|---|---|
| `error_log` | the process | its own traceback / termination signal |
| `error_summary` | the janitor | an external verdict about a row it reclaimed |

## 7.5 Data: the queue is legible for the first time

The §3 migration is idempotent and its header says to re-run it once the producer stops. It stopped
(last placeholder write **20:25:49**), so it was re-run.

| | before | after |
|---|---:|---:|
| `address_change` (real reason recovered) | 2,148 | **5,102** |
| `unknown_reason` | 3,424 | **0** |
| `producer_supplied_no_reason` | — | **470** |
| `table_name = 'unknown'` | 470 | **0** |

Predicted 2,954 repairable / 470 not; **got exactly that**. The 470 are marked, not repaired:
migration `20260831230000` recovers their `table_name` (`medicare_clinics`, real in the payload,
one distinct value across all 470) and replaces the ambiguous placeholder with a
**provenance statement, not a reason** — `producer_supplied_no_reason` deliberately does not read
like one so it can never be mistaken for recovered content. Reversible by its batch tag.

⚠️ **`field_name` stays `__record__`, deliberately.** The payload says `status`, so it looks equally
recoverable — but `__record__` is a live **sentinel** elsewhere (`clean_pending_updates.py:212`,
`is_match_record`, `analyze_counts_pending.py`) and rewriting it changes how those consumers classify
the row. Sized and named: **B6d-cms-step-field**.

## 7.6 ⚠️ The watermark value itself looks clock-derived — named, not asserted

`dataset_modified_date = 2026-08-31 18:38:17` is **one second after** the 18:30 run was reclaimed
(18:38:16.10), and the *patient-counts* skip row 0.4 s later carries the **identical** value despite
describing a different dataset. Meanwhile CMS's own published timestamp is captured on
**3 of 193** `cms_dataset_updates` rows, the newest from **2026-03-24**.

That is consistent with a local clock/mtime rather than a CMS publish date — which would mean the
gate is armed with a stamp CMS must beat before we ingest again. **I could not prove the code path
without CMS egress, so this is recorded as a risk, not a finding: B6d-cms-step-watermark-clock.**
Related and separate: `_log_ingestion_row` hard-codes `dataset_id='cms_medicare_clinics'` while the
patient-counts skip path passes it the **`cms_patient_counts`** signature — a cross-dataset stamp
that is harmless today only because `recorded` is excluded from the watermark.

## 7.7 Verification

- ✅ Zero regressions, established by **baseline diff**, not by assertion: full suite before/after
  the change produced an identical failure set (53 pre-existing, all environmental — `flask`,
  `openpyxl` and friends absent from this sandbox). The only differences are the four new/updated
  guards, RED on pristine source and GREEN on fixed — which is their positive control.
- ✅ **11 of 11 mutations RED**, including *"the janitor note was reworded"* so the guard cannot go
  vacuously true, and *"a second placeholder vocabulary was introduced"*.
- ✅ Guards assert on the **AST**, never raw source. The fixes' comments quote `error_log`,
  `"success"` and the old `or` expression while explaining them, so a textual grep would match the
  prose and pass over a regression. Python comments are absent from the AST by construction — this
  removes the stripper-bug class (A5c / N18 / B6d-pri-reason) rather than working around it.
- ✅ Three prior-window guards went red and were established **stale, not breached**, before being
  touched: each pinned a literal (`INGESTED_RUN_STATUSES == ("success",)`, `sink[0]["error_log"]`)
  while its stated intent survives. Rewritten to assert the intent; the reclaim guard was
  *strengthened* to assert `error_log` is not written.
- ⚠️ **Still no exception text, and that verdict is unchanged.** The 2026-08-31 18:30 run reproduces
  the §2 shape exactly: heartbeat at 18:38:14.99 on `current_step: medicare_ingestion`, declared
  failed at 18:38:16.10 by a **`(force)`** reclaim — alive 1.1 s earlier. It was killed, and
  force-reclaimed by a second invocation. `ingestion_tracker` structurally cannot carry an OOM;
  **Railway deploy logs remain the next step.**
- 🔴 **The outage broke open on its own during this work**: `max(medicare_clinics.source_last_seen)`
  moved **2026-06-25 → 2026-08-31**, first movement in 67 days. ⚠️ **The count was still CLIMBING
  while this was written — 61 → 84 → 163 of 8,547 across three measurements in one session — so
  quote it with its timestamp or not at all.** Even at 163 that is **1.9%**: the pipeline can write
  again; the feed is not healthy. Note the last clinic write
  (21:22) is an hour *after* the last `ingestion_tracker` row (20:25), so that work carries no run
  record at all.
