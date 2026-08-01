# Prompt 06 — Deal-spine data model for the living dossier (schema)
- Priority: **P0** (foundation for prompt 02)
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/living-deal-dossier-and-systems-connection.md` §1-2; existing `bd_opportunities`,
  `entity_relationships`, `party_extract_batch`/`party_extract_disagreements`, `activity_events`
- Response file: `../responses/06-deal-spine-data-model.response.md`

## Prompt (copy/paste to Claude Code)
```
Design + build the deal-spine data model the living deal dossier needs (see
docs/architecture/living-deal-dossier-and-systems-connection.md). Reuse what exists (bd_opportunities as the deal
container, entity_relationships as the party graph, activity_events for correspondence, party_extract_* for
disagreement handling) and add the missing structures, all keyed to the deal/asset entity:
1. Commission/ELA: deal-level commission terms + stage (BOV proposed direct+co-broker; ELA negotiated points;
   ELA executed direct/co-broker structure; LOI/closed fee = rate x price). Store rate(s), co-broker split,
   direct vs co-broker, source doc, stage, executed date.
2. Milestones: chronological transaction milestones (prospecting, BOV, ELA, OM/marketing, offers, LOI, PSA,
   escrow, diligence, close) with date, status (past/now/next), source, and a short summary; support "compress
   older, expand recent."
3. Diligence vendors: vendor, type (survey/PCA/Phase I/appraisal/other), ordered date, site-visit date, report
   ETA, completed date, lender-required flag.
4. Party roles over time: extend entity_relationships (or a role-history) so a contact's role can evolve
   (business decision-maker vs transaction manager vs attorney/title/lender) with effective dates + source.
5. Correspondence summaries: a rolling per-deal summary (living, with decay) linkable back to the underlying
   activity_events for double-click detail.
Provide migrations (idempotent), read models/views for the dossier packet (buildDealPacket), and no-fabrication
discipline (absent -> Not on file). Verify the schema supports rendering the deal-dossier-v2 layout for property
35724 once prompt 02 connects the sources.
```

## Verify
Migrations applied; buildDealPacket can read commission/milestones/diligence/party-roles/correspondence-summary;
the deal-dossier-v2 sections have real backing tables to populate from.

> **Packet target:** build to the `buildDealPacket` shape in `docs/architecture/deal-surface-packet-and-layout.md` (Part 1).
