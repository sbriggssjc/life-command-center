# Prompt 02 — Connect the deal spine (SF Opportunity + Outlook + Sharefile)
- Priority: **P0** (unlocks the living deal dossier)
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/living-deal-dossier-and-systems-connection.md` §2-3; entity d118b3a1 / property 35724
- Response file: `../responses/02-connect-deal-spine.response.md`

## Prompt (copy/paste to Claude Code)
```
The deal dossier for property 35724 / entity d118b3a1 can't tell the transaction story because its own sources
aren't connected: the only contact is Chris Bodnar/CBRE from costar_sidebar (sf_contact_id null,
crm_opportunity_count 0); there is no Salesforce Opportunity linked; Outlook and Sharefile are not linked to the
entity. Build the deal-spine connection so parties/correspondence/commission/documents reconcile onto the asset
entity:
1. Salesforce: resolve or create the deal's Opportunity, link it (stamp sales_transactions.sf_deal_id), and pull
   parties (seller/buyer/brokers) + roster + ELA/commission + LOI/PSA fields into the party graph (entity_relationships)
   + activity_events. Where we were the listing broker (is_northmarq sell-side), capture the Team Briggs broker as
   a party -- do not let CoStar's CBRE attribution stand as our role unverified; surface a Conflict (party_extract_
   disagreements) if they disagree.
2. Outlook: link the email/call thread for this deal to entity d118b3a1 -> dated, directional activity_events;
   infer evolving contact roles (decision-maker vs transaction manager) and attorney/title/vendor mentions.
3. Sharefile/deal room: link the OM/BOV/ELA/LOI/PSA/distribution-roster/diligence docs to the entity with a
   reconciled status; extract the roster into parties and diligence reports into a vendor tracker (vendor,
   ordered date, site visit, report ETA, lender requirement).
4. Reconciliation discipline: our systems (SF/Outlook/Sharefile) are authoritative for parties/commission/
   narrative; CoStar is a fallback that must not overwrite a sourced party; conflicts surface; nothing fabricated.
Note: the deal-spine schema (commission/ELA, milestones, diligence vendors, party-roles-over-time, correspondence
summaries) is specified in prompt 06 -- build 06 first or alongside.
Verify against 35724 that the deal dossier's Parties, Commission, Correspondence, and Diligence sections fill
from live sources instead of "Not on file."
```

## Verify
35724 shows a linked SF Opportunity (sf_deal_id stamped), parties beyond the CBRE feed, dated Outlook activity,
linked deal-room docs, and the dossier's Parties/Commission/Correspondence/Diligence sections populated.

> **Packet target:** populate the `buildDealPacket` shape in `docs/architecture/deal-surface-packet-and-layout.md` (Part 1), honoring the source-authority + cap-reconciliation rules.
