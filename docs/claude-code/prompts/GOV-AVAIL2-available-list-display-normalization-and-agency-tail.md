# GOV-AVAIL2 — the Gov Available list still mixes ALL CAPS and raw spellings in agency and address

Backlog: `GOV-AVAIL2` (+ `GOV-AVAIL1-agency-tail`). Source: Scott, 2026-09-23 screenshot of Gov › Deals › Sales › Available: "the address and naming structure still is not completely normalized and there's a ton of all caps or different naming structures of tenants."

## Measured

- GOV-AVAIL1 added `address_display`, `agency_code`, `agency_canonical_full` and `agency_resolution` to `v_available_listings`.
- The screenshot shows canonical codes where they resolve (GSA, SSA, USPS, CBP, VA, FBI, MSHA). It shows raw strings where they don't: `GENERAL SERVICES ADMINI…`, `NAVY FEDERAL CREDIT UNI…` (→ GOV-CU1), `Tennessee Department of Hu…`, `Sweet Shell Enterprises`.
- Addresses mix cases: `400 N STATE HWY 287`, `MANSFIELD`.
- Live, 490 rows: **53** `address_display` values and **50** agency values are ALL CAPS.
- GOV-AVAIL1 reported 83 of 268 agency spellings resolving and **185 unresolved spellings / 208 rows**. Note that `GENERAL SERVICES ADMINISTRATION` in capitals failing to resolve suggests the resolver is case-sensitive somewhere.

## Ask

1. **Agency tail.**
   - Measure why each of the top unresolved spellings misses the ID3a registry: case, punctuation, "GSA - X" compounds, state agencies absent from `government_agencies`.
   - Fix what is a resolver gap (a case-insensitive match is table stakes).
   - For state and local agencies, add registry rows through the existing ID3a writer or `gov_agency_aliases`, logged. Don't widen `canonicalize_agency()`'s logic without a measurement.
   - Report before/after resolution (rows and spellings).
2. **Display normalization in the view.**
   - Title-case display fields when the stored value is ALL CAPS, preserving known acronyms (USPS, SSA, GSA, VA, FBI, NASA, state codes, N/S/E/W, NE/NW, US, SR, CR, HWY → Hwy).
   - Standardize street-type abbreviations for display only. Stored values never change; the display column is derived.
   - One shared SQL function, tested.
3. **Tenant or occupant column.** Show the canonical agency short name, with the full name on hover (as GOV-AVAIL1 intended). When unresolved, show the title-cased raw string with a subtle "unresolved" marker, so it reads as a known gap and not as data.
4. Apply the same function to the Sales Comps and Leases tables, so gov reads one way everywhere. List every reader you touched.
5. Tests: casing with acronyms, the street-type display, and the resolver's case-insensitivity. Each needs a mutation that turns it red.

## Done means

- Backlog updated.
- Gov migration in `government-lease`.
- Cache busters bumped as a set; deploy = redeploy BOTH Railway services.
- Scott re-checks the screenshot view.
