# Claude Code prompt — F4B: promotion hardening (bugs exposed by the live F4 verification)

Paste into Claude Code, run from the **life-command-center** repo. PR #1044
(create-from-intake / disposition / OCR rescue) deployed and verified live
2026-06-04 — the architecture works end-to-end: property created with
`source='om_intake'` (dia 44309, FMC Buckeye AZ), race-guard prevents dupes,
OCR rescue fully recovered the scanned Fresenius Independence MO OM
(zero text → full extraction → matched existing prop 26913 → finalized), and
the disposition pass has already moved 646 non-deal items out of review.

The live test also exposed four defects. All evidence below is from real
production runs — don't re-investigate, just fix.

---

## 1. Cap-rate double conversion → listing 23514  (HIGH — kills listing writes)

The Buckeye create-property promotion failed its listing INSERT:
`chk_available_listings_current_cap_rate_decimal_range` — failing row carried
**0.0006** because the extraction stored `cap_rate: 0.055` (ALREADY decimal)
and the promoter divided by 100 again. Meanwhile the OCR re-extract of the
Independence MO OM returned `cap_rate: 7.75` (percent form). **The extractor
emits BOTH forms**; the promoter must detect, not assume:

- Add a shared `normalizeCapRate(v)` (suggest in `api/_shared/intake-classify.js`):
  `v > 1.5` → percent form, divide by 100; `0.005 ≤ v ≤ 0.30` → already decimal,
  pass through; `0.30 < v ≤ 1.5` or `< 0.005` → implausible either way, return
  null (and keep the raw value in notes/metadata rather than failing the row).
- Apply it EVERYWHERE the promoter writes cap-rate-ish fields (cap_rate,
  current_cap_rate, initial_cap_rate, last_cap_rate — listings, financials,
  sales). Also nudge the extractor prompt schema to request decimal form, but
  the writer-side guard is the real fix.
- Re-run promotion for the Buckeye intake (`8622b5e3-4500-449d-8d4f-c9a438b748cd`)
  and confirm the listing lands with current_cap_rate 0.055.

## 2. Array-valued snapshot fields crash scalar writers  (HIGH — multi-tenant/broker OMs)

The F1/F2 work made `tenant_name`, `listing_broker`, `listing_broker_email`
(etc.) legitimately ARRAY-valued for multi-tenant/multi-broker OMs. Verified
failures in the Buckeye promotion result:
- `broker_contact`: `(snapshot.listing_broker || "").trim is not a function`
- `property_financials`: `(snapshot.tenant_name || …).trim is not a function`
- `unified_contact`: `(snapshot.listing_broker_email || "").trim is not a function`
- The listing row that DID build stuffed the raw JSON array into the
  `listing_broker` text column (`["Jay Patel","Thomas Ladt","Nico Lautmann"]`).

Fix the class, not the call sites one by one: add snapshot coercion helpers
(e.g. `firstOf(v)` → first element if array else v; `joinedOf(v, sep=', ')`)
and sweep `api/_handlers/intake-promoter.js` (+ the create-property handler)
for every `snapshot.<field>` consumed as a string. Multi-broker OMs should
create a contact PER broker (the promoter already comma-splits broker names —
feed it the joined form), tenant arrays should use first-as-primary with the
rest recorded (notes/metadata), and text columns get the human-joined form,
never raw JSON.

## 3. Normalizer gaps found against real DB rows  (MED — both cause dupes)

Two unmatched review items turned out to be EXISTING properties the canonical
tier still misses:
- **Number-words**: OM "27150 Eight Mile Road" ↔ dia 26639 "27150 W 8 Mile Rd"
  (Southfield MI). Add number-word↔digit folding to `normalizeStreetAddress`
  (one↔1 … twenty↔20 covers US street names; also ordinal forms first↔1st …
  tenth↔10th). NOTE the DB side also has an extra directional the OM lacks —
  add a **missing-directional tolerance**: when one side has a directional and
  the other none (same house number + same normalized rest), accept on a
  UNIQUE hit, reject if multiple candidates differ only by directional.
- **Hyphenated ranges**: OM "2064 - 2066 Atlantic Ave" ↔ dia 22041
  "2064 Atlantic Ave" (Brooklyn). When the street number is a range
  (`^\d+\s*[-–]\s*\d+`), also try the first number as an alias key.
- Unit tests on both real pairs. These two intakes (`cd2172dd…`, `34133e33…`)
  should match on the next rematch tick after deploy — verify.
- Data note (no action this round): dia already contains dupes from this
  failure mode (e.g. 26481 "28425 8 Mile Rd" vs 2079983 "28425 Eight Mile Rd",
  Livonia MI) — the existing `duplicate_property_address` data-quality view
  should catch them once the normalizer folds number-words; confirm it does.

## 4. Re-promote route 500s on JSON body  (LOW — check)

`POST /api/intake?_route=promote` with `{"intake_id":…}` JSON body returns
500 (query-param form returns 400 "intake_id required", so it reads the body —
then dies). The new `_route=create-property` body-parse works fine on the same
deployment. Check what `ops.js repromoteIntake` actually sends vs what the
handler expects, and make promote accept the same body shape create-property
does. (May be pre-existing; the inbox "Re-promote ↻" button may be silently
broken — test it live in the UI.)

## Verify + ship

- Unit tests: normalizeCapRate (0.055 pass-through, 7.75→0.0775, 45→null),
  array coercion (string/array/null for each field), number-word + range +
  missing-directional pairs above.
- Live after deploy: Buckeye intake re-promotion → listing row with
  current_cap_rate 0.055 + three broker contacts; rematch tick matches
  `cd2172dd…` (Eight Mile) and `34133e33…` (Atlantic Ave) to their existing
  properties — NO new property creation for either.
- `node --check`; `ls api/*.js | wc -l` = 12; no migrations expected. End with
  merge + deploy commands.
