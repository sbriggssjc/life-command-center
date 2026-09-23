# SF-BRIDGE1 — our own Salesforce deals arrive in LCC with no type and no address, and their OMs can't find their property (LCC repo)

Backlog: `GOV-UX1-D4-sftype`, plus the new `SF-BRIDGE1`. Found across rounds 65–68 on the Findlay listing (GOV-AVAIL1 / Q45 / INTAKE-RESTAGE1). Re-measure first.

## Measured (2026-09-23)

- **Deal type is blank.** 35 open `bd_opportunities` synced from Salesforce have `type IS NULL`. These are our own listings, BOVs and escrows, at stages `listing_signed`, `bov`, `in_escrow`, `loi_executed`, `non_refundable`. The property panel only counts `type='prospect'` (`api/admin.js resolveOwnerOppState`), so these deals may be offered "Create the lead". CC's D4 re-measure found this and did not verify the panel.
- **Findlay: the deal has no address or property link.**
  - SF opportunity `006Vs00000hhYfCIAU` "US Renal-Anchored MOB - Findlay - OH" is `listing_signed`, with `property_address` null.
  - Its LCC asset entity `084897cc…` was orphan-flagged with city only.
  - **Cowork linked it on 2026-09-23 from Scott's statement:** `entities.address='1717 Medical Blvd'` and `external_identities (dia, asset, 51194)`. Dia 51194 is the 13,975 SF building. Dia 28037 is suite C, the US Renal lease: a separate record, not a twin.
- **The OM can't follow the deal.**
  - The OM for the same listing (`sf_files` 1747, seed `sf_entity_type='Listing__c'`, `sf_entity_id='a0jVs00000GuTfdIAF'`) extracted no address on its latest pass. It sits `review_required` / `unmatched` (intake `3605ee76…`).
  - The seed knows which Salesforce listing the file belongs to, but matching uses only the extracted address.
  - No dia `available_listings` row exists for our own active listing.

## Ask

1. **Stamp the type on Salesforce-synced opportunities.** Find the writer (Salesforce opportunity sync / `intake-salesforce` edge function or the LCC sync). Map stage/record type → `type` (`listing`, `bov`, `buy_side`, and so on). Backfill the 35, logged. Confirm the property panel stops offering "Create the lead" on these deals.
2. **Carry the address.** If the Salesforce payload has a property address (Opportunity or its Listing__c), write it. If Salesforce doesn't have it, say so. Don't invent one.
3. **Seeded OM matching.** When an OM carries a Salesforce seed (`Listing__c` / `Opportunity`), resolve the seed to its LCC asset entity and domain property through `external_identities`. Use that as the match when the extracted address is missing, or when the address and the seed agree. When they disagree, go to review; never silently pick one. It must never cross verticals (GOV-AVAIL1's guard).
4. **Findlay, end to end.** After 1–3, re-run `sf_files` 1747 through the supported `?action=requeue` (live since v31). Confirm it matches dia 51194 and creates or updates the dia `available_listings` row for our listing with only the facts the OM or Salesforce provides (`is_northmarq=true`). Nothing is fabricated.
5. **Tests** for the type mapping, seed-match precedence (seed + no address → match; seed + conflicting address → review; seed pointing to the other vertical → refuse) and the backfill's idempotency. Each needs a mutation that turns it red.

## Do not touch

- The inbox dedup (INTAKE-RESTAGE1, just fixed).
- The GOV-AVAIL1 guards, except to call them.

## Done means

- Backlog rows updated.
- Deploy = redeploy BOTH Railway services, plus any edge function (say which), then `npm run verify:deploy`.
- Cowork verifies Findlay live.
