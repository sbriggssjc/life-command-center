# OCR2 — the deed lane's OCR provenance: persist what the handler already computes

> **Small, self-contained, no new vendor, no new cron.** The deed drain (cron 160 → `document-text-tick`)
> computes `method` / `ocr_tier` / `ocr_engine` / `ocr_pages` for every document and then persists only
> `raw_text` + `ingestion_status`. So the deed tier mix — which engine read which deed, at what cost —
> is unauditable on both domains. This prompt persists it and closes the one opt-out that could bypass
> the tiered chain.

**Read first:** `docs/architecture/ai-and-ocr-cost-strategy.md` §0 (the corrected OCR2 finding) ·
`docs/architecture/document-capture-ocr-and-deeds.md` CURRENT STATE ·
`api/_handlers/document-text.js` (the drain) · `api/_shared/document-text.js` (`extractDocumentText`,
`ocrPdfToTextTiered`, `ocrPdfToText`) · `CLAUDE.md` → "Deploy ordering" and the DOC18 three-surface note.

---

## 0. ⚠️ The premise this item USED to carry is refuted — do not build against it

Three documents said *"the deed lane never tiers — it calls gpt-4o directly, and all 325 deeds went
to the 6–14× tier."* **Measured 2026-09-02, that is wrong on both halves:**

- `api/_handlers/document-text.js:217` passes **`ocrTiered: deps.ocrTiered !== false`** — tiered by
  default — and **no caller anywhere in `api/` passes `false`**. The gpt-4o-direct branch in
  `extractDocumentText` (`ocrPdfToText` → `invokeVisionExtractionAI`) is reachable only by an opt-out
  nobody uses.
- The "325" was a **date artifact**. gov deed extractions by `extracted_data->>'extracted_at'`:
  **112 on 2026-07-15, 31 on 07-24, ~11 more through 07-25 — 154 of 185 dated rows predate DocAI
  going live on 2026-08-12.** The cheap tier did not exist, so gpt-4o was the only OCR there was. The
  30 extracted 08-12/13 went through the tiered chain. (140 further gov rows carry no
  `extracted_at` at all.)

**What IS true, and is the defect:** the handler builds `{ ocr_tier, ocr_engine, ocr_pages, method }`
on every result (`document-text.js:246`, `:264`) and the tick response carries them — then the PATCH
at **`:233` writes only `{ raw_text, ingestion_status }`**. gov deeds: **325 with text, 0 with any
OCR provenance.** dia deeds: **182 with text, 0 with provenance.** The CRE lane's sidecar
(`lcc_cre_property_document_text`) records all four, which is why every number on the CRE side is
auditable and every number on the deed side has been a guess. **That asymmetry is how an
unverifiable claim reached three canonical documents.**

## 1. Build

### 1a. Persist provenance on the deed/domain rows — additive, fill-blanks, both domains

In `api/_handlers/document-text.js`, at every PATCH that writes `raw_text` (`:138`, `:152`, `:226`,
`:233`, `:292` — read each; not all are the success path), also write into
`extracted_data.document_text`:

```json
{ "method": "pdf_text|ocr|office_text", "ocr_tier": "cloud_cheap|cloud|free|null",
  "ocr_engine": "google_docai|gpt-4o|…|null", "ocr_pages": 12, "ocr_confidence": 96.0,
  "extractor": "document-text-tick", "extracted_at": "<iso>" }
```

- **jsonb merge, never replace** — `extracted_data` already holds `deed_extraction` +
  `extracted_at` on 185 gov rows and must survive. PostgREST cannot merge jsonb in a PATCH; either read
  the row's `extracted_data` first and send the merged object, or add a tiny RPC
  (`<dom>_merge_document_text_provenance(document_id, jsonb)`) that does `extracted_data ||
  jsonb_build_object('document_text', …)`. **Prefer the RPC** — a read-then-write races the deed
  parser, which writes `deed_extraction` into the same column on the same tick.
- **Fill-blanks:** never overwrite an existing `document_text` block.
- Keep the shape identical to the CRE sidecar's column names so the two lanes can be compared with
  one query.
- **Do NOT backfill a tier onto rows extracted before 2026-08-12.** Their tier is unknowable now.
  Write `{ "ocr_tier": null, "provenance": "pre_docai_unrecorded" }` by date, or nothing —
  **never infer `cloud` because "it must have been gpt-4o"**. Unknown is not a value (P180).

### 1b. Close the opt-out

`extractDocumentText({ ocrTiered })` still has a non-tiered branch that goes straight to gpt-4o. Make
the tiered chain the only path for PDFs: remove the branch, or make `ocrTiered:false` throw a named
error so a future caller cannot reach the 6–14× tier by omission. Check `runLeaseExtraction`
(`lease-extractor.js:958`) — it already uses the tiered function. Grep for every caller of
`ocrPdfToText(` and state which remain (the tiered chain's own last-resort step is the legitimate
one).

### 1c. Expose it

Append to each domain's deed-facing view (or add a small view `v_<dom>_deed_ocr_provenance`) the
per-tier counts, `avg(ocr_pages)`, and `count(*) filter (where extracted_data->'document_text' is
null)` as `unrecorded` — so the deed lane gets the §7b-style check the CRE lane already has.
`CREATE OR REPLACE VIEW` is append-only for columns.

## 2. ⚠️ What this must NOT do

- **No re-OCR.** 507 deeds already have text. This records what future ticks do; it does not spend.
- **Do not touch cron 160's scope** (`doctype=deed` — DOC7 is closed, do not widen).
- **Do not touch the CRE lane** (`cre-property-doc-text.js`) — it already records provenance.
- **Do not fabricate a tier for historical rows** (§1a).
- ⚠️ **Three deploy surfaces, three checks.** This change is `api/` (Railway) + a migration (the RPC
  and view). If you touch `supabase/functions/`, that is a third deploy that neither of the other two
  performs — DOC18's first tick failed on exactly that.

## 3. Verify — on the state delta, never the tick's tally

Additive-schema-before-writer: apply the migration, then the Railway redeploy. Then, after the next
cron-160 tick that extracts anything (the deed backlog is 0/0 today, so a new deed must arrive — say
so if none does; do not force one):

```sql
-- gov and dia
select extracted_data->'document_text'->>'ocr_tier' as tier,
       extracted_data->'document_text'->>'ocr_engine' as engine,
       count(*), avg((extracted_data->'document_text'->>'ocr_pages')::int)
from property_documents where lower(document_type)='deed'
group by 1,2 order by 3 desc;
```

`unrecorded` must equal the pre-change count exactly (507 = 325 gov + 182 dia) — a backfill here would
be a fabrication. Positive control: a rolled-back synthetic insert through the RPC must land under
`document_text` with `deed_extraction` intact beside it.

## 4. Report back

- The per-PATCH-site table: which of the five sites now write provenance and why any does not.
- The caller census for `ocrPdfToText(` after §1b.
- The provenance query above on both domains (expect all `unrecorded` until a new deed lands — say
  so).
- Guard: a test that fails if the success-path PATCH ever again omits `document_text`, and one that
  fails if `ocrTiered:false` becomes reachable. Mutation-verify both; strip comments first — this
  prompt's own wording will be quoted in yours.
- ⚠️ State plainly that the "325 deeds to gpt-4o" claim is retired and where it was corrected
  (`ai-and-ocr-cost-strategy.md` §0, `CURRENT-STATE.md`, backlog OCR2). Do not restate it.
