# Daily briefing cache job — 2026-08-26 (run log)

Scheduled task: `lcc-daily-briefing-cache`, weekdays 06:30 CT.

## Result: briefing is cached and fresh — but two of the task file's steps are stale/no-op

### 1. Briefing snapshot — OK

Snapshot generated `2026-08-26T10:00:02Z` (05:00 CT) by pg_cron `daily-briefing-snapshot`
(`0 10 * * *`) + `lcc-briefing-intel-snapshot` (`0 10 * * 1-5`), self-healed hourly by
`lcc-briefing-snapshot-self-heal` (`3 * * * *`). All three active.

`context_packets` cache: newest `daily_briefing` packet assembled `11:38:28Z`, expires
`2026-08-27T05:38Z`, `invalidated=false`, 887 tokens. **Cache is warm.**

Priority counts: **0 urgent / 10 high / 11 normal.**

High-priority head: DD + closing timeline on Innovative Renal Care MOB (Milwaukee, due 04-10,
**138 days overdue**) and DaVita Portfolio 4 / Realty Income (due 07-02); reply overdue on
Fresenius Rome-Summerville (last inbound 2025-01-23 from ntaylor@torreyfinancial.com).

Warnings / missing data in the snapshot:
- `analyst_take`: **null**
- `capital_markets`: **null**
- `weekly_changes`: **empty array**
- `sector_news.tax_policy`: 1 item, with an empty summary

### 2. The task file's URLs are stale

The task file targets `https://life-command-center-nine.vercel.app`. **Vercel was retired
2026-07-20**; production is the Railway service `tranquil-delight-production-633f.up.railway.app`.

The path is also wrong: `server.js:273` mounts `/api/activities` and **overwrites** `_route`
with `activities`, so `?_route=daily-briefing` never reaches the briefing handler. The real
route is `/api/daily-briefing` (`server.js:184` → adminHandler, `_route=edge-brief&action=snapshot`).

This run reached the briefing through the LCC MCP `get_daily_briefing` tool instead. Direct HTTP
was not attempted: `web_fetch` cannot carry the `Authorization`/`X-LCC-Key` header or issue a POST,
and shell fetching is not permitted from this session.

**Suggested edit to the task file:** replace the two URLs with
`https://tranquil-delight-production-633f.up.railway.app/api/daily-briefing` and
`.../api/operations?_route=draft&action=health`.

### 3. Template health evaluation — would flag nothing regardless (root cause found)

Not executed (see HTTP note above), but the DB shows running it is a no-op, and has been for months.

`template_health_history`, weekly `lcc-template-health-rollup`, every run back to at least
2026-07-20 (7 consecutive runs):

| recorded_at | template_count | evaluated_count | needs_revision | stale | total_sends |
|---|---|---|---|---|---|
| 2026-08-24 | 14 | **0** | 0 | 13 | **0** |
| 2026-08-17 | 14 | 0 | 0 | 13 | 0 |
| …identical back to 2026-07-20 | | | | | |

Meanwhile `template_sends` holds **102 rows, all inside the 120-day window**, newest 2026-08-13.
So the rollup reports `total_sends: 0` against a non-empty sends table — a green run that measures
nothing (the "reports healthy, does nothing" class in CLAUDE.md).

Root cause: **`edit_distance_pct` is NULL on 100% of the 102 sends.** Edit rate is the input the
whole health check is built on, so no template can ever be flagged. The recording path
(`POST …&action=record_send`) is not populating it. Fix the writer before trusting any future
`needs_revision_count`.

Two secondary notes:
- All 102 sends are **T-001**. The other 22 template definitions have never been sent — hence
  `stale_count: 13` sitting flat.
- `template_definitions` holds **3 rows for T-001** (2 deprecated + 1 live), so a join on
  `template_id` alone fans out 102 → 204. Join on `(template_id, template_version)`.

### 4. Minor: `context_packets` re-assembles rather than cache-hits

175 `daily_briefing` packets written today by 11:38Z — a fresh row roughly every 2 minutes, each
a full re-assembly, none ever read as a hit. Bounded and not urgent: `lcc-context-packet-prune`
(`25 4 * * *`) holds the table to a 7-day window, 1,742 rows / 8 MB. Worth finding the ~2-minute
caller (likely a polling client) since the cache is doing no work for it.

---
No writes were made by this run. Read-only verification against LCC Opps (`xengecqvemvfknjvbvrq`).
