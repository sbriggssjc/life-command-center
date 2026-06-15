# Claude Code prompt — FOLLOW-UP: move the multi-tenant folder gate into the shared choke point (`attachLeaseDoc`)

> Follow-up to PR #1195 (merged + live 2026-06-15). The guards work — but the
> independent post-deploy gate found the folder-class gate is wired ONLY into the
> crawl path (`folder-feed.js`) and the **backfill path bypasses it**. The full
> 303-lease backfill stays HELD until this lands and is gate-verified.
>
> Same discipline: receipts-first, dry-run → independent SQL/endpoint verification →
> resume. ≤12 `api/*.js`.

## The finding (live, read-only — no writes)
A GET dry-run on the deployed app immediately after the redeploy:
`GET /api/lease-backfill?limit=25` → eligible 25, and **item id 1803** is:
`/sites/TeamBriggs20/Shared Documents/PROPERTIES/Multi/DaVita Anchored - Springfield, IL/Rec'd/Hertz (6994.505)- First Amendment to Lease - 2936 S 6th St Springfield IL FULLY EXECUTED.pdf`
— `status='attached'`, still **eligible**, NOT parked. That's the FULLY-EXECUTED
sibling of the exact `/Multi/` Hertz doc we just cleaned (lease 25312 contamination).

If the full backfill drained now, id 1803 would be selected, resolve to the
mis-ingested unit (dia property 40041), and **re-create a Hertz lease there** — the
cross-attribution guard would withhold the bad guarantor, but the multi-tenant lease
gets re-minted anyway, because the PRIMARY gate (don't mint a domain lease from a
`/Multi//Portfolio/` folder) is not on this path.

## Root cause (confirmed by code read)
- `isMultiTenantDealFolderPath` (in `api/_shared/folder-feed-classify.js`) is referenced
  ONLY by `api/_handlers/folder-feed.js` — i.e. the crawl/auto-route path.
- `api/_handlers/lease-backfill.js`:
  - `fetchEligibleLeaseDocs` filters `detected_type=eq.lease & status=in.(staged,attached)
    & vertical=in.(dia,gov) & subject_hint->>lease_backfilled_at=is.null` — **no path
    gate**, so `/Multi//Portfolio/` rows stay in the queue.
  - `backfillOneLeaseDoc` calls `attachLeaseDoc({storageRef, fileName, subjectHint,
    pathRef, ...})` directly.
- `attachLeaseDoc` (in `api/_handlers/lease-extractor.js`) has **no**
  `isMultiTenantDealFolderPath` check. So every caller of `attachLeaseDoc` that isn't
  `folder-feed.js` bypasses the primary gate.

## The fix — gate at the shared choke point, not per-caller
Move/add the folder-class gate **inside `attachLeaseDoc`** so EVERY path inherits it
(crawl auto-route, backfill, and any future caller), single source of truth:

1. In `attachLeaseDoc` (lease-extractor.js), at the very top — before any byte fetch /
   classify / extract — check `isMultiTenantDealFolderPath(pathRef || storageRef)`. If
   true, return a terminal, non-enriching result the callers already understand, e.g.
   `{ ok:true, multitenant_deferred:true, skip_reason:'multitenant_deal_folder' }`.
   Do NOT fetch bytes, do NOT run the extractor, do NOT resolve/create a domain lease.
2. Keep the existing `folder-feed.js` gate as-is (it parks at the crawl layer before
   `attachLeaseDoc` is even called — harmless redundancy, and it avoids a wasted call).
   The point is that the EXTRACTOR itself now refuses, so the backfill can't sneak past.
3. `lease-backfill.js` — map the new result to a backfill outcome:
   - Add a `multitenant_deferred` counter to the result object, increment it on that
     outcome, and **mark the row backfilled** with `{outcome:'multitenant_deferred'}`
     (terminal — it should drop out of the eligible queue so it isn't re-listed every
     tick). It is NOT an error and NOT enriched.
   - Optionally also exclude these at SELECTION (a `server_relative_path` `not.ilike`
     filter for `%/Multi/%`, `%/Multitenant/%`, `%/Portfolio/%`, `%/Portfolios/%`) so a
     dry-run's `eligible` count reflects reality — but the `attachLeaseDoc` gate is the
     guarantee; the selection filter is just cosmetic accuracy. (If you add the ILIKE
     filter, mirror the EXACT segment semantics of `isMultiTenantDealFolderPath` —
     whole-segment, so "Multimedia"/"Multifoods"/a tenant literally named with "portfolio"
     don't false-positive. Whole-segment ILIKE needs the surrounding slashes, e.g.
     `%/Multi/%`, which is why the JS helper stays the source of truth.)

## Tests
- A backfill-path unit test (extend `test/folder-feed-multitenant-guard.test.mjs` or a
  new `test/lease-backfill-multitenant.test.mjs`): an id-1803-shaped row
  (`/PROPERTIES/Multi/DaVita Anchored - Springfield, IL/Rec'd/Hertz … FULLY EXECUTED.pdf`)
  driven through `backfillOneLeaseDoc` (stubbed deps) yields outcome
  `multitenant_deferred`, calls `markBackfilled`, and **never calls the extractor's
  fetch/resolve/create** (assert `attachLeaseDoc`'s internal extract dep is not invoked,
  or that the stubbed bytes-fetch is never called).
- An `attachLeaseDoc`-level test: a `/Portfolio/` pathRef returns
  `multitenant_deferred:true` with no byte fetch.
- A negative test: a single-tenant path (e.g. `/PROPERTIES/D/DaVita/Conyers, GA/Rec'd/…`)
  still extracts normally — no regression to the clean path.

## Acceptance (gate, after merge + redeploy)
- `GET /api/lease-backfill?limit=25` no longer lists id 1803 (or any `/Multi//Portfolio/`
  lease doc) as eligible — they show `multitenant_deferred` / drop out.
- A capped POST drain over a batch that INCLUDES a `/Multi/` doc parks it
  `multitenant_deferred` (0 leases created for it, 0 edges), while single-tenant docs in
  the same batch enrich normally.
- I independently verify in the DB: no new lease on property 40041, no new
  `guaranteed_by` edge to asset 40041, no `folder_feed_lease` write provenance for 40041.
- THEN the full 303-lease backfill resumes (repeated capped POSTs).

## Guardrails
- One choke point — the gate goes in `attachLeaseDoc`; do not duplicate the policy
  per-caller. Reuse `isMultiTenantDealFolderPath`; do not re-implement the segment match.
- No writes from the dry-run; the backfill stays HELD until acceptance passes.
- Don't touch the cleaned records (dia leases 25312/19530/14365; the two clean
  `guaranteed_by` edges; the `superseded` provenance row 1403859).
