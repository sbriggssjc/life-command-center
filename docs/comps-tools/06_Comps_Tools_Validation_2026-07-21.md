# Comps Tools — Live Validation Findings (2026-07-21)

Read-only validation of `rpc_query_comps` against live `government` (`scknotsqkcheojiaewwh`) and `Dialysis_DB` (`zqzrriwuavgrquhisnoa`). These are the facts the SQL and tool code were corrected to handle — record them so we don't re-derive them next session.

## Confirmed state
- **SF crawl is live & current.** gov `sf_comp_staging` last import **2026-07-20** (662 rows), dia 340 rows, all `source_system='salesforce'`. Continuous, not twice-a-year — staged data is fresh enough for v1; no on-demand flow needed yet.
- **Canonical `live` gate populated.** gov **5,686** live+priced sales, dia **3,689**. This is the deduped universe; the RPC reads `transaction_state='live' AND sold_price>0 AND exclude_from_market_metrics IS NOT TRUE`.
- **Salesforce comps mostly unpromoted.** Of 662 gov staging rows, 307 link to a property, **only 106 to a canonical sale** → v1 reads `sf_comp_staging` directly; promotion (COMP_FIELD_MAP) is the durable fix.

## Data-quality issues the SQL now handles
1. **Cap-rate unit split.** Canonical = **decimal** (gov avg 0.085, dia avg 0.068); `sf_comp_staging.cap_rate` = **percent** (gov avg 7.67, i.e. 10.4 not 0.104). → RPC divides staging cap by 100; canonical contract is always decimal.
2. **Confidential $0 sales.** Some SF comps have `status='Sold'` but `sold_price=0` (undisclosed). → `sale_price` nulled, `price_withheld=true`, comp retained (not dropped).
3. **`Link_to_OM__c` is not a URL.** It's literal text ("Check Files in Reading Pane"). Real OM bytes are in `sf_files` / Supabase storage. → contract uses a `has_om` flag (from `Files_Formula__c` presence); actual file fetch is a later join to `sf_files`.
4. **Account rows in comp staging.** gov `sf_comp_staging` = 662 rows but only **470 are comps**; 192 are Account/Company records. → every staging read filters `comp_type IS NOT NULL`.
5. **Property-type vocab split (live).** SF says "Healthcare"; gov `properties.building_type` says "Medical Office"; dia `properties.property_type` says "Office"/"Healthcare". A naive `ILIKE '%health%'` misses "Medical Office". → the tool expands a plain term (e.g. `medical`) into a synonym array (`Health, Medical, MOB, Clinic, Dialysis, Behavioral`) before querying.
6. **Cross-source address normalization differs.** Canonical `normalized_address` = "1808commonscir"; SF = "1808commonsciryukonok73099". The DB `dedup_key` therefore won't match across sources → the MCP tool recomputes a consistent key (street token + city + state + sale-year) and also matches deterministically on `source_sf_id` first.
7. **Completeness gaps.** Many canonical gov rows have null `latitude/longitude` and null `rba/sf_leased` → radius filtering and SF-size filtering are partial; the tool degrades rather than dropping such rows.

## The dedup case, seen in real data
The Yukon VA clinic at **1808 Commons Cir** appears as *four* records across sources:
| source | id | sale_date | price | note |
|---|---|---|---|---|
| salesforce | gov_sf:a1YVs…WfwX | 2026-05-20 | (withheld) | confidential $0 |
| government_db | gov_db:f4460… | 2026-05-20 | $1,538,000 | costar_sidebar |
| government_db | gov_db:57ca0… | 2026-04-24 | $1,700,000 | costar_sidebar |
| government_db | gov_db:265ed… | 2020-07-14 | $1,400,000 | prior sale (correctly distinct) |
`source_sf_id` is null on the CoStar-sourced canonical rows, so ID-matching alone won't collapse the 2026-05-20 SF↔canonical pair — the fuzzy street+city+state+year key is required. The 2020 sale is genuinely different and must NOT be merged. This is exactly why the reconcile stage exists.

## Validation outcome
The full government union query ran clean end-to-end, returning blended canonical + SF rows with cap rates normalized to decimal, `price_withheld` correctly flagged, and dedup keys generated. The gov and dia RPCs and the tool code in this folder reflect every fix above.
