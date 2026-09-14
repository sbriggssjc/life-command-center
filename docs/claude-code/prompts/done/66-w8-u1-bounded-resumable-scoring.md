# Prompt 66 — W8 U1: bounded, resumable scoring (fix the ollama-latency 502)

**Grounding:** Scott's third live run (2026-08-07, post-65 deploy `6bb9c1aaa57a`). The 65 scope
tighten WORKS: bare `GET /api/junk-prescreen-tick` returns fast — 247 candidates (true-junk range),
`naming_hygiene_backlog` counted, connection exclusion active. But `?score=1` now **502s at the
Railway proxy** ("Application failed to respond"). Root cause: `OLLAMA_SURFACES` was unset, so
`clean_assist` scoring runs on GaryBuilt at ~16s/call (p50, measured in W5.3) — 20 inline calls
≈ 320s, past the proxy timeout. Earlier runs survived only because they scored on gpt-4o-mini
(~2–3s/call). The same math breaks the nightly cron with the flag on: 247 × 16s ≈ 66 min in one
HTTP request.

## Do (in `api/admin.js` tick + `junk-prescreen.js` if needed)

1. **Inline dry-run scoring gets a time budget + size cap:** `?score=1` accepts `&n=<count>`
   (default drop 20 → **6**) and enforces a wall-clock budget (e.g. `JUNK_SCORE_BUDGET_MS`, default
   ~120s): stop scoring when the budget is spent, return what's scored with
   `budget_exhausted: true` + counts. Never let the inline path outrun the proxy.
2. **Cron/apply path becomes resumable batches:** POST apply scores at most
   `JUNK_SCORE_BATCH_SIZE` (default ~25, ollama-sized) per tick invocation, persists proposals for
   that batch, records a cursor/`scored_at` marker so the next nightly run resumes where it left
   off (mirror the resumable-runner pattern from `scripts/party-extract-backlog.mjs` / the ledger
   batches). 247 candidates drain in ~10 nights — fine; junk accrues slowly. Alternatively make the
   batch loop internal with per-call timeout accounting — but each HTTP invocation must stay well
   under the proxy limit.
3. **Already-scored dedupe:** a candidate scored (proposal persisted OR keep-counted) isn't
   re-scored on subsequent ticks unless its name changed — key on (domain, table, pk, name-hash) in
   the existing tables (proposals in `junk_entity_review`; keeps need a lightweight scored-marker —
   simplest: a `junk_prescreen_scored` ledger table or reuse `junk_review_batch` metadata).
4. **Surface it honestly:** dry-run + apply responses report `scored`, `remaining_unscored`,
   `budget_exhausted`, `batch_size` so Scott can see drain progress; the health view
   (`v_lcc_junk_prescreen_health`) gains remaining-pool visibility if cheap.
5. **Tests:** budget-stop test (fake slow scorer), batch-cap test, resume-cursor test (second tick
   skips scored rows), n-param test.

## Acceptance

- `?score=1&n=6` returns in well under the proxy timeout on ollama-latency assumptions.
- Two consecutive POST applies (flag on, dry-run first per doctrine) score disjoint batches and
  the second resumes correctly.
- No re-scoring of unchanged names; counts honest.

Commit with the repo Co-Authored-By + Claude-Session trailer.
