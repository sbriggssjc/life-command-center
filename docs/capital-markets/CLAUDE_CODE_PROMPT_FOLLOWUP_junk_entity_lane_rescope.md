# Claude Code prompt — FOLLOW-UP: re-scope the junk_entity_name lane (auto-retype mistyped orgs)

> Post-five-tier follow-up. The `junk_entity_name` Decision Center lane (758) is the biggest
> remaining "needs you" lane — and the gate grounding found it's the same over-firing
> pattern at its most consequential: **~83% are legitimate ORGANIZATIONS mistyped as
> persons, not junk.** Being junk-flagged holds them OUT of the BD graph (junk-flagged
> entities are excluded from the priority-queue bands), so this isn't cosmetic — it's
> recovering real owner/firm entities. Receipts-first; gated; reversible; never hard-delete.

## Grounding (measured live, LCC Opps)
Of the 758 open `junk_entity_name` entities (`metadata.junk_name_flagged=true`, not reviewed):
- **631 carry an org/firm suffix** (LLC/LP/LLP/Inc/Corp/Co/Company/Trust/Fund/Capital/
  Partners/Properties/Realty/Group/Holdings/Bank/Associates/Management/Ventures/REIT/
  Enterprises/Investments/Advisors/Development/Equities…) but are typed `person` —
  unambiguous ORGANIZATIONS mistyped (e.g. "Carr Properties", "Westbrook Real Estate Fund X",
  "SNH Medical Office Properties", "Gardner Tanenbaum Holdings", "Farmers Savings Bank &
  Trust"). NOT junk.
- **47 composite** `Firm | Person` names (`junk_name_source` ~ composite) → a split action.
- **81 true junk** (street fragments like "West Mall Dr", tenant-mix bleed) → genuine.
- 602 are typed `person`; the flag source is overwhelmingly `r7_phase2_5_person_plausibility`
  (a guard meant to reject capture artifacts mistyped as PERSONS — but it junk-flagged real
  firm names instead of retyping them).

## Unit 1 — auto-retype the ~631 mistyped orgs → organization (recover them)
Extend the R10 Unit-3a retype (which only handled cadence-bearing persons) to ALL junk-
flagged `person` entities whose NAME carries an unambiguous firm/org suffix:
- Set `entity_type='organization'`, **clear `junk_name_flagged`** (and any band-exclusion),
  stash the prior type + the flag in `metadata.retyped_from` / `retype_source='followup_
  junk_lane_rescope'` (reversible, never hard-delete).
- **Conservative suffix list only** — a clear firm suffix a human name never has. A bare
  surname word like "Trust"/"Group" with no other org marker is fine to retype (a person
  isn't "X Trust"), but if in doubt, leave it for the (now-tiny) manual lane.
- This recovers ~631 legitimate organization entities into the BD graph (priority queue,
  ownership, connectivity) — they were soft-excluded as junk.
- Receipts: count retyped; spot-sample confirms they're real orgs; they now appear in the
  org-entity universe / are no longer excluded from the bands.

## Unit 2 — fix the guard so it can't re-accrue
`isImplausiblePersonName` / the `r7_phase2_5_person_plausibility` path: when a name has a
firm/org suffix, the right action is **retype to organization**, NOT junk-flag. Change the
guard (at the `ensureEntityLink` choke point) so a firm-suffixed inferred-person is created
as an `organization` (or retyped), not flagged junk. Keep the TRUE junk rejection (street
fragments, phone/email, deal strings, panel bleed, CMBS codes) unchanged.
- Receipts: a new firm-suffixed capture mints/【retypes to】 an organization, not a junk flag;
  a true-garbage capture still rejects.

## Unit 3 — the residue (small, gated)
- **81 true junk** (street fragments / tenant-mix) → quarantine (keep flagged, mark a
  terminal `junk_confirmed` so they leave the active lane but stay reversible) — these are
  genuine. NOT deleted.
- **47 composite `Firm | Person`** → route to a small split action (a Decision Center
  sub-lane or a split helper that creates the firm + the person and links them). Lower
  priority; can be deferred + documented if you'd rather.
- Net: the `junk_entity_name` lane collapses from 758 to ~0 genuine human decisions; ~631
  orgs recovered; the guard stops re-accruing.

## My gate (read-only, per unit)
- Unit 1: the retyped set is real orgs (sample), entity_type flipped, junk flag cleared,
  reversible (metadata stashed); they re-enter the BD graph; no genuine person wrongly
  retyped.
- Unit 2: a firm-suffixed capture no longer junk-flags; true garbage still rejected.
- Unit 3: 81 true junk confirmed-junk (reversible), composites routed.

## Guardrails
- Receipts-first; gated; reversible (metadata stash, never hard-delete). Conservative suffix
  list — when ambiguous, leave for the manual lane, don't auto-retype a maybe-person.
- Reuse `ensureEntityLink` / the R10 retype pattern / `lcc_normalize_entity_name`; don't
  fork. ≤12 api/*.js. Bump the `?v=` cache-bust if any frontend (the lane render) changes.
- This is the same doctrine as every tier: an over-firing detector's output is mostly not
  human work — auto-resolve the clear class (retype), quarantine the true junk, leave a tiny
  genuine residue.
