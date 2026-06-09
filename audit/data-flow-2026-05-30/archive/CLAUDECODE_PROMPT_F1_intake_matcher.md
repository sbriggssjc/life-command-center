# Claude Code prompt — F1–F3/F7: intake matcher normalization + retro re-match

Paste into Claude Code, run from the **life-command-center** repo. This is the
headline fix from the 2026-06-04 intake audit: the OM-intake matcher is missing
**layup matches**, stranding real deals in a 2,705-item `review_required` pile
(growing ~142/week).

---

## Context (verified in LCC Opps + dia DB, 2026-06-04 — don't re-investigate)

Recent `review_required` intakes with an extracted address are uniformly
`match_status='unmatched'`. Sampled single-address dialysis OMs: **3 of 3 exist
in the dia `properties` table** and failed purely on street normalization:

| OM extraction | dia DB row |
|---|---|
| `198 N Springfield Ave` | prop 37106 `198 North Springfield Avenue` (Rockford IL — the exact DaVita clinic the OM markets) |
| `1809 West Chapman Avenue` | prop 30659 `1809 W Chapman Ave` (Orange CA — exact FMC clinic) |
| `506 N Patterson St` | prop 25076 `506 North Patterson St` (Valdosta GA — exact USRC clinic) |

Three more defects compound it:
- **Multi-property OMs** put ALL addresses in one field — as a JSON-array string
  (`["1208 Scottsville Road", "350 Preakness Avenue"]`), pipe-join, or
  semicolon-join → guaranteed unmatched.
- **Domain misrouting**: "Fresenius Medical Care - Jacksonville - FL - OM.pdf"
  (tenant "Bio-Medical Applications of Florida" = Fresenius = dialysis) ran with
  `match_domain: "government"`.
- **The persisted summary drops city/state**: the extractor's AI schema requests
  them and `mergedSnapshot.city/state` exist in-flight
  (`api/_handlers/intake-extractor.js` ~lines 331-332, 800-802), but the
  summary written to `staged_intake_items.raw_payload.extraction_result`
  (~lines 693-696) keeps only `address/tenant_name/asking_price/cap_rate` —
  every review row shows city NULL, blinding the review UI and forensics.

## Task

### 1. Normalize addresses in the intake match path
Find where the OM intake pipeline matches the extracted address against domain
`properties` (the path that sets `match_status`/`match_property_id` — likely in
`api/_shared/intake-om-pipeline.js` / the promoter/matcher it calls). Introduce a
shared `normalizeStreetAddress()` (new helper in `api/_shared/`) applied to BOTH
sides of the comparison:
- directionals: N/S/E/W ↔ North/South/East/West (incl. NE/NW/SE/SW forms)
- suffixes: Ave↔Avenue, St↔Street, Blvd↔Boulevard, Dr↔Drive, Rd↔Road, Ln↔Lane,
  Ct↔Court, Pkwy↔Parkway, Hwy↔Highway, Pl↔Place, Ter↔Terrace
- case/punctuation/whitespace collapse; strip unit/floor/suite suffixes
  ("FIRST FLOOR", "STE 4", "#B")
- compare on the normalized form; when city/state are available, use them to
  disambiguate multi-city street collisions (don't require them — street+state
  match with a unique hit should still match)
Check first whether a normalization helper already exists in the JS stack
(the sidebar pipeline or entity-link may have one) — reuse, don't duplicate.

### 2. Split multi-property addresses
Before matching: if the extracted `address` parses as a JSON array, or contains
`|` or `;` separators with multiple street-number patterns, split into
individual addresses (pair with the corresponding `tenant_name` entries when
they're parallel arrays/joins) and run match-per-address. An OM matching ≥1
property should attach to those properties (multi-attach or primary+notes —
follow whatever the promoter supports; if only single-attach is supported, match
the first and record the rest in the intake for review). Also fix the extractor
side if it's emitting a literal JSON array as a string — the schema should
return an array field (e.g. `addresses[]`) rather than a stringified list.

### 3. Fix domain routing
Find how `match_domain` is chosen (seed `source_vertical`, filename, or tenant).
The Jacksonville case shows a dialysis OM routed to gov. Add a
tenant-keyword/operator-name check (Fresenius, DaVita, US Renal, Bio-Medical,
dialysis, etc. — an operator list likely already exists in the dia stack) that
overrides/flags a conflicting seed vertical, and when the chosen domain yields
`unmatched`, **try the other domain before parking in review** (cheap second
query; record which domain matched).

### 4. Persist city/state in the summary
Add `city`/`state` to the persisted `extraction_result` summary (the ~line
693-696 object and the ~800-802 path) so review/forensics can see them.

### 5. Retro re-match the purgatory pile  (the payoff)
Add a worker route (admin.js `?_route=intake-rematch`, mounted in server.js +
vercel.json like its siblings; **no new api/*.js — stay at 12**) that walks
`staged_intake_items` `status='review_required'` with a non-null extracted
address, re-runs the improved match (normalization + splitting + cross-domain),
and for hits: re-runs the existing promotion path and advances status to
`matched`/`finalized` exactly as a fresh intake would (reuse the pipeline's own
functions — don't reimplement promotion). Batch-limited (e.g. 100/tick),
idempotent, dry-run on GET / drain on POST (follow the `llc-research-tick`
worker pattern). Schedule a pg_cron tick (every 30 min, `lcc_cron_post`) until
the backlog drains, then it idles cheaply.

## Verify + ship
- Unit-test `normalizeStreetAddress` with the three real pairs above (all must
  match) + the multi-address split cases (JSON-array string, pipe, semicolon).
- Dry-run the rematch worker and report: of the ~2,705 review items, how many
  now match (expect a meaningful slice — report the number in the PR).
- Live: a fresh OM for an existing property with an N/Ave-style variant matches
  and promotes; the Jacksonville-style misroute matches in dia via cross-domain
  fallback; review rows persist city/state.
- `node --check` all touched files; `ls api/*.js | wc -l` = 12; migrations (cron)
  idempotent. End with merge + deploy commands (note the cron migration applies
  after the worker route deploys, same ordering rule as prior workers).
