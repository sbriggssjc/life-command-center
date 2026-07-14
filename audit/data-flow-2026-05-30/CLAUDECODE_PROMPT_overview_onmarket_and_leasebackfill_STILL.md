# Claude Code (life-command-center) — dia Overview: On Market still 0 + Lease Backfill still 1,000 (2 tiles left)

## Why (live browser verification, post-deploy of the sync-render round, 2026-07-13)

The sync-render round FIXED the async-hang tiles — verified live: Ownership
Coverage (84% / 11% / 2,311), Listings-confirm (500/125/135 + working list), LLC
Research Queue (0/0, no longer stuck), Completed Reviews (1,166), Property Queue
(89). But **two tiles are STILL broken in the live browser** on the dia Overview:

1. **On Market → ACTIVE LISTINGS = 0** (canonical `v_dia_on_market` = **184**).
   The whole On Market section reads 0 / blank (Active Listings 0 "currently on
   market", Avg Ask Cap blank, NM On Market 0, Avg Days blank). Root cause is the
   one you already diagnosed but the fix didn't land for this tile:
   `renderOnMarketInner` still intersects a client-side `diaAvailListings` array
   (which fails/empties on the Overview) with `diaOnMarketIds` → empty
   intersection → 0. The tile must read the COUNT directly from `v_dia_on_market`,
   not intersect a client array.
2. **Lease Backfill → 1,000** (canonical `v_clinic_lease_backfill_summary` SUM =
   **3,039**). This appears in TWO tiles, both still capped:
   - Research Pipeline → **"LEASE BACKFILL 1,000 · missing lease data"**
   - Database Health → **"LEASE COVERAGE 34.3% · 1,000+ need backfill"**
   Both still read the capped 1,000-row page (`leaseBackfillRows.length`), not
   `diaData.leaseBackfillCount` (3,039). The prior fix touched a different
   lease-backfill instance (the Research-tab step badge); these two Overview
   instances were missed.

## The fix (same direct-count pattern that already works)

- **On Market (dia)** — the ACTIVE LISTINGS number = `SELECT count(*) FROM
  v_dia_on_market` (=184), read directly on the main Overview load into `diaData`
  and rendered synchronously. Do NOT compute it as `diaAvailListings ∩
  diaOnMarketIds` — if the cap/price sub-tiles need the actual rows, fetch
  `v_dia_on_market` rows for THIS section specifically (main-loaded), so the
  count and the sub-tiles both come from the same non-empty source. The tile must
  show 184, never 0.
- **Lease Backfill (both tiles)** — point BOTH the Research-Pipeline "Lease
  Backfill" tile AND the Database-Health "Lease Coverage / N need backfill" tile
  at `diaData.leaseBackfillCount` (from `v_clinic_lease_backfill_summary`, =3,039).
  One source for every lease-backfill number on the page — no `.length` of a
  capped page, no "1,000+".
- **Check gov On Market too** — gov uses `listings ∩ onMarketIds`; confirm in the
  live browser it actually shows **278** (not 0). If gov also intersects an empty
  array, apply the same direct-count fix (`count(*) FROM v_gov_on_market`).

## Boundaries / verify

- life-command-center, client-only (`dialysis.js` / `gov.js`); no new api/*.js; no
  migration. Same sync-render-from-main-load pattern the other fixed tiles use.
- **Acceptance = the LIVE BROWSER, tile-by-tile (not the test suite — the last two
  rounds passed tests but these tiles were still wrong on screen):** load the dia
  Overview, scroll to Market Activity → On Market shows **ACTIVE LISTINGS 184**
  (not 0); scroll to Research Pipeline → **Lease Backfill 3,039** (not 1,000) and
  Database Health → Lease Coverage shows the real backfill count (not "1,000+");
  load the gov Overview → On Market **278**. No tile shows 0 when its view has
  rows; none shows a capped 1,000.
- `node --check`; suite green.

## Bottom line

Two tiles remain after the sync-render round: On Market still intersects an empty
client array (shows 0, should be 184) and the two Lease Backfill tiles still read
the capped page (show 1,000/1,000+, should be 3,039). Convert both to the direct
count-from-the-canonical-view pattern the other tiles now use, verify gov On
Market really shows 278, and confirm every number in the live browser.
