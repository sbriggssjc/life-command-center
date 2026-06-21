# UW#3 — Cap-rate derivation backfill (2026-06-21)

Audit item #2 (`UNDERWRITING_DATA_QUALITY_AUDIT_2026-06-20.md`): *"backfill cap
where price+rent(dia)/price+noi(gov) exist but cap is null — size the lever
first."* Grounding-first, the lever is small and the honest result is asymmetric.

## The receipts (size the lever first)

| | dia (`zqzrriwuavgrquhisnoa`) | gov (`scknotsqkcheojiaewwh`) |
|---|---|---|
| sales total | 4,724 | 14,789 |
| no effective cap, priced | 692 (non-excluded) | 1,181 (non-excluded) |
| naive audit lever (rent_at_sale / noi present) | **0** | **4** |
| resolvable via the blessed compute fn | 8 | 30 |
| …at **high/medium confidence** (the quality gate) | **8** | **0** |

- **dia rent_at_sale is a spent lever** — 0 of the no-cap sales carry it
  (wherever it exists, the cap is already derived; `calculated_cap_rate` is
  already populated on 2,887 rows).
- **The authoritative derivation is the compute function** (`dia_compute_cap_rate`
  / `gov_compute_cap_rate`) — "cap is calculated, not stored." It's already wired
  into the snapshot trigger on every INSERT/UPDATE. The unfilled rows are
  historical sales or sales whose lease/income arrived *after* the sale insert.
- **The quality gate is decisive.** dia resolves 8 rows, all high/medium
  confidence (4 `anchor_om_confirmed` @ 5.3–11.8%, 3 medium in-band, 1 medium
  outlier the framework's suspect-flagger marks). gov resolves 30 — but **all 30
  are low-confidence bottom-tier** (`property_noi_unknown` / `historical_lease` /
  `property_gross_rent`), **11/30 wildly out of band (1.75%–29.87%)**. Those gov
  sales lack a cap *precisely because* they lack underwritable income; writing
  low-confidence caps would **degrade** comps (the opposite of the audit's goal).

## What shipped

A gated, value-ranked backfill **per domain** that **re-fires the existing
blessed snapshot trigger** on the resolvable rows (a column-scoped touch-update,
so the full of-record / round / source / suspect pipeline runs exactly as on a
real insert). No new derivation logic — reuse, never fork.

- `dia_backfill_missing_sale_caps(p_dry_run default true, p_limit, p_run_tag)` —
  fills `calculated_cap_rate` (fill-blanks only). **Applied live: 8 filled.**
- `gov_backfill_missing_sale_caps(…)` — fills `sold_cap_rate`. **Applied live:
  0 filled** (the honest verdict). The function ships gated so any future gov
  sale that arrives with real high/medium-confidence income is filled.
- **Quality gate (both):** only write when the derivation is **high/medium
  confidence** AND in the framework's bound. Matches the doctrine's "prefer
  income_confidence='high'."
- `cap_rate_backfill_log` (each domain) — an **audit** record of what the sweep
  derived. NOTE: the derived cap is a *function of the data* and **self-heals**
  (the snapshot trigger re-derives on any touch), so it is **not** an undo
  ledger. To suppress a derived cap, use the framework's own
  `exclude_from_market_metrics` opt-out.
- Gentle **weekly self-heal cron** on each DB (`<dom>-cap-rate-backfill-sweep`,
  Sun 09:00 UTC) — income often lands after the sale insert; the cron fills any
  future high/medium-confidence rows (bounded; gov no-ops until real income
  arrives). Migrations: `Dialysis/supabase/migrations/20260621_dia_uw3_cap_rate_backfill.sql`,
  `government-lease/sql/20260621_gov_uw3_cap_rate_backfill.sql`.

## Verification (live, 2026-06-21)

- dia: dry-run 692 scanned → 8 resolvable; real apply filled 8, all high/medium
  confidence, all in `[0.01,0.25]`; no curated cap clobbered (all 8 were
  effective-null before; the of-record trigger promoted 7 to `cap_rate_final`).
- gov: an initial **ungated** run filled 30; inspection found all 30
  low-confidence (11 out of band) → **reverted to 0 residue** (snapshot trigger
  disabled atomically; `sold_cap_rate` back to 5,313; log emptied; history rows
  removed). The gated function now resolves **0** — confirming the framework was
  right to leave them null.

## Boundaries

Fill-blanks only; reuse the blessed cap-of-record frameworks (no forking);
quality-gated (low-confidence never written); value-ranked; idempotent; ≤12
api/*.js (pure-DB round, no JS). dia/gov pipelines otherwise untouched. The audit
premise (price+noi/price+rent) was refuted by grounding — the trustworthy lever
is **dia 8 / gov 0**, surfaced honestly rather than padded with speculative caps.
