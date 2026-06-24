# Claude Code — UI Phase 5: "Owners Missing a Contact" value-ranked BD worklist

## Why (roadmap Phase 5 — the #1 direct-BD gap; scope corrected by live grounding 2026-06-23)
The BD spine is owner-centric, but valued owners with **no human to call** are surfaced nowhere as
a ranked worklist. Grounded live on LCC Opps:
- **3,826** owners with a current portfolio rollup rent > 0 have **no linked person and no
  Salesforce Contact**; **507** of those carry **≥ $1M** portfolio rent (top **$34M**).
- The Priority Queue's **P-CONTACT** band (179) only covers **cadence-bearing** contactless owners;
  `v_owner_active_contact` (172) only covers the **bridged-with-domain-signals** slice. The big
  value-bearing middle — valued owners, no cadence, no contact — is in **no operator surface**.
- The Contacts/Entities page (`contacts-ui.js`) today is a people-list + merge-queue + data-quality
  surface, **not** an owner BD worklist.

**Scope corrections from grounding (do NOT rebuild these):**
- **Floating persons = 12** (the original audit said ~4,447 — R39/R40 dedup + entity-link solved
  it). NOT a Phase-5 workstream; skip the floating-person-linking unit.
- The **acquisition engine already exists** — the contact picker (`?action=buyer_contacts` →
  `select_prospecting_contact`, operations.js), the `owner-contact-enrich-tick` worker +
  `v_owner_active_contact.enrichment_action` (sos_manager_lookup / address_reverse_lookup /
  public_company_ir / parse_deed_signatory), value ranking (`v_entity_portfolio_all`,
  `lcc_entity_connected_value`), and the 4B owner-detail Contacts-tab acquire CTA. Phase 5
  **LEVERAGES** these — it adds the value-ranked worklist VIEW + the operator SURFACE, not new
  acquisition logic.

Consumption-Layer doctrine applies (this is a producer→surface): value-gate, ranked, capped,
honest counts, auto-retire when an owner gets a contact.

## Unit 1 — the worklist view (LCC Opps migration, additive)
Create **`v_owner_contact_worklist`**: one row per **contactless valued owner** —
- **contactless** = owner entity (distinct `entity_id` in `lcc_entity_portfolio_facts` where
  `is_current`) with NO `entity_relationships` edge to a `person` entity
  (`associated_with`/`contact_at`/`works_at`) AND no `external_identities(salesforce, Contact)`;
- **valued** = `v_entity_portfolio_all.current_annual_rent_total > 0` (the value-gate; the
  `rank_value`);
- columns: `entity_id`, `owner_name`, `rank_value` (rollup rent; fall back to
  `lcc_entity_connected_value.connected_property_value`), `property_count`, `domain(s)`,
  `enrichment_action` (LEFT JOIN `v_owner_active_contact` where present, else NULL = "acquire/
  research"), `bench_size`, `is_buyer_parent` (exclude/handle P-BUYER parents per R5 — they use the
  buy-side path, not prospecting), ordered `rank_value DESC`.
- **Exclusions (honest worklist):** dia operator-as-owner artifacts (DaVita/Fresenius/US Renal — reuse
  `lcc_is_operator_owner_name`), junk-named entities (`metadata.junk_name_flagged`), and
  buyer-SPE/parents (route those to the existing P-BUYER buy-side flow). These would be noise in a
  "go prospect this owner" list.
- **Auto-retire is structural** (a view): once an owner gains a person link / SF contact, it drops
  out next read — no sweep needed.

## Unit 2 — the operator surface (Contacts/Entities page → BD worklist)
Make the Contacts/Entities page LEAD with an **"Owners Missing a Contact"** value-ranked worklist
(the page's primary BD job; keep the existing people-list / merge / data-quality as secondary
tabs/sections). Per row: owner name · portfolio value (rank_value) · property count · the
enrichment hint · a one-click action. Default to the **workable high-value set** (e.g. ≥ $1M, top
N, with a "show all" toggle) — Consumption-Layer: the headline count is **actionable** (e.g. "507
valued owners need a contact"), not the raw 5,546. Each row opens the **4B owner detail** (Contacts
tab) where the acquire CTA already lives — so the worklist routes into the detail we just built.

## Unit 3 — wire the row action to the existing engine (no new acquisition logic)
Each worklist row's primary action uses what exists:
- If `enrichment_action` is set (sos_manager_lookup / address_reverse_lookup / public_company_ir),
  surface it as the suggested next step (and, where the `owner-contact-enrich-tick` worker handles
  it, note it's queued/auto-draining).
- Else the action is **"Select contact"** → the existing picker (`buyer_contacts` /
  `select_prospecting_contact`) on the owner, exactly as the 4B Contacts tab + P-CONTACT card do.
- Acquiring/linking a contact retires the row (Unit 1 view drops it). No duplicate engine.

## Boundaries / verify
- LCC-Opps migration for `v_owner_contact_worklist` (additive, idempotent); client surface
  (`contacts-ui.js` + maybe a read sub-route on an existing handler — **no new api/*.js**, stays
  12); reuse the 4B owner detail + the existing picker/enrich engine; no new acquisition logic.
- Honest counts (actionable ≥$1M default ~507; "show all" ~3,826); value-ranked; capped; excludes
  operator-as-owner / junk / buyer-parents.
- Verify live: the Contacts page leads with the worklist; top rows are real high-value contactless
  owners (rank_value matches `v_entity_portfolio_all`); a row opens the 4B owner detail; selecting
  a contact removes the owner from the worklist on refresh; counts are actionable (not 5,546).
- `node --check`; suite green; 12 api files.

## Documentation
Update `life-command-center/CLAUDE.md`: the Contacts/Entities page is now the owners-missing-a-
contact BD worklist (`v_owner_contact_worklist`, value-ranked, engine = CONTACT-SELECTION picker +
enrich worker); floating-person linking is effectively complete (12 remain); note Phase 5 done.

## Bottom line
507 owners with ≥$1M of portfolio and no one to call (3,826 with any rent) are invisible today.
Phase 5 surfaces them as a value-ranked, honestly-counted worklist on the Contacts page, routing
each into the 4B owner detail and the existing contact-acquisition engine — turning the
owner-centric graph into an actionable "go get the contact" queue. Floating-persons + the
acquisition engine are already done; this is the missing surface.
