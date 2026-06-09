# Claude Code prompt — R9: tier-0 shell predicate + chain phase 3(c)

Paste into Claude Code, run from the **life-command-center** repo. Two units,
ordered: Unit 1 is a small surgical fix with real consequences (the gate can
currently refuse prospect opportunities on mislabeled DEVELOPERS); Unit 2 is
the deferred chain-connection program that fuels the P0 developer band.

## Unit 1 — tier-0 only re-parents recorded-owner SHELLS (the developer fix)

R8's honest finding: dia tier-0 folded **Choice One Development** and
**Incommercial** (multi-property DEVELOPERS who *sold to* Elliott Bay) under
Elliott Bay as if they were its SPEs. Consequence with teeth: the R5/R8 gates
would refuse prospect opportunities and cadences on them — and developers are
exactly who the P0 band exists to prospect. Root cause: tier-0 matches "the
entity's current property's true_owner maps to a registered parent" with an
unordered LIMIT 1 — a portfolio LINK is not a control relationship.

**The doctrine predicate:** tier-0 may re-parent an entity ONLY when the
entity IS the recorded-owner shell on that property — i.e. the entity's name
matches `lcc_property_owner_facts.recorded_owner_name` (normalized compare;
reuse `lcc_normalize_entity_name`) for the same property row whose
`true_owner_name` maps to the registered parent. A shell is *on title*; a
developer who sold is neither on title nor controlled.

- Apply in BOTH places (they must stay in lock-step): the `t0` CTE in
  `lcc_resolve_buyer_parent` AND the tier-0 UNION branch in
  `v_lcc_buyer_spe_entities_live` (then refresh `lcc_buyer_spe_resolved` +
  `lcc_priority_queue_resolved`, ANALYZE).
- Replace the unordered LIMIT 1 with a deterministic pick (if multiple
  qualifying shell rows map to different parents — shouldn't happen for a
  true shell — prefer the parent with the most matching rows, tie-break by
  name; report any entity hitting that path).
- **Ground every membership change before/after** (this is an intended
  change, not byte-identical): expect Choice One / Incommercial to STOP
  resolving (back to their normal bands); gov FGF shells should be
  UNCHANGED (they are literal recorded owners — verify "WASHINGTON DC VI
  FGF, LLC" etc. still resolve to Boyd via the new predicate). For **EIG
  Wadsworth** — R8 noted recorded AND true owner are both Massmutual — ground
  whether the EIG entity is itself the recorded-owner shell; if it is not,
  dropping its tier-0 link is CORRECT (it stays P0.4 for human resolution) —
  report, don't force the old outcome.
- Regression: NGP refusal, Boyd parent_self, ARLINGTON stays P0.4, P-BUYER
  rollups recomputed and reported (counts will shift slightly — list which
  parents changed).

## Unit 2 — chain phase 3(c): connect the chain, classify the developer

The chain-completeness view + research generator (R6/R8) cover both domains
(gov 2,963 / dia 797 buyer-owned chains). Phase 3(c) makes the chain REAL in
the entity graph so the P0/P5 developer bands have fuel:

1. **Chain-owner connection worker** (admin.js sub-route, batch-capped,
   idempotent, value-prioritized by rent — start where the
   `trace_ownership_to_developer` research tasks already point):
   for each chain property, walk its historical owners (domain
   `ownership_history` + sales buyer/seller names) and ensure each owner is
   a connected LCC entity via the EXISTING `ensureEntityLink` path —
   canonical identity (`dia`/`gov` + `true_owner`/`asset` per R4-A), junk
   guards (`isJunkEntityName`, `isImplausiblePersonName`) so capture garbage
   never mints entities. Record per-property effects (entities created vs
   linked vs skipped-junk). GET = dry-run counts; POST = drain a batch.
2. **Developer classification (conservative):** where the chain's EARLIEST
   owner is identifiable AND evidence supports original development —
   `properties.developer` name matches (dia 304 / gov populated rows), or
   the earliest transfer is within ~2 years after `year_built` — set that
   entity's `owner_role='developer'` (or behavioral_override per the
   existing role machinery). NEVER reclassify a registered buyer parent as
   developer (role precedence: buyer registry wins). Report how many
   developer entities this creates/marks per domain — these feed P0/P5
   directly, so list the top 10 by portfolio rent for Scott's eyeball.
3. **Close the loop on research tasks:** when a property's chain becomes
   complete (developer identified + connected), auto-complete its open
   `trace_ownership_to_developer` task (status machinery as-is, note who/
   what). The chain view's `chain_complete` already flips — the sweep just
   reconciles tasks to it.
4. **Contacts ride existing machinery:** developer/owner entities that gain
   an SF account mapping get contacts via the (now-working)
   `find_contacts_by_account` flow op through the buyer-contact picker
   pattern; LLC owners flow through the existing SOS research queue. Do NOT
   build new contact scrapers this round — just ensure connected chain
   entities are eligible for those existing paths (canonical identities +
   not junk-flagged).

Anti-bloat + safety: the worker is the rematch-worker pattern (batch ≤100,
time-budgeted, idempotent, cooldown on repeated failures); entity creation
goes through every existing guard; zero hard-deletes; effects recorded.
Expect the first drain to mint a meaningful number of owner entities — report
totals and spot-check 5 against their domain rows.

## Verify + ship
- Unit 1: before/after membership diff grounded per entity named above; gov
  unchanged; refusal regressions pass; caches refreshed + ANALYZEd.
- Unit 2: one batch drained live per domain; 5 spot-checks; developer top-10
  list; research tasks reconciled for completed chains; junk guards
  demonstrated (a garbage owner name skipped, not minted).
- House rules: `node --check`; 12 functions; migrations idempotent (Unit 1
  is CREATE OR REPLACE — cache-or-live safe to apply immediately); crons
  after routes; context/metadata bounded; report per-unit status.
