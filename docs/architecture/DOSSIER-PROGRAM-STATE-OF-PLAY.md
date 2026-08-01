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
