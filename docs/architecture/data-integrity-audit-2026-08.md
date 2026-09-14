# Data-integrity audit: sources, coverage, precedence, linkage

Date: 2026-08-04  
Scope: Dialysis_DB (`zqzrriwuavgrquhisnoa`), Government DB (`scknotsqkcheojiaewwh`), LCC Opps provenance registry.  
Mode: audit only. No schema, backfill, dedup, or data changes were made.

## Executive findings

The existing machinery is real and should be completed, not rebuilt: domain ingestion tables, `v_sales_comps`,
`field_source_priority`, `field_provenance`, data-health snapshots, listing/sale lifecycle gates, cap recompute
functions, Salesforce staging, and the resolver/retrain stack already cover most of the canonical-record shape.
The gaps are in final-mile wiring: source fields exist but are not always projected into the record the comp
engine reads, Salesforce comps remain largely staged, provenance is mostly `record_only`, and duplicate handling
is sale-event/linkage incomplete.

Key measured state on 2026-08-04:

| Area | Dialysis | Government |
|---|---:|---:|
| `properties` | 12,364 | 20,350 |
| `sales_transactions` | 4,773 | 15,109 |
| Comp engine rows (`v_sales_comps`) | 3,022 | 4,806 |
| Active listings | 452 | 560 |
| SF comp staging | not exposed under this name in dia; `sf_listing_staging` 172 | 879 |
| Comp review queue | 192 | 105 |

The design doc's dia headline numbers are directionally right and some are corrected below:

| Dia `v_sales_comps` field | Present / 3,022 | Null rate |
|---|---:|---:|
| cap rate | 2,182 | 27.8% null |
| rent | 1,994 | 34.0% null |
| rent PSF | 1,033 | 65.8% null |
| lease expiration / term | 2,090 | 30.8% null |
| expenses | 1,732 | 42.7% null |
| bumps | 1,522 | 49.6% null |
| original ask | 1,392 | 53.9% null |
| current ask | 2,078 | 31.2% null |
| original ask cap | 1,337 | 55.8% null |
| current ask cap | 517 | 82.9% null |
| list date / DOM | 2,543 | 15.9% null |
| buyer / seller | 1,900 / 2,254 | 37.1% / 25.4% null |

The earlier design doc labeled "cap 73%, chairs 73%, patients 74%, lease 84%" as if they were null rates. The live
dia measurement shows those are mostly coverage-style statements in different source surfaces, not null rates in
`v_sales_comps`. `v_sales_comps` does not expose chairs or patients at all, so chair/patient comp coverage is a
propagation gap, not just a source gap.

## Source and ingestion inventory

| Source | Dia landing tables | Gov landing tables | Ingestion / function path | Cadence / freshness notes |
|---|---|---|---|---|
| Current/past sales | `sales_transactions`, `cap_rate_history`, `v_sales_comps` | `sales_transactions`, `cap_rate_history`, `v_sales_comps` | CoStar/sidebar writers through `api/_handlers/sidebar-pipeline.js`; master workbook imports (`historical_csv_import`, `master_xlsx_backfill_*`, `excel_master`, `sjc_track_record_v2`); SF staging promotion is partial/inert for comps. | Domain rows are live; comp read surface is `v_sales_comps`. Dia `v_sales_comps` is a materialized view refreshed by `refresh_v_sales_comps`; gov was converted to a live view with `transaction_state='live'`. |
| Current/past listings | `available_listings` | `available_listings` | Sidebar/OM/listing capture, availability checker, `auto-scrape-listings`, listing-sale reconcile trigger, SF listing staging. | `on_market_date` is canonical market-entry date; `listing_date` is raw/operational except point-in-time active stock. Dia active listing coverage: initial price 409/452, current cap 376/452, on-market date 265/452. |
| Leases | `leases`, empty `lease_rent_schedule`, `lease_escalations`, property anchor-rent columns | `leases`, `lease_escalations`, property lease fields | Sidebar, OM intake/extraction, folder feed/master imports, state inventory/prospect lead backfill for gov. | Dia `leases` has 12,827 rows; 9,168 annual rent, 2,702 renewal options. Gov `leases` has 17,674 rows; 16,159 annual rent, only 795 renewal options. |
| Salesforce records | `sf_listing_staging`, `sf_files`; comp staging may be deployment-specific/not in dia REST schema | `sf_comp_staging`, `sf_listing_staging`, `sf_files` | Salesforce object/file discovery flows and `sf-promotion-worker`; comp promoter currently reads wrong status and writes to weak/non-queryable comp targets per `docs/comps-tools/07_Comp_Promotion_Gap_Analysis.md`. | Gov SF comp staging is fresh enough to use directly: 879 rows, 516 real `comp_type`, 341 linked property, 106 linked sale. Dia listing staging has 172 rows, all NOI populated, 0 linked listing rows. |
| Prior comps / master workbook | `sales_transactions`, older `comparable_sales` path, `cap_rate_history` | `sales_transactions`; gov lacks durable comparable-sales table for SF comps | `scripts/import-master-unmatched-comps.mjs`, `scripts/master_sales_comps_full.json`, `scripts/cm-nm-track-record-import/*`, R71/R72 master backfills. | Durable state is in sales tables; raw prior unmatched table is not live in dia (`master_comps_unmatched` not present). |
| Call notes / OMs | `staged_intake_items`, `staged_intake_artifacts`, `sf_files`, domain sales/listing/lease/property columns | same pattern plus gov SF file discovery | Shared email/Copilot path: `api/_shared/intake-om-pipeline.js::stageOmIntake`; sidebar path writes domain DBs directly; SF files stage/extract from `intake-salesforce-files`. | Dia has 997 staged intake items, 1,531 SF files; only 3 `staged_intake_artifacts` visible in dia. File discovery has been production-verified in prior audit notes. |
| CMS / Medicare | `medicare_clinics`, `facility_patient_counts`, property CMS mirror fields | not applicable | Sibling DialysisProject CMS fetchers; property-CMS match and propagation jobs. | `facility_patient_counts` has 189,832 rows but only reporting-period updates. `medicare_clinics` has 8,535 rows and patient/chair fields. `facility_patient_counts.source` is populated on only 2,997 rows; latest real CMS cadence was previously flagged stale in the July audit. |
| CoStar | All core domain tables: properties, leases, sales, listings, brokers, contacts, loans, documents, public records | same categories | CoStar sidebar capture into `sidebar-pipeline.js` plus provenance collection. | High-volume source. Priority usually 60-70; useful, not authoritative. |

Important existing machinery and where it currently fits:

| Machinery | Current role | Audit note |
|---|---|---|
| `v_sales_comps` | Comp engine read surface. Dia matview in `supabase/migrations/dialysis/20260801_dia_v_sales_comps_anchor_date_projection.sql`; gov live view in `supabase/migrations/government/20260529170000_gov_sales_comps_nonlive_excluded_invariant.sql`. | The views are not canonical records; they choose one listing and one lease row per sale. They omit chairs/patients and lineage. |
| `refresh_v_sales_comps()` | Dia matview refresh helper. | Scheduled refresh exists historically; any canonical program should either keep this as a read-model refresh or replace it with a canonical read model. |
| `propagate_sales_recompute()` | Recomputes sales/listing cap-related fields when lease/rent changes. | Exists in both domains but has known dia/gov drift. Canonical plan should template this or wrap it in a shared contract. |
| `dia_recompute_caps_backfill()` | Gated dry-run-first cap backfill; auto-applies only high-confidence/in-band recomputes and emits review rows otherwise. | This is the correct pattern for canonical backfills: dry-run, confidence gates, reversible backup, review queue. |
| `dia_promote_nm_comps` / `gov_promote_nm_comps` | Northmarq/internal comp promotion path referenced by capital-markets docs. | Use as an existing promotion pattern, but do not key canonical comps by property only; use sale/listing natural IDs. |
| `field_source_priority` + `lcc_merge_field()` | LCC Opps source authority registry and merge decision function. | Live counts: 2,055 rules; 1,636,796 provenance rows; 1,155 open conflicts; 33 unranked triples; zero invalid priority columns. Most rules remain `record_only`. |
| `gracious-radiance` / resolver retrain | Record-linkage resolver stack. | Present as a retrain cron (`w44-resolver-retrain-nightly`) and corpus docs, but the comp/property canonical layer still needs deterministic keys plus review queues. |
| Health surface | `api/admin.js::handleOpsHealth`, `v_lcc_health_surface`, domain `data_health_snapshot_tick()`, cron health checks. | Existing surface can host coverage dashboards. Domain data-health snapshots already run; add source-field coverage and provenance drift metrics rather than a new dashboard. |

## Field coverage matrix

Percentages are present / total. Dia comp rows are from `v_sales_comps` (3,022). Gov comp rows are from
`v_sales_comps` (4,806). Source tables are shown where a field exists outside the comp view.

| Canonical field group | Dia comp surface | Dia source coverage | Gov comp surface | Gov source coverage | Finding |
|---|---:|---:|---:|---:|---|
| Address | 3,011/3,022 (99.6%) | properties address 12,324/12,364 | 4,801/4,806 (99.9%) | sales address 15,094/15,109; properties address 20,280/20,350 | Good coverage. |
| Size / RBA | 2,927/3,022 (96.9%) | properties building_size 1,960/3,022 comp properties in deep scan; global `building_size` exists but sampled by comp properties | 4,744/4,806 (98.7%) | sales rba 11,026/15,109; properties rba 15,942/20,350 | Good comp coverage, but dia canonical property RBA is `building_size`, while priority rules often use `building_size`/`rba` inconsistently. |
| Land | not surfaced in dia export tables as land-area field in baseline matrix | properties land_area 3,771/12,364; 1,698/3,022 comp properties | 4,806 row view has land_acres column but source coverage not counted in table above; properties/rent view carries land_acres | gov properties/rent tables carry `land_acres` | Dia land is weak at property level. |
| Year built | 2,593/3,022 (85.8%) | properties year_built 4,134/12,364 | 4,319/4,806 (89.9%) | properties year_built 10,772/20,350; sales year_built present | Source is only half-covered globally; comp surface is better because sales universe is richer. |
| Tenant / credit | dia view exposes `tenant_operator`, not `tenant`; coverage not counted in first audit query | properties tenant 10,606/12,364, operator 10,528/12,364; leases tenant 12,135/12,827 | agency 4,636/4,806 (96.5%); guarantor not exposed in view | sales agency 13,367/15,109; sales guarantor 0; leases guarantor 4/17,674 | Gov guarantor/credit is almost absent; agency is good. |
| Lease rent | rent 1,994/3,022 (66.0%); rent PSF 1,033/3,022 (34.2%) | leases annual_rent 9,168/12,827; active lease found for 1,578/3,022 comp properties | gross/noi fields exist; sold cap uses NOI hierarchy | leases annual_rent 16,159/17,674; properties gross rent/noi fields exist | Dia source has more lease rent than comp surface uses; rent schedule table is empty. |
| Bumps / escalations | bumps 1,522/3,022 (50.4%) | active lease bump source for 904/3,022 comp properties | bumps 2,604/4,806 (54.2%) | gov leases have escalation fields, but source coverage not fully measured per field | Needs canonical normalized display and chosen value lineage. |
| Options | not surfaced in dia `v_sales_comps` | leases renewal_options 2,702/12,827; active lease options for 632/3,022 comp properties | not surfaced in gov `v_sales_comps` | leases renewal_options 795/17,674 | Major source and propagation gap. |
| Lease expiration / term | 2,090/3,022 (69.2%) | active lease found for 1,578/3,022 comp properties, property anchors also exist | 3,515/4,806 (73.1%) | sales lease_expiration 3,817/15,109; properties/leases also have expirations | Reasonable in comp views, but canonical source selection is implicit. |
| Chairs / patients | not surfaced | properties total_chairs 1,473/3,022 comp properties; latest/total patients 1,391/3,022 comp properties; CMS tables have broad source data | not applicable | not applicable | For dia, this is a propagation/model gap. Add chosen chair/patient fields to canonical property/read model. |
| Sale price/date | 3,022/3,022 | sales sold_price 4,317/4,773; sale_date 4,773/4,773 | 4,806/4,806 | sales sold_price 6,460/15,109; sale_date 15,109/15,109 | Comp gates hide weaker global sale-price coverage. |
| Cap rate | 2,182/3,022 (72.2%) | sales cap_rate_final 3,018/4,773; cap_rate_history cap 17,335/17,355 | sold_cap_rate 2,780/4,806 (57.8%) | sales sold_cap_rate 5,515/15,109; cap_rate_history 4,940/4,941 | Dia corrected null rate is 27.8%, not 73%. Gov cap surface is weaker. |
| Initial ask / cap | original ask 1,392/3,022; original ask cap 1,337/3,022 | listings initial_price 2,720/5,290; initial_cap_rate 2,319/5,290 | not in gov view | listings initial_price 798/3,085; initial_cap_rate 666/3,085; sales initial fields exist | Source exists but projection differs by domain. Gov sales table has initial fields; view omits them. |
| Last/current ask / cap | current ask 2,078/3,022; current ask cap 517/3,022 | listings last_price 3,741/5,290; last_cap_rate 960/5,290; current_cap_rate exists | not in gov view | listings last_price 1,467/3,085; current_cap_rate 1,433/3,085; sales last fields exist | Dia view uses `last_cap_rate`, but source has `current_cap_rate` much more often in active listings. |
| On-market date / DOM | list_date 2,543/3,022; DOM 2,543/3,022 | listings on_market_date 4,595/5,290; comp properties with on_market_date listing 1,995/3,022 | days_on_market 4,806/4,806, no ask/date columns in gov view | listings on_market_date 2,550/3,085; listing_date 3,074/3,085 | Dia export should read `on_market_date`, not just `listing_date`. Gov view omits on-market date. |
| Buyer / seller | buyer 1,900/3,022; seller 2,254/3,022 | sales buyer 3,241/4,773; seller 3,702/4,773 | buyer 3,780/4,806; seller 3,647/4,806 | sales buyer/seller fields exist under `buyer`/`seller`, not `buyer_name`/`seller_name` | Gov naming differs; priority rules include both names and need canonical aliasing. |
| Source / lineage | not in `v_sales_comps` | sales/listings/leases have source/data_source fields; field provenance exists in LCC Opps | not in `v_sales_comps` | data_source pervasive | The comp read model lacks field-level lineage. Canonical model must carry source per chosen field. |

## Fields present in source but not propagated to comp records

1. Dia chairs/patients are available on `properties`/CMS but absent from `v_sales_comps`. Deep scan found chair data
   for 1,473/3,022 comp properties and patient data for 1,391/3,022.
2. Dia active-listing cap should prefer `current_cap_rate` when `last_cap_rate` is null. Active listings:
   `current_cap_rate` 376/452 vs `last_cap_rate` 41/452.
3. Dia `on_market_date` is present on 4,595/5,290 listings, but `v_sales_comps` uses `al.listing_date AS list_date`.
   The design doc's "on-market exists but export drops it" is correct in spirit.
4. Gov ask fields exist in `sales_transactions` and `available_listings`, but gov `v_sales_comps` does not expose
   original/current ask, ask caps, or on-market date. It exposes `bid_ask_spread` and `days_on_market` only.
5. Gov SF comp staging has 879 rows, including 516 real comps and 106 linked sales. `source_sf_id` on gov sales is
   0/15,109, so deterministic SF overlap collapse is not wired.
6. Dia `lease_rent_schedule` is empty. Lease-level annual rent exists, but periodized rent/bumps/options lineage is
   not in the comp read model.

## Precedence and reconciliation

Live LCC Opps priority registry:

| Metric | Count |
|---|---:|
| `field_source_priority` rows | 2,055 |
| `record_only` / `warn` / `strict` | 1,909 / 94 / 52 |
| `field_provenance` rows | 1,636,796 |
| `v_field_provenance_unranked` | 33 |
| `v_field_provenance_conflicts` | 1,155 |
| `v_field_source_priority_invalid_columns` | 0 |

Representative rules:

| Field family | Current ladder observed |
|---|---|
| Address/year/parcel/property fields | manual 1; county/recorded source 5-10; OM 45-50; CoStar 60-65; Crexi/description lower. |
| Dia lease rent/options/expiration | manual 1; lease_document 10; OM 30; email/folder feed 35-45; RCA 50; CoStar 60-70; Crexi 65-80. |
| Dia listing price/cap | manual 1; OM 25-30; folder/master 45; RCA 50; CoStar 60-65; LoopNet/Crexi 65-75. |
| Gov sale price/date | manual 1; county 10-15; OM 35-40; RCA 50; CoStar 60-65; Crexi 65-75; folder feed rows at 9999 strict as blocklist-style rules. |
| Gov parties/brokers | manual 1; county 15 for buyer/seller; Northmarq SF roster 20 for listing broker; OM/RCA/CoStar/Crexi lower; GLiNER/party extraction 80-85. |

Precedence gaps and risks:

1. Most rules observe rather than enforce. `record_only` means lower-quality sources can still write unless caller
   separately respects `lcc_merge_field` decisions.
2. Derived cap rules are not uniformly modeled. Dia listing `cap_rate` ranks `derived_from_rent` at 20, which is
   sensible only when rent/price inputs are confirmed. For sales, cap rules mix raw stated cap, calculated cap, and
   final cap across different physical columns; canonical selection needs an explicit "human/stated/source cap beats
   modeled cap unless modeled is the only value or source cap is implausible" rule.
3. Gov `source_sf_id` is not populated on sales despite SF staging links. This removes the best deterministic
   precedence/dedup key for Salesforce comps.
4. Current views do not expose lineage, so even when `field_source_priority` chooses well, the comp consumer cannot
   show why a value won.
5. `v_field_provenance_unranked` still has 33 triples, including `dia.sales_transactions` and `gov.sales_transactions`
   fields such as cap-source fields, notes, exclusion flags, listing-sale IDs, and NOI metadata. These are exactly
   comp-quality fields and need priority rows before stricter enforcement.
6. `v_field_provenance_conflicts` has 1,155 rows, including leases, listing prices/caps, tenant, year built, rent,
   loan amount, and source URLs. A canonical-record job should not silently pick through these; it should emit a
   review lane and use the chosen value only after deterministic priority or human resolution.

## Dedup and linkage findings

Dia duplicate-property live-sold rows:

| Metric | Count |
|---|---:|
| Properties with more than one live/priced/non-excluded sale | 610 |
| Rows inside those groups | 1,577 |
| Excess rows beyond one per property | 967 |
| Groups with more than one data source | 370 |
| Groups with `portfolio_id` populated on at least one row | 10 |
| Groups where all duplicate rows are exact same date+price | 0 |

Interpretation:

1. The 610 count is real, but it is not a simple "duplicate rows" count. Under the current gate, every group has
   different sale dates, so many are genuine repeat sales or sale-history rows on the same property.
2. The comp/export problem is not "one row per property forever"; it is "one canonical sale-event row per sale
   event, plus a subject/appraisal rule for whether to show latest sale, all repeat sales, or selected historical
   repeats."
3. 370 groups are multi-source. These need source reconciliation because near-date or same-economic-event rows can
   differ by source date, buyer/seller spelling, cap, or price.
4. `dedup_group_id` is populated on 912/4,773 dia sales and 5,119/15,109 gov sales, so there is an existing dedup
   mechanism, but it does not fully collapse the comp surface.
5. Portfolio allocations are visible but not the dominant cause in dia (10 groups have `portfolio_id` in the deep
   audit). The canonical sale-event model must still carry allocation lineage.

Gov linkage:

1. Gov `v_sales_comps` is already gated to live/non-excluded and returns 4,806 rows. Global `sales_transactions`
   has 15,109 rows with multiple states (`live`, `duplicate_superseded`, `needs_review`, `ownership_stub`).
2. Gov SF staging overlap is under-linked: 341/879 SF comp staging rows linked to a property, 106/879 linked to a
   sale, and 0/15,109 sales have `source_sf_id`.
3. Gov global `property_id` on sales is 14,810/15,109, leaving 299 sales not linked to properties. Those cannot
   participate in one-property canonical records without a review/linkage lane.

Cross-source property duplicates:

1. Both domains have property merge/dedup machinery and health queues, but the comp read model does not consume a
   single canonical property ID with source aliases and field lineage.
2. Resolver output should not overwrite source tables directly for canonical comp purposes. It should create/refresh
   a canonical-property node and alias table, then leave raw rows intact.

## Recommended canonical-record model

Use an additive canonical layer, not a destructive cleanup of raw/source tables.

### Tables / views

1. `canonical_properties` (one row per domain property node)
   - `canonical_property_id`, `domain`, `primary_source_property_id`, normalized address fields, geo, active status.
   - Do not store every field directly unless it is the chosen read-optimized value.
2. `canonical_property_aliases`
   - `canonical_property_id`, `source_system`, `source_table`, `source_pk`, `match_method`, `match_confidence`,
     `resolver_run_id`, `is_active`.
   - Source systems: `dia`, `gov`, `costar`, `salesforce`, `cms`, `email_intake`, `master_workbook`, etc.
3. `canonical_property_field_values`
   - `canonical_property_id`, `field_name`, `chosen_value`, `chosen_source`, `chosen_source_table`,
     `chosen_source_pk`, `priority`, `confidence`, `observed_at`, `chosen_at`, `lineage jsonb`.
   - This is the one-row-per-field chosen value layer. It should be generated by `lcc_merge_field`/
     `field_source_priority`, not a parallel policy.
4. `canonical_sale_events`
   - One row per sale event, not one row per property: `canonical_sale_event_id`, `canonical_property_id`,
     sale date, price, buyer/seller, cap, source event aliases, portfolio allocation fields, event confidence,
     `is_latest_sale`, `is_market_comp`, `is_duplicate_event`.
5. `canonical_listing_events`
   - Initial/current/last ask, cap, on-market date, off-market date, status, listing aliases, URL status.
6. `canonical_lease_terms`
   - Chosen active lease and lease-history rows: tenant/agency/guarantor, commencement, expiration, rent, rent PSF,
     expense structure, bumps, options, renewal metadata.
7. `v_canonical_sales_comps`
   - Read model replacing or feeding `v_sales_comps`; includes the current comp fields plus chairs/patients,
     on-market date, source/lineage columns, and conflict flags.

This model keeps raw source rows auditable, lets repeat sales remain repeat sale events, and gives every consumer
(comps, BOV, dossiers, Health) the same chosen value and lineage.

## Phased plan

### P1: Close export/read-model gaps first

Highest appraisal impact and lowest risk:

1. Extend the comp read model/export to use canonical listing fields already present:
   - Dia: use `available_listings.on_market_date` as market-entry date; keep `listing_date` as raw/capture.
   - Dia: use `COALESCE(last_cap_rate, current_cap_rate, cap_rate)` for current ask cap with lineage.
   - Gov: add ask, ask cap, on-market date, and DOM source columns to `v_sales_comps` or a companion view.
2. Add chairs/patients to the dia comp read model from canonical property/CMS fields, with "Not on file" only when
   chosen canonical field is null.
3. Normalize bumps/options display from lease fields; do not infer options when absent.

Existing functions to extend: dia `v_sales_comps` definition and `refresh_v_sales_comps`; gov `v_sales_comps`;
capital-markets export code that consumes these views.

### P2: Sale-event dedup and SF overlap

1. Build a dry-run report that groups sale candidates by property, normalized date windows, price, buyer/seller,
   source, `source_sf_id`, and portfolio metadata.
2. Treat same event vs repeat sale separately:
   - same event: one canonical sale event with multiple aliases;
   - repeat sale: multiple canonical sale events tied to one property.
3. Populate deterministic SF overlap keys:
   - gov/dia `sales_transactions.source_sf_id` or sale-event alias rows from `sf_comp_staging.linked_sale_id`;
   - do not rely on property_id only.
4. Route ambiguous groups into `dia_comp_review_queue` / `gov_comp_review_queue` or a new canonical review lane.

Existing functions/patterns to extend: sales dedup review/tick migrations, `dia_comp_review_queue` and
`gov_comp_review_queue`, `query_comps` dedup logic, `lcc_merge_field`.

### P3: Backfill source coverage with precedence

Order by comp/appraisal quality:

1. Cap/rent coherence:
   - Run dry-run-only cap/rent audits based on `dia_recompute_caps_backfill()` and gov cap framework.
   - Never let modeled cap overwrite a human/stated source cap unless source cap is implausible or explicitly
     superseded by a human review.
2. Lease terms:
   - Backfill active lease rent, expiration, bumps, options from lease docs/OM/SF files through the existing intake
     extraction stack.
   - Populate a non-empty rent schedule only from stated period/rent facts.
3. Listing economics:
   - Backfill initial/current/last price and cap from SF staging, OM files, and listing rows.
   - Promote Salesforce comps only after fixing the `sf-promotion-worker` gaps documented in
     `docs/comps-tools/07_Comp_Promotion_Gap_Analysis.md`.
4. CMS/patient/chair:
   - Treat CMS as reporting-period data. Refresh when a new reporting period exists; do not pretend a no-op daily
     run is new freshness.

Existing functions/patterns to extend: `dia_recompute_caps_backfill`, `propagate_sales_recompute`,
`sf-promotion-worker`, `stageOmIntake`, SF file discovery/extraction, `data_health_snapshot_tick`.

### P4: Continuous scrub + Health dashboard

1. Add a domain cron per canonical area:
   - canonical property/linkage refresh;
   - canonical sale-event reconcile;
   - canonical listing reconcile;
   - canonical lease-term reconcile;
   - field coverage snapshot.
2. Use pg_cron and Health surface, not another orphan report:
   - Domain DB: write coverage rows to data-health snapshots.
   - LCC Opps: mirror summary into `v_lcc_health_surface`.
   - UI: show red/amber checks for coverage regression, unranked provenance, unresolved conflicts, comp-review queue SLA, stale canonical refresh.
3. Required metrics:
   - field coverage by domain/source/table;
   - source-present-but-not-propagated counts;
   - unresolved duplicate sale-event groups;
   - `v_field_provenance_unranked` count;
   - `v_field_provenance_conflicts` count by table/field;
   - SF staging linked-property and linked-sale rates.

Existing Health hooks: `api/admin.js::handleOpsHealth`, `v_lcc_health_surface`,
domain `data_health_snapshot_tick()`, `lcc_check_cron_health`, `dia_check_queue_slas` / `gov_check_queue_slas`.

## Audit limitations

1. Live measurements used PostgREST count/read queries, not direct SQL. Aggregate grouping beyond count/sample was
   computed client-side from paged read-only pulls where needed.
2. Some source pipelines live in sibling repos (`DialysisProject`, `GovernmentProject`) and were not fully audited
   here; this doc maps their landing tables and known LCC consumers.
3. `field_provenance` source distinct samples in generic output are first-page samples; counts and priority rows are
   exact enough for this audit, and the focused priority helper fetched all priority rows.
4. No migration was created or applied. No domain rows were patched. No dedup/backfill function was invoked.

