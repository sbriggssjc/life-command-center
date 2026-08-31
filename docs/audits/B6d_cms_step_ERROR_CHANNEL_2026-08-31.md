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
