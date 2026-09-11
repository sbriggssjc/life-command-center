# PRI4-preflight-abort-hang-and-uncovered-call-site — response (transcribed 2026-09-11)

> Recovered from Scott's own saved transcript (`PRI4 surface response.docx`, untracked,
> `docs/claude-code/responses/`) — same recovery method as the rest of this arc. **Repo: `Dialysis`.
> This session verified this against the transcript AND an independent live query against
> `ingestion_tracker` in Dialysis_DB — one claim in the response (1b) does not hold up against that live
> check, flagged plainly below rather than glossed over.**

## Session framing

Handled by a background agent in the `Dialysis` repo. Branch `claude/inspiring-feynman-y8l6mh`, commit
`692d92c`, pushed. The session closes by referencing `sbriggssjc/Dialysis#7407` as the tracking PR going
forward — **this confirms the PR exists, not that it's merged.**

## (a) `facility_patient_counts`'s uncovered preflight call site — fixed, and the real location corrected

The response corrects the prompt's own framing: the actual no-retry call is in
`src/health.py::preflight_health_check` Step 1/4 (fed by `preflight_checks.py`'s "RPC execute_sql probe
succeeded" line just before it in the logs), not `preflight_checks.py` itself — a bare `.execute()` in a
generic try/except, no `safe_execute()`. Fixed by routing it through `core_utils.safe_execute()`, the
same helper `PRI3` used. **Also applied the same fix to Steps 2/3 of that function and to two more
unguarded probes found in `preflight_checks.py` along the way** — a broader sweep than the prompt
literally asked for, in the right direction.

## (b) The `ingestion_tracker` row never closing — mixed finding, and one claim contradicted by a live check

The response reports a **mixed** result: the abort branch matching the prompt's exact symptom
(`preflight_health_check` failure) was, per the code read, **already calling
`finish_run(run_status="aborted")` before the print** — implying that branch's tracker row should have
closed correctly already. A **second**, separate abort branch (`has_blockers`) had no tracker close-out
at all, and that one was fixed.

**This session independently re-queried `ingestion_tracker` live before writing this up, and the claim
above does not hold for the actual run this prompt was built from.** The exact row this arc has been
tracking (`id c6975255-6224-401a-8144-695ee938d78f`, `started_at 2026-09-11 15:53:15.083884 UTC`) is
still `run_status='started'`, `finished_at=null`, **now 1.5+ hours later** — not closed, despite the
response's claim that this exact failure branch already calls `finish_run()`. Two explanations are
consistent with everything observed, and this session cannot distinguish between them from here: either
the code path described doesn't actually match what executed in this specific production run, or (more
interesting, and consistent with (c) below) **`finish_run()`'s own call itself silently hung or failed
under the same connection instability that caused the original preflight failure** — which would tie (b)
and (c) together as one root symptom rather than two separate ones. Flagging this discrepancy explicitly
rather than accepting the response's "already correct" framing at face value.

## (c) The hang itself — root cause not proven, but a real, concrete, and plausible defect found and mitigated

Could not prove the exact stuck call without attaching to the live process (not possible from this
session — the prompt's ask to try a thread dump or Railway shell attach went unmet, stated honestly as
such rather than glossed over). **Did find a genuine, separate defect in `core_utils.safe_execute()`
itself**: its timeout only stops *waiting* on the future — the underlying `ThreadPoolExecutor`'s own
`__exit__` (`shutdown(wait=True)`) then blocks again on the same stuck worker thread, **silently
defeating the timeout it just enforced**. Stated plainly as the strongest candidate, not a confirmed
cause. If real, this is a significant finding — it's a plausible mechanism for the same "idle window"
pattern seen in `PRI1`'s own still-unanswered Unit 4 question (the 5-hour gap between crash and
"Stopping Container") and now in this run's 90+-minute hang, i.e., a shared explanation across multiple
rounds of this arc's mysteries, though this session has not independently verified that connection.

**Mitigation applied regardless of root-cause confirmation** (matching the prompt's explicit ask for a
concrete mitigation even if the cause can't be pinned down): abort/cleanup now runs on a daemon thread
with a bounded `join(timeout=60s)`, followed by `os._exit(2)` — bypassing `atexit` handlers and any
thread-join deadlock entirely, so the process terminates no matter what's actually stuck underneath.

## (d) Safe to kill the live hung deployment — yes, confirmed

By the time the "preflight abort" summary prints, the tracker row is already closed (per the response's
own claim — see the (b) caveat above) and no ingestion work has started (no `begin_run()`, no writes) —
killing the deployment leaves no partial state.

## Test results

New `tests/test_pri4_preflight_hang_guard.py`: 13/13 passing. Adjacent suite (preflight + `PRI3` + CMS
abort paths): 106/106 passing. **Full-suite follow-up, reported separately after the initial summary**:
**3222 passed** (up from `PRI3`'s 3183), 9 skipped, 1 xfailed, 0 failed — including the new `PRI4` tests,
no regressions from the `health.py`/`preflight_checks.py`/`run_cms_ingestion.py` changes.

## Open items for the next round

1. **`sbriggssjc/Dialysis#7407`'s merge status is unconfirmed** — same pattern as `PRI3`'s `#7406`. The
   transcript only confirms the PR exists and is being tracked, not that it's merged. Asked Scott to
   confirm directly before treating this fix as deployed.
2. **The (b) discrepancy above** — worth a second look once merge status is confirmed and, ideally, a
   clean test run past preflight to see whether a fresh run's tracker row now closes correctly in
   practice, not just per the code's stated logic.
3. **(c)'s root cause remains genuinely unconfirmed** — the `ThreadPoolExecutor.shutdown(wait=True)`
   theory is plausible and the mitigation (daemon thread + bounded join + `os._exit(2)`) should prevent
   the symptom regardless of whether that theory is exactly right, but this session has not verified it
   against a live reproduction.
4. **`PRI3`'s original live-fix proof is still outstanding** — this round's fixes are all in the preflight
   path; a clean run that gets all the way past preflight is still needed to prove `oig_leie_ingestor`,
   `ownership_linker`, `utils_shared`, and `ingestion_tracker.start_run`'s retry logic live in production.
