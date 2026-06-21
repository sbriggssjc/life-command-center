# UW#4 — Free-first OCR for scanned lease PDFs

> The unlock for the unlock. UW#2 activated the lease-document extractor (the #1
> free lever for escalation %, guarantor, renewal, expiration, expense
> structure). But **~54% of executed lease PDFs are scanned image-only** →
> `needs_ocr` → 0 fields filled: the extractor needs a TEXT LAYER. UW#4 adds that
> layer with a **FREE local OCR engine first**, escalating to the cloud OCR only
> on a free-tier miss — so the bulk drain costs zero per-page cloud spend.

OCR only **adds a text layer**. It does NOT change the lease extractor, its four
guards (location / draft / operator / multitenant), fill-blanks, or the
provenance gate. A field the OCR'd text doesn't state stays blank — no
fabrication.

---

## Architecture (where each tier runs)

| Tier | Engine | Where it runs | Spend |
|------|--------|---------------|-------|
| 1 — free | Tesseract via `ocrmypdf` | **Workstation drainer** (`scripts/lease-ocr-backfill.mjs`) — the binary isn't in the Railway image and a 50-page scan blows the per-tick budget; this runs where the binary lives with no time budget (the established one-shot backfill pattern) | $0 |
| 2 — cloud | gpt-4o vision (`invokeVisionExtractionAI`) | In-server (already live since R58/UW#2). Reached only on a free-tier miss / below the confidence floor, and only with `--escalate` | per-page |

The free tier supplies only the recovered **text** to the server; every guard /
fill-blanks / provenance / dedupe runs SERVER-SIDE through the SAME
`attachLeaseDoc`. With no free adapter configured the in-server byte path falls
straight through to the cloud tier — **byte-identical to R58** — so this is
deploy-order-safe and adds zero dependency / shell-out to the always-on server.

> **Cloud-provider escalation (Azure / Google Document AI):** the foundation
> exposes the seam (`ocrPdfToTextTiered`'s injectable `ocrPdfToText`), but no
> live Azure/Google integration is wired (no account/keys). The existing gpt-4o
> vision IS the cloud tier today; a cheaper per-page provider is a flagged future
> swap behind that seam. `OCR_CLOUD_ESCALATION='false'` forces a pure-free drain
> with zero per-page spend.

---

## What shipped

- **`api/_shared/document-text.js` → `ocrPdfToTextTiered({buffer,mediaType}, deps)`**
  — free tier (injectable `freeOcr`) → cloud tier (`ocrPdfToText`). Returns
  `{ok, text, tier:'free'|'free_low_conf'|'cloud', confidence, engine}`.
  `OCR_FREE_CONFIDENCE_MIN` (default 55) escalates a below-floor free read;
  `OCR_CLOUD_ESCALATION` (default on) is the cloud kill-switch.
- **`runLeaseExtraction` / `attachLeaseDoc`** — accept a supplied free-OCR
  `ocrText` (+`ocrConfidence`); thread `ocr_tier` / `ocr_confidence` onto the
  enriched receipt + the `folder_feed_seen` marker so a low-confidence
  transcription can be FLAGGED for review.
- **`api/_handlers/lease-backfill.js`** —
  - `GET /api/lease-backfill?ocr_queue=1&limit=N` → the `needs_ocr` worklist.
  - `POST /api/lease-backfill?id=<id>` body `{ocr_text, ocr_confidence}` →
    re-process ONE scanned doc with the supplied free text (bypasses the
    eligible-queue filter; a successful re-process re-stamps `enriched`,
    self-draining the queue). Empty body → in-server cloud OCR.
- **`scripts/lease-ocr-backfill.mjs`** — the workstation drainer (free OCR +
  HTTP). No new `api/*.js`; no migration (confidence rides existing jsonb).

---

## Prerequisites (Scott's workstation)

- Node 20+
- **ocrmypdf** — `pip install ocrmypdf` or `brew install ocrmypdf` (pulls
  Tesseract + Ghostscript). For the best-effort confidence pass also have
  **poppler** (`pdftoppm`) + `tesseract` on PATH. Confidence is best-effort: when
  the TSV pass can't run it reports `null` (the enrich still records; a
  null-confidence row is simply not flagged low).
- The SharePoint **"Team Briggs - Documents"** library synced locally (the
  drainer reads the PDF bytes from disk, like `folder-feed-backfill.mjs`).

---

## Runbook — capped → gate → drain

Run from the workstation against the live Railway origin.

**1. Worklist + locate (dry-run — no OCR, no writes):**
```bash
node scripts/lease-ocr-backfill.mjs --dry-run \
  --base "$LCC_BASE_URL" --key "$LCC_API_KEY" \
  --library-root "/Users/scott/Team Briggs - Documents" \
  --limit 10
```
Confirms the `needs_ocr` queue size and that each row resolves to a local file
(`would_ocr` vs `local_missing` / `no_local_path`).

**2. Capped GATE batch (real free OCR, ~10 leases):**
```bash
node scripts/lease-ocr-backfill.mjs \
  --base "$LCC_BASE_URL" --key "$LCC_API_KEY" \
  --library-root "/Users/scott/Team Briggs - Documents" \
  --limit 10 --concurrency 2 --conf-min 55
```
Read the summary: text recovered, `enriched` / `fields_filled` / `conflicts →
Decision Center` / `leases_created`, free-tier mean confidence, free-tier hit vs
escalated. **Gate = escalation/guarantor/renewal filled from real scanned
leases, every guard held (0 wrong-property / HQ / draft writes), provenance
written, idempotent.** Spot-check a couple of enriched properties.

**3. Broad drain (repeat capped batches; resumable via the manifest):**
```bash
node scripts/lease-ocr-backfill.mjs --base … --key … --library-root … --limit 50
```
Re-runs skip already-done docs (`.lease-ocr-backfill.json`) and the server queue
self-drains as rows re-stamp `enriched`.

**4. Escalate the free-tier misses to cloud OCR (optional, deliberate spend):**
```bash
node scripts/lease-ocr-backfill.mjs --base … --key … --library-root … \
  --limit 50 --escalate
```
Free OCR runs first; only docs the free engine can't read (or below `--conf-min`)
POST with no text and the server runs gpt-4o vision. Size this on the gate
receipts (the free-tier hit rate tells you how big the cloud tail is).

---

## Confidence + provenance

- `ocr_confidence` (0-100, mean Tesseract word confidence) and `ocr_tier`
  (`free_external` / `cloud`) ride the enriched receipt and the
  `folder_feed_seen.subject_hint.lease_backfill` marker — queryable for review:
  ```sql
  SELECT id, server_relative_path,
         subject_hint->'lease_backfill'->>'ocr_tier' AS ocr_tier,
         (subject_hint->'lease_backfill'->>'ocr_confidence')::numeric AS conf
  FROM folder_feed_seen
  WHERE subject_hint->'lease_backfill'->>'outcome' = 'enriched'
    AND subject_hint->'lease_backfill' ? 'ocr_confidence';
  ```
- OCR'd lease economics ride the SAME `source='folder_feed_lease'` provenance
  (warn mode → conflicts to the Decision Center, never a clobber) — OCR changes
  nothing about how a value is written, only whether the text existed to read it.

---

## The honest value-rank ceiling

The prompt asks to prioritize the OCR queue by lease VALUE (rent × term). The
`needs_ocr` rows carry no rent, and the property isn't resolved until AFTER
OCR + extract — so a clean pre-OCR value rank isn't possible (the same call R58
made for `document-text-tick`). The drainer works the deterministic `id.asc`
queue, capped; a value-first pass would require resolving each property before
OCR (circular). Surfaced, not faked.

## Boundaries

OCR adds a text layer ONLY — extractor, the four guards, fill-blanks, and the
provenance gate are unchanged. No fabrication. Cloud escalation is opt-in
(`--escalate`) and the cloud tier has a global kill-switch
(`OCR_CLOUD_ESCALATION='false'`). Reversible (a re-process re-stamps the marker;
the enrich is fill-blanks-only). ≤12 `api/*.js`; no migration; dia/gov pipelines
otherwise untouched.
