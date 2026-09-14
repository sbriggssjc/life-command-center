# Prompt 08 — Deal-tab UI (the deal-surface layout)
- Priority: P1 (after 02/06 populate data)
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/deal-surface-packet-and-layout.md` (Part 2), `deal-dossier-fresenius-woodland-hills-v2.html`
- Response file: `../responses/08-deal-tab-ui.response.md`

## Prompt (copy/paste to Claude Code)
```
Build the Deal-tab UI per docs/architecture/deal-surface-packet-and-layout.md Part 2 and the gold-standard
render deal-dossier-fresenius-woodland-hills-v2.html. On the entity/contact panel (openEntityDetail /
_entityDetailCache), add a Deal tab distinct from the Property tab, shown when the entity resolves a deal
(bd_opportunities row, or a sales_transactions row with is_northmarq, or an open opportunity). It renders the
buildDealPacket shape (Part 1): hero band (stage, price, in-place cap, Team Briggs fee, freshness badge),
transaction story & milestones (compressing, "what's next" pinned), stage-aware commission, parties-by-company
(decision-maker vs transaction-manager vs attorney/title/lender), diligence & vendors tracker, correspondence
summary, a connected-sources chip row (CoStar/Salesforce/Outlook/Sharefile/deal-spine) with link status, and
open issues. Two cross-cutting affordances: (1) double-click any summarized line to its underlying source
(email, offer, PSA page, SF record); (2) the connected-sources chips are clickable to inspect/connect. The
header "Dossier" button offers both Property Dossier and Deal Dossier; cross-link the two tabs. Resolve the
entity by the (dia|gov, asset, property_id) identity (prompt 05). Regenerate on material change (source_hash)
else serve v_lcc_dossier_current. Verify on property 35724 / entity d118b3a1.
```

## Verify
The entity panel shows a Deal tab for 35724 rendering the v2 layout from live data, with working double-click
and connected-sources chips, cross-linked to the Property tab.
