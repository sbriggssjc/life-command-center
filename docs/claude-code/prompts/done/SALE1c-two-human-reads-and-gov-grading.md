# SALE1c + SALE1c-gov + ADDR1b — the three residues the last two rounds correctly refused to decide

**Repo: `life-command-center`.** Targets **dia `zqzrriwuavgrquhisnoa`** and **gov
`scknotsqkcheojiaewwh`**. **Three small, independent items, all reads first.** None is a bulk
operation; two of the three may end in "leave it, here is why", and that is a valid outcome.

**Read first:** **`docs/architecture/costar-sidebar-capture-pipeline.md`** (new canonical page —
the producer, the arc, the guards, §5 live state) → backlog **SALE1c**, **SALE1c-gov**, **ADDR1b** →
`CLAUDE.md` § A2b (the one-conveyance-observed-twice rule) and § B6c-dup (the sale spine; gov's
month-truncation and quarantine vocabulary differ from dia's).

## Item 1 — SALE1c: the 8 `linked_same_listing` rows

SALE1a nulled 29 prices whose value matched a listing on the property. It **left 8 alone** because
their price matches **the very listing the sale is formally joined to** via `listing_sale_id` — a
real join, not a coincidence. Two readings, and no deed corroborates either:
(a) a genuine full-ask close (the property sold at the asking price — common, and the price is
correct), or (b) the writer copied the linked listing's ask when no separate closing figure was
captured.

**Distinguish them on evidence that is not the price.** Candidates, in the order I'd try:
`available_listings` status/close fields (did that listing close, and on what date relative to the
sale?), `listing_events`, the sale's own `notes`/`sale_notes_raw` for a stated consideration,
`cap_rate_history` (does an EARLIER observation for that sale differ from the ask, as in the
Hillsboro shape?), and the deed record if one exists at any date. **A full-ask close and a copied ask
will differ in whether the listing shows a close event matching the sale date.**
Verdict per row: `genuine_full_ask` (leave, and record the reasoning on the row) ·
`copied_from_linked_listing` (null, same batch pattern as SALE1a: snapshot, tag, null the derived
cap rate too) · `undecidable` (leave, and say what evidence would settle it).

## Item 2 — SALE1c: the 902/903 dedup pair

SALE1a nulled 903 and deferred 902 because both share `(property_id, sale_date)` and nulling the
second would collide on the unique index `(property_id, sale_date, COALESCE(sold_price,0))`.
**Read the two rows.** Are they one conveyance observed twice (A2b — then one should be
`duplicate_superseded`, not two live rows with one nulled price), or two genuine same-day events?
The collision is a symptom: **a unique index that forbids two nulled prices on one property-date is
telling you these should not both be live.** Fix the underlying duplication if that is what it is,
rather than working around the constraint.

## Item 3 — SALE1c-gov: grade gov's 127

gov has an equivalent ledger (`cap_rate_history`, `event_type='sale'`, via
`trg_gov_auto_cap_rate_on_sale`) and shows **127 `ledger_disagreement` rows, only 4 matching a
listing ask** — a far smaller listing-bleed share than dia's, consistent with gov's spine having a
different dominant producer (GSA/deed feeds rather than CoStar capture).

⚠️ **Do not transfer dia's rules.** Grade gov on its own terms first:
- **Who writes gov's prices?** Split the 127 by `data_source` the way dia was split by source purity.
  If the dominant producer is a deed/GSA feed rather than the sidebar, the *mechanism* is different
  and the dia remedy (null the listing-bleed) may not apply at all.
- **gov carries listing columns dia lacks** (`asking_price`, `original_price` on top of
  `initial_price`/`last_price`). The 4 listing-matches were found against which of them? Re-run with
  all four before concluding the share is small.
- **gov's `sale_date` truncation and `transaction_state` vocabulary differ from dia's** (B6c-dup).
  Check both before any comparison to dia's numbers.
- **Report a classification, not a fix.** If the shape turns out to be dia's, say so and propose the
  same batch-tagged null; if it is a different mechanism, name it and stop.

## Item 4 — ADDR1b: gov's single address-bleed row

**Property 9893, `245 Park Ave` / Raton, NM** — J.P. Morgan Asset Management's Manhattan office
street on a New Mexico property. Same two-way read dia got: **phantom duplicate** (is there a real
Raton property with matching stats/operator/tenant?) → merge, or **a real property that lost its
street** → quarantine.
⚠️ **Check first whether gov HAS a `dia_merge_property_reversible` equivalent.** gov's ADDR1
migration shipped **the review view only, with no repair half.** If no reversible property merge
exists on gov, the disposition is quarantine-only — say that rather than hand-rolling a merge, and
file the merge machinery as its own item.

## Verify on

- The 8 classified with the non-price evidence quoted per row; anything nulled carries the snapshot,
  batch tag and a nulled derived cap rate.
- 902/903 read and dispositioned, with the duplication addressed rather than the constraint dodged.
- gov's 127 split by `data_source`, the 4 re-measured against all four listing-price columns, and a
  named mechanism — or an honest "different shape, not dia's".
- 9893 dispositioned or explicitly blocked on gov lacking merge machinery.
- `v_dia_sale1_price_review` and `v_gov_contact_office_address_bleed_review` before/after.

## What NOT to do

- No bulk null. No reset on the ledger alone (the SALE1a rule stands: reset only with deed
  corroboration, otherwise null). No `dedup_natural_key` change. Do not hand-roll a gov property
  merge to get past item 4.

## Report back

The 8 with their evidence · 902/903 · gov's 127 classified by producer · 9893's disposition or its
blocker · anything that outranks this.
