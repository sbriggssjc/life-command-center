# Claude Code — R45: propagate corrected lease dates → sale-level term fields (same-lease only)

## Why (audit live 2026-06-16 — see AUDIT_lease_date_to_sale_term_2026-06-16.md)
The lease-term sibling of the rent→cap-rate freeze. Sale-level term fields are computed at
sale ingest from the lease known then; when that lease's commencement/expiration/term is later
CORRECTED, the sale's copy doesn't update. Grounded (gov):
- 437 of 1,231 live sales differ from the property's current active lease, but **310 are
  legitimate renewals** (different `lease_number` — correctly frozen point-in-time).
- **99 are true corrections** — SAME `lease_number`, expiration corrected after ingest, sale's
  `lease_expiration` / `firm_term_expiration_at_sale` / `firm_term_years_at_sale` /
  term-remaining-at-sale all stale.
- Firm term is `firm_term_source='master_curated'` + `firm_term_locked=true` on all 2,598 —
  intentional curation; honor it.

## The rule (mirror the cap-rate point-in-time discipline)
A sale's term fields are **as-of-sale** — keep the AS-OF date fixed, but use the **best-known
dates of THE SAME lease**:
- **Propagate** when the corrected lease shares the sale's `lease_number` → recompute the
  sale's copied lease dates + the derived AT-SALE term fields (`firm_term_expiration_at_sale`,
  `firm_term_years_at_sale`, total/term-remaining-at-sale) as-of `sale_date`.
- **Do NOT propagate** when the current lease is a renewal/replacement (different
  `lease_number`) — leave the sale frozen (the 310).
- **Respect `firm_term_locked`**: never override a locked manual firm-term value; update the
  copied lease dates + non-locked derived at-sale fields only. If a locked sale's underlying
  lease was corrected, surface it for curator review rather than silently overriding the lock.

## Unit 1 — recompute on lease-DATE change (forward)
Extend the existing R42-style nightly recompute change-detection: a property whose lease
commencement/expiration/term changed in the lookback → recompute the **same-lease** sale rows'
at-sale term fields (not rent/cap — that's R42; this is the term fields). Reuse the existing
firm-term/term-remaining compute helper (don't reimplement); bounded; idempotent; lock-aware.

## Unit 2 — one-time backfill of the ~99 stale gov sales (reversible)
Recompute the at-sale term fields for the 99 same-lease-corrected sales; snapshot prior values
to a reversible backup (mirror R37/R42); skip locked firm-terms (or surface them for review).
A before/after for Scott if any of these feed the published CM term-bucket analytics.

## Unit 3 — dia parallel
Check dia sales for the same same-lease-corrected staleness (dia lease dates drive its term
fields too) and apply the same same-lease-only propagation. Report the dia count; apply if > 0.

## Guards
Same-lease-only (renewals stay frozen — point-in-time integrity); lock-respecting; reuse the
authoritative term compute; reversible/snapshot; idempotent; ≤12 `api/*.js`; suite green;
apply live after a dry-run (same gate as R42/R37). The RAW/curated master values stay the
trusted firm-term source; this only refreshes the as-of-sale derived dates for corrected
same-leases.

## Bottom line
Closes the lease-date freeze: a corrected lease now refreshes the as-of-sale term fields of
the same-lease sales (~99 gov), while renewals stay correctly frozen and curated/locked firm
terms are honored — the lease-term analogue of R42's rent→cap-rate propagation.
