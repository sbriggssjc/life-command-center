# FEED1 — Three feeds the daily email reads every morning are dead. Replace them with ones that answer.

**Repo: `life-command-center`.** Small, and the same shape as MB2a — but this time the dead feeds are in
lanes Scott actually reads, not a flag-gated one. Every URL below was **fetched and parsed live** by
Cowork on 2026-09-12 via pg_net. **Re-fetch each one before committing it** — that is the whole lesson
of MB2a, and it now has a second body of evidence behind it.

**Read first:** `docs/os/PLANNED-BACKLOG.md` **FEED1, MB2b, MB2c, MB2a-deploy** ·
`supabase/functions/briefing-intel-snapshot/index.ts` (`RSS_FEEDS`, `fetchSectorNews`) ·
`docs/architecture/data-coherence-invariants.md` **I11** · `scripts/verify-rss-feeds.mjs` (MB2a shipped
this; it must stay the one source of truth for which URLs exist).

## Why this, why now

MB2a added `market_brief_feed_health`. **On its very first run it found three dead feeds in streams
nobody was looking at** — and each was then confirmed independently by direct pg_net fetch:

| stream | dead feed | result | note |
|---|---|---|---|
| `government` | `https://www.gsa.gov/about-us/newsroom/news-releases/rss` | **404** | returns a 173 KB HTML page, not a feed — so a naive "did we get bytes?" check would call it healthy |
| `healthcare` | `https://www.healthaffairs.org/rss/site` | **410 Gone** | 410 is deliberate: the publisher retired it. **Do not hunt for another Health Affairs path** — find a different source |
| `net_lease` | `https://www.globest.com/feed/` | **403** | bot-blocked, same class as Renal & Urology News in MB2a |

Live effect today: **`government` runs on a single feed**, `net_lease` on two of three, `healthcare` on
two of three — and §8 Sector Watch in the daily email has been built on that reduced set **without ever
saying so**. Nobody was checking, so nothing looked wrong. That is the defect, not the three URLs.

## 1. The replacements Cowork verified (re-verify, then commit)

Fetched live 2026-09-12. `items` is parsed `<item>` count; `newest` is the first `<pubDate>` — included
because MB2a proved that **a feed can return 200 with items and still contribute nothing** if everything
it carries is older than `fetchSectorNews()`'s 72h cutoff.

| stream | source | URL | live result | newest item |
|---|---|---|---|---|
| `government` | Federal Register — GSA | `https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=general-services-administration&per_page=20` | **200, 14 items** | 2026-09-11 |
| `healthcare` | STAT News | `https://www.statnews.com/feed/` | **200, 20 items** | 2026-09-12 |
| `healthcare` | Healthcare Dive | `https://www.healthcaredive.com/feeds/news/` | **200, 10 items** | 2026-09-11 |
| `net_lease` | Connect CRE | `https://www.connectcre.com/feed/` | **200, 10 items** | 2026-09-11 |
| `net_lease` | REBusinessOnline | `https://rebusinessonline.com/feed/` | **200, 20 items** | 2026-09-11 |

**Measured and rejected — do not re-try these:** Modern Healthcare (`/section/rss`) **403**, The Real
Deal (`therealdeal.com/feed/`) **403**.

**Keep** `Government Executive` (`https://www.govexec.com/rss/all/`) — re-verified **200, 23 items**,
newest 2026-09-11. It is the only reason the government lane is not at zero.

⚠️ **Unlike MB2a's ESRD feed, all five above publish daily**, so all five survive the 72h cutoff as-is.
That is why this is a URL swap and **MB2b's cutoff work is NOT a prerequisite** — do not pull it in here.
The ESRD feed's problem was its narrow query returning 3 items spanning weeks, not Federal Register
itself; the GSA agency feed is high-volume and behaves normally.

## 2. What "done" means (MB2a-deploy's lesson, applied)

A merged change to `supabase/functions/**` **deploys nothing and fails nothing** — this repo has no
workflow that deploys edge functions, which is exactly how MB2a's feeds sat two commits ahead of
production with a green build. So:

- Deploy: `supabase functions deploy briefing-intel-snapshot --project-ref xengecqvemvfknjvbvrq`.
  (The CLI is now installed and logged in on Scott's box. `supabase/.temp/project-ref` points at
  Dialysis_DB, so `--project-ref` is **required** — without it you deploy to the wrong project.)
- Then **re-read the deployed body** and confirm it carries the new URLs. Merged is not running.
- Then confirm each new feed wrote `item_count > 0` in `market_brief_feed_health` for today, and that
  no `market_brief_feed_stale` alert is open against a feed you just fixed.

## 3. Report (this table is the deliverable, not the diff)

Per feed: URL, status, item count, newest pubDate, and the `market_brief_feed_health` row it produced
after the deploy. If a replacement fails on re-fetch, **say so and leave that stream short** rather than
committing an unverified URL — a stream honestly down to one feed beats a stream that looks full.

## What NOT to do

Don't spoof a User-Agent to defeat a 403 without flagging it explicitly for Scott — it is a
scraping-policy question, not a technical one. Don't touch the 72h cutoff, `item_count`-vs-contribution,
or the publisher parser — those are **MB2b** and **MB2c**, deliberately separate. Don't change the
dialysis stream. Don't hand-edit `scripts/verify-rss-feeds.mjs`'s list — it parses `RSS_FEEDS` from
source precisely so it cannot drift.

## Ship + record

Update `docs/os/PLANNED-BACKLOG.md` **FEED1**, and `STATUS.md` (≤12 lines, CONSOLIDATE3 convention).
If the government lane is still thin after this, say so in the backlog rather than declaring it fixed.
