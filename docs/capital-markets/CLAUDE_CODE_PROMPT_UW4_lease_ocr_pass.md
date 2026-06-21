# Claude Code prompt — UW#4: OCR pass for scanned lease PDFs (unlock the #1 lever)

> From the underwriting data-quality audit. UW#2 activated the lease-document extractor — the #1 free
> lever for the doc-only fields (escalation, guarantor, renewal, expiration, expense structure). But
> **54% of executed lease PDFs are scanned image-only → `needs_ocr` → 0 fields filled** (the extractor
> needs a text layer). OCR is the unlock for the unlock. Free-first; receipts-first; gated; the OCR'd
> text feeds the EXISTING lease extractor — this adds a text layer, it does not change the extractor
> or its guards.

## Grounding (live, 2026-06-20)
- ~1,610 detected_type='lease' folder-feed docs, avg **2.4–3 MB** (scanned-PDF size). The prior
  298-doc lease-backfill drain measured **160 needs_ocr (54%)** vs 88 enriched — the enriched set was
  the text-bearing minority. `needs_ocr` is recorded terminal with `text_len`, so a no/low-text layer
  is the trigger. The doc-only lease fields sit on the floor (dia escalation 2%, guarantor 5%,
  renewal 15%) precisely because the lease economics live in these scanned PDFs.
- **Exact OCR universe firms up from the live lease drain** (the capped→broad drain Scott runs on
  Railway) — this prompt is the build; the drain gives the precise count. Build is volume-independent.

## The build (free-first, escalate only if needed)
1. **Detect** the no/low-text-layer PDFs at extraction time (the existing `needs_ocr` signal /
   `text_len` below a threshold) — the trigger already exists; route those to the OCR step instead of
   terminating `needs_ocr`.
2. **OCR free tier** — run the scanned PDF through a free OCR (Tesseract via `ocrmypdf`, which adds a
   text layer in-place; or `pytesseract` per-page). Produce the text layer, then **feed it back into
   the EXISTING lease extractor** (same extractor, same four guards, same fill-blanks + provenance
   `source='folder_feed_lease'` — OCR only supplies the text the extractor was missing).
3. **Escalate tier (only on free-tier failure)** — for scans Tesseract can't resolve (poor scans,
   handwriting, complex tables), fall back to a cheap cloud OCR (Azure Document Intelligence / Google
   Document AI — ~$1.50/1k pages). Feature-flag the cloud tier (off until blessed; the
   find_contacts_by_account rollout pattern) so the free tier proves out first and the spend is a
   deliberate, sized decision — NOT a default.
4. **Confidence + provenance** — tag OCR-sourced extractions with a confidence marker so a low-OCR-
   confidence field can be flagged for review rather than trusted blind. OCR'd lease economics ride
   the same `warn`-mode provenance (conflicts → Decision Center, never a clobber).

## Capped → gate → drain (same discipline as UW#2)
- Run a CAPPED OCR pass (e.g. 10–20 of the highest-value needs_ocr leases — real DaVita/GSA executed
  leases) as the gate batch. Report: text-layer recovered, fields filled per doc, OCR confidence
  distribution, free-tier hit rate vs escalation rate, and 0 guard violations. Only after the gate →
  broad OCR drain.
- Prioritize the OCR queue by underlying lease VALUE (rent × term) so the highest-impact leases get
  the text layer first.

## Boundaries / gate
- OCR adds a text layer ONLY — it does not change the extractor, the four guards (location / draft /
  operator / multitenant), fill-blanks, or the provenance gate. No fabrication — a field the OCR'd
  text doesn't state stays blank. Cloud tier feature-flagged off until blessed. Reversible. ≤12
  api/*.js. dia/gov pipelines otherwise untouched.
- My gate: capped batch recovers text + fills escalation/guarantor/renewal from real scanned leases,
  OCR confidence is recorded, free-tier hit rate is measured, guards held, idempotent. Then size the
  broad drain (and the cloud-tier spend, if the free tier leaves a meaningful tail) on those receipts.

## Sequencing note
This logically FOLLOWS the live UW#2 lease drain — run the capped lease drain first (Scott's Railway
step) to get the real needs_ocr universe + the highest-value targets, THEN the capped OCR gate. The
two share the same extractor + guard path, so OCR is purely additive.
