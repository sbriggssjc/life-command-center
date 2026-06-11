# Claude Code — Phase 2 Slice 2e: parse City, ST from the FILENAME so PROPERTIES docs actually attach

## Why (grounded live 2026-06-11, against the running crawl)
The Slice-2d light-attach path has connected **0** non-OM working docs. Every one
of ~175 attempts (master / comp / BOV / lease) routed to the `match_disambiguation`
lane (166 superseded + 9 open, churning) instead of attaching. Root cause is a
folder-structure assumption that doesn't hold:

`parseSubjectHintFromPath` (api/_shared/folder-feed-classify.js) expects
`PROPERTIES/<bucket>/<tenant>/<City, ST>/<files>` — it only reads "City, ST" from a
**path segment**. The ACTUAL tree has **no City, ST folder level**; files sit
directly under the tenant folder and the city/state live in the **filename**:

```
PROPERTIES/V/Vervent/Vervent - Portland, OR (Master Sheet).xlsx
PROPERTIES/F/First Oklahoma Federal Credit Union/First Oklahoma Federal Credit Union - Tulsa, OK (Master Sheet).xlsx
PROPERTIES/V/Vistra Corp/Vistra Corp (UNIFIED) - Irving, TX (Master Sheet).xlsx
PROPERTIES/Portfolio/Thrive Portfolio/Thrive - San Antonio, TX (Master Sheet).xlsx
PROPERTIES/Portfolio/Top Golf Portfolio 2 - HEDRICK/Master Sheet - Colony, TX.xlsx
```

So `subject_hint.city`/`state` come back **null** on essentially every file,
`matchByPathAnchor` bails immediately (`if (!tenant || !state) return unmatched`),
and the doc is sent to disambiguation. The tenant_brand parses fine; only city/state
are missing. Adding a filename parse unlocks the whole non-OM attach path.

## The change — Unit 1: filename City, ST fallback (the fix)
In `parseSubjectHintFromPath` (folder-feed-classify.js), after the existing
path-segment passes leave `hint.city` null, parse the **last segment (the
filename)**:
- Strip the extension and any trailing `(...)` label group.
- Match a trailing-ish `…- <City>, <ST>` token. Suggested regex (anchored on the
  separator + 2-letter state, allowing spaces/periods/hyphens in the city):
  `/[-–—]\s*([A-Za-z][A-Za-z .'\/-]*?),\s*([A-Z]{2})\b/`
  Take the **last** match in the filename (city tokens sit near the end, before the
  `(Master Sheet)` / `- Valuation Analysis Memo` label). Validate the state against
  the existing `normalizeState` / US-state set so things like "- SF, " or random
  2-caps don't false-positive.
- Only fill `hint.city`/`hint.state` when BOTH parse and the state is a real US
  state; never overwrite a value a path segment already produced.
- Keep tenant_brand exactly as today (the folder name). The filename parse is
  city/state ONLY.

Verified targets the regex must capture: Portland/OR, Tulsa/OK, Irving/TX, San
Antonio/TX, Alpharetta/GA, Colony/TX. Must NOT capture from a pure rollup name like
`ARA Portfolio of 5 - Master Sheet.xlsx` (no `, ST`) — that correctly stays null.

## Unit 2 — portfolio-rollup docs: stop churning the disambiguation lane
Some files are true multi-property rollups with NO city in the filename
(`ARA Portfolio of 5 - Master Sheet.xlsx`, `North American Dental Group Portfolio
of 10 - …`). They legitimately don't map to one property. Today they emit
disambiguation every tick and supersede — pure noise.
- Detect the rollup case: bucket/segment `Portfolio` **and** the filename/tenant has
  no resolvable City, ST after Unit 1. (A tenant like `… Portfolio of N` or `…
  Portfolio (N) - ST` is a strong signal.)
- For rollup docs, **record `folder_feed_seen.status='skipped'`** with
  `detected_type` + a reason (`portfolio_rollup_no_city`) and **do NOT emit a
  match_disambiguation decision**. They're a known, parked category — not an
  operator decision. (A later slice can attach a rollup doc to ALL member
  properties or a portfolio entity; out of scope here.)
- This is in `api/_handlers/folder-feed.js` (the enrich attach branch) and/or
  `folder-feed-attach.js`: when the subject_hint has tenant but no city/state AND
  looks like a portfolio rollup, return a `skipped`/`parked` result instead of
  calling `emitMatchDisambiguation`. Non-rollup unresolved docs still go to
  disambiguation as today (that's the correct lane for a genuinely ambiguous single
  property).

## Unit 3 — carry detected_type → property_documents.document_type (the original flag)
Separate, smaller: docs that DO land via the OM extraction path are all typed `om`
in `property_documents` even when the classifier detected master/comp/BOV/lease, so
the context packet can't tell a lease from a comp. Where the folder-feed promoter
writes the `property_documents` row, set `document_type` from
`seed_data.detected_type` (fall back to `om` only when unknown). The light-attach
path (`attachEnrichDocument`) already passes the classified `docType` — keep that;
this unit is only the OM-extraction promoter path. Don't change the email/sidebar
channels' typing.

## Don't break
- Ingest mode (On Market) is unchanged — this only affects how city/state are
  derived; On Market OMs already carry city/state from the cover page.
- The matcher's confident-single-match → attach, >1 → disambiguation contract is
  unchanged. We're only feeding it a city/state it was missing.
- A tenant+city that legitimately maps to multiple clinics in one city (real
  ambiguity) still correctly routes to disambiguation — that's right, not a bug.

## Tests / house rules
≤12 `api/*.js`; `node --check`; full suite green. Unit tests on
`parseSubjectHintFromPath`: each verified filename above → correct city/state;
rollup names → null; a path that DOES have a `City, ST` segment still wins over the
filename; junk 2-caps (`- Memo, XX` where XX isn't a state) → null. A
folder-feed-attach test: tenant+filename-city resolving to one property → `attached`
(not disambiguation); a portfolio-rollup-no-city file → `skipped`/parked, no
decision emitted.

## After deploy (Claude/Cowork verifies live)
- Re-walk a few already-seen tenant folders (Vervent, Vistra Corp, First Oklahoma
  FCU): `folder_feed_seen.status` flips from `staged`→`attached`;
  `property_documents` rows appear on the right dia/gov property with the correct
  `document_type` (master/comp/bov/lease, not `om`); `field_provenance`
  `source='folder_feed_properties'` rows land.
- `match_disambiguation` from `folder_feed_attach:%` stops growing; the open rollup
  decisions can be swept.
- A context packet for one of those properties shows its full working-doc set.

Ships on the Railway redeploy; no migration needed (status values already allow
skipped/attached; provenance priority rows already registered in 20260718124000).
