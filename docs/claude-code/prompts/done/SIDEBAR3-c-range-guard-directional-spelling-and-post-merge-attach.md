# SIDEBAR3-c — range-address guard has a directional-spelling gap, and no attach path after a real merge

## Context

`SIDEBAR3` merged two genuine range-address twins live (`37640`→`22887` Kirkman Rd/Orlando,
`51243`→`28547` Washington Ave/Scranton) via `dia_merge_property_reversible()`, and part 3 of
that prompt asked Scott to re-send the four original CoStar properties (Goldsboro, Orlando,
Dixon, Scranton) to confirm the sends now land correctly post-merge.

Scott did that re-send 2026-09-22 (Orlando + Scranton, per `OPERATOR-CHECKLIST.md` Q41). Both
sends surfaced a **new** defect — not the one SIDEBAR3 fixed, a different failure mode of the
same `SIDEBAR2-b` guard (`detectRangeAddressCollision`, `api/_handlers/sidebar-pipeline.js` ~line
303-370):

## Finding 1 — the range guard silently missed Scranton because of a directional-spelling mismatch (live-reproduced, already cleaned up)

The Scranton re-send reported `success` in the sidebar UI, but it did **not** attach to the
merged canonical property `28547`. It minted a **brand-new property row, `51252`**, with the
exact same address shape (`920-1000 S Washington Ave`) that `51243` (the twin SIDEBAR3 just
merged away) used to have — i.e. it recreated the exact twin SIDEBAR3 just cleaned up.

Root cause, read directly in the guard's own normalizer:

```js
const norm = (x) => String(x || '').toLowerCase()
  .replace(/[.,]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^(n|s|e|w|ne|nw|se|sw)\s+/, '');
```

`sameStreetRest()` only strips a **single/double-letter abbreviated** leading directional
(`n`/`s`/`e`/`w`/`ne`/`nw`/`se`/`sw`). `28547`'s address in the DB is spelled out —
`"920 South Washington Ave"` — so its normalized rest is `"south washington ave"`. CoStar's
captured address uses the abbreviated form — `"920-1000 S Washington Ave"` — which strips to
`"washington ave"`. The two don't match, so `detectRangeAddressCollision` returns `null` (no
collision seen), the guard never fires, and the pipeline falls through to its normal
create-a-new-property path.

Contrast: Orlando's guard fired correctly, because both addresses use the abbreviated form
(`"S Kirkman Rd"` on both the capture and `22887`'s DB record), so `sameStreetRest` matched.

**This is a live regression risk beyond Scranton** — any property whose DB address spells out a
directional in full while CoStar sends the abbreviated form (or vice versa) is unprotected by
this guard today.

**Already cleaned up directly (Cowork, 2026-09-22, no code change needed for the cleanup
itself):** live-verified `51252` held 1 sale row and 0 leases; merged it back into `28547` via
`dia_merge_property_reversible(28547, 51252, 'sidebar3_scranton_resend_accidental_dup_20260922')`
(backup_id 598, reversible). Live-reconfirmed: `51252` no longer exists, `28547` now holds 2
leases (unchanged) and 3 sales (was 2, +1 from the folded-in duplicate).

**Ask:** fix `sameStreetRest()`'s normalizer to also strip full spelled-out directionals
(`north`/`south`/`east`/`west`, and probably `northeast`/`northwest`/`southeast`/`southwest`) in
addition to the existing abbreviated set — same function, same guard, just complete the token
list. Add a regression test asserting `"South Washington Ave"` and `"S Washington Ave"` normalize
identically (and the NE/NW/SE/SW spelled-out forms too). Then run a live fleet scan (candidate
addresses vs any pending/queued sidebar captures, or just a one-time paired-directional-spelling
sweep across `properties.address`) to see whether this gap has already minted other silent twins
since `SIDEBAR2-b` shipped (2026-09-18) — if so, size and list them for review, don't auto-merge.

## Finding 2 — the guard has no attach path once the near-miss candidate IS the correct, already-merged property

Orlando's re-send correctly triggered the guard and was refused:

> Captured address "4550-4666 S Kirkman Rd" is a near-miss (range_containment) of existing
> property_id=22887 address "4578 S Kirkman Rd"; refusing to create a twin property. Needs human
> review — see property-identity-and-address-resolution.md.

This is the guard working as designed for a **genuinely unknown** near-miss. But here the
near-miss candidate, `22887`, is not an unknown risk — it is the exact property SIDEBAR3 already
merged this same range address into, with a completed, ledgered, human-reviewed merge on file:
`dia_property_merge_backup` row for batch `sidebar3_kirkman_20260922`
(`dropped_property_id=37640`, `kept_property_id=22887`), and `37640`'s address before the merge
was this exact captured range, `"4550-4666 S Kirkman Rd"`.

Right now there is no way for Scott to ever complete this re-send — every future capture of this
same CoStar listing will refuse forever, because the guard has no memory of the merge decision
already made. The doctrine cited in the guard's own comment (never invent new fuzzy-identity
matching, route ambiguity to human review) is right, but checking `dia_property_merge_backup` for
an **already-completed, already-reviewed** merge is not inventing a new identity decision — it's
recognizing one a human already made and executed, which is a narrower, safer exception than
anything the guard's comment warns against.

**Ask:** when `detectRangeAddressCollision` would refuse a create, before returning the refusal,
check whether `dia_property_merge_backup` has an un-reversed (`unmerged_at IS NULL`) row whose
`kept_property_id` matches the near-miss candidate and whose backed-up `row_json.address` (the
dropped property's address at merge time) matches the captured address under the same
`detectRangeAddressCollision` logic. If so, treat it as confirmation, not refusal: attach/update
the captured data onto `kept_property_id` instead of refusing. If no matching merge-backup row is
found, refuse exactly as today (unchanged default). Same dialysis-domain scope as `SIDEBAR2-b`/
`SIDEBAR3`; no new identity heuristics, just consulting a decision that's already on the ledger.

Once shipped, Scott can re-send Orlando (`22887`) a second time to confirm it now attaches
instead of refusing.

## Do not touch

- `person_junk_name`, `email_fanout`, or any misparse-disposition logic — unrelated.
- The refuse-on-create behavior for an address collision with NO matching merge-backup row —
  that must stay a refusal, not an auto-attach guess.
