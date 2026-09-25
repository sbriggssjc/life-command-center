# REVIEW-LANES1 — four review queues fill up but nobody sees them

Backlog: `LISTING-SALE-PARITY1-review-lane`, `MERGELOG-GAP-candidates`, `CONTACTS-GOV-REVIEW-LANE`. Source: Cowork round 79. One topic: every recent accuracy round correctly sent ambiguous cases to review rather than guessing, but none of those queues has a place where Scott can act.

## Measured (from the rows; re-measure first)

| queue | open | what a decision does |
|---|---|---|
| `dia_listing_sale_review` / `gov_listing_sale_review` | 8 / 7 | confirm → the listing closes as sold; reject → that (listing, sale) pair is skipped for good |
| `asset_property_link_review` research tasks (MERGELOG-GAP) | 14 (3 are dia twin pairs: 36851, 36922, 37618) | pick the property → `lcc_repoint_entity_property_id` |
| `lcc_gov_owner_unification_review` (contacts hub) | 728 (330 fuzzy / 308 ambiguous / 90 already-linked) | link / create / not-same |
| contacts-hub Conflicts | 53 (two hub contacts for one owner, e.g. `JEMALS BAY 50 LP` / `Jemal's Bay 50 Limited Partnership`) | merge through the contact merge path, or keep both |

## Ask

1. **Reuse the Decision Center lane machinery.** Read how the property_merge / seller-lead / twin lanes register a decision type, render a card and apply a verdict, then register these as decision types. Don't build a new page.
2. **Auto-resolve the safe classes first, logged and reversible, before anything reaches a human.** For example:
   - the 90 "already-linked" owner reviews, if they are already linked to the right contact;
   - listing-sale reviews where a later sale or evidence settles it.
   Report what's left for humans per queue.
3. **One card per decision,** with the evidence the round already gathered (addresses, parcel, prices, dates, the candidate ids) and the one-click verdicts from the table. Every verdict writes through the existing function, is logged, and can be undone.
4. **Order the lanes by accuracy impact** on what Scott sees (listing-sale first, since it's Available), and give the Priority/Decision surface a count badge per lane.
5. **Guard:** each queue's open count feeds a health metric, so a queue that grows without anyone deciding shows up.

Tests: each decision type applies its verdict through the right writer; an auto-resolve only takes the safe class; an undo restores. Each needs a mutation that turns it red.

## Done means

- The backlog rows updated with the evidence.
- LCC code deploy = redeploy BOTH Railway services, with cache busters bumped if the frontend changes.
- Scott works the listing-sale lane once (15 cards or fewer after auto-resolve) and reports anything confusing.
