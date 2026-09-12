# MB2a — Replace the dead dialysis feeds with three that actually respond, and make a dead feed impossible to ship again

**Repo: `life-command-center`.** Small. The URLs below were **fetched live and parsed** by Cowork on 2026-09-12 —
don't re-derive them, but **do re-fetch each one before committing** (that is the whole lesson of this row).

**Read first:** `docs/os/PLANNED-BACKLOG.md` §P18 **MB2, MB2a** · `supabase/functions/briefing-intel-snapshot/index.ts`
(`RSS_FEEDS`, ~L168–178, and `parseRss`) · `api/_handlers/market-brief-rss-tick.js` (the consumer; Ollama relevance
filter + verbatim-number check) · `docs/architecture/EXEC-BRIEFS-SPEC.md` §2–3 and the 2026-09-12 addendum ·
`docs/architecture/data-coherence-invariants.md` **I11** (a monitor must alert on its own blindness).

## Why this, why now

MB-b added a `dialysis` stream whose three URLs were never fetched. Cowork tested them live: **all three fail.**

| current URL | result |
|---|---|
| `https://www.renalandurologynews.com/feed/` | **403** (bot-blocked) |
| `https://www.nephrologynews.com/feed/` | **404** (and `/rss/` also 404) |
| `https://www.cms.gov/newsroom/rss` | **404** (the `…/newsroom/rss-feeds` page is HTML, a listing, not a feed) |

So `lcc-market-brief-rss` (cron live, 10:10 UTC) would fetch nothing, and `MARKET_BRIEF_PRSS` is correctly still off.
The healthcare stream carried no dialysis content on 2026-09-11, so today the brief's news half is empty either way.

## 1. The replacements Cowork verified (re-verify, then commit)

| source | URL | live result 2026-09-12 |
|---|---|---|
| **Federal Register — ESRD** | `https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bterm%5D=end-stage%20renal%20disease&per_page=20` | **200**, 3 `<item>`s, parses. First item a real CMS document (`federalregister.gov/documents/2026/08/21/…`). The authoritative source for the ESRD PPS rules the brief's policy section needs. |
| **Google News — dialysis operators** | `https://news.google.com/rss/search?q=dialysis+OR+DaVita+OR+%22Fresenius+Medical+Care%22&hl=en-US&gl=US&ceid=US:en` | **200**, ~100 `<item>`s, parses. Real operator/market items. |
| a publisher feed of your choosing | — | Find one that returns items **without** a browser UA. Renal & Urology News needs a UA; decide whether setting one is acceptable (it is a scraping-policy question, not just a technical one) or skip it. |

**Two caveats that matter for citation quality — handle them, don't ignore them:**

1. **Google News links are redirect URLs** (`news.google.com/rss/articles/CBMi…`), so a fact sourced from them would
   cite a redirect rather than the publisher. The item title carries the publisher as a ` - Publisher` suffix (e.g.
   *"Honolulu EMS takes 7 Kauai patients to kidney dialysis center - Honolulu Star-Advertiser"*). Either resolve the
   redirect to its final URL at ingest, or store the publisher from the title and mark `source_url` as a redirect —
   **state which, in the fact's own fields**, so a broker reading a citation is never misled.
2. **Google News is broad**, and its first item today was local EMS news, not market signal. That is what the tick's
   Ollama relevance filter is for — but measure it: report how many of the ~100 items survive relevance, and if the
   survivors are noise, tighten the query (add `cap rate`, `clinic`, `acquisition`, or a `when:7d` window) rather than
   accepting junk facts.

## 2. Make a dead feed impossible to ship again (the real deliverable)

- A **test that fetches every `RSS_FEEDS` URL** and fails when one returns non-200 or zero items. Keep it out of the
  default unit run if the suite must stay offline — a tagged/opt-in integration test plus a scheduled run is fine —
  but it must exist and be runnable in one command.
- A **feed-health record** per stream per day (items fetched, last success), and a named gap when a feed returns zero
  for N consecutive days. Per **I11**: the monitor must notice its own blindness — an empty stream must be visible,
  not silent.
- Register the streams' health in whatever producer-run/health surface already exists rather than inventing a new one.

## 3. Then flip PRSS — with evidence

Re-fetch each committed URL (paste status + item count), deploy, run the RSS tick once forced, and report: items
fetched per feed, how many survived the relevance filter, how many facts were written, and 3 sample facts with their
`source_url`/`source_title`/`source_date`. **Only then** set `MARKET_BRIEF_PRSS = on`. If the survivors are noise, say
so and leave it off — an empty news section is better than a brief full of local ambulance stories.

## What NOT to do

Don't add a feed you haven't fetched. Don't set a browser UA to defeat a bot block without saying so explicitly and
flagging it for Scott. Don't touch the P-SQL producer, the render flag, or the tab (all live). Don't widen the Ollama
prompt's latitude — the verbatim-number check stays.

## Ship + record

Update `PLANNED-BACKLOG.md` §P18 (MB2, MB2a), `docs/architecture/EXEC-BRIEFS-SPEC.md` §2–3, `STATUS.md` (≤12 lines,
per the CONSOLIDATE3 convention), `CURRENT-STATE.md` if PRSS goes on. Report the table of fetched URLs with status and
item counts — that table is the deliverable, not the code diff.
