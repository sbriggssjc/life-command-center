# Claude Code prompt — E2E#6: BD targeting correctness (dia anchors to the tenant) + idempotence + persisted banner state

Paste into Claude Code, run from the **life-command-center** repo. Found during
the final live sweep by exercising real create-leads on both domains.

---

## Context (verified live 2026-06-03 — don't re-investigate)

Three opportunities now exist in `bd_opportunities` (all from today's live loop
tests). Two are anchored correctly; one exposes a real targeting bug:

| entity | domain | origin | verdict |
|---|---|---|---|
| EAGLE RIVER INVESTORS – HAWAII, LLC | gov | queue open_opportunity | ✓ correct |
| Rutherford & Strickland | gov | property_flow (prop 3841) | ✓ correct (true owner) |
| **Davita** | dia | property_flow (prop **26502**, Palestra Properties) | ✗ **anchored to the TENANT** |

### (a) dia create-lead anchors to the operator, not the owner  (the real bug)
Property dia 26502's recorded owner is **Palestra Properties** (landlord — the
BD target). Its dialysis "true owner" resolves to **DaVita** because of the
operator-chain model — that's what the `true_owner_is_operator` flag exists to
mark. But the create-lead path ignores it:
- `detail.js _udResolveEntityViaCreateLead` sends
  `true_owner_name: own.true_owner_canonical || own.true_owner` unconditionally.
- `api/operations.js bridgeCreateLead` computes
  `ownerDisplay = true_owner_name || owner_name` — so the entity (and
  `marketing_leads.lead_name`) anchored to "DaVita Inc." instead of Palestra.

**Fix:** when `own.true_owner_is_operator` is truthy (the ownership cache carries
it — `_udOwnershipLadder` already branches on it), the frontend must NOT pass the
operator as `true_owner_name`; anchor on the recorded owner instead (pass
`true_owner_name: null`, plus `true_owner_is_operator: true` for transparency).
Belt-and-suspenders in `bridgeCreateLead`: if the body carries
`true_owner_is_operator: true`, prefer `owner_name` for `ownerDisplay`/entity
seeding. BD outreach targets landlords, not tenants.

**Data cleanup:** the mis-anchored test artifact — the "Davita" `bd_opportunities`
row (origin `property_flow`, prop 26502, opened 2026-06-03 ~20:09), its auto-seeded
`touchpoint_cadence`, and the dia `marketing_leads` row
(`lead_name='DaVita Inc.', lead_company='Palestra Properties', property_address='4145 Cass Ave'`).
Close/void the opportunity + cadence (terminal status + audit note, same doctrine
as the orphan cadences) and fix the lead row's naming to anchor on Palestra
(or void it too and let Scott re-create through the fixed flow — your call,
state it in the PR).

### (b) No idempotence on create_lead / open_opportunity
Nothing prevents a second click from creating a duplicate open opportunity for
the same entity. Add a guard in **both** paths:
- `lcc_open_prospect_opportunity`: if an OPEN (`is_open`) opportunity already
  exists for `p_entity_id`, return its id (add an `already_open` flag if the
  return shape allows) instead of inserting a duplicate.
- `bridgeCreateLead`: same check before the `bd_opportunities` insert; return
  `bd_opportunity_id` of the existing open one with `already_open: true`.

### (c) Banner state doesn't persist across reopens
The next-step banner live-advances after create-lead (PR #1023), but on a fresh
re-open of an already-led property it shows **"Create the lead"** again (verified
live on dia 26502 an hour after its lead was created) — because `needsLead` is
`… || !own.owner_entity_id` and the domain ownership row doesn't carry the LCC
entity id on load. Combined with (b)'s missing guard, one click duplicates the
lead.

**Fix:** the detail load already calls `/api/entities?action=lookup_asset…`
(network-verified). Use its resolved entity id to populate
`_udCache.ownership.owner_entity_id` on open, then have the ownership-signals
enrichment (or the priority-band fetch) also check for an open opportunity /
cadence for that entity (one cheap LCC query) and stash
`_udCache.ownerOpp = { open: true, cadence_next_touch_due }`. `_udRenderNextStep`
then renders the persisted truth: "Lead is live → Add to cadence" or
"On cadence ✓ — next touch <date>" instead of re-offering "Create the lead".

## Verify + ship
- Re-open dia 26502 fresh: banner shows the persisted state, NOT "Create the lead".
- create-lead on a dialysis property whose true-owner-is-operator anchors the
  entity/lead to the **recorded owner** (landlord), never the operator.
- Clicking open_opportunity / create-lead twice yields ONE open opportunity
  (`already_open` on the second call).
- The "Davita" artifact is dispositioned with an audit note; `bd_opportunities`
  contains only correctly-anchored open opportunities.
- `node --check` on detail.js/operations.js; migrations idempotent; function
  count unchanged. End with merge + deploy commands.
