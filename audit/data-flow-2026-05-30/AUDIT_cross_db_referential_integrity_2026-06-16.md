# Audit — cross-DB referential integrity sweep (live 2026-06-16)

**Question:** now that the mirrors (R22/R23), owner-facts (R8), effective_domain (R31), and
the entity graph are all wired, are there dangling references — within LCC and across the
three DBs (LCC Opps ↔ dia ↔ gov)?

## Headline: the graph + mirrors are SOUND. One uncovered table: `external_identities`.
- **LCC-internal entity references: 0 orphans** across all 9 classes checked — cadence
  `entity_id`/`contact_id`, `bd_opportunities.entity_id`, `entity_relationships`
  from/to, `external_identities.entity_id`, `lcc_entity_portfolio_facts.entity_id`,
  `lcc_buyer_parents.parent_entity_id`, and dangling `entities.merged_into_entity_id`.
  (FKs enforce most; all verified 0.)
- **Mirror property-references: clean.** `lcc_entity_portfolio_facts.source_property_id`
  → 0 not in the reconciled mirror, both domains. R22/R23's daily reconcile is holding.
- **The one gap: `external_identities` asset links** (`source_type='asset'`) were NOT
  covered by the R22/R23 reconcile (which only touched the 3 mirror tables). ~638 asset
  rows don't resolve to a current domain property — but they split into THREE distinct
  classes, only some of which are true orphans:

## The 638 external_identities asset rows, classified
| class | count (approx) | what it is | right action |
|---|---|---|---|
| **dia CCN-mislabels** | ~345 (6-digit, e.g. `012505`) | CMS Medicare **CCNs** stored as `(source_type='asset', source_system='dia')` — verified 5/5 exist in `dia.medicare_clinics.medicare_id`. Valid clinic identities, **wrong type** (canonicalization bug, R4-A class). Don't resolve as properties. | **retype** to a clinic/CMS identity type — don't delete |
| **dia true property orphans** | part of ~276 "other" (5-digit, e.g. `37587`,`39911`) | dia property_ids that **no longer exist** in `dia.properties` (dia hard-deletes on merge; asset links never cleaned). | **prune** (snapshot, reversible) |
| **malformed UUID asset ids** | a handful (e.g. `64a95f15-…`) | a UUID stored as a property asset `external_id` — invalid for a property. | prune / flag |
| **gov "not in mirror" — mostly NOT orphans** | 17 flagged → ~14 active | sampled 9: **7 active**, 1 archived, 1 gone, 1 malformed UUID. The active ones are a **mirror-coverage quirk** (active gov property present in external_identities but absent from `lcc_property_attributes`), NOT orphans. | leave active; prune only the truly-gone + malformed |

## The critical safety lesson for the fix
**"Not in the active mirror" is NOT a reliable orphan signal** — the gov sample proved it
flags ACTIVE properties (the mirror has coverage gaps). Any reconcile of
`external_identities` MUST test against the **all-status `v_property_id_census`** (R22/R23
built it on both domains), not the mirror — otherwise it would wrongly delete identities
for live properties.

## Recommended fix → CLAUDECODE_PROMPT_R35_external_identities_reconcile.md
Extend the R22/R23 reconcile pattern to `external_identities` asset rows, census-based:
1. **Retype** the ~345 dia CCN-format asset rows to a proper clinic/CMS identity
   (reuse R4-A `canonicalDomainSourceType`/`canonicalIdentitySystem`); they're valid, just
   mislabeled. Add a forward guard so a CCN is never written as `asset`.
2. **Prune** (snapshot to a reversible backup, like R22) the asset rows whose `external_id`
   is a domain-property-shaped id ABSENT from the all-status census (true dia merge-orphans
   + the truly-gone gov ones) + the malformed-UUID asset ids.
3. **Leave** the gov active-but-not-in-mirror rows alone (they're valid); optionally note
   the gov mirror-coverage gap as a separate small follow-up.
4. **Forward**: add `external_identities` to the daily reconcile so future domain merges
   clean their asset links automatically.

## Bottom line
Cross-DB referential integrity is fundamentally healthy — entity refs clean, mirrors
reconciled. The only debt is in `external_identities` asset links: ~345 dia CCN
mislabels (retype) + a few hundred true dia merge-orphans/malformed (prune), and a small
gov mirror-coverage quirk (leave). Census-based, reversible, and a forward reconcile so it
doesn't re-accumulate. No mass corruption; a tidy-up of the one table R22/R23 didn't reach.
