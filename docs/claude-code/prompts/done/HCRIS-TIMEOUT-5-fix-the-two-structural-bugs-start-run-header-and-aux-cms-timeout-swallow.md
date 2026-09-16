# HCRIS-TIMEOUT-5 — fix the two structural bugs `HCRIS-TIMEOUT-4` found: `start_run()`'s discarded run id, and `aux_cms_tables`'s swallowed step-timeout

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention. **Fifth round — the first fix round since `HCRIS-TIMEOUT-4`'s triage isolated two structural
bugs, neither one specific to HCRIS.** Fix both. Do not stop at a partial fix or re-open the triage — the
diagnosis is done; this round is about making the two named bugs behave correctly and proving it live.

## 0. What's confirmed, going into this round

`HCRIS-TIMEOUT-4` (independently live-verified by Cowork) found:

1. **`ingestion_tracker.start_run()` discards its own run id on every call.** `get_supabase_client()` sets a
   client-wide default `Prefer: return=minimal` header; `core_utils.safe_execute()` only overrides it to
   `return=representation` when handed a live query-builder object, not a pre-built `.execute()` closure.
   `start_run()` passes a bare lambda, so a genuinely successful insert (HTTP 201) comes back with an empty
   body, reads as failure, and returns `None`. Confirmed live: `ingestion_tracker.notes` has been `'{}'` on
   every `cms_medicare_clinics` row since at least 2026-08-31 (2+ weeks before this arc started), and the same
   call site inside `acquire_ingestion_lock()` orphans every ingestion-lock row every run (`593e1e75…`/run 1
   and `64e34e14…`/run 2 confirmed live, both `dataset_id='facility_patient_counts'`).
2. **`aux_cms_tables` (step 3 of ~15) swallows its own step-timeout.** `ingest_cms_aux_tables()`'s per-row
   `except Exception:` catches the `SIGALRM`-based `StepTimeout` (a `TimeoutError` subclass) when it fires
   mid-row, logs it as an ordinary row failure, and the loop continues — `signal.alarm()` is one-shot, so
   nothing re-arms the guard. The pipeline never advances past step 3, so it never reaches `hcris_cost_reports`
   (step ~8) — confirmed via the exact timeout message (`"step 'aux_cms_tables' exceeded 900s"`, logged
   2026-09-15 17:52:36 UTC, ~15 min after run start) and via `facility_cost_reports` remaining frozen at
   2026-03-16 through every observed run since.

**One open sub-question `HCRIS-TIMEOUT-4` did not resolve, and this round should before finalizing the fix
for (2):** Cowork's independent live re-check found **zero `ingestion_run_errors` of any kind for ~12h09m**
between the two runs' own 15-minute startup bursts (17:53:00–06:02:00) — total silence, not the continuous
"keeps going obliviously" activity `HCRIS-TIMEOUT-4`'s response implied. Determine which is actually
happening: does `aux_cms_tables` genuinely keep executing row-by-row after the swallowed timeout (just not
hitting tables that log to `ingestion_run_errors`), or does something about signal delivery mid-blocking-call
leave the process fully hung/deadlocked with no further progress until it's externally reclaimed? The correct
fix may differ depending on the answer (a live loop needs the timeout to actually interrupt it; a hang needs
the underlying blocking call identified and bounded, not just the exception handling fixed).

## 1. The fix

**(a) Fix `start_run()`'s response handling — once, at the source, not per caller.** Either make
`safe_execute()`'s convenience-lambda path also request `return=representation` (so the closure's `.execute()`
call actually gets a body back), or change `start_run()` to pass a builder object `safe_execute()` can attach
the header to itself, or read the inserted row back explicitly if the client genuinely can't be made to return
a body inline — whichever is the smallest, most reusable change. **This one fix should repair every caller**:
`start_run()` itself, `acquire_ingestion_lock()`, and the other named call sites (`main.py:3177`,
`run_cms_ingestion.py:852/1786/1833`) — confirm each of those sites actually benefits from the fix rather than
needing its own patch, and say so plainly either way.

**(b) Fix `aux_cms_tables`'s swallowed timeout.** `StepTimeout` (or `TimeoutError` generally) should not be
caught by the per-row `except Exception:` blocks in `ingest_cms_aux_tables()` — re-raise it (or catch it
specifically, one level up, before the per-row handlers get a chance) so the step timeout actually terminates
the step instead of being logged as an ordinary row failure. Before finalizing this fix, answer the open
sub-question in section 0: reproduce or otherwise determine whether the current (buggy) behavior is a live
loop or a hang, and say which one it is with evidence — this affects whether re-raising `StepTimeout` alone is
sufficient or whether there's also an underlying blocking call that needs its own bound.

**(c) Regression tests for both**, matching this arc's established bar: a test that simulates a `.execute()`
call whose successful response has an empty body and confirms `start_run()`/`acquire_ingestion_lock()` now
extract a real run id; a test that simulates `StepTimeout` firing mid-row inside `aux_cms_tables()`'s loop and
confirms the step actually terminates rather than continuing.

**(d) Real live proof — the bar this arc has held for five rounds now.** Trigger or wait for a subsequent run
and report, from the database directly: does `ingestion_tracker.notes` for that run finally show non-`'{}'`
content; does the ingestion lock for `facility_patient_counts` close cleanly instead of being orphaned; does
the run actually advance past `aux_cms_tables` (check `run_log`/whatever step-progress signal now exists); and
does it reach `hcris_cost_reports`/`hcris_propagation` and does `facility_cost_reports.updated_at` finally
advance past 2026-03-16. If the run still doesn't get that far because of a *different* defect further down
the pipeline, say so plainly and name it — don't claim success on this round's two bugs alone if the
end-to-end symptom (`facility_cost_reports` updating) still hasn't moved.

## Out of scope

- `HCRIS-QIP-DEFICIENCY-TIMEOUT-PATTERN` — still correctly deferred until the pipeline can actually reach that
  far; don't fix it opportunistically this round even if it's easy, since it can't be proven live yet.
- `DEED1`/`DEED1-reconcile`/PR #7412 — entirely unrelated, don't touch.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.

## Verify on

- (a): the fix described plainly (what changed, why it repairs every caller), plus a plain statement of
  whether each of the four named call sites actually benefits or needed its own patch.
- (b): the fix, plus a direct, evidenced answer to the loop-vs-hang question — not assumed either way.
- (c): real tests exercising the actual failure shapes (empty-body success response; mid-row `StepTimeout`),
  not generic mocks.
- (d): live proof from an actual subsequent run, including an honest report if the end-to-end symptom still
  hasn't resolved because of something further down the pipeline.
