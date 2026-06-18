# Claude Code prompt — CONNECTIVITY #2: resolve dia recorded_owner → true_owner (the in-use unresolved set)

> Remediation #2 from `CONNECTIVITY_GAP_AUDIT_2026-06-17.md`, now that #1 (the owner bridge)
> is live. The independent gate has already GROUNDED this one — read the grounding below before
> coding; it changes the shape of the job from the audit's first framing. Receipts-first;
> gated; capped; reversible; never mint garbage. dia-only (gov is a structurally different
> remediation, #4 — out of scope here).

## Grounding (measured live 2026-06-18, dia `zqzrriwuavgrquhisnoa`)
- `recorded_owners`: 6,850 total — 235 merged away, 4,005 resolved (`true_owner_id` set),
  **2,842 unresolved-active** (`true_owner_id IS NULL AND merged_into_recorded_owner_id IS NULL`)
  ≈ the audit's 2,845.
- **2,838 of the 2,842 are IN-USE** — referenced by a live `properties.recorded_owner_id`
  (only 3 truly dangling, 1 referenced elsewhere). So this is NOT cleanup of dead rows — it's
  2,838 properties whose owner currently never reaches the bridge → invisible to BD. **Real,
  high-leverage chain gap.**
- **The resolver already exists and find-or-creates:**
  `public.dia_resolve_canonical_true_owner_id(p_canonical text)` matches an existing
  `true_owners` row by `lower(btrim(name))` (non-operator), else INSERTs one
  (`source='h3_canonical_resolver'`). The 2,838 are unresolved because the resolver was never
  *called* for these recorded_owners (properties written before
  `trg_properties_resolve_true_owner_from_recorded`, or the trigger keys a different field) —
  NOT because resolution fails.
- **The downstream bridge is already wired:** `v_bridge_eligible_owners` (dia) makes a
  true_owner eligible if it is referenced by a non-merged recorded_owner **OR** has active
  ownership_history — AND it bakes in the full artifact/junk guard. So the moment a
  recorded_owner gets `true_owner_id` set, its true_owner becomes bridge-eligible and the
  steady-state cron (`lcc-bridge-eligible-fire`/`-finalize`, every 4h) auto-bridges it with
  `owner_role='unknown'`. **No new bridge code is needed.**
- Contamination is low: of the 2,838, **0 match an existing true_owner by normalized_name**
  (all genuinely new), **2,838 distinct names** (no self-dups), **only 1 artifact-named**.
  A 25-sample is clean real owners (individuals, LLCs, development firms, health systems, a
  church). Recorded-owner = title holder, so even an operator-style name (e.g. "Renal Care
  Group") as the *recorded* owner is a legit title holder.

## Unit 1 — resolve the 2,838 in-use unresolved recorded_owners (capped → gate → drain)
For each in-use unresolved recorded_owner (referenced by ≥1 `properties.recorded_owner_id`,
`true_owner_id IS NULL`, not merged), **reuse the existing resolver** — do NOT fork:
1. **Guard at mint time** (don't pollute `true_owners`): skip any whose `name` matches the
   artifact/junk guard already used by `v_bridge_eligible_owners` (the `$`/`approx`/paren-amount/
   `OBO`/`X by Y`/`Since <date>`/`Month D, YYYY`/null-ish/phone/email set). Reuse that exact
   pattern set (factor it to one helper if it isn't already). Artifact-named recorded_owners
   route to the existing junk/review path, NOT to a minted true_owner. (~1 in this set, but
   keep it clean + future-proof.)
2. Call `dia_resolve_canonical_true_owner_id(name)` → get-or-create the true_owner.
3. Set `recorded_owners.true_owner_id` and propagate to the property chain via the EXISTING
   path (`trg_recorded_owner_propagate_true_owner` / `dia_resolve_ownership_save` — whichever
   the resolved 4,005 used; match it so behavior is identical).
4. **Reversibility:** tag the true_owners minted in THIS pass with a distinct marker
   (`source='connectivity2_recorded_resolution'` or a `notes`/metadata batch tag — NOT the
   bare `h3_canonical_resolver`, which existing rows share) so the pass can be reverted
   (null the `recorded_owners.true_owner_id` back + delete the batch-tagged true_owners that
   no other row references). Fill-blanks only — never overwrite a recorded_owner that already
   has a `true_owner_id`, never touch a merged row.
- **Skip the 3 truly-dangling** (no property/sale/clinic/listing/oh/loan reference) — they're
  cleanup (audit #6), not resolution.
- **Cap the first batch (25)** → STOP for the gate → then drain (batched, e.g. 500/page).

## Unit 2 — confirm the downstream bridge actually fires
After resolution, confirm the newly-resolved true_owners become bridge-eligible and bridge in:
- Most will have **no active ownership_history** (they're referenced via
  `properties.recorded_owner_id`, not `ownership_history`) → `is_current_owner=false` → the
  **broad** tier. Confirm the steady-state cron covers the broad tier
  (`p_current_only=false`); if the scheduled cron only runs current-only, run one explicit
  broad bridge pass (`lcc_sync_bridge_eligible_owners('dia', false, …)` → finalize) so these
  actually bridge — otherwise resolution sets the FK but the entities never mint.
- Re-baseline: dia `recorded_owners` resolved 4,005 → ~6,843; dia true_owner bridge rises by
  the count of newly-eligible owners that pass the guard. Report the deltas.

## My gate (read-only, per pass)
- **Capped 25:** each resolved recorded_owner now points at a real true_owner (found-or-created
  correctly); no artifact/null-ish name was minted as a true_owner (guard held); the property
  chain is set; the batch true_owners carry the reversible tag; nothing pre-resolved was
  overwritten.
- **Drain:** resolved count rises to ~6,843; 0 artifact true_owners minted; spot-sample the
  new true_owners are real owners; the canonical-twin lane (from #1b) absorbs any
  near-duplicate names (no new dedup risk).
- **Bridge:** the newly-resolved owners actually appear in the entity graph
  (`bridge_source` / `external_identities(dia, true_owner)`), `owner_role='unknown'` (honest),
  reversible.

## Guardrails
- Receipts-first; capped → gate → drain; reversible (batch tag); fill-blanks only; never
  overwrite a curated `true_owner_id` or touch a merged row. **Reuse** the existing resolver +
  propagate path + the bridge view's guard — do NOT fork or hand-roll a second resolver.
  ≤12 api/*.js (this is DB-side; likely no api/*.js change). The classified cron still enriches
  `unknown`→real archetype on top.
- Net: ~2,838 dia properties whose owner is currently invisible get a resolved canonical owner
  that the (already-built) bridge makes visible to the entire BD graph — the natural next
  leverage step after #1.
