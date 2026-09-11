# Buyer Engagement Module (Buy-Side Showings) — Spec v0.1 (DRAFT, design-only)

> Status: **design-only, nothing authorized to build.** Opened 2026-09-11 (Cowork). **Phase 0 (Geller pilot) Round 1 delivered 2026-09-11 — see §9 for the build handoff.**
> Backlog anchor: `UX-T4` / UX42 (buyer-representation / 1031 clients tab), `F1`, `F2`, `D14`.
> Pilot engagement: Jordan Geller 2026 industrial search — log at
> `Team Briggs - Documents/Clients/Jordan Geller/2026 Industrial Search/00-ENGAGEMENT-LOG.md`.
> Doctrine carried in: never fabricate ("Not on file" / "Derived" / "Conflict"); Supabase is reconcilable, not truth;
> review existing machinery before building; every data point carries source + vintage.

## 1. Purpose
Turn the manual Team Briggs buy-side process into a repeatable, mostly automated LCC workflow so the team can run
more buyer engagements at once:
**Qualify (intake call) → Criteria → Source → Screen/Score → Showing workbook (Broad + Focused + Passed) → Client
feedback loop → Offers/LOI → PSA → Closing → Filing.**
~20% of fees are buy-side (UX42).

## 2. The manual process today (as described by Scott, 2026-09-11)
1. Kickoff call, opened with a market-education deliverable (e.g. SJC "Cap Rate Trends": credits, sold cap ranges by
   tenant/sector) to anchor a compare-and-contrast conversation.
2. Qualification via Stan Johnson's buyer-qualification checklist (price range/equity/debt; asset type; credit
   preference; location & market tier; lease term; expense structure; bumps; yield; loan terms; prior purchases;
   **Contrast** — reconcile stated wants against past behavior; offers history). Not a form — a conversation; the
   contrasts reveal the priority levers.
3. Proactive sourcing: Salesforce, CoStar, LoopNet, CREXi, email ingestion (OM/listing alerts), outbound calls,
   buy-need emails.
4. Workbook: **Broad** tab (everything ever sourced and screened) + **Focused** tab (prioritized recs), with a matrix
   of averages, per-deal scores (historically CREDIT / REAL ESTATE / LEASE → TOTAL), 1/3/5-mi income & pop, notes,
   OM links; later a **Passed** tab.
5. Widen search over time; offers → PSA → closing on top candidates; once offered, files move to
   `PROPERTIES\[Tenant Initial]\[Tenant]\[City, ST]\`. Engagement files live under `Clients\[Client]\...`.

## 3. What already exists (reuse — from 2026-09-11 repo sweep)
| Need | Existing machinery | Gap |
|---|---|---|
| Buyer criteria | `unified_contacts.is_1031_buyer`; SF fields `CIS_Buy_Needs__c`, `IS_Buy_Needs__c`, Deal `Buyer_Geography__c`, `Buyer_Product_Type__c`, `Buyer_End_of_ID_Period__c`, `Buyer_Total_Equity_to_Exchange__c` (catalogued, **not ingested**); proposed-never-built `entity_custom_buyer_criteria` (Gov DEVELOPER_BD_AUDIT_v3) | No criteria store |
| On-market supply | dia `available_listings` / `listing_discoveries`; gov `available_listings` + `v_gov_on_market`; LCC `cortex_market_intel` (email-parsed alerts, any asset type; writer not in repo); `lcc_listing_*` crawl tables; availability-checker | **No general net lease / industrial on-market store** — sidebar routes only dia/gov (`sidebar-pipeline.js` `unknown_domain`); `lcc_cre_properties` is owner-only by doctrine |
| OM intake | `intake-om-pipeline.js::stageOmIntake` → extractor → promoter | Promoter targets dia/gov only |
| Demographics | dia `census_zcta_demographics`; gov `census_demographics`, `bls_employment_data`; dossier 1/3/5-mi renderer (K20 incomplete) | No MSA-level macro table; no market-rent source |
| Workbook | `DialysisProject/src/buyer_showings.py` (Slice E3 tour-schedule template), `work_product_base.py`, `bov-generator/comps_generator.py`, branding standard | No Broad/Focused/Passed or market-ranking generator |
| Offers/PSA | `offer-submission` skill, `log_offer`/`get_offer_context`, backlog D11 PSA timeline | Buy-side LOI flow (we are the buyer's broker) not modeled |
| Filing | `canon/blocks/filing.md` | No `Clients\` buy-side convention; no `BuyerShowing` DocType |

## 4. Proposed architecture (options flagged where Scott must decide)
### 4.1 Data model (LCC Opps unless noted)
- `buyer_engagements` — id, client entity_id (+ family/related entities), contact_id, status (qualifying / sourcing /
  offering / under_contract / closed / paused), capital (equity, debt, total), 1031 flags (downleg close, ID deadline,
  exchange deadline), owner (broker), folder path, SF Deal/Opportunity id.
- `buyer_criteria` (versioned; one active version per engagement) — hard filters (asset type, price min/max, SF,
  clear height, markets/MSAs, lease-term min, expense structure) + soft preferences with **weights**; the qualification
  checklist answers + "contrast" notes; provenance (call date, stated-by).
- `market_metrics` — MSA (CBSA code) × metric × vintage × value × source_url. Shared across engagements.
- `market_rankings` — engagement × criteria version × weights snapshot × MSA scores (reproducible).
- `onmarket_listings` — **DECISION A:** (a) new cross-asset table in LCC Opps fed by all channels, (b) a new
  "net lease" domain DB mirroring dia/gov, or (c) extend `cortex_market_intel`. Draft recommendation: (a), keyed to
  `lcc_cre_properties`, with dia/gov listings surfaced via views, not copied.
- `engagement_candidates` — engagement × listing × status (new / shown / focused / passed / offered / under
  contract / closed / lost) × leg scores × blended score × pass reason × client feedback × first_shown_date.
- Offers reuse `log_offer` with a `side='buy'` flag (DECISION B: confirm).

### 4.2 Pipelines
1. **Criteria capture** — intake-call notes (transcript/Scott notes) → LLM extraction into `buyer_criteria` draft →
   Scott confirms (never auto-truth). SF buy-needs fields ingested as a secondary source.
2. **Market data refresh** — scheduled pulls (Census PEP/ACS, BEA, BLS QCEW/CES, FEMA NRI, Tax Foundation, port/air
   cargo) into `market_metrics`; quarterly.
3. **Supply ingestion** — existing channels extended past dia/gov: email listing alerts, OM intake, CoStar sidebar,
   LoopNet/CREXi discovery, SF on-market; dedupe to property identity (P10a).
4. **Matcher** — nightly: new/changed listings × active criteria → hard-filter → score → `engagement_candidates`
   (new matches flagged for Scott review, never auto-sent to client).
5. **Scoring** — per-leg scores (DECISION C: legs = Market / Real Estate / Lease-vs-Market-Rent / Credit?) with
   weights from the criteria; percentile-based, explainable, every input sourced.
6. **Workbook generator** — extend `buyer_showings.py` / `work_product_base.py` (Railway BOV generator service):
   Criteria & Method, MSA Ranking (live editable weights), per-market tabs, Broad, Focused, Passed, Sources. Branded per
   `BRANDED-DELIVERABLE-PRESENTATION-STANDARD.md`.
7. **Feedback loop** — Jordan/Scott notes → candidate status + pass reasons → suggested criteria/weight adjustments.
8. **Filing** — `Clients\[Client]\[Engagement]\` for showings/memos; on offer, `PROPERTIES\...\[City, ST]\`; new
   DocType `BuyerShowing` in canon filing block.

### 4.3 Surfaces
- MCP tools: `get_buyer_engagement`, `update_buyer_criteria`, `match_listings_for_buyer`, `generate_buyer_showing`,
  `log_buyer_feedback` (both Railway services redeploy on ship).
- LCC app: Buyers tab (UX42) — engagements list, criteria, candidate board by status, next actions.
- Canon: new `canon/blocks/buyer-engagement.md` (qualification method, contrast doctrine, no-fabrication rules) →
  render surfaces → paste per SURFACE-SYNC-PROTOCOL.
- Cowork skill: `buyer-showing` (build/update a client workbook from LCC data + manual adds).

### 4.4 Living engagement — reuse the deal-dossier / Wave 7 comms spine (Scott, 2026-09-11)
Goal: the engagement is a *living project* — new emails, calls and OMs about it update the workbook, candidates
and to-dos without manual re-keying, exactly like the deal dossier. **Do not build a parallel pipeline — the
machinery exists:**
- **Anchor:** each engagement = a buy-side *deal* on the existing deal spine (entity + `sf_deal_id` if any), with
  `metadata.engagement_type='buy_side'` and a pointer to the client folder. That is the thin index row from
  Decision A — everything else stays in the folder.
- **Attribution:** extend `mcp/deal-email-matcher.js` (W7.1, LIVE) with engagement match keys: client contacts +
  related names/entities (e.g. Geller / Pearlman / Trigen / 3Gen / Blake Atkins), and every candidate property's
  address + listing broker once it enters Broad Market. Matched mail/call notes land as deal-attributed
  `activity_events` (W7.3 call notes use the same shape).
- **Propagation:** the W7.2 hourly tick (+ W7.4 open-issues, W7.5 outbound loop closure) runs over those events
  and, via local Ollama (`invokeExtractionAI`, private corpus never leaves GaryBuilt), **proposes** — never
  auto-applies — typed updates: candidate status changes (new / shown / passed + reason / offered / under
  contract), price/term/rent facts from broker replies or OMs (routed through `stageOmIntake`), criteria/weight
  changes stated by the client, and next-step to-dos. Proposals queue in `lcc_clean_assist_proposals`-style review.
- **Render:** on accept, regenerate the engagement files (showing workbook via the Railway generator; an
  **engagement dossier** in the locked dossier format: criteria, market ranking, candidates by status,
  correspondence summary, open issues, next steps) with the same no-fabrication contract and `source_hash`
  reuse-if-fresh. Files are pushed to the client folder (SharePoint push path already used by dossiers).
- **Health:** assert on the 7-day write delta (CURRENT-STATE doctrine), not the flag.

### 4.5 Sourcing & ingestion — what the existing pipes actually carry (measured 2026-09-11)
- **Email listing alerts → `cortex_market_intel` (LCC Opps):** 878 listing blasts since 2026-06-29 from 10+ broker
  senders (SRS, Northmarq/RCM, C&W, Boulder, PropertySend, CBRE, JLL, CREXi, CoStar alerts, Brevitas). 41 are
  industrial by headline, but **`city_state` is null on most rows** — the parser keeps the subject line, not the
  location/size/price/cap. Gap **BUY-G1:** local-Ollama extraction of address, city/ST, SF, price, cap, lease term
  from the alert body (reuse `invokeExtractionAI`), so alerts can be matched to engagement criteria.
- **Salesforce Power Automate flows:** `sf-object-sync` / on-demand backfill carry `Comp__c` only for the dialysis
  and government domains (into each domain's `sf_comp_staging`); LCC keeps just `On_Market_Date__c` for 1,712 comps
  (`lcc_sf_comp_on_market`). **There is no path today for industrial / general net lease `Comp__c`.**
  Gap **BUY-G2:** an on-demand, criteria-filtered SF query (extend the request-triggered `sf-http-switch-lookup`
  or `sf-on-demand-backfill` flow) — SOQL on `Comp__c` with `Property_Type__c`, `On_Market__c`/`Status__c`,
  `State__c`, `City__c`, returning `Name, Tenant__r.Name, City__c, State__c, Rentable_Square_Footage__c,
  Listing_Price__c, Marketing_Cap_Rate__c, On_Market_Date__c, Status__c` — written as a CSV into the client
  folder (Decision A: no new table). Until built: Salesforce report export (or Claude reading the report in Chrome).
- **CoStar / LoopNet / CREXi / RCA:** operator exports dropped into `Clients\[Client]\[Engagement]\Imports\`,
  normalized + de-duplicated by Claude into Broad Market (address-key dedupe; source + retrieval date per row).
  CoStar For-Sale exports are the primary availables source; RCA supplies sold comps / cap-rate context.
- **Public data egress:** see §7a — the market-metrics refresh must run where public-data hosts are reachable.

### 4.6 Import normalization — Round 1 lessons (Geller, 2026-09-11)
Operator exports are broad (all property types, all Scott's markets), so the pipeline is: type filter → metro
assignment on the official OMB county lists (Census PEP county rows) → address + name/city/price de-dupe →
criteria screen as *flags* (never silent drops) → within-metro percentile leg scores (Derived, broker-adjustable)
→ Focused / Broad Market. Seed code: `Clients\Jordan Geller\2026 Industrial Search\Data\JG_pipeline_scripts_2026-09-11.zip`
(normalize → stage2 → score → build_deals; BDPS styling in `tbstyle.py`). Source quirks to encode:
- **CoStar For-Sale export** has no State/County/lat-long, and CoStar's current For-Sale tab offers only a fixed
  field set (Scott, 2026-09-11) → metro assignment stays ZIP/city-based; make it deterministic with a cached Census
  ZCTA→county relationship file instead of CREXi cross-matching. Portfolio rows appear as "Multiple - Portfolio" and may duplicate
  component-address rows elsewhere (dedupe by name + city + price).
- **CREXi inventory export** has county + lat/long + link (best for geography); header is on row 3.
- **Salesforce Comps report** carries lease detail (expiration, escalation, options, guarantor, broker contact)
  that neither CoStar nor CREXi exports have → it should win field-level merges.
- Nothing carries clear height, dock count or market rent → deal-stage fields.

### 4.7 OM sourcing layer for Focused candidates (Scott, 2026-09-11) — gap BUY-G3
Exports never carry clear height, docks, rent roll, expenses or lease abstracts; the OM does. For every Focused
candidate, find and ingest the OM automatically, then fill the deal-stage columns (Derived from OM, cited):
1. **Salesforce first.** Match the candidate to a `Comp__c` (address / name); if matched, pull its files with the
   existing request-triggered **`sf-on-demand-file`** flow + `om-comp-resolver.js` (already resolves OMs on Comp and
   Deal attachments) → `stageOmIntake` → `intake-extractor`. Round 1: 3 of 24 Focused rows are Salesforce comps.
2. **CoStar sidebar / extension.** On the CoStar For-Sale page, the existing capture path
   (`SPEC_forsale_om_and_webpage_ingest.md`: embedded brochure → OM) grabs the brochure. Needed change: the sidebar
   classifier routes only dia/gov today (`unknown_domain` otherwise) → add an **engagement route** that files the OM
   + extracted fields to the client folder (Decision A: no domain DB) instead of rejecting non-dia/gov listings.
3. **CREXi / LoopNet / broker sites.** Listing links are in the workbook; OMs are usually behind a CA → draft the
   OM-request email to the listing broker (draft only, Scott sends); the W7 email matcher (§4.4) catches the reply
   and routes the attachment into `stageOmIntake`.
4. **Extraction output** (local Ollama, `invokeExtractionAI`): building SF, clear height, docks/drive-ins, year
   built/renovated, lease commencement/expiration, rent & bumps, options, expense structure, guarantor → proposed
   updates to the showing row (review queue, never auto-applied); OM PDF filed to `Clients\[Client]\[Engagement]\OMs\`.

## 5. Phasing (draft)
- **Phase 0 (now):** run Jordan Geller manually in Cowork; capture every step, data source and decision in the
  engagement log → this is the requirements trace.
- **Phase 1:** canon block + Cowork skill + workbook generator (manual data in, branded workbook out).
- **Phase 1b:** buy-side deal anchor + matcher keys + W7.2 proposal types (living engagement, §4.4).
- **Phase 2:** `buyer_engagements` / `buyer_criteria` / `engagement_candidates` tables + MCP tools.
- **Phase 3:** `market_metrics` refresh pipeline + MSA ranking.
- **Phase 4:** general net lease / industrial on-market store + ingestion (Decision A) + matcher.
- **Phase 5:** LCC Buyers tab, feedback loop, buy-side offer/PSA tracking, SF sync.

## 6. Open decisions (Scott)
A. On-market store home (see 4.1). B. Buy-side offers in `log_offer`? C. Scoring legs + default weights.
D. Who uses it (Scott only / Team Briggs / Northmarq-wide) and whether clients ever get a live view.
E. Market-rent and industrial fundamentals source (CoStar access method vs public reports).
F. Salesforce: is the SF Deal/Opportunity the system of record for engagements?

### 6a. Scott's answers (2026-09-11)
- **Users:** Team Briggs (multiple brokers/analysts, each with their own buyers).
- **Decision A — storage (Scott):** don't build/maintain small per-client databases for one-off 30–45 day engagements.
  Design for *quick access to a huge market of data*, with engagement working files stored in the client's shared
  folder. → **Revised direction:** (1) engagement state = files in `Clients\[Client]\[Engagement]\` (workbook +
  engagement log + a machine-readable `criteria.json`/`candidates.csv`), not DB tables; (2) listings/market data are
  **queried on demand** from sources that are already maintained (CoStar, LoopNet/CREXi, SF, email/`cortex_market_intel`,
  dia/gov stores, public APIs) rather than copied into a new store; (3) persist in LCC only what is reused across
  engagements and cheap to keep current (e.g. an MSA metrics cache refreshed on demand, a thin `buyer_engagements`
  index row linking contact → folder → status so the Buyers tab and NBA can see active buyers). Revisit only if
  engagements prove recurring.
- **Scoring:** three legs of the stool — Credit (unit-level importance/performance and/or guarantor credit), Lease
  economics, Real estate fundamentals (incl. contract vs market rent, building/site vs market standard). Editable weights.
- **Market-rent evidence hierarchy:** actual known rents > quoted/estimated; recent > old; leases of vacant space >
  BTS/SLB rents. Every rent carries evidence type + date + source → a merit-weighted market rent.
- **Client deliverable:** full workbook with live weights goes to the client.
- **Sourcing:** use every LCC tool; email and call activity always remain part of the loop (log them, don't replace them).

## 7. To-do
- [x] Repo sweep for existing machinery (2026-09-11)
- [x] Draft v0.1 spec (this file)
- [x] Scott answers §6 (A, C, D answered 2026-09-11; B, E, F still open)
- [ ] Complete Phase 0 on the Geller engagement; fold lessons into v0.2
- [ ] Add `BuyerShowing` DocType + `Clients\` convention to canon filing block (canon bump + render)
- [ ] Draft Claude Code prompt for Phase 1 (prefix `BUY1`)

## 7a. Phase 0 lessons (Geller MSA ranking, 2026-09-11)
- **Egress gap:** cloud container and local shell both get 403 from census.gov / bls.gov / bea.gov (org egress policy).
  Only Chrome could reach them. → Either allowlist public-data hosts for the Railway/cron services, or run the
  market-metrics pull server-side on Railway (it already reaches the internet for CMS/GSA ingest).
- **Census API now requires a key** (`missing_key`); the www2 table-based ACS summary files and PEP CSVs work without one.
- **BLS QCEW** per-MSA CSV slices work, but 2019 vs 2024 use different OMB metro delineations → growth must be
  delineation-aware (flag Conflict), and supersector mfg is suppressed for ~11 of 75 metros.
- **BEA** regional zips work (CAINC1 3.5 MB, CAGDP9 15 MB) but need unzip server-side.
- Reusable artifact: `market_metrics` cache (MSA × metric × vintage × source) is worth persisting — it is shared
  across every buyer engagement and cheap to refresh; per-engagement data stays in the client folder (Decision A).

## 9. Phase 0 outcome & build handoff (2026-09-11) — START HERE for the build
**Pilot result.** One Cowork session ran the whole loop manually for Jordan Geller: MSA ranking (75 metros × 15 public
factors) → operator exports (CoStar / CREXi / Salesforce, 1,683 rows) → metro assignment, de-dupe, screen flags →
OMs (Salesforce Files via Chrome, CREXi public pages, CoStar via Scott) → three-leg scoring incl. automated Credit →
client workbook + explanatory email. Client folder (the requirements trace):
`Team Briggs - Documents/Clients/Jordan Geller/2026 Industrial Search/00-README.md`.

**Deliverable contract (what the generator must produce)** — `Deliverables/Round N/…Buyer Showing….xlsx`, BDPS-styled:
1. **Focused** — ranked best→worst by SCORE; columns grouped PROPERTY · REAL ESTATE (Bldg SF, Land AC, Land:Bldg,
   Year Built, Clear Ht, Loading) · LEASE (Tenant/Tenancy, Lease Type, Lease Exp, Rem. Term, Bumps, Options, NOI,
   Rent/SF, Mkt Rent/SF, Rent vs Mkt) · PRICING (Ask, $/SF, Cap, DOM) · SCORES (Credit, Lease, Real Estate, Score)
   · ACTION (Status, OM/Link, Key Notes). Leg weights are yellow inputs; blank legs = 5.0 neutral.
2. **Market Ranking** — static values + live weights (no links to raw datasets). 3. **Broad Market** — same geometry,
   grouped by metro rank. 4. **Passed**. 5. **Sources & Notes** — per-property source docs, conflicts, credit basis.
6. **How to Use**. Full MSA dataset ships as a separate workbook.

**Credit leg (automated).** Bond-style relative scale: 10 AAA/AA · 9 A · 8 BBB · 7 BBB-/BB+ · 6 BB · 5 B+/B · 4–4.5
unrated private / diversified small-bay · 3–3.5 single small private · 2–2.5 special-use small operator · N/A vacant /
owner-user. No financial transparency = one notch below a public comparable. Look up current public ratings where a
parent exists. Calibrated to SJC "Cap Rate Trends" tenant list (dated anchors only).

**Seed code** (`Data/JG_pipeline_scripts_2026-09-11.zip`): `normalize.py` (per-source parsers) → `stage2.py` (metro
assignment on OMB county lists, dedupe) → `score.py` (percentile legs) → `focus_data.py` (curated OM facts) →
`build_client.py` (client workbook) · `tbstyle.py` (BDPS palette mirroring `bov-generator/bov_constants.py`) ·
`build2.py`/`restyle_analytic.py` (MSA ranking). Port into `bov-generator/` as the buyer-showing generator (Phase 1).

**Gaps confirmed by the pilot:** BUY-G1 (email-alert location extraction), BUY-G2 (no SF path for industrial
`Comp__c`; on-demand file flow is dia-routed + partly broken — Chrome Files→Download worked), BUY-G3 (OM sourcing:
CoStar blocks the Claude browser → sidebar engagement route or operator download), BUY-G4 (public-data egress:
census/bls/bea blocked from sandbox + local shell; Census API needs a key), BUY-G5 (market-rent evidence store:
signed rents from rent rolls / OMs per submarket, merit-weighted), BUY-G6 (credit leg as a reusable scorer with a
tenant→parent→rating lookup).

**Recommended build order:** Phase 1a — port generator + canon block `buyer-engagement.md` + Cowork skill
`buyer-showing` (manual data in, branded workbook out). Phase 1b — living engagement (§4.4) on the deal spine.
Then BUY-G2 → BUY-G3 → BUY-G5. Decision still open: vacant/owner-user treatment in SCORE (neutral 5.0 today).

## 8. Change log
- 2026-09-11 — v0.1 drafted (Cowork session, Jordan Geller kickoff).
- 2026-09-11 — §4.5 sourcing/ingestion audit (gaps BUY-G1 email-alert location extraction, BUY-G2 filtered SF Comp__c query).
- 2026-09-11 — §9 Phase 0 outcome + build handoff (deliverable contract, credit scale, seed code, gaps BUY-G1…G6, build order).
- 2026-09-11 — §4.7 OM sourcing layer (BUY-G3: SF on-demand file flow → CoStar sidebar engagement route → broker OM-request drafts) + CoStar fixed-layout note.
- 2026-09-11 — §4.4 living-engagement design (reuse deal spine + W7 comms + Ollama); Phase 1b added.
