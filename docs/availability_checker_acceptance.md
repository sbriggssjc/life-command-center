# availability-checker — acceptance test runbook

**Round 76ej.g (2026-05-05)** — manual verification for the new Supabase
Edge Function `availability-checker` and its `lcc-availability-checker`
pg_cron job.

## What we're verifying

1. The worker correctly classifies real listings: ≥8/10 of a 5-active +
   5-sold sample matches what we know about each listing.
2. Each `url_status` change writes a `field_provenance` row tagged
   `source='availability_scraper'`.
3. The worker NEVER writes `check_result='sold'` (that path stays with
   the existing `lcc-auto-scrape-listings` cron).

## Pre-flight

- Edge Function deployed to LCC Opps (xengecqvemvfknjvbvrq):
  ```
  supabase functions deploy availability-checker --project-ref xengecqvemvfknjvbvrq
  ```
  `supabase/config.toml` pins `verify_jwt = false` for this function, so
  the gateway accepts our `LCC_API_KEY` Bearer header instead of demanding
  a Supabase-issued JWT. If you ever see `UNAUTHORIZED_NO_AUTH_HEADER`
  from the function it means the deploy ignored config.toml — re-deploy
  with `--no-verify-jwt` explicitly and confirm the file is present.
- Required env vars on the function:
  - `DIA_SUPABASE_URL`, `DIA_SUPABASE_KEY`
  - `GOV_SUPABASE_URL`, `GOV_SUPABASE_KEY`
  - `OPS_SUPABASE_URL`, `OPS_SUPABASE_SERVICE_KEY`
  - `LCC_API_KEY` (matches `vault.lcc_api_key` so the cron path works)
- Migration applied:
  - `supabase/migrations/20260505100000_lcc_availability_checker_cron.sql`
    — registers `availability_scraper` in `field_source_priority` and
    schedules the pg_cron job.

## Operator notes (gotchas surfaced by the first live run, issue #560)

- **Sample pool may be smaller than the picker queries assume.** The
  active-listings query is gated on `last_seen > now() - interval '30 days'`
  and the sold-listings query on `off_market_reason = 'sold'`; neither
  field is guaranteed to be populated. The first run found only 4 active
  rows and 0 sold rows in `dia.available_listings`. If the picker returns
  fewer than 10 candidates, supplement from public archived broker pages
  (see "Sourcing extra `gone` URLs" below) rather than running with a
  smaller sample at the same 8/10 bar.
- **`product.costar.com` URLs are paywalled CoStar Suite app links, not
  public listing pages.** They will 401 / redirect-to-login for
  unauthenticated fetches. The function's `shouldSkipHost()` filter only
  drops known tracking hosts, not these — but the parsers can't usefully
  classify them either way. Filter them out at sample-selection time
  (`AND al.listing_url NOT ILIKE 'https://product.costar.com/%'`) and file
  a follow-up to canonicalize CoStar URLs to the public
  `costar.com/property/...` form upstream in the sidebar pipeline.
- **`expected: "active"` on a CREXi-bot-blocked page will fail.** CREXi
  serves HTTP 403 with a challenge body to repeat callers from the same
  IP; the function correctly labels these `unreachable`, but the runbook's
  `active` tolerance set doesn't accept that. Two workarounds:
  - Re-run the script after the fetch IP cools off (CREXi's block is
    rate-window'd, not permanent), OR
  - Relabel the affected URLs as `expected: "gone"` (which accepts
    `unreachable`). Note that this is a deliberate truth-relaxation; the
    listing IS active, the parser just can't see it. The Round 76ej.h
    bot-block self-alert is the production-side response to this same
    signal.

### Sourcing extra `gone` URLs

When the dia picker returns fewer sold-truth candidates than needed, the
fallback is to hand-curate URLs from public archived broker pages.
Process:

1. Pull recently-sold dialysis properties from `sales_transactions`
   joined to `properties` (most recent 18 months, with addresses).
2. For each property, search CREXi/LoopNet for the address; archived
   "Sold" pages typically remain at their original `crexi.com/properties/<id>/...`
   or `loopnet.com/Listing/<address>/<id>/` URL.
3. Add the URL to `scripts/availability-checker-samples.json` with
   `"expected": "gone"`. The `gone` label accepts `off_market`,
   `off_market_sold_hint`, OR `unreachable` — covering both the
   ideal-case "Sold" banner match AND the common 404 / redirect-to-search
   that many archived pages produce.
4. Do NOT back-fill the URL into `dia.available_listings.listing_url`
   from the sample-curation step. If the URL turns out to be live and
   relevant, let the sidebar pipeline ingest it through its normal path
   so the field_provenance audit trail stays correct.

## Pick the sample (dialysis)

Run on the dia DB. We want listings with a populated `listing_url` that
are not already marked off-market.

```sql
-- 5 listings we believe are still active. Pick recent OM-promoted rows
-- that the sidebar/team has touched in the last 30 days.
SELECT al.listing_id,
       al.property_id,
       p.address,
       al.listing_url,
       al.last_verified_at,
       al.last_seen
FROM   public.available_listings al
JOIN   public.properties p ON p.property_id = al.property_id
WHERE  al.is_active IS TRUE
  AND  al.listing_url IS NOT NULL
  AND  al.listing_url ILIKE 'https://%crexi.com%'
  AND  al.last_seen > now() - interval '30 days'
ORDER BY al.last_seen DESC NULLS LAST
LIMIT 5;
```

```sql
-- 5 listings we believe are sold. is_active=false + off_market_reason='sold'
-- + a sales_transactions row in the property's window. The page should
-- now show a sold/withdrawn banner OR redirect to the search index.
SELECT al.listing_id,
       al.property_id,
       p.address,
       al.listing_url,
       al.off_market_date,
       al.off_market_reason,
       st.sale_id,
       st.sale_date
FROM   public.available_listings al
JOIN   public.properties p ON p.property_id = al.property_id
LEFT JOIN public.sales_transactions st
       ON st.property_id = al.property_id
      AND st.sale_date BETWEEN al.listing_date - interval '90 days'
                           AND al.off_market_date + interval '180 days'
WHERE  al.is_active IS FALSE
  AND  al.off_market_reason = 'sold'
  AND  al.listing_url IS NOT NULL
ORDER  BY al.off_market_date DESC NULLS LAST
LIMIT  5;
```

Note: the worker only pulls overdue listings, so for the test we'll bypass
the queue and feed each URL through the debug endpoint instead.

## Run the worker (per-URL, no DB writes)

For each of the 10 sample URLs:

```bash
curl -s -X POST \
  "${EDGE_BASE}/availability-checker?action=check_url" \
  -H "Authorization: Bearer ${LCC_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"${LISTING_URL}\"}" \
| jq '{final_url, http_status, parsed: {outcome: .parsed.outcome, parser: .parsed.parser, matched: .parsed.matched, notes: .parsed.notes}}'
```

Expected outcomes:

| Sample group | Expected `parsed.outcome` |
|--------------|---------------------------|
| Known-active CREXi listing | `still_available` (parser=crexi, http 200, no off-market markers) |
| Known-sold CREXi listing   | `off_market` or `off_market_sold_hint` (matched=`no longer available` / `sold` / redirect-to-search) |
| Known-active CoStar listing | `still_available` (parser=costar) |
| Known-sold CoStar listing   | `off_market` (parser=costar; CoStar typically redirects to search) |
| Known-active LoopNet listing | `still_available` (parser=loopnet) |
| Known-sold LoopNet listing   | `off_market` (parser=loopnet, banner match) |

**Acceptance bar: ≥8/10 verdicts match the known truth.** Misclassifications
to investigate:

- Known-active page returning `unreachable` → bot-block. Inspect with
  `curl -A 'Mozilla/5.0 ... Chrome/121' -i ${URL}` and adjust the parser's
  bot-block detector if needed.
- Known-sold page returning `still_available` → marker missing from
  `OFF_MARKET_GENERIC` or rendered only via JS. Add a server-rendered
  fragment to `parsers.ts` if one exists.

## Run the worker for real (writes DB)

Once the dry runs look right, run a full apply against the queue:

```bash
curl -s -X POST \
  "${EDGE_BASE}/availability-checker" \
  -H "Authorization: Bearer ${LCC_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"domain":"dia","limit":25,"dry_run":false}' \
| jq '.by_domain.dia | {scanned, off_market, off_market_sold_hint,
        still_available, unreachable, unreachable_promoted_to_off_market,
        manual_review_needed, errors: (.errors|length)}'
```

## Verify field_provenance writes

Run on **LCC Opps** (xengecqvemvfknjvbvrq):

```sql
-- Every url_status write the worker just produced should appear here
-- tagged source='availability_scraper'.
SELECT fp.recorded_at,
       fp.target_database,
       fp.record_pk_value AS listing_id,
       fp.value          AS new_url_status,
       fp.source,
       fp.decision,
       fp.decision_reason
FROM   public.field_provenance fp
WHERE  fp.field_name = 'url_status'
  AND  fp.source     = 'availability_scraper'
  AND  fp.recorded_at > now() - interval '1 hour'
ORDER  BY fp.recorded_at DESC;
```

Expected: one row per listing the worker updated, with
`decision IN ('write','skip')`. `skip` rows mean lcc_merge_field decided
the prior provenance outranked our scraper write — that's still a valid
audit-trail entry.

## Verify the worker did NOT write 'sold'

```sql
-- Run on dia and gov. The auto_scrape method maps to multiple workers;
-- we want to confirm THIS worker (notes prefix 'availability-checker')
-- never recorded check_result='sold'.
SELECT method, check_result, count(*)
FROM   public.listing_verification_history
WHERE  method = 'auto_scrape'
  AND  notes LIKE 'availability-checker%'
  AND  verified_at > now() - interval '1 day'
GROUP  BY method, check_result
ORDER  BY check_result;
```

Expected `check_result` values:
`still_available`, `off_market`, `unreachable`, `manual_review_needed`.
`sold` MUST NOT appear.

## Verify pg_cron is scheduled

```sql
-- Run on LCC Opps.
SELECT jobname, schedule, command
FROM   cron.job
WHERE  jobname = 'lcc-availability-checker';
```

Expected:
```
jobname                  | schedule     | command (truncated)
lcc-availability-checker | 30 */6 * * * | SELECT public.lcc_cron_post('/availability-checker', ...
```

## Rollback

To pause the cron without removing the function:

```sql
SELECT cron.unschedule('lcc-availability-checker');
```

To re-enable:

```sql
SELECT cron.schedule(
  'lcc-availability-checker', '30 */6 * * *',
  $$SELECT public.lcc_cron_post('/availability-checker',
      '{"domain":"both","limit":25}'::jsonb, 'edge')$$
);
```
