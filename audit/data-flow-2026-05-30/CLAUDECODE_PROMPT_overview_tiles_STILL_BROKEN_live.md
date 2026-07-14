# Claude Code (life-command-center) — dia Overview lower tiles STILL broken after the canonical-source deploy

## Why (live verification post-deploy of the canonical-source round, 2026-07-13)

The canonical-source round shipped and IS deployed (Completed Reviews now shows
the fixed **1,166**, Property Queue **89** — both correct). But live verification
of the dia Overview "Data Health & Coverage" lower group shows **most of the
flagged tiles are still broken** — the fix only took for the tiles that read a
DIRECT count from a view; the ones that filter a client array or fire a hanging
async still fail:

| Tile | Live now | Canonical (SQL) | Source that IS correct |
|---|---|---|---|
| **Lease Backfill** (Research Pipeline) | **1,000** | **3,039** | `v_clinic_lease_backfill_summary` (SUM clinic_count) |
| **On Market** (dia Market Activity) | **0** ("currently on market") | **184** | `v_dia_on_market` (count(*)) |
| **Ownership Coverage** — Ownership Depth / SF Prospecting / Missing SF Link | stuck **"loading…"** | ready (`v_ownership_coverage`, 1 row, fresh) | `v_ownership_coverage` |
| **Listings Needing Confirmation** — Need Confirmation | stuck **"loading…"** | ready | the uncapped count |
| **LLC Research Queue** — Queued Owners / Resolved | bars, **no numbers** | ready (`v_llc_research_queue_health`) | `v_llc_research_queue_health` |
| Completed Reviews | 1,166 | 1,166 | ✅ already fixed — the pattern to copy |
| Property Queue | 89 | 89 | ✅ already correct |

### Root cause (the fix pattern that worked vs the ones that didn't)

- **Works:** Completed Reviews + Property Queue read a **direct count/summary
  query** from a view on page load → correct number, no hang.
- **On Market = 0:** the tile filters a **client-loaded listings array** by
  `v_dia_on_market` `listing_id` membership. On the Overview that array is empty
  / not loaded, so the filter yields 0 (and the cap/price sub-tiles go blank).
  Filtering a client array is the wrong pattern for a count.
- **Ownership Coverage / Listings-confirm / LLC queue "loading…" forever:** the
  tile fires an async load that never resolves (or errors silently) — the
  repoint to the summary view either didn't ship for these specific tile
  instances or the fetch still hangs. Note the messages are the ORIGINAL
  "loading ownership data / activity data / salesforce data" text — these exact
  tile instances look untouched.
- **Lease Backfill = 1,000:** the **Research-Pipeline** Lease Backfill tile still
  reads its capped 1,000-row page. (The Action-Items lease-backfill surface may
  have been fixed, but THIS tile instance was not — there are multiple
  lease-backfill tiles; fix them all to the one summary source.)

## The fix — every remaining tile reads its number DIRECTLY from the canonical view

Apply the SAME pattern that already works for Completed Reviews/Property Queue to
every still-broken tile: a **direct count/summary read** from the canonical view
on Overview load. Do NOT filter a client-side rows array; do NOT depend on a
separate async list load that can hang.

- **On Market (dia)** → `SELECT count(*) FROM v_dia_on_market` (=184). Read the
  count directly for the tile; if the section's cap/price sub-tiles need the rows,
  fetch `v_dia_on_market` rows for THIS tile specifically (don't reuse an
  unrelated/empty array). Same for **gov** → `v_gov_on_market` (=278). The tile
  must never show 0 when the view has rows.
- **Lease Backfill** (Research Pipeline + any other lease-backfill tile) →
  `v_clinic_lease_backfill_summary` SUM(clinic_count) = 3,039. One source for
  every lease-backfill tile.
- **Ownership Coverage** (3 tiles) → read the single `v_ownership_coverage` row
  directly (Ownership Depth = `pct_property_has_true_owner` / `_recorded_owner`;
  SF Prospecting = `pct_true_owner_has_salesforce`; Missing SF Link = the
  count/inverse). Kill the hanging async; render the row. Real empty/error state,
  never a perpetual spinner.
- **Listings Needing Confirmation** → the uncapped count.
- **LLC Research Queue** → `v_llc_research_queue_health` counts (Queued Owners /
  Resolved should show NUMBERS, not empty bars).
- Apply identically to the **gov** Overview lower tiles (parity).

## Boundaries / verify

- life-command-center, client Overview render + data-fetch (`dialysis.js` /
  `gov.js`); the canonical sources are the existing views (all confirmed live +
  fresh); no new api/*.js; no migration.
- **Verify LIVE (not just node --check — the last round passed tests but the tiles
  were still broken in the browser):** load the dia AND gov Overview, scroll to
  the Data-Health group, confirm every tile shows a real number equal to its SQL
  count — On Market dia = 184 / gov = 278 (NOT 0), Lease Backfill = 3,039 (NOT
  1,000), Ownership Coverage shows the real percentages (NOT "loading"), LLC
  Research Queue shows numbers. No tile stuck on "loading", none showing 0 when
  the view has rows, none showing a round LIMIT number.
- The prior round reported these fixed but they were not live — **this round's
  acceptance is the live browser state, tile by tile**, not the test suite.

## Bottom line

The canonical-source round fixed the tiles that read a direct count (Completed
Reviews 1,166, Property Queue 89) but left the rest broken live: On Market shows
0 (should be 184), Lease Backfill still 1,000 (should be 3,039), and Ownership
Coverage / Listings-confirm / LLC queue still hang on "loading". Convert every one
of them to the same direct-count-from-the-canonical-view pattern — no client-array
filtering, no hanging async — and verify tile-by-tile in the live browser, both
domains.
