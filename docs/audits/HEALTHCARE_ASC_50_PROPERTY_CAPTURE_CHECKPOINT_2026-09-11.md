# Healthcare ASC 50-Property Capture Checkpoint — 2026-09-11

## Decision boundary

The frozen ASC sample's governed **source-collection pass is complete**. This checkpoint does not claim that
the row-level reviewer scorecards, second reviews, aggregate commercial gates, or lane-advance decision are
complete. It authorizes no canonical-property write, Salesforce write, outreach, production opportunity, or
IDTF activation.

The public repository records aggregate measurements only. Candidate identities, licensed-source payloads,
run identifiers, and candidate-scoped evidence remain outside Git.

## Production measurement

Measured read-only against `healthcare_research_runs`, `healthcare_research_candidates`,
`healthcare_research_captures`, and `healthcare_research_reviews` in LCC Opps on 2026-09-11.

| Measure | Result |
|---|---:|
| Frozen candidates | 50 |
| Candidates resolved for collection | 50 (100%) |
| Licensed-source captured | 44 (88%) |
| Reviewed source exceptions | 6 (12%) |
| Pending candidates | 0 |
| Capture rows | 54 |
| Distinct captured candidates | 44 |
| CoStar-covered candidates | 44 (88%) |
| RCA-covered candidates | 1 (2%) |
| Candidates with both licensed sources | 1 (2%) |
| `licensed_sources_not_found` exceptions | 4 (8%) |
| `parcel_owner_evidence_only` exceptions | 1 (2%) |
| `parcel_situs_evidence_only` exceptions | 1 (2%) |

The 54 capture rows contain 54 distinct payload hashes. Seven candidates have multiple capture rows, which
reflects the governed retry/re-capture history; aggregate analysis must select the latest capture per candidate
and must not treat capture rows as independent properties.

## Identity-resolution distribution

The latest capture for each of the 44 captured candidates produced 15 governed identity modes plus one
historical missing-mode category:

| Mode | Candidates | Second review required |
|---|---:|---:|
| `exact_address_token` | 22 | 0 |
| `approved_same_parcel_address_conflict` | 5 | 5 |
| `approved_operating_identity_parent_building` | 2 | 2 |
| `tenant_corroborated_parent_building` | 2 | 0 |
| Historical captures without a stored mode | 2 | 0 |
| Eleven other governed modes | 11 | 9 |
| **Captured total** | **44** | **16** |

The eleven singleton modes are the approved operating-identity range, controlled multi-signal range,
enrollment-organization parent building, evidence-backed parent-address alias, compound-street split,
normalized frozen identity, organization-family parent building, directional/street-type extension,
municipality alias, range endpoint, and USPS cove-suffix equivalence.

All six reviewed source exceptions also require second review. Therefore **22 of 50 candidates (44%) require
second review**, and **0 of 22** currently have a second reviewer recorded. This is the first next-step gate.

The two historical captured records without a stored identity mode are an instrumentation gap, not evidence of
a failed match. They must be classified from preserved evidence during aggregate review or reported as
`historical_mode_missing`; they must not be silently assigned a mode.

## Property-data coverage at collection close

Coverage below uses one latest capture per captured candidate (`n = 44`) and reports nonblank structured
fields. It measures source availability, not correctness or commercial qualification.

| Field | Nonblank | Coverage |
|---|---:|---:|
| Lot size | 44 | 100.0% |
| Land SF | 43 | 97.7% |
| Contacts | 43 | 97.7% |
| Tenant name / tenant roster | 42 / 42 | 95.5% / 95.5% |
| Parcel number | 41 | 93.2% |
| Building class / building SF | 40 / 40 | 90.9% / 90.9% |
| Tenancy type / owner occupied | 38 / 38 | 86.4% / 86.4% |
| Sales history | 36 | 81.8% |
| Zoning | 35 | 79.5% |
| Year built | 34 | 77.3% |
| Ownership type | 30 | 68.2% |
| Sale price / sale date | 27 / 33 | 61.4% / 75.0% |
| Occupancy | 12 | 27.3% |
| Cap rate | 10 | 22.7% |
| NOI | 2 | 4.5% |

These fields do not satisfy the scorecard by themselves. In particular, no conclusion can yet be drawn for
the 80% property-classification gate, 50% STNL/dominant-user gate, 60% addressability gate, 50% bounded-
economics gate, Wilson intervals, research time, or weighted lane score.

## Next governed step

1. Complete independent second review for the 22 flagged candidates, preserving disagreements.
2. Populate exactly one governed row-level scorecard for every one of the 50 candidate fingerprints. For the
   44 captured candidates, evaluate the latest capture while retaining retry history; retain the six exception
   dispositions as missingness evidence.
3. Run the existing aggregate-review contract and emit only its privacy-safe aggregate receipt.
4. Apply the predeclared clinical, property, qualifying-share, addressability, economics, and research-burden
   gates. Then make one explicit decision: `advance_primary_lane`, `advance_narrow_archetype`, `advisory_only`,
   `enrichment_only`, or `stop`.
5. Only after that decision may Phase B of the shared property-identity resolver begin. Any activation or
   production promotion remains separately authorized.
