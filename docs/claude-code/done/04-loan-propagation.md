# Prompt 04 — Loan propagation (entity metadata -> structured loans)
- Priority: **P1**
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/DOSSIER-PROGRAM-STATE-OF-PLAY.md`; entity bd4aab4a / property 23654
- Response file: `../responses/04-loan-propagation.response.md`

## Prompt (copy/paste to Claude Code)
```
Loan data exists in entities.metadata.loans (e.g. entity bd4aab4a / property 23654 carries a $1.8M JPMCC
2019-COR4 CMBS 1st mortgage, 4.7% fixed, matures 2028-07-06, originated 2018-06-08, LTV 57.4%, special servicer
Midland) but the dialysis `loans` and `mortgage_records` tables are EMPTY for the asset, so the dossier shows
loans as "Not on file." Build a propagation from entities.metadata.loans -> the structured loans table (initial
balance, lender, rate, maturity, origination, term, LTV, current-balance estimate), keyed by the property via
external_identities (dia, asset, property_id). Suppress brokerages from being written as lenders (the
finances-edge pollution; e.g. Marcus & Millichap is a broker, not a lender). Verify property 23654 shows the
JPMCC loan in its dossier. Then generalize across all asset entities that carry metadata.loans.
```

## Verify
dia loans/mortgage_records populated for 23654 (JPMCC $1.8M, 4.7%, matures 2028-07-06); no brokerage recorded as
lender; the property dossier loan section renders it; the propagation runs fleet-wide over metadata.loans.
