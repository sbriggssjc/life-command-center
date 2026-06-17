# Claude Code prompt — CONNECTIVITY #1: classify the un-classified active owners so they bridge into the entity graph

> From the connectivity-gap audit (`CONNECTIVITY_GAP_AUDIT_2026-06-17.md`). The headline gap
> — ~80% of true owners not in the LCC entity graph — grounded out to a precise upstream
> cause: **the owner-role classifier never ran on most active owners**, so the (working)
> classified-owners → entity sync skips them. Fix the classification; the existing sync then
> bridges them automatically. Receipts-first; gated; capped; reversible; never mint garbage.

## Grounding (measured live — corrects the audit's first framing)
- The bridge sync WORKS: `lcc_sync_classified_owners` / `lcc_finalize_classified_owners`
  (crons `lcc-entity-sync-fire`/`-finalize`, every 4h) bridges **classified** owners. dia
  has ~655 classified (buyer 449 / developer 197 / operator 9) ≈ the ~679 bridged. Not a
  sync bug.
- The real break is upstream: of 3,637 in-use dia true_owners, **2,956 have
  `owner_role='unknown'` AND `owner_role_source IS NULL`** — i.e. the classifier NEVER RAN
  on them. They are NOT genuinely unknown: **2,193 (74%) have acquisition/disposition
  activity, 757 own property, 442 carry a `salesforce_id`.** Real, active owners stuck
  pre-classification → excluded from the bridge → invisible to BD.
- The classifier is **behavioral**: `owner_role_source` on the classified set =
  `acquired_after_lease` (→buyer), `tenant_relationship_value_creation` (→developer),
  `manual_operator_flag` (→operator). It derives the role from the owner's
  transaction/ownership signals — signals 2,193 of the 2,956 already have.

## Unit 1 — bridge in-use owners regardless of archetype (the classifier path is a no-op)
**CORRECTION (CC grounding): re-running the classifier reaches 0 of the 2,956 dia / 3,530
gov unclassified owners** — they genuinely don't fit the three behavioral archetypes
(`acquired_after_lease`/`tenant_relationship`/manual). They are real owners with an
UNDETERMINED archetype, not classifiable-but-unrun. So do NOT force a fake archetype.
- **The real over-restriction is the sync's `classified`-only eligibility.** Archetype
  (buyer/developer/operator) is ENRICHMENT, not a prerequisite for existing in the entity
  graph. An in-use true_owner (resolved from a recorded *property* owner) is a real owner and
  belongs in the graph with `owner_role='unknown'` (honest) until enriched.
- **Expand bridge eligibility** from "classified" to "**in-use real owner**" (referenced by
  ≥1 recorded_owner). Start CONSERVATIVE with the **757 that currently own property**
  (`current_property_count > 0` — unambiguous owners), then the broader in-use set. Keep
  `owner_role` as-is. Implement as a sync-scope change OR a parallel bridge path — reuse
  `lcc_sync_classified_owners`'s entity-mint machinery, just widen the WHERE.
- **Every mint passes the existing `ensureEntityLink` junk/operator/implausible guards**, so
  a seller/broker/lender mis-recorded into recorded_owners (or a junk name, or an operator
  like DaVita) is still filtered — that's the protection against bridging non-owners.
- **Spot-check first:** confirm the in-use `unknown` set is genuinely owners (resolved from
  recorded property owners), not contaminated with sellers/brokers. Clean → bridge; murky →
  tighten to the property-owning subset.

## Unit 2 — run the widened bridge + verify
- With the eligibility widened (Unit 1), run/trigger the bridge over the in-use owners and
  confirm it mints their LCC entities + `external_identities(dia, true_owner)` links, reusing
  the existing entity-mint machinery (don't fork it — widen the WHERE only). Capped batch
  first → receipts → drain. Re-baseline: dia true_owner→entity bridge should jump from ~679
  toward ~3,000 (or the property-owning subset first, ~757+).
- Every entity it mints goes through the existing `ensureEntityLink` junk/operator/implausible
  guards (so DaVita/Fresenius operator owners and junk names are handled correctly) — confirm
  no garbage/non-owner entities created.

## Unit 3 — gov (same gap, ground first)
- gov very likely has the identical classification gap (14,150 true_owners, ~3,404 bridged).
  Ground it (how many gov in-use true_owners are `unknown`/`owner_role_source NULL` with txn
  signals), then apply the same classify→bridge. gov's recorded→true linkage differs (no
  `true_owner` FK) — note/repair that path if it blocks classification. Capped + gated.

## My gate (read-only, per unit)
- Unit 1: the 2,956 processed; the txn-signal owners now carry a real `owner_role` +
  `owner_role_source`; a sample is correctly classified (a clear buyer reads buyer, a
  developer reads developer); no already-classified owner overwritten; reversible.
- Unit 2: the entity graph's dia true_owner bridge count rises materially (toward ~2,800+);
  spot-sample the newly-bridged entities are real owners (not junk/operators mis-minted);
  the priority queue / portfolio now see them.
- Unit 3: gov gap sized honestly and applied with the same guards.

## Guardrails
- Receipts-first; capped batch before full; reversible (`owner_role_source`/confidence
  stamped, fill-blanks only); never overwrite a curated role. Reuse the existing classifier +
  the existing sync + `ensureEntityLink` guards — DO NOT fork or force-bridge unclassified
  owners. ≤12 api/*.js.
- This is the highest-leverage connectivity fix: it makes ~2,000+ real dia owners (and the
  gov equivalent) visible to the entire BD graph the prior tiers built — without touching the
  sync that already works.
