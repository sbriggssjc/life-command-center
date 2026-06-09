# Claude Code prompt — R7: the Decision Center (Phases 0+1)

Paste into Claude Code, run from the **life-command-center** repo. Read
`audit/data-flow-2026-05-30/LCC_DECISION_CENTER_DESIGN.md` FIRST — it carries
the full doctrine, the 15-type decision inventory, and the phasing. This
prompt implements **Phase 0 (perf prerequisite) + Phase 1 (the shell + the
two motivating lanes)**. Phases 2-3 come later — design the shell so they
slot in without rework.

## The doctrine in one line (Scott, 2026-06-05)

All manual decisions live in ONE place, organized by the question being
asked; every pipeline stage holds its items at the current gate's decision
point until a recorded verdict moves them forward; no surface offers a
later-stage CTA early.

## Phase 0 — perf prerequisite (the 5-7s queue floor)

From PR #1062's own finding: `v_priority_queue_enriched` costs ~5-7s
unfiltered because the buyer-parent rollup (`lcc_match_buyer_parent_by_name`
nested loop → ~1M-row HashAggregate) and the resolution-state LATERALs run on
EVERY read. The Decision Center reads the same state, so fix the floor first:

- Materialize the buyer-SPE classification + parent rollup (e.g.
  `lcc_buyer_spe_resolved` table or matview): entity_id → parent_entity_id,
  match_tier, refreshed by the existing owner-facts finalize + a short cron
  (the set only changes when patterns/mirror/portfolio change). Point
  `v_lcc_buyer_spe_entities` consumers (v_priority_queue's two NOT INs,
  P-BUYER rollup, the gate trigger's resolver path) at it. Keep
  `lcc_resolve_buyer_parent()`'s signature; tier-0 reads the materialized row
  first, falls back live for cache misses.
- Same treatment for the entity-connection predicate (SF identity OR person
  link) — a small `is_connected` cache column/table refreshed on
  external_identities / entity_relationships writes (trigger) beats three
  EXISTS per row per read.
- Targets: unfiltered enriched read < 1s; band counts < 200ms. Then drop the
  25s timeout band-aid back to default and verify no 500s. ANALYZE after any
  bulk refresh (the PR #1062 lesson, already in the sync — keep it).

## Phase 1 — Decision Center shell + first lanes

### 1. The decision record
New table `lcc_decisions` (LCC Opps): id, workspace_id, decision_type,
status ('open'|'decided'|'skipped'|'superseded'), subject_entity_id,
subject_domain, subject_property_id, subject_ref (text, e.g. intake_id),
question (text), context (jsonb — the evidence shown), verdict (text),
verdict_payload (jsonb), decided_by, decided_at, effects (jsonb trail of
what was written where), created_at. Indexes on (decision_type, status) and
subject refs. Soft-disposition: never hard-delete; superseded on re-open.

### 2. The surface
Evolve the Review Console page into the **Decision Center** (same nav slot,
rename). Lane anatomy per the design doc: question → subject+context card →
2-4 verdict buttons → workable top-N ranked by $ value, universe count as
subtitle. Existing lanes stay (Phase 2 will convert them); add the new lanes
at the top. The gov "Listings Needing Confirmation" lane is the in-house
model — match its feel.

### 3. Lane: "Confirm the true owner" (decision_type `confirm_true_owner`)
Subjects: P0.4 entities whose `resolve_reason='true_owner_known_connect'` —
the domain true_owner may be stale (pre-acquisition). Live example:
ARLINGTON VA I FGF shows "The Shooshan Company" while Scott believes FGF
shells are Boyd today. Context card: entity, property (address/rent), domain
true_owner, recorded_owner, latest sale buyer+date (from lcc_listing_events),
chain summary. Verdicts:
- **"Correct — connect"** → records verdict; routes into the existing
  connect machinery (ensureEntityLink toward the owner entity + SF/contact
  linkage path); the entity leaves P0.4 when connection completes.
- **"Stale — new owner is …"** → entity picker/typeahead (registered parents
  first); records verdict; writes the correction WHERE IT BELONGS (the gov
  DB true_owner is curated domain data — write back via the existing
  gov-write edge path with provenance source 'manual_decision', and update
  the LCC mirror row); resolver re-runs naturally.
- **"Research"** → spawns a research_task linked to the decision row.
Seed the lane from P0.4 (348) ranked by rent; decisions auto-close when the
underlying state resolves by other means (sweep: open decisions whose subject
no longer meets the question predicate → status 'superseded').

### 4. Lane: "Buyer parents & SF mapping" (decision_types
`confirm_buyer_parent`, `map_sf_parent_account`)
- One card per `lcc_buyer_parents` row with `needs_sf_mapping` or an
  unconfirmed sponsor (USGBF!). Context: parent name, SPE count, rollup rent,
  the SPE name samples, current SF identity if any.
- Verdicts for sponsor confirmation: "Confirm as own parent" / "This is a
  subsidiary of …" (re-parent: move patterns + rollup) / "Rename anchor to …".
- Verdicts for SF mapping: SF account search (the
  findSalesforceAccountByName helper exists) → "Map to <account>" (writes
  lcc_buyer_parents.sf_account_id + external_identities (salesforce,
  Account)); "No parent account exists — create later" (records + leaves the
  sync hold in place).
- Closing a mapping decision should release any held government_buyer syncs
  (`v_lcc_government_buyer_sync_health` flips ready_to_sync).

### 5. Wiring the queue + banner to the lanes
P0.4 rows' CTA routes to the property ladder as today, but ADD a secondary
"Decide →" affordance that deep-links to the matching Decision Center card
(filtered lane). The detail Next-Step banner for a P0.4 subject shows the
same question/verdicts state (one truth, three renderings — reuse the
priority-band payload, extend it with open decision id if cheap).

### 6. Automation funnel (foundation only this round)
Provide one helper (`lcc_open_decision(type, subject, question, context)`)
that engines call instead of inventing statuses; wire ONE existing producer
as proof: the availability-checker's bot-block alerts (or the matcher's
ambiguous multi-candidate hits — pick whichever is cheaper) emits a decision
row. Document the pattern for Phase 3.

## Verify + ship
- Phase 0: unfiltered priority-queue API < 1.5s end-to-end (report before/
  after); band counts < 300ms; no behavior change in band membership (counts
  identical pre/post materialization); R5 gate + R6 tier-0 still correct
  (NGP refusal; Boyd FGF resolution; ARLINGTON stays P0.4).
- Phase 1: ARLINGTON VA I FGF appears in "Confirm the true owner" with the
  Shooshan evidence; a "Stale — Boyd Watterson" verdict (test on a COPY/test
  row or rollback — do NOT actually overwrite Shooshan without Scott)
  records the decision + writes through with provenance; USGBF card appears
  in the buyer-parents lane; mapping a test SF account flips sync health.
- Decisions table shows the full trail (who/what/when/effects) for every
  verdict exercised.
- `node --check`; `ls api/*.js | wc -l` = 12; migrations idempotent +
  ordering noted; ANALYZE discipline on any new bulk-refreshed table.
