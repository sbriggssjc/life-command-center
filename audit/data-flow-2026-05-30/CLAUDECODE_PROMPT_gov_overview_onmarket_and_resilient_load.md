# Claude Code (life-command-center) — gov Overview: On Market shows 0 + whole detail load strands on any transient failure

## Why (proven live, browser + network, 2026-07-14)

The dia Overview On Market is now correct (184, direct-count). Spot-checking the
**gov** Overview On Market to close both domains surfaced TWO real defects on the
gov home page — the "similar disconnected data" Scott asked to sweep for:

1. **gov On Market tile shows `ACTIVE LISTINGS 0` "currently on market"** (canonical
   `v_gov_on_market` = **278**), with TOTAL ASKING / AVG CAP / AVG DOM all blank.
2. Reproduced across **two** fresh reloads (`?v=9`, `?v=11`), each waited 50s+: the
   gov Overview's **"Loading detailed data in background…" banner never clears**,
   `govData.listings` stays `[]` (0), `govData.onMarketIds` never gets set.

### Root cause (two things, both real)

**A. The whole gov detail load is all-or-nothing and strands on ANY transient
failure.** `gov.js` (`loadGovData`, ~line 360-422) fetches listings + v_gov_on_market
+ the data-health views in ONE `Promise.all([...])`. If ANY single query rejects
(the live network trace showed Railway cold-start `503`s on `/api/treasury` and
`/api/queue-v2`), the whole `Promise.all` rejects → **none** of the assignments run
(`govData.listings`, `govData.onMarketIds`, ownership-coverage, LLC, listings-confirm
all stay unset), the "loading" banner never clears, and every tile in the batch
blanks together. Proven live: the three detail queries each return **200 in
~600-750ms** when fetched directly (listings 1000 rows/750ms, `v_gov_on_market`
278/665ms), so the queries are healthy — the batch is **rejecting**, not slow.

**B. The On-Market COUNT reads a client-array intersection, not the canonical
count.** `gov.js` SECTION 10 (~line 4989-5010):
```js
const activeListings = govData.onMarketIds
  ? listings.filter(l => govData.onMarketIds.has(l.listing_id))   // needs the heavy listings array
  : ...;
html += govCard({ title:'Active Listings', value: fmtN(activeListings.length), ... });
```
Even when `onMarketIds` loads (278), the tile shows `listings.filter(...).length`,
which is 0 whenever the heavy `listings` pull hasn't populated. The canonical count
is simply `govData.onMarketIds.size` (=278) — already fetched — and does NOT need
the listings array. This is the same "read the count directly from the canonical
view, don't intersect a client array" doctrine already applied to dia
(`v_dia_on_market` → 184).

## The fix (both, gov-only, client-only)

**Fix B — On-Market count = `onMarketIds.size` (the direct canonical count):**
- The **Active Listings** headline count = `govData.onMarketIds ? govData.onMarketIds.size : <fallback>`
  (=278), NOT `listings.filter(...).length`. Never 0 when the view returned rows.
- The detail sub-tiles that genuinely need row fields (TOTAL ASKING, AVG ASK CAP,
  AVG DOM, UNDER CONTRACT) may still derive from the intersected `activeListings`
  rows **when `listings` is loaded**; when it isn't, show `—` (honest "detail
  loading"), but the headline count still shows 278. The count and the sub-detail
  are decoupled so a slow/failed listings pull can't zero the headline.
- Mirror the dia pattern exactly (dia reads `v_dia_on_market` rows/count directly).

**Fix A — make the gov detail load resilient (don't strand every tile on one
failure):**
- Change the shared `Promise.all([...])` in `loadGovData` to `Promise.allSettled`
  (or wrap each query in a `.catch(()=>({data:null}))`), so one query's transient
  `503` can't reject the whole batch. Assign each result defensively
  (`res.status==='fulfilled' ? res.value : null`); every downstream tile already
  has a null/empty fallback (`onMarketIds` null → `lccIsListingActive` fallback,
  etc.) — this just lets the good queries land when one fails.
- **Clear the "Loading detailed data in background…" banner on settle** (finally),
  never leave it spinning forever. A failed sub-query shows that tile's empty/error
  state ("unavailable"), not a perpetual page-level spinner.
- This also un-strands the other tiles in the same batch that were blank live
  (Listings Needing Confirmation showed "•••", plus Ownership Coverage / LLC).

## Boundaries / verify

- life-command-center, **client-only** (`gov.js` `loadGovData` + SECTION 10 On-Market
  render); no api/*.js; no migration; no DB change (`v_gov_on_market` already 200
  through the proxy — verified live, 278 rows). dia already correct — do not touch it.
- **Acceptance = the LIVE BROWSER (not the test suite):** load the gov Overview,
  scroll to **On Market** → **ACTIVE LISTINGS = 278** (not 0); confirm it renders
  even on a cold Railway start where a transient `503` hits one detail query (the
  banner clears, the other tiles fill from the queries that succeeded, the On-Market
  headline still shows 278 from `onMarketIds.size`). No page-level "loading" banner
  that never clears; no tile blank when its query returned rows.
- `node --check gov.js`; suite green.

## Documentation

Update CLAUDE.md (gov Overview / UI-Phase-2 note): the gov On-Market headline count
reads `v_gov_on_market` membership directly (`onMarketIds.size`), decoupled from the
heavy `listings` pull; the gov Overview detail load uses `Promise.allSettled` so one
transient query failure can't strand the whole page + leave the banner spinning —
each tile fails independently to its own empty/error state. One canonical On-Market
number (278), rendered resiliently, matching the dia doctrine.

## Bottom line

gov On Market shows 0 (should be 278) for two reasons: the count intersects a client
`listings` array that never loaded, and the whole gov detail `Promise.all` rejects on
any one transient 503 (leaving every tile blank + the banner stuck). Read the count
directly from `onMarketIds.size`, and make the detail load `allSettled` so it degrades
gracefully. Verify 278 renders in the live browser, including on a cold start.
