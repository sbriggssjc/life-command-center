# Claude Code prompt — CONNECTIVITY #4: resolve gov property owners (the recorded-owner-backed set)

> Remediation #4 from `CONNECTIVITY_GAP_AUDIT_2026-06-17.md`. The gov parallel of #2 (which
> resolved dia recorded→true and let the existing bridge make 2,836 owners visible). The
> independent gate has GROUNDED this live — read the grounding; gov's model differs from dia's
> in ways that change the write path. Receipts-first; gated; capped; reversible; never mint
> garbage. gov-only (`scknotsqkcheojiaewwh`).

## Grounding (measured live 2026-06-18)
- gov has **5,389 active properties with no `true_owner_id`** (7,112 resolved, 19,158 total).
  They split cleanly:
  - **1,769 have a `recorded_owner_id`** → internally resolvable from the recorded owner name.
    **THIS IS THE SCOPE.**
  - **3,620 have NO recorded owner at all** → not internally resolvable (need external
    county/deed data). **OUT OF SCOPE** — that's the audit's "no-owner-data tail" follow-up.
- **gov's model differs from dia's** (this is the key design point):
  - gov `recorded_owners` has **NO `true_owner_id` column** — there is no recorded→true FK to
    set. Resolution sets **`properties.true_owner_id` directly** (gov's bridge keys on that).
  - gov has **NO lightweight find-or-create name resolver** (dia had
    `dia_resolve_canonical_true_owner_id`). `gov_auto_resolve_ownership` is an
    ownership_history→sales-comp triage function, NOT a name→owner resolver. The only existing
    name→true_owner write path is `gov_apply_manual_true_owner` — but it's the heavy,
    env-gated (`DECISION_GOV_WRITEBACK`), `service_role`-only R7 *manual-correction* function
    that stamps `source='manual_decision'` provenance across 4 tables. Using it for a 1,769-row
    auto-resolution would (a) mislabel auto-resolution as a human decision, (b) be needlessly
    heavy, (c) be env-gated off by default.
- The resolvable 1,769: **1,426 distinct names** (so ~343 are multi-property owners that must
  dedup to one true_owner), **0 null**, **21 artifact-contaminated** (e.g.
  `Gardner-Tanenbaum by Marcus & Millichap` — the guard holds these), **147 distinct names
  already match an existing true_owner by name** (a LINK, not a mint). 22-sample is clean real
  owners (LLCs, LPs, USAA Real Estate, George Washington University, a federal credit union,
  individuals).
- **Downstream bridge is already wired:** gov `v_bridge_eligible_owners` keys on
  `properties.true_owner_id` (that's how the 5,118 gov conservative owners bridged) and bakes
  in the artifact guard. So the moment a property gets `true_owner_id` set, its owner becomes
  bridge-eligible and the steady-state cron auto-bridges it (`owner_role='unknown'`). **No new
  bridge code.**

## Unit 1 — build the gov find-or-create resolver (the missing parallel) + resolve the 1,769
gov genuinely lacks dia's lightweight resolver, so build the gov equivalent — mirror
`dia_resolve_canonical_true_owner_id`'s shape, do NOT repurpose the heavy manual function:
1. **`gov_resolve_canonical_true_owner_id(p_canonical text)`** — match an existing
   non-merged, non-operator `true_owners` row by `lower(btrim(name))`; else INSERT one tagged
   `source='connectivity4_recorded_resolution'` (the reversible batch marker — NOT
   `manual_decision`). Mirror dia's function verbatim except the source tag. (147 names hit the
   match branch → link, no new row; ~1,260 mint.)
2. **Mint-time artifact guard** (don't pollute `true_owners`): skip any recorded-owner name
   matching gov's artifact/junk pattern set — reuse the EXACT patterns baked into gov
   `v_bridge_eligible_owners` (factor to a `gov_is_artifact_owner_name(text)` helper if not
   already). The 21 artifact names route to junk/review, never to a minted true_owner.
3. For each of the 1,769 resolvable properties (recorded_owner present, `true_owner_id IS
   NULL`, non-archived): resolve the recorded owner's name → set `properties.true_owner_id`.
   **Fill-blanks ONLY** — never overwrite a property that already has a `true_owner_id`, never
   touch archived/merged rows.
4. **Provenance + reversibility:** write a `field_value_provenance` row for the
   `properties.true_owner_id` write tagged `source='connectivity4_recorded_resolution'` at a
   priority **below** manual/curated (so a later `gov_apply_manual_true_owner` always wins —
   this is a blank-fill, not a curated correction). Log every change to a
   `gov_connectivity4_resolution_log` ledger (mirror dia's `dia_connectivity2_resolution_log`)
   and embed a REVERT runbook in the migration (null the filled `true_owner_id` back + delete
   batch-tagged true_owners no other row references).
- **Cap the first batch (25)** → STOP for the gate → then drain (batched).

## Unit 2 — confirm the bridge fires
- After resolution, the newly-resolved owners (referenced via `properties.true_owner_id`) are
  the **broad** tier (no active ownership_history) → confirm the steady-state cron runs broad
  (`p_current_only=false`) and covers the tail; if not, run one explicit
  `lcc_sync_bridge_eligible_owners('gov', false, …)` → finalize pass so they actually mint
  entities + `external_identities(gov, true_owner)`, `owner_role='unknown'`.
- Re-baseline: gov props with owner 7,112 → ~8,860 (minus the 21 artifacts); gov true_owner
  bridge rises by the newly-eligible count. Report deltas.

## My gate (read-only, per pass)
- **Capped 25:** each resolved property points at a real true_owner (found-or-created
  correctly; the 147-class links to the existing one, not a dup); 0 artifact/null-ish name
  minted; `properties.true_owner_id` fill-blanks held (nothing curated overwritten); batch
  rows carry the reversible tag + ledger; provenance priority is below manual.
- **Drain:** resolvable set drains to ~0 (1,769 → the 21 artifacts + any held); spot-sample new
  true_owners are real owners; multi-prop owners share ONE true_owner (dedup worked); the
  canonical-twin lane absorbs near-duplicate names.
- **Bridge:** the newly-resolved owners appear in the entity graph
  (`external_identities(gov, true_owner)`, `bridge_source='connectivity_inuse_owner'`),
  `owner_role='unknown'`, reversible.

## Guardrails
- Receipts-first; capped → gate → drain; reversible (batch tag + ledger); fill-blanks only;
  never overwrite a curated `properties.true_owner_id`, never touch archived/merged rows.
  Build the gov resolver as the deliberate parallel of dia's (gov lacks it) — do NOT repurpose
  the env-gated manual-correction function for bulk auto-resolution. Reuse gov's existing
  bridge view + artifact guard. ≤12 api/*.js (DB-side; likely no api/*.js change). The
  classified cron enriches `unknown`→archetype on top.
- **Out of scope (documented, not done here):** the 3,620 active gov props with no recorded
  owner (external county/deed data — audit follow-up); the 21 artifact names (junk/review
  lane); gov SF reconciliation (#3); orphan/cms cleanup (#6).
- Net: ~1,769 gov properties whose owner is currently invisible get a resolved canonical owner
  that the already-built bridge makes visible to the BD graph — the gov completion of the #2
  unlock.
