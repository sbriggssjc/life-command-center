# Closed-deal asset entity + deal-spine wiring (spec) — 2026-08-01

Goal: give a closed deal (worked example: **Fresenius Kidney Care Woodland Hills**, dia property **35724**) an
**LCC asset entity** and link its **Salesforce deal**, so the deal spine (parties · correspondence · offers ·
cadence · ROE) assembles automatically and the deal dossier can be recorded in `lcc_dossiers`. This must be
**repeatable for every closed deal**, not a one-off.

## Why this is needed
`get_property_context` for 35724 returns `resolved_via: dia_property_fallback` / `entity: null` — there is **no
asset entity**. The deal dossier's Deal Spine, Parties, and `lcc_dossiers` record all hang off an entity_id, so
without one they are blank. `lcc_dossiers.entity_id` is **NOT NULL**, so the dossier can't even be indexed.

## How asset entities are actually created (the real mechanism)
Verified against the gold-standard entity for 5247 Airways (`bd4aab4a-…`):

1. **`entities` row** — `entity_type='asset'`, `name` = street address, `domain='dia'`, plus
   address/city/state/zip/lat/lng and `metadata` (a rich ingestion blob: loans, tenants, contacts,
   sales_history, `domain_property_id`, `_pipeline_summary`). `workspace_id='a0000000-0000-0000-0000-000000000001'`.
2. **`external_identities` bridge** — the property↔entity link is a row:
   `(source_system='dia', source_type='asset', external_id='<property_id>')` → `entity_id`, with
   `metadata.domain_property_id=<property_id>` and `metadata.bridge_source='intake_promoter'`. (5247 Airways also
   has an `(rca, property, <parcel>)` identity.)
3. **Minted by `api/_handlers/intake-promoter.js`** — `bridge_source='intake_promoter'` proves the canonical
   creation path is the intake promoter (the sidebar/RCA ingestion → promote flow), **not** a raw insert. The
   promoter also runs propagation (`_pipeline_summary` shows domain records reconciled: leases, sales,
   ownership, listings).

**Implication:** create the entity **through the promoter path**, so it also gets the identity row + the
metadata propagation + dedup — a raw `entities` insert would create an orphan that the loaders can't resolve
(exactly the "no asset entity" state we're fixing) and would skip the CMBS/loan/sales enrichment. *(Note: the
5247 Airways entity metadata already carries the $1.8 M JPMCC CMBS loan that the dia `loans` table is missing —
propagation is where that debt data comes from; a reason to run it here too.)*

## How the Salesforce deal links
`api/_shared/bridge-handlers-salesforce.js → handleSalesforceOpportunityUpsert` upserts a SF Opportunity into
`entities.metadata.salesforce.opportunities[]` on the **account** entity and returns `account_entity_id`. So a
deal links by: (a) resolving/creating the asset entity, (b) resolving the owner/account entity, (c) upserting
the SF Opportunity, and (d) stamping `sales_transactions.sf_deal_id` on the close row (currently null for 35724,
even though `data_source='salesforce_comp'` and `is_northmarq=true`).

## The deal spine (all key off `entity_id`, once it exists)
- `activity_events` — correspondence/call timeline.
- `touchpoint_cadence` (+ `v_next_best_touchpoint`, `v_overdue_touchpoints`) — cadence & next action.
- `lcc_party_relationships(entity, …)` RPC — seller/buyer/broker/lender graph edges.
- ROE — via the entity's `owner_role` / `behavioral_override` fields + rules.
- Offers/LOIs — captured as `activity_events` (there is no separate offers table).
- `lcc_dossiers` — now recordable (entity_id present) via `recordDossier(...)`.

## Worked target — Fresenius Woodland Hills (property 35724)
Create asset entity: name `20931 Burbank Blvd`, domain `dia`, addr Woodland Hills CA 91367, lat/lng
34.1734/-118.5892; identity `(dia, asset, 35724)`. Then capture the deal's parties from the SF deal /
deed — the close row has them **null** (seller, buyer, listing/procuring broker), which is the deal's biggest
data gap — and stamp `sf_deal_id`. Then the deal dossier (`deal-dossier-fresenius-woodland-hills.html`) records
into `lcc_dossiers` and its Deal Spine / Parties sections fill.

## Design decision (my call): a reusable `ensureAssetEntityForProperty()`
Rather than hand-mint one entity, extract the promoter's create+bridge+propagate logic into a reusable
`ensureAssetEntityForProperty(domain, propertyId)` that: finds an existing `external_identities (domain, asset,
propertyId)` → returns it; else creates the `entities` row + identity + runs propagation. Call it (a) from a
**post-close hook** whenever a `sales_transactions` row lands with `is_northmarq=true` and no entity, and (b)
on-demand from the property panel / `generate_dossier`. This closes the loop for every Northmarq close, not just
this one.

---

## Copy/paste prompt for Claude Code

```
Give closed Northmarq deals an LCC asset entity + linked Salesforce deal so the deal spine assembles. Worked
record: dialysis property 35724 (20931 Burbank Blvd, Woodland Hills — the Fresenius sell-side deal that closed
2026-07-24, $15,729,896, is_northmarq=true, sf_deal_id currently null).

1. Extract a reusable ensureAssetEntityForProperty(domain, propertyId) from api/_handlers/intake-promoter.js:
   - Return the entity if external_identities(source_system=domain, source_type='asset', external_id=propertyId)
     exists.
   - Else create the entities row (entity_type='asset', name=address, domain, addr/city/state/zip/lat/lng,
     workspace_id 'a0000000-0000-0000-0000-000000000001', asset_type), insert the external_identities bridge row
     (metadata.domain_property_id, bridge_source='intake_promoter'), and run the promoter's propagation so
     metadata (loans, sales_history, tenants, contacts) + domain reconciliation populate. Verify against the
     5247 Airways gold-standard entity bd4aab4a shape.
2. Call it in a post-close hook: when a sales_transactions row lands with is_northmarq=true and no resolvable
   asset entity, ensure the entity; also expose it on-demand from the property panel + the generate_dossier
   action.
3. Link the Salesforce deal: resolve/create the owner (account) entity, upsert the SF Opportunity via
   handleSalesforceOpportunityUpsert (entities.metadata.salesforce.opportunities[]), stamp
   sales_transactions.sf_deal_id, and capture the deal parties (seller, buyer/new owner, listing + procuring
   broker) onto the close row + the lcc_party_relationships graph. For 35724 these are all null today.
4. Verify the deal spine now resolves for 35724: activity_events (correspondence), touchpoint_cadence
   (cadence/next action), lcc_party_relationships (parties), ROE. Then record the deal dossier into lcc_dossiers
   via recordDossier(...) (entity_id now present) and confirm the deal-dossier example's Deal Spine + Parties
   sections fill from live data instead of showing "Not on file".
5. Also reconcile the two lease-side gaps this record exposed: the "2.5% annually" escalation lives only on a
   superseded lease row (id 17096), not the live lease (id 25390) — carry it forward; and confirm the escalated
   rent-at-sale so the 6.46% recorded cap reconciles against the $943,794 base (base-implied 6.00%).
```

---

## CORRECTION (2026-08-01) — this record already HAS an entity

Verification after Claude Code's feedback: property **35724 already has an asset entity**,
`d118b3a1-ec3b-4e44-aca8-5f76c754ae7a` ("Woodland Hills"), **bridged** via `external_identities (dia, asset,
35724)` (bridge_source intake_promoter). The earlier "no asset entity" premise was wrong — `get_property_context`
returned null only because it resolves by **address** and the entity is named "Woodland Hills", not the street
address (a **resolver gap**). The entity's spine already holds **4 `activity_events`** (correspondence); cadence
is 0 (expected for a closed deal).

`a0feab2e` ("Fresenius Woodland Hills") is a **different** property (29882, 19836 Ventura Blvd) — not a
duplicate.

So for 35724 the real gaps are: **(1)** the Salesforce deal link (`sales_transactions.sf_deal_id` is null),
which also fills **(2)** the null parties (seller/buyer/brokers); **(3)** resolve assets by the
`(dia, asset, property_id)` identity, not address alone; **(4)** carry the "2.5% annually" escalation from the
superseded lease (17096) onto the live lease (25390). The reusable `ensureAssetEntityForProperty()` above is
still the right pattern for **future** closes that genuinely lack an entity — it is a no-op (returns the
existing entity) here. See `DOSSIER-PROGRAM-STATE-OF-PLAY.md` for the consolidated status.
