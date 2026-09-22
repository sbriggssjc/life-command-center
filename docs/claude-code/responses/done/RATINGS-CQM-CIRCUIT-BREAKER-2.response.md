# RATINGS-CQM-CIRCUIT-BREAKER-2 — ratings' real root cause — response (transcribed 2026-09-22)

> Recovered from Scott's own saved transcript (`"Ratings cqm circuit breaker 2 surface response.docx"`,
> untracked, `docs/claude-code/responses/`). **Repo: `Dialysis`/`DialysisProject`.**

## What CC reports

**Root cause: a shared client-wide header, not a capped prefetch or a partial-index mismatch.** Every `ratings`
error since 2026-09-10 18:46 comes from one code path: the fallback used whenever the direct-DB connection is
unavailable — confirmed to be *always* the case on Railway, so this fallback handles every `ratings` write. That
fallback does an `UPDATE`, and if the `UPDATE` returns no rows, assumes the row doesn't exist and `INSERT`s it.

`config.get_supabase_client()` sets a client-wide `Prefer: return=minimal` header that overrides the
per-request `Prefer: return=representation` header, so an `UPDATE` of an existing row always comes back empty —
confirmed directly against the real `postgrest` library, on the wire. Every existing row therefore gets a doomed
`INSERT`, a real `23505` duplicate-key error, and a tripped circuit breaker — even though the `UPDATE` itself
had already succeeded.

**Two things this round re-explains, correcting the prior round's framing:**
- **`ratings` was never frozen.** All 7,013 rows carry today's `updated_at` — the `UPDATE`s were succeeding all
  along. 7,013 is simply every facility with a rating. The real damage: a genuinely *new* facility would have
  been silently dropped by the same misread, not just redundantly re-errored.
- **No clean window.** There are zero error rows for *any* table between 2026-09-10 22:17 and 2026-09-11 19:45.
  Nothing ran in that window; the first run afterward logged the same 7,013 errors it always had. The September
  fix's "8-hour clean" reading was an artifact of no runs occurring, not the fix working.

**Fix** (`src/cms_aux_ingestion.py`): the fallback now checks row existence with a single one-row `SELECT` on
`medicare_id` — unaffected by the header — then `UPDATE`s or `INSERT`s based on that answer, never reading the
`UPDATE`'s response again. If the existence check itself fails, the row is skipped rather than guessed at.

**Tests**: rewrote the old tests (which had wrongly assumed `UPDATE` returns rows). New
`tests/test_ratings_cqm_circuit_breaker_2.py`: 5 behavioral tests (all fail on old code, pass on the fix, via a
mutation check) plus 1 wire-level test against the real `postgrest` client proving the header-override mechanism
itself, both directions. Full suite: 3,358 passed (main's 3,352 + 6 new); 2 pre-existing failures reproduced
identically on unmodified `main` in the same sandbox, confirmed unrelated.

**Also**: corrected a stale "ratings was already fixed" claim CC found sitting in `CLAUDE.md`.

**Still open, disclosed plainly, not fixed this round** (both written into `CLAUDE.md` per CC):
1. Other code reading a response body after a write through the shared client is exposed to the same
   header-override bug — not audited.
2. Why the direct-DB connection is unavailable on Railway in the first place, forcing every aux-table write
   through this fallback.

**Delivery**: `sbriggssjc/Dialysis` branch `claude/modest-albattani-cscwrj`, **PR `sbriggssjc/Dialysis#7425`**.
No PR opened at time of writing per CC's own note, but a PR number was assigned shortly after
(`sbriggssjc/Dialysis#7425`) and further commits update it directly.

## Independent verification performed by this session

- **Mechanism is plausible and well-evidenced**: a wire-level test against the real `postgrest` client
  confirming the header-override is a materially stronger proof than a log-reading inference alone.
- **Live proof not yet available, checked directly rather than assumed**: `ratings.updated_at` still reads
  2026-09-22 14:24:27 UTC (unchanged since before this fix's merge); the same two `ingestion_tracker` rows from
  earlier today (`0c7f36de…`/`8173f93e…`, started 14:10-14:11 UTC) are still open — no run has started on
  Railway since PR #7425 merged, exactly as CC itself disclosed ("hasn't run on Railway yet, so the 48-hour
  check hasn't started").
- **The "September clean window" re-read independently confirmed**: queried `ingestion_run_errors` directly for
  any row of any table between 2026-09-10 22:17 and 2026-09-11 19:45 UTC — none exist. Corroborates CC's
  re-explanation rather than just accepting it.

## Delivery

Code changes in `Dialysis`/`DialysisProject`. **PR `sbriggssjc/Dialysis#7425`
(`claude/modest-albattani-cscwrj`) — Scott reports merged.** `ratings` closed to **🟡, not ✅** — this round
explicitly asks for two consecutive clean daily runs before calling it durably fixed, not one, given the
September fix's "clean window" turned out to be a misreading in the first place. Live proof still owed on three
fronts: `HCRIS-TIMEOUT-10` (#7423), `clinic_quality_metrics` (#7424), `ratings` (#7425) — none has had a
post-merge run yet.
