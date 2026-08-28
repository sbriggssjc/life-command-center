# Ownership & Sales Remediation — 2026-05-27 Session Status (C2)

Picks up after PR #946 (C4 owner-entity write-time dedup, merged + deployed). Focus this round: **C2 — sales transaction field completeness**.

## What this session learned (and reframed)

The plan originally framed C2 as a "sales writer refactor" — extend `upsertDomainSales` to capture fields the writer was supposedly dropping. **Investigation showed the writer is already wired up for every field the audit flagged**: `recorded_date`, `transaction_type`, `lender_name`, `guarantor`, `financing_type` all have code paths. The gap is **upstream**: the CoStar sidebar extractor rarely populates the corresponding `sale.*` / `metadata.*` source fields.

That redirected the work into three sub-paths:
- **A — server-side enrichment from related tables we already have**
- **B — Decision #5 PII persistence (forward-only)**
- **C — better heuristics inside `classifySaleType` to derive transaction_type from existing signals**

All three landed. The user-facing complaint ("missing many elements of a sales transaction") moves measurably on the avg-completeness score.

## What landed this session

### Part A — gov.sales_transactions enrichment from gov.loans

`gov.loans` carries `originator` on 84% of CMBS rows but **0 were linked to a sale**. Built a server-side join enrichment that matches on `property_id + origination_date within ±6 months of sale_date`, filtering out refinance loans (those are the seller's prior owner, not the buyer's acquisition lender).

**One-shot results:**
- `lender_name`: **0% → 12.5%** (425 sales gained the field)
- `financing_type`: **2.3% → 14.7%** (425 sales gained the field — value is `'cmbs'` or `'conventional'` based on `loans.is_cmbs`)
- `loans.sale_id` back-link: **0 → 394** (41% of `gov.loans` now linked to their corresponding sale)

**Continuous coverage:**
- `public.sales_enrich_from_loans()` function (idempotent)
- `lcc-gov-sales-enrich-from-loans-tick` pg_cron, hourly at `:20`

### Part B — Decision #5 PII persistence to contacts (forward-only)

Schema extension on both domains so future CoStar Sale Contacts captures with buyer/seller/broker phone/email/address can be persisted:

| Table | Added |
|---|---|
| `dia.contacts` | `sale_id integer` (FK), `sale_role text`, 2 indexes |
| `gov.contacts` | `sale_id uuid` (FK), `sale_role text`, 2 indexes |

The `sale_id` data type difference (integer on dia, uuid on gov) is forced — `dia.sales_transactions.sale_id` is integer; `gov.sales_transactions.sale_id` is uuid.

New JS helper `persistSaleContacts(domain, saleId, propertyId, metadata, provCollect)` in `api/_handlers/sidebar-pipeline.js`:
- Iterates `metadata.contacts` looking for `role IN ('buyer','seller','listing_broker','buyer_broker')`
- **Only writes when at least one PII field (phone/email/address/website) is present beyond the name** — bare names are already captured on `sales_transactions.{buyer,seller}` and add no info to contacts
- Skips junk names via `isJunkContactName`
- Idempotent: looks up by `(sale_id, sale_role, name)` and PATCHes existing rows; INSERTs only when no match
- Maps sidebar roles to `sale_role`: `buyer→buyer`, `seller→seller`, `listing_broker→broker_listing`, `buyer_broker→broker_buyer`
- Domain-aware column names (`contact_name/contact_email/contact_phone` on dia vs `name/email/phone` on gov)
- Tagged `data_source='costar_sale_contacts'`, provenance recorded

Wired into `upsertDomainSales` after each successful PATCH/INSERT in the per-sale loop. Forward-only — no retroactive backfill because legacy buyer/seller captures landed without PII attached.

### Part C — classifySaleType signal-based heuristics (dia)

`classifySaleType` in `sidebar-pipeline.js` was only consulting `sale.sale_type || sale.transaction_type` — fields the extractor populates ~8% of the time. Extended to consult the broader signal set:

- `sale.deed_type` (e.g. "Trustee Deed" → Foreclosure, "Warranty Deed" + price>$50K → Investment)
- `sale.sale_notes_raw` text (1031/exchange, portfolio, BTS, nominal, related party)
- `buyer === seller` name equality → Nominal Transfer
- Default fallback: warranty/grant deed + price > $50K → Investment

**One-shot SQL backfill on existing rows:**
- 199 dia sales classified from `transaction_type IS NULL`
- Distribution: Investment 73 / Portfolio 47 / Nominal Transfer 37 / 1031 Exchange 19 / Land Sale 16 / Build-to-Suit 6 / Foreclosure 1

Dia `transaction_type` coverage: **8.5% → 14.6%** (median completeness score moved from 75 → 80).

## Completeness score impact (v_sales_completeness_summary)

| Domain | Avg score before C2 | After C2 | Median before | Median after |
|---|---:|---:|---:|---:|
| dia | 74.0 | **74.3** | 75 | **80** |
| gov | 72.9 | **73.8** | 75 | 75 |

Dia's median jump (75 → 80) reflects the 199-row transaction_type backfill landing on rows that were one or two fields short of the 80-tier. Gov's avg-score lift (+0.9 pts) reflects 425 rows gaining 2 fields each.

## Audit-log inventory (LCC Opps)

LCC Opps SQL endpoint had recovered by mid-session, allowing the deferred backfills for both **C4 (2026-05-24)** and **C2 (2026-05-27)** to land in `audit_run_log`. Both deferred files (`scripts/audit/deferred/2026-05-27_C4_owner_dedup_backfill.sql` and `2026-05-27_C2_sales_completeness_backfill.sql`) remain in the repo as the canonical record of the run.

Current `audit_run_log` inventory:

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 15 | C4_dia_recorded_owners_2026_05_24_001 | dia | 245 |
| 16 | C4_dia_true_owners_2026_05_24_001 | dia | 536 |
| 17 | C4_gov_recorded_owners_2026_05_24_001 | gov | 0 |
| 18 | C4_gov_true_owners_2026_05_24_001 | gov | 10,738 |
| 22 | C2b_contacts_pii_persistence_2026_05_27_001 | all | 0 (schema-only) |
| 23 | C2a_gov_sales_enrich_from_loans_2026_05_27_001 | gov | 1,244 |
| 24 | C2c_dia_classify_sale_type_2026_05_27_001 | dia | 199 |

## Cron workers active after this round (13 total, ↑1)

Existing 12 from prior rounds plus new:
- `lcc-gov-sales-enrich-from-loans-tick` (hourly :20) — keeps lender_name + financing_type + loans.sale_id linkage current as new captures land

## Migrations applied this round

| Project | Migration | Purpose |
|---|---|---|
| gov | `gov_sales_enrich_from_loans_c2a` + `_v2` (date-arithmetic fix) | New function `sales_enrich_from_loans()` |
| gov | `gov_sales_enrich_from_loans_cron_c2a` | Hourly cron for continuous coverage |
| dia | `dia_contacts_add_sale_link_c2b_v2` | `contacts.sale_id integer` + `sale_role` + indexes |
| gov | `gov_contacts_add_sale_link_c2b` | `contacts.sale_id uuid` + `sale_role` + indexes |

JS changes in `api/_handlers/sidebar-pipeline.js`:
- Extended `classifySaleType` to consult deed_type / notes / buyer-seller-equality / sold_price
- New helper `persistSaleContacts()` for Decision #5 PII writes
- Wired `persistSaleContacts()` into the per-sale loop in `upsertDomainSales`

## Plan status

- ✅ **DONE** (20, ↑1): F1-F4, C1, C3 (N/A), **C2 (this round)**, C4, C6, B1, B2, B4, B5, B7, A1, A2, A3, A4 (partial), A5, A6 (A6b only)
- ⏳ **PARTIAL** (1): A6 — A6a still TODO
- ⬜ **TODO** (11, ↓1): C5, C7, C8, C9, B3, B6, B8, A4b, A7, A8, A9

## Symptom tracking

| User complaint | Status |
|---|---|
| Duplicates for the same sale on the same property | ✅ FIXED + can't recur |
| Missing many elements of a sales transaction | ⏳ **MEANINGFUL PROGRESS** — gov lender_name 0→12.5%, gov financing_type 2→14.7%, dia transaction_type 8.5→14.6%, dia median score 75→80, contacts schema ready for PII (forward-only) |
| Ownership history not in unison | ⏳ Significant progress (write-time enforcement live) |

## Future C2 work (not in this round's scope)

The Chrome-sidebar extractor remains the bottleneck for several fields the audit flagged. Pursuing them requires changes in the sidebar repo (separate from life-command-center):

- **dia `recorded_date`** (94% missing): need extractor to capture Public Record tab's "Recordation Date" field. Only 43 of 3,282 missing rows could be retroactively recovered from `deed_records` (coverage too thin).
- **gov `guarantor`** (100% missing): need extractor to capture CMBS Loan tab's "Sponsor" / "Guarantor" field. No internal source.
- **buyer/seller PII** (now schema-ready): need extractor to scrape CoStar's "Sale Contacts" tab and populate `metadata.contacts[].phone/email/address`. The JS persistence path is wired up — coverage starts climbing as soon as the extractor sends the data.

## Recommended priorities for next session

1. **A7 owner→Salesforce link backfill** — owners are now canonical (C4) and the gov sales now have proper lender attribution (C2A). Time to lift the SF link coverage from 1.5–20% baseline.
2. **A6a ownership_history chronological closure** — 1,111 dia rows; gates C5 EXCLUDE constraint.
3. **B8 Data Health dashboard tile** — surface 30-day completeness trend in ops.js.
4. **C8 RCM/LoopNet auth fix** — small Power Automate header tweak.
