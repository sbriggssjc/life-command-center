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
