# Dossier Program — State of Play (START HERE) — updated 2026-08-01

The single index for the LCC property/deal **dossier** program. Any chat (or Claude Code) can start here to
see what exists, what's built, what's verified, and what's next, with links to every artifact. Keep this file
current as the work moves.

## What the program is
A grounded, LLM-replicable **dossier** — one fixed format for a PROPERTY and one for a DEAL — assembled from a
**reconciled DATA PACKET** and authored under a hard **no-fabrication contract** (absent → "Not on file";
computed → "Derived" + inputs; source conflict → reconciled value + "Conflict" note; owner is never the
operator). Authored via the **local Ollama** model, stored in Supabase + the Team Briggs SharePoint, surfaced
in the app.

## Status at a glance

| Component | State | Where |
|---|---|---|
| Property dossier format (v2 gold standard) | locked | `dossier-example-5247-airways-v2.html` |
| Deal dossier format (gold standard) | locked | `deal-dossier-fresenius-woodland-hills.html` |
| Grounding contract + section standard (sections 1-9) | done | `dossier-standard-and-llm-contract.md` |
| Data audit + pipeline triage (P0-P3 backlog) | done | `dossier-v2-audit-and-triage.md` |
| Ollama wiring + storage/access architecture | documented | `dossier-generation-and-ollama-wiring.md` |
| **Production generator** (code, tests, handler, UI) | built by Claude Code | **PR #1549** (`api/_shared/dossier-generator.js`, `dossier-production-wiring-runbook.md`) |
| Closed-deal asset entity + deal spine | spec; entity already exists | `closed-deal-asset-entity-and-deal-spine.md` |
| Ollama env in Railway (`OLLAMA_URL`/model pull) | needs you | runbook Step 5 |
| Salesforce deal link for 35724 (`sf_deal_id`) | pending | see Corrected facts |
| Server-side HTML->PDF render | follow-up | runbook (HTML pushed; browser Save-as-PDF works today) |
| P0-P3 data fixes (CMS denorm, rent calc, loans, docs) | prompts ready | `dossier-followup-prompts-for-claude-code.md` |

## Built & verified (production, PR #1549 — Claude Code)
- `api/_shared/dossier-generator.js` — **facts rendered deterministically in code** from the tagged packet (the
  LLM cannot fabricate them); the Ollama seam (`invokeExtractionAI`) authors **only** the fenced "Analysis"
  block, timeout-bounded so a dead model can't stall generation.
- Packet assemblers `buildPropertyPacket` / `buildDealPacket` — reuse `assemblePropertyPacket` + live lease,
  CMS operations (denorm-vs-CMS conflict surfaced), demographics/ZIP census/payer mix, live sales, documents;
  deals add correspondence/offers/cadence/parties.
- Handler actions — `POST generate_dossier` (assemble -> generate -> reuse-if-fresh by `source_hash` else
  `recordDossier` -> signed URL -> best-effort SharePoint HTML push saving `metadata.sharepoint_url`),
  `GET dossiers`, `GET dossier_url`.
- UI — header "Dossier" button generates/opens the stored server dossier (client-blob fallback); Documents tab
  lists stored dossiers.
- Tests — 8 no-fabrication unit tests + subroutes guard pass.
- Verified vs live Supabase: **23654** matches the v2 gold standard (price/SF $497, rent/SF $28.85 Derived,
  stations 13 with the 171 denorm surfaced as Conflict, owner Kingsbarn / DaVita operator-not-owner);
  **35724** renders honest "Not on file" for absent fields.

## Corrected facts — Fresenius Woodland Hills deal (property 35724)  [supersedes the earlier "no entity" claim]
- The asset **entity exists**: `d118b3a1-ec3b-4e44-aca8-5f76c754ae7a` ("Woodland Hills"), bridged via
  `external_identities (dia, asset, 35724)`. My earlier `get_property_context` returned null only because it
  resolves by **address** ("20931 Burbank Blvd") and the entity is named "Woodland Hills" — a **resolver gap**,
  not a missing entity.
- The deal **spine is partly populated**: **4 `activity_events`** (correspondence) on the entity; **0**
  touchpoint_cadence (expected — the deal is closed).
- `a0feab2e` ("Fresenius Woodland Hills") is a **different** property (29882, 19836 Ventura Blvd) — NOT a
  duplicate; two legitimately separate Woodland Hills Fresenius clinics. (Minor: naming is inconsistent —
  "Woodland Hills" vs "Fresenius Woodland Hills"; worth normalizing to include the operator + street.)
- **Real gaps for this deal:** (1) Salesforce deal link — `sales_transactions.sf_deal_id` is null; linking it
  also fills (2) the null **parties** (seller, buyer, listing/procuring broker) on the close row; (3) the
  **address-only resolver** should also resolve assets by the `(dia, asset, property_id)` identity; (4) the
  "2.5% annually" escalation lives only on the superseded lease row (17096), not the live lease (25390).
- Because the entity exists, the deal dossier can **already** be recorded in `lcc_dossiers` and its spine
  partly fills — the earlier `ensureAssetEntityForProperty()` recommendation still stands for **future** closes
  that genuinely lack an entity, but is NOT needed for 35724.

## Document map (docs/architecture/)
- `DOSSIER-PROGRAM-STATE-OF-PLAY.md` — **this file** — the index/trail.
- `dossier-standard-and-llm-contract.md` — the contract (1), packet (2), property sections (3), deal
  sections (4), gold-standard walk-through (5-6), v2 field additions (7), Location & Trade Area (8), deal
  example pointer (9).
- `dossier-example-5247-airways-v2.html` — property gold standard (5247 Airways).
- `deal-dossier-fresenius-woodland-hills.html` — deal gold standard (35724, corrected spine).
- `dossier-v2-audit-and-triage.md` — what we have vs. should have vs. displays; P0-P3 fix backlog.
- `dossier-followup-prompts-for-claude-code.md` — copy/paste prompts (Prompt 0 = design-vs-production
  reconciliation; 1-8 = the data/UI fixes).
- `dossier-generation-and-ollama-wiring.md` — the pipeline, storage/access decision, and activation prompt.
- `closed-deal-asset-entity-and-deal-spine.md` — the entity/SF-link mechanism (read with the Corrected facts
  above).
- `dossier-production-wiring-runbook.md` — Claude Code's production runbook (arrives with PR #1549); the
  you-only steps (Railway env, SF link, PDF).

## Generator file — one reconciliation note
Two `api/_shared/dossier-generator.js` exist: an initial cut committed locally (commit `b247d97a`) and the
**production version on PR #1549** (deterministic fact rendering + tests + handler + UI). **PR #1549 is
canonical.** On merge, keep the PR #1549 version; the local first-cut is superseded. (The local commit also
added the deal example, standard-doc section 9, and the wiring doc, which are NOT duplicated by the PR and
should be kept.)

## Next steps (in recommended order)
1. **You:** runbook Step 5 — set `OLLAMA_URL`/`OLLAMA_MODEL` (+ CF Access headers) in Railway, `ollama pull`,
   redeploy `main`. This turns generation on.
2. **Claude Code / you:** link the 35724 Salesforce deal (`update sales_transactions set sf_deal_id=... where
   property_id=35724`) + capture parties; then re-generate the deal dossier and confirm Parties + Deal Spine
   fill from live data.
3. **Claude Code:** resolver fix — resolve assets by the `(dia|gov, asset, property_id)` identity, not address
   alone, so panels/tools stop missing entities like "Woodland Hills".
4. **Claude Code:** P0 data fixes from the audit — CMS reconciliation + the $104.6M revenue-model bug, then
   rent/SF + current-escalated-rent (prompts 1-2 in the follow-up doc).
5. **Claude Code:** loan-propagation gap — entity `bd4aab4a` metadata already holds the $1.8M JPMCC CMBS loan
   that the dia `loans` table is missing; wire the propagation from entity metadata -> structured `loans`
   (feeds the dossier's loan section). *(New follow-up; see below.)*

### New follow-up prompt — loan propagation
```
Loan data exists in entities.metadata.loans (e.g. entity bd4aab4a / property 23654 carries a $1.8M JPMCC
2019-COR4 CMBS 1st mortgage, 4.7% fixed, matures 2028-07-06, originated 2018-06-08) but the dialysis `loans`
and `mortgage_records` tables are EMPTY for the asset, so the dossier shows loans as "Not on file." Build a
propagation from entities.metadata.loans -> the structured loans table (initial balance, lender, rate, maturity,
origination, term, LTV, current-balance estimate), keyed by the property via external_identities
(dia, asset, property_id). Suppress brokerages from being written as lenders (the finances-edge pollution).
Verify property 23654 shows the JPMCC loan in its dossier. Then generalize across all asset entities that
carry metadata.loans.
```

---

## UPDATE — 2026-08-01 (session 2): living deal dossier, cap-rate fix, connection audit

**Railway build fixed.** The PR #1549 merge had concatenated two whole copies of
`api/_shared/dossier-generator.js` (redeclared `invokeExtractionAI` -> SyntaxError -> startup crash /
healthcheck fail). Truncated to the production version (lines 1-551); `node --check` passes. Commit `1aae4e20`.
**(Push required for Railway to rebuild.)**

**Claude Code shipped** PR #1550 (`ensureAssetEntityForProperty` + deal-spine wiring; enriched entity
d118b3a1; captured broker party; recorded the deal dossier) and Dialysis #7354 (lease escalation carry-forward
+ rent_at_sale). The post-close reconcile sweep is exported but not yet mounted on pg_cron.

**Cap-rate reconciliation (IMPORTANT correction).** The deal cap is **6.00%**, not 6.46%. Our OM asking was
$15,729,896 @ 6.00% (listing 14879, initial/current_cap_rate 0.0600) and it **sold at asking**; in-place NOI
$943,794 / $15,729,896 = 6.000%. The stored `calculated_cap_rate` 0.0646 / `rent_at_sale` $1,016,362.91
(Dialysis #7354) applied the "2.5% annually" escalation **ahead of the actual schedule** — the wrong direction.
**Fix = in-place rent $943,794 / 6.00% everywhere + correct the lease rent-schedule anchor (Prompt A in
`living-deal-dossier-and-systems-connection.md`).**

**Deal dossier redesigned** as a living, transaction-centric record: `deal-dossier-fresenius-woodland-hills-v2.html`
(new gold standard; the v1 file is superseded). Hero + stage-aware commission, compressing milestone/
transaction-story timeline, parties-by-company (decision-maker vs transaction-manager, attorneys, title, lender),
diligence/vendor tracker, correspondence summary, and a Connected-Sources panel.

**Connection audit (why parties are empty).** The only contact on 35724 is Chris Bodnar/CBRE (role
listing_broker, source costar_sidebar, sf_contact_id null, crm_opportunity_count 0). Every fact is from CoStar +
an SF comp; there is **no Salesforce Opportunity**, and **Outlook/Sharefile are not linked** to the entity — so
seller/buyer/attorneys/title/lender/ELA-commission/narrative have no source. Our own Team Briggs sell-side role
isn't sourced from our own systems (the CBRE attribution is CoStar's third-party view). Full design + fix in
`living-deal-dossier-and-systems-connection.md`.

**New docs this session:** `living-deal-dossier-and-systems-connection.md` (design + audit + Prompts A/B/C +
LCC-layout improvements + Ollama opportunity scan), `deal-dossier-fresenius-woodland-hills-v2.html`.

**Open Claude Code prompts (send + save responses next to each):**
- **A — cap-rate reconciliation** (do first; live data wrong): fix rent_at_sale/cap to $943,794/6.00% + lease
  schedule anchor.
- **B — connect the deal spine**: SF Opportunity + Outlook + Sharefile -> entity d118b3a1 (parties, commission,
  correspondence, diligence).
- **C — broker/role attribution**: make our Northmarq sell-side role authoritative over the CoStar/CBRE feed.
- (queued) loan propagation (entity.metadata.loans -> structured loans); resolver-by-property-id;
  Ollama correspondence-summarization/milestone-extraction once B lands.

**Next recommended:** (1) push to redeploy Railway; (2) run Prompt A (cap fix); (3) run Prompt B (deal-spine
connection) — the highest-leverage step toward the living record.

---

## Claude Code work queue (2026-08-01)
Open prompts + responses now live in **`docs/claude-code/`** (`README.md` = the process, `STATUS.md` = the
index, `prompts/` = open, `responses/` = Scott pastes replies, `done/` = archived). **Every future chat checks
`docs/claude-code/responses/` at the start of the turn**, verifies each new response, updates this trail + the
topic docs, moves the finished prompt to `done/`, and re-drafts downstream prompts. Open now: 01 cap-rate,
02 connect-deal-spine, 03 broker-attribution, 04 loan-propagation, 05 resolver-by-property-id, 06 deal-spine
data model, 07 data-backlog index.

---

## Deal surface — packet contract + app layout (2026-08-01)
`deal-surface-packet-and-layout.md` adds the two design pieces that make the living deal dossier buildable:
**(1)** the `buildDealPacket` tagged-JSON contract (field-by-field, with sources and the cap = in-place-NOI/price
reconciliation rule) mapped to the v2 layout; and **(2)** the deal-surface app layout (a Deal tab distinct from
the Property tab, double-click-to-source, connected-sources indicator, real-time freshness). It targets
prompts 06 (schema) and 02 (connect), and tees up a future prompt 08 (Deal-tab UI) once those land.

---

## Error wave triaged (2026-08-01, session 2) — see `error-triage-2026-08-01.md`
Five connected signals: **Boot Check** fail = the duplicate import (fixed `1aae4e20`); **Daily DB Checks** fail =
field_source_priority schema drift (#710) writing OM/BOV pricing to non-existent `available_listings` columns
(an upstream cause of the 6.46%-vs-6.00% cap error); **20 failing PA flows** incl. **SF Deal -> LCC Opportunity
Sync (74)** and **LCC Get Artifact (685)** — the deal-spine connectors are actively down (why parties/
correspondence/documents are empty); **comps** engine works but is unreachable from the field agents
(`ConnectorOperationNotFound`) and returns unbounded output. New prompts **09** (schema drift), **10** (PA
flows), **11** (comps connector), **08** (Deal-tab UI). Corrected sequence: 09+01 -> 10 -> 06+02 -> 08.
Architecture implication: field-source-priority is a foundation (drift lets the wrong source win); the deal
spine is a set of PA flows that must be fixed before it can fill; and we need an "LCC health" surface so
failures don't hide in a weekly digest.

---

## Responses processed + queue update (2026-08-01, session 2b)
Three Claude Code responses returned and were reconciled (moved to `docs/claude-code/done/`):
- **Cap-rate (prompt 01): DONE** (PR #1551 merged; Dialysis #7355 pending merge). Root cause: the $943,794
  anchor was mis-dated to the superseded lease's 2028-08-28, so the engine projected 3 escalations -> 6.46%.
  Re-anchored to 2025-08-18; sale/listing set to 6.00%; **rebuilt the stale `v_sales_comps` matview (fixed 412
  rows)**; added guard `v_dia_closed_deal_cap_vs_asking` + tests; writer guard in sidebar-pipeline. The wrong
  #7354 migration was superseded.
- **rent/SF + current-escalated-rent (followup 2): DONE** — paired Year-1/current rent + $/SF; lease 16307
  backfilled.
- **transactions/listings timeline (followup 3): DONE** — wired from sales_transactions (live) + available_listings.
New prompts queued: **12** (LCC Health surface — observability so failures don't hide a week), **13** (Property
& Contact tab cross-DB connectivity). Flow review: several failing PA flows are HTTP calls into the LCC app, so
deploying 1aae4e20 likely clears a chunk (noted in prompt 10); the comps ConnectorOperationNotFound is likely an
unregistered action in copilot_action_registry.json (noted in prompt 11).

---

## Deal spine LIVE + more responses (2026-08-01, session 2c)
- **Prompts 02 + 06 DONE (PR #1552).** The deal-spine schema is live: `lcc_deal_commission/_milestone/
  _diligence/_correspondence_summary/_document/_conflict` + `lcc_deal_parties(entity)` (role history via
  entity_relationships) + `lcc_deal_spine(entity)` read model. `buildDealPacket` now emits the tagged packet with
  the reconciliation discipline enforced in code (CoStar/dia_contact broker = third_party "unverified role"; a
  listing_broker conflict stays open). 35724 returns real milestones (OM 6/4, listing 6/8, close 7/24 @ 6.00%),
  the OM doc, a correspondence summary, and an open listing-broker conflict — commission/diligence "Not on file"
  (nothing sourced). **The infra is done; the SF/Outlook/Sharefile FILL is gated on connecting those systems
  (prompt 10) + a decision on back-filling the SF Opportunity (prompt 15, HOLD).**
- **Followup 4 DONE:** lease 16307 now carries guarantor "DaVita Incorporated" + responsibility split
  (roof shared / structure landlord / parking shared / HVAC shared); guaranty_scope null. Updates the 5247
  Airways dossier facts (were "Not on file").
- **New CI failure:** government-lease repo CI "Test & Lint" red on 68b293a (prompt 14) — possibly gov-side of
  the #710 schema drift.
- **Sequence now:** the deal spine is live, so **08 (Deal-tab UI)** is ready to render it; **10** connects the
  live systems to fill it; **15** (SF Opportunity back-fill) awaits Scott's go/no-go.

---

## Big completion wave (2026-08-01, session 2d)
Eight+ prompts returned done; almost the entire property-dossier backlog is complete.
- **03 broker role:** 35724 listing_broker -> Team Briggs/Northmarq; CBRE retained as `as_reported_listing`
  conflict. (Surfaced: is_northmarq=false in the data though it's our deal; sale_brokers_role_check blocks the
  as-reported role -> prompt 17.)
- **04 loan propagation:** fleet-wide — **124 loans + 204 mortgage records** across 2535 asset entities from
  entities.metadata.loans; 23654 shows the JPMCC 2019-COR4 $1.8M CMBS; brokerages suppressed as lenders; a
  Debt/Financing dossier section now renders.
- **05 resolver:** identity-first (dia|gov, asset, property_id) resolution in property-handler + mcp/server;
  stub names normalized to street+operator.
- **08 Deal-tab UI:** entities-handler `action=deal_packet` + detail.js Deal tab (renderer, property cross-link,
  double-click-to-source, connected-source chips). Renders the live deal spine.
- **09 #710:** code done (delete dead rules, register live columns, DB trigger guard, CI test) — **live migration
  apply pending (prompt 16).**
- **Followups 5/6/7/8:** debt-graph suppression + quarantine (8 M&M edges); documents shared gatherer (intake +
  CRE + SF, per-doc reconciled status); relocation lineage + market-competition RPC (live apply pending); Location
  & Trade Area map + Places callouts (radius demographics pending CENSUS_API_KEY).
- **Decision: Option B** — 35724 stays comp-only; prompt 15 retired; future deals fill via the SF Opportunity
  Sync flow (prompt 10).
Focus shifts from dossier content (largely done) to **connectivity + activation**: apply the pending migrations
(16), fix the PA flow connectors (10), property/contact connectivity (13), data-integrity (17), then comps reach
(11) + the health surface (12).

---

## Migrations applied live + connectivity spec (2026-08-01, session 2e)
- **#710 field_source_priority (LCC Opps): APPLIED live** (via Supabase MCP) + verified — dead folder_feed
  listing rules removed, live ask columns registered at priority 45, drift-guard trigger installed. Rerun Daily
  DB Checks to confirm green.
- **Relocation + market competition (Dialysis_DB): APPLIED live** + verified — lineage view (442740: cert
  2017-10-27 / prior 2003-02-01 / 13 stations) and `dia_nearby_dialysis_competition` (8 nearby clinics; DaVita
  comps at $19.63 + $15.00/SF vs subject $28.85 — the renewal-rent-pressure signal). `dia_haversine_miles`
  already existed.
- **CENSUS_API_KEY:** pending Scott (Census key -> Railway Variables + .env.local) to backfill radius demographics.
- **Connectivity spec:** `property-contact-deal-connectivity.md` — the Property/Contact/Deal graph, the two
  reverse read models (`lcc_contact_properties`/`lcc_contact_deals`) and the Contact-tab sections; backs prompt
  13. Prerequisites (02/06/05/08) done, so 13 is a well-scoped build.

---

## Near-complete: 7 more prompts done + 2 migrations applied live (2026-08-01, session 2f)
- **10 PA flows:** root causes fixed app-side — SF Opportunity Sync endpoint wasn't mounted on Railway (404) +
  auth accepted only X-LCC-Key not Bearer; SharePoint artifact refs misrouted to the Supabase signer. Deploy +
  PA retry pending to confirm green.
- **11 comps:** query/synthesize/generate_comps registered in the Copilot registry + connector specs + package;
  output bounded (query_comps 40/100, synthesize 25/50, market filtering). Connector import is the live step.
- **12 LCC Health surface:** APPLIED LIVE (via Supabase MCP; needed a `connector_type::text` cast the repo file
  still lacks — prompt 18). `v_lcc_health_surface` reports **#710 green, connectors green**, and surfaces new
  amber flows (Unflag Completed Email Tasks 253, To Do Sync 63, ...).
- **13 property/contact connectivity:** APPLIED LIVE — `lcc_contact_properties` + `lcc_contact_deals` reverse
  reads; contact360 + detail.js now cross-link contacts <-> properties <-> deals.
- **14 gov CI:** green — a bad import (`ownership_research_queue_enabled` moved to `src.feature_gates`), not #710.
- **17 data-integrity:** LIVE — 35724 `is_northmarq=true`; `sale_brokers` widened for `as_reported_listing`;
  Team Briggs listing + CBRE as-reported both held; reconciliation runs without `--force`.
Nearly the entire program is built + much of it live. Remaining: **CENSUS_API_KEY** (Scott), an **app redeploy**
(activates 10) + **connector import** (activates 11), and **prompt 18** (new amber flows + repo migration-file
hygiene).

---

## End-to-end verification + connector walkthrough (2026-08-02, redeploy live)
Verified live against production after the merge + redeploy:
- **Deal spine (35724 / d118b3a1):** LIVE — 3 milestones, 1 conflict (listing-broker), 1 document.
- **Contact connectivity (13):** LIVE — `lcc_contact_properties` returns real broker->property links (e.g.
  Cawley CRE -> 450 E Roosevelt Rd, property 25334, listing_broker).
- **Health surface (12):** LIVE — #710 green, connectors (Outlook/Copilot/Salesforce) green.
- **PA flows:** RECOVERING — the critical deal-spine flows (SF Deal->LCC Opportunity Sync, LCC Get Artifact) have
  dropped off the failure list; remaining amber = `Unflag Completed Email Tasks` (253->197), `To Do - LCC Sync`
  (63->49), HTTP-Switch (14), RCM (6), SF Daily Bulk File Backfill (4), LoopNet (3) — all trending down; covered
  by prompt 18.
- **#710 schema drift:** GREEN (`field_source_priority_invalid_columns` = 0).
- **Census demographics:** NOT yet backfilled — CENSUS_API_KEY is set but the script must run (prompt 19);
  property_demographics still covers 85 props / 0 for 23654.

**Connector packages:** walkthrough delivered (`docs/comps-rollout/connector-upload-walkthrough-2026-08-02.md`).
The Copilot "LCC Deal Agent" `ConnectorOperationNotFound` fix = re-import `copilot/lcc-deal-intelligence.
connector.v4.swagger.json` (or `lcc-openapi.yaml`) into the Power Platform custom connector with the rotated
`LCC_API_KEY` (Bearer), then add/refresh the comps actions. MCP base URL:
`https://tranquil-delight-production-633f.up.railway.app`.

**Remaining for Scott:** rotate LCC_API_KEY + re-import the connector (§2/§3 of the walkthrough); run the census
backfill (prompt 19). **Remaining build:** prompt 18 (new amber flows + migration hygiene), prompt 19 (census).

---

## 2026-08-03 — Microsoft-surface triage + the MCP pivot (session 2g)

Scott updated the LCC Intelligence connector + Copilot LCC Deal Agent and sent the post-update test chat, hit a
ChatGPT 300-char error updating the custom GPT, flagged that Northmarq Claude can't add a custom connector, and
asked whether Copilot's new "Cowork" (plugins/skills) changes our strategy. Triaged all four; full analysis in
`docs/comps-rollout/ms-surface-triage-and-mcp-pivot.md`.

**Findings.**
- **Copilot LCC Deal Agent:** query_comps + synthesize_comps now work (the earlier ConnectorOperationNotFound is
  fixed). Only the **workbook export** still fails — because **GenerateComps** (`POST /api/comps`) is in the v4
  connector but was never added to the agent's action list. Fix is no-code: add the GenerateComps action.
- **ChatGPT 300-char error:** confirmed `queryComps` desc = 459 chars and `synthesizeComps` = 421 in
  `lcc-openapi.yaml`, both over ChatGPT's ~300 limit. The v4 swagger already carries short versions (247/246).
  -> **prompt 20** (trim the two yaml descriptions, re-import).
- **Northmarq Claude:** can't add a custom connector (admin-locked). Keep routing live comps through the Copilot
  Deal Agent; admin can add the org MCP connector later for native tools.
- **Copilot Cowork / M365 Copilot:** reaches our tools through the **published Copilot Studio agent** — no
  separate wiring. Give the LCC Deal Agent the tools and publish to the Teams & M365 Copilot channel.

**Strategic (the pivot).** Verified on Microsoft Learn that **Copilot Studio can connect directly to an MCP
server as an agent tool** (streamable HTTP transport, `x-ms-agentic-protocol: mcp-streamable-1.0`). Pointing the
LCC Deal Agent at our `/mcp` endpoint would expose **all** LCC tools natively (same contract Claude uses),
eliminating the per-surface OpenAPI/Swagger maintenance and the whole missing-operation / 300-char / schema-drift
class of problems for the Microsoft side. -> **prompt 21** (verify `/mcp` streamable-HTTP + auth, then connect +
publish). ChatGPT still needs the OpenAPI schema, so prompt 20's trim stays useful there.

**Recommended sequence:** (1) now, no code — add GenerateComps to the LCC Deal Agent; (2) prompt 20 — trim the two
descriptions so ChatGPT imports; (3) prompt 21 — the MCP pivot for the Microsoft surfaces. Census (prompt 19)
stays on hold until Scott's Census key works.

**Written this turn:** `docs/comps-rollout/ms-surface-triage-and-mcp-pivot.md`,
`docs/claude-code/prompts/20-chatgpt-openapi-description-trim.md`,
`docs/claude-code/prompts/21-copilot-studio-mcp-pivot.md`, STATUS.md refreshed to session 2g.

---

## 2026-08-03 — Claude Code batch returned; reconciled (session 2h)

Seven prompt responses came back (07, 16, 18, 19, 20, 21). All committed by Claude Code on top of the session-2g
docs; git history is clean/linear. Reconciliation:

**Done.** 07 (data-backlog index reconciled: 0-6 closed, 7/8 carry-forward). 16 (live-apply items 1-2 verified;
census blocked). 18 repo migration hygiene (`connector_type::text` cast + regression test, `node --test` passes).
20 ChatGPT description trim (queryComps 224 / synthesizeComps 200 chars, structure unchanged — ready to re-import).

**Two real blockers surfaced:**

1. **Copilot MCP pivot is blocked by a pre-existing 2-server split (prompt 21 -> new prompt 22).** The probe found
   `POST tranquil-delight-.../mcp` = 404. Cause is already documented in
   `docs/os/architecture/mcp-server-unification.md`: `tranquil-delight` is the root web app; the MCP server
   (`mcp/server.js`) is a *separate, undocumented Railway service* that the working Claude connector uses. The
   decided fix is **unification** — mount `/mcp` + OAuth + bounded read routes onto the root app for one canonical
   URL. That unification is exactly what unblocks Copilot Studio, and also fixes the old "fixes land on the server
   ChatGPT never calls" drift. Wrote **prompt 22** (execute the existing unification changeset + bump
   `initialize` protocolVersion 2024-11-05 -> 2025-03-26 for Copilot's streamable-HTTP + bounded-output smoke
   test). Prompt 21 Part 2 (Scott connects + publishes) waits on 22. The readiness detail (transport, auth,
   19-tool list, bounded-output audit) is in `docs/comps-rollout/mcp-copilot-readiness.md`.

2. **Census key is INVALID, not just unset (prompts 16 & 19).** Claude Code ran the backfill; Census returns
   "Invalid Key" for the configured `CENSUS_API_KEY` (and "Missing Key" with none) — so the key Scott set doesn't
   authenticate. 0 `property_demographics` rows written; coverage still 85 (23654 empty). Needs a valid key from
   api.census.gov, then re-run prompt 19.

**Tenant-side (Scott, not code):** Claude Code cannot edit Power Automate (no PA connector in its session). The
amber flows on the Health surface are mostly **stale/retired**, not actively failing — the two biggest (Unflag
Completed Email Tasks 253, To Do Sync 63) last ran Jul 29 and match retired flows. Scott to confirm those are
Off, verify SF Daily Bulk File Backfill's latest run, and repoint RCM + LoopNet if they still reference stale
Vercel hosts.

**Housekeeping:** 07/16/20 prompts + all 7 returned response files moved to `done/`. Open queue now: 22 (P0),
21 (blocked on 22), 18 (code done; tenant checks remain), 19 (blocked on valid census key).

---

## 2026-08-03 — Prompt 22 landed; ChatGPT + flow reviewed (session 2i)

**Prompt 22 (MCP unification) implemented + committed `ddd9d49e`.** `mcp/server.js` now exports
`mountLccMcp(app)`; root `server.js` mounts `/mcp` + OAuth + the 9 bounded `/api/*` read/comps routes at line
162 (before the `/api/*` 404 fallthrough at 559); `initialize` negotiates protocol `>= 2025-03-26` for Copilot
streamable-HTTP. Local verify: rich `/health` = 19 tools, `/mcp` 401 unauth / authed initialize echoes
2025-06-18, `tools/list` = 19, all 9 routes 401 without bearer, `check:boot` passes. **Deploy-pending** — Scott
sets env vars on `tranquil-delight` + redeploys, then live-verify. Unification doc status flipped to "Phase 2
code landed."

**This is the single unblock for both remaining AI surfaces.** Scott re-imported the trimmed `lcc-openapi.yaml`
into the ChatGPT GPT (prompt 20 worked — import succeeded, GPT correctly refuses to fabricate comps), but the
comps call still returns **"Unknown API route"** — which is precisely the root app's `/api/*` 404 handler
(`server.js:559`). The GPT's comps routes aren't on `tranquil-delight` *yet* — prompt 22's mount puts them there.
So the same redeploy fixes ChatGPT comps **and** brings `/mcp` live for Copilot (prompt 21 Part 2). One deploy,
three problems solved (ChatGPT, Copilot, 2-server drift).

**Power Automate resolved.** The two retired flows are Off. The sole active To Do flow, **LCCToDoCompletionPoll**
(30-min recurrence), was reviewed: GET/POST `tranquil-delight/api/webhooks/todo-completion-poll` (route live at
`server.js:266` → `api/sync.js`; documented in `docs/architecture/flows/todo-completion-poll.md`) → read staged
worklist, reconcile MS To Do + Outlook (resolve message id → move → flag), report completion. Well-formed,
matches the documented design, healthy. It consolidates the two retired flows into one poll.

**Census** paused per Scott until a working key comes back from census.gov (prompt 19 parked).

**Next:** deploy `ddd9d49e` (env + redeploy) → live-verify → ChatGPT comps works + connect Copilot to `/mcp`
and publish to the M365 channel.

---

## 2026-08-03 — Comps connected; triaged the "too few comps" issue (session 2k)

After the deploy + BOV env, ChatGPT's comps connect works, but it could only reach ~9 dialysis comps (one query
returned 1) and concluded the backend hid the historical universe. Investigated directly against Dialysis_DB:
**the universe is fully present and served** — 3,022 live sold dialysis comps (1985–2026, 48 states, 100+ FL);
`rpc_query_comps` returns 100 at limit 100. The engine returned 14 FL comps at states=[FL]+include_unreliable+
limit15. So no data/deploy bug. The agents saw 3–9 due to three compounding request-shaping causes: (1) the
reliability gate is ON by default (excludes imputed-cap comps = most dialysis); (2) small default limits (40/25)
combined with the RPC being most-recent-first; (3) `p_tenant` is a single ILIKE, so a multi-operator string
matched ~nothing (the "1 record"). Immediate no-code workaround: pull with include_unreliable_noi=true, no tenant
filter, limit 100, geo-tiered (FL→Southeast→national) + date_from 2010. Design fix queued as **prompt 23**
(appraisal/full-set mode, rank-before-truncate, tenant list, surface the excluded count). Full analysis:
`docs/comps-rollout/comps-query-shaping-triage-2026-08-03.md`.

---

## 2026-08-03 — Prompt 23 landed; generalized the intent gap (session 2m)

Prompt 23 implemented + committed `39a76315` (scoreComp similarity upgrade, place/subject + operator-list +
appraisal-intent parsing, appraisal-mode synthesis pulling a larger pool + rank-before-cap, skill mirror, tests
pass). DEPLOY-PENDING to tranquil-delight + standalone MCP. Response reconciled → done/.

Scott then asked the right architectural question: is the plain-language gap comps-specific or system-wide? **It's
system-wide.** Wrote `docs/architecture/request-understanding-and-consistency-layer.md`: the three comps failure
modes (subject/entity resolution, intent→mode, Team-Briggs quality contract) recur in generate_bov (highest
exposure), property/contact/deal context, offer-submission, and cms-npi-analysis. Root cause: **no shared request-
understanding layer** — intent parsing, entity resolution, and the no-fabrication/reconciliation contract are
per-tool, so robustness is re-solved each time and the cross-cutting rules can drift. Proposed four shared modules
(Subject/Entity Resolver, Intent Interpreter, Data-Consistency Contract, Reference/Gazetteer) + interpretation
logging, built in phases. **Prompt 24** = the Phase-1 audit (understand-first) before any extraction.

---

## 2026-08-03 — Prompt 24 audit reconciled; ChatGPT comps still 1 (deploy + client-routing) (session 2n)

**Prompt 24 audit complete** (`docs/architecture/intent-resolution-audit-2026-08-03.md`): corrected the exposure
table (BOV already refuses ambiguous matches via a 409 candidate list — its gap is intent/template + quality-
contract adoption, not resolution); **highest silent-guess risk = `get_property_context` + `get_contact_context`**
(`limit=1`/`chooseBestEntity` without alternatives — the 35724/29882 collision class); dossier already refuses
ambiguity. Extraction order: Subject Resolver first, adopted BOV → property → contact → offer → CMS. Queued as
**prompt 25** (Phase 2: build the resolver + retire silent guesses + interpretation logging). Response → done/.

**ChatGPT comps re-test still returned 1 comp — two causes, both actionable:**
1. **Prompt 23 is committed (`39a76315`) but NOT deployed.** The live tranquil-delight + standalone MCP still run
   the old engine. DEPLOY is the first fix.
2. **The GPT over-narrowed** — it parsed "The Villages + DaVita" and sent a narrow structured query, which the
   engine honored → 1. Appraisal-mode only fires when the caller passes the VERBATIM request (so `parseRequest`/
   `detectAppraisalIntent` run) and doesn't pre-narrow. Canon already says "SynthesizeComps first with Scott's
   verbatim request" (`docs/os/canon/comps.md`); the ChatGPT GPT + Copilot agent instructions weren't following
   it. Fix = update client instructions (ChatGPT custom instructions, Copilot agent, OpenAPI action guidance) to
   route every comp request through `synthesizeComps` with the raw request and no self-narrowing. Recorded as the
   client-routing addendum in `request-understanding-and-consistency-layer.md`.

---

## 2026-08-03 — Prompt 25 landed; agent instructions updated for routing + ambiguity (session 2o)

**Prompt 25** implemented + committed: shared `mcp/subject-resolver.js`; `get_property_context`/`get_contact_context`
(MCP + HTTP) now return a `{status, entity, confidence, resolved_via, candidates[]}` envelope — ambiguous matches
surface candidates instead of a silent `limit=1`/`chooseBestEntity` pick; BOV wrapped (keeps 409); interpretation-
logging migration added; tests pass. DEPLOY + migration apply pending. Response → done/.

**Agent instructions updated on all four surfaces** (Scott to paste): added (1) the comps **no-self-narrow** rule —
pass the request verbatim, never invent tenant/metro/date filters, the engine resolves the subject + expands
(appraisal: subject→state→region→national, incl. estimated-NOI) — the exact miss behind ChatGPT's 1-comp result;
and (2) the **resolution/ambiguity** rule from prompt 25 — on `status='ambiguous'` present candidates and ask which
(Woodland Hills 35724 vs 29882), on `not_on_file` say so, never fabricate. Files: `docs/copilot/agent-instructions.md`
(unified/Copilot), `docs/claude/northmarq-claude-instructions.md`, `docs/claude/personal-claude-instructions.md`,
`docs/setup/gpt-actions-system-prompt.txt`; canon source `docs/os/canon/comps.md` (v1.1.0) + new
`docs/os/canon/resolution.md` (+ blocks). ChatGPT also needs its LCC-CANON knowledge file updated to match.

---

## 2026-08-03 — Instruction canon re-rendered properly (v1.2.0); corrected binding-artifact map (session 2p)

Scott's attached live ChatGPT canon revealed the instruction files were out of sync: the canon is a real
single-source system (`docs/os/canon/blocks/*.md` → `docs/os/tools/render-surfaces.mjs` → per-surface bundles in
`docs/os/surfaces/*.canon.md`, config in `docs/os/render.manifest.json`, version in `canon/00-INDEX.md`), but my
prior-session changes were hand-patched instead of rendered, and the new `resolution` block wasn't registered.
Fixed IN-SYSTEM: registered `resolution` in the manifest for all 5 surfaces, bumped CANON_VERSION 1.1.0→1.2.0,
ran `render-surfaces.mjs --write-live`. All 5 bundles + the Copilot live artifact now carry the comps
no-self-narrow + resolution/ambiguity rules at v1.2.0. Reverted the redundant hand-edit to the ChatGPT persona
(canon rides in the `chatgpt.canon.md` Knowledge file). Commit `0480e4a`.

**Correction to session 2o:** the two `docs/claude/*.md` files edited then are NOT the binding artifacts
(SURFACE-SYNC-PROTOCOL §1): Northmarq binds to `_WORKFLOW/NORTHMARQ_PROJECT_PROMPT.md`, Personal Claude to the
`~/.claude/skills/*`. Those `docs/claude/*.md` files are legacy duplicates that still self-label "AUTHORITATIVE"
— a real repo contradiction to reconcile (delete or convert to binding artifacts). Also: only the Copilot artifact
is a `--write-live` target; Northmarq/ChatGPT/Personal/Cowork are "external" (manual paste of the rendered bundle)
— a future improvement is giving each a managed region so one `render --write-live` updates them all.

---

## 2026-08-03 — Instruction fix confirmed working; appraisal-mode over-filter bug found (session 2q)

Updated ChatGPT test: the GPT now passes the request VERBATIM in appraisal mode with no self-narrowing — the
instruction fix (v1.2.0 canon) works. Engine confirmed DEPLOYED with prompts 23+25 (live `synthesize_comps` shows
`appraisal_mode:true`, resolved `subject` block, gazetteer "The Villages"→"Wildwood-The Villages"/FL/Southeast,
score tiers, transparency). BUT it returned 1 comp: appraisal mode set the resolved subject **metro** as a HARD
filter (`p_metros:["Wildwood-The Villages"]`) so `applyLocalScope` collapsed FL's ~14 comps to the subject's own
metro listing. Fix = **prompt 26**: in appraisal mode the subject metro/state must RANK (scoreComp already weights
metro>state>region>national), not hard-filter; pull a state/region pool, rank, cap 30, exclude the subject itself.

Instruction consolidation: re-rendered canon v1.2.0 already updated the in-repo surface bundles + Copilot live
file. Updated the Northmarq master paste-file `_WORKFLOW/NORTHMARQ_PROJECT_PROMPT.md` (v1.9→1.10) in place with the
comps no-self-narrow/appraisal + resolution doctrine (targeted section edit per its own maintenance protocol).
Confirmed the per-surface master paste-files are: Copilot `docs/copilot/agent-instructions.md` (render --write-live),
ChatGPT `docs/os/surfaces/chatgpt.canon.md` Knowledge upload, Northmarq `_WORKFLOW/NORTHMARQ_PROJECT_PROMPT.md`
(rich hand-file, section-synced), Personal/Cowork = skills. True one-command-updates-all still needs each master to
carry a managed CANON region + portable render config (follow-up).

---

## 2026-08-03 — Consolidated the session's understanding into a durable reference (session 2r)

Prompt 26 implemented + committed `b821a908` (appraisal geography ranks not filters; subject excluded via
`meta.excluded_subject`; Tampa non-appraisal still hard-filters; tests pass). Response → done/. DEPLOY-PENDING with 23/25.

Per Scott's ask ("update our files so we find this next time, not from scratch"): wrote
`docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` — the durable map of (1) the instruction canon/render single-source
system + the per-surface master paste-file table + legacy-file warning, (2) the two-server deploy architecture +
env, (3) the comps engine operational reference (3,022-comp inventory, appraisal mode, tenant-ILIKE + reliability
gate, prompts 23/25/26), (4) the DEPLOY-PENDING bundle, (5) pointers to the request-understanding design/audit.
Linked from `docs/os/README.md` (architecture start) and the STATUS.md banner. This is the "read first" doc.

---

## 2026-08-03 — Appraisal mode DEPLOYED + working; new blocker = workbook row round-trip (session 2s)

Prompts 23/25/26 are live. ChatGPT's Villages appraisal test now returns 100 candidates → top ~25 ranked (17 FL),
sold + active listings, 16 flagged retained — the comp expansion is fixed. New blocker on BOTH surfaces: the
curated 25-row set is too big to pass back through the model to `generate_comps` — ChatGPT hits the 45k
bounded-output truncation, Copilot returns SystemError on the payload. Fix = **prompt 27**: one-shot server-side
workbook (extend `generate_comps` to take the `request`, synthesize + build server-side, return only a download
link — mirror the BOV generator). Copilot SystemError should also be checked against connection-authorization +
Generative Orchestration in the Test pane, but the payload one-shot fix removes the size cause. Subject still
resolves as the place "The Villages" (fields Not on file) — resolve the live deal record after the handoff works.
