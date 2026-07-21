# `query_comps` + `synthesize_comps` — Build Spec (v1, live-schema-verified)

**Date:** July 21, 2026
**Target:** `life-command-center/mcp/server.js` (the Railway-hosted LCC MCP server), read-only, PostgREST-fetch pattern
**Verified against:** live `Dialysis_DB` (`zqzrriwuavgrquhisnoa`) and `government` (`scknotsqkcheojiaewwh`) on 2026-07-21
**Companion:** `LCC_Comps_Tools_REVISED_Architecture.md`, `salesforce_schema_catalog.json`

---

## 0. Live-inspection findings that shape this spec

| Finding | Number | Consequence for the build |
|---|---|---|
| SF crawl is live & current | gov `sf_comp_staging` last import **2026-07-20**; 662 rows | Staged data is fresh — no on-demand flow needed for v1 |
| `sf_comp_staging` mixes record types | 662 rows = **470 real comps** + 192 Account/Company rows | **Every staging read must filter** `WHERE comp_type IS NOT NULL` (equiv. `raw_row ? 'Comp_Type__c'`) |
| SF comps largely unpromoted | 307/662 linked to a property, **only 106 linked to a canonical sale** | v1 reads `sf_comp_staging` directly for SF comps; promotion (§6) is the durable fix |
| Canonical `live` gate is real | gov **5,686** live/priced, dia **3,689** live/priced sales | The orchestrator's single gate = `transaction_state='live' AND sold_price>0` |
| Vertical schemas differ | gov `sales_transactions` has `agency/rba/gov_occupancy_pct`; dia is dialysis-shaped, address/type live on `properties` | Tool needs a **per-vertical map** + a `properties` join; canonical contract hides the difference |
| SF back-reference exists | `sales_transactions.source_sf_id` / `sf_deal_id` | Gives a deterministic dedup key between canonical and Salesforce comps |

---

## 1. The canonical comp contract (the tool's output row)

Every source normalizes to this shape. This is the object `query_comps` returns and the orchestrator operates on.

```jsonc
{
  "comp_id":        "gov_sf:a1YVs0000008SWz",   // "<vertical>_<source>:<natural id>"
  "source":         "salesforce",                // salesforce | government_db | dialysis_db
  "vertical":       "government",                // government | dialysis
  "comp_type":      "sale",                       // sale | lease (availability => on_market flag)
  "on_market":      false,                        // true when it comes from available_listings / SF Status<>Sold
  "provenance_tag": "External",                   // SF Comp_Type__c (External/Internal); null for canonical
  // classification
  "property_type":  "Healthcare",
  "property_subtype":"VA Clinic",
  "is_government":  true,
  "gov_category":   "Federal",                    // Federal | Local/State | null
  "tenant":         "US Department of Veterans Affairs",
  "guarantor":      "US Government",
  // location
  "address":"2414 E Shawnee Rd","city":"Muskogee","state":"OK","zip":"74403",
  "metro":"Tulsa","latitude":35.7,"longitude":-95.4,
  // size / age
  "building_sf":8031,"land_acres":0.58,"year_built":1990,"year_renovated":2020,
  // sale economics (populated when comp_type=sale & on_market=false)
  "sale_price":1450000,"price_per_sf":180.55,"cap_rate":0.104,"noi":150825,
  "sale_date":"2026-06-05","occupancy":null,"sale_conditions":null,
  // on-market economics (populated when on_market=true)
  "list_price":1723000,"list_cap":0.0825,"days_on_market":808,
  // lease economics
  "rent_per_sf":18.78,"annual_rent":150825,"expense_type":"NNN",
  "lease_term_years":2,"term_remaining_at_sale":4.32,"lease_expiration":"2030-09-29",
  "escalation":"Yes",
  // quality / provenance
  "validation_status":"Validated","confidence":0.9,
  "record_link":"https://<sf>/a1YVs0000008SWz",
  "om_link":"https://...",                        // SF Link_to_OM__c when present
  "as_of_date":"2026-07-20",
  "dedup_key":"muskogee-ok|2414-e-shawnee|2026-06-05",
  "raw": { }                                       // untouched source row
}
```

---

## 2. Data-source matrix — what `query_comps` reads

| Vertical | Comp kind | Table | Gate / filter | Join for geo+type |
|---|---|---|---|---|
| government | closed sale | `sales_transactions` | `transaction_state='live' AND sold_price>0 AND exclude_from_market_metrics IS NOT TRUE` | `properties` (lat/lng, building_type) |
| government | on-market | `available_listings` | `is_active AND off_market_date IS NULL AND sold_date IS NULL AND exclude_from_listing_metrics IS NOT TRUE` | `properties` |
| government | salesforce | `sf_comp_staging` | `comp_type IS NOT NULL` (drop Account rows); sale ⇒ `status ILIKE 'sold'`, on-market ⇒ `status IN ('Available','Under Contract')` | self (parsed cols + `raw_row`) |
| dialysis | closed sale | `sales_transactions` | `transaction_state='live' AND sold_price>0 AND exclude_from_market_metrics IS NOT TRUE` | `properties` (address/type/lat/lng) |
| dialysis | on-market | `available_listings` | `is_active AND off_market_date IS NULL AND sold_date IS NULL` | `properties` |
| dialysis | salesforce | `sf_comp_staging` | same as gov staging | self |

> Dialysis `sales_transactions` has no address/property_type of its own — they come from the `properties` join (`property_type`, `building_type`, `latitude`, `longitude`, `address`). Government `sales_transactions` carries its own `address/city/state` plus `agency`/`government_type`; property type for gov is inferred from `properties.building_type` or the SF comp's `Property_Type__c`.

---

## 3. Recommended implementation: one RPC per vertical, thin MCP tool

Push the per-vertical SQL into a Postgres function on each project that returns the canonical row and **UNIONs canonical + Salesforce staging in one call**. The MCP tool then just calls each project's `/rpc/rpc_query_comps` via the existing PostgREST fetch and merges. This keeps `server.js` thin and puts the column-mapping where the columns live.

### 3.1 Reference RPC (government) — abbreviated, real columns

```sql
create or replace function rpc_query_comps(
  p_comp_type       text default 'sale',        -- 'sale' | 'lease' | 'both'
  p_property_types  text[] default null,        -- canonical types, matched loosely
  p_states          text[] default null,
  p_metros          text[] default null,
  p_date_from       date   default null,
  p_date_to         date   default null,
  p_sf_min          int    default null,
  p_sf_max          int    default null,
  p_government_only boolean default false,
  p_include_sf      boolean default true,
  p_include_onmkt   boolean default false,
  p_limit           int    default 200
) returns setof jsonb
language sql stable as $$
  -- (A) canonical closed sales
  select to_jsonb(c) from (
    select
      'gov_db:'||s.sale_id            as comp_id,
      'government_db'                 as source,  'government' as vertical,
      'sale'                          as comp_type, false as on_market,
      p.building_type                 as property_type,
      (s.government_type is not null) as is_government,
      s.government_type               as gov_category,
      s.agency                        as tenant,   s.guarantor,
      s.address, s.city, s.state, p.zip_code as zip,
      p.latitude, p.longitude,
      coalesce(s.rba, s.sf_leased)    as building_sf,
      s.year_built,
      s.sold_price, s.sold_price_psf as price_per_sf, s.sold_cap_rate as cap_rate,
      s.noi, s.sale_date, s.sale_conditions,
      s.gross_rent_psf as rent_per_sf, s.expenses as expense_type,
      s.total_term_years as lease_term_years, s.lease_expiration,
      s.source_sf_id, s.data_source,
      lower(coalesce(s.normalized_address,s.address))||'|'||s.sale_date as dedup_key
    from sales_transactions s
    left join properties p on p.property_id = s.property_id
    where s.transaction_state = 'live' and s.sold_price > 0
      and s.exclude_from_market_metrics is not true
      and (p_states is null or s.state = any(p_states))
      and (p_date_from is null or s.sale_date >= p_date_from)
      and (p_date_to   is null or s.sale_date <= p_date_to)
      and (p_sf_min is null or coalesce(s.rba,s.sf_leased) >= p_sf_min)
      and (p_sf_max is null or coalesce(s.rba,s.sf_leased) <= p_sf_max)
      and (p_government_only is false or s.government_type is not null)
      and (p_property_types is null or exists (
            select 1 from unnest(p_property_types) t where p.building_type ilike '%'||t||'%'))
  ) c
  where p_comp_type in ('sale','both')

  union all
  -- (B) Salesforce-staged comps (real comps only), sale side
  select to_jsonb(c) from (
    select
      'gov_sf:'||st.sf_comp_id        as comp_id,
      'salesforce'                    as source, 'government' as vertical,
      'sale'                          as comp_type,
      (st.status is distinct from 'Sold') as on_market,
      st.property_type, st.primary_use as property_subtype,
      (st.raw_row->>'Government__c')::boolean as is_government,
      st.raw_row->>'Gov_Category__c'  as gov_category,
      st.tenant, st.raw_row->>'Guarantor__c' as guarantor,
      st.street as address, st.city, st.state, st.zip_code as zip,
      st.raw_row->>'Metro_Name__c'    as metro,
      st.building_sf, st.land_acres, st.year_built, st.year_renovated,
      st.sold_price, st.price_sf as price_per_sf, st.cap_rate,
      nullif((st.raw_row->>'NOI__c'),'')::numeric as noi,
      st.sold_date, st.listing_price, nullif(st.raw_row->>'List_Cap__c','')::numeric as list_cap,
      st.annual_rent, nullif(st.raw_row->>'Rent_SF__c','')::numeric as rent_per_sf,
      st.raw_row->>'Expenses__c' as expense_type,
      st.lease_term_years, st.lease_expiration, st.term_remaining,
      st.raw_row->>'Validation_Status__c' as validation_status,
      st.raw_row->>'Link_to_OM__c'    as om_link,
      st.sf_comp_id                   as record_link,
      lower(coalesce(st.normalized_address,st.street))||'|'||st.sold_date as dedup_key
    from sf_comp_staging st
    where st.comp_type is not null                         -- <<< drops the 192 Account rows
      and p_include_sf
      and (st.status ilike 'sold' or p_include_onmkt)
      and (p_states is null or st.state = any(p_states))
      and (p_property_types is null or exists (
            select 1 from unnest(p_property_types) t where st.property_type ilike '%'||t||'%'))
      and (p_government_only is false or (st.raw_row->>'Government__c')::boolean is true)
      and (p_date_from is null or st.sold_date >= p_date_from)
      and (p_date_to   is null or st.sold_date <= p_date_to)
  ) c
  where p_comp_type in ('sale','both')
  limit p_limit;
$$;
```

*(The dialysis RPC is the same skeleton with the dia column names — sales_transactions is thinner, so more fields come from the `properties` join: `p.property_type`, `p.address`, `p.building_size`, `p.latitude/longitude`. The Salesforce block is identical because `sf_comp_staging` has the same shape on both projects.)*

### 3.2 The MCP tool (`server.js`) — thin fan-out

```js
// tool: query_comps
async function queryComps(args) {
  const params = mapArgsToRpc(args);                 // canonical args -> RPC params
  const targets = args.verticals ?? ['government','dialysis'];
  const results = await Promise.all(targets.map(v =>
    pgrest(v, '/rpc/rpc_query_comps', params)        // existing fetch helper, per-project env
      .catch(e => ({ error: v, detail: e.message })) // degrade gracefully, don't fail all
  ));
  const rows = results.flatMap(r => Array.isArray(r) ? r : []);
  const merged = dedupe(rows);                        // §5 dedup by dedup_key / source_sf_id
  return { comps: merged.slice(0, args.limit ?? 200),
           meta: { by_source: countBy(merged,'source'),
                   warnings: results.filter(r=>r.error) } };
}
```

`pgrest(vertical, path, body)` is the same PostgREST fetch the other 6 MCP tools already use, keyed by `GOV_/DIA_SUPABASE_URL+KEY`. All read-only.

---

## 4. `query_comps` — tool interface (MCP)

```
name: query_comps
description: Pull sales or lease comps on demand across the dialysis DB, government DB,
             and Salesforce-staged comps, normalized to one shape.
input:
  comp_type:       "sale" | "lease" | "both"           (default "sale")
  verticals:       ["government","dialysis"]            (default both)
  property_types:  ["Healthcare","Office", ...]         (canonical, loose-matched)
  states:          ["OH","OK"]
  metros:          ["Tulsa"]                             (optional)
  date_from / date_to: ISO date                          (sale/commencement window)
  size_min_sf / size_max_sf: int
  government_only: bool                                  (uses Government__c / government_type)
  include_salesforce: bool  (default true)
  include_on_market:  bool  (default false)
  limit:           int (default 200, hard cap 500)
output: { comps: [<canonical comp>], meta: { by_source, returned, truncated, warnings } }
```

Behavior: filter push-down into the RPC (never fetch-all-then-filter), explicit `truncated` when capped, graceful per-vertical degradation (one project down → return the rest + a warning), always emit `by_source` counts.

---

## 5. `synthesize_comps` — orchestrator interface (MCP)

```
name: synthesize_comps
description: Turn a plain-language comp request into one ranked, de-duplicated, template-ready
             comp set assembled from every relevant source.
input: { request: "<plain language>", export?: "sales_template"|"lease_template"|"none", limit? }
```

Pipeline:
1. **Parse** the request → `query_comps` args (LLM step); **echo the interpreted query** back in the result.
2. **Route** — pick verticals + `government_only` from the intent using this table:
   - type ∈ {Healthcare, medical, MOB} → both verticals + Salesforce; if VA/GSA/federal/state words present → set `government_only`/include gov.
   - "government" / agency names / "VA" / "GSA" → `government_only=true`, government vertical + Salesforce.
   - plain "office"/"retail"/"industrial" → Salesforce + government (its office/retail comps); dialysis only for its office-rent rows.
3. **Fan out** via `query_comps` (already parallel across verticals).
4. **Dedup** the SF↔canonical overlap: match on `source_sf_id == sf_comp_id` first (deterministic — 106 known gov links), then fall back to `dedup_key` (normalized address + sale/commencement date). Merge, don't double-count — this is the GSA/VA-appears-twice case.
5. **Reconcile** conflicts by calling the existing `lcc_merge_field` priority logic (or its `field_source_priority` ranking) rather than a bespoke policy.
6. **Rank** by a transparent weighted score (geo proximity, property-type exactness, recency, size similarity, credit) — surface the score.
7. **Export** — hand the ranked canonical list to the `briggs-comps` skill's template writer; never overwrite its formula-protected columns.

Returns `{ file?, comps:[…scored…], summary:{ interpreted_query, by_source, by_type, excluded, warnings }, provenance:[per-source query + counts] }`.

---

## 6. Closing the promotion gap — `COMP_FIELD_MAP` (staging → canonical)

To move the ~84% of Salesforce comps that are staged-but-not-promoted into the deduped canonical layer, the `sf-promotion-worker` needs the Comp mapping (the plan only wired Property). Map `sf_comp_staging` → `sales_transactions` (sale) / `available_listings` (on-market), each field promoted through `lcc_merge_field(source='salesforce', …)`:

| `sales_transactions` column | from `sf_comp_staging` | notes |
|---|---|---|
| `sold_price` | `sold_price` (raw_row `Price__c`) | only when `status ILIKE 'sold'` |
| `sold_cap_rate` | `cap_rate` (raw_row `Cap_Rate__c`) | raw, not the formula fields |
| `sale_date` | `sold_date` | |
| `noi` | raw_row `NOI__c` | |
| `sold_price_psf` | `price_sf` | or derive |
| `guarantor` | raw_row `Guarantor__c` | |
| `land_ownership_type` | raw_row `Land_Ownership_Type__c` | |
| `sale_conditions` | raw_row `Sale_Conditions__c` | |
| `expenses` | raw_row `Expenses__c` | |
| `government_type` | raw_row `Gov_Category__c` | Federal / Local-State |
| `agency` | `tenant` | |
| `total_term_years` | `lease_term_years` | |
| `source_sf_id` | `sf_comp_id` | **the dedup back-reference — set this always** |
| `comp_type` / `transaction_type` | `comp_type` (External/Internal) → map to your `transaction_type` vocab | |
| `data_source` | const `'salesforce'` | |

Promotion rules: run **report-only first** (per the plan's `enforce_mode` dial); Salesforce ranks low for underwriting-derived fields (NOI, cap) and public-record ownership, high for listing/marketing status and its own IDs — seed `field_source_priority` accordingly. Set `source_sf_id` on every promoted row so dedup in §5 becomes deterministic and the overlap collapses permanently.

---

## 7. Build checklist

1. **RPC (gov)** — deploy `rpc_query_comps` on `scknotsqkcheojiaewwh`; validate against the Muskogee VA fixture (§1 canonical example).
2. **RPC (dia)** — same, with dia column map + `properties` join.
3. **MCP tool `query_comps`** — add to `server.js` (thin fan-out §3.2); wire `DIA_/GOV_SUPABASE_*` if not already; register in the tool list + README.
4. **Verify** — golden requests: "government medical sales in OK last 12 mo", "office sales in TX", confirm `by_source` counts and that the 192 Account rows never appear.
5. **`synthesize_comps`** — add orchestrator; reuse `query_comps`; wire `briggs-comps` export.
6. **Promotion follow-on** — add `COMP_FIELD_MAP` to `sf-promotion-worker`, run report-only, review `field_provenance`, then flip trusted fields to `strict`.

---

## 8. Open confirmations (small)

- **Salesforce base URL** for `record_link` / `om_link` (to turn a `sf_comp_id` into a clickable deep link).
- **Dialysis `properties.property_type` vs `building_type`** — confirm which is the authoritative type for dia comps (spec uses `property_type`, falls back to `building_type`).
- **Full `Property_Type__c` value set** for non-government verticals (I have Office/Healthcare/Retail (ST)/Industrial/Special Purpose from the GSA slice) so `property_types` loose-matching is complete.
- **`comp_scope`** column exists on gov canonical — confirm whether it already segregates "market comp" vs internal, so the RPC can respect it.
```
