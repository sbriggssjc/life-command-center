# Contact → Entity resolution — the gap is entity *creation*, not matching (A2)

_2026-07-28. Break-out design note. Opened while trying to do the "contact-entity resolution backfill" as a
mechanical win; the data says it's a policy decision, so it's specced here instead of silently bulk-applied._

## The finding (with data)
`unified_contacts` = **31,014** rows; only **5,696** carry an `entity_id` (linked to a person `entities` row).
Of the 25,318 unresolved:
- **~13,505 have no signal at all** (no name, no email) — unrecoverable junk; leave them.
- **~11,700 are recoverable** (have a name and/or email).

The instinct was "link them to existing entities by email." Measured: **only 41** unresolved contacts match an
existing `person` entity by exact email (40 unambiguous). Reason — `entities.email` is sparsely populated and
most of these people simply **don't have an entity yet**. Existing links came almost entirely from `sf_import`
(4,783) + `linked_gov_owner` (723), not from ongoing matching.

**So the resolution gap is not a matching gap — it's an entity-creation gap.** Closing it means *creating*
~11,700 person entities, which is a data-quality decision, not a mechanical backfill.

## Why this is coupled to the roster question (A6)
The point of resolving contacts is to feed the **deal-party roster** and the **email matcher**. But:
- SF `OpportunityContactRole` is empty for Team Briggs (the A6 dead end), so there's no SF signal that says
  "this contact is a party on this deal."
- The **email matcher already self-builds** the roster from correspondence, and those Outlook contacts already
  resolve to person entities.

So bulk-creating 11,700 firm-wide contact entities would add a lot of rows without, on its own, improving the
*Team Briggs* roster — it only helps once we know which contacts are deal parties (A6) and scope creation to them.
This is the "exclude non-TB unless relevant" principle applied: don't mint 11k entities the deal system won't use.

## Options (decision needed)
1. **Scoped creation (recommended).** Create person entities only for contacts that are (a) parties on TB deals
   once A6's party source is settled, or (b) already appear in TB correspondence/activity. Smallest, cleanest,
   directly serves the roster/matcher. Requires A6 first.
2. **Broad creation with provenance.** Mint entities for all ~11,700 signal-bearing contacts, tagged
   `provenance: contact_backfill`, with a dedup guard on (email, normalized name). Maximizes recall for future
   matching but adds noise and a dedup burden now.
3. **Defer.** Leave resolution to happen lazily — the matcher creates/links entities as correspondence arrives.
   Zero work, slowest coverage growth.

## Recommendation
**Settle A6 (deal-party source) first, then do Option 1 (scoped creation).** Until then, the matcher's
self-building roster is the right mechanism and no bulk entity creation should run. Junk (no-signal) contacts
are out of scope permanently.

## Status
- A2 reclassified in the build-out catalog from "mechanical backfill (P1)" to "design-gated on A6 + creation
  policy." No entities were created. Finding logged; awaiting the A6 verification + policy call.
