# Claude Code prompt — Mis-ingestion sweep: non-representative rows polluting the dia (and gov) sales/property book

> Surfaced during R76 Layer G: the dia 2022/23 "spike" was seven $30M+ sales that
> are mostly NOT single-asset dialysis NNN — they're whole multi-tenant centers
> (Victory Plaza, Orlando Airport Business Center, a 98k-sf "Osceola Village"
> shopping center, Commons at Royal Palm), a non-dialysis "Mens Medical Institute,"
> and an unconfirmed $50M portfolio. Price/sf on the sized ones is $3,400-5,200
> (dialysis NNN is ~$400-1,000). These are MIS-INGESTED: wrong assets sitting in the
> dialysis book, distorting every price/volume/cap metric. If seven surfaced at the
> $30M+ tail, there are smaller ones too. Scott wants a full sweep.
>
> EXPLORATION — receipts-first audit + classification + a gated remediation plan. NO
> writes until the plan is independently verified at the gate. Companion to the
> listing-lifecycle integrity exploration (that one = duplicate/stale LISTING rows;
> this one = wrong ASSETS/SALES in the book). Both verticals: dia
> zqzrriwuavgrquhisnoa, gov scknotsqkcheojiaewwh.

## The problem class
Rows that are not single-asset, single-tenant dialysis (dia) / single gov-leased
asset (gov), but are counted as if they were:
- **Whole multi-tenant centers** where dialysis/gov is just one tenant (the sale price
  is the whole center, not the unit).
- **Non-dialysis / non-gov properties** mis-typed into the book entirely.
- **Portfolio sales** recorded as one single-asset transaction.

## Phase 1 — AUDIT (read-only, both verticals). Receipts per signal; no thresholds as
auto-rules yet — surface candidates for classification.

1. **Price/SF outliers** — sales where `sold_price / building_size` is implausible for
   single-asset NNN (e.g. dia > ~$1,500/sf). Flag; report the distribution so the band
   is data-driven, not arbitrary.
2. **Building-size outliers** — properties tagged dialysis/gov with `building_size` far
   above single-asset norms (e.g. dia > ~25k sf — a single clinic is ~5-12k). The 98k-sf
   "Osceola Village" is the tell.
3. **Name signals** — `building_name` / address containing multi-tenant retail/MOB
   markers: Plaza, Village, Commons, Mall, Shopping, Center, Business Center, Marketplace,
   Galleria, Pavilion, etc. Surface for review (some legit clinics carry these — confirm,
   don't auto-exclude).
4. **Tenant/operator mismatch** — sales/properties in the dia book whose tenant/operator
   is NOT a dialysis operator (DaVita, Fresenius, US Renal, American Renal, Satellite,
   independent kidney centers). "Mens Medical Institute" is the tell. For gov: tenant not
   a government agency (the federal personal-property / USA-owner bleed-through the
   sidebar guard already knows about).
5. **Portfolio indicators** — sale linked to multiple properties, "Portfolio of N" in
   name/notes, or one sale_id spanning multiple parcels.
6. **Price outliers without size** — high-$ sales with NULL building_size/tenant (can't
   confirm single-asset) — the $50M Rockleigh case.

## Phase 2 — CLASSIFY each candidate (the judgment, with evidence)
- **Genuine single-asset** (large but real, dialysis operator, sane $/sf) → KEEP, note.
- **Whole-center / multi-tenant** (dialysis is one tenant) → exclude from market metrics,
  reason `whole_center_multitenant`.
- **Non-dialysis / non-gov** (wrong property type) → flag for removal/re-type out of the
  book, reason `misclassified_wrong_type`.
- **Portfolio** → exclude (or split), reason `portfolio_sale`.
- **Unconfirmable** (no size/tenant) → exclude pending evidence, reason `unconfirmed`.

## Phase 3 — ROOT-CAUSE + remediation plan (dry-run JSON → gate, NO writes yet)
- Which ingestion path brought each class in (7d master import, CoStar sidebar capture,
  OM intake, legacy CSV) — so the guard goes where the leak is.
- Remediation: `exclude_from_market_metrics=true` + reason tag for non-representative;
  re-type/remove the wrong-type rows (provenance-tagged, never hard-deleted); document
  genuine large deals.
- **Ingest guard**: propose a check at the writer (and/or a data-quality view like the
  existing `v_data_quality_issues`) that flags whole-center/non-dialysis rows BEFORE they
  hit market metrics, so this doesn't re-accumulate.
- Before/after on the affected charts (avg deal size, volume, price/sf, cap) at the
  spike quarters → Scott's independent verification before any write.

## Guardrails
- Receipts-first; NO writes until the Phase-3 plan is gated. Idempotent. Provenance-tag
  everything; never hard-delete — exclude/re-type and keep the row.
- Don't auto-exclude on a single signal (a real clinic can be in a "Plaza" or be large) —
  classification needs corroborating evidence (operator + $/sf + size + name together).
- Start with dia (the concrete case); run the same signals on gov and report whether the
  analogous bleed-through exists there.
- Layer G's seven $30M+ deals are the seed set — this sweep extends below the tail.
