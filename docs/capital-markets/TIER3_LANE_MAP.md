# Tier 3 — Decision Center lane rationalization map (Phase 1)

Companion to `UX_CONSOLIDATION_AUDIT.md`. Phase 1 **defines** this map; it deletes
nothing and re-routes no lane. The map is the single source of truth Phase 2 uses
to render the consolidated lane index, and the merge-kind flags drive which lanes
open the shared merge modal (`planMerge`, `review-shared.js`).

Machine-readable form: `LCC_DECISION_LANE_MAP` + `LCC_REVIEW_LANES` in
`review-shared.js` (unit-tested in `test/review-shared.test.mjs`).

## The 15 surfaces → 8 logical lanes

The Decision Center renders 14 `decision_type` lanes plus the built-in SOS
owner-contact worklist (synthetic key `sos_owner_links`) — 15 sub-surfaces. They
collapse to 8 logical lanes keyed by **the question being asked**:

| Logical lane | Title | Question | Member decision_types | Merge kind |
|---|---|---|---|---|
| `ownership` | Ownership & control | Who is the true owner — confirm or correct? | `confirm_true_owner` | — |
| `buyer_mapping` | Buyer parents & SF mapping | Confirm the sponsor / map to the Salesforce parent account. | `confirm_buyer_parent`, `map_sf_parent_account` | — |
| `entity_merge` | Entities — merge & clean | Same entity? Merge duplicates, rename junk, or keep separate. | `merge_duplicate_entities`, `junk_entity_name` | **entity** |
| `property_merge` | Properties — merge | Same property? Merge duplicates or keep distinct. | `property_merge` | **property** |
| `provenance` | Field values & provenance | Which source/value is right — apply, prefer, or correct? | `provenance_conflict`, `pending_update` | — |
| `intake` | Intake disposition | Create the property, pick the match, re-extract, or dismiss. | `intake_disposition`, `match_disambiguation` | — |
| `linkage` | Links to confirm | Is this link (CMS↔property, owner↔contact) correct? | `cms_link_suspect`, `sos_owner_links` | — |
| `automation` | Automation needs you | Resolve dead-letters and bot-block / implausible-value alerts. | `implausible_value`, `llc_research_dead`, `availability_checker_botblock` | — |

## Why these groupings

- **`entity_merge`** unifies the two entity-touching lanes (`merge_duplicate_entities`
  and `junk_entity_name`). Junk entities are most often disposed of by **merging**
  into the correct entity (the other verdicts — rename / leave-flagged — stay), so
  both lanes share the same "is this a duplicate of a real entity?" judgment and
  should share one merge surface. Both are flagged `merges: 'entity'`.
- **`property_merge`** is the only property-merge lane; flagged `merges: 'property'`.
  Today's federated `property_merge` card already hands the destructive merge to the
  consolidate surface — Phase 2 points that at the shared modal.
- **`provenance`** groups field-value disagreements: `provenance_conflict` (two
  sources disagree at equal priority) and `pending_update` (a proposed gov field
  change awaiting apply/reject). Both answer "which value should this field hold?"
- **`intake`** groups the two staged-intake judgments: `intake_disposition`
  (create / dismiss / re-extract) and `match_disambiguation` (pick which existing
  property the intake matches). Both work the same staged-intake subject.
- **`linkage`** groups the link-confirmation work — `cms_link_suspect`
  (clinic↔property) and the SOS owner↔contact weak links. Same shape: "is this
  link correct? confirm or break."
- **`automation`** groups the engine-surfaced alerts that need a human:
  `implausible_value`, `llc_research_dead`, `availability_checker_botblock`. These
  are dead-letters / threshold alerts, not data-modeling decisions.

## Overlap targets this map closes (from the audit)

- **Entity merge in 5 places** → all route through the one `planMerge({kind:'entity'})`
  → `POST /api/entities?action=merge`. **Phase 2 re-pointed that endpoint at
  `lcc_merge_entity(p_loser, p_winner)`** — the BD-doctrine merge that PK-safely
  carries `lcc_entity_portfolio_facts` + `external_identities` and tombstones the
  loser — plus the ops-table moves (`entity_aliases` / `entity_relationships` /
  `action_items` / `activity_events` / `watchers`) the RPC does not cover. The
  OLD hand-rolled body silently **dropped the portfolio edges on every merge**
  (BD-graph orphan); the unified path no longer does, on either graph. Surfaces:
  Data Quality "Duplicate Candidates", Decision Center `merge_duplicate_entities`,
  `junk_entity_name`, Unified Contacts "Merge Queue", Entities detail panel.
- **Property merge in 2 places** → `planMerge({kind:'property'})` →
  `POST /api/admin?_route=consolidate-property&domain=…` (→ `dia_merge_property` /
  `gov_merge_property`). Surfaces: Decision Center `property_merge`, Priority Queue
  "Consolidate Property".
- **"Create Follow-up" in 6+ places** → one `planFollowup(...)` →
  `POST /api/actions` (generic) or `POST /api/workflows?action=research_followup`
  (when completing a research task). One signature, one write path.

## Phase boundaries

- **Phase 1 (this round):** the map + `planMerge` + `planFollowup` + the shared
  modals exist and are unit-tested. Nothing is removed; every old surface still
  works.
- **Phase 2 (DONE, this round):** the Decision Center renders the 8 grouped lanes
  (each a residue "N need you" + "M handled" auto-vs-manual split; member
  sub-lanes preserved — nothing lost), with the total residue surfaced as a nav
  badge. Counts come straight from `/api/decisions?summary=1` so they match the
  underlying views exactly. Data Quality is now a **read-only dashboard**: the
  entity-quality action rows (merge / link / precedence) are deep-links into the
  matching Decision Center lane, and a "Review work — Decision Center" widget
  reads the SAME summary endpoint so DQ, the Decision Center, and the nav badge
  never diverge. The entity-merge endpoint was re-pointed at `lcc_merge_entity`
  (above); `qualityMergeDuplicate` / `createQualityFollowup` route through the
  shared modal / follow-up component. The `decision_type` enumeration is **not**
  changed — the map is a UI grouping over the existing types, so the backend
  verdict machinery is untouched. (Domain-DB triage widgets — dia/gov
  `v_data_quality_issues` — keep a unified "Create follow-up" via the shared
  component, since those domain issues have no decision lane to deep-link to.)
- **Phase 3:** retire the redundant ACTION surfaces behind a feature flag; keep the
  search/browse surfaces. The map's `merges` flags are how each retired merge
  button finds the shared modal.

## Doctrine guardrail (unchanged)

The **Priority Queue** (BD "who to pursue") is NOT in this map and is not touched —
the two-cockpit rule (R25) holds. This map covers only the review / data-quality /
merge surfaces that consolidate INTO the Decision Center.
