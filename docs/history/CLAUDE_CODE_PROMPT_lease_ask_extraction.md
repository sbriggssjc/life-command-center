# Claude Code Prompt — Lease-Detail & Ask-History Extraction Coverage (Dialysis_DB)

## Objective
Three comp fields are thin because the underlying facts aren't being *extracted*, not because the
propagation is broken:
- **Rent increases / BUMPS** — escalation present on only **~29%** of leases (3,679 / 12,787).
- **RENEWAL OPTIONS** — present on only **~21%** (2,659).
- **Asking-price history (INITIAL PRICE)** — on only **~43%** of listings (2,209 / 5,102).

The plumbing already works: `recompute_lease_escalation_current` + `trg_lease_escalation_rollup`
populate `annualized_escalation_percent_current` from raw escalation text; the comps view emits BUMPS
from it and RENEWAL OPTIONS from `renewal_option_text`; ask history now flows from `available_listings`.
The ceiling is **source capture**.

## Investigate & improve (per field)
1. **Escalations / bumps.** Where does `escalation_raw_text_current` come from — OM/lease OCR, CoStar
   sidebar, or SF? Measure: of leases with NO escalation, how many have an OM/lease document on file
   (`sf_files`/storage) that likely states it? Improve the extractor (OCR/parse of the rent schedule /
   "increases" clause) and re-run `recompute_lease_escalation_current`. Add a computed fallback: if a
   `rent_schedule` exists, derive the escalation from consecutive-period rents.
2. **Renewal options.** Same source audit. Parse "options / renewal" language from OMs/leases into
   `renewal_option_text` (e.g. "Two (2), 5-Year" → keep verbatim; the comp layer normalizes to `NxMYr`).
   Quantify how many missing-option leases have a source doc to mine.
3. **Asking-price history.** `available_listings.initial_price` is null on 57%. Determine whether the
   listing ingest (CoStar/LoopNet/OM) captures the *original* ask and price-change history, or only the
   current/last price. Extend the listing importer to retain initial ask + `price_change_history` so
   INITIAL PRICE, PRICE CHG, and BID-ASK populate on more sold comps.

## Deliverable
`docs/data-quality/lease_ask_extraction_plan.md`: for each of the three fields — current source, the
% of missing rows that HAVE a mineable source doc (the realistic ceiling), the extractor change, and
expected coverage lift. Implement the low-risk wins (e.g. the escalation-from-rent_schedule fallback)
in this pass; scope the OCR/importer work.

## Guardrails
- Fill-NULL-only; never overwrite a verified escalation/option/ask value.
- Keep raw text alongside the parsed value; log; dry-run first.
- The comp layer already normalizes display (BUMPS `%/Yr`, options `NxMYr`) — don't duplicate that here.
