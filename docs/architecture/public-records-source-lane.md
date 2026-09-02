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
| **tax** | 25,621 | **9,107** | **77%** | live, fetched 2026-08-31 |
| **parcel** | 1,604 | 908 | 7.7% | live, fetched 2026-08-31 |
| **deed** (dia) | 178 | — | — | live, fetched 2026-08-31 |
| mortgage | 171 | 135 | 1.1% | **dead since 2026-05-10** |
| entity | 153 | 124 | 1.0% | **dead since 2026-05-10** |

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

### ⚠️ The trap that would have hidden a wiring either way

`lcc_flush_provenance_events()` carries `v_first_class := ARRAY['splink_v1','sf_link_review_human',
'splink_v2','sf_account_contact_expansion']` and **relabels every event whose source is not on it to
`domain_trigger`**. So emitting `source='county_records'` into `provenance_event_log` today would
land in `field_provenance` as `domain_trigger` — **at a rung that does not exist for these fields** —
while a verification querying `field_provenance where source='county_records'` **still read zero**.
Keeping `county_records` off that allowlist is the correct state; adding it is a deliberate act that
belongs with a real acquisition path, never as plumbing. Pinned by the LCC guard.

✅ **`domain_trigger` DECOMPOSED 2026-09-02 — the original source name survives in
`source_run_id`** (`v_src || ':evt' || id`), so the relabel is recoverable without touching the
append-only table. Live: **17,371 rows = `agency_classifier` 17,277** (gov `government_type` on
four tables, still writing today) **+ `qa22_davita_brand_canonicalize` 94** (one-shot, 2026-07-30).
⚠️ **`agency_classifier` is not registered in `field_source_priority` at all** — a write-but-
unregistered source PR5's reverse arm could not see, because it wears `domain_trigger`'s name. And
`qa22_…` *is* registered and sits in PR5's "39 never written" while 94 of its rows exist under the
wrong label. **PR5's detector must key on `coalesce(split_part(source_run_id,':evt',1), source)`,
and the 39 is 38.** → backlog **PR8** (build: registered-for-this-field ⇒ own name; an append-only
effective-source view; never a rewrite).

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
2. **The parcel leg is thin where the tax leg is strong** — 908 properties vs 9,107, and **only 41
   `parcel_records` rows carry `year_built` / `building_sf` / `lot_sf`** (670 carry `owner_name`).
   ⚠️ **The right question is not "can we reach county assessors" — the tax fetcher demonstrably
   reaches 77%.** It is *why does the same live producer return tax rows for 9,107 properties and
   parcel stats for 41?* Investigate the fetcher, do not assume acquisition.
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
  to express. Same hazard live at `sidebar-pipeline.js` ~4597.
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
