# Prompt 131 — Local model drafts the dead research queues (research-from-scratch → confirm-a-draft)

**Status:** DRAFT 2026-08-24 (Cowork; #1 of the LOCAL-MODEL-GAP-AUDIT re-rank — the biggest raw-impact,
genuinely-unbuilt local-model gap)

Grounding: `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Class 2 (never-consumed research queues) + Class 3
(surface notifies but cannot capture), `api/_shared/manual-research-worklist.js` (already assembles the notice
address, rejected bench + why, and 2–3 Google queries), the `research_task` / owner-contact review lanes
(`api/admin.js` lane registry ~L6874, P114 `owner_contact_attach_review` verdicts), on-box evidence
(`deed-parser.js`, `owner-reconcile-engine.js`, SOS `manager_name`, `email_bodies` signatures,
`activity_events`), the Ollama seam `api/_shared/ai.js` (`invokeExtractionAI({surface:'clean_assist'})` /
`invokeOnPremGeneration`, on-box only), `docs/os/LOCAL-MODEL-GAP-AUDIT.md` (R1). Doctrines: **Consumption-Layer**
(value-gate producer, auto-retire, honest counts, **CAPTURE PATH BEFORE RANK**), never fabricate ("Not on
file"), annotation/draft-only — never an auto-write or a merge, human confirms.

## The gap (measured)

`establish_ownership_history` **545 open / 0 lifetime completions**, `owner_contact_manual` **316 / 0** — the
two largest never-consumed research queues (Class 2). They are cards that tell a human to reconstruct chain of
title / find the decision-maker by hand — yet the evidence to do it is ALREADY on-box (deeds, SOS
managing-member, signature blocks, the deal comms graph), and `manual-research-worklist.js` already
pre-assembles the breadcrumbs. Nobody works them because it's from-scratch research per row.

## The ask

1. **CAPTURE PATH FIRST (gating).** For each lane, verify the operator can actually ACCEPT/REJECT a draft — a
   real verdict path in the Decision Center (like P114's `owner_contact_attach_review` verdicts), not a
   notify-only card. Per Class 3, the Research surface has historically had **0 input fields**. If a lane has
   no capture path, BUILD it before drafting anything — drafting proposals nobody can accept is strictly worse
   than leaving the lane buried. Report each lane's capture path (exists / built).

2. **Local-model draft-generator (annotation-only).** For each open row, run `invokeOnPremGeneration` /
   `invokeExtractionAI({surface:'clean_assist'})` over the ALREADY-ON-BOX evidence to draft:
   - `establish_ownership_history`: the grantor→grantee chain with dates + entity roles, each link **cited to a
     verbatim deed/comms quote**; unknown links stay "Not on file" (never invented).
   - `owner_contact_manual`: the most-likely decision-maker (name/title/why) from SOS `manager_name` +
     signature blocks + notice address, with the verbatim source — feeding the existing attach-review verdicts.
   Write drafts into the review card / `lcc_clean_assist_proposals` (or the lane's annotation store), tagged
   with source + confidence + evidence. Flips the operator from "research" to "confirm/edit."

3. **Consumption-Layer compliance.** Value-gate (draft only where enough on-box evidence exists to be worth a
   human look — don't emit a blank draft per row); auto-retire a draft whose row was resolved another way;
   honest counts (drafts generated vs rows with too little evidence to draft — surface the latter as its own
   number, not a fake "$0"/blank). Never fabricate; a link the evidence doesn't state stays absent.

4. **Verify by STATE DELTA, not the tally.** After a dry-run sample (10–15 rows, human-graded for precision:
   are the chains/decision-makers right, are the quotes real substrings), flip on and confirm the lane
   actually DRAINS — `completions > 0` for the first time — and that a confirmed draft writes the real
   owner/contact edge, not just closes a card. Report the drain delta.

## Close-out
- Ships on the Railway redeploy of merged `main`; any migration (a capture-path column/verdict) is
  live-immediate. Register the new producer's flag in `feature_flags_registry` (start OFF, flip after the
  dry-run review). Update STATUS + `LOCAL-MODEL-GAP-AUDIT.md` (R1 → done, with the drain numbers).
