# ID0 — Identity & value-domain probe across Dialysis_DB and government (2026-09-11, Cowork, read-only)

**Why:** Scott, after the dialysis operator split (ID1): *"ensure there's protection and cleaning code in place so we
aren't operating a database with divergent naming and connections and structures that prevent it from operating
intelligently… one intelligent and reconciled source of truth for all properties."* This probe checks whether the
operator defect is isolated. **It is not. The same class shows up across both databases.**

**Method (reusable, and the seed of the standing detector):** for every text column in the core tables whose name
looks like an identity or grouping key (operator, tenant, owner, broker, agency, guarantor, city, county, type,
status, source…), compare `count(distinct col)` with `count(distinct norm(col))`, where `norm` = lower-case,
strip punctuation, strip a trailing `inc|llc|lp|ltd|corp|corporation|co|company`. **Every collapsed value is a
spelling split of one thing.** This is a lower bound: it can't see abbreviations (`SSA` vs `Social Security
Administration`) or aliases (`Fresenius` vs `Fresenius Medical Care`).

```sql
-- per DB; see STATUS 2026-09-11 for the exact query (query_to_xml over information_schema.columns)
select count(distinct c) raw,
       count(distinct nullif(regexp_replace(regexp_replace(lower(c),'[^a-z0-9 ]','','g'),
             '\s+(inc|llc|lp|ltd|corp|corporation|co|company)\y','','g'),'')) norm
from t;
```
(Postgres ARE note: use `\y` for a word boundary. `\b` is backspace, and it silently matches nothing.)

## Findings — government (`scknotsqkcheojiaewwh`)

| Class | Column | Distinct raw → normalized | Notes |
|---|---|---|---|
| **Agency identity** | `properties.agency` | 1,286 → 1,249 (plus abbreviations the probe can't see) | SSA is split 4+ ways: `SSA` 723 · `Social Security Administration (SSA)` 430 · `GSA - Social Security Admin` 150 · `Social Security Administration` 75. VA is split 5+ ways: `US Department of Veteran Affairs` 1,216 · `…Veterans Affairs - 1` 289 · `VA` 212 · `VETERANS AFFAIRS` 128 · `U.S. Department of Veterans Affairs` 112. **`RICHMOND FIELD OFFICE (VA)` (74) is ambiguous: probably Virginia, not Veterans Affairs.** Also `agency_full_name` 1,044→995, `leases.tenant_agency(_full)`, `available_listings.tenant_agency`, `sales_transactions.agency`. |
| **Owner entities (rows = entities)** | `true_owners.name` | 16,195 → 14,917 (**1,278**) | Plus **81 groups sharing an identical `canonical_name`**. The canonical column detects the duplicates, but nothing merges them. |
| | `recorded_owners.name` / `canonical_name` | 16,964 → 15,723 (**1,241**) / **115 identical-canonical groups** | |
| | `ownership_history.new_owner` / `prior_owner` / `recorded_owner_name` | 1,122 / 518 / 543 collapsed | Free-text parties on the chain of title |
| **Value domains** | `properties.county` | 1,872 → 1,163 (**709**); **832 county/state pairs are split by case alone** (`Los Angeles` vs `LOS ANGELES`) | Any county-level rollup is chunked |
| | `properties.city` / `sales_transactions.city` / `contacts.city` | 266 / 602 / 400 collapsed | |
| **Property identity** | `properties` (address, city, state) | **69 duplicate groups** | |
| People | `contacts.name` / `brokers.name` / `sales_transactions.buyer/seller` | 271 / 6 / 153 / 274 | |

## Findings — dialysis (`zqzrriwuavgrquhisnoa`)

| Class | Column | Distinct raw → normalized | Notes |
|---|---|---|---|
| **Operator identity** | `properties.operator` (+ `operators` registry) | see **ID1** | Free text with no FK; duplicated registry; conflicting canonical names |
| **Guarantor legal entity** (credit-critical) | `leases.guarantor` | 169 → 126 (**43**, 25%) | `DaVita, Inc.` 80 · `DaVita Inc.` 68 · `DaVita` 10 · `DaVita Incorporated` 8 · `DaVita Healthcare Partners, Inc.` 15 · `Total Renal Care, Inc.` 23 · `DVA Healthcare Renal Care, Inc.` 8; `Fresenius Medical Care Holdings, Inc.` 99 plus 4 spellings. ⚠️ **Distinct legal entities (Total Renal Care, DVA Healthcare) must be LINKED to the parent, not merged. The guarantor's legal identity is the credit fact.** |
| **Tenant** | `properties.tenant` / `leases.tenant` | 413 / 52 collapsed | |
| **Owner entities** | `recorded_owners.name` / `true_owners.name` | 390 / 208 collapsed | `true_owners.normalized_name` has no exact duplicates; the probe still collapses 124 |
| **Brokers** | `brokers.normalized_name` | **116 identical-normalized groups** (2,424 → 2,280 by probe) | Detected, never merged |
| **Value domains** | `medicare_clinics.city` | 3,724 → 2,958 (**766**, casing) | |
| | `properties.property_type` | 96 → 87 | 96 property types is itself a controlled-vocabulary gap |
| **Property identity** | `properties` (address, city, state) | 5 duplicate groups | |
| **Clinics** | `medicare_clinics.facility_name` | 493 collapsed | Partly legitimate (same brand name); needs a CCN-keyed check, not a name check |

## The defect classes (they extend `docs/architecture/data-coherence-invariants.md`)

1. **Identity (proposed I13):** a real-world entity (operator, agency, owner, broker, guarantor, tenant, property)
   has one canonical row. Grouping and joining happen on its id, never on a display string. Aliases live in an alias
   table with provenance. Legal entities link to parents; they are not merged into them.
2. **Controlled vocabularies (proposed I14):** low-cardinality attribute domains (county, city, state, property_type,
   status, source) take values from a reference list, enforced at write. Casing and punctuation variants are
   impossible by construction.
3. **Import completeness (proposed I15):** every bulk load reconciles its row count to the source. Round-number or
   tied counts across partitions (the CMS 2,450/2,450, loaded 17 s apart) fail the load.
4. **"Detected but never merged":** `canonical_name`/`normalized_name` columns already flag duplicates (gov 81 + 115
   groups, dia brokers 116), but nothing consumes the signal. That's invariant I6 (a corroboration or divergence
   signal needs a consumer) applied to identity.

**Next:** ID1 (dialysis operators, running) → **ID4** (standing detectors + a shared resolver framework + per-class
plans across all three DBs). Backlog §P0d.
