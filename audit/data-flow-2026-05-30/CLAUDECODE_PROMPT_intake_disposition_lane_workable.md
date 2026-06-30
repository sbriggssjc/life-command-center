# Claude Code (life-command-center) — make the "Staged intake — needs review" lane workable

## Why (grounded live on LCC Opps `xengecqvemvfknjvbvrq` 2026-06-30)

The Decision Center `intake_disposition` lane ("Staged intake — needs review")
shows **792** `staged_intake_items.status='review_required'` as identical cards:
each reads only "unknown doctype · source email" + the intake id, with the same
four buttons (Create property / Re-extract (OCR) / Dismiss / Research). It's
unworkable — Scott can't tell what any row is, so nothing gets decided.

**The data is NOT missing — the card refuses to show it.** Every row's
`raw_payload->'extraction_result'` carries the real content. Spot samples:
- `7aee85de` → address `100 Midland Ave`, domain government, `match_status=unmatched`
- `66469e32` → `Cincinnati Children's Hospital Eastgate`, OH, tenant
  `United States Department of Veterans Affairs`, gov, unmatched
- `81f00217` → `2860 US-83`, tenant `Davita dialysis`, dia, unmatched

The extraction fields live directly on `extraction_result` (NOT under a
`snapshot` key): `address`, `city`, `state`, `tenant_name`, `asking_price`,
`cap_rate`, `document_type`, `match_status`, `match_domain`,
`match_property_id`, `match_confidence`, `promotion_ok`.

### Composition of the 792 (live)

The lane mixes four fundamentally different things under one "Create property"
button:

| Bucket | ~count | What it is | Correct action |
|---|---|---|---|
| Unmatched real listing doc w/ content (`om`/`flyer`/`marketing_brochure`/`offering_memorandum*`, `match_status<>matched`, has address/tenant/price) | ~95 | A genuine new listing that didn't match a property | **Create property** ✓ |
| `match_status='matched'` (any doctype) | ~380 | Already tied to an existing property; `promotion_ok=false` — promotion just didn't finish | Open property / promote-enrich — NOT create |
| Non-listing doctypes: `email_update` (240), `broker_email` (29), `comp` (15), `market_update` (2), `email` (4) | ~290 | Broker market-blast emails + comps — never meant to become a property | Auto-dismiss / route to comps; not "Create property" |
| `match_status='no_data'` (no address AND no tenant AND no price) | ~93 | Extractor got nothing usable | Auto-retire — nothing to act on |

So the genuine "create the property" set is **~95**, not 891. The "891 workable"
badge and "top by extracted asking price" header are both dishonest — most rows
aren't workable and the cards don't show (or sort by) price.

Doctype is also fragmented: rows carry raw long-forms (`offering memorandum`,
`offer memorandum`, `offering_m memorandum`, `investment offering memorandum`)
which is why the card shows "unknown doctype." Apply the existing
`normalizeDocType()` (intake-promoter.js) at the display + gating layer.

This is a Consumption-Layer failure (value-gate the producer · auto-retire ·
surface actionable-only with honest counts). Fix it per that doctrine.

## Unit 1 — render the extracted content on every card (the headline fix)

In the `intake_disposition` federated fetch (`admin.js` `fetchFederatedSource`)
project the `extraction_result` fields, and in `ops.js` (`_fedCardHTML` /
the intake lane card) RENDER them so each row is identifiable at a glance:
- **address, city/state** · **tenant_name** · **asking_price** (formatted $) ·
  **cap_rate** · normalized **doctype** (`normalizeDocType`) · **match_status** +
  **match_domain** (and `match_property_id` when matched).
- The card title should be the address (or tenant) — not the intake id.
- Null fields simply omit (don't print "null").

## Unit 2 — gate the producer / default the lane to actionable-only

Default the lane to the **create-candidate** set and move the rest to their
correct treatment. All reversible; surface a "show all" toggle.

1. **Auto-retire `no_data`** (~93): `match_status='no_data'` AND no address AND
   no tenant AND no asking_price → set `status='discarded'` with a reason tag
   (e.g. `raw_payload.disposition='auto_no_extractable_data'`), reversible. A
   bounded sweep (mirror the existing decision auto-retire pattern); do NOT
   hard-delete.
2. **Exclude non-listing doctypes from the create lane** (~290): normalized
   doctype in (`email_update`, `broker_email`, `market_update`, `email`) is
   market intel, not a new listing — auto-dismiss (thin) or route to a separate
   market-activity treatment; never default them to "Create property". `comp`
   → route to comp handling / dismiss (a comp is not a property to create).
   Decide dismiss-vs-route conservatively; at minimum keep them OUT of the
   create lane and out of the badge count.
3. **`matched` rows are not create-candidates** (~380): they already resolved to
   a property (`match_property_id`) but `promotion_ok=false`. Their primary
   action is **Open property / finish promotion+enrich**, NOT "Create property".
   Either give them an Open/Promote verdict or move them to a small "promotion
   didn't finish" treatment. (If finishing promotion is non-trivial, at minimum
   relabel the action and link to the matched property — don't offer Create.)

## Unit 3 — value-rank + honest count + right actions

- **Sort** the default (create-candidate) lane by `asking_price DESC NULLS
  LAST`, then by has-content (address/tenant present) — the header already
  claims "top by extracted asking price", so make it true.
- **Honest count**: the lane badge + "N workable" reflect the create-candidate
  set (~95), not 792. The matched/noise/no-data go to their own treatments or a
  "show all" view, counted separately.
- **Per-row actions by class** (the buttons should fit the row):
  - unmatched listing doc → **Create property** (primary) · Re-extract (OCR) ·
    Dismiss · Research
  - matched → **Open property / Promote** · Dismiss · Research (no Create)
  - (noise/no-data shouldn't appear in the default lane)

## Boundaries / verify

- life-command-center; `admin.js` `fetchFederatedSource` + `federatedSubjectRef`
  (the `intake_disposition` lane already exists — R7 Phase 2) + the verdict
  dispatch; `ops.js` card render; reuse `normalizeDocType`; the auto-retire is a
  bounded reversible sweep (status flip + reason tag, no hard-delete). No new
  api/*.js (stays 12). No domain (dia/gov) writes — this is LCC-Opps staging.
- Effect-first / outcome-truthful on every verdict (a failed create/promote
  keeps the item in review + records the failure, never a false success).
- **Verify (live, read-only first):** the create-candidate count (~95) matches
  `om/flyer/marketing_brochure/offering_memorandum*` unmatched-with-content; the
  card shows address+tenant+price+doctype+match_status for a sample of 3
  (7aee85de / 66469e32 / 81f00217); the `no_data` sweep dry-run lists ~93 and a
  real run flips them to discarded (reversible); the badge drops from 891 to the
  honest create-candidate count.
- `node --check` (admin.js, ops.js); suite green; extend a test asserting the
  card projects the extraction fields and the create lane excludes
  matched/noise/no_data.

## Documentation

Update CLAUDE.md (Decision Center / intake_disposition lane): the lane now
renders the extracted address/tenant/price/cap-rate/normalized-doctype/
match-status per card; auto-retires `no_data`; excludes non-listing doctypes
(email_update/broker_email/comp/market_update) from the create lane; routes
`matched` rows to Open/Promote (not Create); value-ranks by asking price; honest
create-candidate count. Consumption-Layer fix.

## Bottom line

The lane dumps 792 undifferentiated items, shows none of the content it already
extracted, and offers "Create property" on rows that are already matched, are
market-blast noise, or have no data. Render the extracted snapshot on each card,
auto-retire the empty ones, pull the market-blast/comp doctypes out, give matched
rows an Open/Promote action, and value-rank — and the lane becomes ~95 real,
identifiable, decidable create-candidates instead of 891 identical mystery cards.
