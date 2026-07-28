# Entity Reconciliation — design spec (A1)

_2026-07-28. Break-out design note. BUILD 01 flagged 232 asset entities as ambiguous: a deal named
"Tenant - City - State" landed in a city with **multiple candidate assets at different addresses** and the
tenant token couldn't pick one, so the sync created a *placeholder* asset (never blocks — records the candidate
list in `metadata.ambiguous_resolution`). This specs how we resolve them._

## The data (measured)
- **232** flagged placeholder entities (246 deals — some carry >1 deal). 90 have 2–3 candidates, 142 have >3.
- **Only 15 are OPEN**; **7 are open AND Team-Briggs-owned.** The other **217 are closed/historical** backfill.
- Each candidate is a real, distinct property (e.g. "DaVita Dialysis - Conyers - GA" → `1501 Milstead Rd NE`
  vs `1901 Honey Creek Commons SE`). These are genuine different assets, not dup rows — the deal is about *one*.

## The core problem
The deal name carries only **city + state**; the candidates differ by **street address**. There is not enough
signal in the name to disambiguate — which is exactly why they were flagged. Resolution needs a disambiguating
signal the name doesn't have.

## Design — scope-first, two tiers

### Tier 1 — the 7 open TB deals: manual disambiguation NOW (tractable)
Only 7 open TB-owned flagged deals matter for live accuracy, and each is a one-pick decision. Don't build
machinery for 7 — **surface them with their candidate addresses, let Scott pick, execute the merges.** Minutes
of work, immediately correct. (Then the 8 other open non-TB ones if desired.)

### Tier 2 — the 217 closed + future flagged: automate via address (needs A5b)
For scale, capture the **SF Opportunity property address** (catalog **A5b**) onto the deal, then auto-reconcile:
normalize deal.address and each candidate.address, exact-match → auto-merge; fuzzy/none → review queue. Closed
historical deals are cosmetic (record-keeping), so this is background/lazy, not urgent.

## Merge mechanics (the reusable operation — same for manual or auto)
Given a flagged placeholder P and a chosen canonical candidate C:
1. **Repoint** every `bd_opportunities.entity_id = P` → `C`.
2. **Move** `activity_events` and `entity_relationships` (deal_party edges) from P → C (idempotent; skip dups).
3. **Retire P** — don't hard-delete; set `metadata.merged_into = C`, `metadata.reconciled_at`, keep the row so
   provenance/audit survives and the merge is reversible. (Aligns with the "no hard delete" safety rule.)
4. If **none** of the candidates is actually the deal's property (genuinely new asset), keep P as canonical and
   just clear the `ambiguous_resolution` flag (`metadata.reconciled = 'kept_as_new'`).
Expose as `POST /api/pipeline/reconcile-entity { placeholder_id, canonical_id | keep_new }` so both the manual
picks and the future auto-pass call one audited path.

## Decision knobs (Scott)
1. **Auto-merge confidence:** exact normalized-address match only (safe), or also fuzzy (street-number + street
   name)? Recommend exact-only auto; everything else → review.
2. **Closed-deal backlog:** reconcile the 217 closed at all, or leave them flagged as historical? Recommend
   leave lazy — reconcile a closed deal only if it's ever reopened or referenced.

## Recommended sequence
1. **Now:** Tier 1 — surface the 7 open TB flagged deals + candidates → Scott picks → run merges (manual, via the
   reconcile path). Restores live-backbone accuracy where it matters.
2. **Next:** ✅ **CONFIRMED 2026-07-28** — the SF Opportunity carries `Property_Address__c` (full) and
   `Property_Address_Line_1__c` (street), both Formula(Text). Build A5b to capture it (engine map + add the field
   to the "SF Deal → LCC Opportunity Sync" Get-records), which unlocks Tier-2 auto-reconcile and A5 address match.
   Note: existing 232 placeholders are already linked, so re-sync alone won't re-resolve them — Tier-2 needs the
   explicit `reconcile-entity` pass to move a linked deal from its placeholder to the address-matched candidate.
3. **Later/lazy:** auto-reconcile the closed backlog by address.
