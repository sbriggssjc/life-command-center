# Claude Code — R58: add the OCR/text foundation + wire the orphaned deed parser (read the docs we already hold)

## Why (audit live 2026-06-20 — see AUDIT_document_intelligence_2026-06-20.md)
We file documents well but only OMs are deeply extracted:
- 1,975 `property_documents` across both domains; `raw_text` + `extracted_data` **empty for all**.
  Only `om` shows `ingestion_status='extracted'`; deed/other/brochure are `url_captured`
  (filed, unread); dd/master/comp/bov are `enriched` (fill-blanks, not content parse).
- **The deed parser is built but ORPHANED:** `api/_handlers/deed-parser.js`
  (`parseDeedText`/`crossReferenceDeed`/`processDeedDocument`) extracts grantor, grantee,
  **transfer-tax→implied price**, recording date, APN, and upgrades sales to `deed_verified` — but
  has **zero callers**. ~317 deed PDFs (159 gov + 158 dia) sit unparsed while R51/R53 rely on
  CoStar's captured grantee and never get the deed's implied price.
- **Root blocker:** no OCR/text step populates `property_documents.raw_text`. OCR exists only in the
  intake pipeline (OMs via `staged_intake_artifacts`, incl. the Fresenius fix) and is never reused
  for attached deed/lease PDFs. Same wall hit the Stage B lease extractor (160/298 = `needs_ocr`).

## House rules
Reuse existing machinery — the intake pipeline's PDF-text/OCR, `deed-parser.js`, the Stage B
lease-extractor — **do not rebuild parsers or OCR**. Deed results flow through R51's owner-deed path
(deed grantee → `recorded_owner`, gated) and R53 (suspected-sale confirm + price as a CANDIDATE,
never an auto-overwrite of curated data). Respect R51 gates (deed wins for recorded_owner only;
never clobber manual/true_owner). Value-ranked backfill; idempotent; reversible; gov + dia; ≤12
`api/*.js` (extend handlers/_shared, no new api/*.js); `node --check`/suites green; DB live after a
dry-run.

## Unit 1 — shared document-text/OCR step (the missing foundation)
A function/worker that, given a `property_documents` row with a `source_url` and empty `raw_text`,
fetches the PDF and extracts text (digital text first, OCR fallback), writing `raw_text` +
setting `ingestion_status` (`text_extracted` / `needs_ocr` if image-only and OCR unavailable).
**Reuse the intake pipeline's existing pdf-parse + OCR path** (the same code that handled the
Fresenius zero-text OM) rather than a new dependency. Bounded/time-budgeted worker
(`?_route=document-text-tick`), idempotent (only rows with null raw_text), value-ranked by the
property's rent. This populates the foundation every parser needs.

## Unit 2 — wire the deed parser (highest value)
Once a deed-type doc has `raw_text`, run `processDeedDocument(domain, property_id, document_id,
raw_text)`:
- writes the parsed grantor/grantee/recording-date/implied-price into the deed/sales path,
- `crossReferenceDeed` upgrades the matching `sales_transaction` to `deed_verified` and supplies
  the **implied price** where the sale lacked one (candidate, confirm-gated — never overwrite a
  curated price),
- feeds the deed grantee into **R51's `v_owner_source_conflict` / owner-deed propagation** (so a
  parsed deed becomes an authoritative owner signal) and **R53** (confirms/strengthens a suspected
  sale, attaches the price).
Wire it on new deed attach (folder-feed / sidebar deed path) AND a one-time **backfill of the ~317
existing deeds**, value-ranked. Report how many parsed cleanly, how many sales got `deed_verified`,
how many implied-prices recovered.

## Unit 3 — clear the lease OCR tail
Run Unit 1's OCR over the 160 `needs_ocr` Stage B leases so the existing lease-extractor completes
on them (no new extractor — just feed it the text). Report the lease fields recovered.

## Unit 4 — (Phase 2, document only) rent-roll + dd/bov
Note as deferred follow-ups on the same `raw_text` foundation: a rent-roll extractor (tenant / SF /
rent / expiration per suite → lease economics + NOI) and dd/bov parsing. Do NOT build this round —
just confirm the foundation supports it.

## Verify (report back)
- Unit 1: a sample deed/lease PDF gets `raw_text` populated (text or OCR); `needs_ocr` only where
  genuinely image-only + OCR unavailable.
- Unit 2: a synthetic/real deed parses → grantor/grantee/implied-price extracted; a sales row
  upgraded to `deed_verified` (reversible); the grantee flows into R51's conflict view; 0 residue
  on synthetic. Backfill count of the ~317.
- Unit 3: count of `needs_ocr` leases cleared + fields recovered.
- No curated data clobbered (prices/owners are confirm-gated candidates); suites green; ≤12 api/*.js.

## Bottom line
A full deed-extraction engine — including implied sale price — sits orphaned because nothing OCRs
the PDFs we already hold. R58 adds the shared text/OCR foundation (reusing intake OCR), wires the
built deed parser into R51/R53, and clears the lease OCR tail — so the document layer becomes a
fed-back source of authoritative ownership, price, and lease data instead of a filing cabinet.
