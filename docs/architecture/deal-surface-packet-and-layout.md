# Deal Surface — packet contract + app layout — 2026-08-01

Two design pieces that make the living deal dossier real: **(1) the deal DATA PACKET contract** — the exact
tagged JSON `buildDealPacket` assembles, the bridge between the connection (prompt 02), the schema (prompt 06),
and the v2 render; and **(2) the deal-surface app layout** — how the living transaction record appears in the
LCC app, distinct from the property surface. Worked record: Fresenius Woodland Hills (property 35724, entity
d118b3a1).

---

## Part 1 — The deal DATA PACKET (`buildDealPacket`)

Same discipline as the property packet: every value is tagged `{v, source, as_of, confidence}`; **missing
fields are omitted** so the renderer prints "Not on file"; derived values carry their inputs; conflicts are
surfaced. Sources: `sf` (Salesforce Opportunity), `outlook`, `sharefile`, `costar`, `deed`, `lease`,
`lcc_model`. Our systems (sf/outlook/sharefile) are **authoritative for parties, commission, and narrative**;
costar is a fallback that never overwrites a sourced party.

```
{
  "identity":  { "property_id": 35724, "entity_id": "d118b3a1...", "address": {v,source},
                 "domain": "dia" },

  "deal":      { "stage": {v: "closed", source: "sf"},           // prospecting|bov|ela|marketing|offers|loi|psa|escrow|diligence|closed
                 "northmarq_role": {v: "sell_side", source: "sf"},
                 "point_person": {v: "Scott Briggs"},
                 "sf_opportunity_id": {v, source: "sf"} },

  "hero":      { "price": {v: 15729896, source: "sf|costar"},     // asking pre-close, sold at close
                 "cap_rate": {v: 0.0600, source: "derived", method: "in_place_noi/price"},
                 "close_date": {v: "2026-07-24", source: "sf|deed"},
                 "team_briggs_fee": {v, source: "sf|ela"} },      // Not on file until ELA linked

  "commission":{ "stage_basis": {v},                              // BOV proposed | ELA negotiated | ELA executed | LOI/closed
                 "ela": { "direct_pct": {v,source:"sharefile|sf"}, "co_broker_pct": {v}, "split": {v},
                          "executed_date": {v} },
                 "fee_on_transaction": {v, source: "derived", inputs: ["ela.direct_pct","hero.price"]} },

  "economics": { "sale_price": {v: 15729896, source},
                 "in_place_noi": {v: 943794, source: "lease|om"},
                 "cap_rate": {v: 0.0600, source: "derived", note: "in-place NOI / price; reconciles to OM asking cap"},
                 "price_per_sf": {v, source: "derived"},
                 // NEVER project rent ahead of the actual schedule; if we were the listing broker,
                 // cap MUST reconcile to our OM asking cap -- else emit a Conflict.
                 "_conflicts": [ {field:"cap_rate", values:[{v:0.0646,source:"calc_projected"},{v:0.0600,source:"om_asking"}], reconciled:0.0600} ] },

  "milestones":[ {date, name, status: "past|now|next", summary, source, detail_ref} ],  // compress older, expand recent

  "parties":  [ { "company": {v, source},
                  "side": {v: "seller|buyer|us|third_party"},
                  "contacts": [ { "name": {v}, "role": {v: "principal|decision_maker|transaction_manager|attorney|title|lender|broker"},
                                  "role_effective_from": {v}, "email": {v}, "phone": {v},
                                  "primary_for": ["topic..."], "source": "sf|outlook" } ] } ],
                  // roles EVOLVE: a transaction manager appearing near LOI vs the decision-maker who drives calls

  "diligence":[ {vendor, type: "survey|pca|phase_i|appraisal|other", ordered_date, site_visit_date,
                 report_eta, completed_date, lender_required, source} ],

  "correspondence": { "summary": {v: "living rollup, older topics decayed", source: "outlook|ollama"},
                      "threads": [ {date, direction, from, to, subject, summary, detail_ref} ] },

  "documents":[ {type: "OM|BOV|ELA|LOI|PSA|roster|report|other", name, source: "sharefile|sf", date, reconciled: bool} ],

  "connected_sources": { "costar": "source", "salesforce": "linked|no_opportunity",
                         "outlook": "linked|not_linked", "sharefile": "linked|not_linked",
                         "deal_spine": "entity d118b3a1" },

  "property_ref": { "tenant": {v}, "guarantor": {v}, "term_remaining_years": {v}, "building_sf": {v} },
                   // a MINIMAL pointer only; full property/lease/trade-area lives on the property dossier

  "open_issues": [ {topic, summary, owner, source} ],

  "analysis":  [ /* derived-only, fenced */ ]
}
```

Field -> v2 layout mapping: `hero`+`commission` -> hero band + Commission section; `milestones` -> Transaction
Story & Milestones; `parties` -> Parties (grouped by company, roles evolving); `diligence` -> Diligence &
Vendors; `correspondence` -> Correspondence Summary; `documents` -> Documents; `connected_sources` -> Connected
Sources panel; `property_ref` -> Property reference line; `economics._conflicts` -> the cap-rate reconciliation
note.

**Assembly** reuses: `bd_opportunities` (deal/stage/SF link), `sales_transactions` + `available_listings`
(price/cap, reconciled to in-place), the deal-spine schema from prompt 06 (commission/milestones/diligence/
party-roles/correspondence-summary), `entity_relationships` (parties), `activity_events` (correspondence),
documents readers, and the local Ollama seam for the correspondence rollup + milestone/role inference.

---

## Part 2 — The deal-surface app layout

### Two surfaces on one asset entity
- **Property tab** = property intelligence (identity, lease, operations, trade area, ownership, transaction
  history) -> the **property dossier**.
- **Deal tab** = the **living transaction record** -> the **deal dossier**. Appears whenever the entity has a
  deal (`bd_opportunities` row, or a `sales_transactions` row with `is_northmarq`, or an open opportunity).
- The two are **cross-linked** (Deal -> "see property", Property -> "active/closed deals"), and the header
  **"Dossier" button offers both** ("Property Dossier" / "Deal Dossier").

### Deal tab structure (mirrors the v2 dossier, interactive)
1. **Hero band** — stage - price - cap (in-place) - **Team Briggs fee**, with a **freshness badge**
   ("updated 2h ago from Outlook").
2. **Transaction story & milestones** — the compressing timeline; **what's next** pinned on top.
3. **Commission** — stage-aware (BOV -> ELA -> LOI -> closed).
4. **Parties by company** — decision-maker vs transaction-manager vs attorney/title/lender, with click-to-email/
   call and "who to copy on <topic>".
5. **Diligence & vendors** — tracker with dates + report ETAs, flagged when a lender-required report is due.
6. **Correspondence summary** — living rollup; each line **double-clicks** to the source email/call.
7. **Connected sources** — the chip row (CoStar / Salesforce / Outlook / Sharefile / deal-spine) with link
   status; click a gap chip to connect/inspect.
8. **Open issues** — surfaced topics + owners.

### Two cross-cutting affordances
- **Double-click to source.** Every summarized line (milestone, correspondence, party, document, commission) is
  a link to its underlying record (email, offer, PSA page, SF field), so a broker or future chat can drill from
  summary -> full nuance in one click. This is the "sufficient paper trail" requirement.
- **Connected-sources indicator.** A persistent, per-deal status of which systems feed the record — the gap is
  visible at a glance and clickable to fix (e.g. "Salesforce: no Opportunity -> link").

### Where it plugs into the code
The entity/contact panel (`openEntityDetail` / `_entityDetailCache`) gains a **Deal tab** alongside the existing
tabs when the entity resolves a deal; it calls `generate_dossier { kind: 'deal' }` / reads
`v_lcc_dossier_current` for the deal type, and renders the packet above. The property panel
(`openUnifiedDetail`) keeps the property dossier. Resolve the entity by the `(dia|gov, asset, property_id)`
identity (prompt 05) so the Deal tab reliably finds its entity.

### Real-time behavior
As Outlook/SF/Sharefile events land (webhooks / sync), the deal spine updates and the packet recomputes;
milestones auto-advance (LOI/PSA/close signals), older correspondence compresses, and the freshness badge
updates. The dossier is **regenerated on material change** (new `source_hash`) and otherwise served from
`lcc_dossiers` current.

---

## How this feeds the queue
- **Prompt 06** (deal-spine data model) should target this packet's `commission`/`milestones`/`diligence`/
  party-roles/correspondence-summary shapes.
- **Prompt 02** (connect the deal spine) should populate the packet from SF/Outlook/Sharefile with the
  authority + conflict rules above.
- A new **prompt 08 — deal tab UI** can build Part 2 once 02/06 land. (Draft it when those return.)

See `DOSSIER-PROGRAM-STATE-OF-PLAY.md` for status; `living-deal-dossier-and-systems-connection.md` for the
systems-connection rationale.
