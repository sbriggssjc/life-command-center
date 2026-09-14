# MB2e — Two more feeds are green and contributing nothing, and Monday is why

**Repo: `life-command-center`.** Small. This is MB2b's `items_after_cutoff` column doing exactly the job
it was added for — **on its first day it found its next two customers.**

**Read first:** `docs/os/PLANNED-BACKLOG.md` **MB2e, MB2b, FEED2** ·
`supabase/functions/briefing-intel-snapshot/index.ts` (`RSS_FEEDS`, the `maxAgeHours` override MB2b
added, and the cutoff in `fetchSectorNews`) · `docs/architecture/data-coherence-invariants.md` **I11**
and the "I11 can fail INVERTED" note.

## The finding (measured live 2026-09-14 via pg_net)

MB2b gave `maxAgeHours` to Federal Register (ESRD) only. Today's health rows show two more feeds that
return HTTP 200 with real items and contribute **zero**:

| feed | `item_count` | `items_after_cutoff` |
|---|---:|---:|
| Federal Register (GSA) — `government` | 6 | **0** |
| Tax Foundation — `tax_policy` | 15 | **0** |

Fetched directly to find the right window rather than guessing:

| feed | newest item | within 72h | within 7d | within 30d |
|---|---|---:|---:|---:|
| Federal Register (GSA) | 82 hours old | **0** | **5** | 7 |
| Tax Foundation | 92 hours old | **0** | **5** | 20 |

**Consequence right now:** the `government` lane contributes from ONE feed (GovExec, 5 items) — FEED1
set out to fix exactly that and only half-fixed it — and **`tax_policy` contributes nothing at all**,
so that stream is empty in the daily email while every row about it reads green.

## Why this keeps happening — name it, don't just patch it

**This is the FEED2 bug's twin.** FEED2 was a monitor measuring calendar days against a producer that
runs weekdays. This is a *cutoff* measuring calendar hours against feeds that publish a few times a
week. Both fail the same way and for the same reason: **a fixed calendar window applied to a source
whose cadence is slower than that window is empty by construction on some days — and Monday is the
worst day, because a 72h window on a Monday excludes everything published before Friday morning.**
Today is a Monday, and both feeds' newest items are Thursday/Friday.

So the honest framing is not "these two feeds are bad." It is: **the 72h default is a NEWS window, and
we keep pointing it at non-news sources.**

## What to do

1. **Set `maxAgeHours` on both** — `24 * 7` (168) is the measured-correct value: it captures 5 items
   each, which is a real contribution, and stays far tighter than the 30 days ESRD needed. Do **not**
   widen the global default; the 72h rule is what keeps the daily brief daily.
2. **Then make the monitor catch this class itself.** `lcc_check_market_brief_feed_health` currently
   alerts only on `item_count = 0`. Extend it so a feed with `item_count > 0` **and**
   `items_after_cutoff = 0` for N consecutive checks opens its own alert, with a distinct
   `alert_kind` (e.g. `market_brief_feed_no_contribution`) so it reads differently from a dead feed —
   because it is a different fault with a different fix (widen the window vs. replace the URL).
   Reuse FEED2's shape: count **checks, not days**, auto-resolve on a real contribution, and "no
   history" must not alert. ⚠️ Follow the FEED2 migration's precedent — do not re-introduce a sentinel
   for "unknown".
3. Add test cases alongside `feed2-streak-checks-not-days.test.mjs` for the new arm, including the
   Monday/weekend-boundary case that produced this finding.

## What NOT to do

Don't widen the global 72h cutoff. Don't drop Tax Foundation or FR GSA — both answer with real content,
they are just slower than the window. Don't touch the dialysis stream, the PRSS flag (correctly OFF —
the Google News QUERY is the remaining blocker, not the plumbing), or the publisher parser.

## Ship + record

Deploy: `supabase functions deploy briefing-intel-snapshot --project-ref xengecqvemvfknjvbvrq`
(`--project-ref` REQUIRED), then **re-read the deployed body** — merged is not running.
Report the health table after a forced run: `item_count` vs `items_after_cutoff` per feed, and confirm
`government` and `tax_policy` now contribute. That table is the deliverable.
Update `docs/os/PLANNED-BACKLOG.md` **MB2e**, `docs/architecture/data-coherence-invariants.md` (the
cadence-vs-window lesson belongs beside the I11 note), and `STATUS.md` (≤12 lines).
