# HCRIS-TIMEOUT-6-not-a-hang-a-slow-unbatched-propagation-step-that-never-hands-off-to-finish_run — response (transcribed 2026-09-16)

> Recovered from Scott's own saved transcript (`"HCRIS TIMEOUT 6 surface response.docx"`, untracked,
> `docs/claude-code/responses/`) — same recovery method as the rest of this arc. **Repo: `Dialysis`. No live
> proof was attempted this round — disclosed plainly by CC, not claimed.** Code-level claims are not
> independently verifiable from this session (no `Dialysis` GitHub access, confirmed unavailable throughout
> this arc). **PR merge status unconfirmed as of this write-up — asked Scott directly below.**

## What CC reports

**Root cause, confirmed against the actual deployed code** (not re-described from intent): `propagate_financials()`
in `src/propagation_utils.py` does 2 sequential Supabase round trips per property (`SELECT` + `UPDATE`) inside a
plain per-row loop — the exact N+1 shape this session's independent live check inferred from the ~2 sec/property
rate. Its `except Exception:` swallows `StepTimeout` (the `TimeoutError` subclass `signal.alarm()` raises at the
900s per-step budget) — since the alarm is one-shot, swallowing it once permanently disarms timeout enforcement
for the rest of the step, turning a 15-minute budget into the unbounded 4h18m run this session observed. That
overran the whole-run 90-minute budget, which is only checked *between* pipeline steps (confirming this
session's guess in the `-6` prompt) — so every step after `patient_counts`, including `hcris_cost_reports`, was
silently skipped once control finally returned to the outer loop. The missing `finished_at`/error-log row is
attributed to a platform-level kill (Railway) landing before Python could finalize — CC notes the existing
SIGTERM handler's own comment already acknowledges it can't cover SIGKILL, rather than presenting this as
newly discovered.

**Fixes applied** (branch `claude/hcris-timeout-6-8f3k2a`, PR `sbriggssjc/Dialysis#7417`):

1. `except TimeoutError: raise` added before the generic handler in `propagate_financials()`, plus 3 more
   instances of the identical swallow in the same call chain (`_resolve_property_id_for_financials()`, and both
   call sites in `patient_count_ingestor.py`).
2. A batched prefetch (`prefetch_properties_for_financials`, chunked `.in_()` SELECT) wired into the
   patient-counts loop — cuts the SELECT side from O(n) to O(n/chunk_size) round trips. **The UPDATE side was
   left per-row**, disclosed as a deliberate scope call (batching it safely would need a larger rewrite of the
   shared write path) rather than silently left half-done — a safe fallback (any id missing from the prefetch
   map still gets its own SELECT) covers the gap.
3. No new `STEP_TIMEOUT_OVERRIDES` entry — reasoned as unnecessary now that the timeout will actually fire and
   abort correctly, rather than added reflexively.

**Tests**: 16 new (proving the re-raise at every touched site, and the batching call-count behavior). Full
suite: 3,292 passed, 1 pre-existing unrelated failure (already present on `main`, consistent with every prior
round's disclosure of the same failure).

**Live proof: explicitly not attempted, disclosed as a caveat rather than skipped over.** CC states plainly
this only manifests under real multi-hour Supabase/Railway timing, so proving it live means watching the next
scheduled run die cleanly at ~15 minutes (a real `StepTimeout` in `ingestion_run_errors`) instead of running for
hours — the unit tests prove the swallow mechanism is gone, not the live timing. This matches this session's own
`-6` prompt request for an honest statement of what live proof requires, given the step's own multi-hour
runtime makes "trigger and wait" expensive.

## Independent verification performed by this session

- **Code-level claims not independently checkable** — no GitHub access to `Dialysis` from Cowork (unchanged
  throughout this arc).
- **The mechanism CC describes is consistent with, and directly explains, everything this session found live
  in the prior round**: the ~2 sec/property rate, the 6,879-property total, the run stopping within a minute of
  its last property write, the complete absence of any `ingestion_run_errors` row, and the tracker's `notes`
  staying `'{}'` — all of that lines up with "the alarm fired once, got swallowed, and the loop kept running
  unbounded until something outside the app (Railway) ended the container." Nothing in CC's account contradicts
  the live evidence gathered before this prompt was even written.
- **Open question for Scott, not resolved by this session**: PR `sbriggssjc/Dialysis#7417` — merge status not
  yet stated. This arc has hit the PR-merge-ambiguity pattern before (`PRI6`, `HCRIS-TIMEOUT-3`, `HCRIS-TIMEOUT-5`)
  and asks directly rather than assuming: **is #7417 merged and redeployed?**

## Delivery

Code changes in `Dialysis`, not `life-command-center`. **PR `sbriggssjc/Dialysis#7417`
(`claude/hcris-timeout-6-8f3k2a`) — merge status needs confirmation from Scott.** Once confirmed merged and
redeployed, the next live test (per CC's own honest caveat) is watching a fresh run **fail fast and cleanly**
at ~15 minutes with a genuine `StepTimeout` logged to `ingestion_run_errors` — a very different, much cheaper
signal to watch for than another multi-hour run. `HCRIS-TIMEOUT` stays 🔴 until that's observed.
