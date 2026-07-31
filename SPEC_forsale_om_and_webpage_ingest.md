# SPEC — For-Sale embedded-OM capture + external property-webpage ingest (2026-07-31)

CoStar's redesigned **For-Sale** detail page (`/listings/for-sale/detail/<id>/…`) changed two
things the LCC sidebar ingestion doesn't handle:

1. The **OM is now embedded inline** in the page as a **"Marketing Brochure"** section (an embedded
   viewer + an "open in new tab" control) instead of a plain anchor in the "Documents" card. The
   sidebar therefore never captured or extracted it.
2. The page links out to the **broker's property webpage** (e.g. the brokerage listing page). We
   never grabbed those URLs, so nothing crawls them for later availability re-checks or proactive
   detail enrichment.

This spec covers three parts.

---

## Part A — capture + extract the embedded Marketing Brochure as an OM

**Root cause.** `extractDocumentLinks()` (costar.js) scans anchors inside a "Documents" card; the
new layout embeds the brochure in a viewer, so its URL is missed. Even when a doc link is found, the
sidebar's auto byte-capture only fires for `DEEP_PARSE_DOCTYPES = {deed,lease,om,dd,master,bov}` and
"Marketing Brochure" infers to `other`, so it is skipped. And the captured-doc path
(`STAGE_DOC_BYTES_TO_LCC → document-notify`) only stores a **pointer** in `property_documents`; it
does **not** run OM AI extraction (extraction only happens via `stage-om → stageOmIntake`, and that
reads storage from **LCC Opps**, a different Supabase project than the domain `property-documents`
bucket — so a document-notify pointer cannot be fed to it directly).

**Design.** Route the embedded brochure through the **same proven path as a manual OM upload**, but
with bytes fetched from the live CoStar tab (the CDN signed URL is bound to the in-tab session):

- `extension/content/costar.js`
  - `extractMarketingBrochure()` — on `/for-sale/` or `/for-lease/` listing pages, find the
    "Marketing Brochure" / "Offering Memorandum" section and pull the document URL from an anchor or
    the embedded `iframe/embed/object`. Returns offering-material doc links
    `{label,url,type:'marketing_brochure',is_offering_material:true,source:'forsale_brochure_embed'}`.
    Merged (deduped) into `data.document_links`. Pure helpers (`classifyBrochureHref`) unit-tested.
- `extension/sidepanel.js`
  - Add `marketing_brochure` to `DEEP_PARSE_DOCTYPES`; recognize it in `inferDocType`. For any doc
    with `is_offering_material` (or doctype ∈ `{om, marketing_brochure}`), send the new
    `STAGE_OM_VIA_TAB` message with seed data (address/price/cap/tenant from the page context).
  - **Dedup guard** (`chrome.storage.local`, key `omAutoStaged:<domain>:<propertyId>`, TTL 30d) so
    the OM is staged/extracted **at most once per property** — auto-capture reruns on every render,
    and OM extraction costs AI tokens.
- `extension/background.js`
  - `STAGE_OM_VIA_TAB` handler: `fetchDocBytesViaTab(sourceUrl)` → OM **Path C**
    (`prepare-upload` intake_channel=sidebar → PUT → `stage-om{storage_path}`) with `seed_data`.
    Mirrors the manual `STAGE_PDF_BYTES_TO_LCC` Path C exactly (proven), just sourced from the tab.
- `api/_handlers/intake-document-notify.js`
  - Add `marketing_brochure` to `KNOWN_DOCTYPES` (so a brochure byte-capture that still goes the
    property-documents route is typed, not downgraded to `other`).

**Cost control.** OM extraction fires once per property (client dedup) and `stageOmIntake` is
idempotent-ish; the brochure isn't re-extracted on every browse.

---

## Part B1 — capture the external property-webpage URL + persist onto the listing

**Root cause.** The sidebar never writes a listing URL onto the domain listing row
(`available_listings.listing_url`/`source_url` left NULL), so sidebar-captured listings are
classified `manual_research` and the existing `availability-checker` never re-crawls them.

**Design.**
- `extension/content/costar.js`
  - `extractExternalListingUrls()` — on for-sale/for-lease pages, capture external http(s) links
    that **either** match a broker email domain found on the page (strong signal — e.g.
    `jimmy@bouldergroup.com` ⇒ keep `bouldergroup.com` links) **or** carry a website-ish label
    ("website", "view listing", "property site", "learn more"). Excludes CoStar/Google/social/CDN.
    Returns `data.listing_external_urls = [{url,label,host,matched_broker_domain}]`. Pure helpers
    (`isExcludedHost`, `pickExternalListingUrls`) unit-tested.
- `extension/background.js` — preserve `listing_external_urls` across sub-tab context merges.
- `api/_handlers/sidebar-pipeline.js`
  - Persist the primary external URL (prefer a broker-domain match) onto the listing row
    fill-blanks: dia `available_listings.listing_url`, gov `available_listings.source_url`. Tag
    provenance `costar_sidebar`. Activates the existing availability-checker recrawl.

---

## Part B2 — save the HTML for later web-crawl + proactive detail enrichment

**Design (LCC Opps — the brain).** A durable registry of external listing/property webpages + an
append-only HTML-snapshot ledger + a server-side crawl worker (Railway egress is open; the extension
can't fetch arbitrary broker sites).

- **Migration** `supabase/migrations/20260731xxxxxx_lcc_listing_web_pages.sql` (additive, reversible):
  - `lcc_listing_web_pages` — registry: `id, domain, property_id, url (unique per domain+property),
    label, source, first_seen_at, last_crawled_at, last_http_status, last_availability, active,
    next_crawl_at, consecutive_failures, created_at, updated_at`.
  - `lcc_listing_page_snapshots` — append-only per-crawl: `id, page_id FK, fetched_at, http_status,
    content_hash, storage_bucket, storage_path, byte_size, availability, extracted_json, notes`.
    Dedup on `(page_id, content_hash)` (a re-crawl with identical HTML records status but reuses the
    prior snapshot object).
  - private Storage bucket `listing-page-snapshots`.
  - `v_lcc_listing_page_crawl_worklist` — due pages, value-ranked, actionable-only.
  - `feature_flags_registry` row for the proactive-AI-extraction toggle
    (`LISTING_PAGE_PROACTIVE_EXTRACT`, default off).
- **Worker** `api/_handlers/listing-page-crawl.js`, mounted in `server.js`
  (`/api/listing-page-crawl`; also dispatchable as `operations ?_route=`): selects due pages (cap
  top-N, value-ranked), server-side `fetch`, stores raw HTML to the bucket, inserts a snapshot,
  updates the registry (`last_*`, `next_crawl_at`), detects availability from HTTP status + page-text
  markers (`sold`, `under contract`, `no longer available`, `off market`, 404/410). Consumption-Layer:
  value-gated, **auto-retire** (`active=false` after N consecutive failures/unavailable, reversible),
  capped, honest counts. Proactive AI detail extraction is flag-gated (off by default) and only runs
  on genuinely-changed HTML (new `content_hash`).
- **Schedule** pg_cron on LCC Opps via `lcc_cron_post` (registry insert in the migration).

**Reversal.** Drop the two tables + bucket + view + cron + flag row (runbook in the migration header).

---

## Verification honesty

- Extension DOM extractors: pure-helper unit tests in-repo; the live-DOM path validated by Scott in
  the browser against the new For-Sale layout (sandbox has no CoStar session).
- OM extraction (`stage-om`) + the crawl worker's live `fetch`/AI: exercised with stubs in tests;
  end-to-end requires the live session / Railway egress / AI keys (validated post-deploy).
- Migration is additive/reversible and applied to LCC Opps (`xengecqvemvfknjvbvrq`).
