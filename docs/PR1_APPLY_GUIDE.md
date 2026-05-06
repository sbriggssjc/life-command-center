# PR #1 — Pending Updates UX, Tier 1 — apply guide

This branch carries the first round of Pending Updates UX fixes drawn
from `docs/PENDING_UPDATES_UX_FRICTION_LOG.md`. It comes in two pieces:

1. **`styles-round-76bj.css`** — already committed on this branch
   (commit `419858c`). Adds two CSS rules: `.pu-detail-recid` and
   `.pu-link-pick-placeholder`.
2. **`docs/PR1_pending_updates_ux.patch`** — a 226-line unified diff
   against `gov.js` (commit `6df79fd`). You apply it locally because
   the working environment that produced this PR can't push an
   8.5K-line file through a single MCP call.

## Why a patch instead of a direct commit?

The harness Claude was running in caps tool inputs / outputs at a size
that's smaller than `gov.js` (≈432 KB, 8.5K lines). Edits applied fine
to a working copy, but pushing the rewritten file back through the
GitHub MCP would have required re-emitting all 432 KB as a single
parameter. The patch is the fast workaround: 13 KB, easy to read, easy
to apply.

When the truncation issue in `styles.css` (mentioned in
`styles-round-76bj.css` header) is fixed, that's a good moment to
also revisit whether large JS files should split. Out of scope here.

## Apply

```bash
git fetch origin
git checkout claude/dashboard-human-review-6nnMg
git pull
git apply --check docs/PR1_pending_updates_ux.patch
git apply docs/PR1_pending_updates_ux.patch
git add gov.js
git commit -m "gov: Pending Updates Tier 1 — kind-aware approve, link_pick, record_id, test-row filter

- Add taxonomy.kind ('field_change' / 'sale_link' / 'link_pick') to
  unify the rendering and bulk-approve gating.
- Add gsa_property_link_review and link_review category; alias the
  sale_property_link_unrepresented_street_public_inventory_gap typo.
- Suppress empty (NULL -> NULL) diff on link_pick reasons; show a
  placeholder steering the reviewer to Reject / Skip until PR #2
  lands the candidate picker.
- Reason-aware Approve: bulkApproveGovPending and the A keybind only
  act on field_change rows. link_pick rows have no Approve button.
- Surface a clickable record_id chip in the detail header.
- Drop empty-shell test fixtures (subject starts with Test) from
  the queue at load time.

See docs/PR1_APPLY_GUIDE.md and docs/PENDING_UPDATES_UX_FRICTION_LOG.md."
git push
```

## Sanity-check checklist after apply

Run these in order. Anything that looks wrong, stop and ask before
proceeding.

### Static checks

```bash
node --check gov.js                 # must print nothing (i.e. parse OK)
grep -c "tax\.kind" gov.js          # expect 7
grep -c "tax\.category !== 'sale_link'" gov.js  # expect 0 (gone)
grep -c "kind: 'link_pick'" gov.js  # expect 4
grep -c "GOV_PENDING_REASON_ALIASES" gov.js     # expect 2
grep -c "govIsLikelyTestRow" gov.js              # expect 2
grep -c "pu-link-pick-placeholder" gov.js        # expect 1
grep -c "pu-detail-recid" gov.js                 # expect 1
```

### Browser checks (deploy first)

Open Government → Research → Pending Updates and verify:

- [ ] **The "Test intake email for GovernmentProject" row is gone** from
      the All chip count. Queue total drops by 1 (was 544).
- [ ] **A new chip "Link Review (33)"** appears next to Intake Review,
      and the Other chip count drops by 33.
- [ ] **`gsa_property_link_review` cards** now show a real title
      ("GSA → Property Link Review") and real guidance text, no longer
      the "No guidance defined…" fallback.
- [ ] **`unmatched_property` and `gsa_property_link_review` cards**
      now render the dashed-border placeholder block instead of the
      empty `(empty) → (empty)` Current/Proposed cells.
- [ ] **No green Approve button** on those cards. Reject, Skip, Expire
      remain.
- [ ] **Pressing `A`** while a `link_pick` card is selected shows the
      toast "No proposed value yet — press R to reject, or S to skip".
- [ ] **Bulk approve count** in the action bar drops to only the
      field_change rows ≥80% confidence (will probably be small —
      most of the high-confidence empties are the test-shell rows we
      just filtered out).
- [ ] **`record_id` chip** appears in the detail header next to the
      `table.field` chip. Clicking it shows a "record_id copied" toast.
      Paste-test in a separate textbox.
- [ ] **`ownership_discrepancy` cards** are unchanged: the standard
      old → new diff still renders; the green Approve button still
      appears.
- [ ] **Sale-Link Resolver cards** (`sale_property_link_*`) are
      unchanged: candidates list, GSA inventory hits, Create-new-property
      form all render. No Approve button (still uses Link → / Create &
      link).
- [ ] **Keyboard shortcut hint strip** ("J/K next/prev · A approve · R
      reject · S skip") is still accurate. (It is — only the conditions
      under which `A` is honoured changed; the labels stand.)

### Edge cases

- [ ] A real intake whose subject happens to start with "Testimonial"
      or "Test Pilot Air Base" must NOT be hidden. The filter requires
      `\btest\b` AND empty-shell, so these are safe — but verify with
      a one-off query if you have a real case.
- [ ] `sale_property_link_unrepresented_street_public_inventory_gap`
      (26 cards) now shows up under Property Linking with the
      no-public-inventory guidance, no longer in Other.

## What this PR explicitly does NOT do

These are queued for PR #2 (Tier 1 #4 and #7 in the friction log):

- Extending `govPendingSourceSummary` with `previously_linked_property_id`,
  `previously_linked_address`, `previously_linked_lease`, `unlinked_reason`,
  `discrepancy_source`, `flag_reason`, `review_guidance`. The
  link-pick placeholder currently directs the reviewer to "see Source
  Context below" — those keys still live in Raw JSON until PR #2.
- The actual two-column GSA-side / linked-side comparison body for
  `gsa_property_link_review`, and the lead-side resolver for
  `unmatched_property`.

And these for PR #3+ (Tier 1 #8 and Tier 2):

- Server-side dedup of the 12 paired `gsa_property_link_review` /
  `unmatched_property` rows.
- Generalising the Sale-Link Resolver to all `link_pick` reasons.

## After deploy: re-review pass

Once this is live, do another guided review pass — same method as the
last one — and update the friction log. The expectation is that:

- Test data is gone.
- The "what does Approve do here?" foot-gun is closed for link_pick rows.
- The Other chip is much smaller (only true uncategorised reasons).
- Reviewer can pivot from the card via the new record_id chip.

But the *information density* on link_pick cards is still poor (Raw
JSON only). That's the next session's target.
