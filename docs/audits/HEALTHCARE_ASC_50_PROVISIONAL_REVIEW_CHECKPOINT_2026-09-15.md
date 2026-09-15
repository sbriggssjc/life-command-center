# Healthcare ASC 50-Property Provisional Review Checkpoint — 2026-09-15

## Status and boundary

This is an **identifier-free analytical checkpoint**, not the official
`healthcare_property_review:1.0` aggregate gate receipt and not an accepted lane decision. It records a
read-only, evidence-cited provisional pass over the frozen 50-candidate ASC sample so future work can resume
without repeating the analysis. Candidate identities, licensed-source payloads, citations, and proposed
row-level judgments remain in the private review ledger outside Git.

No review judgment was created by the analytical pass. One primary scorecard was submitted directly by the
authenticated human reviewer through `/asc-review.html`; the remaining proposed scorecards were not written.
No canonical-property, Salesforce, outreach, production-opportunity, IDTF, or lane-advance write occurred.

## Read-only database measurement

Measured in LCC Opps on 2026-09-15 after reviewer work began:

| Measure | Result |
|---|---:|
| Frozen candidates | 50 |
| Completed primary scorecards | 1 |
| Completed independent second reviews | 0 |
| Submitted primary routed to `second_review` | 1 |

The submitted row preserves `unknown` property form, unresolved ownership/addressability/economics, low
confidence, and cited source evidence. Its independent second review remains open. The different-person
reviewer rule applies; disagreement must remain open.

## Provisional aggregate analysis

The following values derive from an evidence-only provisional classification of all 50 candidates. They
include the submitted row but do **not** imply that the other 49 scorecards are complete.

| Measure | Provisional result | Gate | Outcome |
|---|---:|---:|---|
| Clinical identity verified | 37/50 (74.0%) | 90% | Fail |
| Property form classifiable | 26/50 (52.0%) | 80% | Fail |
| STNL or dominant-user share among classifiable | 6/26 (23.1%) | 50% | Fail |
| Addressable path among provisional qualifying rows | 2/6 (33.3%) | 60% | Fail |
| Bounded economics among provisional qualifying rows | 3/6 (50.0%) | 50% | Pass at threshold |

| Property form | Count |
|---|---:|
| `unknown` | 24 |
| `minority_mob` | 16 |
| `operator_owned` | 4 |
| `dominant_user` | 4 |
| `stnl` | 2 |

Approximately 35 proposed rows would require independent second review because of a collection trigger, low
confidence, unknown form, or conflicting evidence. This is a planning estimate, not the current persisted
second-review count; the workbench remains the source of truth after each authorized primary submission.

## Provisional recommendation

The evidence does not presently support broad ASC lane activation. The provisional allowed recommendation is
`enrichment_only`: the sample can improve property-form and operator context, but it does not establish a
sufficiently precise, classifiable, qualifying, and addressable ASC prospect universe.

This recommendation remains provisional. The documented official recommendation may be made only after all 50
primary scorecards and every required independent second review are complete and the identifier-free aggregate
receipt is generated and accepted.

## Next governed decision

Before committing the human-review burden for the remaining sample:

1. inspect the six provisionally qualifying rows (`stnl` or `dominant_user`) for identity, ownership,
   addressability, and economics support;
2. inspect the 24 `unknown` rows to separate true evidence missingness from a correctable capture or rubric gap;
3. decide explicitly whether to complete the formal 50-row gate for comparability, or retain ASC as
   `enrichment_only` without activating the lane.

Candidate-scoped authorization or direct human submission remains required for every database judgment. This
checkpoint does not authorize batch submission, IDTF activation, a lane-neutral matcher, or downstream writes.
