# Extraction → Propagation Gap Audit (2026-06-22)

**Context.** Document AI OCR is now live (UW#4c) and the lease thin-text gate (UW#5) +
narrative deed parser (R58c) ship, so the document-extraction paths (deeds, leases) finally
yield rich structured data at scale. This audit follows that extracted data through the DB +
code to find where it LANDS but fails to UPDATE/IMPACT the rest of the system —
the propagation gaps Scott named: sales created, prospects created, ownership history,
prompting the user for research.

Grounded on real records: **deed doc 3964 → dia property 24703** (1200 Deltona Blvd, FL;
grantor *Oldsmar Retail Development LLC* → grantee *Deltona Wellness, LP*, $13,333,400,
2020-01-21) and **enriched estoppel 2835** (Walterboro; google_docai 98.5%, 8 fields,
guarantor edge, 4 conflicts).

---

## What each extractor PROPAGATES today (the wiring that exists)

**Deed parser** (`api/_handlers/deed-parser.js` `processDeedDocument`/`crossReferenceDeed`):
- ✓ `properties.latest_deed_grantee` / `latest_deed_date` (fill-blanks) → drives the **R51
  owner-conflict lane** + the gated owner-deed-autofix. *(Verified: 24703.latest_deed_grantee
  = "Deltona Wellness, LP".)*
- ✓ `deed_records` archival insert (when document_number + county present).
- ✓ price cross-ref vs an EXISTING `sales_transactions` row on `property_id` — records a
  "deed_verified" flag in `extracted_data` (no DB confidence column).
- ✓ gated implied-price fill on a NULL-price matching sale (`DEED_IMPLIED_PRICE_FILL`).
- ✓ `extracted_data.deed_extraction` (grantor/grantee/county/price/doc-stamp/type).

**Lease extractor** (`api/_handlers/lease-extractor.js` + `attachLeaseDoc`):
- ✓ `leases` fill-blanks + lease creation when absent (Stage B Unit 1).
- ✓ `property_financials` from the expense schedule (`is_actual=false`, NOI null — explicit
  cap-rate-history BOUNDARY).
- ✓ guarantor `entity` + `guaranteed_by` edge; TI rows; `field_provenance`.
- ✓ provenance conflicts → Decision Center.

---

## THE GAPS (extraction lands, propagation doesn't)

### GAP A — deed buyer/seller never reach the sale row  *(HIGH, fill-blanks-safe)*
The deed is the **authoritative** source of a sale's buyer (grantee) and seller (grantor),
but the parser never writes `sales_transactions.buyer_name` / `seller_name`.
**Verified:** sale 14751 on 24703 (the matching CoStar sale, $13.7M, 2020-01-16) has
`buyer_name = NULL` and `seller_name = NULL`, while the deed holds *Deltona Wellness, LP* /
*Oldsmar Retail Development LLC*. Systemic (the code path has no such write). This is free,
high-value comp-quality data being discarded — and it feeds the buyer-cohort / repeat-buyer
(R5) machinery that keys on sale buyer.

### GAP B — a recorded deed creates no `ownership_history` event  *(HIGH)*
A deed transfer is THE canonical ownership-change event, but the parser writes no
`ownership_history` row. **Verified:** 24703 has `ownership_history` = 0 rows despite a
clean 2020 title transfer. Result: the ownership timeline (current owner → developer chain,
the R6 chain-completeness work) can't see deed-sourced transfers, and SPE→parent tracing
loses a primary signal.

### GAP C — a deed transfer with a price but NO existing sale is lost as a sale  *(MED)*
The parser only CROSS-REFERENCES an existing `sales_transactions` row; if a deed transfer
has no matching sale (common for off-market / county-only transfers), the transfer + price
is never recorded as a sale. (24703 happened to have a CoStar sale; many won't.) Gov has the
R53 `gov_confirm_suspected_sale` pattern (operator-gated, price-required) — the deed path
could feed that lane instead of silently dropping the transfer. Needs care (a deed can be a
refi/intra-family transfer, not an arms-length sale).

### GAP D — a new owner from a deed creates no prospect / BD opportunity  *(MED-HIGH)*
A grantee acquiring a $13.3M asset is a textbook BD signal (new owner to prospect, or a
repeat buyer). The deed feeds only `latest_deed_grantee` (a name string for the R51 conflict
lane); it does not create/resolve a grantee **entity**, link it to the asset, or open a
prospect. The R51 lane surfaces the owner *conflict* for the operator, but there's no
BD-spine entry for the new owner until/unless someone works that lane.

### GAP E — neither deed nor lease enrichment prompts the user for research  *(MED)*
No `research_task` / `lcc_open_decision` is opened from a freshly-extracted deed or lease.
Examples that SHOULD prompt: deed grantee is an unfamiliar LLC (→ "trace Deltona Wellness LP
to parent"); a deed transfer with no sale (→ "confirm sale / price"); a lease whose
extracted tenant ≠ the property's recorded tenant; a guarantor that doesn't resolve. Today
these just sit in `extracted_data` / provenance.

### GAP F — new lease rent does NOT recompute existing sale cap rates  *(known, prompted)*
Lease enrichment deliberately doesn't touch `cap_rate_history` (boundary). So a property
whose Year-1 rent just landed via OCR keeps stale/blank cap rates on its sales. Already
grounded + prompted (rent→cap-rate propagation, prior round #123-125) — re-flagged here
because the OCR unlock now lands rent on far more properties, raising its value.

### GAP G — deed/lease guarantor + grantee entities aren't wired into the value/queue spine
The lease guarantor entity + `guaranteed_by` edge are created, but a guarantor/grantee entity
with no portfolio edge / opportunity / cadence doesn't surface in the priority queue or
owner-value ranking. (Consistent with the CRE-registry "bare entity doesn't appear until it
earns an edge" doctrine — but for a $13M-asset grantee that's arguably a miss.)

---

## Drain-coverage finding (separate from propagation)
- **157 scanned leases** (121 dia + 36 gov) parked `needs_ocr` while Document AI was down
  were terminal-marked and NOT re-included by UW#5 (which targets `thin_text_layer` only).
  Re-enabled this session (reversible marker clear); they now flow through the normal
  lease-backfill drain. **Part of that backlog is `.xlsx`/`.docx`** (lease abstracts/comps),
  which OCR can't address — they re-park `needs_ocr`. Two follow-ups: (a) a recurring
  lease-backfill cron (currently operator-driven) or a reparse-selector extension that
  re-includes `reason='needs_ocr'` PDFs, and (b) a docx/xlsx lease-abstract text extractor
  (or reclassify them out of the OCR queue so they stop re-parking).

---

## Recommended fixes (ranked)

1. **GAP A + B together (one deed-parser change):** on a confident deed match, fill the
   matching sale's `buyer_name`/`seller_name` from grantee/grantor (fill-blanks only, never
   clobber), AND append an `ownership_history` row (`change_type='deed'`,
   `data_source='deed_extraction'`, grantor→grantee, date). Both ride the existing
   `processDeedDocument` match; both are fill-blanks/append-only and reversible. Highest
   value-per-effort.
2. **GAP D:** resolve the grantee to an LCC entity via the existing `ensureEntityLink` +
   open the R51/owner path (or a prospect) so a new high-value owner enters the BD spine —
   reuse R5/R6 machinery, don't fork.
3. **GAP E:** open a `research_task` from the deed/lease path on the clear triggers
   (unfamiliar grantee LLC, transfer-without-sale, tenant mismatch, unresolved guarantor),
   gated + value-ranked like the existing research-task producers.
4. **GAP C:** feed deed-transfer-without-sale into the R53 `suspected_sale` lane
   (operator-confirmed price) rather than dropping it.
5. **GAP F:** the already-written rent→cap-rate propagation fix (prior round) — re-prioritize
   now that OCR lands rent broadly.

Each is additive, fill-blanks/append-only, reversible, ≤12 api/*.js, and reuses existing
machinery (R5 buyer cohort, R6 ownership chain, R51 owner conflict, R53 suspected sale,
research-task producers). Claude Code prompts to follow per Scott's pick.
