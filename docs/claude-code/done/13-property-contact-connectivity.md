# Prompt 13 — Property & Contact tab connectivity (cross-DB navigation)
- Priority: **P1**
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/deal-surface-packet-and-layout.md`, `contact-owner-sidebar-design.md`, entity_relationships, external_identities
- Response file: `../responses/13-property-contact-connectivity.response.md`

## Prompt (copy/paste to Claude Code)
```
Make the Property tab and Contact tab fully navigable across the database so opening either surfaces the
related entities and their deal/property context (both directions).
1. Contact tab: from a contact entity, resolve their company/account entity, then show: properties they touch
   (owned/operated/brokered via entity_relationships), active + closed deals (bd_opportunities /
   sales_transactions with is_northmarq), the deal spine (correspondence/cadence/ROE), and a next-action. Group
   by relationship (owner vs operator vs broker vs attorney/title/lender).
2. Property tab: from a property/asset entity, surface related contacts by role (owner, operator, listing/
   procuring broker, attorney, title, lender) with click-to-email/call, plus the linked Deal tab (prompt 08).
3. Resolve reliably by the (dia|gov, asset, property_id) identity (prompt 05) and the contact<->entity links;
   reconcile duplicate/inconsistent names (e.g. "Woodland Hills" vs "Fresenius Woodland Hills").
4. Cross-link: every property lists its contacts+deal; every contact lists its properties+deals; one click
   moves between them.
Verify on property 35724 (Fresenius) + 23654 (5247 Airways): the Property tab shows contacts + the deal, and a
contact (e.g. Kingsbarn Realty, or a broker) shows their properties + deals. Do not fabricate relationships —
only surface graph edges that exist; render "Not on file" where absent.
```

## Verify
From a property you can reach its contacts + deal; from a contact you can reach their properties + deals; both
resolve by identity and reconcile naming; nothing fabricated.

> **Design spec:** `docs/architecture/property-contact-deal-connectivity.md` (the graph, the two reverse read models `lcc_contact_properties`/`lcc_contact_deals`, the Contact-tab sections). Prerequisites 02/06/05/08 are done; build the reverse reads + Contact-tab Properties/Deals/Next-action sections + cross-links.
