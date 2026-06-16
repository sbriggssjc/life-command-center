# Claude Code prompt — TIER 4: connectivity (recorded-owner backfill + gov metric wiring + SF-link, grounded)

> From the deep-dive audit, the finale. The Tier-4 gate grounding (live) corrected the
> audit's first-pass numbers — same pattern as every tier. Priorities, in reality order:
> (1) the gov metric is a display bug, (2) dia recorded-owner is the big real gap,
> (3) SF-link is smaller + more uncertain than the "0%/30k" framing. Receipts-first; each
> unit gated; reversible; never overwrite curated data.

## Grounding (measured live)
- **gov recorded-owner = 67.6%** on the active universe (8,422 / 12,455) — NOT the 44%
  all-status number; the Tier-0 quarantine fixed the denominator. The Domain Health cell
  renders blank = a display/wiring bug, not missing data.
- **dia recorded-owner = 19.1%** (2,349 / 12,281) — a genuine gap of ~9,932 properties.
- **SF-link:** 2,484 entities already linked; match universe is only **2,008 SF Accounts**
  (+816 Contacts) in `external_identities`; **no SF-link backfill function/table exists**
  in the DB. ~18,850 entities are unlinked, but most are asset/owner-shell entities with no
  SF account — so the realistic link ceiling is bounded by the SF-account universe, not 30k.

## Unit 1 — wire the gov recorded-owner metric + re-baseline (quick win, do first)
- Fix the Domain Health "Property → recorded_owner" gov cell so it computes + displays
  (it's 67.6% active; currently blank). Whatever view/handler feeds that cell, add the gov
  leg.
- **Re-baseline ALL Domain Health coverage metrics on the post-quarantine ACTIVE universe**
  (exclude `status='archived'`), so gov coverage %, book count, etc. reflect the real
  enrichable universe, not the all-status denominator inflated by the 6,657 junk shells.
- Receipts: the gov recorded-owner cell shows ~67.6%; book/coverage denominators exclude
  archived; the numbers match a live SQL check.

## Unit 2 — recorded-owner LINKING backfill (grounded: link existing names, don't source)
**Grounding refuted the external-source premise.** CMS `owner_name` is the OPERATOR
(DaVita/Fresenius), not the landlord — it cannot fill `recorded_owner_id`. The dia shape
(live): 2,349 linked (19%); **3,344 carry a real `recorded_owner_name` but no linked owner
entity** (the clean win); 6,586 have no owner data at all. So Unit 2 is a LINKING job on
data we already have, not an external backfill.
- **Resolve the 3,344 `recorded_owner_name` → `recorded_owner_id`.** For each, find-or-
  create the `recorded_owners` entity from the name — **canonicalized + deduped**
  (`lcc_normalize_entity_name` / the existing recorded_owners machinery) with the
  **junk-name guards** (don't mint garbage owners) — then set `recorded_owner_id`.
  Fill-blanks ONLY (never touch a property that already has an id), provenance-tagged
  (`source='recorded_owner_name_resolution'`), reversible; conflicts → Decision Center.
  This raises dia linked coverage **19% → ~46%** using existing data, and ties 3,344
  properties into the owner/BD graph (the connectivity goal).
- Bounded ticks (geocode lesson), gentle on the pool. Capped batch first → I verify (only
  blank-id properties touched, owner entities canonicalized/deduped not junk, no curated id
  overwritten) → then the full resolution. Re-baseline coverage after.
- **DEFER the 6,586 no-owner-data properties** — external county/deed sourcing is a bigger,
  lower-confidence, source-dependent project. Document it as the follow-up, NOT this tier.
- gov: apply the same name→id resolution to any gov properties carrying an owner name but
  no id (secondary; report the count first).

## Unit 3 — SF-link: GROUNDED OUT to two real actions (no speculative backfill)
**Phase A (done, live) refuted the backfill premise.** The real SF-link ceiling needs the
LIVE Salesforce connector account dump (the full SF account universe is NOT in the DB — only
2,008 already-linked accounts are mirrored), so it's unknowable from the DB alone. The only
DB-visible match set is **275 entities**, and those are **entity-merge candidates** (dups of
entities already SF-linked), not new links.
- **Route the 275 to the entity-merge Decision Center lane for HUMAN review** (NOT
  auto-merge — Tier-2 doctrine). Merging each into its already-linked twin dedups the graph
  AND inherits the SF link. Real, bounded, on the consolidated merge surface.
- **DEFER the full SF-link backfill as a connector-dependent follow-up.** Do NOT build
  speculative match infrastructure for an unknown ceiling. Document it: when the live SF
  account universe is available via the connector, run a confidence-gated name+address match
  for genuine `organization` entities (skip asset/shell/junk), high-confidence →
  `ensureEntityLink (salesforce, Account)`, ambiguous → a disambiguation lane. Bounded by
  the SF-account universe, never the 30k.
- Receipts: the 275 surfaced in the merge lane (not auto-merged); the SF-link follow-up
  documented with the honest framing.

## My gate (per unit)
- Unit 1: gov cell shows ~67.6%; all coverage denominators exclude archived; matches SQL.
- Unit 2: capped owner backfill fills only blanks from the right source, no curated
  overwrite, conflicts surfaced; full drain re-baselines coverage.
- Unit 3: Phase A's realistic ceiling is honest (bounded by the SF-account universe);
  Phase B links are genuine matches, ambiguous routed to a lane, asset/shell skipped.

## Guardrails
- Receipts-first; gated per unit; reversible; fill-blanks only — never overwrite curated
  owners/links. Conflicts → Decision Center (the now-consolidated surface).
- Reuse the geocode-backfill pattern, `lcc_merge_field`/provenance, `ensureEntityLink`,
  the CMS-chain operator signal. Don't fork.
- ≤12 api/*.js. **Bump the `?v=` cache-bust** for any frontend (the metric cell) so it
  actually serves (the Tier-3 lesson).
- SF-link: be honest about the bounded ceiling; don't chase the 30k myth or force links.

## After Tier 4
The five-tier plan is complete: de-noised detectors (0–2), one consolidated review surface
(3), and real connectivity filled (4). Update the audit doc with the final connectivity
baselines and close the plan.
