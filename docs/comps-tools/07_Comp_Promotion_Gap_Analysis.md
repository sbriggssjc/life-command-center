# Comp Promotion — Gap Analysis & Fix Plan (validated from live code + data)

**Date:** July 21, 2026
**Basis:** the deployed `sf-promotion-worker` edge function (Dialysis_DB project, v11) read in full, plus live row counts.
**Bottom line:** the promotion path for comps exists but is effectively inert and points at a barely-used table. For v1, `query_comps` reads `sf_comp_staging` directly (correct — that's the only place SF comps live). Fixing promotion is a separate, well-scoped cleanup captured here.

---

## 1. How comp promotion actually works today (from the code)

`promoteComp()` in `sf-promotion-worker`:
- Selects `sf_comp_staging WHERE process_status = 'pending'`.
- Resolves a `property_id` (prelinked → SF-property chain → address match).
- For each mapped field, calls `lcc_merge_field(source='salesforce', confidence=0.8)` on the OPS project, with:
  - `p_target_database` = `dia_db` / `gov_db`
  - `p_target_table` = **`comparable_sales`** (dia) or **`comp_provenance`** (gov)
  - `p_record_pk` = **the property_id** (not a sale id)
- **Domain write happens only for dialysis** (`supportsCompareSales = vertical==='dia'`): a blind `POST` insert into `comparable_sales`. Government does a provenance record only — no domain comp row is ever written.
- Marks the staging row `process_status='reported'`.

Current `COMP_FIELD_MAP` (staging → comp_* columns):
`street→comp_address, city→comp_city, state→comp_state, property_type→comp_property_type, tenant→comp_tenant, sold_price→comp_sale_price, cap_rate→comp_cap_rate, annual_rent→comp_noi, price_sf→comp_price_per_sf, sold_date→comp_sale_date, building_sf→comp_building_size`.

---

## 2. The validated gaps

| # | Gap | Evidence | Impact |
|---|---|---|---|
| **G1** | `promoteComp` reads `process_status='pending'`, but ready comps are `'linked'`. The **property** promoter reads `'linked'`; the comp promoter reads `'pending'` — inconsistent. | gov staging comps: 254 `linked`, 108 `reported`, 108 `review`, **0 `pending`**. | The comp promoter processes **nothing** today. This is the direct cause of the ~84% unpromoted. |
| **G2** | Government has **no domain comp table** — gov comps only hit `comp_provenance` (audit ledger), never a queryable table. | gov public schema has no `comparable_sales`; `promoteComp` skips the domain insert for non-dia. | SF gov comps are queryable **only** from `sf_comp_staging`. (So `query_comps` reading staging is not a shortcut — it's the only option for gov.) |
| **G3** | Dia domain insert is a **blind `POST`** into `comparable_sales`, no upsert/natural key. | code: `dbFetch("dia","POST","comparable_sales",[insertRow])`. | Every enforced re-run would **duplicate** rows. `comparable_sales` currently has 3 rows, 0 from SF — never run enforced. |
| **G4** | Field-map data issues: `cap_rate` written **as percent** (no ÷100); `annual_rent→comp_noi` conflates gross rent with NOI; `sold_price` written even when **0** (confidential). | staging `cap_rate` avg 7.67 (percent); staging has `annual_rent`, no `noi` column; 10/63 sold rows priced 0. | Wrong cap units and a mislabeled NOI would flow into any comp sheet built off `comparable_sales`. |
| **G5** | Comp keyed by `property_id` only. | `p_record_pk = property_id`. | Multiple comps on one property (portfolio, re-sales) collide conceptually; no `source_sf_id` stored for dedup. |

---

## 3. Recommendation

**Path A — v1 (already in place): serve SF comps from `sf_comp_staging` via `query_comps`.**
No promotion dependency. This is correct precisely because (G2) gov has no comp domain table and (G3/G1) the dia path is inert. The tool's staging read is the durable answer for gov and the immediate answer for dia.

**Path B — durable fix to `sf-promotion-worker` (do when you want SF comps in a deduped domain layer).** Six concrete changes:

1. **Fix the status filter (G1).** `promoteComp` select → `process_status=in.(pending,linked)`. One-line change; immediately makes the 254 linked gov + the dia linked comps eligible.
2. **Give government a comp home (G2).** Either create `comparable_sales` on the gov project (mirror dia’s columns) and set `supportsCompareSales` true for gov, **or** decide gov comps stay staging-served and document that `query_comps` is the gov comp surface. *Recommendation: the latter for now — one less table to maintain — and revisit if you want gov comps deduped against CoStar sales.*
3. **Make the insert idempotent (G3/G5).** Replace the blind `POST` with an upsert on a natural key — add a unique index on `comparable_sales(property_id, comp_sale_date, comp_source_sf_id)` and POST with `Prefer: resolution=merge-duplicates`. Store `source_sf_id = sf_comp_id` on every row (new column) so the dedup in `query_comps`/`synthesize_comps` becomes deterministic.
4. **Fix the field map (G4).** Normalize cap to decimal (`cap_rate/100`), map `annual_rent→comp_annual_rent` (not `comp_noi`) and pull real NOI from `raw_row->>'NOI__c'` into `comp_noi`, and **skip `sold_price` when 0** (set `price_withheld` instead).
5. **Seed `field_source_priority` for the new fields.** Follow the existing convention exactly (the 11 salesforce rows already on `comparable_sales`/`comp_provenance` use `priority=20, min_confidence=0, enforce_mode='record_only'`). Add rows for `comp_annual_rent`, keep `record_only` until reviewed, then flip trusted fields to `strict` (per the plan's rollout dial). Salesforce at priority 20 already outranks the CoStar/Crexi sidebars (60–75) and sits below manual (1) — a sensible band.
6. **Run report-only first**, inspect `v_field_provenance_current` / the review-queue views, then enforce.

---

## 4. Corrected `COMP_FIELD_MAP` (drop-in for the worker)

```ts
// staging column -> { col: domain column, xform?: value transform }
const COMP_FIELD_MAP = {
  street:        { col: "comp_address" },
  city:          { col: "comp_city" },
  state:         { col: "comp_state" },
  property_type: { col: "comp_property_type" },
  primary_use:   { col: "comp_subtype" },
  tenant:        { col: "comp_tenant" },
  sold_price:    { col: "comp_sale_price", xform: v => (Number(v) > 0 ? v : null) },  // skip $0
  cap_rate:      { col: "comp_cap_rate",   xform: v => (v != null ? Number(v) / 100 : null) }, // %→decimal
  price_sf:      { col: "comp_price_per_sf" },
  annual_rent:   { col: "comp_annual_rent" },      // was mis-mapped to comp_noi
  sold_date:     { col: "comp_sale_date" },
  building_sf:   { col: "comp_building_size" },
  // pull true NOI from the raw record, not annual_rent:
  // "raw_row.NOI__c" -> comp_noi   (add a raw_row select to the staging query)
};
// also persist for dedup:  insertRow.comp_source_sf_id = row.sf_comp_id;
```

---

## 5. Interaction with `query_comps` (already handled)

The tool already: reads `sf_comp_staging` for SF comps (so it doesn't wait on promotion), normalizes cap ÷100, flags `price_withheld`, filters the 192 Account rows, and dedups on `source_sf_id` then fuzzy address+date. **No change to the tool is needed for v1.** When Path B lands and `comparable_sales` (dia) fills with clean SF comps carrying `comp_source_sf_id`, add it as an optional source in the dia RPC — but `sales_transactions` remains the primary deduped sale universe.

---

## 6. Confirmed provenance call convention (for any promotion work)

```
lcc_merge_field(
  p_workspace_id  = 'a0000000-0000-0000-0000-000000000001',
  p_target_database = 'dia_db' | 'gov_db' | 'lcc_opps',
  p_target_table    = 'comparable_sales' | 'comp_provenance' | 'properties' | ...,
  p_record_pk       = <property_id as text>,
  p_field_name      = <domain column>,
  p_value           = <jsonb>,
  p_source          = 'salesforce',
  p_source_run_id   = <run id>,
  p_confidence      = 0.8,
  p_recorded_by     = null)
```
Called via the **OPS** project (`/rest/v1/rpc/lcc_merge_field`). Returns `{ decision: write|skip|conflict, enforce_mode }`; the caller patches/inserts the domain row only when `decision='write'` and `enforce_mode='strict'`.
