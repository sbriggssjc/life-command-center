# Claude Code (DialysisProject) — fix the CMS ingestion hang (no-timeout CSV download)

## Why (root-caused live 2026-06-23/24 via the hang-guard heartbeat)
The CMS ingestion has hung since the May-13 last-success — on BOTH the GitHub fallback (60-min
timeout → cancelled) and a local `--force-run` (stuck 70+ min). The hang-guard (PR #7319) did its
job: the `ingestion_tracker` heartbeat named the stalled step — **`current_step =
"medicare_ingestion"`** — but the run sat in `started` for 70 min, i.e. the per-step `signal.SIGALRM`
timeout did NOT abort it.

Root cause, confirmed in code: **`_download_csv(url)` (`src/ingest_medicare_clinics.py:7063`) calls
`pd.read_csv(url)` directly first (line 7067) with NO timeout.** pandas reads the URL via urllib →
a hung/slow CMS download **blocks forever** there. A hang doesn't raise, so the well-behaved
buffered fallback right below it (`_safe_get(url, timeout=(5,30), retries=5)` → `pd.read_csv(
io.BytesIO(content))`, lines 7070-7087) is **never reached**. And `SIGALRM` can't interrupt a
blocked C-level socket read, so the hang-guard's per-step timeout can't break it either. This is
the hang. (The `git exit 128` GH annotation was just post-cancellation cleanup noise — not the
cause.)

This is the last blocker on CMS freshness (stale movers / inventory / patient counts since May 13)
AND a GitHub-Actions cost item (each hang burned 60 min). The fix lands in the shared pipeline, so
it fixes the GH fallback AND the Railway cron at once.

## Unit 1 — make the bulk CSV download timeout-bounded (the fix)
In `_download_csv` (`src/ingest_medicare_clinics.py:7063`):
- **Remove the direct `pd.read_csv(url)` first-attempt (line 7067).** Always go through the
  buffered, timeout-bounded path: `_safe_get(url, timeout=(5,30), retries=5, headers=...)` →
  `pd.read_csv(io.BytesIO(content))` (with the existing latin-1 fallback). So every CMS bulk fetch
  has an explicit connect+read timeout and bounded retries — a hung download fails in seconds, not
  forever.
- Keep the function's return contract (a `DataFrame`, empty on failure) so callers are unchanged.
- If you want to preserve a fast path, it's fine to keep `pd.read_csv(url)` ONLY if pandas is given
  a real timeout via `storage_options`/a urllib opener — but the simplest correct fix is to drop it
  and use `_safe_get` (which already has the timeout + retry). Prefer the simple fix.

## Unit 2 — audit the rest of the `medicare_ingestion` network path for un-timed calls
`SIGALRM` can't rescue a blocked socket, so EVERY network call in this step must carry its own
`timeout=`. Grounded: the metadata fetches already do (`META` timeout=60:62; metastore
timeout=(5,30):864), and `_safe_get` enforces timeout. Verify there are no remaining un-timed
calls in the medicare_ingestion path:
- any other `requests.get/post`, `session.get/post`, `pd.read_csv(<url>)`, `urlopen`, or
  `.json()`-on-a-raw-fetch without a `timeout=`;
- the **AI-scrub / OpenAI** calls invoked during medicare_ingestion (a hung model call would block
  the same way) — confirm they pass a request timeout;
- the `Retry` configs (`:4285`, `:6136`) — ensure a bounded `total=` (no effectively-infinite
  retry/backoff). Add `timeout=` to any call missing one. Keep changes surgical.

## Unit 3 — hang-guard hardening (so SIGALRM's I/O blind spot is documented + the heavy step isn't false-killed)
- **Document** in the hang-guard (and CLAUDE.md) that `signal.SIGALRM` does NOT interrupt blocked
  C-level socket reads — so the per-step timeout is a backstop for pure-Python loops, and **network
  calls must carry their own `timeout=`** (Units 1-2 are what actually bound I/O hangs).
- **Per-step budget:** `medicare_ingestion` legitimately processes ~50k rows + AI scrub and can run
  well past the default `CMS_STEP_TIMEOUT_SEC` (900s/15min). Once the download is bounded (Unit 1),
  a healthy run could exceed 15 min and be falsely SIGALRM-killed. Give `medicare_ingestion` a
  realistic per-step override (e.g. a per-step map or a higher env, ~45-50 min, still under the
  global `CMS_RUN_TIMEOUT_SEC` 50-min cap — bump that cap if needed) so the guard catches true
  hangs without aborting a legit long ingest.

## Boundaries / verify
- DialysisProject (Python), feature branch per its CLAUDE.md; end with merge + test commands.
- `python -c "import src.ingest_medicare_clinics; print('OK')"`; `python -m pytest tests/ -x -q`
  (note any pre-existing sandbox-cred collection errors, unchanged).
- The real proof is a **local `--force-run`** that now COMPLETES (or fails fast with a real CMS/
  network error message), not a silent multi-hour hang. After merge, Scott runs it locally (NOT
  GitHub — saves minutes); Cowork reads `ingestion_tracker` to confirm `run_status='success'` +
  fresh `facility_patient_counts` / `cms_medicare_clinics`, which unblocks Top Movers + freshness.

## Bottom line
One no-timeout `pd.read_csv(url)` was hanging the entire CMS pipeline (and burning 60-min GH runs).
Route the bulk download through the existing timeout-bounded `_safe_get` path, timeout-audit the
rest of the medicare network calls, and document the SIGALRM I/O blind spot + give the heavy step a
real budget. Fixes GH fallback + Railway cron together; CMS freshness returns on the next run.
