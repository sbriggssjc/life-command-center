# Dossier v2 — Data Audit & Pipeline Triage (gold standard: 5247 Airways Blvd, Memphis · property 23654)

Scott's ask: enhance the dossier AND, topic by topic, audit **what we have (Supabase) vs. what we should
have vs. what the app displays**, and triage **where the code/pipeline is broken**. Below, each topic is:
**FINDING** (the reconciled truth) · **HAVE** · **SHOULD** · **DISPLAYS** · **GAP** (code/pipeline) · **FIX**.

## Headline finding (the single biggest issue)
The **`properties` row stores denormalized clinic/financial values that are wildly wrong** and were never
reconciled from the authoritative CMS record:

| Field | `properties` (garbage) | `medicare_clinics` 442740 (authoritative) |
|---|---|---|
| chairs / stations | **171** (and `revenue_model_notes` says 29) | **13** |
| patients | **total_patients 2,475** | **latest_estimated_patients 33** (63.46% of 52 capacity) |
| TTM treatments | **82,953** | **4,283** |
| est. annual revenue | **$104,646,479** (impossible for a 13-chair clinic) | derived from 4,283 tx |

**Root cause:** a **propagation gap** — the property-level clinic fields (`total_chairs`, `total_patients`,
`ttm_total_treatments`, `estimated_annual_revenue`, `revenue_model_notes`) are **not synced from
`medicare_clinics` / `facility_patient_counts`**, and the revenue model that wrote `$104.6M` is producing
order-of-magnitude-wrong numbers. The app + dossier read the property denorm, so they show garbage. **Fix:
the dossier (and the app operations panel) must read the CMS tables as the source of truth, and a
reconciliation job must overwrite/retire the bad property-denorm columns.** This one gap touches
operations, valuation, and the revenue model.

---

## A. OPERATIONS

### A1. Station count (you saw 171 vs 29 → truth is 13)
FINDING **13 stations / 13 chairs** (`medicare_clinics.stations` = `number_of_chairs` = 13; max capacity 52).
HAVE the authoritative 13 in `medicare_clinics`; the 171 and 29 are unsourced denorm on `properties`.
SHOULD show **13**. DISPLAYS 171 (property denorm). GAP the property-denorm chair field isn't reconciled
from CMS; two *different* wrong values (171, 29) prove two separate bad writers. FIX read
`medicare_clinics.stations`; retire `properties.total_chairs` / `revenue_model_notes.chairs`.

### A2. Patient count (2,475 vs 33 → truth is 33)
FINDING **33 patients** (`latest_estimated_patients`; consistent with 63.46% of 52 capacity). HAVE 33 in
`medicare_clinics`; **25 rows of history in `facility_patient_counts`** (→ the trendline you want). SHOULD
show 33 + a 3-yr trend. DISPLAYS 2,475 (property denorm garbage). GAP same propagation gap; the trend table
is never read. FIX read `medicare_clinics` + `facility_patient_counts`; retire `properties.total_patients`.

### A3. Treatments / revenue / EBITDA (property revenue = $104.6M is impossible)
FINDING **4,283 TTM treatments** (`ttm_total_treatments`). At a Medicare blended rate the revenue is on the
order of ~$1–1.5M, **not $104.6M**. HAVE treatments in `medicare_clinics`; economics tables
(`clinic_financial_estimates`, `facility_economics`, `clinic_trends`) exist but `facility_economics` had **no
row** for 442740 (economics not computed for this clinic). SHOULD show treatments + a defensible
revenue/EBITDA estimate + trend. DISPLAYS the $104.6M garbage. GAP the property revenue model is broken
(orders of magnitude off) AND clinic-level economics aren't populated for every clinic. FIX (1) never surface
`properties.estimated_annual_revenue` until the model is fixed; (2) build/backfill `facility_economics` per
clinic; (3) dossier reads clinic economics with an explicit method + confidence, or renders "Not on file."

### A4. Relocation / certification history (certified 2003, moved here 2017/2018)
FINDING this **facility** certified **2017-10-27** (`medicare_clinics.certification_date`); the property row's
**2003-02-01** is the operator's *earlier* certification at a prior location. So the clinic did move. HAVE the
two dates; **but `clinic_history_unified` had 0 rows for 442740** and `original_certification_date` is null —
so the **prior location / prior chair count / distance moved is NOT captured** for this clinic. SHOULD have a
prior-site record. GAP the clinic-history/relocation lineage isn't populated for this CCN. FIX backfill
`clinic_history_unified` (and `clinic_npi_registry_history`) so "moved from X, N→13 chairs, Y miles" is
derivable; until then the dossier states the two cert dates as facts and marks the prior site "Not on file."

---

## B. LEASE / RENT (computation bugs — data is present)

### B1. Rent/SF not calculating (you have rent + building size)
FINDING $181,959 ÷ 6,308 SF = **$28.85/SF** — trivially derivable. HAVE rent (`leases.annual_rent`) + size
(`properties.building_size`). DISPLAYS blank (the app reads `leases.rent_per_sf`, which is **null**). GAP the
UI/dossier read a stored `rent_per_sf` column instead of **computing** rent ÷ building_sf when the column is
null. FIX compute rent/SF in the renderer (and backfill `rent_per_sf` at source).

### B2. Current (escalated) rent not calculating from the schedule
FINDING lease says **"10% every 5 years"**, start 2018-06-06 (`lease_bump_pct` 0.1, `lease_bump_interval_mo`
60). One escalation has elapsed (2023) → current base ≈ **$200,155** (Year-1 $181,959). HAVE the escalation
terms + `anchor_rent` + a `lease_rent_schedule` table. DISPLAYS only the $181,959 base. GAP nothing computes
the *as-of-today* escalated rent from the schedule, even though every input exists. FIX add a
current-rent-as-of(date) computation (from `lease_rent_schedule` if populated, else anchor × bump math),
label it Derived, and show **Year-1 rent + $/SF** and **Current rent + $/SF** as two rows. Also state whether
bumps **continue through the option periods** (from the lease's renewal terms) — a key dialysis renewal
signal.

### B3. Guarantor + tenant as distinct rows; guaranty limited to Initial Term
FINDING the live lease (id 16307) has `tenant` "DaVita Dialysis" but **`guarantor` is null** and the
roof/HVAC/parking/structure responsibility columns are **all null** — even though we hold the lease document.
HAVE the lease PDF (Documents); the structured guaranty + responsibility fields were **not extracted**. SHOULD
show tenant (specific entity), guarantor (with "limited to Initial Term; excludes options" per the guaranty),
and the roof/structure/parking/HVAC repair-maintenance-replacement breakdown (the dialysis differentiators).
GAP the lease-extraction pipeline didn't populate guarantor + the four responsibility fields for this lease.
FIX re-run lease extraction (or an LLM lease-abstract pass over the on-file PDF) to fill `guarantor`,
`*_responsibility`, and a guaranty-scope flag; dossier renders them + the expense-structure prose.

### B4. Term remaining
FINDING to 2033-06-06 = **~6.8 years** remaining (firm; excludes the two 5-yr options). Pure derivation. GAP
not shown. FIX add a Derived "term remaining (years)" row.

---

## C. TRANSACTIONS / ON-MARKET / VALUATION (data present, not wired)

### C1. Full sale history (we show 1; there are 3, reconciled to 1 live)
FINDING reconciled sale = **2018-06-01, DaVita HealthCare Partners → Kingsbarn Realty, $3,150,000**,
`stated_cap_rate` **5.40%** / `calculated_cap_rate` **5.78%**, **firm_term_years_at_sale 15.0**, expires
2033-06-06 (the other two `sales_transactions` rows are `duplicate_superseded`). HAVE 3 rows in
`sales_transactions` with cap + firm-term-at-sale already computed. DISPLAYS only `properties.latest_sale_*`
(one number, no cap, no term). GAP the dossier/Deal-History doesn't read `sales_transactions` (with
`transaction_state='live'`) — so cap rate at close and term-at-close are lost. FIX read `sales_transactions`
(live rows) → show date · grantor→grantee · price · cap-at-close · term-remaining-at-close.

### C2. Currently on market — nothing shown
FINDING an **active listing**: **$27,136,000 @ 5.25% cap** (a **portfolio** listing — ~$550/SF ⇒ ~$3.47M
implied for this asset), brokers **Matthew Mousavi, Patrick Luther, Stephen Sullivan (SRS)**, on market since
**2024-07-02 (~2 yrs)**, OM on file (`intake_artifact_path`). HAVE the row in `available_listings`
(status active). DISPLAYS nothing. GAP the dossier/panel doesn't surface the active `available_listings` row.
FIX read the active listing → asking price, $/SF, cap, brokers, days-on-market, and flag portfolio vs.
single-asset.

### C3. Prior listings (asking-price history + brokers each time)
FINDING two prior marketings in `available_listings`: **2017-12-08 $3,466,000 (SRS; Mousavi)** and
**2017-07-17 $3,137,221 (M&M; Cook)**, both off-market 2018 at the sale. HAVE them. DISPLAYS nothing. GAP not
wired (and `listing_price_history` is empty — the price-change history lives as separate listing rows +
`listing_change_events`, not the history table, for this property). FIX render prior listings chronologically
with broker + asking price; note `on_market_date_confidence` when low.

### C4. Historical transaction ordering
FIX present C1–C3 as **one chronological transaction/marketing timeline**: 2017 listings → 2018 sale (cap +
term at close) → 2024 re-listing (current). This is the "logical historical order" you asked for.

### C5. LCC value estimate — needs a basis + $/SF
FINDING `current_value_estimate` ≈ **$3,137,221**; with rent $181,959 that's a ~5.80% implied cap — i.e. the
estimate is essentially rent ÷ cap. HAVE the estimate + inputs. SHOULD show it with a one-line basis
("current rent $X · Y.y yrs term remaining · applied Z.ZZ% cap") + **price/SF** ($497/SF at $3.14M ÷ 6,308).
GAP shown as a bare number with no basis/PSF. FIX render the basis inline + a $/SF row; label "model estimate."

---

## D. OWNERSHIP / DEVELOPER / LOAN / BD

### D1. Original developer — missing
FINDING `properties.developer` is null and there is **no `developed` edge** for this asset (the graph has
only 6 `developed` edges total). HAVE nothing. GAP developer isn't captured (build-to-suit developer would
come from the OM/deed/costar). FIX add an "Original Developer" row that reads the graph `developed` edge /
`properties.developer`; render "Not on file" until a developer feeder populates it (follow-up).

### D2. Loan / debt history — missing, and the one "lender" is a mislabeled broker
FINDING `loans`, `mortgage_records`, `comparable_sales` = **0 rows**; the graph's only **`finances` edge is
"Marcus & Millichap"** (src `rca_deed`) — **M&M is the BROKER, not a lender** (the finances-edge pollution I
flagged earlier), and `loan_amount`/`lender` are null. So **no real debt data is captured** for this
property, despite RCA/deed sources that usually carry it. SHOULD have initial balance, lender, mortgage
broker, rate, maturity, current-balance estimate. GAP (1) the loan/mortgage feeder isn't populating
`loans`/`mortgage_records` for this asset; (2) `finances` edges are polluted with brokerages. FIX build the
loan feeder (RCA/deed mortgage records → `loans`) and add an operator-style suppression so brokerages can't
be recorded as lenders; dossier renders "Not on file" until then.

### D3. Data-quality: cross-contaminated 2026 graph edges
FINDING the asset has bogus **2026-06-23 costar_sidebar edges** — a "Radar Woodbridge LLC" *purchase* and a
"Clue Drive LLC" *sell* that belong to other properties. GAP a recent costar_sidebar ingest mis-attached
edges to this asset (entity-resolution bleed). FIX quarantine/repair those edges; add a guard against
same-batch cross-asset attachment. (Flagged as its own cleanup task.)

### D4. Our BD / prospecting efforts with current ownership (Kingsbarn)
SHOULD show a short "our activity with Kingsbarn Realty" block — cadence/touchpoints, correspondence, ROE.
HAVE the machinery (touchpoint_cadence, activity_events, the contact360 for the Kingsbarn entity). GAP not
assembled into the property dossier. FIX pull the owner entity's cadence + recent touches into a "BD Efforts"
section (property→owner join already exists).

---

## E. DOCUMENTS RECONCILIATION (SF + SharePoint not linked)

### E1. What's shown vs. what exists
FINDING the current listing's OM is in `lcc-om-uploads` (Supabase) AND there are **`sharepoint_pa`-backed**
intake docs plus the **`lcc_cre_property_documents`** SharePoint folder-feed store (OM/BOV/lease/comp) keyed
by `cre_property_id`, plus **Salesforce files** (`salesforce_*` / SF file-discovery flow). The Documents tab
currently reads only the intake-artifact→entity join. SHOULD show all sources with **date + reconciliation
status** ("linked to record / not yet reconciled"). GAP (1) `lcc_cre_property_documents` (SharePoint folder
feed) isn't joined — needs a `cre_property_id ↔ asset-entity` map; (2) Salesforce files aren't linked to the
asset entity; (3) no per-document "reconciled with DB?" flag. FIX (a) build the cre_property↔entity map and
fold that store into `action=documents`; (b) link SF files via the SF file-discovery flow → the asset entity;
(c) add a `reconciled` status + show document/research history as sources. **This is its own multi-step
workstream** (documents/dossiers doc §2 open items).

---

## F. LAYOUT ADDITIONS (from your notes) — where each field sources from
- Snapshot: **station count** (`medicare_clinics.stations`), **$/SF** (value ÷ building_sf), **value-estimate
  basis** inline.
- Ownership: **Original Developer** row (§D1).
- Lease: **expense-structure prose** (roof/structure/parking/HVAC — §B3), **Year-1 rent + $/SF** and
  **Current rent + $/SF** rows (§B1/B2), **bumps-continue-in-options?** flag, **tenant** + **guarantor
  (limited to Initial Term)** rows (§B3), **term remaining** (§B4).
- Operations: **patient count (33) + trend**, **annual treatments (4,283) + trend**, **est. revenue + est.
  EBITDA + trends**, **stations (13)**; **drop Medicare ID**; **relocation paragraph** (§A4); **market
  competition** block (nearby clinics + their rents/SF ⇒ renewal-rent pressure).
- Transactions: **on-market (current)**, **prior listings**, **prior sale w/ cap + term-at-close**, in one
  timeline (§C).
- BD Efforts section (§D4). Documents with detail + reconciliation status (§E).

---

## Prioritized fix backlog (what to have Claude Code execute next)
1. **P0 — CMS reconciliation:** dossier/app read `medicare_clinics` + `facility_patient_counts` for stations
   / patients / treatments / trend; stop reading the property-denorm garbage; backfill/retire the bad
   `properties` columns; **fix the property revenue model** ($104.6M bug).
2. **P0 — rent computations:** compute rent/SF and current-escalated-rent (Year-1 vs current) from data on
   hand; surface bumps-in-options.
3. **P1 — transactions/listings wiring:** read `sales_transactions` (live) + `available_listings`
   (active + prior) into the dossier/Deal-History as a chronological timeline with cap + term-at-close +
   brokers + DOM.
4. **P1 — lease abstract:** extraction pass over the on-file lease PDF → guarantor, guaranty scope, and the
   four responsibility fields.
5. **P2 — loan feeder** (RCA/deed → `loans`) + **finances-edge broker suppression**; **quarantine the 2026
   cross-contaminated edges**.
6. **P2 — documents reconciliation:** cre_property↔entity map + SF file linkage + per-doc reconciled status.
7. **P3 — clinic relocation lineage** backfill; **market-competition** query (nearby CCNs + their rents).

## Follow-up prompts (as you asked — for Claude Code to dig into)
- "Why does `properties.total_chairs`/`total_patients`/`ttm_total_treatments`/`estimated_annual_revenue`
  diverge from `medicare_clinics`? Find the writer, fix the propagation, backfill, and add a reconciliation
  test." (the revenue model returning $104.6M is the priority.)
- "Trace `rent_per_sf` — why is it null when rent and building_size exist? Backfill + compute-on-read."
- "Build a current-escalated-rent function from `lease_rent_schedule` + anchor/bump fields; verify against
  5247 Airways (expect ~$200,155 as of 2026)."
- "Populate guarantor + roof/structure/parking/HVAC responsibility from the on-file lease PDF."
- "Why are `loans`/`mortgage_records` empty for RCA-sourced deals, and why are brokerages on `finances`
  edges? Build the loan feeder + suppress non-lenders."
- "Quarantine the 2026-06-23 costar_sidebar edges cross-attached to property 23654 (Radar Woodbridge, Clue
  Drive) and find the entity-resolution bleed that caused it."
- "Map `cre_property_id` ↔ asset entity and link Salesforce files to the asset so all document sources
  reconcile onto one record."
