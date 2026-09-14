# Daily briefing cache job — 2026-09-01 (run log)

Scheduled task: `lcc-daily-briefing-cache`, weekdays 06:30 CT.
Prior run: [`daily-briefing-cache-2026-08-26.md`](./daily-briefing-cache-2026-08-26.md).

## Result: briefing is fresh and cached. The task file is still pointing at the retired Vercel host.

### 1. Briefing snapshot — OK

`briefing_intel_snapshot` for `2026-09-01` written **10:00:15Z** (05:00 CT) by the pg_cron
snapshot jobs. Priority counts: **0 urgent / 10 high / 11 normal**.

`context_packets` (`packet_type='daily_briefing'`): newest assembled **11:36:30Z**, expires
**2026-09-02 05:36Z**, `invalidated=false` on all 209 packets in the last 24h, 1,676 tokens.
**Cache is warm.**

High-priority head is unchanged from 08-26 and still aging: DD + closing timeline on Innovative
Renal Care MOB (Milwaukee, due 2026-04-10, now **144 days overdue**) and DaVita Portfolio 4 /
Realty Income (due 07-02); reply overdue on Fresenius Rome-Summerville (last inbound 2025-01-23
from ntaylor@torreyfinancial.com).

Snapshot field state:

| field | 09-01 | note |
|---|---|---|
| `analyst_take` | **730 chars, `source=onprem_ollama`** | healthy; non-null every day back to 08-26 |
| `capital_markets` | **null** | still the Anthropic billing block (P138) — unchanged |
| `weekly_changes` | `[]` | non-empty only on 08-28 (14 items) in the last 5 runs |

### 2. ⚠️ Correction to the 2026-08-26 log: `analyst_take` was NOT null

That log listed `analyst_take: null` as a snapshot warning. The DB says otherwise — 08-26 carries
**774 chars, `source=onprem_ollama`, written 10:00:02Z**, which also matches the figure recorded in
`CLAUDE.md` §P138. The 08-26 reading was taken from the wrong artifact.

**The two objects are different things and neither is a cache of the other:**

- `briefing_intel_snapshot` — market data, sector news, reading list, **`analyst_take`**,
  `capital_markets`. One row per `as_of_date`. This is what the MCP `get_daily_briefing` returns.
- `context_packets(packet_type='daily_briefing')` — the priority packet. Its top-level keys over
  the last 6 hours are exactly `date`, `generated_at`, `packet_type`, `user_id`,
  `production_score`, `urgent_items`, `important_items`, `strategic_items`, `overnight_signals`,
  `carry_forward_from_yesterday`. **`analyst_take` is structurally absent — it was never meant to
  be there.**

So "the take is missing from the packet" is not a defect, and the 08-26 warning should not be
carried forward. `capital_markets: null` and `weekly_changes: []` are real and unchanged.

### 3. The task file's URLs are still stale — the 08-26 suggested edit was not applied

The task file still targets `https://life-command-center-nine.vercel.app`. Per `CLAUDE.md`:
**Vercel was retired 2026-07-20**, and **P194** established that the deployment still answers and
still holds the LCC Opps service key — a live second writer that no `/version` probe can see.
**Firing the step-4 POST at it is a write to a frozen build**, so it was not attempted.

The path is wrong too: `server.js:273` mounts `/api/activities` and **overwrites** `_route` with
`activities`, so `?_route=daily-briefing` never reaches the briefing handler.

Correct targets:

```
https://tranquil-delight-production-633f.up.railway.app/api/daily-briefing
https://tranquil-delight-production-633f.up.railway.app/api/operations?_route=draft&action=health
```

Direct HTTP was again not attempted from this session: `web_fetch` cannot carry the
`Authorization` / `X-LCC-Key` header or issue a POST, and shell fetching is not permitted. The
briefing was read through the LCC MCP `get_daily_briefing` tool; everything else is a read-only
query against LCC Opps (`xengecqvemvfknjvbvrq`).

### 4. Template health evaluation — still a guaranteed no-op, now 8 runs deep

Not executed (see above), and the DB says running it would change nothing. The root cause found on
08-26 is **unfixed**.

`template_health_history`, weekly `lcc-template-health-rollup`:

| recorded_at | template_count | evaluated_count | needs_revision | stale | total_sends |
|---|---|---|---|---|---|
| 2026-08-31 | 14 | **0** | 0 | 13 | **0** |
| 2026-08-24 | 14 | 0 | 0 | 13 | 0 |
| …identical back to 2026-07-27 (8 consecutive runs) | | | | | |

`template_sends` today: **103 rows, all 103 inside the 120-day window**, newest 2026-08-26
21:44Z (one new send since the last log), **1 distinct `template_id`**.

**`edit_distance_pct` is NULL on 103 of 103.** Edit rate is the sole input to the health check, so
`evaluated_count` can never leave 0 and no template can ever be flagged — a green weekly run that
measures nothing. Fix the recording path (`POST …&action=record_send`) before trusting any future
`needs_revision_count`. Read `evaluated_count`, never `template_count`.

### 5. Minor: `context_packets` re-assembly rate is climbing

209 `daily_briefing` packets in 24h, against 175 on 08-26 — roughly one full re-assembly every 2
minutes, none ever read as a hit. Still bounded by `lcc-context-packet-prune` (`25 4 * * *`) and
not urgent, but the trend is the wrong direction and the ~2-minute caller is still unidentified.

---

**No writes were made by this run.** Read-only verification against LCC Opps
(`xengecqvemvfknjvbvrq`) plus one MCP briefing read.

**Carried forward for Scott:**
1. Edit the scheduled task's two URLs to the Railway host and the `/api/daily-briefing` path.
2. Fix `edit_distance_pct` on the send-recording path, or retire the weekly rollup — it has
   reported a healthy zero for 8 straight weeks.
3. Identify the ~2-minute `daily_briefing` packet caller.
