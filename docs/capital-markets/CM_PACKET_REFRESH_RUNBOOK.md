# CM frozen-packet refresh — how it runs, how to verify it (P122, 2026-08-21)

The Capital Markets **frozen packet** is the serving layer behind the in-app CM display and the
workbook export. It is one row per `(vertical, fiscal_quarter)` in **`cm_report_snapshots`** —
and that row lives in the **DOMAIN** database (gov `scknotsqkcheojiaewwh`, dia
`zqzrriwuavgrquhisnoa`), *not* LCC Opps. `api/capital-markets.js` reaches it through
`domainQuery(...)`.

> ⚠️ `cm_report_snapshots` also **exists on LCC Opps and is permanently empty (0 rows)**. Reading
> the LCC-Opps copy to check packet freshness tells you nothing. Always query the domain project.

## Why it is refreshed in chunks

A full live rebuild is ~45 parallel view fetches in one HTTP request; it exceeds Railway's response
window and 502s, so fresh data (a new quarter) never lands via the request path. Instead
`POST /api/capital-markets?action=refresh_packet&vertical=<v>&chart_template_ids=<csv>` rebuilds a
**small subset** and MERGES it into the existing snapshot. The merge is non-regressing: a chart is
replaced only when the fresh build populated it, so a batch that comes back empty leaves the old
rows alone.

**The merge is a read-modify-write on one row** (fetch existing → build subset → merge → upsert).
Two overlapping merges therefore lose one side's fresh charts. Batches **must** be serialized.

## How it runs today (cursor across invocations)

| pg_cron job (LCC Opps) | Schedule | Command |
|---|---|---|
| `cm-gov-packet-refresh` | `15 9 * * *` | `SELECT public.cm_packet_refresh_start('gov')` |
| `cm-gov-packet-refresh-tick` | `* * * * *` | `SELECT public.cm_packet_refresh_tick('gov')` |

- **`cm_packet_refresh_start(vertical, batch)`** freezes the vertical's chart catalog into
  `cm_packet_refresh_cursor` and resets it to batch 1. It fires no HTTP.
- **`cm_packet_refresh_tick(vertical, max_wait_sec)`** fires **one** batch, appends a row to
  `cm_packet_refresh_log`, and advances `next_idx`. Once the cycle is covered it returns
  `cycle_complete`, then `idle` on every later tick until the next `start()`.

Serialization is a real completion check, not a timing assumption: the tick refuses to fire the next
batch until the previous batch's pg_net request has a row in `net._http_response`, and **fails
forward** after `max_wait_sec` (default 90s) so a purged or lost response can never stall the cycle.

Gov today: **31 charts / 8 batches**. A 4-chart gov subset merge measures **~69s**, and a batch
that finishes ~10s past a minute boundary is picked up by the *following* tick — so expect roughly
**2 minutes per batch, ~16 minutes per cycle**. That is normal, not a stall: `charts_remaining`
falling by `batch_size` every couple of minutes is a healthy drain. Shrinking the wall clock would
mean a smaller `batch_size` (more, faster requests), not a shorter wait. Synthetic (composed) charts
and `DataTable`/`kpi_block` templates are excluded — they are not built in subset mode. That is a
**documented residual, not a failure**; do not count them as missing.

## ⚠️ The trap this replaced — never put pg_sleep in a cron statement

The original driver (`cm_gov_packet_refresh_chunked`, retired by P122) looped the batches inside ONE
statement with `PERFORM pg_sleep(50)` between them. At 31 charts that is 8 × 50s = **400s of
in-transaction sleep against a 120s `statement_timeout`** — it was cancelled on every run, 7/7 from
2026-08-15 to 2026-08-21.

**And it delivered nothing at all.** `net.http_post` is async but its queue insert is
**transactional** (pg_net 0.20.0 INSERTs into `net.http_request_queue`; the background worker only
reads *committed* rows). The statement timeout aborts the transaction, so every already-"fired"
request rolled back with it. Not one HTTP call was ever made — not even the batches that ran before
the cancel. Proven live 2026-08-21 by a `DO` block that http_posts then `RAISE`s: 0 rows left in
`net.http_request_queue`, 0 rows in `net._http_response`.

Two durable rules:

1. **A long sleep cannot serialize work inside a single cron statement.** Cursor the work across
   invocations instead (this is the same "drain a queue per tick" pattern used elsewhere in LCC).
2. **A rolled-back `net.http_post` is a silent no-op.** Any function that queues pg_net requests and
   can later raise will deliver *nothing*, while the cron log shows only the final error and the
   per-batch intent looks fine. Never conclude "some batches got through".

### ⚠️ `net._http_response.created` is the REQUEST time, not the response time

Do not time a batch with it. Request 233443 shows `created = 17:00:00.847` on a call that timed out
55 seconds later, and request 233464 shows `created = 17:04:00.773` on a call whose merge did not
land until `17:05:09`. The row simply carries the request's creation timestamp. To measure how long
a batch really took, compare `cm_packet_refresh_log.fired_at` against the **domain** snapshot's
`updated_at` — that is the only pair that brackets the actual server-side merge.

## Verifying a refresh — by state delta, never by return value

`v_cm_packet_refresh_health` shows cycle progress and `batches_ok` (pg_net 2xx counts). **A 2xx is
not proof the packet changed** — it only proves the endpoint answered.

The truth is the domain snapshot's `updated_at` delta:

```sql
-- on the DOMAIN project (gov = scknotsqkcheojiaewwh)
select vertical, fiscal_quarter, updated_at,
       jsonb_array_length(packet->'charts') n_charts,
       (select count(*) from jsonb_array_elements(packet->'charts') c
         where jsonb_array_length(coalesce(c->'rows','[]'::jsonb)) > 0) n_populated
  from cm_report_snapshots
 where vertical = 'gov'
 order by period_end desc;
```

```sql
-- on LCC Opps: cycle progress + per-batch outcomes
select * from public.v_cm_packet_refresh_health;
select batch_no, batch_ids, request_id, fired_at, response_status, response_error
  from public.cm_packet_refresh_log
 where vertical = 'gov'
 order by cycle_started_at desc, batch_no;
```

## First verified cycle (2026-08-21)

Driven end-to-end by the production cron, 17:03:10 → 17:20:00:

| | |
|---|---|
| batches fired / total | 8 / 8 (0 unreconciled) |
| pg_net outcomes | 7 × 200, 1 × 502 (batch 3) |
| tick job runs | 23 succeeded, 0 failed |
| gov Q2-2026 `updated_at` | 2026-08-14 20:00:12 → **2026-08-21 17:19:16** |
| populated charts | 41 → **45 of 45** |

Batch 3's 502 (`cap_rate_ttm_by_quarter, case_for_renewal, cash_leveraged_returns,
core_cap_rate_dot_plot`) is the intended failure behaviour: it is **recorded in the ledger**, those
charts kept their existing rows (`cap_rate_ttm_by_quarter` still 354), and they retry on the next
cycle. One heavy batch occasionally exceeding Railway's gateway window is expected; a batch that
fails *every* cycle is the signal to shrink `batch_size`.

**Cost of the per-minute tick:** ~1,440 extra `cron.job_run_details` rows/day against ~5,774/day
already, bounded by the existing `cleanup-cron-history` job (7-day prune, jobid 8) — roughly +3 MB
steady state. Worth knowing given this project's documented disk-pressure sensitivity, but not a
concern at that scale.

## Manual run

```sql
select * from public.cm_packet_refresh_start('gov');   -- begin a cycle
select * from public.cm_packet_refresh_tick('gov');    -- repeat until 'cycle_complete'
```
The per-minute cron drains a cycle on its own, so starting one is normally all that is needed.

## Adding a vertical

Both functions take `p_vertical`; only gov is scheduled. To add dialysis, schedule a
`cm_packet_refresh_start('dialysis')` job plus a per-minute
`cm_packet_refresh_tick('dialysis')` — the cursor table is keyed by vertical, so cycles for
different verticals are independent (though they will contend on the same Railway endpoint).

**Reversal + full grounding:** `supabase/migrations/20260821120000_p122_cm_packet_refresh_cursor.sql`.
