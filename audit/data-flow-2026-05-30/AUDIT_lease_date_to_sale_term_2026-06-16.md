# Audit — do corrected lease dates propagate to sale-level term fields? (gov, 2026-06-16)

**Question (Scott):** the lease-term analogue of the rent→cap-rate audit — as lease
commencement/expiration/term are ingested or corrected later, do the sale-level derived term
fields (firm term at sale, term remaining at sale, the sale's copied lease dates) recompute,
or freeze at sale ingest?

## Verdict: mostly point-in-time-correct + curated; ONE real freeze — ~99 corrected leases
Three things going on, two intentional and one a genuine (small) gap:

1. **Firm term is deliberately curated + locked.** All 2,598 sales with a firm term carry
   `firm_term_source='master_curated'` AND `firm_term_locked=true` — the master sheet is the
   authoritative source and the value is locked against auto-recompute. No lease trigger
   recomputes it. This is intentional curation, not a freeze bug.
2. **Renewals are correctly frozen (point-in-time).** Of 1,231 live sales carrying a lease
   expiration, **437 differ from the property's current active lease** — but **310 of those
   are renewals** (the current active lease has a DIFFERENT `lease_number`; the lease rolled
   after the sale). The sale correctly reflects the lease that existed AT the sale, not a
   later renewal. Correct to freeze — same discipline as a sale's point-in-time cap rate.
3. **THE GAP — 99 same-lease corrections are stale.** 99 sales have the **same `lease_number`**
   as the current active lease but a **different expiration** — i.e. that lease's
   commencement/expiration was learned/corrected (CoStar/OM/curation) AFTER the sale was
   ingested, and the sale's copied `lease_expiration` (and the derived
   `firm_term_expiration_at_sale` / `firm_term_years_at_sale` / term-remaining-at-sale) were
   never updated. These are genuinely stale: the sale's as-of-sale term fields are computed
   from outdated dates for the very same lease.

## The discipline (mirror the cap-rate audit)
A sale's term fields are **as-of-sale point-in-time** — the AS-OF date stays fixed, but they
should use the **best-known dates of THAT lease** (same `lease_number`). So:
- **Propagate** corrected dates for the **same lease** → recompute the sale's at-sale term
  fields as-of the sale date (the 99).
- **Do NOT propagate** when the current lease is a renewal/replacement (different
  `lease_number`) → the sale stays frozen (the 310). This is the point-in-time guard.
- **Respect `firm_term_locked`** — a manual lock on the curated firm-term value is honored;
  the propagation updates the copied lease dates + the derived *at-sale* fields, but never
  overrides a locked manual firm-term (or updates only the non-locked derived fields).

## Fix → CLAUDE CODE PROMPT R45
When a lease's commencement/expiration/term is corrected (same `lease_number`), recompute the
matching sale rows' copied lease dates + as-of-sale term fields — bounded recompute pass
(extend the R42-style change-detection to lease-DATE changes, not just rent), same-lease-only
(renewals excluded), lock-respecting, reversible. One-time backfill for the current ~99 gov
stale rows. Check the dia parallel (dia sales term fields, same same-lease-vs-renewal split).

## Net
The lease-date→sale-term flow is largely sound (curated/locked firm term + correct
point-in-time freezing of renewals). The single real gap is **~99 gov sales whose same-lease
dates were corrected after ingest and never propagated** — the lease-date sibling of the
cap-rate freeze, fixed the same way (propagate same-lease corrections, freeze renewals,
respect locks).
