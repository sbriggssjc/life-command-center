# ID3a — Government agency identity: wiring the registry that already existed (2026-09-12)

**Project:** government (`scknotsqkcheojiaewwh`) · **Migrations:**
`supabase/migrations/government/20261012120000_gov_id3a_agency_identity_wiring.sql` +
`…_gov_id3a_frpp_cabinet_aliases` (applied live) · **Guard:**
`test/id3a-gov-agency-identity.test.mjs` (12 tests, **9/9 mutations RED**) ·
**Batch tag (reversible):** `id3a_20260912`

Scott's #1 identity class. The brief framed it correctly as a **wiring** job, not a cleanup
invention — and the one premise that had to be corrected is that the existing normalizer is not
safe to wire from.

| | before | after |
|---|---:|---:|
| `properties.agency_id` | **0** / 20,509 | **7,369** / 20,509 (35.9%) |
| `property_agencies.agency_id` | **160** / 132,243 (0.12%) | **119,361** / 132,243 (**90.3%**) |
| review lane | — | 1,107 + 386 strings / 23,025 rows, raw text intact |
| registry codes in use | — | 44 (properties) / 45 (bridge) |

---

## 1. The premise that had to be corrected

> "`properties.agency_canonical` already collapses 1,286 raw strings to 45 codes … it is an
> **unwired-FK** problem."

The first half is true and the second half is the right diagnosis. But **the alias table is NOT
seeded from `agency_canonical`**, because measured live that column collapses variants *and*
conflates three different things. Seeding from it would have written a wrong FK at scale:

| canonical code | what it actually contains |
|---|---|
| `NAVY` (150 props) | **145 × "Navy Federal Credit Union"** — a bank, not the Navy |
| `ICE` (44) | includes **"Handel's Homemade Ice Cream & Yogurt"** |
| `VA` (2,174) | folds in `ARKANSAS DEPARTMENT OF VETERANS AFFAIRS`, `Virginia Department of Veterans Services`, `RICHMOND FIELD OFFICE (VA)` |
| `USDA` (672) | folds in **Florida / Texas / Washington State** Departments of Agriculture |
| `HHS` (43) | dominated by **Texas Health & Human Services Commission** (a state agency) |
| `DOJ` (40) | includes `TEXAS JUVENILE JUSTICE DEPARTMENT` |
| `EPA` (21) | includes `State of Ga - Dept of Environmental Protection` |
| `DOL` (174) | includes the PA Department of Labor and Industry |

`agency_canonical` is left untouched — it is a display/rollup column with existing consumers, and
it is the axis the parity view reports on. The FK resolves **only** from an explicit alias, so
every auto-applied row is a string a human enumerated.

⚠️ **This is the C10 / UX-T0 class one layer up.** A column named for the answer is not the
answer; the same instinct that reads `metadata.lot_sf` as square feet (PR2) reads
`agency_canonical` as an identity key.

---

## 2. The code census

### 2a. `properties.agency_canonical` — 45 codes, 8,674 classified, 11,835 NULL

Full per-code detail (properties, distinct raw strings, registry row present):

| code | props | raw strings | registry row? |
|---|---:|---:|---|
| *(NULL)* | 11,835 | 811 | — |
| VA | 2,174 | 76 | ✅ |
| GSA | 1,911 | 124 | ✅ |
| SSA | 1,408 | 24 | ✅ |
| USDA | 672 | 17 | ✅ |
| USPS | 429 | 11 | ✅ |
| FBI | 416 | 10 | ✅ |
| **LSC** | 312 | 2 | ❌ |
| **DOL** | 174 | 7 | ❌ |
| **STATE** | 155 | 76 | ❌ |
| **NAVY** | 150 | 4 | ❌ |
| IRS | 97 | 8 | ✅ |
| CBP | 95 | 12 | ✅ |
| DHS | 82 | 8 | ✅ |
| DEA | 78 | 7 | ✅ |
| USCIS | 72 | 5 | ✅ |
| ICE | 44 | 6 | ✅ |
| HHS | 43 | 13 | ✅ |
| DOJ | 40 | 5 | ✅ |
| **USGS** | 38 | 3 | ❌ |
| DOT | 35 | 4 | ✅ |
| DOI | 34 | 5 | ✅ |
| ATF | 33 | 3 | ✅ |
| EPA | 21 | 2 | ✅ |
| FDA | 20 | 1 | ✅ |
| **ARMY** | 17 | 9 | ❌ (registry has `USACE`) |
| **DOC** | 16 | 4 | ❌ |
| FAA | 15 | 1 | ✅ |
| DOD | 12 | 2 | ✅ |
| TSA | 11 | 2 | ✅ |
| FEMA | 10 | 2 | ✅ |
| **NRC** | 9 | 2 | ❌ |
| NOAA | 8 | 2 | ✅ |
| DOE | 7 | 2 | ✅ |
| **NIH** | 6 | 1 | ❌ |
| ED / OPM / CDC | 5 / 5 / 5 | 3 / 1 / 2 | ❌ / ✅ / ✅ |
| HUD | 3 | 1 | ✅ |
| FCC / USAF / NLRB / USCG / BOP | 2 each | 1–2 | ✅ / ❌ / ❌ / ✅ / ✅ |
| SEC / **TREAS** | 1 each | 1 | ✅ / ❌ |

**14 codes have no `government_agencies` row** — LSC (312 props), DOL (174), STATE (155),
NAVY (150), USGS (38), ARMY (17), DOC (16), NRC (9), NIH (6), ED (5), USAF (2), NLRB (2),
TREAS (1). Adding a registry row is a curation decision for a human, so they route to review as
`no_registry_row` rather than being invented. (`NAVY` should almost certainly never get one — it
is a credit union.)

### 2b. The NULL bucket is the important part — and it is not all junk

811 distinct raw strings / 11,835 properties that `agency_canonical` never classified. Reading it:

* **Real federal agencies the canonicalizer misses** — `ACE` / `ACOE` / `ACoe` (Army Corps),
  `BLM`, `NPS`, `MEPS`, `SBA`, `NASA`, `USFS`, `APHIS`, `NARA`, `OSHA`, `SMITHSONIAN`, `FDIC`,
  `MSHA`, `NSF`, `NTSB`.
* **State/local bodies** — ~250 strings (`State of Texas`, `County of Riverside`,
  `City of Nashville Department of Public Works`, `Michigan Department of Health & Human Services`).
* **Facility labels, not agencies** — `<CITY> FIELD OFFICE (<ST>)`, `<REGION> SERVICE CENTER`,
  `POTOMAC SERVICES DIVISION`, `ALEXANDER HAMILTON PLAZA`.
* **Genuine commercial tenants** — `Campco Federal Credit Union` (162), `10 Federal Self Storage`
  (159), `Songsan Korean BBQ` (117), `Dollar Tree|The Liquor Store|Rib City Grill|…` (117).
* **Addresses and dates in the agency column** — `1267 First Avenue`, `2018-04-01 00:00:00`.

**427 of those NULL-bucket properties now resolve** to 23 registry codes — the clearest evidence
that the alias table is doing work `agency_canonical` was not, rather than just re-deriving it.

### 2c. `property_agencies.agency_code` — 498 distinct, two different vocabularies

The bridge is **FRPP-derived** (`data_source='frpp_records'`, `government_type='Federal'`) and its
high-volume values are bare **cabinet-department** labels, not the `properties` vocabulary:

| agency_code | rows | props | registry row? | disposition |
|---|---:|---:|---|---|
| VETERANS AFFAIRS | 48,537 | 832 | ✅ VA | auto |
| AGRICULTURE | 32,952 | 533 | ✅ USDA | auto |
| HOMELAND SECURITY | 15,108 | 248 | ✅ DHS | auto |
| TRANSPORTATION | 11,925 | 222 | ✅ DOT | auto |
| INTERIOR | 2,746 | 91 | ✅ DOI | auto |
| HEALTH AND HUMAN SERVICES | 1,910 | 31 | ✅ HHS | auto |
| **LABOR** | 1,850 | 32 | ❌ | review |
| **COMMERCE** | 1,317 | 26 | ❌ | review |
| ENERGY | 1,023 | 17 | ✅ DOE | auto |
| **SMITHSONIAN** | 693 | 11 | ❌ | review |
| **INDEPENDENT GOVERNMENT OFFICES** | 504 | 8 | ❌ (bucket label) | review |
| **TENNESSEE VALLEY AUTHORITY** | 441 | 7 | ❌ | review |
| JUSTICE | 252 | 4 | ✅ DOJ | auto |

⚠️ **`VETERANS AFFAIRS` was already resolving before the cabinet batch** — via the
properties-oriented curated alias `'Veterans Affairs'`. The cross-population hit is *correct* here
(the FRPP cabinet department **is** the federal VA), but it was **accidental, not designed**, and
is recorded rather than relied on.

---

## 3. What was built

1. **`gov_agency_alias_key(text)`** — the comparator. Agency-specific and deliberately **not** a
   generic alnum key (the ID4 per-class decision): strip periods/apostrophes, non-alnum → space,
   collapse, upper. **Word boundaries preserved**, so `USDA` and `US DEPARTMENT OF AGRICULTURE`
   stay distinct strings that an explicit alias row relates.
2. **`gov_agency_aliases`** — raw string → `agency_id`, unique on the key, provenance-tagged.
   **217 rows**: 65 `registry_code` + 57 `registry_full_name` + 88 `id3a_curated` + 7
   `id3a_frpp_cabinet`. Covering all 65 registry rows.
3. **`gov_resolve_agency(text)`** → `{agency_id, code, status}` where status is
   `blank` | `matched` | `unresolved`. **Exact alias match only; fails closed; never mints; never
   fuzzy.** `service_role` only, revoked from `public` **and** `anon` **and** `authenticated`,
   asserted with `has_function_privilege()` in the same migration.
4. **`gov_agency_id_write_guard()`** + triggers on **both** columns — `BEFORE INSERT OR UPDATE OF
   agency_id`, RAISEs on an id that is absent from the registry or belongs to a retired row. The FK
   enforces existence; the guard adds *and it is active*.
5. **`gov_id3a_backfill_agency_ids(p_dry_run default true, p_batch)`** — fill-blanks only, auto
   applies **only** `status='matched'`, routes everything else to review, reports the auto/review
   split in one call.
6. **`gov_agency_resolution_review`** — the review lane, raw text verbatim, with a classified
   `reason`.
7. **`gov_agency_id_backfill_log`** — the reversal ledger (runbook in the migration header).
8. **Parity + detector views** — §5, §6.

### The four decisions, and why each is a refusal

| decision | measured | disposition |
|---|---|---|
| **`(VA)` is a state suffix** | `RICHMOND FIELD OFFICE (VA)` (74 rows) matches the `<CITY> FIELD OFFICE (<ST>)` shape used across the column — `BALTIMORE FIELD OFFICE (MD)`, `CHARLESTON FIELD OFFICE (WV)`, `PITTSBURGH FIELD OFFICE (PA)` | never aliased → `state_suffix_ambiguous` (21 strings / 904 rows) |
| **`ACE`/`ACOE` = Army Corps** | property 511 (`ACE`) is **475 Quality Cir NW, Huntsville AL**; property 31087 (`ACOE`) is **475 Quality Cir SW, Huntsville AL** — the USACE Huntsville Center campus. Other `ACOE` rows: Little Rock AR, St. Paul MN, Lakewood CO, Winchester VA — all USACE districts. All `government_type='Federal'` | **aliased to USACE**, with the evidence recorded in the alias row's `note` (a guard asserts the note survives) |
| **`AMRY`** (a probable ARMY typo) | one row; the Corps cannot be inferred from it | **not aliased** |
| **`GSA - <occupant>`** (~90 strings) | names GSA as contracting agency *and* a second occupying agency. `agency_canonical` resolves some to GSA and some to the occupant — two answers for one shape | **all routed** → `gsa_compound_occupant` (106 strings / 624 rows). Costs 150 properties on `GSA - Social Security Admin` alone, on purpose |

---

## 4. The auto / review split

Dry run and live apply **matched exactly** — 7,369 and 119,201 on both — which is the control that
the set-based apply is equivalent to the per-row resolver.

| | auto rows | auto strings | review rows | review strings | blank |
|---|---:|---:|---:|---:|---:|
| `properties` | **7,369** | 179 | 10,143 | 1,107 | 2,997 |
| `property_agencies` | **119,201** | 106 | 12,882 | 386 | 0 |

`7,369 + 10,143 + 2,997 = 20,509` ✅ · `119,201 + 12,882 + 160 (pre-existing) = 132,243` ✅

⚠️ **The apply had to be chunked.** `gov_id3a_backfill_agency_ids(false, …)` **timed out at 60 s**
on the 132k-row bridge (a per-row plpgsql resolver invoked 152,752 times). The whole transaction
**rolled back cleanly** — verified by state delta, not by the return value — so the DB was never
half-applied. It was then run set-based against the identical alias predicate in three chunks
(40,000 + 40,000 + 39,201), each asserting its own count. The dry-run function remains the
graded instrument; it is correct and simply not the right tool for a 132k-row write.

### The review lane, by reason

| reason | properties (strings / rows) | bridge (strings / rows) |
|---|---|---|
| `unmatched_needs_alias` | 660 / 4,286 | 205 / 7,462 |
| `facility_label_not_agency` | 62 / 2,356 | 55 / 2,930 |
| `multi_agency_compound` | 107 / 915 | 36 / 808 |
| `state_suffix_ambiguous` | 21 / 904 | 20 / 1,144 |
| `commercial_lookalike` | 65 / 767 | 6 / 213 |
| `gsa_compound_occupant` | 106 / 624 | 62 / 320 |
| `state_or_local_body` | 76 / 291 | 2 / 5 |

**Nothing in the review lane is a guess waiting to be confirmed** — it is a named question. The
largest single bucket, `unmatched_needs_alias`, is dominated by genuine commercial tenants and
facility labels that will never be an agency.

---

## 5. Parity — `v_gov_agency_wiring_parity`

**The only movement is variants of one agency collapsing onto one registry code.** Every
`agency_canonical` code landed on exactly ONE registry code, with two explainable exceptions:

* `USDA` → `USDA` + **`APHIS`** — correct; APHIS is a real sub-agency with its own registry row.
* `USCIS` → `USCIS` + **`CIS`** — **the registry duplicate** (§7).

Headline collapse (`v_gov_agency_identity_collapse`):

| code | raw strings collapsed | properties |
|---|---:|---:|
| **VA** | **37** | **2,063** |
| GSA | 11 | 1,430 |
| **SSA** | **13** | **1,248** |
| USDA | 8 | 710 |
| USPS | 12 | 431 |
| FBI | 7 | 413 |
| ST-DFPS | 2 | 123 |
| DHS | 7 | 95 |
| IRS | 4 | 93 |
| CBP | 6 | 89 |

**SSA specifically** — the four strings the brief named (`SSA` 723, `Social Security
Administration (SSA)` 430, `GSA - Social Security Admin` 150, `Social Security Administration`)
now resolve to **one `agency_id`** … with one deliberate exception: `GSA - Social Security Admin`
(150 properties) is held in review under `gsa_compound_occupant`, because deciding whether
`properties.agency_id` names the contracting agency or the occupant is a modelling question, not a
string question. 13 of SSA's 24 raw strings collapsed; 1,248 of 1,408 properties wired.

**VA specifically** — 37 of 76 raw strings collapsed onto one id, 2,063 of 2,174 properties. The
residue is exactly the population that *should* not collapse: `RICHMOND FIELD OFFICE (VA)`,
`ARKANSAS DEPARTMENT OF VETERANS AFFAIRS`, `Virginia Department of Veterans Services`, and the
`VA/DOD`-style compounds.

---

## 6. The identity detector, first live run

`v_gov_agency_identity_detector` — agency-specific comparator, scoped to the two `agency_id`
columns. **Run once, live, not scheduled** (a new job is not shipped until it has been green once).

| target | rows total | resolved | **orphan (raw text, no alias)** | no raw text | strings collapsed | distinct agencies |
|---|---:|---:|---:|---:|---:|---:|
| `properties.agency_id` | 20,509 | 7,369 | **10,143** | 2,997 | 179 | 44 |
| `property_agencies.agency_id` | 132,243 | 119,361 | **12,882** | 0 | 110 | 45 |

`rows_orphan_unresolved` is the honest gap and `rows_no_raw_text` is kept as a **separate** state —
*the source string is blank* and *the source string cannot be resolved* are different facts (P180),
and a detector that folds them reports a smaller problem than it has.

**Write-guard positive control, run live:** an UPDATE setting `agency_id` to an all-zeros UUID on
`properties` **raised** and was rolled back. A guard that has only ever been seen green is a claim.

---

## 7. Findings surfaced, not fixed

* **`ID3a-regdup` — the registry contains a duplicate.** `CIS` and `USCIS` carry the **identical**
  `full_name` ("U.S. Citizenship and Immigration Services"). Live they split one agency:
  `CIS` holds 7 properties + 3 bridge rows, `USCIS` holds 72 + 95. The alias seed's
  `ON CONFLICT DO NOTHING` resolves the full-name collision deterministically by `agency_id` order
  rather than silently merging; `v_gov_agency_registry_health.registry_duplicate_full_name` reports
  it. **Merging them is a curation decision, not a string fix.**
* **`ID3a-registry-gaps` — 14 canonical codes have no registry row** (§2a). LSC (312 properties)
  and DOL (174) are the two worth a human's attention. `NAVY` (150) should never get one.
* **`ID3a-gsa-compound` — 168 strings / 944 rows** await the modelling decision: does
  `properties.agency_id` name the contracting agency (GSA) or the occupant? The occupant arguably
  belongs on `property_agencies`, which is what that table is for.
* **`agency_canonical` itself is wrong on ~340 properties** (NAVY 150 credit-union rows, the state
  bodies folded into VA/USDA/HHS/EPA/DOJ/DOL, the ice-cream shop in ICE). **Not repaired here** —
  it is a display column with live consumers, and repairing it is a separate change with its own
  parity gate. The wiring routes around it rather than trusting it.
* **`ARS` and `NIST`** are registry rows nothing maps to at all (0 properties, 0 bridge rows).

## 8. Explicitly out of scope, and untouched

County/city vocabulary (I14), owner identity, broker identity, cross-lane property linking, entity
merges. **No consumer was repointed** — no view, handler or export was changed to group by
`agency_id`. That is deliberate: the FK now exists and is 90% wired on the bridge, so a consumer
switch is a separate, measurable change with its own before/after.

## 9. What a next session should do

1. **`ID3a-detector-schedule`** — the detector has run once. Register it (a `feed_freshness`-style
   row or an `lcc_health_alerts` check on `rows_orphan_unresolved` rising) only after a second
   clean run. Threshold sizing matters more than the schedule: the orphan count is *expected* to be
   large and mostly correct (commercial tenants, facility labels), so alert on the **delta** or on
   `rows_resolved` falling, never on the absolute orphan count — a monitor whose threshold is a
   default generates noise and hides breaks (B6d).
2. **`ID3a-regdup`** — merge `CIS` into `USCIS` (or the reverse), repoint the 10 rows, retire the
   loser rather than deleting it.
3. **`ID3a-registry-gaps`** — decide LSC and DOL; leave NAVY alone.
4. **`ID3a-gsa-compound`** — the contracting-vs-occupant modelling call, then 944 rows resolve.
5. **Expand the alias table from the review lane**, largest `row_count` first. It is ordinary
   curation: each confirmed alias is one row, and the resolver picks it up with no code change.
6. **Consumer switch** — measure each agency-grouping query/view before and after repointing it at
   `agency_id`. Per the C10 lesson, diff the view's columns against the consumer's reads first.
7. **Generalising the detector** is ID4's job and should wait for a second class (ID3e county
   vocabulary) so the shared shape is derived from two populations rather than one.

## 10. Reversal

```sql
update properties p set agency_id = null
  from gov_agency_id_backfill_log l
 where l.target_table='properties' and l.record_pk = p.property_id::text
   and l.batch_tag = 'id3a_20260912' and l.reverted_at is null;

update property_agencies a set agency_id = null
  from gov_agency_id_backfill_log l
 where l.target_table='property_agencies' and l.record_pk = a.property_agency_id::text
   and l.batch_tag = 'id3a_20260912' and l.reverted_at is null;

update gov_agency_id_backfill_log set reverted_at = now() where batch_tag='id3a_20260912';
```

The ledger holds **126,570 rows** (7,369 + 119,201) — one per write, with the raw text that
produced it.
