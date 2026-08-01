# Prompt 09 — Fix field_source_priority schema drift (Issue #710)
- Priority: **P0** (fails Daily DB Checks; upstream of the cap-rate/pricing errors)
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/error-triage-2026-08-01.md` §2, `field_source_priority_ramp_plan.md`, GitHub Issue #710
- Response file: `../responses/09-field-source-priority-schema-drift.response.md`

## Prompt (copy/paste to Claude Code)
```
The daily field-source-priority schema-validity audit (Issue #710, failing Daily DB Checks) reports rules
registered against columns that do not exist on available_listings, in BOTH dia and gov, all from sources
folder_feed_bov and folder_feed_master at priority 9999:
  dia.available_listings: asking_cap, asking_price, listing_price, original_price, sold_cap_rate, last_price_change
  gov.available_listings: asking_cap, listing_price, sold_cap_rate, sold_price
Real columns include: initial_price, initial_cap_rate, cap_rate, current_cap_rate, last_price, last_cap_rate,
price_change_date, price_change_history, sold_price, price_per_sf (dia); asking_cap_rate (gov).
Fix the ramp: for each rule, either RENAME field_name to the correct live column (use the nearby-column hints:
asking_cap->cap_rate/initial_cap_rate; sold_cap_rate->cap_rate; last_price_change->last_price/price_change_date;
asking_price/listing_price/original_price->initial_price; gov.asking_cap->asking_cap_rate), or DELETE the rule
if the writer was never going to populate that column. CRITICAL context: these are our authoritative OM/BOV
pricing feeds — because they point at non-existent columns, our OM asking price/cap does not land and a wrong
CoStar/calc value wins (this is an upstream cause of the 35724 6.46%-vs-6.00% cap error, prompt 01). After
remapping, verify folder_feed_bov/master actually write asking price + cap to available_listings, re-run the
audit to green, and add a CI guard that blocks registering a rule whose column is not present on the live
table. Coordinate with prompt 01 so our-OM-asking wins for our own listings.
```

## Verify
Daily DB Checks / the field-source-priority audit passes; folder_feed_bov/master write asking price+cap to real
columns; a CI guard prevents future column drift.
