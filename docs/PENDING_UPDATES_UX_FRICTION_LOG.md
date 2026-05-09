# Pending Updates — UX friction log & ranked change plan

**Captured:** 2026-05-06 (live review session, dashboard branch
`claude/improve-research-tab-ux-verDu` merged & deployed)
**Queue size at capture:** 544 pending items
**Reviewer:** Scott (with Claude as scribe)
**Method:** Code pre-read of `gov.js` + 5 screenshots from a real
review pass + live `pending_updates` shape pulls from the `government`
Supabase project.

This document is the brief for the next coding session. Tier 1 below
is the recommended starting point.

---

## 0. How the Pending Updates UI renders today

`renderGovPendingUpdates` (`gov.js:5369`) drives a two-pane view:

- **Left:** scrollable list of pending rows (title, confidence pill,
  table.field, age).
- **Right:** detail card for the selected row.

The detail card body is one of two shapes:

1. **Sale-Link Resolver** (`renderGovSaleLinkResolver` at `gov.js:5222`)
   when `taxonomy.category === 'sale_link'`. Renders a sale record
   summary, GSA Inventory hits, candidate properties, and a
   "Create new property" form. **This is the good pattern.**
2. **Standard diff** (`gov.js:5569–5584`) for every other reason. Renders
   `old_value → new_value` as Current/Proposed cells, plus a small
   parsed Source Context block (driven by `govPendingSourceSummary` at
   `gov.js:4726`, which whitelists only 7 keys: `subject`, `address`,
   `tenant`, `asking_price`, `lease_number`, `summary`, `source`),
   followed by a collapsed `<details>Raw JSON</details>`.

Bulk approve (`bulkApproveGovPending` at `gov.js:4751`) and the `A`
keybind (`gov.js:4804`) only exclude `sale_link`; all other reasons
flow through. Approve simply sets `pending_updates.status = 'approved'`.

---

## 1. Reasons in production vs. taxonomy coverage

Live counts from `pending_updates` where `status='pending'`:

| reason | n | category | guidance? |
|---|---:|---|---|
| sale_property_link_portfolio_address_gap | 124 | sale_link | ✓ |
| sale_property_link_unrepresented_street_no_public_inventory | 68 | sale_link | ✓ |
| sale_property_link_no_public_inventory | 55 | sale_link | ✓ |
| ownership_discrepancy | 53 | ownership | ✓ |
| unmatched_property | 45 | intake | ✓ (but wrong for unlinks) |
| sale_property_link_frpp_city_inventory_gap | 37 | sale_link | ✓ |
| **gsa_property_link_review** | **33** | **other (fallback)** | **✗ generic** |
| **sale_property_link_unrepresented_street_public_inventory_gap** | **26** | **other (fallback)** | **✗ generic** |
| sale_property_link_ambiguous_city_match | 23 | sale_link | ✓ |
| sale_property_link_frpp_city_presence_multi_facility | 21 | sale_link | ✓ |
| sale_property_link_no_public_inventory_portfolio | 19 | sale_link | ✓ |
| sale_property_link_no_public_inventory_route | 8 | sale_link | ✓ |
| sale_property_link_named_site_or_partial_address | 8 | sale_link | ✓ |
| sale_property_link_gsa_address_bridge_candidate | 7 | sale_link | ✓ |
| sale_property_link_multi_property_street_conflict | 6 | sale_link | ✓ |
| unmatched_contact | 3 | intake | ✓ |
| sale_property_link_frpp_city_presence_single_facility | 3 | sale_link | ✓ |
| sale_property_link_unknown_lease_number | 2 | sale_link | ✓ |
| intake_unmatched_property | 2 | intake | ✓ |
| intake_attachment_review | 1 | intake | ✓ |

**59 cards (33 + 26) fall through to `other` with placeholder guidance.**
This matches the "Other 59" chip count seen in screenshot 5.

The `_gap`-suffix mismatch is a typo bug: `GOV_PENDING_REASON_TAXONOMY`
(`gov.js:4586`) defines `sale_property_link_unrepresented_street_public_inventory`
but the writer emits `sale_property_link_unrepresented_street_public_inventory_gap`.

---

## 2. Confirmed `source_context` shapes

Pulled live from `pending_updates`. `key_counts` show how many rows of
each reason carry the key.

### `unmatched_property` (45 rows, `prospect_leads.matched_property_id`)

```
address         45/45
city            45/45
state           45/45
lease_number    45/45
unlinked_reason                  38/45  ← audit-sweep rows only
previously_linked_property_id    38/45  ← audit-sweep rows only
previously_linked_lease          38/45  ← audit-sweep rows only
previously_linked_address        38/45  ← audit-sweep rows only
```

`old_value=NULL`, `new_value=NULL`, `confidence=0.0` for the 38 sweep
rows. The remaining 7 are non-sweep unmatched rows (likely fresh leads
with no inventory hit).

**Sample (sweep row):**
```json
{
  "address": "3221 SKYWAY DR",
  "city": "SANFORD", "state": "FL",
  "lease_number": "LFL01228",
  "previously_linked_property_id": 3765,
  "previously_linked_address": "2151 spinner ln",
  "previously_linked_lease": "LFL61842",
  "unlinked_reason": "Auto-unlinked by 2026-05-05 audit: street numbers and lease numbers both disagree with the linked property…"
}
```

### `gsa_property_link_review` (33 rows, `gsa_leases.property_id`)

```
gsa_address          33/33
gsa_city             33/33
gsa_state            33/33
gsa_lease_number     33/33
linked_address       33/33
linked_city          33/33
linked_state         33/33
linked_lease_number  33/33
linked_property_id   33/33
flag_reason          33/33
review_guidance      33/33
```

`old_value=NULL`, `new_value=NULL`. The writer pre-formatted both sides
of the disputed link plus per-row guidance — none of which surfaces in
the UI today.

**Sample (paired with the unmatched_property row above):**
```json
{
  "gsa_address": "3221 SKYWAY DR",
  "gsa_city": "SANFORD", "gsa_state": "FL",
  "gsa_lease_number": "LFL01228",
  "linked_address": "2151 spinner ln",
  "linked_city": "Sanford", "linked_state": "FL",
  "linked_lease_number": "LFL61842",
  "linked_property_id": 3765,
  "flag_reason": "street_number_disagree (lease# also differs)",
  "review_guidance": "Audit on 2026-05-05 found the gsa_property_matcher linked this GSA lease to a property whose lease_number AND street number/city both disagree. Some are correct (city normalization like Mt vs Mount, Saint vs St; range addresses; historical municipal renaming like West Paterson → Woodland Park; building complexes with multiple lease numbers). Others are genuine wrong matches…"
}
```

### `ownership_discrepancy` (53 rows, `properties.recorded_owner_id`)

```
address              53/53
city                 53/53
state                53/53
recorded_owner       53/53
new_owner            53/53
discrepancy_source   53/53   ← provenance signal, e.g. "assessed_owner"
```

`old_value` mirrors `recorded_owner`; `new_value` mirrors `new_owner`.
The diff cell renders correctly. **`discrepancy_source` is the
provenance signal the guidance asks the reviewer to evaluate but it
does not surface in the parsed summary.**

### `intake_unmatched_property` (2 rows, `email_intake_v2.matched_property_id`)

Carries the full intake payload: `subject`, `intake_id`,
`correlation_id`, `internet_message_id`, `attachment_issues`,
`classification`, `extracted_property`, **and a fully-formed
`match_details.candidates` array** (top-N candidates with
property_id, address, score, agency, lease#, normalized_match_key).
The system already did the candidate-ranking work — the resolver just
isn't being shown for this reason.

---

## 3. Friction log (from screenshots 1–5)

### F1. Test data in production queue (S1)
`Subject: "Test intake email for GovernmentProject"` ranks first at
95% confidence, 1mo old, both diff cells empty. Eligible for bulk
approve. No `is_test`/`is_seed` filter; auto-resolver doesn't catch
empty-shell rows.

### F2. Confidence is computed for non-value-change actions
- 95% on a (empty)→(empty) test email (S1)
- 0% on a `prospect_leads.matched_property_id` unlinking (S4)
- 50% on a `gsa_leases.property_id` link review (S5)

The confidence pill looks like a traffic light but reads from the
wrong sensor for ~half the queue.

### F3. The "Approve" button has three semantically different meanings
- **Ownership Discrepancy:** overwrites `recorded_owner` (real write).
- **Unmatched Intake / Unmatched Property:** sets pending row to
  `approved` with no inventory or lead change (no-op).
- **Gsa Property Link Review:** cements the suspect link.

All three render the same green button. Bulk approve only excludes
`sale_link`, so the no-op and the link-cementing variants both flow
through `A` and the bulk action.

### F4. Sale-Link Resolver is excellent — and unique to one reason (S2)
Sale record + GSA inventory + candidates + create-new-property form.
The other three reasons under review here all need the same affordance
and have none of it.

### F5. Sale-Link Resolver fails informatively, then offers a foot-gun (S2)
"No candidates found in inventory. Use 'Create new property' below"
prefills the form with `address: "PORT CHARLOTTE"` (a city, not a
street). Clicking through would create a junk inventory row.

### F6. Bad upstream data masquerades as inventory failure (S2)
Sale row's `address = "PORT CHARLOTTE"`, `sold_price = —`. The card
framing makes it look like our inventory is incomplete; the real
problem is the *sale's* address field is malformed.

### F7. No record-id pivot from any card (S1, S2, S4, S5)
`record_id` (sale_id, lead_id, gsa_lease_id, intake_id) is the most
reliable handle for "open this in another tab to investigate" but it's
not surfaced anywhere on the card.

### F8. Ownership Discrepancy proposal is structurally suspicious (S3)
Current "7IL Properties of Kentucky LLC" → Proposed "FINCH, CARTHEL
JACK" at 60% with `address` = "1070 vendall st" (lowercase, no
city/state visible in the parsed summary). The all-caps last-first
format is unmistakably raw deed extraction. Without filing date, deed
source, or LLC chain, the reviewer is being asked to gauge "more
authoritative" with none of the cues that would let them.

### F9. Mixed ages in same view, sorted by priority (S1, S3, S4, S5)
A 1mo-old test email outranks 12h-old unlinkings. No "stale" pill, no
sort-by-age option.

### F10. Auto-resolved strip is reassuring but opaque (S1)
Resolver names ("sam_filter:not_lease",
"lcc_session:fla_low_signal_state_zip_only", etc.) are not clickable;
no way to see *which* items were cleared.

### F11. No "item N of M" cursor in the right pane
Once you scroll either side, position cues vanish.

### F12. Bulk approve covers ~0.5% of items (S1)
The ≥80% gate excludes the noisy-but-routine 60%-confidence ownership
updates and includes things like the test email. Rarely the action you
want.

### F13. Guidance text is wrong for the unlinking case (S4)
`unmatched_property` guidance reads: *"A record references a property
we can't find in our inventory. Approve to create it; reject if it's a
duplicate or out-of-scope."* But S4 is a *previously-linked* lead whose
match was nulled by an audit sweep — the property may already exist;
the question is "should we re-link, and to which one?" The guidance
funnels toward the wrong action.

---

## 4. Two cross-cutting findings

### N1. 12 of the 33 `gsa_property_link_review` rows duplicate `unmatched_property` rows
Same `lease_number` + same `previously_linked_property_id`. The audit
emitted two pending rows per bad link (one from the lead side, one
from the gsa_leases side). Resolving either should auto-resolve the
other.

### N2. The `_gap` suffix typo orphans 26 cards
Production reason: `sale_property_link_unrepresented_street_public_inventory_gap`.
Taxonomy entry: `sale_property_link_unrepresented_street_public_inventory`
(no `_gap`). 26 cards land in the "Other" fallback unnecessarily.

---

## 5. Tier 1 — fix before reviewing the next 100 items

| # | Change | File / function | Concrete payload |
|---|---|---|---|
| 1 | Suppress empty diff for non-field-change reasons | `gov.js:5569–5584` (`if (!isSaleLink)` branch) | Add a `RESOLUTION_KIND` map. `unmatched_property`, `gsa_property_link_review`, `intake_unmatched_property` → `link_pick`. For `link_pick`, render a reason-specific block instead of `pu-diff`. |
| 2 | Add `gsa_property_link_review` taxonomy entry + alias the `_gap` typo | `GOV_PENDING_REASON_TAXONOMY` (`gov.js:4586`); `GOV_PENDING_CATEGORIES` (`gov.js:4691`) | Add taxonomy entries; introduce a `link_review` category. Aliases `..._public_inventory_gap` → `..._public_inventory`. Empties the "Other" chip. |
| 3 | Reason-aware Approve | `bulkApproveGovPending` (`gov.js:4751`) and `'a'` keybind (`gov.js:4804`) | Exclude any reason whose `RESOLUTION_KIND === 'link_pick'` from bulk + `A` (same pattern as `sale_link`). Replace the green `Approve` button on those reasons with `Confirm match` (disabled until a candidate is picked). |
| 4 | Surface the previously-linked context | `govPendingSourceSummary` (`gov.js:4726`) | Add keys: `previously_linked_property_id`, `previously_linked_address`, `previously_linked_lease`, `unlinked_reason`, `discrepancy_source`, `flag_reason`, `review_guidance`. Format `previously_linked_property_id` and `linked_property_id` as code chips with a "↗ open" affordance. |
| 5 | Show `record_id` on every card | `gov.js:5554` (detail header) | One `<code>` near the `table.field` line with copy-to-clipboard. |
| 6 | Filter test data | `loadGovPendingUpdates` (`gov.js:4825`) | Exclude `source_context->>'subject' ILIKE '%test%' AND old_value IS NULL AND new_value IS NULL`. Better long-term: an `is_seed` column on `pending_updates`. |
| 7 | Inline link-review card body | new render fn called from #1 | For `gsa_property_link_review`, render a 2-column GSA-side / linked-side comparison using the 11 confirmed keys. Banner row for `flag_reason`; info popover for `review_guidance`. |
| 8 | Server-side dedup of paired rows | post-resolution trigger or RPC | When resolving a `gsa_property_link_review` row, mark any sibling `unmatched_property` row with the same `lease_number` + `previously_linked_property_id` as auto-resolved (and vice-versa). |

---

## 6. Tier 2 — substantive but bigger

| # | Change | Notes |
|---|---|---|
| 9 | Generalize the Sale-Link Resolver to all `link_pick` reasons | Sale Resolver pattern reused for `unmatched_property`, `unmatched_contact`, `gsa_property_link_review`, `intake_unmatched_property`. `intake_unmatched_property` already has `match_details.candidates` ready to feed in. |
| 10 | Validate "Create new property" prefill | Block Create when address has no street number. Also flag missing sold_price / city-only address as a warning band on the sale record summary. |
| 11 | Promote `discrepancy_source` and provenance hints on Ownership Discrepancy | Show `discrepancy_source`; if `new_owner` matches an all-caps last-first-middle pattern, badge it as "raw deed extraction — verify before approving." |

---

## 7. Tier 3 — quality-of-life

| # | Change | Notes |
|---|---|---|
| 12 | Sort/group by recency *and* priority, with a stale flag | Items >14 days old get a "stale" pill and drop in sort order, or move to an "Old" tab. |
| 13 | Auto-resolved trends strip becomes clickable | Each resolver name links to a filtered view of what it cleared. |
| 14 | "Item N / M in this view" cursor in the right pane header | One line; eliminates J/K disorientation. |
| 15 | Confidence display: hide on link-pick / link-confirm cards, or rename | Either drop the pill on those reasons or label it differently ("Link confidence" vs "Match confidence"). |

---

## 8. Recommended sequencing for the next session

1. **Tier 1 #1, #2, #3, #5, #6** in one PR — small, mostly-local, neutralizes the dangerous foot-guns and cleans the queue surface. Should be reviewable in <300 lines diff.
2. **Tier 1 #4, #7** in a follow-up PR — extends the parser whitelist and adds the link-review comparison body. Lands on the cleaned substrate from PR 1.
3. **Tier 1 #8 + Tier 2 #9** — server-side dedup and resolver generalization. The biggest payoff for the remaining 100+ items.
4. **Tier 2 #10, #11 + Tier 3 polish** — once the queue is navigable.

After PR 1 lands, do another guided review pass and update this document with new friction observations. The goal is to keep the doc current as the substrate it describes evolves.
