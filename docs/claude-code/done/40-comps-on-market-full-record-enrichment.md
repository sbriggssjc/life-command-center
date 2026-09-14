# Prompt 40 — Comps ON-MARKET rows: enrich to the full property + lease record

## Why (audit F2, 2026-08-05)
On-market/available comps come from the thin listings path (`available_listings` → `v_dia_on_market`: tenant,
address, price, cap, date). They are not joined to the property + active lease, so LAND, BUILT, EXP, TERM,
EXPENSES, BUMPS, RENEWAL OPTIONS, CHAIRS, PATIENTS come back blank — the on-market sheet looks empty.

## Task
1. **Enrich the on-market pull to sold-parity depth.** Join `available_listings` → `properties` (land, year_built,
   RBA, total_chairs, total_patients) → current/active lease (expiration, expenses/lease type, bumps, renewal
   options, in-place NOI where known). Expose it as a view (e.g. `v_dia_on_market_full`) or extend the RPC's
   on-market branch so every on-market row carries the same columns a Sold row does.
2. **On-market NOI/cap basis.** Prefer actual in-place NOI when the lease record has it; otherwise carry the
   listing's implied NOI = asking_price × asking_cap (exact) so INITIAL/LAST CAP reproduce the asking cap. Flag
   implied NOI as estimated. Document this once so every surface does it identically.
3. **Apply to gov analogously** (its on-market/available path has the same thinness risk).

## Verify
- An appraisal pull's on-market rows show LAND, BUILT, EXP, TERM, EXPENSES, BUMPS, RENEWAL, CHAIRS, PATIENTS
  populated wherever the record has them — not blank.
- Cap columns reconcile to the asking cap; implied-NOI rows are flagged estimated; no fabricated values ("—"
  where truly not on file).
