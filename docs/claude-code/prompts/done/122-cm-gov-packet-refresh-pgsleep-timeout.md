# Prompt 122 — Fix the chronic `cm-gov-packet-refresh` cron timeout (in-transaction pg_sleep blows the statement timeout)

**Status:** DRAFT 2026-08-21 (Cowork-diagnosed from live LCC Opps)

Grounding: `supabase/migrations/20260814180000_cm_gov_packet_refresh_chunked_cron.sql` →
`cm_gov_packet_refresh_chunked(p_batch int DEFAULT 4, p_sleep int DEFAULT 50)`, pg_cron job
`cm-gov-packet-refresh` (`15 9 * * *`). Serving layer it feeds: the gov CM frozen packet
(`cm_report_snapshots`) behind the in-app Capital Markets display + workbook export.

## The break (chronic, not a blip)

Live error (latest run): `ERROR: canceling statement due to statement timeout / CONTEXT: SQL statement
"SELECT pg_sleep(p_sleep)" / cm_gov_packet_refresh_chunked line 27`. **Failing on every run since 2026-08-15
(7 failures)** — so the gov packet has not refreshed in ~a week; a new quarter's data never lands.

Root cause: the function fires each chart-batch via `net.http_post` (pg_net, **async** — returns a
`request_id` immediately) and then `PERFORM pg_sleep(p_sleep)` to space out the merges. `p_sleep` defaults to
**50 — that's 50 SECONDS** — and the loop runs one sleep per batch. With ~N gov chart batches the cumulative
in-transaction sleep is `50s × N`, which blows the pg_cron statement timeout long before the loop finishes.
The whole run is one statement, so it aborts mid-way and the merges after the abort never fire.

## The ask

1. **Stop sleeping for minutes inside one statement.** The serialization intent is fine (let each batch's
   merge finish before the next fires, and merges are non-regressing per the migration comment) but the
   mechanism can't live in a single timed statement. Pick one and implement:
   - **Cursor across invocations** — each cron tick does ONE (or a few) batches and advances a persisted
     cursor over `cm_chart_catalog`; run the tick every minute until the catalog is covered, then idle.
     No long in-transaction sleep. (Preferred — mirrors the LCC "drain a queue per tick" pattern.)
   - or **staggered one-shot pg_cron jobs** per batch at :15,:16,:17… (no sleep at all).
   - or, if kept monolithic, drop `p_sleep` to sub-second and PROVE the whole run fits under the statement
     timeout at the real gov chart count — but the cursor approach is more robust as the catalog grows.
2. **Verify by state delta, not the function's return.** Confirm the gov packet actually refreshes:
   `cm_report_snapshots` rows for gov charts get fresh `built_at`/updated timestamps across a full cycle, and
   `cm-gov-packet-refresh` runs green with no `cron_failure` re-opening. Note the synthetic/composed charts are
   deliberately excluded (documented residual) — don't count them as failures.
3. Resolve the 7 stale `cron_failure` alerts for this source with a P122 note once green.

## Close-out
- Migration on LCC Opps, live-immediate; no Railway deploy. Update STATUS + the CM capital-markets docs.
- Register nothing new unless a cursor state table/flag is added.
