# Claude Code (LCC) — capture deed bytes at ingestion (stop losing the capture)

We are losing the deed. When the sidebar captures a document link, we store the CoStar CDN
URL and never the bytes; the CDN links (`ahprd1cdn.csgpimgs.com`) expire, and 120 gov deeds
now sit permanently unprocessable. Fix the loss at the source, then recover what's recoverable.

## Grounded root cause (live, 2026-07-22)

`api/_handlers/sidebar-pipeline.js::upsertDocumentLinks` (~line 2258) writes only:

```js
{ property_id, file_name, document_type, source_url: doc.url, ingestion_status: 'url_captured' }
```

The bytes are never fetched. Meanwhile `api/_handlers/document-text.js::fetchEligibleDocs`
**requires `storage_path IS NOT NULL`** — and deliberately excludes URL-only docs, because their
CDN links expire and re-clog the queue (that exclusion is correct; don't touch it). So a
`url_captured` doc with no `storage_path` can NEVER be processed. Live state (gov
`scknotsqkcheojiaewwh`): 120 deeds `url_captured`, `storage_path=NULL`, links dead.

The CDN link IS valid at the moment of capture — we just never fetch it then. That is the fix.

## What to build

### Unit 1 — fetch + store the bytes at ingestion (the forward fix)

In `upsertDocumentLinks`, after the row upsert succeeds, **fetch the document bytes from
`doc.url` while the link is fresh and upload them to the domain `property-documents` Storage
bucket, then PATCH `storage_path` (+ `storage_bucket`, `ingestion_status='bytes_captured'`) onto
the row.**

- **Reuse the existing storage helper** — `api/_shared/artifact-storage.js` (the OM-intake
  upload/download path) already writes to a domain Storage bucket. Do not fork an uploader.
  Confirm the bucket name the `document-text-tick` worker reads (`buildStorageGet` defaults to
  `'property-documents'`) and write to the same one so the worker picks it up with no change.
- **Deterministic object path** keyed on `(domain, property_id, document_id or file_name)` so a
  re-capture overwrites rather than duplicates. Idempotent.
- **Strictly additive / best-effort:** the byte fetch + upload is wrapped so ANY failure (dead
  link, timeout, non-PDF, size cap) leaves the `url_captured` row exactly as today and never
  blocks the capture or the rest of the sidebar pipeline. A capture that can't fetch bytes is no
  worse than today; a capture that can is now permanently saved.
- **Bound it:** a size cap (mirror the OM `INTAKE_OCR_MAX_BYTES` posture) and a short fetch
  timeout, so a giant or hung download can't stall the sidebar write path.
- **Provenance:** record the storage capture the same way the row write is recorded
  (`pushProvenance` already runs for the doc row).

Result: the `document-text-tick` worker (unchanged) now finds these docs storage-ready and
extracts text → deed parse → grantee → `latest_deed_grantee` → the R51 owner-conflict lane. That
downstream chain already works (105 deeds parsed, 5,899 properties carry a grantee).

### Unit 2 — refetch-or-retire the 120 URL-only backlog

A bounded worker pass (a sub-route or a mode on the existing `document-text-tick`, GET dry-run /
POST drain) over `property_documents WHERE document_type ILIKE '%deed%' AND raw_text IS NULL AND
storage_path IS NULL AND source_url IS NOT NULL`:

- Try the stored `source_url` once. On success → store bytes + `storage_path` (becomes
  processable, drops into Unit 1's path). On a dead/expired link (any fetch failure) → set a
  **terminal `ingestion_status='url_expired'`** so it stops counting as pending work and is never
  re-hammered. Honest count — a retired doc is marked, not silently left in `url_captured`.
- Report `refetched`, `retired_url_expired`, `still_pending`. Expect most of the 120 to retire
  (links are ~weeks old); the value is Unit 1, not this recovery. Reversible: `url_expired` is a
  status flip, not a delete.

## Boundaries

LCC-only (writes to the domain `property-documents` bucket + `property_documents` rows via the
existing `domainQuery`) · reuse `artifact-storage.js`, do not fork an uploader · byte capture is
best-effort and never blocks the sidebar write · `document-text.js::fetchEligibleDocs` stays
storage-only (don't re-add the URL fallback that starved the queue) · no SF writes · reversible ·
no new `api/*.js` if avoidable (Unit 2 is a mode on the existing worker).

## Verify

1. `npm run check:boot`, full suite.
2. Unit 1: simulate a sidebar doc capture with a reachable test URL → confirm the row gets a
   `storage_path`, the bytes land in the bucket, and a subsequent `document-text-tick` extracts
   text from it. Confirm a capture with an unreachable URL still writes the `url_captured` row and
   does not throw.
3. Unit 2: GET dry-run reports the 120; a capped POST reports refetched vs retired. Confirm a
   retired doc flips to `url_expired` and drops out of the pending set on re-run (idempotent).
4. Confirm no regression: a normal CoStar/RCA sidebar capture still completes with the byte-store
   as an additive step (time it — the fetch is bounded).

## Context

This is Build 1 of a three-part owner-contact capture+reconcile design
(`OWNER_CONTACT_CAPTURE_RECONCILE_DESIGN.md`). It's first because it's LCC-only, feeds an
already-working deed→R51 propagation chain, and establishes the capture-and-store-at-ingestion
pattern that the SOS human-in-the-loop sidebar (Build 3) will reuse. The address-reconcile
connective tissue (Build 2) and the SOS sidebar (Build 3) follow. The SOS automated path is
confirmed dead from CI (gov `docs/SOS_ENDPOINT_VERIFICATION_2026-07-22.md`); do not revisit it here.
