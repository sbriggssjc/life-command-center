# ADR-005: Oncology / Infusion Service Corroboration

**Status:** Accepted for pilot design
**Date:** 2026-08-11

## Context

NPPES supplies national organization identifiers, taxonomies and practice locations, but CMS states that NPI
issuance does not validate licensure or credentials and that NPPES taxonomy selections are not verified against
trusted sources. The pilot needs current evidence that a specific service is offered at a specific address.

## Decision

Use the current official operator, physician-group or health-system location page as the primary service and
operating-status corroborator. Evidence qualifies only when the page identifies the same resolvable location
and explicitly supports medical oncology, chemotherapy/infusion or radiation oncology.

Apply supplemental sources in this order:

1. state radiation-control or facility-license registry for radiation oncology, when publicly addressable;
2. an authoritative accreditation or government facility directory with a matching address;
3. recent CMS utilization/claims-derived data as historical activity evidence;
4. reputable third-party directories only as discovery or conflict evidence, never as the sole promotion gate.

Search-result snippets, physician-only profiles, map-category labels and inferred services do not qualify.

## Evidence contract

Each corroboration observation stores source organization, canonical URL, retrieved time, page title, observed
facility name/address, supported modality, status signal, parser version, content fingerprint and a short
non-copyrighted evidence note. Store only the minimum excerpt needed for internal review; retain the URL and
fingerprint for reproducibility.

Evidence currency defaults:

- official facility/operator page: current if successfully retrieved within 90 days of cohort freeze;
- state license/registry: current through its stated expiration or reporting period;
- claims/utilization: dated historical evidence, never current operating-status proof;
- unavailable or contradictory page: route to review, not automatic exclusion.

## Consequences

- Corroboration requires a bounded web adapter or manual review step after NPPES seeding.
- Operator sites vary structurally, so the pilot starts with evidence capture and human validation rather than
  claiming universal extraction.
- Official pages can be stale. Conflicting closure, relocation or address evidence is preserved and reviewed.
- Claims data may later improve modality confidence but does not replace a current location source.

## Rejected alternatives

- **NPPES alone:** self-reported taxonomy is insufficient proof of services.
- **Individual clinician density:** inflates physician offices and does not prove a broker-relevant facility.
- **Claims alone:** valuable but lagged, incomplete across payers and difficult to map cleanly to current real
  estate locations.
- **Commercial maps/directories alone:** useful discovery aids but insufficiently authoritative for promotion.

## Pilot gate

The first 50-record golden sample must achieve at least 90% correct modality classification, and every promoted
record must have a current qualifying URL or approved registry observation at the resolved address.

## References

- CMS NPPES downloadable files: `https://download.cms.gov/nppes/NPI_Files.html`
- CMS taxonomy crosswalk methodology: `https://data.cms.gov/resources/medicare-provider-and-supplier-taxonomy-crosswalk-methodology`
- CMS data dissemination guidance: `https://www.cms.gov/medicare/regulations-guidance/administrative-simplification/data-dissemination`
