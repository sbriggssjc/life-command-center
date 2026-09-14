# Prompt 83 — W8 U5 tick bounding (the 66/73 medicine for naming-hygiene)

**Grounding (live, 2026-08-08):** `GET /api/naming-hygiene-tick?score=1` 502s at the Railway proxy
("Application failed to respond"). It passed once pre-flip, fails now — variable runtime crossing
the proxy limit. `naming_hygiene_review`/`_batch`/`_scored` are all EMPTY (first cron window is
tonight), so this is the GET path's own weight. Prime suspect (U5-specific): the address-link arm
resolves a domain property PER address candidate — with 4,145 address candidates that's thousands
of PostgREST round trips inside one request. The scan itself (128k rows / 7 targets) adds more.
This is the third instance of the class (66 junk scoring, 73 findings narrate) — apply the same
proven medicine, and check whether tonight's cron POST would suffer the same fate (pg_net waits
have limits too).

## Do

1. **Crash-proof envelope first (73 pattern):** no response-less path; every error → JSON 500 with
   the failing stage; per-stage try/catch with loud `stage_errors`.
2. **Bound the dry-run GET:** address resolution runs ONLY for the sampled slice (`&n=`, default
   small), never the whole pool — the full pool gets counted-not-resolved. Wall-clock budget
   (`HYGIENE_TICK_BUDGET_MS` ~120s) across scan+sample; `budget_exhausted` honest.
3. **Bound + make resumable the POST/cron apply:** per-invocation caps per arm (deterministic
   renames ~50, LLM ~15, address-links ~15 — address resolution only for that batch), resumable
   cursors (the U2 keyset pattern) so nightly runs walk the 128k scan window instead of rescanning
   everything; scored/skip markers already exist — verify they're keyed to survive partial runs.
4. **Batch the per-candidate property lookups** within a batch: one `in.()` query per domain per
   batch on normalized address (the candidates are known upfront), not one round trip each.
5. **Tests:** budget-stop, sampled-only resolution guard, cursor resume, envelope; existing 51 stay
   green.

Acceptance: `?score=1&n=6` returns well under the proxy limit with a sampled sheet; two consecutive
POSTs process disjoint batches; tonight's cron completes within its window. Commit with the repo
trailer.
