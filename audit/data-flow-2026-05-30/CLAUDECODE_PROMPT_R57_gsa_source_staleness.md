# Claude Code — R57: GSA inventory source staleness — verify + harden the sync (the diff was never the problem)

## Why (found running the R53/runbook GSA diff catch-up, 2026-06-20)
The three Mar→Jun GSA diffs ran correctly and produced **0 events** — because the snapshots are
byte-identical, not because the diff is broken:
- `gsa_snapshots` for 2026-03-01 / 04-01 / 05-01 / 06-01 all share the **same fingerprint**
  (7,495 leases, $5,787.5M rent, 5,979 lessors). 2026-02-01 differed (7,348), so change stopped
  after the March pull.
- The monthly ingest IS running (distinct `created_at`: Apr 1, May 4, Jun 1) but
  `gsa_auto_sync.py` pulls the **same file every month** — GSA either stopped publishing new
  monthly "External" inventory files after March, or the scraper's URL templates
  (`{month_name}-{year}-External.xlsx` on gsa.gov, fallback catalog.data.gov "often months
  behind") drifted and it's silently using the stale fallback.
Consequence: `gsa_lease_events` has had nothing to record since March, R53's lessor-change
suspected sales can't surface new ones, and R56 correctly flags `gsa_lease_events` stale (external
cause).

## Unit 1 — verify the source (decides whether this is a scraper bug or an external gap)
Check whether GSA has actually published Apr/May/Jun (and current) "External" lease-inventory files:
inspect the gsa.gov leasing page (use the Chrome tools / fetch the leasing page) and the
catalog.data.gov `lease-inventory-excel-spreadsheet` package's latest resource date. Also review
`gsa_auto_sync.py`'s last few run logs / chosen source URL (did it hit gsa.gov or fall back to
catalog?). Report which case it is:
- **(a) GSA published newer files, scraper missed them** → the URL templates / page scrape drifted.
  Fix `GSA_FILE_URL_TEMPLATES` / the leasing-page scraper to find the current file. Then re-run the
  monthly ingest for the missed months so the diff produces real events.
- **(b) GSA genuinely hasn't published since March** → external data-availability gap (document it);
  nothing to fix in the pull. R56's alert correctly stands until GSA resumes.

## Unit 2 — harden the sync against silent duplicate snapshots (regardless of 1a/1b)
`gsa_auto_sync.py` should not write a new monthly snapshot that is identical to the latest one:
- Compute a content fingerprint of the fetched file (or the parsed rows) and compare to the latest
  stored snapshot. If identical, **skip writing a duplicate snapshot** and record a
  `source_unchanged` signal (and/or open/refresh a health alert "GSA inventory source unchanged
  since <date>").
- This stops the misleading "a fresh monthly snapshot exists" signal when the source is actually
  static, lets R56 distinguish "ingest broken" from "source genuinely unchanged," and avoids
  wasted identical diffs.
- Keep it conservative: a legitimately-unchanged month is possible but 3+ consecutive identical
  pulls = an alert worth surfacing.

## Guards / verify
Read-only verification in Unit 1; Unit 2 is additive (skip-write + a signal/alert), reversible.
Report: the (a)/(b) determination with evidence; if (a), the corrected source URL + the real events
the re-run produces; if (b), the documented external gap. Confirm the content-hash guard skips a
duplicate snapshot on a synthetic identical pull. `py_compile` clean; gov repo conventions.

## Addendum (web check, 2026-06-20) — leans toward (a) fixable, + a better source
A WebSearch confirms GSA's lease inventory is an **active, documented monthly product** ("posted
after the 1st of each month") — so the static-since-March is more likely our scraper targeting a
moved/renamed "External" xlsx (case a) than GSA halting publication. Also surfaced a **better,
actively-maintained source we're not using: IOLP (Inventory of Owned and Leased Properties)** —
`iolp.gsa.gov`, the catalog.data.gov `inventory-of-owned-and-leased-properties-iolp` dataset, and
the `d2d.gsa.gov` IOLP report. Recommendation for the networked run: (1) confirm the current
"External" file URL on `gsa.gov/real-estate/leasing` and fix `GSA_FILE_URL_TEMPLATES` if it moved;
(2) evaluate **repointing/adding IOLP as the primary source** (more stable, API/catalog-backed)
so the inventory feed stops depending on the month-named xlsx scrape. Either path resumes the
lease-event intelligence.

## RESOLVED a/b (data.gov fetch, 2026-06-20) — case (a), the page moved
The data.gov "Current Lease Inventory" dataset (`lease-inventory-excel-spreadsheet`) shows
**Dataset Last Updated: 2026-05-20** (`modified: 2026-05-20T15:39:23Z`, contact Matt Crothers /
matthew.crothers@gsa.gov) — **GSA is actively maintaining it; this is NOT an external freeze.**
The catalog's distribution `accessURL` is now **`https://www.gsa.gov/real-estate/real-estate-services/leasing-overview`**, but `gsa_auto_sync.py` targets the OLD page
`GSA_LEASING_PAGE = "https://www.gsa.gov/real-estate/leasing"`. So our scraper is hitting a
moved/stale page and falling back to the same old file → identical snapshots since March.
**Concrete fix:** repoint `GSA_LEASING_PAGE` to `…/real-estate-services/leasing-overview`, re-find
the current "External" inventory file link there (the file URL is on that JS-rendered page — load
it with the Chrome tools to capture the exact `.xlsx` href + update `GSA_FILE_URL_TEMPLATES`), then
re-run the monthly ingest for Apr/May/Jun so the diff produces real lease events. The content-hash
guard (Unit 2) then confirms fresh data landed (writes a new snapshot, clears `source_static_alert`).

## Bottom line
The GSA diff catch-up correctly produced 0 events — the snapshots are identical because the GSA
inventory source has served the same file since March. R57 determines whether that's a fixable
scraper drift or an external GSA gap, and hardens the sync so a static source is flagged loudly
(not silently re-snapshotted) — so R53's lease-event intelligence resumes the moment GSA data flows
again, and we know immediately if it doesn't.
