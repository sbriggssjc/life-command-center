# Audit — document intelligence / extraction coverage (2026-06-20)

**Question (Scott):** we attach OMs, leases, deeds, rent rolls, estoppels, BOVs to properties. Is
their CONTENT extracted into structured fields and propagated, or are most types just filed and
never read after the first pass?

## Verdict: only OMs are deeply extracted; the deed parser is BUILT BUT ORPHANED; everything else is filed-not-read — all blocked by a missing OCR/text step

### The document inventory (all have files)
| type | gov | dia | extraction status |
|---|---|---|---|
| om | 242 | 435 | **extracted** (intake pipeline) |
| lease | 107 | 190 | **partial** (Stage B; OCR-limited) |
| deed | 159 | 158 | `url_captured` — **attached, never parsed** |
| other | 153 | 140 | `url_captured` — unread |
| brochure | 42 | 68 | `url_captured` — unread |
| dd | 37 | 119 | `enriched` (folder-feed fill-blanks, not deep parse) |
| master | 29 | 38 | `enriched` |
| comp | 9 | 30 | `enriched` |
| bov | 6 | 12 | `enriched` |
| survey | 1 | 1 | `url_captured` |

`property_documents` has `raw_text` + `extracted_data` columns, but **both are empty across every
type** (OM extraction lives in the intake staging tables, not on the doc record). So `ingestion_status`
is the real signal: **`extracted` appears only on OM**; deed/other/brochure/survey are
`url_captured` (filed, unread); dd/master/comp/bov are `enriched` (attach + fill-blanks, not content
extraction).

### Headline — the deed parser is fully built and wired to NOTHING
`api/_handlers/deed-parser.js` extracts document number, **recording date, transfer-tax →
implied sale price**, **grantor, grantee**, APN, title company, entity types — and
`crossReferenceDeed` upgrades the matching `sales_transaction` to **`deed_verified`**. But grep
shows `processDeedDocument` / `parseDeedText` / `crossReferenceDeed` have **zero callers** anywhere
in the codebase. So **~317 deed PDFs (159 gov + 158 dia) sit attached and unparsed**, while R51
(owner conflict) and R53 (suspected sale) rely on CoStar's *captured* grantee instead of the
authoritative deed we already hold — and the deed's **implied price** (from transfer tax) is never
extracted at all, despite being gold for cap-rate/comps and confirming R53's suspected sales.

### Root blocker — no OCR / text-extraction step feeds the parsers
`property_documents.raw_text` is empty for all 1,975 docs. The deed parser needs `rawText`; the
Stage B lease extractor hit the same wall (160 of 298 leases = `needs_ocr`). OCR/pdf-text
capability EXISTS but only in the **intake pipeline** (for OMs via `staged_intake_artifacts`, incl.
the Fresenius OCR fix) — it's never reused for the deed/lease PDFs attached directly to
`property_documents`. So the single missing foundation — extract text from an attached PDF — blocks
deed parsing, the lease OCR tail, and any future doc-type extraction.

### Also missing
- **Rent rolls** aren't even a doc type — they live inside OMs or in `other`/`dd`; there's no
  dedicated rent-roll extraction (tenant / SF / rent / expiration per suite → lease economics + NOI).
- **dd / bov / master / comp / other** (~640 docs across domains) have no content-extraction path.

## Fix doctrine → R58 (the OCR foundation + wire the orphaned deed parser)
The pattern is the now-familiar one — capability built, not wired (R5 fan-out before R48, geocode
before R50, the deed parser now). The unlock is one shared foundation + wiring what exists:
1. **Shared document-text/OCR step** — populate `property_documents.raw_text` from the PDF (digital
   text first, OCR fallback), **reusing the intake pipeline's existing OCR** rather than rebuilding.
   This is the missing foundation feeding every parser.
2. **Wire the orphaned deed parser** — once raw_text exists, run `processDeedDocument` on
   `document_type='deed'` docs → grantor/grantee/implied-price/recording-date, cross-reference,
   `deed_verified` upgrade. Feed the result through R51's owner-deed path (deed grantee → owner) and
   R53 (confirm/strengthen suspected sales, supply the price). Backfill the ~317 existing deeds,
   value-ranked. **Respect R51's gates** (deed wins for recorded_owner only, never clobber
   manual/true_owner; price as a candidate to confirm, not an auto-overwrite).
3. **Unblock the lease OCR tail** — the same OCR layer clears the 160 `needs_ocr` leases so Stage B
   lease extraction completes.
4. **(Phase 2)** rent-roll + dd/bov extraction on the same raw_text foundation.

## Bottom line
We file documents well but read only OMs. A complete deed-extraction engine — including the implied
sale price — sits orphaned with no caller, ~317 deeds unparsed, because nothing OCRs the attached
PDFs. R58 adds the shared text/OCR foundation (reusing intake OCR), wires the built deed parser into
R51/R53, and clears the lease OCR tail — turning the document layer from a filing cabinet into a
fed-back source of authoritative ownership, price, and lease data.
