# FLAGS-geocode-on — turn the Geocodio tier on (free, 2,500/day) and clear the 3,467 properties with no lat/lng

**Filed:** 2026-09-16 (Cowork), from decision **S3** ("if it's free, get these functions working").
**Owner:** LCC (`api/_handlers/geocode-backfill.js`, the geocode cron, the flag registry).
**Read first:** the handler's header (the cascade: Census → Geocodio → Google) and backlog `FLAGS-geocode`.

## What is true (measured 2026-09-16)

- The geocode backfill **is working** on the free, keyless Census tier. `GEOCODIO_API_KEY` and
  `GOOGLE_MAPS_API_KEY` are unset, so tiers 2 and 3 are skipped silently (the handler warns once per tick).
- Left ungeocoded: **dia 1,707 of 11,828** properties, **gov 1,760 of 20,511** — 3,467 total, the
  long tail Census could not place (suites, abbreviations, PO-box-shaped addresses).
- Geocodio's free tier is 2,500 lookups/day, no card; the handler already implements the Geocodio
  call. Google is paid and stays off (S3 said free).
- The `government-lease` repo's CI already lists a `GEOCODIO_API_KEY` secret (its pre-flight checklist)
  — a key may exist. Scott confirms which account; if none, he creates one at geocod.io (free plan).

## What to build

1. **Operator step (Scott, in `OPERATOR-CHECKLIST.md` as D4):** add `GEOCODIO_API_KEY` to the Railway
   `tranquil-delight` service variables (and the standalone MCP service if it runs the tick — check
   which service the geocode cron hits). Railway redeploys on variable change.
2. **A daily cap in code, not in hope:** the tick counts Geocodio calls per UTC day (a row in the
   existing producer ledger or a small `geocode_tier_usage(day, tier, calls)` table) and stops using the
   Geocodio tier at **2,400** for the day — Census keeps running. Report the cap in the tick's JSON.
3. **Flag registry:** record the reason as "on — free tier, capped 2,400/day (S3, 2026-09-16)"; record
   `GOOGLE_MAPS_API_KEY` as "off by decision — paid (S3)". That closes the INVENTORY1b open question.
4. **Measure after two ticks:** dia/gov `latitude IS NULL` counts before and after; the Geocodio hit
   rate on the Census-miss population (expect the long tail to shrink by half or more, not vanish);
   a list of the still-unplaced addresses by shape (PO box, missing city, etc.) for a later pass.
5. Tests: the cap stops Geocodio at the threshold and Census continues; a missing key still runs
   Census-only with one warning; the tick JSON carries `patched_geocodio` and the day's usage.

## Prohibitions

- ⛔ No Google calls. ⛔ Do not geocode rows that already have coordinates. ⛔ Redeploy both Railway
  services and confirm `/version`.
