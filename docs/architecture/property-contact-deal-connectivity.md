# Property ↔ Contact ↔ Deal connectivity model — 2026-08-01

The LCC's three core surfaces — the **Property tab**, the **Contact tab**, and the **Deal tab** — should be one
navigable graph: from any node you reach the related nodes and their live context. This is the design backing
for prompt 13. With the deal spine (02/06), the identity resolver (05), and the Deal-tab UI (08) now built, the
remaining piece is the **contact -> properties/deals reverse direction** and the tab sections that expose it.

## 1. The graph (what already exists)
- **`entities`** (entity_type `asset` | `contact` | `org` | ...) — the nodes.
- **`external_identities`** `(system, 'asset', property_id)` — bridges asset entities <-> domain properties (05).
- **`entity_relationships`** — the edges (owner / operator / listing_broker / procuring_broker / tenant /
  guarantor / lender / attorney / title / co_broker ...) with role + effective dates (the role-history store, 06).
- **`bd_opportunities`** + dia/gov **`sales_transactions`** (`is_northmarq`) — the deals.
- Live read models: **`lcc_deal_spine(entity)`** / **`lcc_deal_parties(entity)`** (deal side), **
  `lcc_party_relationships(entity)`** (counterparty rollup), **contact360** (`action=contact360`: subject,
  portfolio, timeline, engagement, owned_properties, cadence).

The forward reads (property -> parties, deal -> parties) exist. **The gap is the reverse: contact -> the
properties and deals they touch.**

## 2. Contact tab (contact -> everything)
From a contact entity, resolve its company/account entity, then surface:
- **Properties they touch** — `entity_relationships` where the contact/org is owner/operator/broker/attorney/...
  on an asset -> the property (via `external_identities` -> domain property), grouped **by role**.
- **Deals** — `bd_opportunities` + `sales_transactions` (`is_northmarq`) where the contact/org is a party ->
  active + closed, each linking to its **Deal tab**; with their role on the deal.
- **Next action / engagement** — from contact360 cadence + `lcc_deal_spine` (last touch, next scheduled touch,
  ROE), so the tab answers "who do I call, and about what."
- **Click-to-email/call** per contact; "who to copy on <topic>" from the deal-parties roles.

`buildContactPacket(entity)` -> `{ subject, company, roles[], properties[] (by role), deals[] (stage/role/price/
next_action), engagement, next_action }` — every field tagged `{v, source}`, "Not on file" when absent, nothing
fabricated.

## 3. Property tab (property -> everything)
From an asset entity (already largely built): contacts by role (owner, operator, listing/procuring broker,
attorney, title, lender) from `entity_relationships` / `lcc_party_relationships`, each a click through to the
Contact tab; plus the linked **Deal tab** (08) and the existing lease / operations / trade-area / transactions /
documents / **debt** sections.

## 4. Navigation + reconciliation rules
- **Resolve by identity** (05): asset by `(domain, 'asset', property_id)`; contact by entity id / email — never
  address-only.
- **Bidirectional:** property lists contacts + deal; contact lists properties + deals; one click moves between.
- **Reconcile naming/duplicates:** distinct assets that share a name stay distinct (e.g. "Woodland Hills"
  = 35724 vs "Fresenius Woodland Hills" = 29882); merge only true duplicates.
- **No fabrication:** surface only edges that exist; "Not on file" where absent; conflicts surfaced (the
  third-party-broker vs our-role pattern from 03).

## 5. Read models to add (the build, prompt 13)
Only the reverse direction is missing:
- **`lcc_contact_properties(entity)`** — properties where the contact/org has an edge -> `{ property_id, domain,
  address, role, effective_from }`.
- **`lcc_contact_deals(entity)`** — deals where the contact/org is a party -> `{ deal/entity, stage, role,
  price, close_date, next_action }`.
- Fold both into **contact360** (or a new `action=contact_connectivity`) so the Contact tab reads one call.

## 6. App layout
- **Contact tab** gains a **Properties** section (grouped by role), a **Deals** section (active/closed, each ->
  Deal tab), and a **Next action** line — mirroring how the Deal tab exposes parties.
- **Property tab** ensures a **Contacts-by-role** section + the Deal-tab link.
- All three tabs cross-link; the entity panel resolves any of them by identity and shows a **freshness** stamp.

## 7. Where it sits in the queue
Prompt 13 is the build; this is its spec. Sequence: the prerequisites (deal spine 02/06, resolver 05, Deal-tab
08) are **done**, so 13 now adds the two reverse read models + the Contact-tab Properties/Deals/Next-action
sections and the cross-links. Verify on: property 35724 -> its contacts + Deal tab; contact **Kingsbarn Realty**
(owner of 23654) -> its properties + deals; a broker -> their listings/deals.

See `deal-surface-packet-and-layout.md` (Deal tab) and `DOSSIER-PROGRAM-STATE-OF-PLAY.md` (status).
