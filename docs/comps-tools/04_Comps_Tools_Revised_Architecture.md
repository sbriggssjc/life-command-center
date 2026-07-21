# Comps Tools — Revised Architecture (grounded in the existing LCC system)

**Date:** July 21, 2026
**Supersedes:** the Salesforce-integration sections of `LCC_Comps_Tools_Design.md` (the canonical-schema and orchestrator concepts still stand; the *access path* changes)
**Basis:** review of `SALESFORCE_LCC_INGESTION_PLAN.md`, `SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md`, `flow-a-lcc-stage-om-http.json`, `SALESFORCE_LCC_DOCUMENT_INGESTION_AUDIT.md`, `mcp/README.md`, and the real GSA comp export.

---

## 1. What I got wrong in v1, and what's actually true

The original design assumed we'd stand up Salesforce access from scratch and debated Connected App vs. Power Automate. **Your files show that decision is already made and the pipeline is largely built.** Three facts reframe everything:

1. **Direct Salesforce API is a confirmed dead end.** The Northmarq org is SSO-gated — a username/password/token login returns `INVALID_SSO_GATEWAY_URL`. A Connected App/JWT would work but needs a Salesforce admin to provision it (the internal friction you flagged). **Power Automate — authenticated interactively once, auto-refreshed forever — is the settled transport.** My "provision a Connected App later" phase is deleted.

2. **Salesforce comps are already being crawled into Supabase.** `SF → LCC: Object Sync` (Power Automate Flow 1) pulls `Comp__c`, `Property__c`, `Listing__c`, `Deal__c`, `Lease__c`, `Tenant__c`, `Account`, `Contact` and stages them into `sf_comp_staging` / `sf_property_staging` / etc. on `Dialysis_DB` and `government`, each row preserving the **entire Salesforce record as `raw_row` jsonb**. So the Salesforce comp data the new tool needs is *already landing in databases the MCP server already talks to.*

3. **Your reconciliation engine already exists.** `lcc_merge_field()` + `field_source_priority` (1,382 rows) + `field_provenance` (157k+ rows) is a battle-tested, field-level, source-ranked "don't let a worse source overwrite a better one" gate. This is exactly the reconciliation machinery the synthesis orchestrator needs — it should *call it*, not reinvent it.

And the comp-definition audit (2026-05-29) surfaced the single most important design constraint: there are **five live definitions of "a sale that counts"** across your stack, and the canonical gate you landed on is **`transaction_state = 'live'` (+ `sold_price > 0`)**. Any comps tool that doesn't standardize on that gate will reproduce the over-counting the audit documents.

---

## 2. The two tools, re-specified onto the existing system

### Tool 1 — `query_comps` (a read-only MCP tool, not a new Salesforce integration)

The MCP server (`mcp/server.js`, Railway-hosted, PostgREST-fetch to DIA/GOV/OPS Supabase, 6+ read-only tools today) gets one new read-only tool. It reads the **Supabase comp layer** — no live Salesforce call in the hot path:

- **Dialysis + Government comps** → the canonical `sales_transactions` / `available_listings` (via `v_sales_comps` / a corrected `v_available_listings`), filtered to `transaction_state = 'live'`.
- **Salesforce-sourced comps** → `sf_comp_staging.raw_row` on the relevant project(s). The GSA export I analyzed *is* the shape of this `raw_row` (37 fields, all mapping to `Comp__c`), so the tool maps `raw_row` → canonical using the field table in §3.

Interface mirrors the v1 spec (comp_type, property_types, geography, date window, size, `government` filter), returns canonical comps + provenance. Two freshness notes:

- The crawl default cadence is **twice a year** (full) — fine for historical comps, stale for "what just closed." For on-demand freshness, add **Tool 1b: an on-demand Power Automate query flow** modeled exactly on `flow-a-lcc-stage-om-http.json` (HTTP-triggered, `X-PA-Webhook-Secret`, returns rows) — call it `SF → LCC: On-demand Comp Query`. The MCP tool hits staged data by default and can trigger this flow when the caller asks for live/fresh results.
- **Gap to close:** Comp → `sales_transactions`/`available_listings` promotion **isn't wired yet** (the plan has Property promotion in report-only mode; Comp/Listing/Deal mapping is a listed follow-on). So *today* the cleanest read for Salesforce comps is `sf_comp_staging` directly; blending them into the canonical tables requires finishing that promotion mapping (§3 gives it).

### Tool 2 — `synthesize_comps` (the orchestrator)

Unchanged in spirit, sharpened by what the audit taught us:

- **The single gate is non-negotiable.** Every source is filtered to its "live/closed, priced" definition — SF (`Status__c = 'Sold'` + a validated `Validation_Status__c`), dialysis and gov (`transaction_state = 'live'` + `sold_price > 0`). This is the orchestrator *imposing* the unification the audit's R1 recommends, at read time, across all sources.
- **The government signal is now concrete.** `Comp__c` carries `Gov_Category__c` (Federal / Local-State) and a boolean `Government__c` — the router uses these to decide when to also pull the government DB, and (critically) to **dedup the GSA/VA overlap**: a VA clinic can appear in *both* `government.sales_transactions` and `sf_comp_staging`, so the merge step must collapse them (address + sale-date blocking key) rather than double-count.
- **Reconciliation = call `lcc_merge_field()`** (or its priority table's logic) rather than a hand-rolled precedence policy. Your `field_source_priority` already encodes, e.g., that public-record ownership beats Salesforce but Salesforce beats nothing for listing/marketing status — the orchestrator inherits that.
- **Export** still hands the ranked canonical set to the `briggs-comps` template writer.

---

## 3. Comp__c → canonical mapping (verified against the real export)

Every field in the GSA export resolved to a `Comp__c` field, so this mapping is ready to drop into the `intake-salesforce` mapping config / the promotion `COMP_FIELD_MAP`:

| Canonical | Comp__c (raw_row key) | Notes |
|---|---|---|
| `comp_provenance` | `Comp_Type__c` | **External / Internal** — NOT sale/lease (corrects v1) |
| `is_government` / `gov_category` | `Government__c` (bool) / `Gov_Category__c` | Federal vs Local/State — router + dedup signal |
| `property_type` | `Property_Type__c` | values seen: Office, Healthcare, Retail (ST), Industrial, Special Purpose |
| `property_subtype` | `Primary_Use__c` | |
| `sale_price` | `Price__c` | raw; **not** the `Comp_Price__c`/`Price_Formula__c` formulas |
| `cap_rate` | `Cap_Rate__c` | raw (decimal, e.g. 0.104); not the cap formulas |
| `noi` | `NOI__c` | |
| `occupancy` | `Occupancy__c` | |
| `sale_date` | `Sold_Date__c` | |
| `status` (closed vs on-market) | `Status__c` | **Sold / Available / Under Contract** — the closed-comp gate |
| `list_price` / `list_cap` | `Listing_Price__c` / `List_Cap__c` | populated when not yet Sold |
| `building_sf` | `Building_SF__c` | sector splits: `Office_SF__c`,`Retail_SF__c`,`Industrial_SF__c`,`Multifamily_SF__c`,`Other_SF__c` |
| `base_rent_annual` / `rent_per_sf` | `Annual_Rent__c` / `Rent_SF__c` | |
| `lease_term_yrs` / `expiration` | `Lease_Term_years__c` / `Lease_Expiration__c` | |
| `term_remaining_at_sale` | `Term_Remaining_At_Sale__c` | |
| `expense_type` / `escalation` | `Expenses__c` (e.g. NNN) / `Escalation__c` | |
| `guarantor` / `tenant` | `Guarantor__c` / `Tenant__c` (lookup) | |
| `address/city/state/zip` | `Address__c` / `City__c` / `State__c` / `Postal_Code__c` | |
| `metro` | `Metro_Name__c` | |
| `year_built` / `year_reno` | `Year_Built_Date__c` / `Year_Renovated_Date__c` | |
| `days_on_market` | `Days_on_Market__c` | |
| `sale_conditions` | `Sale_Conditions__c` | Standard / Build to Suit / 1031 / Owner-User |
| `record_link` | build from record `Id` (`a1Y…` prefix) | for citation |
| `raw` | entire `raw_row` | keep |

Population reality from the 195-row export: **Sold** comps carry `Price__c`/`Cap_Rate__c` (53/63 priced — ~15% of sales are confidential/undisclosed); **Available** carry `Listing_Price__c`/`List_Cap__c` with those blank. So the tool picks the price/cap pair by `Status__c`.

---

## 4. Decisions / inputs I need to proceed

1. **Read source for the comps tool (pick one to start):**
   (a) query `sf_comp_staging` directly for Salesforce comps + the canonical DIA/GOV tables for those verticals — *available now, no new work*; or
   (b) finish the **Comp → `sales_transactions`/`available_listings` promotion** first so everything is in the canonical layer — cleaner, more work. **My recommendation: (a) now, (b) as the durable follow-on** using the §3 map.
2. **May I inspect the live Supabase (read-only)** to confirm what's actually in `sf_comp_staging` today (row counts, whether the GSA crawl has run, which projects have it)? I have the Supabase tools; a `list_tables` + a couple of `count` queries would ground the tool spec in reality. Your go-ahead only.
3. **On-demand freshness — build the query flow now or later?** i.e., is "comps as of the last crawl" acceptable for v1, or do you need live-on-request from day one (which means building `SF → LCC: On-demand Comp Query`).
4. **Picklist value lists** still help for the controlled vocab — but the export gave me the ones in active use for GSA (property types, statuses, gov categories, expense/escalation, sale conditions). I mainly still need the **full `Property_Type__c` / `Primary_Use__c` sets** for non-government verticals (medical, retail, industrial, multifamily) so the router's type-matching is complete.

---

## 5. Net effect

The two tools are much smaller than v1 implied, because the ingestion pipeline, the multi-database Supabase layer, the provenance/reconciliation engine, and the MCP host **already exist**. Tool 1 is a new read-only MCP query over data that's already landing in your databases; Tool 2 is an orchestrator that imposes your own `transaction_state='live'` gate across dialysis + government + Salesforce-staged comps, reconciles with `lcc_merge_field`, dedups the GSA/VA overlap using the `Government__c` flag, and formats with `briggs-comps`. The biggest genuine build item is finishing the **Comp → canonical promotion mapping** — which §3 now hands you.
