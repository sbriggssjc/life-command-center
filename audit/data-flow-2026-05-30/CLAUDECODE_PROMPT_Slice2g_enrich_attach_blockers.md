# Claude Code — Phase 2 Slice 2g: the two real enrich-attach blockers (post-deploy verification of Slice 2e)

## Why (grounded live 2026-06-11, after Slice 2e deployed)
Slice 2e (filename `City, ST` parse) is live and correct for its case, but enrich
attaches are STILL 0 / 224 staged. Live verification (walking real folders, reading
the `no_domain` disposition + the stored subject_hints) found the actual blockers —
TWO of them, neither addressed by Slice 2e:

### Blocker 1 (the big one, ~84%): out-of-domain asset classes
The PROPERTIES tree holds **all** of Briggs' deals — office, retail, bank, etc. —
but enrich-attach only resolves to the **dia** and **gov** property DBs. Of 224
staged enrich docs, **~189 are `no_domain`** (Vervent office, Top Golf, Santander
Bank, Vistra Corp …). They will NEVER match a dia/gov property, yet every tick they
re-emit a `match_disambiguation` decision and churn. Live counts:
`(no_domain) master 105, comp 32, bov 30, lease 16, om 6` vs only `dia ~24 / gov ~10`.

These aren't fixable by parsing — there's no home DB for an office property. The fix
is to **recognize and PARK them**, not churn them:
- When the path anchor yields **no dia/gov vertical cue AND no dia/gov match**,
  record `folder_feed_seen.status='skipped'`, `detected_type` kept, with a reason
  `out_of_domain_asset_class` (mirror the Slice-2f `excluded_archive_or_working`
  pattern). Do **NOT** call `emitMatchDisambiguation` for these — a non-dia/gov
  property is not an operator disambiguation, it's out of scope.
- This stops the disambiguation-lane churn (folder_feed_attach decisions) and makes
  the backlog honest: `out_of_domain` vs genuinely-attachable.
- (Doctrine note for Scott — NOT this slice: if Briggs ever wants office/retail
  tracked in LCC, that's a new asset-class domain, a much bigger lift. For now,
  parking is correct.)

### Blocker 2 (the in-domain ones, ~12): tenant-prefixed garbage city
The in-domain dia/gov docs that SHOULD attach mostly live in folders like
`PROPERTIES/Multi/DaVita Anchored - Tracy, CA/…(Master Sheet).xlsx`. The path-segment
city parser in `parseSubjectHintFromPath` greedily matches the whole segment with
`^(.+),\s*([A-Z]{2})$`, so it captures **`city = "DaVita Anchored - Tracy"`** (tenant
prefix included) instead of `"Tracy"`. Because a (wrong) city is now set, Slice 2e's
filename fallback never fires (it only runs when `hint.city` is null). Net: the
matcher gets a garbage city and never resolves. Live: ~12 of the 34 in-domain staged
docs carry a dash/tenant-prefixed city.

Fix the city extraction to take the city as the token **after the last `-`/`–`
separator** before `, ST`, in BOTH the path-segment parser AND the filename parser,
AND apply the cleanup even when a city is already set if that city still contains a
` - ` / tenant-prefix:
- `DaVita Anchored - Tracy, CA` → `Tracy` / `CA`
- `Stone Oak MOB - San Antonio, TX` → `San Antonio` / `TX`
- `KCMO - 4601 Madison - Kansas City, MO` → `Kansas City` / `MO`
- `Fairview Center MOB (DaVita) - Fairview Park, OH` → `Fairview Park` / `OH`
- (A plain `Tracy, CA` with no dash still → `Tracy` / `CA` — unchanged.)
Guard: only strip a prefix when there's a ` - ` (space-dash-space) BEFORE the
`, ST`; don't mangle a legit hyphenated city like `Winston-Salem, NC` (no spaces
around its hyphen — the space-dash-space guard handles this). Validate ST against
the existing `US_STATE_CODES`.

## After both fixes — re-process the stranded backlog
The 224 already-`staged` enrich rows are terminal (the worker only re-attempts
`status='seen'`), so they won't benefit until re-processed. Provide a bounded
re-process path (reuse the frontier `revisit_after`, OR a one-shot admin reset that
flips the dia/gov `staged` enrich rows back to `seen` and their frontier folders to
`pending`). Scope the reset to **dia/gov** rows (the out-of-domain ones should go
straight to `skipped/out_of_domain` on their next natural visit, no reset needed).
Cowork will run/verify the reset live after deploy.

## Tests / house rules
≤12 `api/*.js`; `node --check`; full suite green. Unit tests on the city parser:
each tenant-prefixed example above → correct bare city; `Winston-Salem, NC` →
`Winston-Salem`; `Tracy, CA` → `Tracy`. A folder-feed test: an out-of-domain doc
(no dia/gov cue/match) → `skipped`/`out_of_domain_asset_class`, NO disambiguation
emitted; an in-domain `Multi/DaVita Anchored - Tracy, CA` master → resolves + attaches
(or, if the city now parses but the property genuinely isn't in dia, → disambiguation,
which is correct).

## After deploy (Cowork verifies live)
- Out-of-domain enrich docs move to `skipped/out_of_domain_asset_class`; the
  `folder_feed_attach:%` disambiguation churn stops.
- After the bounded re-process, the in-domain `Multi/DaVita …` masters resolve and
  `property_documents source='folder_feed_properties'` rows finally appear on the
  right dia/gov properties with correct `document_type` — the first real enrich
  attaches.
- A context packet for one of those DaVita properties shows its attached master/BOV.

Ships on the Railway redeploy.
