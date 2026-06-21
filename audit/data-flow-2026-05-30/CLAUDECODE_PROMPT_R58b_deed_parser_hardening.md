# Claude Code — R58b: harden the deed parser to the real deed formats (the text is there; the parser misses it)

## Why (live Activation-3 drain, 2026-06-21)
The R58 `document-text-tick` pipeline is live and the **text foundation works** — capped real
drain of dia deeds extracted full text via both paths (`pdf_text` 9.4k chars; **OCR** 11.7k chars,
confirming `OPENAI_API_KEY` is engaged on scanned PDFs). But `deed_parsed` yielded **grantor/grantee
= NULL on every doc**, so `deed_records_created = 0`, `r51_fed = 0`, `sales_verified = 0`. The
parties are plainly IN the stored `raw_text`; `parseDeedText` just doesn't recognize the two most
common real-world deed formats. This is a **parser gap, not a data gap.** Until it's fixed, draining
the 325-deed backlog (dia 158 + gov 167) only banks raw_text and produces ~0 R51 feed.

Two real examples from the drain (both now have `raw_text`, `grantor/grantee` NULL):

- **dia doc 3964** (`pdf_text`) — narrative form + explicit price:
  `… Transfer Amt $13,333,400.00 … SPECIAL WARRANTY DEED … by and between Oldsmar Retail
  Development LLC, a Florida limited liability company … (the "Grantor"), and Deltona Wellness, LP,
  a Florida limited partnership … (the "Grantee") …` (Doc Stamps $93,333.80 = 0.7% FL rate ✓).
- **dia doc 3807** (`OCR`) — county/Simplifile cover-page labels:
  `… First Grantor: TRIVIUM GROVE CITY LLC First Grantee: CHF II GROVE CITY MOB LLC …` (real
  ownership change on a dia MOB → exactly an R51 feed).

## House rules
gov/dia + LCC conventions, surgical/reversible, reuse the existing R58 machinery
(`deed-parser.js` `parseDeedText` / `crossReferenceDeed` / `processDeedDocument`, the R51
fill-blanks/newer-only feed, `granteeIsPlausible`, the gated `DEED_IMPLIED_PRICE_FILL`).
≤12 `api/*.js`. `node --check` + the deed-parser test green. No new domain writes beyond what R58
already does (this just makes the parser actually yield the parties it already has in text).

## Unit 1 — recognize the two dominant grantor/grantee formats
Extend `parseDeedText` so it extracts parties from BOTH (in addition to whatever it does today):

1. **Labeled cover-page form** (county recorder / Simplifile cover sheets):
   `First Grantor:`, `Grantor:`, `First Grantee:`, `Grantee:` (case-insensitive; "First " optional;
   also tolerate `Grantor(s):`/`Grantee(s):`). Capture the value up to the next label / line break /
   `Fees:` boundary. There can be multiple grantors/grantees — take the first as primary, keep the
   set if cheap.
2. **Narrative parenthetical form** (the body of most warranty/quitclaim deeds):
   `… between <GRANTOR NAME> [, a <entity qualifier>] … (the "Grantor"), and <GRANTEE NAME>
   [, a <entity qualifier>] … (the "Grantee") …`. Capture the name token immediately preceding each
   `(the "Grantor")` / `(the "Grantee")` parenthetical; STRIP trailing entity qualifiers
   ("a Florida limited liability company", "a/k/a …", "whose address is …") so the stored name is the
   clean entity (e.g. `Oldsmar Retail Development LLC`, `Deltona Wellness, LP`). Curly and straight
   quotes both (" " and ").

Keep the existing guards: run each extracted party through `granteeIsPlausible` / the junk filters;
a deed-of-trust (trustor/trustee/beneficiary, no grantor/grantee) legitimately yields null — don't
force a match. Prefer the labeled cover-page parties when both a cover sheet AND a body are present
(cover sheets are the recorder's authoritative party fields).

## Unit 2 — price extraction (feeds sale verification + the gated implied-price candidate)
From the deed text capture a sale price when present, in priority order:
1. **Explicit transfer amount** — `Transfer Amt $13,333,400.00`, `Total Consideration $…`,
   `consideration of $…` (when a real dollar figure, not the nominal "$10.00 and other good and
   valuable consideration"). Use directly.
2. **Doc-stamp / transfer-tax back-out** — `Doc Stamps $93,333.80` → price = stamps / state_rate
   (FL deed = 0.0070; make the rate a small per-state map, default skip if unknown). Sanity-check
   against #1 when both exist (3964: 13,333,400 × 0.007 = 93,333.80 ✓).
Route the price exactly as R58 already does: verify a matching `sales_transactions` row
(fill-blanks/newer-only), and only WRITE an implied price behind `DEED_IMPLIED_PRICE_FILL`
(unchanged gate). An explicit transfer amount is higher-confidence than a doc-stamp estimate — tag
it so (`price_source = 'transfer_amount' | 'doc_stamp_estimate'`).

## Unit 3 — re-parse mode (don't re-spend OCR on already-text'd docs)
The worker selects `raw_text IS NULL`, so the 2 docs already OCR'd this session (and any future
text-banked docs) will never be re-parsed when the parser improves. Add a **re-parse path**:
`?_route=document-text-tick&mode=reparse` (or a `reparse=1` param) that selects docs with
`raw_text IS NOT NULL` AND `document_type ILIKE '%deed%'` AND no parsed parties yet
(grantor/grantee null / no linked `deed_records` / `extracted_data` lacks grantee) and runs ONLY
`crossReferenceDeed`/`processDeedDocument` over the stored text — **no fetch, no OCR.** Idempotent;
capped + time-budgeted like the main tick. This makes parser improvements cheap to apply
retroactively and means a broad OCR drain is never wasted.

## Verify (report back)
- `mode=reparse` over dia doc **3964** → grantor `Oldsmar Retail Development LLC`, grantee
  `Deltona Wellness, LP`, price `$13,333,400` (`transfer_amount`); deed_records_created +1, r51_fed
  +1 (or a clean reason if the property's recorded owner is already newer).
- `mode=reparse` over dia doc **3807** → grantor `Trivium Grove City LLC`, grantee
  `CHF II Grove City MOB LLC`; R51 fed.
- A deed-of-trust sample still yields null parties (no false extraction).
- `node --check`; ≤12 api/*.js; deed-parser test green (add cases for both formats + the two price
  paths); reversible.

## Bottom line
R58 proved the text/OCR foundation reads the documents we hold. R58b makes the parser actually pull
the grantor/grantee/price that are sitting in that text — for the two formats that cover the real
deed corpus — and adds a no-OCR re-parse pass so the fix applies to everything already read. Then the
full 325-deed drain produces real R51 owner-conflict signals + verified sale prices, not just stored
text.
