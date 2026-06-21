# UW#6-REV — capture document bytes at sidebar time

## Why (the BLOCKED finding that killed the original UW#6)
A capped real drain of the R58 `document-text-tick` returned **20/20
`fetch_failed`**. Root cause: `property_documents.source_url` is a CoStar-CDN
signed/token path (`ahprd1cdn.csgpimgs.com/d2/<token>/…`) that is **session-gated
and short-lived** — a doc captured the same day already 403s server-side, and
`property_documents` stored only the URL, never the bytes. So R58's deferred
server-side re-fetch could never work as architected. (Confirmed again here: a
direct `curl` of a gov deed URL from the server returns HTTP 403.)

The fix is **upstream byte-capture**: download the bytes inside the live CoStar
session (the browser HAS the session the server lacks) and store them durably,
mirroring the OM-intake Storage pattern.

## What ships
- **DB (dia + gov):** `property_documents` gains `storage_path` / `storage_bucket`
  / `content_hash` + a `(property_id, content_hash)` idempotency index. A new
  **dedicated, NON-PRUNED** `property-documents` Storage bucket per domain (deeds
  / leases / loan docs are source-of-record, unlike the transient
  `lcc-om-uploads` staging store). Co-located with the row in the domain project.
  Migrations: `Dialysis/supabase/migrations/20260621_dia_uw6_rev_…`,
  `government-lease/sql/20260621_gov_uw6_rev_…` (applied live 2026-06-21).
- **Server (extends the existing Path C, no fresh transport):**
  - `prepare-upload` (`intake-prepare-upload.js`) now takes
    `{ target:'property_document', domain, doctype, property_id, content_hash,
    file_name }` and mints a signed-upload URL against the **domain**
    `property-documents` bucket (deterministic key
    `<domain>/<doctype>/<property_id>/<content_hash>.<ext>`). The domain service
    key never leaves the server. Unset `target` ⇒ the original OM behavior
    (LCC `lcc-om-uploads`). Signed-URL minting is now a shared `mintSignedUpload`
    helper (reuse, not fork).
  - **`POST /api/intake/document-notify`** (`intake-document-notify.js`, sub-route
    of intake.js — no new api/*.js) records the pointer on `property_documents`
    in the right domain DB. Idempotent on `(property_id, content_hash)`; ATTACHES
    to an existing `url_captured` row (same file) instead of duplicating; server
    **re-validates the doctype** (a "?" unknown is filed `other`, never
    mis-routed).
  - **Storage-first read** (`document-text.js`): `fetchDocBytes` /
    `extractDocumentText` try `storage_path` (domain Storage, always fetchable)
    FIRST, fall back to `source_url` only inside the live-token window. The
    `document-text-tick` worker's eligibility now includes `storage_path` and it
    binds a domain Storage getter per row. So the deep-parse (deed → grantor /
    consideration / R51 feed + sales cross-ref; lease; OM) runs off durable bytes.
- **Extension:** `background.js` `STAGE_DOC_BYTES_TO_LCC` fetches each
  deep-parse doc in-session, computes a sha-256 `content_hash`, runs
  prepare-upload → PUT-to-Storage → notify. `sidepanel.js` fires it per
  `document_links` entry after a capture resolves a `domain_property_id` (deed /
  lease / om / dd / master / bov only). `*.csgpimgs.com` + `*.supabase.co` are
  already in `host_permissions`.

## The legacy backlog needs RE-CAPTURE (not faked)
The existing ~325 dead-URL deeds + ~1,600 docs hold dead tokens — the server
**cannot** re-fetch them. They recover only by re-capture in CoStar:
(a) automatically on the next CoStar encounter (the new byte-capture catches them
going forward), or (b) a one-time deliberate re-visit sweep of high-value deeds.
Do NOT pretend a server drain can recover them.

## Gate (post-deploy, Scott)
1. Open a CoStar property with a deed/lease/OM doc in the sidebar and capture.
2. Confirm in the domain DB: `property_documents` for that property has
   `storage_path` + `storage_bucket='property-documents'` + `content_hash` set
   and `ingestion_status='bytes_captured'`.
3. `POST /api/document-text-tick?doctype=deed&domain=both&limit=5` → that doc
   parses **from Storage** (`via:'storage'`), `0 fetch_failed`, grantee feeds the
   R51 `owner_source_conflict` lane.
4. Re-capture the same doc → notify returns `outcome:'idempotent'` (no duplicate).

## Boundaries
Bytes in Storage, never inline in Postgres (the R15/R18 disk-incident lesson).
Dedicated retained bucket (no prune). Fill-blanks deep-parse unchanged (R58).
≤12 api/*.js. Additive + reversible — drop the columns / bucket → zero trace.
