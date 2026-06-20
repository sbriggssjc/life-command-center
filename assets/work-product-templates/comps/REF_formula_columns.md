# Formula-Protected Column Registry

## Sales Comps Template

| Column | Formula | Do Not Touch |
|---|---|---|
| RENT/SF | Annual Rent ÷ RBA | ✗ |
| CAP RATE | Annual NOI ÷ Sale Price | ✗ |
| PRICE/SF | Sale Price ÷ RBA | ✗ |
| TERM | Lease Expiration − Lease Start (in years) | ✗ |
| DOM | Sale Date − List Date (in days) | ✗ |

## Lease Comps Template

| Column | Formula | Do Not Touch |
|---|---|---|
| RENT/SF | Annual Rent ÷ SF Leased | ✗ |
| TERM | Lease Expiration − Lease Commencement (in years) | ✗ |
| DOM | Execution Date − List Date (in days) | ✗ |
| EFFECTIVE RENT/SF | Net effective rent adjusted for TI and free rent | ✗ |

> Canonical-merge text columns **LEASE TYPE (S)**, **OPTIONS (V)**, **NOTES (Z)**
> are free text with no derived value — they are **not** formula-protected and
> may be populated/edited freely.

## Diagnostic: Blank Formula Columns

If a formula column is blank after population, the cause is almost always:
1. A date entered as text (not a true Excel date) — causes #VALUE! in TERM/DOM
2. A missing input value in the corresponding input column
3. The formula was accidentally deleted in a prior session

Do NOT fill formula columns manually. Diagnose and fix the input instead.
