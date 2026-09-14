# MB2b / MB2c / FEED2-test — fix the instrumentation, THEN decide on PRSS

**Repo: `life-command-center`.** Three coupled defects, all of the same kind: **our own measurements are
wrong**, not the sources. Bundled deliberately — each one on its own would be a round for a few lines,
and together they are exactly what decides whether `MARKET_BRIEF_PRSS` can ever be turned on.

**Read first:** `docs/os/PLANNED-BACKLOG.md` **MB2b, MB2c, FEED2, MB2a** ·
`supabase/functions/briefing-intel-snapshot/index.ts` (`splitGoogleNewsTitle`, `parseRss`,
`fetchSectorNews` incl. the 72h `cutoff` and the feed-health writer) ·
`supabase/migrations/20260912190000_lcc_feed2_streak_counts_checks_not_days.sql` ·
`docs/architecture/data-coherence-invariants.md` **I11** (and the new "I11 can fail INVERTED" note).

⚠️ **Deploy is a manual step and this repo has no workflow for it.** After merging you must run
`supabase functions deploy briefing-intel-snapshot --project-ref xengecqvemvfknjvbvrq`
(`--project-ref` is REQUIRED — `supabase/.temp/project-ref` points at Dialysis_DB) and then **re-read the
deployed body**. Merged is not running; this has already bitten twice (MB2a-deploy).

---

## 1. MB2c — the publisher parser drops hyphenated outlets (one character)

`splitGoogleNewsTitle()` matches the trailing " - Publisher" suffix with `([^-–—]+)$`, which **forbids a
hyphen inside the publisher name**. When it fails, `publisher` is `null` AND the raw suffix is left in
the headline — silently returning the citation to the state MB2a added `source_publisher` to fix.

**Cowork measured the fix on the live feed 2026-09-14 (101 real titles carrying a separator):**

| regex | titles parsed |
|---|---|
| current `^(.*)[\s]+[-–—][\s]+([^-–—]+)$` | 98 |
| proposed `^(.*)\s+[-–—]\s+(.+)$` | **101** |
| previously-correct parses **changed** | **0** |

The greedy `(.*)` already anchors to the LAST separator, so widening the tail is sufficient — no
"split on last occurrence" rewrite needed. Real failures it fixes, all from today's feed:

- `… kidney dialysis center - Honolulu Star-Advertiser`
- `DaVita stock heads into the open after a 0.01% dip - ad-hoc-news.de`
- `Fresenius Medical Care stock heads into the open after a 0.13 percent dip - ad-hoc-news.de`

**Test corpus must include** those three, plus these real titles that must keep parsing unchanged (they
contain hyphens BEFORE the separator, which is what makes a naive rewrite dangerous):

- `Nature Medicine Commission on dialysis policy in low- and middle-income countries - nature.com`
- `Ready4 Ci-Ca: Innovation in clinical education - Fresenius Medical Care`
- `NYC Health + Hospitals/Gouverneur Opens Dialysis Den … - NYC Health + Hospitals`

A title with no separator must still return `publisher: null` and the headline untouched — never guess.

## 2. MB2b — a feed can be "healthy" and contribute nothing

Two separate bugs, measured live:

**(a) One 72h window for every feed.** `fetchSectorNews()` drops any item older than 72 hours. The
Federal Register ESRD feed returns **200 with 3 items and contributes 0**, every time, because that
query yields ~3 documents spanning WEEKS. Give a feed its own freshness window (e.g. an optional
`maxAgeHours` on the `RSS_FEEDS` entry, defaulting to 72) rather than a blanket exemption for "policy"
feeds. ⚠️ **Do not widen the window globally** — the 72h rule is what keeps the daily brief daily.
Note the sharper diagnosis: **the problem is the narrow QUERY's low volume, not Federal Register** —
the FR GSA-agency feed on the same service publishes daily and behaves normally. So also consider
whether the ESRD query itself should be broadened.

**(b) `item_count` records PARSING, not CONTRIBUTION.** `market_brief_feed_health.item_count` is the
parsed count before the cutoff filter, so Federal Register sits green at 3 while adding nothing. Record
items-after-cutoff as well (a second column — additive, don't repurpose the existing one, consumers read
it). **This is the point of the monitor**: per I11, a feed that contributes zero must be visible as a
named gap, and right now it is invisible precisely because it looks healthy.

## 3. FEED2 — the streak fix has no test

`20260912190000` fixed the monitor to count **checks, not calendar days**, after it read `9999` for every
feed including ones that had just returned 15 items. Two bugs: calendar-day arithmetic (producer runs
`* * 1-5`, checker runs daily → **Monday − Friday = 3** → healthy feeds alert) and a `9999` sentinel
standing in for "unknown" (→ the first run alerts on everything). Verified live since: cron has run
twice, zero alerts, max streak 1. **But nothing guards it.** Add a test over the view's logic with at
least these cases:

- healthy feed checked Mon–Fri, items every time → streak 0 across the weekend boundary (the regression)
- feed with no history at all → does NOT alert
- feed with 3 consecutive zero-item checks → DOES alert (positive control)
- retired feed (no longer in `RSS_FEEDS`) → stops accruing, never alerts forever

## 4. Then, and only then, judge PRSS

With (1)–(3) deployed, run the RSS tick once forced and report: items fetched per feed, items surviving
the cutoff, how many survived the Ollama relevance filter, facts written, and 3 sample facts with
`source_url` / `source_publisher` / `source_url_is_redirect` / `source_date`.

**Cowork's measurement on 2026-09-12 was 0 of 6 dialysis items worth anything** — local EMS coverage, a
Canadian wildfire item, a $4,100 clinic refund, a PFAS suit, a supplier award, and a DaVita one-day
stock move already read off the DVA ticker. If tightening the query (`cap rate`, `clinic`,
`acquisition`, a `when:7d` window) does not change that materially, **say so and leave PRSS off.** An
empty news section is a correct outcome here, not a failure to deliver.

## What NOT to do

Don't touch the P-SQL producer, the render flag, or the tab (all live). Don't widen the Ollama prompt's
latitude — the verbatim-number check stays. Don't repurpose `item_count`. Don't add a feed you haven't
fetched. Don't flip PRSS to show progress.

## Ship + record

Update `docs/os/PLANNED-BACKLOG.md` (**MB2b, MB2c, FEED2**), `docs/architecture/EXEC-BRIEFS-SPEC.md`,
and `STATUS.md` (≤12 lines). Report the per-feed table — fetched / after-cutoff / after-relevance /
facts written. **That table is the deliverable, not the diff.**
