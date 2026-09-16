# GOVDEED-478 — disposition: the conflict view ignores placeholder deeds, and the grantee they planted is cleared

**Filed:** 2026-09-16 (Cowork). Decision by Scott 2026-09-16: **exclude placeholder deeds in the view +
clear the grantee** (ledgered, reversible). **Owner:** 👤 **government-lease**. ⛔ Nothing applied
from `life-command-center`. Sequencing: this can land independently of GOVDEED5; if GOVDEED5 lands
first, apply the same rule to `latest_transfer_*` instead of `latest_deed_*`.

## What is true today (gov, measured 2026-09-16 after GOVDEED4)

| `v_owner_source_conflict` (899 rows) | count |
|---|---:|
| `latest_deed_date IS NULL` | **478** |
| … all 478: the grantee comes from a bridged deed row with **no `recording_date`, no `recording_date_approx`, no `document_number`** | 478 |
| dated, and the date is a real bridged deed | 9 |
| dated, and the date is a `sales_transactions.sale_date` | 405 |
| other | 7 |

Fully undated, no-document-number deed rows in `deed_records`: **4,995**. These are the GOVDEED1/2
recall rows: a grantee the model was never shown, no instrument, no date (GOVDEED2 stopped the
producer; GOVDEED4 removed the guessed dates from the ones that had them). 84% of the 478 carry a
grantee byte-identical to the property's own `recorded_owners.name` — the prompt's context echoed
back. They are assertions that were never evidence; the standing rule is "Not on file" over a
plausible value.

## What to build

1. **Mark, don't delete.** `deed_records.evidence_status text` (or reuse an existing status column
   if one exists — say which): set `'rejected_placeholder'` on every row where `recording_date IS
   NULL AND recording_date_approx IS NULL AND document_number IS NULL`, with `evidence_status_reason`
   = `'GOVDEED-478: no date, no instrument, grantee not from a fetched record'`. Snapshot the ids
   to `_gov_govdeed478_rejected_deeds_20260916`. Expected ≈4,995.
2. **The view stops reading them.** `v_owner_source_conflict` (and any sibling that joins deeds —
   list them) excludes `evidence_status = 'rejected_placeholder'` rows, and `propagate_deed_to_property`
   / `sync_properties_from_sources.py` never promote one.
3. **Clear the planted grantee.** Where `properties.latest_deed_grantee` traces **solely** to a
   rejected row (no dated deed, no `sales_transactions` buyer, naming that grantee), set
   `latest_deed_grantee = NULL` (and `latest_sale_grantor` / `latest_sale_price` if they came from the
   same row — check `COALESCE` provenance, do not assume). Snapshot prior values to
   `_gov_govdeed478_cleared_properties_20260916` with an `outcome` column, same shape as GOVDEED4's.
   ⚠️ Do **not** clear a grantee that a sale also names — that is GOVDEED5's territory.
4. **Report the conflict count after.** Expected order of magnitude: 899 → ~420 (the 405 sale-backed
   + 9 deed-backed + whatever of the 7 survive). Do not predict it; measure it.
5. Tests: a placeholder row is invisible to the view and never propagates; a dated row with a
   document number still does (positive control); the clear touches only sole-source properties.

## Prohibitions

- ⛔ No delete of deed rows — GOVDEED3 still wants to read the accept-gate population.
- ⛔ No grantee or date is invented or backfilled from anywhere.
- ⛔ The 405 sale-backed conflicts are **real review candidates**; this round must not hide them.
- ⛔ dia untouched; nothing applied from LCC.

## Reporting

Counts for each step, the two snapshot tables' row counts, the list of views/functions changed,
and the reversal statement for each write. If any step was skipped, say so.
