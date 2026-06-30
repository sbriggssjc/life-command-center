# Claude Code (life-command-center) — merge lane: clear the SF-corroborated pinned dupes + show/choose the survivor

## Why (grounded live on LCC Opps 2026-06-29)

We safely bulk-merged 651 duplicate-entity groups (auto + raw-name-gated SF). The
"Duplicate entities — merge" lane still shows ~2,900 cards that are clearly the same
name (Hutton Company LLC, GIC Real Estate, First Republic Bank, Dialysis Clinic Inc,
Healthcare Associates LLC, The Daniel Group Inc…). Two real issues Scott surfaced:

1. **The clear ones are stuck behind an over-conservative pin.** Those cards are
   `review_reason='bridged_unknown_pinned'` — held because each member bridges to
   multiple dia/gov `true_owner` records with `owner_role='unknown'` (the
   connectivity #1b gate won't merge bridged-but-unresolved owners). But of the
   1,904 pinned groups, **469 are `raw_name_compatible=true` AND
   `distinct_sf_accounts=1`** — same name + one Salesforce account. For that class,
   the multiple domain bridges are almost certainly the SAME owner captured
   repeatedly, so the pin is over-holding genuine dupes. (39 pinned groups are
   `raw_name_compatible=false` — e.g. "Excelsior Capital" grouping a distinct-name
   member — those must STAY held.)
2. **The operator can't see or choose the survivor.** The card says "3 duplicates
   collapse into this survivor" but never shows WHICH entity wins or lets you
   override. The survivor is auto-chosen (role → portfolio → longest name → id);
   that's invisible.

## Unit 1 — widen the safe auto-merge to SF-corroborated, name-compatible pinned groups

Extend the `auto_mergeable` predicate (or add a clearly-named second safe tier) in
`v_lcc_merge_candidates` so a `bridged_unknown_pinned` group ALSO qualifies when:
`raw_name_compatible = true` AND `distinct_sf_accounts = 1` (one real SF account) —
i.e. same-name + single-SF-corroborated. This is the ~469 set. Keep the pin for
everything else (name-incompatible, 0 or >1 SF accounts, no SF corroboration).

**Bridge-safety (the reason for the pin — handle it explicitly, don't just bypass):**
when such a group merges, `lcc_merge_entity` moves all members' `external_identities`
(including the multiple `true_owner` bridges) onto the survivor. Confirm that's the
intended outcome — the survivor legitimately carries the same owner's repeated
domain bridges — and that the owner-facts / R6 resolver tolerates a survivor with
multiple `true_owner` identities (it should pick the canonical one). If co-bridging
distinct true_owners would actually corrupt resolution, add a guard that the group's
domain true_owners are themselves dup-compatible (same normalized owner name) before
qualifying. Verify with the connectivity-#1b rationale before flipping these — the
pin was deliberate; the goal is a careful, evidence-based widening for the
high-confidence subset, not removing the guard.

Then re-run `lcc_apply_fuzzy_merges(dry_run, limit)` (reads `auto_mergeable`,
unchanged): **dry-run first**, confirm the ~469 are in and the name-incompatible /
multi-SF / multi-owner ones are NOT, eyeball a sample, then apply. Reversible via the
`merged_into` tombstone. Refresh the three caches after (the R40 post-merge step).

## Unit 2 — surface + allow overriding the survivor on the merge card

In the merge-lane card (`ops.js`):
- **Show the chosen survivor** explicitly ("Merging into: <survivor name>") and list
  the duplicates being collapsed, so it's transparent which entity wins. The survivor
  is the view's winner (role → portfolio → longest name → id); expose `winner_name` +
  the loser names on the card.
- **Allow override:** a small control to pick a different member as the survivor
  before clicking "Merge duplicates" (e.g., a dropdown of the group's members). The
  verdict then passes the chosen `winner_id`; the merge runs `lcc_merge_entity(loser,
  chosen_winner)` for the others. If exposing per-member detail is heavy, at minimum
  SHOW the survivor (transparency) and add the override as a fast-follow.
- This directly answers "are we unable to see who to merge into" — yes today; this
  makes it visible + choosable.

## Boundaries / verify

- life-command-center; `v_lcc_merge_candidates` predicate (DB, additive) + `ops.js`
  card; reuse `lcc_apply_fuzzy_merges` + `lcc_merge_entity` (reversible); no new
  api/*.js. The verdict endpoint may need to accept an optional `winner_id` override
  (admin.js `decision-verdict` merge branch) — additive, defaults to the view's
  winner.
- **Verify:** dry-run shows ~469 newly-qualifying (name-compatible + single-SF
  pinned), Excelsior-type (name-incompatible) + multi-SF excluded; a sample merge
  carries the survivor's SF link + consolidates bridges without breaking owner-facts
  resolution; the card shows the survivor and an override changes the target; caches
  rebuild clean.

## Bottom line

The clear same-name dupes you're seeing are held only by an over-cautious bridge pin
— widen the safe gate to the 469 single-SF-account, name-compatible ones (carefully,
respecting why the pin exists), and the lane clears most of what's left. And make the
survivor visible + choosable on each card so "who to merge into" is no longer hidden.
The genuinely-ambiguous (name-incompatible, multi-owner, multi-SF) correctly stay for
review.
