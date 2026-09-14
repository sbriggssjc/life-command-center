# Dossier build — copy/paste prompts for Claude Code

Send these to Claude Code (with repo + Supabase access) on your own schedule, one at a time. Each is
standalone — Claude Code has **no** memory of the Cowork thread, so every prompt repeats the IDs it needs.
Paste the **context block** first (or leave it at the top of each prompt — it's already inlined below).

Ordering: run **Prompt 0** first (it reconciles design-intent vs. what production actually returns for this
record, so you see the true starting point), then work the P0 → P3 prompts. The last prompt (Location &
Trade Area) pairs with the new dossier section.

---

## Context block (facts every prompt reuses)

```
Gold-standard record: 5247 Airways Blvd, Memphis, TN 38116 — single-tenant DaVita dialysis, sale-leaseback.
  - dialysis DB (Supabase project zqzrriwuavgrquhisnoa):  property_id 23654 · CCN/medicare_id 442740
  - OPS DB (Supabase project xengecqvemvfknjvbvrq):        asset entity bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0
  - geocode: 35.005382, -89.989957
Design spec lives in the repo:
  - docs/architecture/dossier-standard-and-llm-contract.md          (§1 grounding contract, §3 sections, §7/§8 v2 fields)
  - docs/architecture/dossier-example-5247-airways-v2.html           (the gold-standard render = the target)
  - docs/architecture/dossier-v2-audit-and-triage.md                 (the topic-by-topic HAVE/SHOULD/DISPLAYS/GAP/FIX)
Grounding rule (non-negotiable): never fabricate. Absent field → "Not on file". Computed → label "Derived"
  with inputs. Conflicts → surface, don't silently resolve. Owner is never the operator.
```

---

## Prompt 0 — Design-intent vs. production reconciliation (RUN FIRST)

```
Read docs/architecture/dossier-example-5247-airways-v2.html and docs/architecture/dossier-standard-and-llm-contract.md
(§3 + §7/§8). Those define what the property dossier is DESIGNED to display for 5247 Airways Blvd, Memphis
(dialysis DB zqzrriwuavgrquhisnoa property_id 23654, CCN 442740; OPS DB xengecqvemvfknjvbvrq asset entity
bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0).

Now determine what our PRODUCTION code path actually returns for this same record today. Trace the live
property-panel / contact360 loaders and the dossier packet assembler (api/_handlers/entities-handler.js and
whatever the property detail panel calls), and for THIS property capture the real values currently produced.

Output a single field-by-field reconciliation table with these columns:
  Field/Section | Design intends (from v2 spec) | Production returns today (actual value for 23654) | Gap | Root-cause file:line
Cover every row of the v2 dossier: Snapshot (incl. stations, price/SF, value basis), Location & Trade Area
(map, 1/3/5-mi demographics, ZIP census, payer mix), Ownership (incl. original developer), Tenancy & Lease
(tenant, guarantor, Year-1 vs current rent + $/SF, term remaining, responsibilities, bumps-in-options),
Operations (stations, patients+trend, treatments, revenue/EBITDA, cert date, relocation), Market Competition,
Transaction & Marketing Timeline, BD Efforts, Documents (with reconciled status).

Do NOT fix anything yet — this is a read-only reconciliation. Write the table to
docs/architecture/dossier-design-vs-production-23654.md and summarize the top 5 deltas by BD impact.
```

---

## Prompt 1 — P0: CMS reconciliation + the $104.6M revenue-model bug

```
For dialysis DB (Supabase project zqzrriwuavgrquhisnoa), the `properties` row for property_id 23654
(5247 Airways Blvd, CCN 442740) stores denormalized clinic values that are order-of-magnitude wrong:
total_chairs 171 (and revenue_model_notes says 29) vs the authoritative medicare_clinics.stations = 13;
total_patients 2,475 vs medicare_clinics.latest_estimated_patients = 33; ttm_total_treatments 82,953 vs the
real 4,283; estimated_annual_revenue $104,646,479 (impossible for a 13-chair clinic).

1. Find every writer that populates properties.total_chairs / total_patients / ttm_total_treatments /
   estimated_annual_revenue / revenue_model_notes. Identify why they diverge from medicare_clinics and
   facility_patient_counts. The $104.6M revenue model is the priority — find and fix the calculation.
2. Change the dossier + app operations panel to read medicare_clinics (stations, treatments) and
   facility_patient_counts (patient trend) as the source of truth, NOT the property denorm.
3. Backfill/retire the bad properties.* columns via a reconciliation job, and add a data-quality test that
   flags any property whose denorm diverges from its CMS record by more than a set tolerance.
4. Verify against 23654: expect 13 stations, 33 patients, 4,283 TTM treatments. Do not surface an
   estimated revenue until the model is corrected (or render "Not on file").
```

---

## Prompt 2 — P0: rent/SF and current-escalated-rent computation

```
Dialysis DB zqzrriwuavgrquhisnoa, live lease id 16307 on property 23654: annual_rent $181,959, building_size
6,308 SF, escalations "10% every 5 years", lease_bump_pct 0.1, lease_bump_interval_mo 60, start 2018-06-06,
expiry 2033-06-06.

1. rent_per_sf is null on the lease row even though rent and building_size exist. Trace why it's null; make
   the renderer COMPUTE rent ÷ building_size when the stored column is null, and backfill rent_per_sf at
   source. Expect $28.85/SF for this lease.
2. Add a current-escalated-rent-as-of(date) computation: use lease_rent_schedule if populated, else
   anchor_rent × bump math. As of 2026 one 5-yr escalation (2023) has elapsed → expect ~$200,155 current
   base (~$31.73/SF). Label it "Derived" with inputs.
3. Render two rows: Year-1 rent + $/SF and Current rent + $/SF. Add a Derived "term remaining (years)" row
   (~6.8 yrs to 2033-06-06, firm, excludes options).
4. Surface whether the "10% / 5yr" bumps continue THROUGH the option periods (from the lease renewal terms);
   if unknown, render "Not on file" rather than assuming.
```

---

## Prompt 3 — P1: transactions & listings wiring (one chronological timeline)

```
Dialysis DB zqzrriwuavgrquhisnoa, property 23654. Today the dossier/panel shows only properties.latest_sale_*
(a single number). Richer data exists but isn't wired:
  - sales_transactions has 3 rows; the live one is 2018-06-01 DaVita HealthCare Partners → Kingsbarn Realty
    $3,150,000, stated_cap_rate 5.40% / calculated_cap_rate 5.78%, firm_term_years_at_sale 15.0. Filter to
    transaction_state='live' (the other two are duplicate_superseded).
  - available_listings has an ACTIVE portfolio listing ($27,136,000 @ 5.25%, brokers Mousavi/Luther/Sullivan
    SRS, on market 2024-07-02) plus two prior 2017 listings ($3,466,000 SRS/Mousavi; $3,137,221 M&M/Cook).

Build a single chronological Transaction & Marketing Timeline: prior listings (broker + asking) → the sale
(price + cap-at-close + firm-term-at-close) → the current active listing (asking, $/SF, cap, brokers,
days-on-market, and a portfolio-vs-single-asset flag; the $27.1M is a portfolio ask, ~$550/SF ⇒ ~$3.47M
implied for this asset — do NOT present it as this property's asking). Read sales_transactions +
available_listings (not properties.latest_sale_*). Verify the timeline against 23654.
```

---

## Prompt 4 — P1: lease abstract extraction (guarantor + responsibilities)

```
Dialysis DB zqzrriwuavgrquhisnoa, live lease id 16307 on property 23654 (DaVita). The lease PDF is on file
(Documents), but the structured fields guarantor and the roof/structure/parking/HVAC responsibility columns
are all null. Run a lease-abstract extraction pass over the on-file PDF (reuse the existing extraction seam /
invokeExtractionAI) to populate: guarantor (with a guaranty-scope flag — dialysis guaranties are typically
limited to the Initial Term and exclude option periods), and the roof / structure / parking / HVAC
repair-maintenance-replacement responsibility split (the dialysis differentiators). Write them back to the
lease row + a guaranty-scope field. Have the dossier render tenant and guarantor as distinct rows plus the
expense-structure prose. Do not invent terms not in the document — leave "Not on file" where the PDF is silent.
```

---

## Prompt 5 — P2: loan feeder + finances-edge broker suppression + quarantine bad 2026 edges

```
OPS DB xengecqvemvfknjvbvrq, asset entity bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0 (5247 Airways, property 23654).
Three related debt/graph problems:
  1. loans / mortgage_records / comparable_sales are all empty for this asset despite RCA/deed sources that
     usually carry mortgage data. Build a loan feeder (RCA/deed mortgage records → loans): initial balance,
     lender, mortgage broker, rate, maturity, current-balance estimate.
  2. The only `finances` graph edge is "Marcus & Millichap" (src rca_deed) — M&M is the BROKER, not a lender.
     Add an operator-style suppression so brokerages can't be recorded as lenders on finances edges.
  3. Quarantine bogus 2026-06-23 costar_sidebar edges cross-attached to this asset (a "Radar Woodbridge LLC"
     purchase and a "Clue Drive LLC" sell that belong to other properties). Find the entity-resolution bleed
     that mis-attached them and add a guard against same-batch cross-asset attachment.
Until real debt data exists, the dossier renders loan fields as "Not on file".
```

---

## Prompt 6 — P2: documents reconciliation (SharePoint + Salesforce onto one record)

```
The Documents tab (action=documents in api/_handlers/entities-handler.js) currently reads only the
intake-artifact → entity join. For property 23654 / asset entity bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0, other
document stores exist but aren't linked:
  - lcc_cre_property_documents (SharePoint folder feed, keyed by cre_property_id) — OM/BOV/lease/comp.
  - Salesforce files (salesforce_* / the SF file-discovery flow).
Do three things: (a) build a cre_property_id ↔ asset-entity map and fold lcc_cre_property_documents into
action=documents; (b) link Salesforce files to the asset entity via the SF file-discovery flow; (c) add a
per-document `reconciled` status (linked to record / not yet reconciled) and a date, and surface document +
research history as the sources behind dossier facts. Verify all sources show for 23654 with correct status.
```

---

## Prompt 7 — P3: clinic relocation lineage + market-competition rents

```
Dialysis DB zqzrriwuavgrquhisnoa, CCN 442740 (5247 Airways). Two enrichment gaps:
  1. Relocation lineage: this facility certified 2017-10-27, but the operator's earlier certification is
     2003-02-01 (a prior location) — clinic_history_unified has 0 rows for this CCN and
     original_certification_date is null. Backfill clinic_history_unified (+ clinic_npi_registry_history) so
     "moved from X, N→13 chairs, Y miles" is derivable. Until then the dossier states both cert dates and
     marks the prior site "Not on file".
  2. Market competition: build a query that finds nearby dialysis CCNs (by radius around 35.005382,
     -89.989957) and returns their operator, stations, patients, and — where we hold a lease — their rent/SF,
     so the dossier can show renewal-rent pressure. Context already on file: Shelby County has 49 dialysis
     clinics (payer mix Medicare 27.9% / Medicaid 45.4% / Private 26.7%).
```

---

## Prompt 8 — Location & Trade Area: map thumbnail + demographics backfill + nearby tenants

```
Implement the dossier's "Location & Trade Area" section (see docs/architecture/dossier-example-5247-airways-v2.html)
end to end for property 23654 (geocode 35.005382, -89.989957), dialysis DB zqzrriwuavgrquhisnoa:
  1. Map thumbnail: render a Google Static Maps image (server-side, keyed) centered on the property with the
     site marker, labeled arterials, and 1/3/5-mile radius rings. Cache the image; keep the key server-side.
  2. Radius demographics: property_demographics has the right schema (radius_miles, population, num_households,
     population_growth_pct, avg_hhi) and covers 85 properties but has NO row for 23654. Backfill this record
     (geocode → 1/3/5-mi rings) so the table fills. Confirm the coverage gap isn't systemic — list which
     dialysis properties still lack demographic rows.
  3. Interim proxy is already wired to census_zcta_demographics (ZIP 38116: pop 40,212, median HHI $42,354,
     15.6% age 65+, 28.4% poverty, 16.2% uninsured) and v_payer_mix_geo_averages (Shelby County 27.9/45.4/26.7,
     49 clinics). Keep these as fallback context when radius rings are missing.
  4. Nearby national tenants: add a Places API pass that returns a handful of nearby credit/national tenants
     as map callouts. Store results; render "Not on file" until populated. Never fabricate tenant names.
```

---

## How to use the results
After each prompt, have Claude Code commit its changes and note in docs/architecture/ what it reconciled.
Re-run Prompt 0's reconciliation after the P0/P1 prompts to confirm production now matches the v2 design for
this record — that's the closed loop between design intention and the live app.
