# ACI-phase0 — three small hygiene fixes that unblock the owner-contact automation push

**Read first:** `docs/architecture/account-based-contact-intelligence.md` §§1-6 (the design, all four
tiers) and its new §7 (2026-09-10 status check + phased build plan — this prompt IS Phase 0 from that
plan) · `docs/architecture/tier0-owner-contact-system.md` (Tier 0's live objects and traps — read
before touching anything here, it is the sibling live system) · `docs/os/PLANNED-BACKLOG.md` §P3 rows
`AC1b`, `AC7`, `AC10`.

## Why these three, why now

Scott wants owner→contact linkage automated end to end with minimal human-in-the-loop, split by owner
type: individual/small-firm owners get deterministic linkage (Tier 0, mostly live), large institutional
buyers (REITs, funds) get a role-taxonomy treatment (Tiers 1-2, not yet built). Before building either
push forward, three small, independent, already-measured defects should close — each is cheap, each
would otherwise corrupt or understate the numbers the next phase measures against.

## 1. AC1b — close the university/public-body scope drift

`v_lcc_top_seller_prospects` and `v_lcc_owner_contact_decidability` call `lcc_owner_name_is_public_body`
directly instead of `lcc_owner_name_is_not_prospected` (which also excludes universities — Scott's
2026-08-26 decision, cost stated: GWU $23.8M + Georgetown $8.0M). Two one-line swaps. Verify by
re-running the count of university-named rows in each view before/after — should go to zero. Read
`tier0-owner-contact-system.md` §4 first; this is re-applying a decision already made, not re-litigating
it.

## 2. AC7 — merge the Andrew Pulliam duplicate

Two live `entities` rows are both named "Andrew Pulliam" (confirmed live 2026-09-10) — one carries 37
correspondence edges, the other 1. This is the exact worked example `account-based-contact-intelligence.md`
§2 uses to argue the whole design, so it should not itself be a duplicate. Merge through the existing
reversible `lcc_merge_entity` path — same single writer the C13g/OWN-T0e arc just finished confirming is
the only one that should ever touch this. Do not build a second merge path. Identify which is the
survivor by edge count and any Tier-0 pivot/sponsor-domain references already pointing at one of the two.

## 3. AC10 — promote an owner's already-linked person into `owner_contact_pivot`

`v_owner_contact_worklist` correctly excludes owners that already have a linked person (they need no
*acquisition*) — but nothing promotes that person into `owner_contact_pivot`, so the owner is suppressed
from the acquisition worklist AND invisible everywhere the pivot is read. Measured 2026-08-26 at 11
owners / $240.5M; **re-measure before fixing** — `owner_contact_pivot.active_contact_entity_id`
population has grown roughly 50x since that measurement (1,440 populated rows as of 2026-09-10 vs
"27 human attaches" in late August), so the suppressed-and-invisible count is almost certainly different
now. Build the counterpart promotion: when an owner has a linked person (via whatever edge Tier 0 or a
prior manual link already created) and no `owner_contact_pivot` row, create one with that person as
`active_contact_entity_id`. Forward-running, not a one-time backfill only — this needs to keep firing as
Tier 0 keeps linking new owners, or the gap reopens on every new link. Reversible, logged.

## 4. Guard + ship

Each of the three gets its own regression guard in the style of this repo's recent arcs (mutation-tested
where a writer changes: RED on the old behavior, green after). Do not combine the three into one
migration if their rollback paths differ — keep them separably revertible. Branch `build/aci-phase0`.

## 5. Ship + record

STATUS.md entry naming the corrected AC1b/AC10 counts as measured (not carried from August).
`PLANNED-BACKLOG.md` rows `AC1b`, `AC7`, `AC10` — mark ✅ only for what is actually deployed and guarded.
`account-based-contact-intelligence.md` §7b — update with the fresh AC10 count once known (the current
text flags it as stale-pending-remeasurement; replace that flag with the real number).

**Do not start Phase 1 or Phase 2 from the plan in §7c in this prompt** — those are separate, larger
builds (Tier 0 completion, then the REIT/fund role-taxonomy inference) and will be prompted separately
once this hygiene pass is confirmed live.
