# Prompt 47 — Comps: resolve the SUBJECT from its property record + exclude it from the set

## Why (live acceptance test, 2026-08-05)
For "The Villages DaVita — 1050 Old Camp Rd," `get_property_context` resolves the subject fully at 0.96 confidence
(property_id 31964: 6,453 SF, 12 chairs, built 2022, lease commenced 2023-08-06 / 15-yr term → ~2038, 10%/5yr bumps,
cap 6.75%, operator DaVita). But `synthesize_comps`/`generate_comps` built the subject anchor from the request TEXT
only: subject SF/chairs/term/lease came back **"Not on file"** and cap defaulted to **6.00%** (should be 6.75%).
Consequences: (a) similarity scoring (prompt 41/44) can't weight size/chairs/term because the subject values are
blank; (b) the subject itself appeared as an on-market comp (`excluded_subject=0`) — 1050 Old Camp Rd would have
shipped to the appraiser as a comp.

## Task
1. **Populate the subject anchor from the resolved property record.** When the request names/【addresses】a subject
   that resolves to a property (same path `get_property_context` uses — domain identity, ~0.96), hydrate the anchor
   with that record's `building_size`, `total_chairs`, `year_built`, lease term remaining (from `lease_commencement`
   + term / `wavg_lease_expiration`), bumps, operator, and the **actual cap (6.75%)** — not a 6.00% default. Fall back
   to "Not on file" only when nothing resolves.
2. **Exclude the subject from the comp set.** With the subject resolved to `property_id`/entity, drop it from both
   sold and on-market (match on property_id/normalized address). `excluded_subject` must count it. The subject's own
   active listing must never appear as a comp.
3. Feed the hydrated subject into `scoreComp` so the 41/44 similarity weights (size, chairs, term-at-close, cap) work.

## Verify
- An appraisal pull for 1050 Old Camp Rd shows subject SF 6,453 / 12 chairs / term to ~2038 / cap 6.75% (not
  "Not on file", not 6.00%); `excluded_subject ≥ 1`; the subject listing is absent from On Market; comps rank by real
  similarity to the subject's size/term/cap.
