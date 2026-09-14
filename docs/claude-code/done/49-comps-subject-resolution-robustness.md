# Prompt 49 — Comps: make subject resolution phrasing-independent + fix the hydrated subject cap display

## Why (live connector acceptance test, 2026-08-05 — post-47 verify)

Prompt 47 landed (PR #1567) and WORKS when the subject resolves: for
`synthesize_comps("Appraisal comps for The Villages DaVita, 1050 Old Camp Rd, The
Villages, FL …")` the subject hydrated correctly — `resolved_from_record: true`,
`property_id 31964`, `building_sf 6453`, `chairs 12`, `year_built 2022`,
`lease_expiration 2038-08-05`, `bumps "10% / 5 yrs"`, `cap_rate 0.0675`,
`excluded_subject: 1`, and 166 nationally-ranked comps came back. Hydration + exclusion
are correct.

But two residual problems remain:

**1. Resolution is phrasing-dependent — the subject silently falls back to a PLACE.**
The SAME subject worded slightly differently does NOT resolve to the property:
`generate_comps("The Villages DaVita, 1050 Old Camp Rd, The Villages, FL — 25 best …")`
returned `subject.kind: "place"`, `_cap_default: true`, cap 6.00%, all fields
"Not on file", `sold: 0`, `on_market: 1` (the lone result was the subject's own
listing — the very thing 47 excludes when it resolves). So when the street address
isn't extracted, the request resolves to the metro "The Villages", hydration/exclusion
never fire, and the pull collapses to near-empty. The appraiser deliverable must not
depend on exact wording — an address that `get_property_context` resolves at 0.96 must
resolve the same way through `parseRequest` → `runComps`, every phrasing.

**2. The hydrated subject's nested `fields.cap_rate` still shows the 6.00% default.**
Even on the SUCCESSFUL hydration above, the top-level `subject.cap_rate` was 0.0675 but
`subject.fields.cap_rate` was still 0.06. The nested `fields` block (what the cover/subject
summary renders from) wasn't updated with the hydrated cap, so the subject can display
6.00% in the workbook while the anchor is 6.75% — an appraisal-critical inconsistency
(the subject cap drives the whole analysis; it must read 6.75% everywhere).

## Task

1. **Reliably extract the street address and resolve the subject to its property,
   independent of phrasing.** In `parseRequest`/subject resolution, when the request text
   contains a street address (e.g. "1050 Old Camp Rd") — with or without the words
   "appraisal"/"comps for", and even when a place name ("The Villages, FL") is also present
   — attempt property resolution by that address FIRST (the same domain-identity path
   `get_property_context` uses, ~0.96), and only fall back to place/gazetteer resolution when
   no property resolves. A recognized subject property must win over the metro it sits in.
   Prefer resolving by street address over the city/metro token when both are present.

2. **When the subject resolves to a property, keep the comp scope national/appraisal-correct.**
   The place-resolution path collapsed the set to the subject's own metro (0 sold, 1 on-market).
   Once the subject resolves to a property, the query scope must be the same national,
   similarity-ranked appraisal universe the working path produced (166 of 215), not a
   single-metro slice. Make sure property-resolution does not narrow `states`/`metros` to the
   subject's own city.

3. **Propagate the hydrated cap (and all hydrated values) into `subject.fields`.** After
   `hydrateSubjectFromRecord`, the nested `fields` block that the subject/cover render consumes
   must carry the hydrated `cap_rate` (0.0675), `building_sf`, `chairs`, `remaining_term`,
   `lease_structure`/bumps, credit — not the pre-hydration gazetteer defaults. `_cap_default`
   must be false once a real cap is hydrated. No place in the payload should still show 6.00%
   or "Not on file" for a field that hydration filled.

Keep 47's conservatism: resolve/hydrate/exclude only on an unambiguous single-property match;
leave "Not on file" when 0 or >1 match; never override an explicitly user-typed cap.

## Verify

- `generate_comps` AND `synthesize_comps` for the subject, worded BOTH ways —
  "The Villages DaVita, 1050 Old Camp Rd, The Villages, FL — 25 best …" and
  "Appraisal comps for The Villages DaVita, 1050 Old Camp Rd …" — BOTH resolve the subject to
  property_id 31964: SF 6,453 / 12 chairs / term to ~2038 / cap 6.75% (not "Not on file", not
  6.00%), `_cap_default: false`, `excluded_subject ≥ 1`, the subject's own listing absent from
  On Market, and a national similarity-ranked set (~25 sold + curated on-market), NOT a
  single-metro collapse.
- `subject.fields.cap_rate == 0.0675` (and the other `fields.*` reflect the hydrated record) on
  every phrasing that resolves.
- A request with NO resolvable address (e.g. just "dialysis comps in Florida") still behaves as
  before — place resolution, "Not on file" where appropriate, no regression.

## Note for Scott (not part of this prompt — flagging for a decision)

The working `synthesize` set (166 comps) includes some caps ABOVE the subject's 6.75% (e.g.
implied ~7.08% on the Macon comp). For an APPRAISAL pull the standing rule is never to show a
higher cap / lower value than the subject. If we want appraisal mode to *filter/withhold*
higher-cap comps (vs. show the full market and let the appraiser judge), that's a separate,
deliberate change to the appraisal scope — tell me and I'll queue it. I did not encode a
value-supporting filter unilaterally.
