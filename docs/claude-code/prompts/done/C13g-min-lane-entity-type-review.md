# C13g-min-lane — the `entity_type_review` Decision Center lane over the retype write that already exists

**Read first:** `docs/os/BUILD-TURN-PROTOCOL.md` · `docs/architecture/owner-role-classification.md` **§9e** (what
shipped in PR #2196 and what was cut) · `docs/claude-code/prompts/done/C13g-min-entity-retype-verdict.md`
§§2–5 (the lane design — it still applies verbatim) · `docs/audits/OWN_T0e_SPONSOR_FAMILY_LANE_DESIGN_2026-09-08.md`
§§6–9 · `api/_shared/sponsor-family-planner.js` + the OWN-T0e branches in `api/admin.js` (the shape to copy) ·
`test/own-t0e-sponsor-family-lane.test.mjs` (the four-registry test to copy).

**The write is done. Do not touch the migration.** `lcc_retype_entity(p_entity, p_to, p_decision_id, p_reason, …)`,
`lcc_unretype_entity`, `lcc_entity_retype_log` and `v_lcc_entity_retype_candidates` (18 rows / $69.4M) are live
on LCC Opps and privilege-verified. This unit is the JS that lets a human ask for it from a card, the guard that
proves the JS, and the census the last builder cut. **No new SQL unless a measurement forces it** — if it does,
the SEC1 stanza applies.

---

## 1. Build

1. **Decision type `entity_type_review`**, federated, in ALL FOUR registries (`api/admin.js`
   `FEDERATED_DECISION_TYPES` + `federatedSubjectRef` → `etype:<entity_id>`; `ops.js` `_DC_FEDERATED` + the
   sublane tile; `dc-lanes.js` `_DC_FED_META` + card + `dcEntityTypeReview`; `review-shared.js` → lane
   `merges_dupes`). The P139/UX-T1c registry-drift test goes red on three of four.
2. **Fetch branch** reads `v_lcc_entity_retype_candidates`, `blocks_own_t0e_sponsor_id is not null` first, then
   `current_rent desc`; `lcc_decisions` excluded-refs like every federated lane; the badge counts the same
   filtered population (RO1). **Card shows every column the view carries** — the corroboration flags are the
   evidence and `looks_like_person_warning` is a WARNING, never a gate — plus, when `blocks_own_t0e_token` is set,
   a line naming the sponsor card this unblocks.
3. **Pure planner `api/_shared/entity-retype-planner.js`**: subject refs, card, ordering, and
   `validateEntityRetypeVerdict(card, verdict, payload, live)`. Verdicts: `retype_organization` (the ONE write:
   `POST rpc/lcc_retype_entity` with `p_decision_id` = the decision row, `p_reason` = the operator's note or the
   card's evidence summary), `keep_person` (record-only; excluded from the lane), `research`
   (`research_task` `entity_type_review`). Live reads at verdict time (P188): the entity exists, is not a
   tombstone, `entity_type` is still `person`. **Never PATCH `entities` from the handler** — the RPC is the
   single writer, and the guard asserts on the statement shape.
4. **Success toast on `retype_organization`**: *"retyped — now `same_party` + merge from the <sponsor> card"*
   when `blocks_own_t0e_token` was set. No cache refresh is needed for OWN-T0e's guard (it reads
   `entities.entity_type` live); say that in a comment, not a call.

## 2. The census the last builder cut — do it BEFORE the positive control

`grep -rn "entity_type" api/ supabase/migrations/ | grep -v test` plus the live view definitions. For the Gardner
row predict, then measure in one rolled-back transaction (retype → read → unretype → 0 residue):

| consumer | prediction |
|---|---|
| `v_lcc_merge_candidates` / `auto_mergeable` | Gardner becomes ELIGIBLE (the org filter); **`auto_mergeable` must not move** — its canonical key differs from `Gardner Tanenbaum Holdings` |
| Tier 0 `people` bench (`v_lcc_tier0_owner_contact_candidates`) | person-typed only — does Gardner-Tanenbaum or MassMutual Life sit on ANY Tier 0 card today? If yes, a retype removes it: say which card and whether that is loss or noise |
| `v_lcc_entity_roles` `one_off_owner` | does not move (needs exactly one asset) |
| `v_lcc_entity_role_ambiguity` | state it |
| `lcc_supersede_property_owner` | no ownership change (already owner of 19) |
| C13c corroboration CTE | state it |

Then the **full control from the prompt's §4**: retype → OWN-T0e guard inputs agree → `lcc_merge_entity(loser
4dac1df8…, winner 6b8887c2…)` → `unclassified_rival` **−4** (10 of the 14 keep the RTD/TEP third claimant) →
unmerge → unretype → **0 residue**. Reconcile predicted vs actual; a miss is the finding.

## 3. Guard

Extend `test/c13g-min-entity-retype.test.mjs` or add `test/c13g-min-lane.test.mjs`: four-registry presence;
planner refusals (tombstone, non-person, unknown verdict); the verdict path calls `rpc/lcc_retype_entity` and
never PATCHes `entities` (statement shape — the RPC name appears in comments; OCR1c); card reads ⊆ view columns
(the C10 map test); toast condition. **Mutation pass on EVERY assertion, comments stripped first, RED count in the
response** — the 10 shipped tests were never mutation-passed and that is part of this unit.

## 4. Ship + record

Branch `build/c13g-min-lane`. **Both Railway services** (`tranquil-delight` + the standalone MCP); `/version` +
`git merge-base --is-ancestor` before any live verdict. Same change: owner-role-classification.md **§9f**,
OWN-T0e design **§9** (one line: lane live), `PLANNED-BACKLOG.md` `C13g-min-lane` → ✅, `CURRENT-STATE.md` row,
`STATUS.md`. Then the operator sequence: Gardner-Tanenbaum `retype_organization` → OWN-T0e `same_party` +
`merge_now` → MassMutual Life the same → NGP Group card `same_party` → re-measure the 19 `duplicate_entity_suspect`
groups.

## 5. Report back

- The census table with predicted vs actual, and the −4 reconciled.
- **The 18 rows read by name with your call and the evidence beside each** — Scott decides, you do not retype.
- `Research In Progress` (2 current facts): placeholder → `junk_entity_review`? Say whose facts they are.
- Mutation count RED / total; buffers for the lane fetch at `limit 50`.
