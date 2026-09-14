# Prompt 15 — Create the SF Opportunity for 35724 (GATED: needs Scott's go-ahead)
- Priority: P1 — **BLOCKED on approval** (this is an outward, hard-to-reverse write to Salesforce)
- Status: **hold** — do NOT send until Scott confirms he wants a real SF Opportunity created/back-filled
- Related: `done/02-connect-deal-spine.response.md` (honest gap), prompt 10 (SF Deal->LCC Opportunity Sync)
- Response file: `../responses/15-sf-opportunity-create-35724.response.md`

## Context / decision
The deal-spine infra is live, but property 35724 (Fresenius Woodland Hills, closed) has **no Salesforce
Opportunity** — so seller/buyer/roster/commission can't fill. Claude Code correctly did **not** invent an
`sf_deal_id` or auto-create the Opportunity (an outward write) without approval. Two paths:
  A. **Back-fill:** create a (closed-won) SF Opportunity for this past deal so the record is complete.
  B. **Leave as-is:** keep it a comp-only record; only future deals (with real SF Opportunities) fill via the
     fixed SF Deal->LCC Opportunity Sync flow (prompt 10).
Scott decides. If A:

## Prompt (send ONLY on Scott's go-ahead)
```
With Scott's approval, back-fill the Salesforce Opportunity for the closed Fresenius Woodland Hills deal
(property 35724 / entity d118b3a1): enqueue an sf_sync_queue Opportunity-create (closed-won, $15,729,896,
close 2026-07-24, sell-side/Northmarq), then on the return path stamp dia.sales_transactions.sf_deal_id (14832)
and create the bd_opportunities row, and link parties from the Opportunity into entity_relationships. Set
connected_sources.salesforce = linked. Verify the deal packet's parties/commission fill and the listing-broker
conflict is resolved against the real Opportunity data. Do not fabricate parties not present in the Opportunity.
```

## Verify
35724 has a linked SF Opportunity (sf_deal_id stamped, bd_opportunities row), parties/commission fill from it,
and the listing-broker conflict resolves — only from real SF data.

## DECISION 2026-08-01: Option B chosen — RETIRED
Scott chose Option B: leave 35724 comp-only; do NOT back-fill a Salesforce Opportunity. Future deals fill via the fixed SF Deal -> LCC Opportunity Sync flow (prompt 10). This prompt is retired/not to be sent.
