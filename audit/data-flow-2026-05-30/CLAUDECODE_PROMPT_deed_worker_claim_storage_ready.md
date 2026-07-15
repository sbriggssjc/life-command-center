# Claude Code (LCC) — deed OCR worker: claim the storage-ready deed docs (the drain is spinning on the wrong 7)

## Symptom (grounded live 2026-07-15, gov `scknotsqkcheojiaewwh`)

The `lcc-document-text-deeds` cron (`*/30`, `POST /api/document-text-tick?doctype=deed&limit=15`)
is firing every 30 min and returning HTTP 200 — but it is **not draining the backlog**. Each
tick looks like:

```
{"mode":"drain","doctype":"deed","limit":15,"by_domain":{"dia":{"eligible":15},"gov":{"eligible":15}},
 "scanned":7,"text_extracted":0,"deed_parsed":7,"needs_ocr":0,"deed_records_created":1, ...}
```

`text_extracted:0` + `needs_ocr:0` on every tick = the worker is **re-parsing the handful of
deeds that already have `raw_text`**, never OCR-ing the ones that don't. Over several hours the
owner-address outputs did not move: gov `deed_records.grantee_address` = **1**,
`recorded_owners.mailing_address` = **5**, `ownership_history` deed_extraction = **1**.

## Root cause: the claim/eligibility query skips the storage-ready backlog

gov `property_documents` where `document_type ILIKE '%deed%'` breaks down as:

| ingestion_status | count | raw_text | storage_path | source_url host |
|---|---|---|---|---|
| `url_captured` | 253 | null | **121 have it**, 132 null | ahprd1cdn.csgpimgs.com |
| `bytes_captured` | 37 | null | **37 have it** | ahprd1cdn.csgpimgs.com |
| `text_extracted` | 3 | present | yes | — |
| `deed_parsed` | 3 | present | yes | — |
| `deed_no_parties_r58c` | 3 | mostly null | yes | — |

**158 deed docs (121 `url_captured` + 37 `bytes_captured`) ALREADY have their bytes in the
`property-documents` Storage bucket** (`storage_path` = `gov/deed/<property_id>/sha256-…`,
`storage_bucket='property-documents'`). They need **zero CoStar-CDN reach** — just read the
bytes from Storage and OCR them. The worker isn't claiming them.

The remaining 132 `url_captured` with **no** `storage_path` genuinely need a CoStar CDN
re-fetch (`ahprd1cdn.csgpimgs.com`, expiring links) — that's a separate, harder problem; leave
those for later.

## The fix (worker eligibility only — no schema change, no new route)

In the `document-text-tick` handler (`api/_handlers/document-text.js` or wherever the deed
drain's claim query lives — ground it), make the deed-doctype eligibility **claim docs whose
bytes are ready to OCR**, i.e.:

- `document_type ILIKE '%deed%'`
- `(raw_text IS NULL OR length(raw_text) < 50)`  — not yet text-extracted
- `storage_path IS NOT NULL`  — bytes are in Storage (no CDN fetch needed)
- `ingestion_status` is one of the **non-terminal** states (`url_captured`, `bytes_captured`) —
  explicitly INCLUDE these; today the query is evidently excluding them (it only re-touches
  `text_extracted`/`deed_parsed`). Do NOT re-claim terminal states
  (`deed_parsed`, `deed_no_parties_r58c`) — those are done.

Read the bytes from `storage_bucket`/`storage_path` (the Phase-1 storage adapter / the same
`getArtifactBytes`-style path the extractor already uses for `storage_path`), run the tiered OCR
(`ocrPdfToTextTiered` → Document AI cheap-cloud, which is verified working), write `raw_text` +
advance `ingestion_status` to `text_extracted`, then run the existing deed parse + R51/R59
propagation. The 132 no-`storage_path` docs should be claimed only when a CDN-fetch step is
present (out of scope here) — a doc with neither `raw_text` nor `storage_path` must **not** be
claimed by this OCR path (it would just no-op or error).

### Guardrails
- Idempotent: a claimed doc that OCRs to text drops out of the eligibility set next tick; one
  that OCRs but yields no parseable parties advances to the existing `deed_no_parties_r58c`
  terminal state (don't re-claim it).
- Keep the existing per-tick `limit` + wall-clock budget. With 158 ready and limit 15, ~11
  ticks (~5.5 h at */30) drains them — or bump the cron to `*/15` temporarily and/or raise the
  gov limit for a faster drain, your call; keep it gentle (Document AI is metered per page).
- dia parallel: apply the same eligibility fix to the dia deed leg (dia deed docs are far fewer
  but the claim logic should match).
- No new api/*.js (≤12); this is a claim-query change in the existing handler. Reversible.

## Verify (post-deploy)
1. `GET /api/document-text-tick?doctype=deed&limit=5` (dry-run) should now report **eligible ≈
   158 gov** (the storage-ready set), not ~7.
2. After a few real ticks: gov `text_extracted` deed docs climb, `deed_records.grantee_address`
   and `recorded_owners.mailing_address` climb from 1/5 upward, and the tick response shows
   `text_extracted > 0` (not 0).
3. Spot-check 3 newly-OCR'd deeds: `raw_text` present, grantee/grantor parsed, and where the
   deed carried a notice/return-to address, `deed_records.grantee_address` +
   `recorded_owners.mailing_address` filled (fill-blanks, `recorded_deed` provenance) — traceable
   back to the deed `source_url`.

## Bottom line
158 gov deeds are sitting in Storage fully ready to OCR — the cron is healthy but its claim query
never selects them, so it burns each tick re-parsing the ~7 already-text docs and produces 0 new
addresses. Widen the deed eligibility to `storage_path IS NOT NULL AND raw_text IS NULL` across
`url_captured`/`bytes_captured`, and the authoritative notice-address layer the reconcile engine
(Phase B) is starved for finally starts flowing — free, no credentials, no CDN.
