# ADR-004: Canonical Person Identity

**Status:** Proposed for approval; migration not started
**Date:** 2026-08-11
**Decision:** `entities.id` is the canonical LCC person ID. `unified_contacts.unified_id` remains the identifier of
the contact/engagement projection and links to the canonical person through `unified_contacts.entity_id`.

## Context

LCC currently has overlapping person surfaces:

- `entities` models people, organizations and assets in one identity/relationship graph;
- `external_identities` attaches namespaced source-system IDs to `entities.id`;
- `unified_contacts` combines contact fields, Salesforce/Microsoft/domain IDs, engagement metrics, matching,
  provenance and merge history.

The lane-expansion design requires one durable person key across healthcare operators, owners, brokers,
providers, Salesforce, Microsoft and specialty databases.

## Production evidence

Read-only counts on 2026-08-11:

| Measure | Count |
|---|---:|
| Person rows in `entities` | 13,593 |
| Rows in `unified_contacts` | 31,034 |
| Unified contacts with `entity_id` | 5,696 |
| Distinct linked entity IDs | 5,642 |
| Entity IDs linked to multiple unified-contact rows | 51 |
| External identities attached to person entities | 15,232 |

The schema already contains `unified_contacts.entity_id`, indicating an intended bridge. The current coverage is
not sufficient to enforce a universal foreign-key/not-null transition immediately.

## Decision rationale

1. `entities.id` supports people, organizations and assets in the same cross-domain identity graph.
2. `external_identities` already provides the scalable namespaced-ID pattern for Salesforce, Microsoft,
   Government, Dialysis and future healthcare sources.
3. Relationships should point to one stable identity node, not an engagement-oriented contact row.
4. `unified_contacts` contains valuable derived and operational fields—touch counts, stale flags, sync times,
   match confidence and field sources—that belong in a projection rather than the canonical identity key.
5. Treating `unified_contacts` as canonical would preserve source-specific ID columns and make future lane/source
   additions continue widening the table.

## Consequences

- New cross-domain relationships and external identities use `entities.id`.
- New healthcare sources attach provider/contact IDs through `external_identities`, not new columns on
  `unified_contacts`.
- Existing applications may continue using `unified_contacts.unified_id` during compatibility migration.
- No production identifiers are rewritten or deleted as part of this ADR.
- Duplicate and unmatched contact rows require governed resolution before stronger constraints are applied.

## Migration plan

1. Inventory every table/view/function/API route that reads or writes `unified_id` or `entity_id`.
2. Define deterministic person-match tiers using verified Salesforce ID, namespaced external ID, normalized
   email/phone and human-reviewed exceptions.
3. Create a review worklist for the 25,338 currently unlinked unified-contact rows.
4. Resolve the 51 entity IDs linked to multiple unified-contact rows; classify legitimate multiple projections
   versus duplicates.
5. Backfill `unified_contacts.entity_id` in idempotent batches with match method, confidence and evidence.
6. Add compatibility views/functions so existing consumers can translate between IDs.
7. Update producers first, then consumers, following the repository's producer/consumer deployment doctrine.
8. Add monitoring for new unlinked or multiply linked rows.
9. Consider `NOT NULL`, uniqueness or filtered-uniqueness constraints only after measured coverage and exception
   rules justify them.

## Acceptance gates

- 100% of new person/contact ingests create or resolve an `entities.id`.
- Existing linked rows survive replay without creating a new entity.
- Duplicate delivery, merge, split/correction and tombstone tests pass.
- Salesforce, Microsoft and specialty IDs are represented in `external_identities` with uniqueness rules.
- No production consumer loses access to its current `unified_id` during transition.
- Human review exists for ambiguous matches; no name-only automatic merges.

## Rejected alternatives

- **Make `unified_contacts.unified_id` canonical:** rejected because it is contact/engagement-specific and retains
  widening source-ID columns.
- **Create a third person table:** rejected because it adds another identity surface without resolving either
  existing one.
- **Immediate destructive merge:** rejected because linkage coverage is incomplete and duplicate-link cases
  remain unresolved.
