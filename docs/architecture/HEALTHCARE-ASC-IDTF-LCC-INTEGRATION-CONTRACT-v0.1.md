# Healthcare ASC and IDTF LCC Integration Contract v0.1

**Status:** Design-only promotion map; no schema or production write authorized

**Date:** 2026-08-11

## 1. Architecture decision

ASC and fixed-site IDTF discovery remain specialty adapters inside private `healthcare_discovery`; they do not
become new CRM, property, owner, comp, or dossier systems. Promotion reuses the LCC spine and occurs only after
clinical, property, ownership, and economics gates pass.

The canonical vertical remains `hc` only if a later ADR and the `external_identities` constraint approve that
source system. Until then, healthcare discovery IDs stay private and must not be written into the public
identity graph under an invented source spelling.

## 2. Concept mapping

| Healthcare evidence | Private discovery representation | Existing LCC destination after approval |
|---|---|---|
| Candidate address/location | Effective-dated facility-location observation | Existing asset entity and `lcc_property_attributes`; never auto-create on fuzzy address |
| ASC certification / IDTF enrollment | Source identity with release lineage | `external_identities` only under an approved canonical source/type vocabulary |
| Operator, DBA, parent, health system, physician JV | Role-specific organization observations | `entities` plus effective-dated `entity_relationships`; roles stay distinct |
| Fee owner / landlord / sponsor | Ownership evidence and resolution verdict | `lcc_property_owner_facts` and Ownership Resolution Engine |
| Tenant share / building form | Property-resolution evidence with denominator | Healthcare classification fact projection plus broker-facing property attributes |
| License, accreditation, modality, rooms/equipment | Specialty facts | Additive healthcare facts; minimal approved projection to dossiers/CRM |
| Lease, sale, listing, rent and comp | Evidence link to canonical asset | Existing domain lease/sale/listing/comp surfaces; no parallel comp ledger |
| Revenue, EBITDA, rent burden and coverage | Versioned estimate with components and conflicts | Private economics first; curated projection only with provenance and confidence |
| Pursuit thesis | Qualified candidate plus value score | `bd_opportunities` only after value gate and named owner/client path |
| Uncertainty/conflict | Explicit review reason and evidence bundle | Decision/review lane with reversible verdict and auto-retire condition |

## 3. Promotion state machine

1. `discovered` — official source seed only.
2. `clinically_verified` — current address-matched service evidence.
3. `property_resolved` — unique canonical asset or explicit no-match/ambiguous verdict.
4. `brokerage_qualified` — STNL or 50%+ dominant user with credible owner/operator advisory path.
5. `economics_bounded` — low/base/high model reconciled or intentionally unavailable.
6. `promotion_reviewed` — human approval with source release and rule versions frozen.
7. `lcc_promoted` — fill-blanks-only, provenance-tagged, idempotent writes completed.
8. `crm_eligible` — separate Salesforce minimum-necessary payload approved.

No state transition emits an operator task merely because the previous state completed. The consumer is a
broker-reviewed lane queue capped and ranked by estimated fee opportunity, ownership addressability,
transaction timing, evidence confidence, and research cost. Closure, relocation, owner resolution, duplicate
resolution, loss of qualifying tenant share, or stale evidence automatically retires the candidate from the
actionable queue without deleting its history.

## 4. Data-write and security boundaries

- Private healthcare tables remain outside exposed Supabase schemas; revoke `PUBLIC`, `anon`, and
  `authenticated`, with RLS as defense in depth.
- Discovery adapters propose facts; the promotion service owns curated writes.
- Every promoted field uses `lcc_merge_field()` or the applicable canonical writer and has a registered
  `field_source_priority` entry.
- Property and organization matches require exact authoritative identity or reviewed deterministic evidence;
  ambiguous matches never promote.
- Salesforce receives only broker-usable facility label, qualification, property/company linkage, pursuit
  status, and approved economics summary. Raw source payloads and research notes remain in LCC.
- Power Automate transports approved payloads only; it does not classify facilities, resolve ownership, or
  calculate economics.

## 5. Existing consumer fit

| LCC consumer | Healthcare behavior |
|---|---|
| Property detail | Show care setting, service archetype, building form, tenant share/denominator, owner/operator roles, and evidence freshness |
| Dossier | Render verified operations, economics ranges, conflicts, rent burden, ownership, lease and comp context; unknown stays “Not on file” |
| Comps | Filter by archetype, operator/credit, procedure/modality intensity, lease structure, term, size, rent and economics confidence |
| Priority queue | Include only brokerage-qualified, addressable, value-ranked opportunities; cap lane volume |
| Decision Center | Resolve identity, site form, owner/landlord, economics conflicts, and promotion approvals |
| Salesforce | Minimal projection after `crm_eligible`; never a discovery dump |

## 6. Implementation prerequisites

Before code or DDL:

1. approve canonical healthcare identity source/type vocabulary and update the database constraint in a
   migration designed against a disposable database;
2. define the additive healthcare classification/economics fact contract without inserting columns into the
   middle of existing views;
3. name each producer's consumer, value gate, auto-retire predicate, ranking, and cap;
4. define field-source priority rows for every curated projection;
5. prove dry-run, replay, rollback, and no-duplicate behavior using synthetic assets and organizations; and
6. verify any future API route is mounted in `server.js` and returns JSON through Railway.

## 7. Shared property-identity dependency

The restricted ASC sample is producing reusable evidence about suites and floors, parent-building matches,
shared campuses, formatting equivalences, historical frozen tokens, and stale research-control state. Those
lessons are governed by the lane-neutral
[`Property Identity and Address Resolution Contract v0.1`](property-identity-and-address-resolution.md).

ASC-specific match rules remain a proving ground, not a second canonical resolver. A research capture may use
only the narrow, fixture-backed rules authorized for the frozen run, must preserve source disagreement, and
must require second review where the shared contract says so. No ASC result may directly promote a property,
create a cross-lane alias, or change Salesforce. Extraction into a shared matcher requires the contract's
golden-corpus and read-only shadow gates plus a separate activation decision.
