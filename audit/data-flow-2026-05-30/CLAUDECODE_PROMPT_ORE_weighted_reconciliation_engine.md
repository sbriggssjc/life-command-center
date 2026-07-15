# Claude Code (LCC) — ORE: the multi-signal, authority-weighted reconciliation engine

## Why (Scott's core doctrine, 2026-07-15 — see `ORE_REALIGNMENT_first_principles_2026-07-15.md` §7)

Manual ownership reconciliation never trusts one source — it triangulates identity from
**every available clue**, weighting the more authoritative ones: a phone number, a name
+ city/state, a mailing address, an email, a naming convention are each *evidence* that
links records. Two owner records that share a phone, or a name-core + city/state, or a
mailing address, are the **same party** even when no single field is authoritative. The
system must do this automatically. Today it reconciles single-signal + rule-based (deed
grantee overrides recorded owner; R6 name-match; provenance ranks one field at a time),
which misses the human move — **confirming identity from the agreement of multiple weak
signals** — and lets noisy fields (junk/placeholder `true_owner` values, operators
mis-typed as sponsors, AI-verbose strings) drive resolution.

This engine is the layer UNDERNEATH the two-tier routing (Tier A institution registry /
Tier B public records). It runs across ALL owners, continuously, and improves every time
a new clue (deed, SOS, CoStar, OM, SF) lands — an `unresolvable` owner gets promoted the
moment a phone or address links it, with no new fetch.

**Reuse, don't rebuild.** The primitives exist: `lcc_merge_entity` (reversible merge with
full backref move), the R39/R40 dedup + email-key + `lcc_reusable_owner_contacts`, the
cross-reference resolver (`lcc_resolve_owner_cross_reference`), `field_source_priority`
(the authority ledger), R6 `lcc_resolve_owner_parent`, the entity-link guards
(junk/implausible/federal/operator). This round *composes* them into one weighted
resolver + records the evidence trace. Discipline: additive · reversible · provenance-
tagged · guarded · surface-ambiguity-never-guess · ≤12 api/*.js.

## Unit 1 — the evidence model (signals + authority weights)

Define, in one place, the **signal set** and the **authority hierarchy** used everywhere:
- **Signals (linkage keys), each normalized:** owner name + name-core (legal-suffix-
  stripped); mailing/notice address (normalized); phone (digits); email (normalized);
  city/state; naming convention/pattern; deed grantee; `true_owner`; SF account id;
  CoStar owner-panel parent; sales buyer; GSA lessor.
- **Authority weights (single source of truth — extend `field_source_priority`'s ranks,
  don't invent a parallel scale):** manual/curated (highest) > recorded deed/county >
  SOS registration > CoStar/RCA aggregator + `true_owner` field > naming-only inference
  (lowest). Encode as a small weight table keyed by signal-source so the score is tunable
  and auditable.
- **Match rule:** two records/owners are the *same party* when the **weighted sum of
  agreeing signals** clears a threshold. A single high-authority agreement (shared
  deed/county-confirmed owner) clears it alone; several low-authority agreements (shared
  phone + name-core + city/state) also clear it — the human move. A **high-authority
  CONFLICT** (two different deed/county owners) blocks auto-merge → review.

## Unit 2 — the resolver (cluster → canonical party → best contact)

`lcc_reconcile_owner(entity_id)` (+ a batch/tick worker, sub-route of operations.js — no
new api/*.js): for a target owner, gather its evidence set, find candidate same-party
records/entities by ANY signal, score each candidate by weighted agreement, and:
- **Cluster** the records whose weighted evidence clears the threshold into one canonical
  party (prefer the highest-authority name as canonical; a case-variant/dup like
  `CP-MIDWAY…` vs `Cp-Midway…` merges on name-core).
- **Resolve the sponsor** where the evidence points to a parent: prefer the in-data
  `true_owner` sponsor (Tier A Unit 0), validated against the other signals — an
  SPE-shaped `true_owner` with a firm-shaped `recorded_owner` is likely **inverted**
  (flag, don't trust); a junk/placeholder/operator `true_owner` (`John Doe`,
  `Independent`, `U.S. Renal Care`) is rejected by the guards, not used.
- **Attach the best contact from anywhere in the cluster** (a phone/email/person on any
  member record resolves the whole cluster) via the existing contact-attach helpers;
  fan across the portfolio (cross-reference resolver).
- **Consolidate** true duplicates via `lcc_merge_entity` (reversible). Genuine ambiguity
  (conflicting high-authority signals, or an inversion) → the Decision-Center
  `resolve_ownership` / a review lane, never a guess.
- **Record the evidence trace:** which signals agreed, at what weight, from what source —
  so every resolution is grounded + traceable + reversible (this is the literal form of
  "grounded truth we can follow back to the source").

## Unit 3 — clean the `true_owner` noise (the reconciler's first job)

Run the resolver over the `true_owner`-fed clusters that Tier A exposed and clean them,
reversibly:
- **Placeholder/junk sponsors** (`John Doe`, `Independent`, blank, numeric) → filter out
  (extend the entity junk guards; do NOT let them seed the registry or a cluster).
- **Operators mis-typed as sponsors** (dia `U.S. Renal Care`, DaVita, Fresenius, American
  Renal — the R8 artifact) → add to the operator-exclusion list the resolver + registry
  already consult; an operator is never an owner-sponsor.
- **AI-verbose `true_owner` strings** (`TIAA (Teachers Insurance…)`, `… or related
  stakeholders`) → canonicalize to the core institution name (name-core), so the same
  sponsor doesn't fragment into multiple clusters.
- **Inversions** (recorded=firm ↔ true_owner=SPE) → flag for review (conflicting-
  authority), don't auto-flip.
All reversible + provenance-tagged; the goal is a clean sponsor→SPE map feeding Tier A.

## Unit 4 — continuous re-triangulation (the self-improving loop)

Wire the resolver to re-run for an owner whenever a **new clue lands** (a deed OCR
grantee/address, an SOS manager, a CoStar owner phone/email, an OM party, an SF match) —
so `unresolvable` owners get promoted automatically as evidence accumulates, no manual
re-kick. Reuse the existing producers (deed `document-text-tick` propagation, the sync
crons); add a lightweight "owner touched → reconcile" trigger/queue. Bounded, idempotent,
value-ranked. This is what makes the truth converge over time instead of going stale.

## Boundaries / verify
- LCC-Opps orchestration (the resolver + evidence trace + cleanup); domain writes only
  through the existing provenance path. Additive · reversible (drop the reconcile output +
  undo merges via the `merged_into` tombstones) · provenance-tagged · guarded · no
  fabrication · no fetching · no paid API · ≤12 api/*.js.
- **Verify (dry-run first):** on a sample of high-value owners, the resolver clusters the
  case-dups, rejects the junk/operator `true_owner` values, canonicalizes the verbose
  ones, flags the inversion (`IGIS Asset Management` ↔ `810 Seventh Avenue SPE LLC`), and
  attaches a cluster contact where one exists — each with an inspectable evidence trace
  (which signals agreed, at what weight). Spot-check 5 resolutions back to source.
  Ambiguous/conflicting → review lane, never an auto-merge.

## Bottom line
Build reconciliation the way Scott does it by hand: gather every clue, weight by source
authority, and converge on the true owner + contact from the *agreement* of the evidence —
cleaning the noisy `true_owner` field as it goes, fanning one resolved contact across the
portfolio, re-triangulating as new clues arrive, and surfacing only genuine conflicts for
a human. That is the engine that makes ownership truth automatic, accurate, and traceable
across the whole book — the layer the Tier A registry and the Tier B fetchers both sit on.
