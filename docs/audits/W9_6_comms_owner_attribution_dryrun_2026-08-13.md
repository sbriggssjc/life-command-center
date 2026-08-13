# W9.6 — correspondence → owner-LLC attribution (dry-run, 2026-08-13, Prompt 102)

**Status: BUILT (code + DB), flag OFF.** The last major INTERNAL linkage gap in Wave 9.
Connects the INBOX to the OWNER GRAPH (the reverse direction of the Outlook↔LCC bridge).
Flag `W9_6_COMMS_OWNER_ATTRIBUTION` stays off until Scott reviews the `?score=1` sample.

## The gap (grounded live via W9.5)

`correspondence_entity_owner_llc` = **6 / 241 = 2.5%** (distinct entities correspondence
attributes to that map to a `true_owner`). Correspondence (`activity_events`, source_type
`outlook*`/`email_intake`) is stamped with the **deal / party / property** entity the resolver
found — brokers, buyers, seller contacts. Those are PARTIES, not the owning LLC, so an email
about a property never surfaces against the owner you're trying to reach. Preserving header
names (W9.4) did **not** fix this — it is a distinct LINKAGE problem (the prompt-96 second
finding). W9.6 closes it.

## Two attribution paths (deterministic-first)

- **Path A — `property_bridge` (deterministic).** A correspondence entity that resolves to an
  ASSET → its single **current** `true_owner` via the ops `owns` edge (owner —owns→ asset).
  Arithmetic where the link exists (confidence 1.0); unambiguous only (exactly one current
  owner); value-ranked by owner portfolio size. `bd_opportunity_id` is the durable seam — **0**
  correspondence rows carry one today, so the live feedstock is the asset-attributed sub-case
  (both are the SAME owns-edge resolver). SQL: `lcc_w9_6_path_a_candidates`.
- **Path B — `person_match` (verbatim, thinner).** A correspondence PERSON tied to a single
  `true_owner` via `owner_contact_pivot.active_contact_entity_id` (tier 1, curated) or an
  **unambiguous** person→owner relationship edge (`associated_with`/`contact_at`/`works_at`,
  tier 2). Carries the correspondent's **VERBATIM** header name/email; a **shared-token-only**
  name bridge (only a common surname overlaps, no corroborating email) is **rejected** in the
  planner (never guess — the W9.1 naming-core false-bridge lesson). SQL:
  `lcc_w9_6_path_b_candidates`; guard: `api/_shared/comms-owner-attribution.js::sharedTokenOnly`.

## Grounded dry-run counts (live, 2026-08-13)

| Path | Candidates | Notes |
|---|---|---|
| A `property_bridge` | **3** | asset-attributed correspondence with exactly one current owner; ranked by owner portfolio size |
| B `person_match` | **40** | 16 active-contact (pivot) + 24 relationship; the raw 1,151 relationship rows collapse to 24 after the unambiguous-single-owner filter |

### Sampled sheet (real rows, value-ranked)

Path A (join shown = correspondence.entity → owns-edge → owner):

| correspondence entity | → owner (true_owner) | domain | threads | owner rank |
|---|---|---|---|---|
| 5247 Airways Blvd | Kingsbarn Realty | dia | 1 | 18 |
| Palestra Properties | Palestra Properties | dia | 5 | 6 |
| 10690 San Pablo Ave, El Cerrito, CA | Atwater Enterprises Inc | dia | 1 | 3 |

Path B (verbatim evidence = the correspondent's header `Name <email>`):

| correspondent | → owner | tie | email evidence | owner rank |
|---|---|---|---|---|
| Joseph Capra | Boyd Watterson Asset Management, LLC | relationship | jcapra@boydwatterson.com | **1175** |
| Jeff Pori | Kingsbarn Realty | relationship | jpori@kingsbarn.com | 18 |
| Christopher Hamilton | Magaurn Bemidji, LLC | active_contact | hamilton@paulbunyan.net | 0 |
| Patrick Ward | Metro Group Finance | active_contact | pward@metrogroupfinance.com | 0 |

**Honest grounding — some Path-B "owners" are brokerages mislabeled `true_owner` upstream**
(Newmark, Avison Young, Kidder Mathews, Transwestern appear as owner entities). That is a
pre-existing owner-graph labeling issue, NOT a join bug. They carry `rank_value = 0` (own no
assets), so the value-gate ranks them LAST and the real property owners (Boyd Watterson rank
1175, Kingsbarn) lead. Per doctrine, ambiguity/noise goes to the **human confirm lane** — never
auto-attributed. A confirm only ever runs on a human verdict.

## What confirm does (the write)

The Decision Center `comms_owner_attribution_review` lane. **Confirm** runs a DETERMINISTIC
writer (`api/admin.js` verdict dispatch): it appends the owner ops entity to the
`metadata.linked_entity_ids` of **every** `activity_events` row the corr entity attributes to
(dedup, fill-append — never a clobber), stamps `field_provenance` (source `comms_owner_bridge`,
priority 45, fsp registered so `v_field_provenance_unranked` stays 0), and logs a reversible
`comms_owner_attribution_apply_log` row (reversal = `{owner_entity_id, activity_event_ids[],
provenance_ids[]}`). **Reject** keeps the row.

One anchor (`linked_entity_ids`) feeds BOTH consumers — the arms compound:
1. the owner's record now shows its correspondence history; and
2. the W9.2/W9.4 reachability harvest **create-contact** arm gains owner-linked threads it
   couldn't see before (`harvestBuildCommsIndex` reads `linked_entity_ids` via
   `commsRowEntityAnchors` → resolves owners-without-contacts).

## Metric

The W9.5 `correspondence_entity_owner_llc` link is EXTENDED to count entities correspondence
attributes to via the primary `entity_id` **OR** a confirmed W9.6 owner bridge
(`linked_entity_ids`, restricted to `true_owner` entities so pre-existing non-owner links can't
dilute the baseline). Verified: baseline remains exactly **6/241 = 2.5%** pre-attribution; each
confirmed owner bridge enters both numerator and denominator → the pct rises measurably next
run. → feeds U4.

## Rollout gate

1. `GET /api/comms-owner-attribution-tick?score=1&n=20` (with `X-LCC-Key` / a session) →
   review the per-path counts + sampled sheet.
2. Review → Cowork flips `W9_6_COMMS_OWNER_ATTRIBUTION` on. The nightly cron
   (`comms-owner-attribution-tick`, 05:05 UTC) then writes proposals; confirms lift the W9.5 pct.

## Tests

`test/comms-owner-attribution.test.mjs` (14) — Path-A shaping, Path-B verbatim + the
shared-token false-bridge guard (reject no-email shared-surname; allow with email; allow
distinctive multi-token; pivot always proposes), value-gate ordering, subject-ref stability,
never-fabricate. `test/w8-federated-lane-wiring.test.mjs` + `test/decision-center-partition.test.mjs`
green (lane fully 75-wired). Migration `supabase/migrations/20260829120000_lcc_w9_6_comms_owner_attribution.sql`
applied live to LCC Opps (`xengecqvemvfknjvbvrq`).
