# Claude Code (DialysisProject) — CMS ingestion hang-guard (fail-fast + self-diagnosing)

## Why (grounded live on the dia DB `ingestion_tracker`, 2026-06-23)
The CMS ingestion is automated (Railway cron → `scripts/cron/cms-ingestion.sh` →
`python -m src.run_cms_ingestion`). The cron **fires, but runs HANG**: last clean `success` =
**2026-05-13**; the 2026-06-13 runs (`cms_medicare_clinics`, `facility_patient_counts`) got
**stuck in `'started'` for 9-24h and were marked `abandoned`/orphaned** by the lock-reclaim. So
no run has completed since May 13 — each daily tick reclaims the prior orphan, starts, hangs,
dies. Downstream: stale Top Movers, stale inventory deltas, stale freshness on the dia Overview.

Root cause: `run_cms_ingestion` runs its `steps` loop (`src/run_cms_ingestion.py` ~609-746) with
a per-step `try/except` that catches *raised* errors (→ records a failed step, continues) — but
there is **no per-step timeout**, so a step that *blocks forever* (a network/CMS/OpenAI call
with no timeout) hangs the whole run. The `ingestion_tracker` row stays `'started'` until Railway
hard-kills the process (no clean finish), leaving the orphan. The lock-reclaim works (not
blocking), so this is purely: **make a hung run fail fast and record WHERE it hung.**

## Goal
A stalled run should (a) **fail fast** (minutes, not 24h), (b) **record which step stalled**, and
(c) leave the `ingestion_tracker` row in a terminal `failed`/`partial` state (never a silent
`'started'`). No behavior change on a healthy run. Prod is Linux (Railway + GH runner), so
`signal`-based timeouts are fine.

## Unit 1 — hard per-step timeout (the core fix)
In `run_cms_ingestion`'s steps loop (`src/run_cms_ingestion.py` ~679-746): wrap each `func()`
call in a hard timeout so a hung step raises `TimeoutError` and is caught by the **existing**
per-step handler (recorded as a failed step, loop continues).
- Implement a small `run_with_timeout(name, func, seconds)` helper using `signal.SIGALRM`
  (main-thread, Unix — the prod environment). On expiry raise
  `TimeoutError(f"step '{name}' exceeded {seconds}s")`; **always** clear the alarm in a `finally`.
  Guard for non-main-thread / non-Unix (fall back to no-timeout with a logged warning) so local
  dev on Windows/threads doesn't break.
- Per-step budget from env **`CMS_STEP_TIMEOUT_SEC`** (default **900** = 15 min; a healthy step
  finishes in seconds-to-minutes). Allow a per-step override map if some steps legitimately run
  longer (e.g. the full medicare_ingestion) — keep it simple: one global default is fine for v1.
- The existing `failed_steps` detection + `finish_run(status=...)` then records the timed-out
  step as failed and the run as `partial`/`failed` — terminal, not stuck.

## Unit 2 — heartbeat (record WHERE it stalled)
Before each step runs, write a lightweight heartbeat to `ingestion_tracker` so even a hard SIGKILL
leaves a breadcrumb:
- Update the current run's row (`_CURRENT_RUN_ID`) with `notes->>'current_step' = <name>` and a
  `notes->>'heartbeat_at' = utcnow()` (or a dedicated column if cleaner) **before** invoking the
  step. Best-effort: wrap in try/except so a heartbeat write failure never aborts the run.
- This makes a future hang self-diagnosing: the row shows the last step entered + when, instead of
  an opaque "stuck in 'started'".

## Unit 3 — terminal status on signal / global cap
- **SIGTERM/SIGINT handler:** install a handler that, on receipt (Railway sends SIGTERM before the
  SIGKILL grace), calls `finish_run(status='failed', error=f'terminated during step <current>')`
  for `_CURRENT_RUN_ID` then re-raises/exits. Can't catch SIGKILL, but SIGTERM covers the normal
  Railway/GH shutdown path → no more silent `'started'`.
- **Global wall-clock cap** from env **`CMS_RUN_TIMEOUT_SEC`** (default **3000** = 50 min, under
  the 60-min Railway/GH ceiling): if the whole run exceeds it, finish `failed` with
  `error='run exceeded CMS_RUN_TIMEOUT_SEC at step <current>'` and stop. Belt-and-suspenders over
  the per-step timeout.

## Unit 4 (optional, low-risk) — tighten orphan reclaim
The orphan-reclaim currently flags a stuck run only after ~24h (`ingestion_tracker`
"Orphaned run detected: stuck in 'started' for Nh"). With Units 1-3 a run can't stay started >~50
min, so lower the orphan threshold (env or constant) to e.g. **2h** so any genuinely-stuck row is
reclaimed same-day. Verify this doesn't false-positive a legitimately long run (the 50-min cap
guarantees it won't).

## Boundaries / verify
- DialysisProject repo (Python), feature branch `claude/<desc>-<sessionId>` per its CLAUDE.md;
  end with merge instructions + the test commands.
- No schema change required if heartbeat rides `ingestion_tracker.notes` (jsonb already present);
  if a dedicated `heartbeat_at`/`current_step` column is cleaner, add a small migration.
- Healthy-run regression: a normal run completes exactly as before (timeouts never fire);
  `python -c "import src.run_cms_ingestion; print('OK')"`; `python -m pytest tests/ -x -q`.
- Hang simulation test: a step that `time.sleep`s past a tiny `CMS_STEP_TIMEOUT_SEC` is recorded
  as a failed step (TimeoutError), the loop continues, and the run finishes terminal (not
  `'started'`); the heartbeat row shows the stalled step name.

## After merge (Scott)
Re-run via the GH Actions "CMS Daily Ingestion (manual fallback)" (`force_run=true`). With the
guard, if it stalls again it fails in ≤15 min and the `ingestion_tracker` row names the stalled
step — point Cowork at that row to pinpoint the upstream cause (CMS fetch / OpenAI / DB write).

## Bottom line
Convert a silent multi-hour hang into a fast, logged, terminal failure that names the stalled
step. The cron already fires; this makes a stalled run fail fast + self-diagnosing so the next
occurrence is a 15-minute signal instead of a week of stale data.
