# Document capture-at-ingest & OCR — status + the one open loop

> **⚠️ RECONCILED 2026-08-12 (evening session) — the "open loop" below was grounded and is
> mostly CLOSED. The premise "lease OCR is config-gated / unconfigured" was WRONG:**
>
> - **Railway already carries the full OCR_CLOUD_* config and it WORKS.** `OCR_CLOUD_OCR_URL`
>   points at the `docai-ocr` edge fn on LCC Opps (v18, `GET` health = `ready:true`,
>   GCP SA + processor configured), the shared secret passes (Railway POSTs reach Document AI),
>   and the **gpt-4o last resort is enabled and observed firing** (folder_feed_seen id 2848
>   enriched 2026-08-12 21:57Z with `ocr_tier:'cloud'`; El Paso 5566 / Walterboro 2835 carry
>   `cloud_cheap` from June). No env change was needed. `feature_flags_registry` row
>   `OCR_CLOUD_DOCAI` added (state=on).
> - **Why scanned leases still parked `needs_ocr`:** per-document limits, not config.
>   The `needs_ocr` queue was 10 rows = **9 xlsx/doc/docx "Lease Abstract" files** (Document AI
>   is PDF/image-only — these produced today's `docai_400` "PDF corrupted"/`entity_types` errors)
>   **+ 1 real PDF** (Richardson 2840: 15.6 MB > `INTAKE_OCR_MAX_BYTES` 12 MB default → `over_ocr_cap`
>   before any cloud call; 40 pages > the DocAI sync ~15-page cap anyway; image-only, rotated 270°).
> - **Richardson 2840 is DONE** via the designed free tier (off-box tesseract + OSD rotation →
>   `POST ?_route=lease-backfill&id=2840` with `ocr_text`) → `enriched`, dia property 37674,
>   matched existing lease 21748, fills 0 / conflicts 0 (row already curated), `ocr_tier:'free_external'`.
> - **Remaining:** ~214 pending eligible leases drain via repeated capped
>   `POST /api/intake?_route=lease-backfill&limit=15` (scanned PDFs ≤12 MB/≤15 pages self-OCR via
>   DocAI; bigger ones fall to gpt-4o where feasible, else park for the free tier). The only true
>   build gap is the **xlsx/docx office-text extractor** (see "Not built" below) — the whole
>   remaining `needs_ocr` queue is that format tail.
> - Optional knobs (NOT set, deliberate): `INTAKE_OCR_MAX_BYTES=20000000` would let 12–20 MB PDFs
>   reach the cloud tiers (they'd still hit the 15-page DocAI sync cap → gpt-4o, whose verbatim
>   transcription degrades/truncates on very long docs — big scans are better served off-box).

**Session 2026-08-12.** Handoff for the document byte-capture + OCR pipeline that
feeds owner data (deeds) and firm-term coverage (leases). Sister docs: gov
`docs/RUNBOOK_firm_term_coverage_ops_gates.md`; LCC `CLAUDE.md` → "OCR / document-text
foundation".

## TL;DR

The **byte-capture** problem (the original ask — "store the bytes at ingestion so
we don't fight CoStar auth later") is **solved and shipped**. The remaining open
loop is a **config toggle**: the lease OCR path won't spend on cloud OCR until an
`OCR_CLOUD_*` provider is enabled, so scanned lease PDFs park `needs_ocr`. Deeds
already OCR fine (different, `OPENAI_API_KEY`-gated entrypoint).

## What shipped (merged 2026-08-12)

| Piece | PR | State |
|---|---|---|
| gov state-lease firm-term tier (t6) + per-state adapters + runbook | government-lease #373 | ✅ merged/live |
| Durable capture-at-ingest: extension in-session + server backfill | life-command-center #1703 | ✅ merged/live |
| Backfill keyset-cursor fix + SharePoint (`/sites/`) fetch branch | life-command-center #1707 | ✅ merged/live |

### Capture mechanics (both domains)
- **Forward (durable fix):** the extension (v1.0.39) fetches each captured doc's
  bytes **in the authenticated CoStar tab** (`fetchDocBytesViaTab`) and POSTs them
  to `POST /api/intake?_route=capture-doc-bytes` → `storeClientDocBytes`, keyed by
  `(domain, source_url)`. Session-bound CDN links are only reachable this way.
- **Backfill:** `POST /api/intake?_route=doc-bytes-backfill&domain=dia|gov&limit=&before=<cursor>&source=sharepoint|http`
  → `backfillDocBytes`. Keyset cursor (terminates on an un-capturable backlog);
  counts `bytes_captured` / `sharepoint_captured` / `session_bound_or_dead` honestly.
- **SharePoint branch:** a server-relative `/sites/…` `source_url` is fetched via the
  Power-Automate "Get Artifact" flow (`SHAREPOINT_FETCH_URL`), not HTTP.

### Measured outcome (live)
- Backfill run: **CoStar/http** 438 gov + 309 dia captured; **SharePoint** 272 gov +
  441 dia captured. Backlog essentially cleared (5–6 SharePoint stragglers each; the
  rest are `srsre.com` broker *pages*, not documents).
- Result: **~1,548 domain `property_documents` now have durable bytes** and are
  OCR-eligible (`storage_path` set, `raw_text` null). Includes 63 of the 82 gov
  firm-term OCR-queue docs.

## The two document→data consumers

1. **Deeds → owner/grantee data.** `document-text-tick?doctype=deed` (LCC Opps cron
   **160**). **Verified working** — OCRs via gpt-4o (`extractDocumentText`, gated on
   `OPENAI_API_KEY`), runs the deed parser. Reactivate cron 160 to bank it.
2. **Leases → firm term.** `lease-backfill` (`api/_handlers/lease-backfill.js` +
   `lease-extractor.js`), which reads `folder_feed_seen` (SharePoint folder feed,
   keyed by path), fetches from SharePoint, extracts terms → `leases` →
   `gov_firm_term_fields`. ~222 leases queued. **Blocked by the OCR config below.**

## ⚠️ The open loop — lease OCR is config-gated (NOT broken)

Grounded in code (`api/_shared/document-text.js`):

- **Deeds** use `extractDocumentText`, whose OCR fallback is gpt-4o vision **gated only
  on `OPENAI_API_KEY`** (set) → works.
- **Leases** use `ocrPdfToTextTiered` (`document-text.js:292`), a tiered path where
  **gpt-4o is Tier-3 "last resort, explicit opt-in ONLY"** and Tier-2 (Google
  Document AI / Azure DI / webhook) needs `OCR_CLOUD_OCR_URL` + `OCR_CLOUD_PROVIDER`.
  With neither set, *"the paid tiers are inert and a free miss returns needs_ocr."*
  → scanned lease PDFs (and xlsx/docx) park `needs_ocr`, `text_len: null`, `ocr_pages_total: 0`.

Relevant env (from the code comments):
- `OCR_CLOUD_ESCALATION` — master kill-switch (default on).
- `OCR_CLOUD_PROVIDER` — `google_docai | azure_di | webhook (via OCR_CLOUD_OCR_URL) | gpt4o`.
- `OCR_CLOUD_OCR_URL` — the cheap-cloud OCR HTTP seam (Document AI / Azure / webhook).
- `OCR_CLOUD_GPT4O_LASTRESORT=true` (or `OCR_CLOUD_PROVIDER=gpt4o`) — enable the gpt-4o tier.
- `LEASE_EXTRACT_OCR` (default true) — per-path on/off.

### Assets we already have for OCR (to reconcile in the next chat)
- **Google Document AI** — the `docai-ocr` edge function on LCC Opps (`xengecqvemvfknjvbvrq`);
  likely configured on a prior task. The cheap-cloud primary (~$1.5/1k pages, 6–14× cheaper than gpt-4o).
- **Microsoft Document Intelligence** — evaluated previously; a candidate `azure_di` provider.
- **Ollama (local)** — the GaryBuilt residential box already serves Ollama over a CF Access
  tunnel (`OLLAMA_URL`, live per LCC `feature_flags_registry.OLLAMA_EXTRACTION`); a potential
  free vision-OCR tier for the `webhook` seam.
- **gpt-4o vision** — already proven working for deeds (`OPENAI_API_KEY` set).

## SCOPE (2026-08-12) — the xlsx/docx office-text extractor (the real remaining gap)

The entire remaining lease `needs_ocr` queue (~11 rows) is office files. Scope, not built:

- **Where:** new `api/_shared/office-text.js`, wired into `runLeaseExtraction` (lease-extractor)
  and `extractDocumentText` (document-text) BEFORE the OCR branch, keyed on content-type /
  extension (`.docx`, `.xlsx`; `.doc` best-effort). Replaces the current lossy ASCII
  `binary_decode` salvage for these types. No new api/*.js; no OCR spend for these docs.
- **How (zero new deps):** `.docx`/`.xlsx` are ZIPs — a ~50-line local-file-header reader +
  `zlib.inflateRawSync` extracts `word/document.xml` (docx: strip tags, keep `<w:p>` breaks) and
  `xl/sharedStrings.xml` + `xl/worksheets/sheet*.xml` (xlsx: emit rows as `label: value` lines,
  resolving shared strings + inline strings; numbers/dates via cell `t`/`s` attrs, dates
  best-effort). Output feeds the SAME `extractLeaseFromText` AI prompt — abstracts are
  term-dense, so extraction quality should exceed scanned-PDF OCR.
- **Legacy `.doc` (OLE/CFB, e.g. Pearland Estoppel.doc):** not worth a parser — route through the
  existing off-box `ocr_text` resubmit seam (LibreOffice/Word on the workstation), or leave as a
  1-2 doc human tail.
- **Marks:** success → `source:'office_text'`, `text_len`; a office file that yields no text →
  terminal `enrich_unprocessable:office_no_text` (NOT `needs_ocr` — OCR can never fix it; stops
  these rows re-peppering the OCR queue and being POSTed to Document AI, which 400s on them).
- **Size:** ~150 LOC + unit tests (fixture docx/xlsx). One Railway deploy (both services per the
  deploy map). Interim workaround: the off-box seam already works for these (extract locally,
  POST `ocr_text`).

## Not built (surfaced, deliberate follow-ups)
- **xlsx / docx lease abstracts** — the OCR path is PDF/image-only, so spreadsheet/Word
  "Lease Abstract" files (often the most term-dense) return `needs_ocr`, `text_len null`.
  Needs a spreadsheet/Word text extractor (`.xlsx` cell read / `.docx` text). Distinct build.
- **A cron for non-deed domain docs** — cron 160 drains only `doctype=deed`; the captured
  lease/OM domain docs have no scheduled `document-text-tick` pass (they're driven by
  `lease-backfill` over the folder feed instead).

---

## Copy/paste prompt for the next chat (wire OCR to close the loop)

> **Context:** Document byte-capture is shipped and ~1,548 `property_documents` (dia+gov)
> now have durable bytes; ~222 leases are queued in `folder_feed_seen` for `lease-backfill`.
> Deeds OCR fine via gpt-4o (`extractDocumentText`, `OPENAI_API_KEY`). But the **lease** OCR
> path (`ocrPdfToTextTiered` in `api/_shared/document-text.js`) is config-gated: gpt-4o is
> Tier-3 opt-in-only and Tier-2 needs `OCR_CLOUD_OCR_URL`+`OCR_CLOUD_PROVIDER`, so scanned
> lease PDFs park `needs_ocr` (`text_len: null`, `ocr_pages_total: 0`). See
> `docs/architecture/document-capture-and-ocr-status.md`.
>
> **Goal:** Reconcile what OCR is ALREADY built/configured and wire the best available engine
> into the lease path so `lease-backfill ?id=<id>` (no `ocr_text`) actually OCRs a scanned
> lease PDF end-to-end. Specifically:
> 1. Audit the existing OCR seams: the `docai-ocr` edge function on LCC Opps
>    (`xengecqvemvfknjvbvrq`) — is it deployed, what URL/contract; the Azure Document
>    Intelligence option; and the local Ollama vision path (`OLLAMA_URL`, CF Access). Report
>    which are live and callable, grounded against the code + Railway env
>    (`GET /api/diag?kind=env`) + the edge-function list.
> 2. Decide the tier order for `OCR_CLOUD_PROVIDER` (recommend cheapest-that-works;
>    Document AI first if live, gpt-4o last resort). Confirm the exact env vars to set
>    (`OCR_CLOUD_PROVIDER`, `OCR_CLOUD_OCR_URL`, `OCR_CLOUD_GPT4O_LASTRESORT`, `LEASE_EXTRACT_OCR`)
>    and whether any code change is needed so `ocrPdfToTextTiered` actually reaches the chosen
>    engine (verify the webhook/`ocrCloudCheap` contract matches the `docai-ocr` fn).
> 3. Verify live: after enabling, `POST /api/intake?_route=lease-backfill&id=2840` (Richardson
>    "Fully executed lease.pdf") should return `enriched` with `text_len > 0` and land firm-term
>    fields. Then hand me a capped drain loop over the `ocr_queue` (`GET
>    ?_route=lease-backfill&ocr_queue=1`), skipping the xlsx/docx abstracts.
> 4. Separately, scope (don't necessarily build) an xlsx/docx text extractor for the
>    "Lease Abstract" spreadsheets that the PDF-only OCR path can't read.
>
> Ground everything against the live LCC Opps DB + Railway before recommending. Keep changes
> config-first; only touch code if the tiered-OCR seam genuinely needs it. Dry-run/verify each step.
