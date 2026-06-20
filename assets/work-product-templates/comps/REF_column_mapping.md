# Comps Column Mapping Reference

## Sales Comps — On Market Sheet (Table: "Available")

| Template Column | CoStar Field | Salesforce Field |
|---|---|---|
| Property Name | Property Name | Property Name |
| Address | Address | Street Address |
| City | City | City |
| State | State | State |
| RBA (SF) | Building Size | RBA |
| List Price | For Sale Price | Asking Price |
| List Date | For Sale Date | List Date |
| Tenant | Tenant Name | Primary Tenant |
| Lease Type | Lease Type | Lease Structure |
| Annual NOI | Annual NOI | NOI |
| Lease Expiration | Lease Expiration | Lease End Date |
| Year Built | Year Built | Year Built |
| Submarket | Submarket | Submarket |
| Notes | Comments | Notes |

## Sales Comps — Sold Sheet (Table: "Comps")

All On Market columns, plus:

| Template Column | CoStar Field | Salesforce Field |
|---|---|---|
| Sale Price | Sale Price | Closed Price |
| Sale Date | Sale Date | Close Date |
| Buyer | Buyer | Buyer Name |
| Seller | Seller | Seller Name |
| Financing | Financing Type | Financing |

## Lease Comps (Table: "Comps", B7:Z60)

Canonical 26-column layout (A..Z) — the deployed dialysis "Export Lease Comps"
output. Comp rows are assembled by `detail-lease-comps-fix.js`
(`_udFetchLeaseCompCandidates`) from the dia/gov property + lease views and
ranked by haversine distance from the subject. Columns the data layer can't
fill render blank (no fabrication).

| Col | Template Column | Source (dia/gov view field) |
|---|---|---|
| A | # | running `=A+1` counter |
| B | TENANT | tenant (normalized) |
| C | OPERATOR | operator (normalized) |
| D | ADDRESS | properties.address |
| E | CITY | properties.city |
| F | ST | properties.state |
| G | LAND | land_acres / land_area / lot_sf |
| H | BUILT | properties.year_built |
| I | RENO | properties.year_renovated |
| J | RBA | building_sf / building_size / rba |
| K | SF LEASED | leases.leased_area (fallback RBA) |
| L | OCCUPANCY | leased_area ÷ RBA |
| M | RENT/SF | leases.rent_psf |
| N | CURRENT RENT | leases.annual_rent |
| O | COMM | leases.lease_start |
| P | EXP | leases.lease_expiration |
| Q | INITIAL TERM | leases.initial_term_years (else COMM→EXP) |
| R | TERM REM | leases.term_remaining_years (else now→EXP) |
| S | LEASE TYPE | leases.lease_type *(canonical-merge; blank if absent)* |
| T | EXPENSES | leases.expense_structure |
| U | BUMPS | lease_escalations (pct/interval) |
| V | OPTIONS | leases.renewal_options *(canonical-merge; blank if absent)* |
| W | USER/OWNER | owner_occupied → Yes/No |
| X | DISTANCE TO SUBJECT | haversine miles from subject |
| Y | PATIENTS | latest_patient_count / total_patients (dia) |
| Z | NOTES | leases.notes / comments *(canonical-merge; blank if absent)* |

AVERAGE row (60) carries `SUBTOTAL`/`AVERAGE` over the numeric columns only;
the text columns LEASE TYPE (S), EXPENSES (T), BUMPS (U), OPTIONS (V),
USER/OWNER (W), NOTES (Z) have no average.
