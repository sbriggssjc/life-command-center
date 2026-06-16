# Claude Code prompt — TIER 3: consolidate the review surfaces into the Decision Center

> From the deep-dive audit (Finding E + companion `UX_CONSOLIDATION_AUDIT.md`). Tiers 0–2
> de-noised the data so the lanes are now small + precise. Tier 3 fixes the *fragmentation*:
> the same review work is scattered across **13 surfaces / 8+ pages**, with entity-merge in
> 5 places, property-merge in 2, "Create Follow-up" in 6+, owner-contact linking in 3, and
> provenance work split across pages. The Decision Center (`ops.js renderReviewConsolePage`)
> was BUILT to be the single router — Tier 3 finishes that. This is frontend-heavy: phase it,
> never lose a lane or action, feature-flag the cutover. Receipts-first; gated per phase.

## Read first
`docs/capital-markets/UX_CONSOLIDATION_AUDIT.md` — the exact surface catalog (file, function,
endpoint, action, write-target for all 13 surfaces) + the overlap map. Build from it.

## Doctrine (the two-cockpit rule still holds — R25)
Do NOT merge the **Priority Queue** (BD "who to pursue") and the **Decision Center** (data/
review "what to connect/fix") — they answer different questions and stay distinct (R25). Tier
3 consolidates the **review/data-quality/merge** surfaces INTO the Decision Center; it does
not touch the Priority Queue cockpit.

## Phase 1 — the shared primitives (build, don't remove yet)
1. **One reusable merge modal** for BOTH entity and property merges, invoked from anywhere,
   writing through the single RPC per kind (`gov_merge_property`/`dia_merge_property` for
   property; `lcc_merge_entity` for entity). Replaces the 5 entity-merge + 2 property-merge
   implementations (Data Quality "Duplicate Candidates", Decision Center duplicate-entities
   lane, junk-entity lane, Unified Contacts "Merge Queue", Entities detail panel; Decision
   Center property_merge + Priority Queue "Consolidate Property"). Same modal, same preview,
   same survivor-pick, same provenance.
2. **One follow-up component** replacing the 6+ inconsistent "Create Follow-up" buttons —
   one signature, one write path, consistent UX.
3. **The lane rationalization map** — collapse the 14 `decision_type`s into ~8 logical lanes
   (group the merge lanes, the linking lanes, the provenance lane, the intake lane, etc.).
   Produce the map as a doc + a `decision_type → lane` lookup; don't delete types yet.
Receipts: the shared modal + follow-up component exist and are unit-tested; the lane map is
written. Old surfaces still work (nothing removed).

## Phase 2 — Decision Center becomes the single ACTION surface
1. **Every review lane lives in the Decision Center**, each rendered as: the QUESTION → the
   subject+context card → the verdict actions → self-propelling advance. Pull the action work
   currently on Data Quality / Unified Contacts / Entities into Decision Center lanes (reuse
   the Phase-1 modal + follow-up).
2. **Each lane shows an auto-resolved-vs-needs-you split** (the Tiers 0–2 work feeds this — most
   lanes are now tiny). Show the genuine residue count per lane; surface open counts in the nav.
3. **Data Quality page → read-only health DASHBOARD** — metrics + sparklines only; every
   "action" there becomes a deep-link INTO the relevant Decision Center lane (no action buttons
   on Data Quality). The domain-health summary, coverage %, and issue counts stay as a
   dashboard; the *work* moves to the Decision Center.
4. Unify the data-quality METRICS source so Data Quality, the Decision Center, and the Today
   rail read the same counts (no three-way divergence).
Receipts: every `decision_type`/issue lane reachable in the Decision Center; Data Quality has
no action buttons (deep-links only); nav shows per-lane open counts; the lane counts match the
`v_data_quality_issues` / `v_field_provenance_actionable` / decisions views exactly.

## Phase 3 — retire the redundant surfaces (feature-flagged cutover)
- Redirect/remove the duplicate ACTION surfaces: Unified Contacts "Merge Queue", the Entities
  detail merge panel, the Data Quality action buttons → all now point to the unified modal /
  the Decision Center lane. Keep the SEARCH/browse parts of Entities + Unified Contacts (those
  aren't review work); only the review/merge ACTIONS consolidate.
- Behind a feature flag so the cutover is reversible; remove the old code paths only after the
  consolidated surface is verified.
Receipts: a user can do ALL manual-review work from the Decision Center (the "8+ pages" → 1);
no action is orphaned; the removed surfaces redirect cleanly.

## My gate (per phase)
- Phase 1: the shared modal + follow-up render and write correctly (I'll exercise an entity
  merge + a property merge + a follow-up through the single components; no lane lost).
- Phase 2: I'll load the app (Chrome) and confirm every lane renders in the Decision Center
  with the auto-vs-manual split; Data Quality is read-only with working deep-links; and the
  per-lane counts MATCH the underlying views (I verify the counts in SQL).
- Phase 3: every review action is reachable from the one surface; the redundant surfaces
  redirect; the feature flag flips cleanly both ways.

## Guardrails
- Phased + feature-flagged; never lose a lane or action; the Priority Queue cockpit is NOT
  touched (R25 two-cockpit rule). Reuse the existing decision/verdict machinery, the merge
  RPCs, `lcc_merge_field`/provenance — consolidate the UI, don't fork the backend.
- ≤12 api/*.js. Frontend ships on the Railway redeploy; verify post-deploy.
- Receipts-first; each phase gated before the next. Keep the search/browse surfaces intact.

## After Tier 3
The review work is one surface with auto-vs-manual splits. Tier 4 (connectivity: SF-link
backfill, recorded-owner backfill, gov metric wiring) is the finale. Update the audit doc with
the consolidated surface map.
