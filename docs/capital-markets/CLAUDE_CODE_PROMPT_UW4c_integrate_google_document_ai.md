# Claude Code prompt — UW#4c: integrate Google Document AI as the cheap-cloud OCR

> Realizes the cheap-cloud seam UW#4b left unwired. Decision (Scott, 2026-06-21): Document AI is
> at-least-equal quality to gpt-4o for OCR-ing typed/printed scanned deeds + leases, and ~20–60×
> cheaper (~$1.50/1k pages, free under Google's $300 new-account credit). Integrate it as the
> **cheap-cloud primary**; keep gpt-4o as the **last-resort fallback** for the hard tail
> (handwriting / poor scans). Receipts-first; reuse the existing tiered seam; ≤12 api/*.js.

## What exists (UW#4b)
`ocrPdfToTextTiered` (document-text.js): free OSS (workstation) → `ocrCloudCheap` (the
`OCR_CLOUD_OCR_URL` HTTP seam) → gpt-4o last resort. `ocrCloudCheap` already POSTs base64 + reads
back `{text, confidence}`. The cheap-cloud provider was never wired (no creds). This wires Google
Document AI behind that seam.

## The ask
1. **Build a thin Document AI HTTP wrapper** (the SHAREPOINT_FETCH_URL webhook pattern — a small
   Edge Function / handler, NOT a new api/*.js): accept `{ content_base64, mime_type }`, call the
   Google Document AI **Enterprise Document OCR** processor (`documents:process`), return
   `{ text, confidence }` in the shape `ocrCloudCheap` already expects. Auth to GCP via a service
   account key held server-side (Scott provisions — see below).
2. **Point the seam at it:** `OCR_CLOUD_PROVIDER='google_docai'` (or `OCR_CLOUD_OCR_URL` = the
   wrapper URL) so `ocrCloudCheap` routes to Document AI. Keep `cheap-cloud → gpt-4o last resort`
   ordering intact (gpt-4o only when Document AI fails/low-confidence). Free OSS tier stays first.
3. **Per-page cost guard / logging:** log pages processed + provider per tick so the spend is
   observable (Document AI bills per page). Honor the existing `OCR_CLOUD_ESCALATION` master switch.

## Scott's part (creds — not CC's to handle)
Create a GCP project, enable Document AI, create an **Enterprise Document OCR** processor, and
provide the processor endpoint + a service-account key. The $300 new-account credit covers the full
deed + lease backfill. (I can walk Scott through the GCP console steps separately.)

## Gate
- A capped deed/lease OCR drain routes scanned docs to Document AI (not gpt-4o), returns real text +
  confidence, fills grantor/price (deeds) / escalation-guarantor (leases), and gpt-4o fires ONLY on
  Document-AI misses. Cost log shows Document AI pages, ~$0 under credit. Free OSS tier unaffected;
  R58's other gpt-4o OCR paths untouched (UW#4b scope guard holds).
