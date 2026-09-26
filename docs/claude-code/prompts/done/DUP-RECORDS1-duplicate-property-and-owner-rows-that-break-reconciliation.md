# DUP-RECORDS1 — duplicate property and owner rows are now the main thing blocking listing↔sale accuracy

Backlog: `SALE-PROMOTER1-dup-properties`, `REVIEW-LANES1-gov-owner-dups`, `SALE-PROMOTER1-sidebar-feed`. Source: Cowork round 80. One topic: every recent accuracy round ends with "refused because the sale / listing / owner sits on a duplicate row".

## Scott's standing rule (2026-09-24, Saginaw)

> "merge and consolidate into the most accurate source of truth for all history … whatever answer gets to that solution permanently and persistently for all records."

- Merge **only through the reversible merges** (`<dom>_merge_property_reversible`, `apply_owner_merge` on gov). The survivor is the more complete / more accurate row. History (sales, leases, listings, ownership) moves to the survivor.
- Where the evidence is **not** unambiguous (two independent signals, e.g. parcel + address, or CCN + address), queue a twin review card (the REVIEW-LANES1 lanes) instead of merging.

## Measured (Cowork, live, 2026-09-25)

**Dayton, 1403–1431 Business Center Ct.** Scott: "if it doesn't fit in either database, remove it."
- **Gov:** listing 41071 had no government tenant. Cowork took it off gov Available, logged and restorable (`gov_avail1_restore_listing_quarantine('cowork_r80_dayton_out_of_domain_20260925')`).
- **Dia:** it does fit. The building houses **DaVita Wright Field Dialysis**, and it is listed **twice**:
  - listing 15006 on property **38412** ("1403-1431 Business Center Ct", 11,920 SF, $2,037,500 ask, seller The Gilbert Group);
  - listing 15281 on property **27901** ("1431 Business Center Ct", 13,421 SF, carries the Medicare clinic, no ask).
  - Same broker (Dan Cooper), same 7.40% cap. It's the same offering, counted twice.
  - The two properties differ on SF, so this may be a multi-building site and not a clean twin. Decide from parcel / CoStar id.

**Duplicate property rows behind the SALE-PROMOTER1 refusals:**
- dia Oak Forest 25570 / 38853 ("5340A W 159th St" / "5340 159th St");
- dia Kissimmee 37696 ("For Sale | 802 N John Young Pky", a junk address) / 37624 / 24669;
- dia 35815 / the owner of sale 15136;
- gov Marathon: the listing is on 3741 but describes 24700 Overseas Hwy (41088, which has the sale).

**Duplicate gov recorded owners:** the 88 owner reviews REVIEW-LANES1 auto-resolved are all gov duplicate owners, e.g. `GRAHAM OFFICE LLC` / `Graham Office, LLC`, both live.

**Root cause, per SALE-PROMOTER1:** `upsertDomainSales` sometimes lands a sidebar sale on a different property row than the listing, and nothing feeds sidebar sales to the promoter on a schedule (`SALE-PROMOTER1-sidebar-feed`).

## Ask

1. **Resolve each named case under Scott's rule.** Merge where two independent signals agree; otherwise open a twin card with the evidence. For Dayton, decide one building vs two from parcel / CoStar id.
   - If one: merge, and keep one listing (price and seller from 15006, clinic and property from 27901, or whichever survivor your evidence picks), superseding the other, logged.
   - If two: keep the listing on the property the OM describes and supersede the other.
   - Marathon: repoint the listing to 41088; the parity trigger then closes it.
   - After each fix, confirm the listing↔sale reviews for these properties resolve (REVIEW-LANES1 auto-resolve or card).
2. **Gov owner duplicates:** merge the case-and-punctuation-only duplicate recorded owners through `apply_owner_merge`, dry-run first. Report counts, merge only the unambiguous class, and confirm the hub's merge-follow repoints contacts (REVIEW-LANES1 / CONTACTS-GOV-WRITER).
3. **Stop new duplicates at the source.**
   - Find why `upsertDomainSales` / the listing writer pick different property rows for one capture, and make both use the same resolved property id: the existing-record-first matcher from GOV-CLASSIFY1, plus the route/civic guards.
   - Reject junk addresses like "For Sale | …" at the property writer.
   - Then build the sidebar-sale feed (an LCC cron pushing new `sales_history` rows through the service key) so the promoter sees sidebar sales daily.
4. **Size the rest.** Count same-address / same-parcel property pairs still live on each DB and send the unambiguous ones through step 1's rule. Report what went to cards.

Tests: merge only on two signals; the listing and sale writers resolve the same property for one capture; a junk address is refused; the feed is idempotent. Each needs a mutation that turns it red.

## Done means

- The backlog rows updated with the evidence, one line per named case.
- Migrations in the owning repos.
- LCC code deploy = redeploy BOTH Railway services.
