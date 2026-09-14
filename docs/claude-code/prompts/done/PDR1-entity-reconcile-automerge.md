# PDR1-entity-reconcile-automerge — auto-merge the clear Salesforce-sync duplicates, queue the rest

**Read first:** `docs/os/PLANNED-BACKLOG.md` §P17 (PDR1 — the DaVita/Donna-TX case that surfaced this)
and §P13 fork 1 (the same population, found from the fleet-wide side, with Scott's decision recorded:
**auto-merge on best match + review queue**) · `docs/architecture/entity-reconciliation-design.md` ·
`mcp/entity-reconcile.js` (the existing `list_flagged_open_deals` / `reconcile_entity` RPC pair — reuse
both, do not build a parallel merge path) · `dc-lanes.js` / `admin.js`'s `FEDERATED_DECISION_TYPES` /
`_DC_FED_META` (the Decision Center lane pattern — `C13g-min-lane` and `OWN-T0e`'s
`sponsor_family_confirm` are the two most recent worked examples of "planner decides the verdict shape,
one write, ledger-before-write, reversible").

## Why this, why now

Scott's own DaVita/Donna-TX property review turned out to be one instance of a decision fork he'd
already reserved for himself (`PLANNED-BACKLOG.md` P13 #1). Re-measured live 2026-09-10: **189**
`entities` rows carry `metadata.ambiguous_resolution` (down from the August-audit's 232 — 43 resolved
by ad hoc sweeps since), **116** of them also `orphan_flagged`, all minted in one **2026-07-28 to
2026-08-04** Salesforce opportunity-sync burst — nothing since, so this is a closed, measured
population, not an open-ended stream. Candidate-list size ranges **2 to 55** per entity (median in the
single digits). Scott's decision: **auto-merge the clear cases, queue the rest for review** — not
require manual confirmation for all 189, not defer indefinitely.

## 1. Score each ambiguous entity's candidates — one planner, two consumers

Write a pure planner (`api/_shared/ambiguous-entity-merge-planner.js` or similar) that, given a
placeholder entity's `metadata.ambiguous_resolution` candidate list, scores each candidate and returns
either a single **auto-mergeable** winner (high confidence) or **needs_human** (no clear winner).
Ground the scoring in what DaVita/Donna-TX actually showed, not guessed heuristics:
- A candidate with **no address at all** (a bare city-name placeholder, e.g. `"Donna, TX"`) is never
  the merge target when another candidate has a real address.
- Prefer the candidate with a populated, **normalized** address (`normalized_address IS NOT NULL`)
  over one with an address but no normalization — the un-normalized `3c2dc7d3…`-shaped duplicate from
  PDR1 should lose to the normalized one, not tie with it.
- Prefer the candidate carrying more real signal — existing `entity_relationships`,
  `lcc_entity_portfolio_facts`, or external identities — over a thinner one, when address quality ties.
- **Define and justify a concrete "auto-mergeable" threshold** (e.g. exactly one candidate clears the
  above checks with no other candidate close behind) — measure how many of the 189 clear it before
  wiring the write path, the same way AC10/every value-gated writer in this repo sized its population
  before shipping. Report the real split (N auto-mergeable / N needs_human), don't assume it.

## 2. Auto-merge path — reuse `reconcile_entity`, do not build a second merge writer

For entities the planner marks auto-mergeable: call the existing `POST /api/pipeline/reconcile-entity`
(`rpc/reconcile_entity`, already atomic — repoints `bd_opportunities`, moves `activity_events` +
`deal_party` edges, retires the placeholder to a reversible tombstone). Wrap it in a value-gated,
flag-gated tick (mirror `bench-rank-tick.js`'s or `tier0-auto-attach-tick.js`'s shape: GET dry-run
ungated, POST gated behind a new flag, ledger row written before every merge call). **Do not lower the
bar to hit a bigger auto-merge number** — a wrong auto-merge here corrupts `bd_opportunities`/
`activity_events`/`deal_party`, unlike a wrong Tier-0 contact attach. If the honest threshold only
clears a small fraction of 189, say so and ship that, the same discipline `AC11`/`PR-scanner-3` used
when a population came back smaller than hoped.

## 3. Review-queue path — a new Decision Center lane, not a parallel UI

For entities the planner marks `needs_human`: surface them through a new federated lane (pick a
`decision_type`, e.g. `ambiguous_entity_resolution`) in both `FEDERATED_DECISION_TYPES` and
`_DC_FED_META`, card showing the placeholder + its scored candidate list (best-to-worst, per the same
planner output), verdicts `merge` (repoint to the human-chosen candidate) / `keep_new` (genuinely a new
asset) — both routed through the SAME `reconcile_entity` call the auto-merge path uses, never a second
writer. Reuse `list_flagged_open_deals` (already live, already TB-scoped) as the card population source
rather than re-deriving one.

## 4. DaVita/Donna-TX specifically

This property's own placeholder (`8d1fd46e-3524-476e-946e-eb33d683820d`) should resolve as part of
whichever path the scoring assigns it to — verify directly which path it lands in and what it merges
to, and confirm live that the property's Ownership/Deal History/Documents/Activity Log tabs (PDR2,
PDR3, PDR4, PDR7 in §P17) actually populate once merged. If they don't, that's a second, real gap
behind the entity link — report it, don't assume the merge alone fixes everything downstream.

## 5. What NOT to do in this pass

- Do not touch the un-normalized-address / city-casing defect (PDR1c) or the Chicago-broker-address
  mistagging (PDR10) — separate, smaller data-quality fixes, filed on their own.
- Do not build a recurring cron for *future* ambiguous entities — the population is closed (nothing
  minted since 2026-08-04); if the Salesforce sync starts producing more, that's a new, separate
  measurement before any recurring drain is justified.
- Do not attempt PDR5 (rent roll) or PDR8 (competitive-landscape financials) — unrelated to this gap.

## Guard + ship

Mutation-guarded planner tests (a bare-placeholder candidate never wins over an addressed one; a
non-normalized address loses to a normalized one on tie-break; the threshold correctly abstains when
two candidates are close). Positive control using DaVita/Donna-TX's own three real candidates as fixture
data. The merge write path needs a rollback-tested positive control (merge, verify the reversible
tombstone, unmerge) mirroring how `lcc_merge_entity`/`lcc_unmerge_entity` round-trips were proven
elsewhere in this repo — `reconcile_entity`'s own reversibility should be confirmed live, not assumed
from its comment.

## Ship + record

Branch `build/pdr1-entity-reconcile-automerge`. STATUS.md entry naming the real auto-mergeable /
needs_human split. `PLANNED-BACKLOG.md` — P13 fork 1 marked decided-and-built (not deleted, corrected
in place per doctrine), P17/PDR1 updated with the outcome, PDR2/3/4/6/7/9 (marked "depends on PDR1" in
the current backlog) re-checked against DaVita's own resolution and updated from assumption to
measured fact.
