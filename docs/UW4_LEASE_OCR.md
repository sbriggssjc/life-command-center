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

## Architecture (where each tier runs) — UW#4b cost-optimized

| Tier | Engine | Where it runs | Spend (≈860 scanned leases / 15k–35k pages, one-time) |
|------|--------|---------------|-------|
| 1 — free | **Surya / PaddleOCR** (preferred; better on rent-tables) → ocrmypdf-**Tesseract** fallback | **Workstation drainer** (`scripts/lease-ocr-backfill.mjs`) — the binary isn't in the Railway image and a 50-page scan blows the per-tick budget; this runs where the binary lives with no time budget (the established one-shot backfill pattern) | **$0** |
| 2 — cheap cloud (**preferred paid**) | **Google Document AI / Azure DI Read** (`ocrCloudCheap`, $1.50/1k pp) | In-server, behind a config'd HTTP seam (`OCR_CLOUD_OCR_URL`) | **~$23–53** (or **$0** under Google's $300 new-account credit) |
| 3 — last resort | gpt-4o vision (`invokeVisionExtractionAI`) | In-server, **explicit opt-in only** (`OCR_CLOUD_PROVIDER=gpt4o` / `OCR_CLOUD_GPT4O_LASTRESORT=true`) | **~$150–500** (6–14× the dedicated OCR — never the default) |

The free tier supplies only the recovered **text** to the server; every guard /
fill-blanks / provenance / dedupe runs SERVER-SIDE through the SAME
`attachLeaseDoc`. OCR adds a text layer — it never changes the extractor or its
guards.

**This tiering is LEASE-ONLY.** `ocrPdfToTextTiered` is called only by
`lease-extractor.js`. The R58 deed worker (`extractDocumentText` →
`ocrPdfToText`) still uses gpt-4o vision directly and is **untouched** — UW#4b
does not regress R58's other OCR paths.

> **Why gpt-4o is no longer the lease default (grounded 2026-06-20):** gpt-4o
> vision is the most EXPENSIVE OCR path by 6–14× (token-based), and purpose-built
> OCR APIs (Google Document AI / Azure DI Read at $1.50/1k pages) are near-free at
> our volume with no OCR-quality loss. So the paid escalation is **cheap cloud
> first**, gpt-4o only as a gated last resort. Licenses we already pay for do NOT
> help: M365 Copilot has no batch-OCR API (Microsoft's OCR product is Azure
> Document Intelligence, separately metered), and Claude/ChatGPT chat seats can't
> batch through the API. So automated OCR = free OSS **or** a metered OCR API.
>
> **Default = ZERO SPEND, free-only.** With no cheap provider configured AND no
> gpt-4o last-resort flag, the paid tiers are inert: a server-side free miss
> returns `needs_ocr`, and the corpus drains via the workstation free OCR. Paid
> spend is deliberate / blessed (set `OCR_CLOUD_OCR_URL`).
> `OCR_CLOUD_ESCALATION='false'` is the master kill-switch (no paid OCR of any
> kind).

---

## What shipped

- **`api/_shared/document-text.js` → `ocrPdfToTextTiered({buffer,mediaType}, deps)`**
  — free tier (injectable `freeOcr`) → **cheap cloud** (`ocrCloudCheap`) → gpt-4o
  last resort. Returns `{ok, text, tier:'free'|'free_low_conf'|'cloud_cheap'|'cloud',
  confidence, engine}`. `OCR_FREE_CONFIDENCE_MIN` (default 55) escalates a
  below-floor free read; `OCR_CLOUD_ESCALATION` (default on) is the master
  kill-switch; `OCR_CLOUD_PROVIDER` selects the paid tier; `OCR_CLOUD_OCR_URL`
  configures the cheap-cloud HTTP seam (UW#4b).
- **`api/_shared/document-text.js` → `ocrCloudCheap({buffer,mediaType,fetchImpl})`**
  (UW#4b) — POSTs base64 + `media_type` + `provider` to `OCR_CLOUD_OCR_URL` (a
  thin Google Document AI / Azure DI Read flow — the SHAREPOINT_* / webhook
  rollout pattern, so the server takes no new SDK / always-on dependency) and
  reads back `{text, confidence?}`. `cloud_ocr_unconfigured` (zero spend) when no
  URL is set.
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
- **A free OCR engine** (the drainer's `--engine auto` default picks the best one
  that's installed — `surya > paddleocr > ocrmypdf > tesseract`):
  - **Surya** (recommended — native PDF, per-line confidence, strong on the
    rent-schedule / exhibit TABLES in NNN leases): `pip install surya-ocr`
    (provides `surya_ocr`). Marker (`pip install marker-pdf` → `marker_single`)
    wraps Surya for PDF→markdown and is also table-strong; point `--ocr-cmd` at
    it if you prefer markdown output.
  - **PaddleOCR** (also table-strong): `pip install paddleocr` (provides
    `paddleocr`). CLI flags vary across 2.x/3.x — pin your version's invocation
    with `--ocr-cmd` if `--engine paddleocr` doesn't parse.
  - **Fallback — ocrmypdf/Tesseract** (always works, weaker on tables):
    `pip install ocrmypdf` or `brew install ocrmypdf` (pulls Tesseract +
    Ghostscript). For the best-effort confidence pass also have **poppler**
    (`pdftoppm`) + `tesseract` on PATH.
  - Confidence is best-effort per engine: Surya/PaddleOCR report a real per-line
    score; the ocrmypdf path uses a Tesseract-TSV pass. When it can't run it
    reports `null` (the enrich still records; a null-confidence row is simply not
    flagged low).
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

The summary prints the **free-tier hit RATE** (free OK / OCR-attempted) — that
number sizes the paid escalation tail before any broad drain. If the free OSS
engine clears most leases, the paid tail is trivial.

**4. Escalate the free-tier misses to cloud OCR (optional, deliberate spend):**
```bash
node scripts/lease-ocr-backfill.mjs --base … --key … --library-root … \
  --limit 50 --escalate
```
Free OCR runs first; only docs the free engine can't read (or below `--conf-min`)
POST with no text and the server runs the **cheap-cloud** tier (Google Document
AI / Azure DI Read) when configured — gpt-4o is reached only if you explicitly
opt into the last resort. Size this on the gate receipts (the free-tier hit rate
tells you how big the cloud tail is).

### Configuring the cheap-cloud tier (the preferred paid escalation)

The cloud tier is **off by default (zero spend)**. To bless it, configure the
HTTP seam in the Railway env:

| Env | Purpose |
|-----|---------|
| `OCR_CLOUD_OCR_URL` | The cheap-cloud OCR endpoint (a thin Google Document AI / Azure DI Read flow that accepts `{content_base64, media_type, provider}` and returns `{text, confidence?}`). This is the SHAREPOINT_FETCH_URL webhook-adapter pattern — no new server SDK / dependency. |
| `OCR_CLOUD_OCR_KEY` | (optional) Bearer token sent to the endpoint. |
| `OCR_CLOUD_PROVIDER` | `google_docai` / `azure_di` / `webhook` (all via the URL) — a label for telemetry. Set `gpt4o` to deliberately route the paid tier to gpt-4o vision instead. |
| `OCR_CLOUD_GPT4O_LASTRESORT` | `true` allows gpt-4o vision AFTER a cheap-cloud miss (default off — gpt-4o is never auto-selected). |
| `OCR_CLOUD_ESCALATION` | `false` = master kill-switch, no paid OCR of any kind. |

**Standing up the endpoint (Microsoft shop — easiest):** Azure Document
Intelligence **Read** ($1.50/1k pages, key-header auth) behind a small Power
Automate / Logic App / Function that returns `{text, confidence}` — the same way
the SharePoint List/Get/Upload flows are wired.

**Google Document AI ($0 for the whole backfill):** Google's $300 new-account
credit covers the entire ~15k–35k-page corpus (≈$23–53) at $0. Stand a thin
Cloud Function (or any flow) that calls the Document AI Enterprise OCR processor
and returns `{text, confidence}`, then point `OCR_CLOUD_OCR_URL` at it. Once the
corpus is drained the steady-state marginal cost is near zero (only new scanned
leases trigger a call).

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
provenance gate are unchanged. No fabrication. **UW#4b is an engine swap**: only
the lease-OCR engine choices change (free engine → Surya/PaddleOCR with Tesseract
fallback; paid escalation → cheap cloud preferred, gpt-4o gated last resort). The
tiered seam is lease-only — **R58's other OCR paths (deeds) use `ocrPdfToText`
directly and are not regressed.** Paid spend is opt-in (cheap-cloud unconfigured
by default; gpt-4o only behind an explicit flag) with a global kill-switch
(`OCR_CLOUD_ESCALATION='false'`). Reversible (a re-process re-stamps the marker;
the enrich is fill-blanks-only). No new always-on server dependency (the OSS
engine runs in the workstation drainer; the cheap cloud is a config'd HTTP seam).
≤12 `api/*.js`; no migration; dia/gov pipelines otherwise untouched.
