# Prompt 17 — Data-integrity fixes surfaced by 03/02 (Northmarq flag + broker role constraint)
- Priority: **P1**
- Status: open (drafted 2026-08-01)
- Related: `done/03-broker-role-attribution.response.md`, `done/02-connect-deal-spine.response.md`
- Response file: `../responses/17-data-integrity-fixes.response.md`

## Prompt (copy/paste to Claude Code)
```
Two data-integrity issues surfaced while wiring the deal spine on property 35724 (Fresenius Woodland Hills):
1. is_northmarq is FALSE on dia.sales_transactions.sale_id=14832, but this IS a Team Briggs / Northmarq
   sell-side deal (Scott confirms). The broker-role reconciliation had to use --force-northmarq to correct 35724.
   Trace why is_northmarq is false for our own closed listing (the SF/roster -> comp flag path), fix it for 35724,
   and audit for other Northmarq deals mis-flagged is_northmarq=false so the reconciliation runs automatically
   (not just via --force).
2. The dia sale_brokers_role_check constraint blocks role='as_reported_listing', so CoStar's third-party broker
   view is retained only in LCC conflict/disagreement tables, not the domain sale_brokers junction. Widen the
   check constraint to allow 'as_reported_listing' (and 'co_broker' if not already), then persist the CBRE
   as-reported row on 35724 in sale_brokers with that role. Keep the conflict open until human-resolved.
Verify 35724: is_northmarq true, listing_broker Team Briggs, CBRE persisted as as_reported_listing, conflict open.
```

## Verify
35724 reads is_northmarq=true; the Northmarq broker reconciliation runs without --force; sale_brokers accepts
as_reported_listing and holds the CBRE row; other mis-flagged deals identified.
