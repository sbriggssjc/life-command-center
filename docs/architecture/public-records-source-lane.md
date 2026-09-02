# Public records as an independent source lane (assessor / parcel / tax / deed)

> **START HERE for anything about assessor, parcel, tax or deed data as a SOURCE** — what it
> populates, where it sits on the authority ladder, and what is actually missing.
>
> **Scott's framing, 2026-09-01, and it is the correct one:** *"assessor data is valuable regardless
> of sale status or previous ingestion. It is just another independent public record source for
> property-related data — physical stats, ownership information and history, sales. It should be its
> own lane that populates all properties in the database that later code processes can evaluate
> against to find the most accurate representation of each property by field."*
>
> **Headline finding 2026-09-01: that lane is ALREADY BUILT and it has NEVER WRITTEN A FIELD.**
>
> **⚠️ SECOND FINDING, 2026-09-01 (PR1), AND IT INVERTS THE FIRST ONE'S REMEDY: IT MUST NOT
> WRITE ONE, BECAUSE THE LANE'S PRODUCER GENERATES ITS VALUES.** `src/public_record_ingest.py`
> — the producer of `parcel_records`, `tax_records` and `deed_records` on BOTH domains —
> **contains no county record fetch.** dia asks **gpt-4o to recall** parcel and tax facts from a
> prompt seeded with the property's own address *and the owner we already hold*; gov fetches a
> ≤4,000-char snapshot of the assessor **PORTAL HOMEPAGE** and asks a model for parcel JSON.
> **Wiring that to `lcc_merge_field` would promote model output to `county_records`, which
> outranks salesforce(20), om_extraction(30–50) and every sidebar(45–65) on 93 rungs.**
> The consumer was **refused on measurement**; the instrument shipped instead. See §2a.

---

## 0. ⚠️ This page supersedes a wrong verdict issued the same day

`property-metadata-coverage.md` concluded **"no build — the population is stale sold comps."**
**That verdict was scoped to the 662-row `property_metadata_backfill_queue` and is wrong as a
statement about the public-records source.** The error was scoping a **SOURCE** to one
**CONSUMER's** gap list — the exact inversion `data-coherence-invariants.md` **I1** exists to
prevent, committed by the person who wrote I1.

**What survives from that page:** the fabrication finding (§3 there — the retired module had no
county adapter and asked gpt-4o to recall parcel facts), invariant **I12** (acres vs sq ft), and the
Ollama-corpus measurement. **What does not survive:** *"don't build"*, and every reach number in its
§5, because all of them used the queue as the denominator.

**The correct denominator is every property: dia 11,802 + gov 13,837.** A sold property's assessor
record is still ownership history, still a sale record, still physical stats.

## 1. The lane exists, in full, on both domains

| object | what it carries |
|---|---|
| `parcel_records` | `apn, county, state, assessed_value, owner_name, zoning, building_sf, lot_sf, year_built, year_renovated, land_use, mailing_address, raw_payload, data_hash, fetched_at` |
| `tax_records` | `apn, county, state, tax_year, assessed_value, tax_amount, amount_paid/due, is_delinquent, delinquent_amount, mailing_owner, mailing_address, raw_payload` |
| `deed_records` | `county, state, recording_date, document_number, deed_type, grantor, grantee, consideration, legal_description, grantor_address, grantee_address` |
| `property_public_records` | **the link + confidence layer** — `property_id, record_type, record_id, confidence, verified, verified_by, verified_at, notes` |
| `county_authority_cache` | **926 counties** with `assessor_url, recorder_url, tax_collector_url, clerk_url, gis_url` |

⚠️ **Note the keying, and keep it:** `parcel_records` / `tax_records` / `deed_records` are keyed on
**APN + county + state**, not `property_id`. The link goes through `property_public_records`. **That
is correct** — a public record exists independently of whether we hold a property row for it, which
is precisely Scott's "its own lane" requirement, already honoured.

**And the authority ladder is registered.** `county_records` holds **93 field rungs spanning BOTH
domains**. ⚠️ **Not all at priority 5 — measured, the rungs are 5, 10 and 15**, and the split
matters: `dia.properties.year_built` is **@10**, `building_size` **@15**, `parcel_number` **@5**.
Every one still outranks `salesforce`@20, `om_extraction`(30–50) and the sidebars(45–65), so the
supersession risk is unchanged; but quote the rung, not the headline. Rungs span — `dia.properties.year_built / building_size / land_area /
lot_sf / zoning / assessed_value / parcel_number / recorded_owner_id / recorded_owner_name`,
`dia.ownership_history.*`, `dia.sales_transactions.*`, and the full gov mirror. `recorded_deed` sits
at **3**. Both **outrank** `om_extraction` (30–50) and `costar_sidebar` (45–60).

## 2. 🚨 The finding: the highest-registered source has never written a field

**`county_records` has ZERO rows in `field_provenance`. Ever.** Positive-controlled in the same
query: `recorded_deed` has 2,681 rows / 371 writes, so the detector fires. No tax/parcel/assessor
source variant exists under any other spelling (49 distinct sources checked).

**The tables fill and nothing consumes them.**

| leg | rows | properties linked | of 11,802 | producer |
|---|---:|---:|---:|---|
| **tax** | 25,621 | **9,107** | **77%** | live, fetched 2026-08-31 — ⚠️ **see the split below: 25,334 of these rows carry NO APN and no amount** |
| **parcel** | 1,604 | 908 | 7.7% | live, fetched 2026-08-31 — ⚠️ **the 41 rows with building stats are the APN-less model leg** |
| **deed** (dia) | 178 | — | — | live, fetched 2026-08-31 |
| mortgage | 171 | 135 | 1.1% | **dead since 2026-05-10** |
| entity | 153 | 124 | 1.0% | **dead since 2026-05-10** |

### ⚠️ 2026-09-02 — the table above counts ROWS; split by `raw_payload->>'source'` it is two different things

| table | `source` | rows | distinct APN | with a value | properties linked |
|---|---|---:|---:|---|---:|
| `tax_records` | **NULL (the gpt-4o leg, PR1)** | **25,334** | **1 — the APN is NULL** | tax_amount on **10**, assessed on 10 | **9,033** props / 22,131 links |
| `tax_records` | `costar_sidebar` | 287 | 286 | assessed on 287, **tax_amount on 0** | 266 |
| `parcel_records` | **NULL (the gpt-4o leg)** | 672 | **1 — NULL** | stats on **41**, assessed on 1 | 27 |
| `parcel_records` | `costar_sidebar` | **932** | **931** | assessed on 286, **stats on 0** | **883** |

**So "the tax fetcher reaches 77%" — this page's own §3 item 2, and backlog PR2 as filed — was
measuring the model leg:** 9,033 properties are linked to APN-less, amount-less rows that PR1
already identified as generated. **There is no county tax fetcher reaching 77% of anything.** The
only real public-record rows in dia come from the **CoStar sidebar capture** — 931 real APNs on
883 properties (7.5%), assessed values on 286, and **zero building stats** even though a CoStar
property page carries building SF / year built / lot size. That last fact is the real PR2 question:
*does the sidebar → `parcel_records` writer drop the stats it was handed?* (→ **PR2**, re-scoped).
And the 22,131 APN-less tax links are residue to quarantine, reversibly, so no consumer ever reads
them as coverage (→ **PR11**). Same lesson as PR1a's `0 % 100000 = 0`: **split by source before
quoting a coverage number, or the generator's output reads as reach.**

### ✅ 2026-09-02 — PR2 SHIPPED: the sidebar writer now carries the stats, and the parser was the load-bearing half

**Re-measure before quoting the split table above — the `costar_sidebar` parcel row is no longer all zeros.**

| dia `parcel_records` where `source='costar_sidebar'` (932 rows) | before | after |
|---|---:|---:|
| `building_sf` | 0 | **767** |
| `lot_sf` | 0 | **734** |
| `year_built` | 0 | **714** |
| `year_renovated` | 0 | **86** |
| `zoning` | 0 | **232** |
| `land_use` / `owner_name` | 0 | **0 — ceiling is zero, see below** |
| `lot_sf` below 100 sq ft (the sentinel shape) | — | **0** |
| dia `tax_records.tax_amount` where `source='costar_sidebar'` | 0 | **0 — ceiling is zero** |

Writer: `api/_handlers/sidebar-pipeline.js::upsertPublicRecords` (both domains).
Rungs: `supabase/migrations/20261008120000_lcc_pr2_sidebar_parcel_stat_rungs.sql` (16 rows, applied).
Backfill: batch `pr2_sidebar_parcel_stats_20260902`, 817 rows, reversal ledger
`dia._pr2_parcel_stats_backup_20260902`, script
`scripts/pr2-backfill-sidebar-parcel-stats.mjs`. Guard:
`test/pr2-sidebar-parcel-stats.test.mjs` (12 tests, **15/15 mutations RED**).

- 🚨 **THE DOMINANT LOT-SIZE FORMAT WAS BEING READ AS 1 SQUARE FOOT, AND FIXING
  THE WRITER WITHOUT FIXING THE PARSER WOULD HAVE SHIPPED THAT INTO
  `parcel_records`.** CoStar renders lot size as **`"1.00 (43,560 sf)"`** —
  acres, with the square footage in parentheses — on **1,679 of 2,477 live
  captures (68%)**. `parseLotSF` matched `/([\d.]+)\s*AC/i`, which that string
  does not contain, then fell through to `parseSF`, which strips the `sf` token
  and `parseFloat`s the **leading** number: **1**. Measured on the backfill's own
  population, **476 of 760 lot values came through that arm** — i.e. the majority
  of what PR2 wrote would have been an acres-as-square-feet error. `properties.lot_sf`
  had **0 rows below 100 sq ft**, so the defect was latent there, not live; it is
  fixed anyway, and `properties.lot_sf` / `land_area` now come from ONE parse
  (+90 each, in lockstep — I12 satisfied by construction rather than by two
  writers agreeing).
- ⚠️ **AND THE KEY CAN LIE ABOUT THE UNIT TOO — I12, one level up.**
  `metadata.lot_sf` names square feet and holds **both**: live values include
  `78300`, `43560`, `100000`, `41817.6` (sq ft) alongside `1.71`, `0.94`, `1.24`,
  `0.7` (acres). Preferring it *because of its name* turned a 1.71-acre lot into
  **2 square feet** in this backfill's own dry run — caught by auditing the
  parsed outliers, not by reading the code. It is excluded from the precedence;
  `land_sf` (850 rows, every one `"N SF"`) and `lot_size` (unit in the value)
  are kept. **A key whose contents are mixed does not carry a unit.**
- ⚠️ **`"0.00 (1 sf)"` IS CoStar's NO-DATA RENDERING, NOT A ONE-SQUARE-FOOT
  PARCEL** — the PR1a sentinel-as-measurement defect wearing a new format. **10
  captures fleet-wide** render that shape and **every parenthetical below 100 sq
  ft is one of them**, so a 100 sq ft floor refuses exactly the sentinels and
  nothing real (the smallest genuine lot in the population is 3,528 sq ft).
- ⚠️ **THE CEILING FOR `tax_amount`, `land_use` AND `owner_name` IS ZERO, AND
  THAT IS A MEASUREMENT.** Those keys have **never appeared on any of 55,901
  entity captures**. `tax_amount` is present as a KEY in all 932 parcel
  `raw_payload`s and non-null on **0** — independent confirmation from a second
  store. All three are wired (the county-assessor scanner
  `extension/content/public-records.js::scanAssessor` emits them, so a future
  assessor capture lands), and they will read 0 until it does. **A wired field
  with a stated ceiling of zero is not the same as a gap left silent.**
- ⚠️ **`parcel_records.owner_name` IS NOT FILLED FROM THE OWNER WE ALREADY
  HOLD.** That column means *the party the county names on this parcel*; filling
  it from the CoStar owner panel restates our own value as if a county had said
  it — the gov ORE Phase A1 finding, where 9,749 gov parcel `owner_name`s are
  the recorded owner echoed back and have read as independent corroboration ever
  since. Guarded by name in the test.
- ⚠️ **`land_use` IS NOT MAPPED FROM `property_type`.** On an assessor capture
  that key holds a use code; on a CoStar capture it holds the CRE property type
  ("Medical Office"). One key, two meanings.
- **Provenance: 2,532 rows, 2,532 `write` / 0 `skip` / 0 `conflict`**, all
  `no_prior_provenance`, and **`v_field_provenance_unranked` unchanged at 30** —
  which is what registering the 16 rungs BEFORE writing was for. ⚠️ Note the
  brief's mechanism was off by one layer: `lcc_merge_field` writes the caller's
  source verbatim; the `domain_trigger` relabel PR8 replaced lives in the ASYNC
  `lcc_flush_provenance_events` drain. The consequence of writing unregistered
  is drift-detector growth, not a relabel.
- 🔴 **FOUND, FILED, NOT FIXED — `field_provenance` CANNOT STORE A VALUE
  CONTAINING A DOUBLE QUOTE.** `value_text_hash` is `GENERATED AS
  encode(sha224((value)::text::bytea),'hex')`; a jsonb string renders its inner
  quotes with backslashes and `::bytea` rejects them with **22P02**, aborting
  the whole `lcc_merge_field` call. One live value hits it (apn `145416`, zoning
  `"C" - Commercial`) and it is the reason provenance is 2,532 and not 2,533.
  The live writer degrades quietly rather than failing — `shouldWriteField`
  catches and fails open — so this has been silently dropping provenance for any
  quoted value for as long as the column has existed. Backlog **PR12**.
- **Fill-blanks proven, not asserted:** all 817 snapshotted pre-states are
  **fully blank across every touched column**, so the backfill overwrote
  nothing. Re-run plans 0.
- **The `$/SF` comp residue is a DISJOINT population — this recovers 0 of it.**
  `property-metadata-coverage.md`'s "82 properties with a sale price and no
  building size" reads **84** today, and **0 of the 84 have a sidebar parcel
  capture at all**. That gap is not reachable from this source; do not re-file it
  against PR2.
- **gov is fixed in the WRITER and NOT backfilled.** Same defect, bigger
  population — **1,527 `costar_sidebar` parcel rows, 0 stats**, against a capture
  ceiling of 1,230 `square_footage` / 1,192 `year_built` / 1,155 lot / 310
  zoning across 1,271 gov captures. `scripts/pr2-backfill-sidebar-parcel-stats.mjs
  --domain government --apply` is one command; it was left as a deliberate call
  rather than quietly widening a dia-scoped change. (→ `OPERATOR-ACTIONS.md` §3 **PR2-gov**.)
- ⚠️ **The backfill is proven; the PRODUCER is not (Class 8).** Re-measured after the merge
  (2026-09-02 ~17:30 UTC): every dia count above reproduces, **0 new `costar_sidebar` parcel rows
  have landed since** (last capture 2026-08-31 18:33 UTC) and the Railway redeploy is unconfirmed.
  The DB half (rungs, backfill, provenance) shipped instantly; the JS writer ships on the redeploy.
  **The proof is a NEW sidebar parcel row carrying `building_sf`** — today's 767 cannot supply it.
- ⚠️ **`properties` moved too, via `trg_parcel_propagate_to_property`** (AFTER
  UPDATE OF these very columns, fill-blanks, units correct). **779 properties
  touched**; `lot_sf` **3,704 → 3,794** and `land_area` **3,707 → 3,797** are
  exact. `building_size` / `year_built` / `zoning` were **not baselined before
  the run** — an omission, not a measurement — so only upper bounds are
  available (≤708 / ≤685 / ≤232). Quote them as upper bounds.

### PR11 — the APN-less residue: the marker already exists; the consumer and the producer gate do not

Sized 2026-09-02: **25,331 APN-less `tax_records` + 671 APN-less `parcel_records`**,
**22,171 `property_public_records` links** (22,131 tax + 40 parcel) reaching
**9,033 properties** — 93% of the whole link table. **Not quarantined here**, for
two reasons that are worth stating rather than working around:

1. **The marker half is already shipped.** `v_dia_public_record_acquisition` +
   `dia_public_record_source_is_trustworthy()` already name this population
   (`acquisition_class = 'ai_gpt4o_presumed'`, `trustworthy_source = false`) and
   now show the contrast directly: the model leg's 40 parcel "stat" rows read
   `year_built_zero: 37`, against the sidebar leg's 714 real years. Stamping
   `metadata.quarantined_reason` on 48k rows would add a flag **nothing reads** —
   inert, and easily mistaken later for "PR11 done". What is missing is
   **consumers filtering on `trustworthy_source`**, which is a change to those
   consumers, not to these rows.
2. **The producer gate belongs with a retirement decision, not with plumbing.**
   Refusing a NULL-APN write in `Dialysis/src/public_record_ingest.py` would stop
   essentially the model leg's entire output — which is §2a's explicit warning:
   *"Do not 'fix' this by deleting the GPT fallback in the same change — it is
   the only thing writing these tables today... Gate it, measure, then retire."*

**PR11 therefore stays filed**, re-scoped to those two halves.

**The clinching detail:** `dia.properties.year_built` carries **3,586 `field_provenance` rows and
the only source is `salesforce`** (priority 20). The county source registered at priority 5 — which
would outrank it on every one of those rows — has contributed nothing, while `parcel_records` sits
in the same database holding the answer.

**This is Dead-End Class 2 (a producer with no consumer) on the most extensively registered source
in the system**, and it is invisible to every existing check: the tables are non-empty and growing,
the producer is green, the ladder is registered, and the fields fill from somewhere else.

## 2a. 🚨 PR1 — the producer generates its values. The consumer was refused. (2026-09-01)

PR1 was *"build the reconciliation consumer."* It was not built. **Read what a producer's external
call actually TALKS TO before trusting its name** — the rule this repo already paid for twice
(`assessor_enrichment.py`, gov ORE Phase A1) and did not apply to the module next door.

**dia `src/public_record_ingest.py`** — no `requests`, no `httpx`, no `urlopen`, no county URL. Its
one external call is `client.chat.completions.create(model="gpt-4o")`, fed a prompt built from the
property's own `address / city / state / county / **Recorded Owner** / **True Owner**`. The parsed
result is literally named `gpt_parcel`. **gov's copy** does fetch a URL — `_fetch_text_snapshot`,
≤4,000 chars — but the `source_url` on every row is the assessor **portal homepage**, never a
parcel-detail page, and a homepage cannot state a specific parcel's assessed value.

### The evidence, with its own positive control

⚠️ **A roundness statistic was published here first and it was WRONG — corrected the same day, and
the correction is worth more than the original claim.** The first cut read *"100.0% of gov's 9,265
model-leg assessed values are exact multiples of $100,000, against 3.8% on the CoStar leg"* and
called that the signature of a fabricated plausible number. **It was measuring ZEROS: `0 % 100000 =
0`.** 9,264 of those 9,265 values are exactly `0.00`. The metric was structurally unable to say
anything about roundness — the same trap this repo documents for the P157 `reloptions` test and the
P182 deparse grep, **committed by the author of the page that documents it**, and caught only by
running `count(*) filter (where assessed_value = 0)` while double-checking a PR body. `zeros` and
`positives` are now separate first-class columns on both views.

**Corrected measurement:**

| measurement | model leg | CoStar leg (same table) |
|---|---:|---:|
| gov `parcel_records` assessed values | 9,265 → **9,264 are `0.00`**, 1 positive | **416 positive, 0 zeros** |
| gov `tax_records` assessed values | 3,008 → **3,007 are `0.00`**, 1 positive | 416 positive, 0 zeros |
| dia `tax_records` assessed / tax_amount | 22,139 → **22,132 are `0`**, 7 positive | 287 positive, 0 zeros |
| dia parcel `year_built` | 40 → **37 are `0`**, 3 real years | **0 rows carry it at all** |
| dia `tax_records` rows with a literal `XYZ …` placeholder owner | **186** | 0 |
| Regrid-shaped payloads anywhere | **0** | — |

**So the model leg does not invent plausible numbers — it emits almost nothing, as zeros.** That is
a different defect and in one way a worse one: a `0` is a *positive assertion* ("assessed at $0",
"tax of $0") that propagates into curated columns and reads as measured, whereas a NULL would have
been honest. It is the same shape as `tax_delinquent = false` from `bool(None)`.

**What the fabrication case actually rests on** — and none of it depends on the retracted statistic:
1. **The producer has no county fetch.** A fact about the code, not a distribution.
2. **Placeholder and templated owner names** on the dia leg: `mailing_owner` = *"XYZ Dialysis
   Centers LLC"*, *"XYZ Healthcare Trust"*, and city-templated *"Santa Rosa Dialysis LLC"*,
   *"Houston Dialysis Holdings LLC"*. A model generated those; a county did not.
3. **gov `owner_name` (9,749 rows) is the recorded owner we fed the prompt, echoed back** — the
   ORE Phase A1 finding.
4. **0 Regrid-shaped payloads**, so the vendor path has never run.

⚠️ **"Unstamped == model output" is a MEASUREMENT here, not an assumption: zero rows are
Regrid-shaped, so the vendor path has never run.**

### It is already in the curated table

`v_dia_curated_field_ai_provenance` (shipped, live):

| curated field | properties tracing to the **model** leg | traced value | to the CoStar leg |
|---|---:|---|---:|
| `dia.properties.tax_amount` | **8,842** | **all `0`** | 0 |
| `dia.properties.assessed_value` | **8,682** | **all `0`** | 262 (positive) |
| `dia.properties.tax_year` | **8,842** | real years (2025/26) | 265 |
| `year_built` / `building_size` / `lot_sf` | 2 / 3 / 1 | non-zero | 0 |

⚠️ **Read the `traced_value_is_zero` column, not the count.** Live on `dia.properties`
BEFORE the cleanup: `assessed_value` was non-null on 8,962 rows of which **8,700 were exactly `0`**
and only **262 positive** — and those 262 are precisely the CoStar-traced ones. `tax_amount` was
**9,025 zeros against 1 positive**. So the curated columns were not carrying invented figures; they
were carrying the model leg's no-data sentinel as if it were a measurement.

✅ **CLEANED 2026-09-01 (PR1a/PR1b). Re-measure before quoting the numbers above.**
`Dialysis/supabase/migrations/20260901140000_dia_pr1ab_no_data_sentinel_cleanup.sql` (batch
`pr1ab_20260901`, reversible via `dia_pr1ab_restore_sentinels`) and
`government-lease/sql/20260901_gov_pr1b_tax_delinquent_sentinel.sql` (batch `gov_pr1b_20260901`).

| column | before | after |
|---|---|---|
| dia `properties.assessed_value` | 8,700 zeros / 262 positive | **0 zeros / 262 positive** |
| dia `properties.tax_amount` | 9,025 zeros / 1 positive | **0 zeros / 1 positive** |
| dia `properties.tax_delinquent` | false 11,802, true 0, null 0 | **null 11,802** |
| dia `tax_records.is_delinquent` | false 25,621 | **null 25,621** (`raw_payload` untouched) |
| gov `properties.tax_delinquent` | false 20,495, true 0, null 0 | **null 20,495** |
| dia `properties.tax_year` | 9,110 non-null | **9,110 — deliberately untouched, real years** |

- ⚠️ **THE SENTINEL ARRIVED BY *FOUR* ROUTES AND FIXING ANY ONE READS AS COMPLETE.** PR1 fixed
  `write_tax_record`'s `bool(None)` and that was necessary and **inert for 98.9% of the rows**:
  (1) the writer's `bool(None)`; (2) **`sync_properties_from_sources.py` carried its own
  `bool(latest.get("is_delinquent"))`** — a SECOND route to the same curated column that would have
  re-manufactured `false` on the next run; (3) **a column `DEFAULT false`** on
  `properties.tax_delinquent` (BOTH domains) and dia `tax_records.is_delinquent`, upstream of every
  Python fix — this is 100% of gov's 20,495, whose writer only ever sets `True`; and (4) **the
  prompt template itself**, below. This is the B6d-pri-reason lesson exactly: *when a value can
  arrive by more than one route, the placeholder rule has to cover every route.*
- 🚨 **THE TEMPLATE IS THE SENTINEL'S SOURCE, AND THE DATA MIRRORS IT FIELD BY FIELD.** dia's prompt
  hard-coded **`"is_delinquent": false`** while every other unknown in the same JSON block was
  `null` — so the model echoed it: **`false` on 25,331 rows, `true` on ZERO**, with the key present
  in `raw_payload` on every one. gov's template hard-coded **`0` for all nine money fields** and
  `null` for `year_built`/`building_sf` — and gov's data splits on exactly that line (9,264 of 9,265
  assessed values are `0.00`; `year_built` is uncontaminated). **The model returns what the template
  shows.** Both templates now offer `null`; a genuine `0`/`false` is still expressible.
- ⚠️ **`_positive_numeric` ALREADY EXISTED AND NAMED `assessed_value` IN ITS OWN DOCSTRING.**
  `write_tax_record` used `_safe_numeric` beside it. Same shape as the FRED finding — *before adding
  a detector, check whether one exists and is silenced* — here the **coercion** was written, correct,
  and simply never applied to the two fields that reached curated columns.
- ⚠️ **A `$0` DEED CONSIDERATION IS A REAL FACT AND IS DELIBERATELY NOT GUARDED.** Quitclaims and
  intra-sponsor transfers genuinely record $0/$1, and A2b grades "nominal price" as its own shape.
  Zero-guarding every money field uniformly would have destroyed that signal; the exception is
  pinned by a test that goes RED if someone "finishes the job".
- ⚠️ **THE 3 MOST INTERESTING ROWS WERE NOT SENTINELS BUT MASKS.** dia properties 23313 / 25203 /
  31443 read `assessed_value = 0` while their linked **CoStar** tax record states **$406,662 /
  $2,430,500 / $2,022,030**. The zero was suppressing a real measurement already on file.
- **The predicate is evidence-based, not "all falses"**: a row is nulled only when no *trustworthy*
  linked record actually states the value, so it self-limits if a real source ever lands.
  `dia_public_record_source_is_trustworthy()` is now the single owner of that judgement and
  `v_dia_public_record_acquisition` CALLS it — view output fingerprint byte-identical after the
  refactor. Every `trace_class` is recorded per row in the reversal ledger.
- ⚠️ **The historical writer of the 8,700 curated `assessed_value` zeros is NOT attributable and the
  view cannot attribute it** — it joins on *value equality*, and two zeros match trivially. The only
  in-DB writer (`trg_parcel_propagate_to_property`) has always refused non-positive values, and the
  only in-repo signal writer reads `parcel_records`, which holds 40 zeros against 8,700 properties.
  **Say "unattributed", not "written by X".** What is established: no trustworthy leg has ever
  emitted a zero (0 across 287 CoStar tax + 932 CoStar parcel rows).
- **Verification is the RE-CONTAMINATION check, not the backfill count** (Class 8): the producers
  run daily and their fix ships on the next deploy, so the number that matters is whether a zero or
  a `false` REAPPEARS after the next producer run — not that the columns read clean today.

Two writers put it there, neither recording provenance: `Dialysis/src/sync_properties_from_sources.py`
(tax fields, latest `tax_year`) and `trg_parcel_propagate_to_property` (physical stats, fill-blanks).
**So the physical-stats damage is negligible and the tax/assessed damage is ~8,800 properties.**

⚠️ **`dia.properties.tax_delinquent` is `false` on 11,802 of 11,802.** `write_tax_record` had
`bool(data.get("is_delinquent"))`, and **`bool(None)` is `False`** — so "the source did not say"
was recorded as "this property is not tax-delinquent", on every property in the portfolio. Fixed
tri-state. This is P139's constant-wearing-a-value-expression's-clothes, asserting a negative
finding rather than a rank.

### What shipped instead — marker before verdict

- **Producer provenance stamp**, both domains. `raw_payload.source` now records the acquisition
  path (`ai_gpt4o` / `ai_recall_gpt` vs `regrid`), and the Regrid overlay also records
  `source_fields` — the merged parcel is genuinely mixed, so a bare `source='regrid'` would
  overclaim the fields gpt-4o filled in. ⚠️ **The stamp is EXCLUDED from `data_hash` on dia**
  (`payload_for_hash`): the hash is the upsert conflict key, so folding provenance into it would
  give every existing row a new hash and **re-insert the entire table as duplicates**. Proven
  hash-stable with a positive control. gov is hash-safe by construction (`_md5` over explicit key
  fields) and already had the `raw_payload["source_origin"]` precedent.
- **`{dia,gov}_public_record_acquisition_class()`** — one IMMUTABLE owner of "which path produced
  this row". `ai_gpt4o_presumed` is a **distinct value** from the forward stamp, so a measurement is
  never quietly reported as a stamp.
- **`v_{dia,gov}_public_record_acquisition`** — lane composition. Read `trustworthy_source`, never
  `rows_total`, which is dominated by the model leg.
- **`v_dia_curated_field_ai_provenance`** — the contamination surface above. It is **value
  equality against the linked record, not a writer attribution**, and says so.
- **Guards.** `Dialysis/tests/test_pr1_public_record_provenance.py` (10 tests, **10/10 mutations
  RED**) and `life-command-center/test/public-records-lane-not-wired.test.mjs` (3 tests, **3/3
  RED**). Both strip comments first — this page and the fix's own comments name `county_records`
  and every removed expression, so a raw grep would match the explanation and pass over a
  regression.

### ⚠️ The trap that would have hidden a wiring either way — CLOSED by PR8 (2026-09-02)

**The trap as it stood.** `lcc_flush_provenance_events()` carried
`v_first_class := ARRAY['splink_v1','sf_link_review_human','splink_v2','sf_account_contact_expansion']`
and **relabelled every event whose source was not on it to `domain_trigger`**. So emitting
`source='county_records'` into `provenance_event_log` landed in `field_provenance` as
`domain_trigger` — **at a rung that does not exist for these fields** — while a verification
querying `field_provenance where source='county_records'` **still read zero**.

✅ **`domain_trigger` DECOMPOSED 2026-09-02 — the original source name survives in `source_run_id`**
(`v_src || ':evt' || id`), so the relabel is recoverable without touching the append-only table.
Live: **17,371 rows, and 17,371 of 17,371 carry a `:evt` run id** — i.e. *every* row wearing that
name is a relabel. `agency_classifier` **17,277** (gov `government_type` on four tables, last write
2026-09-02 — LIVE) + `qa22_davita_brand_canonicalize` **94** (one-shot, 2026-07-30).

✅ **PR8 SHIPPED 2026-09-02** (`supabase/migrations/20261007120000_lcc_pr8_provenance_relabel_registration.sql`,
applied live to LCC Opps). The literal is gone: **a `field_source_priority` row for THIS
(table, field, source) IS the allowlist**; anything unregistered still merges as `domain_trigger`,
which is the honest fallback for an unranked writer and what keeps `v_field_provenance_unranked`
meaningful. `agency_classifier` is registered at the four rungs it writes, **@90 — the rung its rows
already merged at**, so the outcome is unchanged and only the name is corrected.
`v_field_provenance_effective_source` exposes the recovered name; **`field_provenance` is not
rewritten.** Guards: `test/provenance-relabel-registration.test.mjs` (7 tests) +
`test/public-records-lane-not-wired.test.mjs` (3), **13/13 mutations RED.**

- **⚠️ REMOVING THE RELABEL *ARMS* EVERY REGISTERED SOURCE, AND ONE OF THEM MUST NOT BE ARMED.**
  This is the consequence the PR8 brief did not name, and it inverts the note above. Under the old
  code a `county_records` event merged as `domain_trigger`, which has **no rung for those fields**,
  so `lcc_merge_field` could at most `unregistered_source_filling_blank` — it could never override.
  Under "the registry is the allowlist" it merges at **county_records@5**, above `salesforce`@20,
  `om_extraction`(25–50) and every sidebar(45–65), and **overrides real evidence**. The relabel was
  the only structural thing keeping a model-generated source off the ladder; nothing else was.
  So the refusal is now **EXPLICIT** — `v_never_first_class text[] := ARRAY['county_records']` —
  rather than an accident of a four-item literal. **That is a preservation of PR1's decision, not an
  addition to any allowlist.** Retire the entry only together with a real acquisition path
  (`REGRID_API_KEY` → `regrid_client.py`, **PR1d**), never as plumbing. Positive-controlled live in a
  rolled-back transaction, 0 residue: a synthetic `county_records` event still stores
  `source='domain_trigger'`, while `qa22_…` and `agency_classifier` keep their own names and an
  unregistered writer falls back.
- **⚠️ THE OBVIOUS RECOVERY EXPRESSION IS WRONG AND RETURNS A PLAUSIBLE NUMBER.**
  `coalesce(nullif(split_part(source_run_id,':evt',1),''), source)` — the form this page previously
  prescribed — **is unguarded: `split_part` returns the WHOLE string when the delimiter is absent,
  and it is absent on 943,916 of the 1,263,825 rows.** Measured, it **invents 9,950 source names
  that do not exist**, and re-keying PR5's write-but-unregistered arm on it returns **9,951 instead
  of 21**. The correct form requires the full shape:
  `case when source_run_id ~ '^.+:evt[0-9]+$' then split_part(source_run_id,':evt',1) else source end`.
  Same family as the P157 `reloptions` and P182 deparse traps — a predicate structurally unable to
  express the question answers with a plausible number instead of an error. **Both recovery sites in
  the view carry their own guard, and the test counts them**: a ±300-char proximity check read the
  neighbour's guard and let a dropped one survive (found by the mutation pass, not by reading it).
- **⚠️ "THE 39 IS 38" IS WRONG — IT IS STILL 39, AND THE REASON IS THE FINDING.** `qa22_…` leaves
  the never-written set, and **`domain_trigger` enters it**: all 17,371 of its rows are relabels, so
  under the effective source **nothing has ever actually been `domain_trigger`** — a registered
  source with 6 rungs that no producer is. PR5 re-keyed and post-registration:
  **68 registered · 39 never written · 21 write-but-unregistered** (back to the original benign
  `cleanup_run_*` set, because `agency_classifier` is now registered).
  ⚠️ Keyed on the RAW `source` the never-written count reads **40** until the next flush writes an
  `agency_classifier` row under its own name — **that new row, not today's count, is what proves the
  producer is fixed** (Class 8).
- **⚠️ `v_field_provenance_unranked` is 22, not the 35 quoted in `CLAUDE.md`** — it is a 30-day
  rolling window, so it moves. Unchanged at **22 → 22** across this migration, which is the point:
  registering `agency_classifier` is load-bearing, not cosmetic. Without it, new rows would start
  arriving under an unregistered name and the drift detector would light up.
- **The producer was read, not assumed.** gov `sql/20260601_gov_type_3tier_classification.sql` ::
  `gov_classify_agency()` is a pure `STABLE` plpgsql rule engine over the curated
  `government_agencies` lookup and `agency_enrichment_rules` patterns — **no HTTP, no `pg_net`, no
  model, no external call of any kind** — and its trigger only classifies when no value exists
  (fill-blanks). It is a defensible source, unlike this lane's producer.
- **⚠️ Filed, not decided: `agency_classifier` is ranked 90 in LCC `field_source_priority` and
  `authority_rank` 30 in gov's own `field_value_provenance`.** Two ladders disagreeing about one
  source is a real question; a re-rank changes which writes WIN and needs its own before/after.
  → backlog **PR10**.
- **⚠️ The residual, sized rather than papered over.** During the transition a record's newest
  `write` row is still labelled `domain_trigger`. If `agency_classifier` re-classified that record to
  a **different** value, the ladder would see two sources at equal priority 90 and record `conflict`
  where it previously recorded `same_source_refresh_newest_wins` → write. Measured over the
  producer's whole history: **17,277 events, 309 keys re-written (1,352 events), 0 keys have ever
  changed value.** The path is real and has never once been exercised; it self-clears as each
  record's newest row takes the new name. That is the reason to register at 90 rather than a new rung.
- **Before/after, one session, two self-rolling-back transactions over the same live state**
  (1,521-event stratified replay, 150 per combo, covering all 15 live (source, table, field) combos):
  **predicted 5 combos change SOURCE and 0 decisions change; actual exactly that** — every decision
  count byte-identical, including `dia.properties|tenant|skip=1` and
  `gov.property_agencies|government_type|superseded=106`. Decisions are identical because
  `lcc_merge_field` tests `same_priority_same_value_refresh` **before**
  `same_source_refresh_newest_wins`.
- **Not done, deliberately:** no rung for `gov.properties.agency_canonical` (`agency_classifier` has
  written **0** rows to it — the 2 events there are `qa24_`/`qa30_canonicalize_agency` and both were
  skipped as markers; a rung nobody can exercise is **PR7**'s class). The `domain_trigger` rungs are
  **kept**. `lcc_merge_field` is untouched.

### ✅ 2026-09-02 — PR5 SHIPPED: the 39 are triaged, and 25 of them are not defects

`docs/audits/PR5_LADDER_SOURCE_TRIAGE_2026-09-02.md`; migration
`20261009120000_lcc_pr5_ladder_source_triage.sql` (applied live); guard
`test/pr5-ladder-source-triage.test.mjs` (13 tests, **15/15 mutations RED**); operator check
`scripts/check-field-source-priority-columns.mjs`.

| verdict | sources | rungs |
|---|---:|---:|
| `build_pending` | 9 | 209 |
| `refused_by_decision` (`county_records`) | 1 | 93 |
| **`retire`** | **14** | 42 |
| `writer_live_zero_rows` | 6 | 30 |
| `exercised_elsewhere` | 7 | 11 |
| `retired_by_decision` (`gliner_extract`) | 1 | 9 |
| `keep_structural` (`domain_trigger`) | 1 | 6 |

Every verdict + its evidence is stamped into `field_source_priority.notes` and surfaced on
**`v_field_source_priority_triage`** (426 rungs verdicted, 49 marked `PR7:orphan_column`,
51 retired). Counts after: **69 registered · 39 never written · 21 write-but-unregistered ·
`v_field_provenance_unranked` 30 → 29.**

- 🚨 **SEVEN OF THE 39 ARE LIVE ON A SECOND LADDER.** `manual`, `rel_purchase`, `rel_owns`,
  `sf_seller`, `domain_true_owner`, `gov_ownership_transition` are the property-owner authority
  ladder on `lcc.lcc_property_owner` — **15,052 rows in `lcc_property_owner_evidence`, and
  `domain_true_owner` wrote the day of the audit.** They are scored by
  `lcc_reconcile_property_owner`, which emits no `field_provenance`. The seventh,
  `property_sale_events`, is B6c-dup's gov trigger writing gov's own `field_value_provenance`.
  **A detector keyed on ONE ledger reports a second ledger's whole population as absent** — PR10 at
  seven times the size, and the P197 shape.
- 🚨 **`field_provenance` has never run on ANY LCC-internal table**: `entities` (13 rungs),
  `entity_relationships` (2), `lcc.lcc_property_owner` (6), `lcc.lcc_entity_portfolio_facts` (2),
  `public.lcc_cre_properties` (7), `public.lcc_cre_property_documents` (3) — **33 rungs, 0 rows**,
  with live `lcc_merge_field` call sites on four of the six. → **PR5c**.
- **⚠️ THE BRIEF'S PREDICTED REVERSE-ARM DELTA (21 → 20) WAS WRONG AND STAYED 21.**
  `costar_sidebar` is a REGISTERED source (73 rungs), so it never appeared in a source-grain arm.
  The `gov.properties.government_type` gap exists only at **(table, field, source)** grain — and
  there it is **1 of 30**, not 1 of 1. **A detector's grain decides what it can see**; the other 29
  are **PR5a**.
- **The one registration: `costar_sidebar` → `gov.properties.government_type` @95, BELOW
  `agency_classifier`@90.** Measured first: the classifier holds the value on 6,564 of 6,581
  records and the sidebar has **never once overridden it** (38 of 38 attempts skipped
  `unregistered_source_with_existing_value`). Deliberately below costar_sidebar's own
  `gov.properties` family (45–70) — a per-field call. **Paired with `agency_classifier`: if PR10
  re-ranks that source, this rung moves in the same change** (stated in the stored `notes`).
- 🚨 **YOU CANNOT REGISTER OR DE-REGISTER A SOURCE WITHOUT CHANGING BEHAVIOUR — "unregistered" is
  not a rung, it is a DIFFERENT BRANCH of `lcc_merge_field`** (may fill a blank, may never override,
  and is itself overridable by anyone via `replacing_unregistered_source`). A **72-combination
  replay**, run twice in one rolled-back transaction, measured **four** decision classes changing
  from that single registration — predicted = actual, total live exposure **17 records**. One of
  them (**class A**) is a real loss of blank-filling, 0 records today, because once both priorities
  are known the function never consults the null again. **This is why nothing is deleted:** pruning
  a "dead" rung is not neutral.
- **⚠️ PR7 IS 19 ORPHAN PAIRS / 49 RUNGS, NOT 1 — AND ONLY ONE IS LIVE.** Split by *when the writes
  stopped*: **LIVE** `gov.properties.recorded_owner_name` (448 rows, **28 in 30 days**);
  **STOPPED** `gov.sales_transactions.buyer_name` (7,916) / `.seller_name` (6,039) /
  `.procuring_broker` (33) all ending 2026-07-14..29, `gov.properties.tenant` + `.parcel_number`
  ending 2026-04-28; **NEVER** the remaining 13. The gov `buyer_name`/`seller_name` residue is
  **closed at source** — the gov branch was corrected to write `buyer`/`seller`, which run to
  2026-09-02. **13,955 rows that read as live drift are historical, and only the dates say so.**
  `dia.recorded_owners.sf_company_id` is on the **wrong table** (`dia.true_owners` has it).
- **⚠️ A LOGICAL PREFIX IS NOT A SCHEMA.** `to_regclass('lcc.lcc_property_owner')` is NULL because
  `lcc.` is a logical database prefix like `dia.`/`gov.`. The tables with no physical counterpart
  are `comp_provenance`, `comparable_sales`, `deal_provenance`, `listing_provenance` and bare
  `properties` — **526,192 provenance rows** between them, Salesforce-side logical namespaces.
  Reading the prefix as a schema flags six healthy tables and misses five real ones (Class 11).
- **⚠️ Anchor a parse on a token, never an offset.** The triage view's first cut used
  `split_part(notes,'PR5:',2)` and silently returned NULL for the 26 rungs the PR7 marker stamps in
  front — **400 verdicted before the regex, 426 after**, with `county_records` reading 92 of its 93.
- **PR9 stated, not decided:** all **673** `manual_verify` rows are one thing — a human confirming a
  clinic↔property LINK (`dia.medicare_clinics.property_id` 339, `dia.properties.medicare_id` 334).
  It competes with the `auto_link_*` family, **never with `manual_edit`**, and has never asserted a
  value. 👤 The question is whether a human-confirmed link should outrank an automated one — not the
  comparison the row was filed under.
- **⚠️ Six `writer_live_zero_rows` sources have a correct `lcc_merge_field` call site wrapped in
  `catch (_e) { /* best-effort */ }`**, so their zero **cannot distinguish "never ran" from "ran and
  the stamp was dropped"** — the **PR12** mechanism. Size PR12 before grading them.
- **`costar_cmbs_loan` holds 121 rungs — the largest single source in the ladder — for a capture arm
  that has never produced a row** (`loans.data_source` carries none on either domain). → **PR5d**.

### The corrected sequence

**source → verdict → consumer → cron.** The lane's real acquisition path already exists and is
**one environment variable away**: `src/regrid_client.py` is a complete Regrid Parcels API client
(a genuine assessor-data vendor, free tier 1,000 calls/day) that plugs in *ahead of* the GPT
fallback and is gated on **`REGRID_API_KEY`**. Set the key, let it populate, confirm
`v_dia_public_record_acquisition` shows a `regrid` class with real non-round values — **then** build
the consumer against `trustworthy_source` rows only. Building it first writes generated numbers into
the highest non-manual rung in the system.

⚠️ **Do not "fix" this by deleting the GPT fallback in the same change** — it is the only thing
writing these tables today, and removing it silently empties a lane several surfaces read. Gate it,
measure, then retire.

## 3. The three real gaps, in priority order

1. ~~⭐ **No reconciliation consumer.**~~ **SUPERSEDED BY §2a — this was the wrong remedy and the
   reasoning that produced it was wrong in a specific, transferable way.** *"It needs no new
   acquisition"* was true and was exactly the problem: **no new acquisition means the values are
   whatever the current producer emits, and the current producer is gpt-4o.** The gap is not the
   evaluator, it is the **source**. Scott's "later code evaluates to find the most accurate
   representation per field" is right and still the goal — it just cannot be served by a lane whose
   inputs are generated. **The real first gap is `REGRID_API_KEY`.**
2. ~~**The parcel leg is thin where the tax leg is strong** — 908 properties vs 9,107 … the tax
   fetcher demonstrably reaches 77%.~~ ⚠️ **REFUTED 2026-09-02 — that 77% was the gpt-4o leg
   (APN-less rows), see §2's split table. The real gap: the CoStar sidebar is the ONLY genuine
   public-record source in dia (883 properties, 931 real APNs) and its `parcel_records` rows carry
   ZERO building stats although the captured page has them.** → **PR2** (re-scoped: the sidebar
   writer), **PR11** (quarantine the APN-less rows).
3. **`confidence` and `verified` carry no information** — `confidence = 1.000` on all 23,728 rows
   and `verified = false` on every one. A constant is not a signal (the P139 lesson: a rank term
   that is a hard-coded constant reads like a value expression). Either populate it per record type
   and match quality, or stop presenting it as a confidence.

## 4. Design constraints, already paid for

- ⚠️ **Never an LLM recalling a parcel fact.** The retired `assessor_enrichment.py` had **no county
  HTTP call at all** — its one external request asked gpt-4o to recall parcel facts, which is
  fabrication by construction. A real lane fetches a record and stores `raw_payload` + `data_hash`;
  those columns already exist on all three tables. See `CLAUDE.md` → *Data-write discipline*.
- ⚠️ **I12 — acres vs square feet.** `parcel_records` carries `lot_sf`; `dia.properties` carries
  **both `land_area` (acres) and `lot_sf`**, with 3,702 paired rows and **0 equal**. Any
  reconciliation must write **one** and derive the other, not populate whichever the source happened
  to express. ✅ **The `sidebar-pipeline.js` hazard is CLOSED (PR2, 2026-09-02) and it was WORSE
  than "same hazard": CoStar's dominant lot-size format `"1.00 (43,560 sf)"` was being read as
  **1 square foot**, on 68% of captures. `lot_sf` and `land_area` now come from one
  `parseLotSize` call that reads the unit rather than the leading number.**
  - ⚠️ **Re-measured 2026-09-01: the disagreement is 213 rows (5.8%), not 27.** At a 0.1% relative
    tolerance 3,489 of 3,702 sit at the 43,560 ratio and **213 do not**; on a strict ±1 absolute
    test it is 300. **The "27 genuine disagreements (0.8%)" figure in circulation does not
    reproduce** — quote the tolerance with the count, because the two tests differ by 40%.
  - 🔴 **And there is a LIVE function carrying the I12 bug: `dia_county_digest_property` writes
    `v_parcel.lot_sf` — square feet — into `properties.land_area`, which is acres**, and never
    writes `lot_sf` at all. It has **never run** (`county_propagation_log` is empty on dia), which
    is the only reason it has done no damage; gov's copy ran once on 2026-06-20 and wrote 64
    `assessed_value` rows. The sibling `trg_parcel_propagate_to_property` trigger gets the units
    **right** — so two writers on one field disagree about its unit. Backlog **PR6**. Do not fix it
    by scheduling the digest.
- **Fill-blanks and priority-gated**, per the standing ladder — `county_records`@5 outranks
  `om_extraction` and the sidebars, so it may legitimately supersede them; it must not overwrite
  `manual`@1 or `recorded_deed`@3.
- **A sold property is in scope.** Its assessor record is ownership history, sale evidence and
  physical stats. **Do not gate this lane on listing status** — that gate is what produced the wrong
  verdict in §0.

## 5. What is NOT the answer here

Measured 2026-09-01 and refuted **as ways to fill these fields** — they remain refuted, and they were
always a different question from the source lane:

- **Ollama over documents we already hold** — 9 of 662 queue properties have usable document text.
  There is no corpus. P131 case (b) is empty.
- **Sidebar deliberate lookup as a backfill** — the extension already extracts `year_built`,
  `square_footage` and `lot_size` correctly; the gap rows have **neither** column, i.e. were never
  captured. Absence of capture, not a mapping loss.

**Neither refutation touches the public-records lane**, which acquires from a different source
entirely and is already 78% linked. ⚠️ **But §2a does**: "acquires from a different source entirely"
was the assumption, and it is false — the lane acquires from **gpt-4o**, which is the same
fabrication class as the refuted options above, wearing a source's name. The 78% link coverage is
real; what is linked is mostly generated.

## 6. Where else to look

| for | read |
|---|---|
| the queue-scoped view (⚠️ carries the superseded verdict) | `docs/architecture/property-metadata-coverage.md` |
| the invariants this serves | `docs/architecture/data-coherence-invariants.md` — **I1**, **I5**, **I7**, **I12** |
| the ladder mechanics | `docs/architecture/data_quality_self_learning_loop.md` |
| open rows | `docs/os/PLANNED-BACKLOG.md` — `PR1`–`PR4` |
| the fabrication doctrine | `CLAUDE.md` → *Data-write discipline* |
