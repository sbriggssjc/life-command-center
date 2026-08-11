# Healthcare ASC and Fixed-Site IDTF Private Run Authorization v0.1

**Status:** Design and synthetic contract complete; official runs remain unauthorized  
**Scope:** ASC and fixed-site IDTF source acquisition, private profiling, and 50-property review  
**Execution boundary:** No official artifact download, sample draw, database write, or CRM promotion

## 1. Decision

An official lane run may begin only from a validated, lane-specific authorization packet. A packet is not an
informal checklist: its identity is deterministically derived from the exact artifact releases and checksums,
private storage controls, reviewer evidence dictionary, independent-review rules, retention schedule, and stop
conditions. A document marked `draft_unapproved` can be reviewed but cannot authorize execution.

ASC and fixed-site IDTF require separate packets and separate source-manifest release IDs. Approval of one lane
does not authorize the other.

## 2. Frozen artifact ledger

Each packet must contain the exact four-source bundle already defined by the lane manifest contract. Every row
must freeze the source key, direct official CMS artifact URL, publication/release date, byte size, whole-file
SHA-256, and header SHA-256. Landing pages, “latest” aliases, estimated dates, placeholder hashes, and
unverified mirrors are not sufficient.

The real packet is created in two controlled steps:

1. A run operator records the official artifact identity and downloads into the approved private staging path.
2. A different reviewer independently recomputes byte size and both hashes before the packet can move from
   `draft_unapproved` to `authorized`.

Any CMS replacement under the same URL invalidates the packet and requires a new packet ID.

## 3. Private storage and access

The approved design target is a non-public bucket with objects under
`healthcare-discovery/<lane>/<release>/`. Public access must be disabled. Signed URLs may live no longer than
15 minutes. Access is limited to four functional roles: run operator, primary reviewer, second reviewer, and
privacy reviewer. Service credentials never appear in manifests, receipts, logs, or the repository.

If implemented in Supabase Storage, use a private bucket, RLS-backed object policies scoped to the approved
release prefix, and server-side credentials only. This document does not create a bucket, policy, role, or
database schema.

## 4. Reviewer evidence dictionary

Every selected property requires these fields:

| Field | Evidence rule |
|---|---|
| `clinical_identity` | Confirm lane identity from frozen clinical sources; conflicting identity is not resolved by guess. |
| `property_form` | One reviewed class: STNL, dominant user, minority MOB, campus, operator owned, or unknown. |
| `ownership` | Record evidence class and citation; operator identity is not presumed to be landlord identity. |
| `landlord_addressability` | Boolean or unresolved, supported by a traceable owner/operator path. |
| `economics` | Bounded or unresolved with stated source period, component, and assumptions. |
| `research_minutes` | Minutes by clinical, property, ownership, economics, and contact work. |
| `evidence_citations` | Private citations sufficient for a second reviewer to reproduce the result. |
| `reviewer_confidence` | High, medium, or low; low always triggers second review. |

Missing evidence stays unresolved. No reviewer may infer real-estate form from CMS enrollment alone.

## 5. Independent second review

Second review is mandatory for clinical-identity conflicts, unknown property form, ownership conflicts,
economics assumptions, low reviewer confidence, and any observed hard-gate result within 0.05 of its threshold.
The second reviewer cannot be the primary reviewer. Disagreement remains visible and unresolved until a
documented adjudication; it is never silently overwritten.

## 6. Retention and privacy

| Artifact | Maximum/minimum retention | Disposition |
|---|---:|---|
| Raw official source and private working extracts | 90 days maximum after run close | Cryptographic delete plus tombstone |
| Row-level sample and evidence scorecards | 180 days maximum after final decision | Cryptographic delete plus tombstone |
| Aggregate receipt and authorization tombstone | 7 years minimum | Retain without record-level identifiers |

Only aggregate receipts may leave the private review boundary. The privacy scan must prove that candidate
fingerprints, NPIs, certification numbers, names, street addresses, emails, phone numbers, source object paths,
and signed URLs are absent. A failed or unavailable scan stops publication.

## 7. Lane stop conditions

Both lanes stop when artifact identity/checksum fails, any five hard gates fails, exact 50-property coverage
cannot be completed, privacy controls fail, or research burden exceeds the reviewed limit.

ASC additionally stops or narrows when facility certification cannot be reconciled, hospital-campus/MOB form
dominates the sample, professional and facility economics cannot be separated, or third-party landlord paths
remain below threshold.

Fixed-site IDTF additionally stops when fixed-site status cannot be affirmatively proven, mobile/portable or
embedded sites contaminate the sample, technical/professional components cannot be reconciled, or equipment
economics cannot be bounded at the facility level.

Passing source validation never overrides a failed brokerage gate.

## 8. Implemented synthetic gate

`scripts/healthcare-discovery/run-authorization.mjs` validates the authorization envelope and emits a
deterministic aggregate-only receipt. The synthetic packet proves checksum-bound identity, private-access
requirements, complete second-review triggers, bounded retention, privacy receipt enforcement, and the
distinction between `draft_unapproved` and `authorized`.

This checkpoint intentionally contains no real release dates, real artifact hashes, credentials, downloads,
row-level review data, or execution command. The next decision is whether to authorize preparation of the two
real, still-unapproved release packets. Preparation is not authorization to draw either sample.
