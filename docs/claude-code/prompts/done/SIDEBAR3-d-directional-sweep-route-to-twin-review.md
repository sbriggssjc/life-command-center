# SIDEBAR3-d — route the 85-pair directional sweep into the existing twin-review lane

## Context

`SIDEBAR3-c`'s live fleet sweep found 85 Dialysis_DB property pairs that share
state + street after folding leading directionals, where one side spells the
directional out (`South`, `West`, …) and the other doesn't or abbreviates it, with
overlapping ranges or civic numbers within 20 of each other. None were created
after `SIDEBAR2-b` shipped (2026-09-18) except `51252`, which was already merged
back live during `SIDEBAR3-c`'s own cleanup. Many of the 85 are very likely
genuine, separate, co-located clinics (a common real-world shape — two different
facilities on the same block) rather than address-parsing twins, so this is
explicitly **not** a merge list — do not auto-merge any of it.

This repo already has a real twin-review lane for exactly this kind of ambiguous
case: `dia_property_twin_review` (~1,245 rows already pending, per
`api/_shared/property-twin-assist-planner.js`), with its own classifier/assist
tooling in `api/admin.js` / `ops.js`. Re-read that machinery before doing anything
else — this prompt is about using it, not building a second one.

## Ask

1. Re-run the query from the `SIDEBAR3-c` STATUS entry (2026-09-22) to get the
   current, live 85-pair list (re-confirm the count hasn't changed).
2. Insert each pair into `dia_property_twin_review` in whatever shape that table
   and its existing tooling expect (read a handful of its current pending rows to
   confirm the expected columns/format before writing), tagged with something
   identifying this batch's source (e.g. a batch tag or note referencing
   `SIDEBAR3-d`) so it's traceable later.
3. Separately, this sweep surfaced one more thing worth a decision, not a fix:
   the range-address guard strips **any** leading directional, so opposite
   directions also read as "the same street" (`720 West Broadway` vs
   `730 E Broadway`) — this was already true before `SIDEBAR3-c` and is
   conservative (it can only cause an extra refusal, never a wrongful merge or
   auto-attach), so leave the guard's behavior alone. Just confirm in the response
   whether any of the 85 pairs are actually an opposite-directional case (as
   opposed to same-directional-different-spelling), since that's a distinct shape
   worth knowing the size of.
4. Do not merge, alias, or otherwise change any of the 85 properties' data —
   this prompt's only job is getting them into the existing review queue so a
   human (or the twin-review lane's own assisted workflow) can work through them
   at Scott's pace.

## Do not touch

- No merges. No `dia_merge_property_reversible()` calls. No address edits.
- The directional-stripping guard logic itself (`sameStreetRest` /
  `detectRangeAddressCollision`) — already correct and shipped in `SIDEBAR3-c`,
  not in scope here.
