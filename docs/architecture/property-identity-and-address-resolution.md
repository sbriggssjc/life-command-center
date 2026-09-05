# Property Identity and Address Resolution Contract v0.1

**Status:** Design contract and staged backlog; no shared service, schema, promotion, or production write is authorized

**Date:** 2026-08-28

## 1. Decision

Property identity is a shared platform concern, not a collection of lane-specific string fixes. The restricted
ASC sample is the proving ground for a deterministic, versioned, fail-closed resolver that can later support
ASC, IDTF, dialysis, government, and other exploration lanes. Until the staged gates in this document pass,
the existing restricted ASC workflow remains authoritative and every new equivalence remains narrow,
fixture-backed, and independently reviewable.

This document contains aggregate patterns and generic examples only. Private candidate rows, licensed-source
payloads, run identifiers, and working files remain outside Git.

## 2. Observed mismatch classes

The frozen ASC research run has exposed reusable classes rather than isolated bad addresses:

- a facility suite or floor represented by a source only at parent-building level;
- several buildings or uses sharing one campus address;
- street-suffix, directional, township/city, range, and punctuation variants;
- compound street names represented with or without an internal space;
- historical frozen tokens produced by an earlier normalizer version;
- a correct building supported by an explicit facility or tenant, but not by address alone;
- a CMS legal entity represented in the property source by a separately branded operating identity;
- a certified service-location address differing from a property source's mailing or situs label on the same parcel;
- a source legitimately having no matching record;
- stale sidebar candidate state after completion or navigation; and
- database functions whose output columns become ambiguous as their implementation evolves.

These classes must not be solved by stripping more tokens until strings happen to match. Each rule needs a
defined evidence burden, collision controls, negative fixtures, and a second-review policy.

For numeric building ranges, containment is a governed parent-building rule—not ordinary normalization. A
single frozen civic number may match a captured inclusive range only when the remaining normalized street,
city, state, and postal components agree exactly and an explicit facility or tenant observation corroborates
the ASC. Reversed ranges, out-of-range numbers, street or location disagreements, and absent corroboration
remain blocked. Both raw addresses are preserved and every accepted range-containment match requires second
review.

A range may also use a controlled multi-signal ASC identity rule when an otherwise valid location is blocked
only by a governed facility-name form. That rule requires all three signals together: inclusive range
containment with exact remaining location components; an explicit captured tenant whose distinctive
organization core exactly matches the CMS facility while only the terminal forms `AMBULATORY SURGERY CENTER`
and `SURGICAL CENTER` differ; and a captured contact explicitly labeled as an owner that exactly matches a
CMS enrollment organization after legal-suffix removal and the single controlled whole-token expansion
`ASSOC` to `ASSOCIATES`. Generic organization cores, non-owner contacts, absent enrollment corroboration, or
any location disagreement remain blocked. The decision preserves every raw name and address and always
requires second review.

## 3. Non-negotiable properties

1. **Preserve raw observations.** Store and display source text separately from derived tokens.
2. **Be deterministic and versioned.** The same rule version and inputs produce the same decision.
3. **Fail closed.** Ambiguity, missing corroboration, or incompatible components block attachment.
4. **Preserve provenance and disagreement.** A match does not erase a source conflict.
5. **Separate location from facility identity.** A shared address is necessary evidence, not always sufficient.
6. **Treat missingness as evidence.** A documented source search with no match is a valid disposition.
7. **Require human review where stated.** Automation cannot silently waive a review gate.
8. **Keep language models advisory.** No LLM may decide identity, create an alias, or write a match.
9. **Do not promote from exploration.** A research attachment is not a canonical-property or CRM promotion.

## 4. Match hierarchy

Evaluation stops at the first satisfied level. A lower-confidence level cannot override a conflict found at a
higher level.

| Level | Match mode | Minimum evidence | Result |
|---|---|---|---|
| 1 | Exact raw identity | Address components equal as captured | Attach; retain both raw observations |
| 2 | Exact normalized identity | Equal under the same approved normalizer version | Attach with rule version |
| 3 | Governed formatting equivalence | One allow-listed rule, exact city/state/postal components, no collision | Attach; record reason code |
| 4 | Parent-building corroborated | Exact base location plus explicit facility/tenant evidence | Attach; second review required |
| 5 | Evidence-backed alias | Approved alias ledger entry with citations, scope, and expiry/review metadata | Attach under ledger authority; second review as configured |
| 6 | Manual identity review | Structured evidence bundle resolves an otherwise ambiguous case | Human verdict, reason, and reviewer recorded |
| 7 | Blocked mismatch | Evidence is incomplete, contradictory, or colliding | No attachment; diagnose the failed component |

Facility corroboration is not approximate name similarity. It must be an explicit source observation or an
approved deterministic alias. When multiple source properties share the location, address-only acceptance is
prohibited.

An operating-identity alias must be candidate-scoped, bind the preserved CMS legal name to an allow-listed
operating name at one exact normalized building address, carry an authorizer and timestamp, and cite at least
two independent official HTTPS hosts. It may support a parent-building attachment only when the captured
tenant exactly equals an allow-listed operating name. It never becomes a global name rewrite, and every use
requires second review.

The same approved operating-identity alias may support a captured parent-building range only when the frozen
civic number falls inclusively inside that range and the remaining normalized street, city, state, and postal
components agree. A terminal street type present only in the licensed property source is recorded as a
formatting extension, not written back to the frozen address. When the alias carries a CoStar property ID or
parcel number, those pins are mandatory and exact; a different source, record, or parcel remains blocked.
Range containment never substitutes for the approved operating tenant, independent official-host citations,
or second review.

For a CoStar Tenant-tab attachment, the tenant observation used by the restricted ASC matcher is refreshed
from the exact content-script frame that produced the current tenant snapshot at click time. CoStar may
render the roster outside frame 0, so the background context records the provenance-validated tenant frame
and the sidebar also requires the active tab ID to match. The fresh roster replaces the cached roster only
when its URL, declared property key, tenant provenance key, and active-tab identity all resolve to the same
CoStar record.
An empty roster, unavailable scan, or any record/provenance disagreement fails closed. The scalar primary
tenant may remain a different occupant in a multi-tenant building; an approved operating identity can match
only an exact name in the freshly observed full roster.

A same-parcel address-conflict alias must also be candidate-scoped. It binds one frozen service-location
token to one captured property token and one exact parcel identifier, requires an exact captured facility or
enrollment-organization tenant, and cites both an official facility registry and the licensed property public
record. Parcel agreement without tenant corroboration is insufficient. The capture preserves both addresses,
the parcel identifier, and any square-footage disagreement, and always requires second review.

## 5. Shared component boundaries

| Component | Responsibility | Must not do |
|---|---|---|
| Observation parser | Preserve raw components and derive typed address/facility observations | Rewrite source evidence |
| Versioned normalizer | Apply deterministic, independently testable transformations | Consult lane state or external records |
| Rule registry/comparator | Evaluate ordered equivalences and emit component verdicts | Create new rules from a failed row |
| Corroboration evaluator | Test explicit tenant/facility/building evidence | Infer identity from general similarity |
| Decision object | Carry outcome, rule version, reasons, conflicts, and review requirement | Perform a write by itself |
| Governed alias ledger | Hold reviewed exceptions with source, scope, authorization, and lifecycle | Become an unreviewed fuzzy-match cache |
| Shadow evaluator | Replay candidate observations without affecting active decisions | Activate a rule or mutate canonical records |
| Sidebar diagnostics | Explain current candidate, captured page, failed component, and next action | Offer the general property-save action as a research substitute |
| Aggregate metrics | Measure performance and risk without exposing row data | Publish licensed or private evidence |

## 6. Decision contract

Every comparison should emit a structured decision even when blocked. A generic shape is:

```json
{
  "decision_version": "property-identity/v1",
  "normalizer_version": "address/vN",
  "outcome": "attach|review|required_missingness|blocked",
  "match_mode": "exact_raw|exact_normalized|governed_rule|parent_building|alias|manual|none",
  "component_verdicts": {
    "street": "equal|equivalent|different|unknown",
    "locality": "equal|equivalent|different|unknown",
    "region": "equal|different|unknown",
    "postal_code": "equal|compatible|different|unknown",
    "facility": "corroborated|conflicting|not_observed"
  },
  "reason_codes": [],
  "corroboration_refs": [],
  "second_review_required": false
}
```

Raw and derived observations may be stored in restricted systems, but must not be copied into aggregate Git
documentation or logs. A historical frozen token may be re-evaluated only after proving that it is a valid
derivation of the preserved raw candidate address; compatibility must never bless an arbitrary stored token.

## 7. Rule lifecycle and golden corpus

Every proposed equivalence follows the same lifecycle:

1. observe and classify the mismatch without changing the candidate;
2. add a de-identified or synthetic positive fixture and adversarial negative controls;
3. implement the narrow deterministic rule and reason code;
4. replay the golden corpus and the frozen sample in read-only shadow mode;
5. measure collisions, changed decisions, and new second-review load;
6. obtain the required approval before activation;
7. monitor aggregate outcomes by rule version; and
8. retire or supersede the rule without deleting prior decisions.

The golden corpus must include suites/floors, building designators, parent buildings, same-address campuses,
ranges, controlled multi-signal facility/owner identity, directionals, suffixes, municipality aliases,
compound streets, legal/operating-name pairs, postal extensions, historical tokens, and deliberately
confusable facilities. Every positive fixture needs at least one nearby negative control capable of exposing
over-normalization.

## 8. Sidebar diagnostics

The research control should display, without requiring database inspection:

- active frozen candidate number and facility label;
- frozen/raw candidate address and the captured source address;
- rule and normalizer versions;
- component-by-component verdicts and corroboration used;
- whether the failure is page mismatch, stale worklist state, missing corroboration, or server error;
- whether source-not-found is still outstanding;
- whether second review is required; and
- one safe next action: attach, refresh worklist, record missingness, or hold for review.

Completion must return the newly active candidate or an explicit “open next property” state. Navigating a
licensed-source page must never silently retarget the active frozen candidate.

## 9. Local-model role

An on-box model may summarize a structured discrepancy, suggest likely reason codes for a reviewer, or draft a
review note. It receives the minimum necessary restricted context and its output is always advisory. It may not
normalize an address, select a property, assert a tenant match, create an alias, approve a review, or write to
research/canonical tables. Deterministic components must remain usable when the model is unavailable.

## 10. Aggregate quality measures

Track by lane, source, and rule version:

- exact, governed-equivalence, parent-building, alias, manual, blocked, and not-found rates;
- changed-decision and collision rates during shadow evaluation;
- second-review volume and agreement rate;
- source missingness and disagreement rates;
- stale-worklist and technical-error rates;
- median and percentile research time per property; and
- any reviewed false positive or false negative.

No dashboard should expose private row identities or licensed evidence.

## 11. Staged build plan

| Phase | Build | Gate to leave phase |
|---|---|---|
| A | Inventory current ASC transformations and freeze this decision contract | Rule owners, versions, and reason codes reviewed |
| B | Extract a lane-neutral pure matcher and de-identified golden corpus | Positive and negative fixtures pass; existing ASC verdicts replay unchanged except approved corrections |
| C | Add structured sidebar diagnostics and explicit candidate refresh/advance state | Operator can identify mismatch class and active candidate without database access |
| D | Run read-only shadow evaluation across approved lanes | Collision and review-load report accepted; no writes |
| E | Design and migrate a governed alias ledger | Separate schema, security, authorization, replay, and rollback approval |
| F | Add aggregate quality reporting | Metrics verified not to disclose row-level or licensed data |
| G | Adopt per lane behind an explicit gate | Lane owner approves rules, thresholds, consumers, and retirement behavior |

## 12. Prohibited shortcuts and next decision

This contract does not authorize ingestion of a full candidate universe, canonical-property creation or
promotion, Salesforce writes, outreach, production opportunities, unattended licensed-source scraping,
evidence deletion, IDTF activation, or weakening fail-closed matching.

Finish and review the frozen 50-property ASC sample first. Its aggregate mismatch inventory, source coverage,
research time, false-block/false-accept evidence, and second-review burden will determine whether Phase B is
worth building and which rule classes enter the first shadow evaluation. That is the next gated architecture
decision; it is not pre-authorized by this document.
