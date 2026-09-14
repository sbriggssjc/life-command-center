# Prompt 51 — Data integrity: consolidate same-address duplicate property records (review-lane)

## Why (live comp build, 2026-08-05)
Duplicate property records for the SAME address keep leaking bare/empty rows into comps and dropping data:
- **Snellville**: property 44179 "2155 Main Street East" (complete: 8,260 SF, 16 chairs, lease 2040, ask $4.51M, 5.76%) vs property 45519 "2155 Main E St" (bare: price/cap only, `listing_id` NULL, not in `v_dia_on_market_full`). The bare dup surfaced as an empty comp.
- **9341 East 21 Street**: property 37547 (no city/state) vs 37594 (Wichita, KS). The listing links to the incomplete 37547, so city/state came back blank.
- Sold set: **269 E Caroline St** (two records, differing year_built/SF/term) and **5715 N Venoy Rd** (two records, differing lease_expiration) — same sale, duplicated.

This is the Prompt-31 same-address consolidation problem recurring.

## Task
Run the existing property-record consolidation for these same-address/different-`property_id` clusters (and any others surfaced by the same detector), through the established **dry-run → review-lane → apply** flow: reversible, backups first, repeat/legitimate distinct records preserved, **never hard-delete**. Merge the bare/incomplete record into the enriched canonical one (keep the geocode, SF, chairs, lease, listing linkage), and re-point listings/sales to the canonical `property_id`.

## Verify
- Snellville, 9341 East 21 St, 269 E Caroline St, 5715 N Venoy Rd each resolve to ONE canonical record with the complete data; the bare duplicates are consolidated (not deleted) and no longer appear independently.
- `v_dia_on_market_full` / comp pulls return the enriched record for these addresses.
- Dry-run counts + review lane + reversible apply; repeat sales preserved.
