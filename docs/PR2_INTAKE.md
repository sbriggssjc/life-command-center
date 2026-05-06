# PR #1 retrospective + PR #2 intake

**Session closed:** 2026-05-06
**PR #1 commit:** `2e80076` (gov.js) + `419858c` (styles-round-76bj.css)
**Branch:** `claude/dashboard-human-review-6nnMg` (deployed)

This doc closes the loop on PR #1 and is the scratchpad for PR #2.
Add observations under "New friction observations" as you review.

---

## PR #1 — what landed

Confirmed live in browser via screenshot review:

- Queue total: **544 → 543** (test-row filter dropped the
  "Test intake email for GovernmentProject" empty-shell row).
- **"Other" chip gone.** Of the 59 it used to hold:
  - 33 `gsa_property_link_review` rows moved to the new
    **Link Review** chip.
  - 26 `..._public_inventory_gap` rows joined Property Linking
    via the alias map.
- `gsa_property_link_review` cards now show the real
  "GSA → Property Link Review" title and reason-specific guidance.
- Empty `(empty) → (empty)` diff replaced by the dashed-border
  link-pick placeholder on `unmatched_property`,
  `gsa_property_link_review`, `intake_unmatched_property`,
  `unmatched_contact`.
- Approve button + bulk approve + `A` keybind now gate on
  `taxonomy.kind === 'field_change'`. link_pick rows have no
  Approve button; pressing `A` shows a "press R to reject, or S
  to skip" hint.
- `record_id` chip rendered in the detail header on every card,
  click-to-copy.
- `ownership_discrepancy` and `sale_property_link_*` rendering
  paths unchanged.

---

## Observations from the verification screenshots

### O1. Confidence pill still shown on link_pick rows
The misleading old/new diff is gone, but the colored confidence
pill (e.g. 50% Medium, 0% Low) still appears in the detail header.
For link_pick, the number reads from a sensor that doesn't apply
("confidence in this value change" — but there's no value change).

**Fix:** in `renderGovPendingUpdates`, gate the pill render on
`!isLinkPick` — or rename it on link_pick rows ("Match score" or
similar) so the semantic is clear. Cheap.

### O2. Sale-Link Resolver candidate query degrades to city when lease# is unknown
Screenshot 5: a real sale with full address "5445 Beckley Rd,
Battle Creek, MI" shows `(0 · city~5445 Beckley Rd)` and "No
candidates found in inventory" — the resolver fell back to
`city ILIKE 'address-string%'` because no lease# matched in
inventory. The address-as-city query is doomed.

**Fix:** in `loadGovSaleLinkContext`, when lease# misses, query
properties by `city = sale.city AND state = sale.state` first,
*then* address-substring. Don't use the address as a city filter.
Logged here for PR #2 (or whoever picks it up first).

---

## New friction observations (write here as you review)

> Format: one line per item. Reason / card type if relevant. What
> you wished was different. Optional record_id from the chip so we
> can pull the source_context.

- _(your notes here)_

---

## PR #2 — confirmed scope going in

### Tier 1 #4: extend `govPendingSourceSummary`

`gov.js:4726` — add to the parsed-summary key list (and choose
formatting per key). All keys verified present in production via
SQL during the friction-log session.

| Key (in source_context) | Reasons that carry it | Format |
|---|---|---|
| `previously_linked_property_id` | unmatched_property (38/45) | `#1234 — <address>, <city>, <st>` (join one row from properties) |
| `previously_linked_address` | unmatched_property (38/45) | inline string |
| `previously_linked_lease` | unmatched_property (38/45) | `<code>` |
| `unlinked_reason` | unmatched_property (38/45) | small-text paragraph below the placeholder |
| `flag_reason` | gsa_property_link_review (33/33) | banner badge above the comparison body |
| `review_guidance` | gsa_property_link_review (33/33) | info popover (long-form text) |
| `discrepancy_source` | ownership_discrepancy (53/53) | source provenance chip ("from: assessed_owner") |
| `gsa_address`, `gsa_city`, `gsa_state`, `gsa_lease_number` | gsa_property_link_review | left column of comparison |
| `linked_address`, `linked_city`, `linked_state`, `linked_lease_number`, `linked_property_id` | gsa_property_link_review | right column of comparison |

### Tier 1 #7: replace the link-pick placeholder

For `gsa_property_link_review`: 2-column "GSA side / linked side"
comparison table using the keys above. Banner row above for
`flag_reason`. The `linked_property_id` becomes a link to open
the property detail.

For `unmatched_property`: single-card layout showing the lead's
address + lease, plus a "Previously linked to" sub-block when the
audit-sweep keys are present.

For `intake_unmatched_property`: render
`source_context.match_details.candidates` as a candidates list
(scored), styled like the Sale-Link Resolver's candidates — but
without server-side resolution yet (PR #3 territory).

### Optional fold-in from observations

- **O1** (suppress confidence pill on link_pick) — 5 lines, do it
  with PR #2.
- **O2** (sale-link resolver address-as-city bug) — separate fix,
  could ride the same PR or split.

---

## Deferred to PR #3+

- **Tier 1 #8.** Server-side dedup: when one of the 12 paired
  `gsa_property_link_review` ↔ `unmatched_property` rows is
  resolved, mark its sibling auto-resolved.
- **Tier 2 #9.** Generalize the Sale-Link Resolver pattern (with
  candidates + Link / Create) to all link_pick reasons.
- **Tier 2 #10/11.** Sale prefill validation; provenance hints on
  Ownership Discrepancy.
- **Tier 3 #12–15.** Stale flag, clickable auto-resolved trends,
  position cursor, confidence rename.

---

## Tech debt logged during this session

1. **`gov.js` is 8.5K lines.** Pushing it through tooling that
   parameter-caps below ~430KB is painful (had to ship PR #1 as
   a patch+apply-guide). Consider splitting into
   `gov-pending-updates.js`, `gov-resolver.js`, etc., before the
   file grows further. Not urgent, but the line will keep going up.
2. **`styles.css` truncation root cause.** The
   `styles-round-76bj.css` sidecar exists because main `styles.css`
   has a documented "bash-side truncation issue from Round 76be
   onward." Once that's diagnosed and fixed, merge the sidecar
   back. Recorded here so it doesn't get forgotten.
3. **Line-ending normalization.** Applying PR #1 normalized
   `gov.js` from CRLF to LF. Adding `gov.js text eol=lf` (or
   `* text=auto eol=lf` for consistency) to `.gitattributes`
   would prevent churn on future round-trips between Linux and
   Windows clones.
