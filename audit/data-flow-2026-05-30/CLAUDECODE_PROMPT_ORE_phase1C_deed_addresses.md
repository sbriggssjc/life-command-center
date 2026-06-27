# Claude Code — ORE Phase 1 Unit C: capture deed grantee/grantor addresses (the owner mailing address)

## Why (audited 2026-06-27)

Owner mailing/notice addresses — the signal Scott's cross-match method keys on —
exist for <1% of gov owners, even though we parse deeds constantly and **deeds
reliably carry the grantee "after recording return to …" mailing address** (plus
"whose address is …" narrative addresses for grantor + grantee). The deed parser
(`api/_handlers/deed-parser.js`) even has the regex to find these — and then
**`leadingEntityName()` strips them** during party extraction, and `deed_records`
has no address column anyway. So ~100% of deed-borne owner addresses are discarded.

This is the address dimension that made the cross-reference resolver's
`same_asset`/address strategy return 0 earlier today. Capturing it is the
foundation for address-based owner cross-match + consolidation (Phase 2).

## Unit C — keep the deed addresses and write them

In `deed-parser.js`:
1. **Extract, don't strip.** In `parseDeedText` / the narrative party extraction,
   capture the grantee "return to" mailing address and the grantor/grantee "whose
   address is …" addresses BEFORE `leadingEntityName()` discards everything after
   the address markers. Keep the cleaned party NAME (current behavior) AND the
   parsed address (new). Parse into street / city / state / zip where possible.
2. **Store on the deed record (audit) + propagate to the owner (actionable):**
   - Add `grantee_address`, `grantor_address` columns to `deed_records` (gov + dia;
     additive migration) and write them.
   - Propagate the **grantee** mailing address → the resolved `recorded_owners`
     owner-address field (fill-blanks only; gov uses `contact_info` jsonb / add a
     `mailing_address` column, dia has `address`/`city`/`state`). Provenance
     `source='recorded_deed'` via the existing field-priority machinery (register
     the new fields; recorded_deed already ranks above aggregators per R51).
   - The full parsed address already lands in `property_documents.extracted_data`;
     this makes it queryable + owner-attached, not just buried in JSONB.
3. **Fill-blanks / never clobber / reversible**, idempotent on re-parse; the
   grantee-name → owner propagation reuses the R51 deed→owner path (don't fork it).

## Re-process the existing deeds (ties to the OCR backlog #3)

Newly-parsed deeds capture addresses going forward; the existing corpus needs a
re-parse to backfill. This rides the same deed re-extraction as the OCR/extraction
backlog (#3 — ~366 deeds with `raw_text` null). Sequence: OCR the scanned deeds
(separate #3 work) → re-run the deed parser (now address-capturing) → addresses
populate. Note the dependency; don't duplicate the OCR work here.

## Scope / verify

- `deed-parser.js` (LCC) + additive gov/dia migrations for the new `deed_records`
  address columns + the `recorded_owners` mailing-address field; provenance rows.
- Fill-blanks, provenance-gated (`recorded_deed`), reversible, idempotent; the
  established discipline.
- Unit-test the address extraction (grantee return-to, grantor/grantee "whose
  address is", with/without city/state/zip) — esp. that the NAME is still cleaned
  correctly while the address is now retained.
- **Dry-run / sample first:** on a batch of already-parsed deeds (re-parse in
  memory), report how many would yield a grantee address + a sample, before writing.
- **Live proof (Cowork):** deed_records address columns populate on re-parse;
  recorded_owners gains mailing addresses (provenance recorded_deed); spot-check a
  few against the source deed; owner address coverage rises from <1%.

## Documentation

Update the ORE design doc + gov/dia CLAUDE.md: deed grantee/grantor address capture
(stop stripping in `leadingEntityName`), stored on deed_records + propagated to the
owner mailing address with `recorded_deed` provenance; re-parse rides the deed OCR
backfill.

## Bottom line

Deeds hand us the owner's mailing address on a plate and we throw it away at the
parser. Keep it, store it on the deed, and propagate the grantee address to the
owner — restoring the address dimension that owner cross-match + consolidation
(Phase 2) depend on. Pairs with the OCR backlog re-parse.
