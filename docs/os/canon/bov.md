# BOV / Valuation Canon
Canon: v1.0.0

## Purpose
BOVs, valuation memos, and pro formas are built record-first and reflect contractual reality — identical
inputs → identical workbook, on every surface.

## Triggers
"BOV", "valuation", "pro forma", "underwriting", "disposition model", "cap rate analysis", "OM".

## Inputs
`property_lookup` (address) or `cre_property_id` for a known LCC property; the actual lease (rent steps/options).

## Procedure
1. **Record-first:** pass the address/id so every caller gets the identical workbook (`generate_bov`).
   Hand-author only brand-new deals.
2. **Lease terms before assumptions (hard rule):** pull and cite the lease's actual rent provisions
   (escalations/options) before entering any growth assumption. Fall back to flat/no-growth — clearly flagged —
   only when the lease is explicitly silent. **Never** default to a "market" escalation guess (this is the
   Broken Arrow Dollar General failure mode).
3. Workbook edits (cells) that Work IQ can't reach (>5 MB) run via the Document Assembly Agent
   (Excel Online + Office Scripts); apply only what the record/lease states.

## Output contract
Briggs BOV workbook; formula-protected columns never overwritten; escalation schedule matches the lease;
memo cites the source terms.

## Never
- Never fabricate an escalation schedule or assumption.
- Never overwrite formula-protected columns.

## Surface bindings
Copilot: `GenerateDocument`/`generate_bov` via LCC Intelligence + Document Assembly Agent. Claude
Personal/Cowork: `bov-underwriting` / `bov-government` skills + MCP `generate_bov`. Northmarq: project action
`generate_bov`.

## Extension notes
New underwriting structures (ground lease, MOB, NNN variants) extend the BOV engine + this rule, not a surface.
