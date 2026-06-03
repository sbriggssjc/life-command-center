# LCC QA Cycle — Closeout Summary (2026-06-03)

A hands-on walkthrough of the live app produced a ranked catalog of 12 findings;
each was fixed (mostly via grounded Claude Code prompts), merged, deployed, and
**verified live**. This is the record of that loop.

## How the cycle ran
Live browser walkthrough → ranked findings catalog (`LCC_Live_QA_Findings_2026-06-03.html`)
→ per-finding Claude Code prompts (this folder, `CLAUDECODE_PROMPT_QA*.md`) →
merge + deploy → live verification sweep. Server/data fixes were applied to the
Supabase projects directly; code fixes shipped via Vercel/Railway.

## Findings & resolutions (all verified live unless noted)

| # | Finding | Resolution | Live verify |
|---|---------|-----------|-------------|
| QA#1 | $950M dialysis "sales" (portfolio price bleed) dominating the NBA | 3-layer fix: value-signal views honor `exclude_from_market_metrics`; backfill nulled bleed-signature rows (dia 5, gov 6); ingestion guard `detectSalePriceBleed()` | ✓ no $950M; NBA max $436M |
| QA#2 | Priority Queue P0.5 band (485 rows) non-actionable | `open_opportunity` action → `lcc_open_prospect_opportunity`; "Open opportunity →" on owner-level rows | ✓ hero actionable |
| QA#3 | Band counts truncated at 1000 (PostgREST cap) | `v_priority_queue_band_counts` view; server-side counts | ✓ total 1117, P8 present |
| QA#4 | Today "8442 items" vs Pipeline "0" | Exclude `item_type=inbox` from `my_work`; exact count; widget reads the same MV count as the stat | ✓ My Work 0 = actions 0 |
| QA#5 | Treasury / auth-config 503s | Client retry/backoff on transient 5xx; treasury last-good cache | ✓ retry recovers; widget renders |
| QA#7 | Duplicate load fetches (work_counts 3×, etc.) | In-flight GET coalescing in the fetch interceptor | ✓ 3 concurrent → 1 |
| QA#6 | "Renderer frozen" on heavy surfaces | Profiled via `opsPerf`: render times are network-bound, not main-thread. Closed **not-reproducible** (capture-tool artifact); perf wrappers left for monitoring | ✓ measured |
| QA#9 | 4 of 6 Review Console lanes "—"; property-detail ownership badges 403 | Allowlisted 4 gov views (+ edge mirror); `domainQuery` Content-Range parse + credentials aliases + Prefer-position fix | ✓ 4 views now 200; lanes count |
| QA#10 | Detail tab bar clipped "Activity Log" | `.detail-tabs` flex-wrap | ✓ 6 tabs wrap, no clip |
| QA#11 | 4 pre-existing failing tests | Triaged: 1 stale ratchet (raw-write-guardrail — no safety gap), 2 missing-dep (SessionStart hook), 1 rotted glob (rewritten). Suite green 419/0 | ✓ green |
| QA#12 | review-counts 4–8s | pg_cron count cache for ops lanes; `estimated` for big well-estimated tables; exact for small; per-lane timeout | ✓ 960ms, degraded:false |
| QA#8 | "DEV MODE" / auth not enforced | Lockout guard + `/api/diag?kind=auth-ready` probe + rollout doc. Enforcement is a deliberate env-var decision | guard/probe live |

## Open items (your decisions, not code defects)
- **Add CI** — no workflow runs `npm test`; that's why the 4 tests rotted. A lightweight GitHub Actions PR check is recommended.
- **Auth enforcement** — flip `LCC_API_KEY` then `LCC_ENV=production` (in that order; verify the `auth-ready` probe first). DEV MODE is a legitimate choice for a single-user app.
- **Chart axis** — `cap_rate_top_bottom_quartile` ships 5–9%; a 4–10% variant is a one-line change if preferred.
- **Minor:** the `ownership_research` review lane shows an *estimated* count (~80k) that runs high vs the exact (~50k); move it to the cached path if that headline needs precision.

## Engineering notes for next time
- The CoStar sidebar can write a portfolio aggregate price per-property — the `detectSalePriceBleed()` guard now catches the duplicate price+date signature; magnitude alone is a flag, not an auto-null.
- `exclude_from_market_metrics` was a *written-but-never-read* flag until QA#1 — worth auditing for other such dormant flags.
- `domainQuery` count plumbing (Content-Range) and the `'dia'`/`'gov'` credential aliases were latent gaps that silently returned 0/null — any new count-based lane should go through the now-fixed path.
