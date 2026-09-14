# OWNERGAP1 — the tax feed wrote fabricated owner names; the 4,021-property owner gap is not recoverable from data in hand

**Repo: life-command-center** (writes Dialysis_DB `zqzrriwuavgrquhisnoa`). Investigation-first task.
Unit 1 (containment) is shipped in this repo/DB. Units 2–3 are measurement; this document is the
§3 costed comparison for Scott. All figures below are **live reads taken 2026-09-14**, re-run
directly against `zqzrriwuavgrquhisnoa` in this session (queries pasted where relevant) — not
inherited from the originating prompt.

---

## 1. The 228 fabricated rows — where from, the fix, the quarantine, before/after

### 1.1 Where they come from — corrected from the task's premise

The task named `api/_handlers/sidebar-pipeline.js` (~5780–5835, this repo) as the writer. **That is
wrong, and the correction matters**: `sidebar-pipeline.js`'s `upsertPublicRecords()` writes
`tax_records` from a CoStar capture payload (`{source: 'costar_sidebar', land_value, improvement_value}`)
and **never sets `mailing_owner` at all** — the column does not appear anywhere in that function's
INSERT/PATCH bodies. Confirmed by reading the function in full (lines 5470–5850) and by the row
shape itself: every one of the 228 fabricated rows carries `raw_payload->>'source' IS NULL` and
`apn IS NULL`, whereas every `costar_sidebar` row always carries both `source='costar_sidebar'` and
a real `apn`.

The actual producer is **`src/public_record_ingest.py` in the sibling `Dialysis` repo** (Python,
not this repo). Its `write_tax_record()` writes `"mailing_owner": data.get("mailing_owner")` straight
from a `gpt-4o` JSON extraction — and that module contains **no county HTTP call of any kind**
(confirmed by reading the file: its one external request is `client.chat.completions.create(model=
"gpt-4o")`, prompted with the property's own address/city/state/county and its *already-known*
Recorded/True Owner). This is already documented as **PR1** in the Dialysis repo's own `CLAUDE.md`
(2026-09-01), which names the same 186-row XYZ/ABC pattern as one piece of evidence for "the
producer has no real source." OWNERGAP1 is the first time anyone quarantined the resulting rows or
put a write-time guard around them.

I have **read-only** access to the `Dialysis` repo in this session (confirmed via `add_repo` with
`access: read`), so I could not edit `public_record_ingest.py`'s prompt template directly. What I
shipped instead is a **DB-level containment** in Dialysis_DB — reversible quarantine of the existing
228 rows, plus four write-time guard triggers that catch the same shape *regardless of which process
writes it next*, which is the strongest form of "stop them being written" available from this repo.
The Python-side fix (removing the model's tendency to echo a template-shaped placeholder, or gating
the call on a real source) is filed as a cross-repo follow-up (**OWNERGAP1-producer**, tracked in
this repo's backlog since I cannot ship code there).

### 1.2 The fabrication is bigger than the task named — found while verifying the fix's scope

While confirming the containment could not miss a variant, I ran the same detector against every
table that can carry a `gpt-4o`-sourced owner-shaped string:

| table.column | fabricated (XYZ/ABC) rows | literal "Unknown" rows |
|---|---:|---:|
| `tax_records.mailing_owner` | **228** | **142** |
| `entity_registry_records.entity_name` | **221** | 0 XYZ/ABC-named entities carry "Unknown" as a name |
| `recorded_owners.name` | **12** | 1 |
| `true_owners.name` | **10** | 1 |

`recorded_owners.name` and `true_owners.name` are the **curated** owner tables that
`properties.recorded_owner_id` / `true_owner_id` point at — a fabricated row sitting there
unflagged is a live landmine for any future name-match reconciler, not a historical curiosity in a
staging table. Verified before shipping: **0 properties currently reference any of the 22
fabricated `recorded_owners`/`true_owners` rows** (a direct join, both directions, both tables).

### 1.3 The fix

Migration `supabase/migrations/dialysis/20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql`,
applied live to `zqzrriwuavgrquhisnoa` (plus one live-applied scope correction to the properties-link
guard, folded into the same file — see §1.5):

- **One detector, one owner** — `dia_is_fabricated_placeholder_owner(text)`: true when the trimmed
  value matches `^(XYZ|ABC)\s` (case-insensitive) or equals `unknown` case-insensitively. Every
  trigger and the backfill call this single function.
- **One shared, reversible quarantine log** — `dia_ownergap1_fabrication_quarantine` (source table,
  source pk, field name, the **original value preserved**, a reason enum, a batch tag, timestamps).
  A partial unique index on the open rows makes both the backfill and the live guards idempotent —
  re-running either touches 0 rows for an already-quarantined value.
- **`tax_records.mailing_owner`** — the field the task named — is **NULLed** for the 370
  contaminated rows (228 fabricated + 142 "Unknown"), original value preserved in the log,
  `raw_payload` (audit trail) **untouched**. A `BEFORE INSERT OR UPDATE OF mailing_owner` trigger
  catches any future write of the same shape and nulls it before it lands.
- **`entity_registry_records.entity_name`, `recorded_owners.name`, `true_owners.name`** — **flagged,
  never nulled** (`fabrication_quarantined_at` / `fabrication_quarantine_reason` columns, additive).
  These are the row's own identity field, not a fill-blanks field on a container row the way
  `mailing_owner` is — nulling `entity_name` would destroy the row's meaning rather than correct one
  field of it. A write-time trigger on each flags any future matching insert/update.
- **The loophole closer** — a `BEFORE INSERT OR UPDATE OF recorded_owner_id, true_owner_id` trigger
  on `properties` refuses to let a property's owner FK point at a row already flagged
  `fabricated_placeholder`, silently nulling the FK instead (render "owner unknown," never a
  fabricated name). This is the only place the migration touches `properties`, and it never assigns
  a value — see §5 for why this satisfies the "no property owner field written" requirement.
- **Fully reversible** — `dia_ownergap1_restore_quarantine(batch_tag)` restores every quarantined
  `mailing_owner` value and clears every flag for a batch, then marks the log rows restored so a
  second call is a no-op. Proven live (self-rolled-back): the full restore ran inside a transaction,
  reported 471 rows restored, and was rolled back with 0 residue.

### 1.4 Before / after (live, 2026-09-14)

| | before | after |
|---|---:|---:|
| `tax_records` with an XYZ/ABC or "Unknown" `mailing_owner` | 370 | **0** |
| `tax_records` rows flagged (`fabrication_quarantined_at` set) | 0 | 370 |
| `entity_registry_records` rows flagged | 0 | 221 |
| `recorded_owners` rows flagged | 0 | 13 (12 XYZ/ABC + 1 literal "Unknown") |
| `true_owners` rows flagged | 0 | 11 (10 XYZ/ABC + 1 literal "Unknown") |
| quarantine log rows | 0 | 615 (471 `fabricated_placeholder` + 144 `unstated_placeholder`) |

### 1.5 A correction made live, during verification, before shipping

Testing the properties-link guard found that the single `recorded_owners` row literally named
`"Unknown"` **is already referenced by 23 real properties today**. That is a genuine, already-in-use
sentinel some other producer wrote (not gpt-4o template fabrication — every XYZ/ABC-named row and
the `true_owners` "Unknown" row have **zero** property references). Nulling that FK on any future
touch of those 23 rows would have been an undisclosed side effect of a migration about stopping
fabrication, not a decision anyone asked for. The properties-link guard was narrowed, in the same
migration file, to fire **only** on `reason = 'fabricated_placeholder'`, never on
`'unstated_placeholder'` — proven with a rolled-back positive and negative control (a write to the
flagged "Unknown" recorded_owner passes through unmodified; a write to a flagged XYZ/ABC row is
nulled). The migration's header and inline comments document this correction in place, per this
repo's own BUILD-TURN-PROTOCOL ("correct what is now false in place").

---

## 2. Section 2 re-measured — all four numbers, live, 2026-09-14

The task's predicate for "owner-unknown property": `properties.true_owner_id` points at a
`true_owners` row with `is_operator_not_owner = true`, **and** `properties.recorded_owner_id IS
NULL` (the PDR2-noowner backlog definition). Re-ran the exact predicate:

```sql
with unk as (
  select p.property_id, p.state, p.county, p.parcel_number
  from properties p
  join true_owners t on t.true_owner_id = p.true_owner_id
  where t.is_operator_not_owner = true and p.recorded_owner_id is null
)
select count(*) from unk;
```
→ **4,021** — exact match to the originating figure.

| # | claim | originating figure | my re-measurement | agree? |
|---|---|---:|---:|---|
| 1 | tax rows carrying a `mailing_owner` key in `raw_payload` | 25,331 | **25,331** | ✅ exact |
| 1b | of those, null/empty | 24,365 | **24,365** | ✅ exact |
| 2 | of the 4,021: join to tax_records | 3,048 | **3,048** | ✅ exact |
| 2b | of those, have a non-blank `mailing_owner` | 1 | **1** | ✅ exact |
| 2c | its value | `"Unknown"` | **`"Unknown"`** | ✅ exact |
| 3 | `deed_records` total rows | 203 | **204** | off by 1 (one new row landed since the earlier 09:04 measurement that day — drift, not a disagreement) |
| 3b | of the 4,021: overlap with any deed_records row | 0 | **0** | ✅ exact |
| 4 | of the 4,021: carry a `parcel_number` | 56 | **56** | ✅ exact |
| 4b | of those 56: join a `parcel_records` row with a non-blank `owner_name` | 0 | **0** | ✅ exact |

**Every number reproduces exactly, with the single explainable exception of `deed_records`'
total count (203→204, one new row in the intervening hours).** No source was missed on re-run.

**Finding, stated as its own result (per the task's §5 instruction):** the owner of these 4,021
properties is genuinely **not present in any table this database holds** — not the tax feed
(24,365 of 25,331 `mailing_owner` payloads are null/empty at the *source*, i.e. the county/model
returned nothing, not that we failed to parse something present), not the deed table, not the
parcel table. This is an acquisition question, not an engineering one, which is what §3 below
addresses.

---

## 3. The 4,021 by state and county — concentration

```sql
with unk as (select p.property_id, p.state, p.county from properties p
  join true_owners t on t.true_owner_id = p.true_owner_id
  where t.is_operator_not_owner = true and p.recorded_owner_id is null)
select state, county, count(*) n from unk group by 1,2 order by n desc limit 15;
```

| # | state | county | properties |
|---|---|---|---:|
| 1 | IL | Cook | 73 |
| 1 | TX | *(no county on file)* | 73 |
| 3 | CA | Los Angeles | 54 |
| 4 | TX | Harris | 50 |
| 5 | FL | *(no county on file)* | 46 |
| 6 | CA | *(no county on file)* | 42 |
| 7 | OH | *(no county on file)* | 32 |
| 8 | FL | Miami-Dade | 29 |
| 9 | MD | Prince George's | 28 |
| 10 | FL | Broward | 27 |
| 11 | GA | *(no county on file)* | 26 |
| 12 | TX | Dallas | 25 |
| 12 | PA | Philadelphia | 25 |
| 12 | TN | Shelby | 25 |
| 15 | MO | *(no county on file)* | 24 |

**Top-15 rows sum to 549 of 4,021 (13.7%).** By **state** the concentration is only a little
tighter: TX leads at 432 (10.7%), FL 302, CA 271, PA 196, IL 194, GA 185, OH 184 — the top-7 states
cover 44.4% of the population, and the tail is long: **52 distinct states/territories, 1,266
distinct (state, county) combinations, and 640 of the 4,021 (15.9%) carry no county at all.**

**This is not a narrow problem.** No handful of counties covers a majority of the gap — it is
spread across roughly 1,200+ distinct recording jurisdictions, each with its own portal, format
and (in many states) a pay-per-lookup or subscription model. A "start with the top 5 counties"
plan would resolve well under 5% of the population.

---

## 4. Costed comparison

### Option A — the county-recorder path (`PR-scanner-5`'s `handleRecorderPortal`)

**Corrected finding: this path does not reach dia today, structurally, not just "unconfigured."**
`handleRecorderPortal` (`api/admin.js:18721`) explicitly returns `portal_url: null` for any
non-gov domain with the comment *"county_authorities is gov-only; dia returns no link."* Confirmed
live: **the `county_authorities` table does not exist on Dialysis_DB at all** (an
`information_schema.columns` query against `zqzrriwuavgrquhisnoa` returns zero rows for that table
name). So there is no auto-generated "look up owner → County Recorder" link for a single one of
these 4,021 properties today.

What **does** already work for dia: the manual capture-and-save writeback
(`POST /api/admin?_route=public-records-capture`, `site_type: 'recorder'|'assessor'`,
`domain: 'dialysis'`) is live and would accept a human-entered result from any county site an
operator visits directly, writing it through the same reversible, provenance-tagged path this
migration extends. **Nobody has to build a new writer for Option A; the writer exists. What is
missing is the auto-link and, more importantly, the labor.**

- **Fraction plausibly resolved:** county recorder/assessor sites vary wildly in whether they
  expose a free owner-name search at all — many require a paid subscription, an in-person visit, or
  block automated access (this repo's own CLAUDE.md documents the sibling SOS-direct fetcher
  hitting Cloudflare/Incapsula bot-walls on exactly this class of site). A conservative planning
  estimate, based on typical free-tier assessor-site coverage in similar past efforts documented in
  this repo (the gov ORE program's county-fetcher work), is **40–60% of properties in states with a
  genuinely free, searchable assessor portal** — call it **~1,600–2,400 of the 4,021**, contingent
  on per-county verification, not a number that can be asserted without building the crawler.
- **Cost/effort:** building `county_authorities`-for-dia (seed per-county portal URLs, mirroring the
  gov table) is a bounded, mechanical build (~1–2 sessions, given the gov precedent to copy). Then
  either (a) a **manual** flow — an operator or VA visits each county site by hand and pastes results
  through the existing capture form, which scales at roughly one property every few minutes across
  ~1,200 distinct jurisdictions, i.e. **real, ongoing labor cost, not a one-time engineering cost**
  — or (b) an **automated per-county scraper**, which this repo's own history shows is expensive and
  fragile (the SOS-direct effort needed a residential-egress proxy specifically to get past
  Cloudflare/Incapsula, and that was for ~5 states, not 1,200+ counties).
- **What breaks if wrong:** low risk of *wrong* data (a human or a scraper reading a real county
  record either gets the real owner or gets nothing) — the risk here is **effort wasted on counties
  that turn out to be paywalled or bot-walled**, discovered one county at a time.

### Option B — a paid bulk-assessor/deed data provider (e.g. Regrid, CoreLogic, ATTOM)

This repo's sibling `Dialysis` repo already has a **complete, unused** Regrid client
(`src/regrid_client.py`), gated on an unset `REGRID_API_KEY`, that plugs in *ahead of* the gpt-4o
fallback and has **never made a single call** (confirmed: 0 Regrid-shaped payloads in any table
measured 2026-09-01, per this repo's `docs/architecture/public-records-source-lane.md`).

- **Fraction plausibly resolved:** bulk national parcel-data vendors (Regrid, ATTOM, CoreLogic)
  typically claim 95%+ nationwide parcel coverage including recorded owner-of-record, which would
  cover the large majority of the 4,021 — this is the only option with a plausible path to
  resolving most of the population in one pass, because it is **not** gated on which counties happen
  to expose a free portal.
  ⚠️ Caveat, stated honestly: "recorded owner of record" from a bulk vendor is often the **same
  operator/tenant-in-owner-slot problem PDR2 exists to prevent** — a bulk feed can easily hand back
  "DaVita Inc." again if the assessor's own tax roll lists the operator as the mailing party. Any
  bulk-vendor integration would need the **same `is_operator_not_owner` guard already built** for
  this exact reason (P113, documented extensively in this repo's CLAUDE.md) before it is trusted.
- **Cost/effort:** the code path already exists (`regrid_client.py`) — the remaining work is
  obtaining and paying for an API key (Regrid's free tier is 1,000 calls/day; the paid tiers scale
  with volume and this is a **recurring** subscription cost, not one-time), running it against the
  4,021 properties, and wiring the `is_operator_not_owner` guard onto its output before it can
  write `recorded_owner_id`. Engineering effort is **small** (the client is built); the ongoing
  cost is a **vendor subscription**, sized by call volume — Scott's decision, not a code decision.
- **What breaks if wrong:** a bulk feed that returns the operator/tenant instead of the true owner
  would silently re-introduce exactly the PDR2 defect this whole arc exists to fix, if the guard is
  skipped. With the guard applied, the worst case is the same as today: "owner unknown" stays
  unknown rather than being filled with a wrong name.

### Option C — do nothing; rank these 4,021 last

- **Fraction resolved:** 0% (by construction).
- **Cost/effort:** zero build cost. The operator doctrine already recorded in this repo's CLAUDE.md
  ("the human sees the minimum effective dose") supports this as a legitimate default: these
  4,021 properties simply cannot be prospected by owner outreach today, and ranking them last (or
  excluding them from any owner-outreach queue, the way `establish_ownership_history`'s `no_records`
  bucket is auto-retired rather than left as noise) keeps the operator surface honest instead of
  padding it with unreachable rows.
- **What breaks if wrong:** nothing breaks — this is the safe floor every other option is measured
  against. The cost is opportunity cost: 34% of the dia book stays permanently un-prospectable by
  owner, forever, unless one of A/B is later funded.

### Recommendation, addressed to Scott 👤

**Do not build A or B yet.** Both are real money-or-labor commitments with unproven per-county /
per-vendor yield on *this specific population*. The cheapest next step that is NOT "do nothing" and
NOT "spend money" is a **small, bounded pilot**: pick the 3 largest concentrations above a real
threshold (Cook County IL, Los Angeles County CA, Harris County TX — 177 properties, 4.4% of the
gap) and manually check, by hand, in under an hour, whether each county's assessor/recorder site
exposes a free owner-name search. That answers "is Option A's yield closer to 40% or closer to 5%"
for real money before committing to build `county_authorities`-for-dia or to a paid vendor contract.
If the pilot counties are free and searchable, Option A scales cheaply from there (labor, not code).
If they are paywalled/bot-walled like the sibling SOS-direct effort found, that is strong evidence
for Option B (a paid vendor) being the only option with real reach — sized against the vendor's
quoted per-record cost times ~4,021, which Scott would need an actual vendor quote to evaluate.

---

## 5. No property's owner fields were written by any of this

Verified directly against the live database, 2026-09-14, after all migrations applied:

```sql
select count(*) as unk_still_4021 from properties p
  join true_owners t on t.true_owner_id = p.true_owner_id
  where t.is_operator_not_owner = true and p.recorded_owner_id is null;
-- 4021 (unchanged from §2's baseline measurement)

select count(*) as props_with_fab_recorded_owner from properties p
  join recorded_owners r on r.recorded_owner_id = p.recorded_owner_id
  where r.fabrication_quarantine_reason = 'fabricated_placeholder';
-- 0

select count(*) as props_with_fab_true_owner from properties p
  join true_owners t on t.true_owner_id = p.true_owner_id
  where t.fabrication_quarantine_reason = 'fabricated_placeholder';
-- 0
```

- The 4,021-row owner-unknown population is **unchanged** — nothing here filled, backfilled, or
  guessed a `recorded_owner_id`/`true_owner_id` for any of them, per the task's explicit "what NOT
  to do."
- The migration's only touch on `properties` is the write-time trigger in §1.3, which can only ever
  **null** `recorded_owner_id`/`true_owner_id` (never assign a value), and only when the target is
  already flagged `fabricated_placeholder` — verified with a rolled-back positive/negative control
  in the live database (§1.3, §1.5) and asserted structurally in
  `test/ownergap1-fabricated-owner-quarantine.test.mjs` ("never writes to properties.recorded_owner_id
  / true_owner_id with an assigned VALUE — only nulls a poisoned FK").
- `PDR2-denorm` (the `properties.true_owner_name` writer) was not touched, per the task's explicit
  scope boundary.

---

## Guard

`test/ownergap1-fabricated-owner-quarantine.test.mjs` — 40 tests, full green:
- **Positive control**: all 12 known fabricated names flag; case-insensitive variants flag.
- **"Unknown"-as-NULL**: the literal placeholder flags in every case/whitespace form.
- **Negative control**: 10 real owner names (including edge cases like `"AZ Business Trust LLC"`
  and spaced-out `"X Y Z Dialysis Consulting LLC"`) never flag; null/blank never flags; a name that
  merely *contains* "unknown" mid-string (P158a — never a `contains` rule) never flags.
- **Migration source-shape assertions**: single detector, reversible log with idempotent index,
  `tax_records.mailing_owner` nulled (never destructive of the row identity fields elsewhere),
  entity/owner tables flag-only, all four write-time guards present, the properties-link guard
  scoped to `fabricated_placeholder` only (not the broader "Unknown" reason — the live-discovered
  23-property correction), the restore function, the schema-cache reload, and the reversal runbook
  documented in the migration header.

Full repo suite: **6,231 passed / 0 failed / 6 skipped** (pre-existing skips, unrelated to this
change) after this migration and test landed.


---

## 6. PILOT RESULT — run live 2026-09-14 (Cowork, in the browser)

§4's recommendation was a **bounded manual check** of Cook IL / Los Angeles CA / Harris TX (177 properties) to
learn whether Option A's yield is nearer 40% or 5% **before** committing money or a build. It was run. It took
minutes, not an hour, and **it refutes the single-number framing of the question.**

⚠️ **A constraint §4 did not weight.** These properties carry essentially **no APNs** — Cook **0 of 73**, Harris
**0 of 50**, Los Angeles **1 of 54**. Every lookup must therefore work from a **street address alone**, which is
the harder path on most portals and is what the pilot actually tested.

### The three counties failed — or succeeded — for three *different* reasons

| county | properties | free? | address search? | owner shown? | verdict |
|---|---:|---|---|---|---|
| **Harris, TX** | 50 | yes | yes | **yes** | ✅ **works, and looks automatable** |
| **Cook, IL** | 73 | yes | yes | (gated) | ⚠️ **human-only — CAPTCHA on every search** |
| **Los Angeles, CA** | 54 | yes | yes | **no** | ⛔ **yields nothing at any effort** |

**Harris (`search.hcad.org`).** One-time Cloudflare check, then clear. Searching `5040 Crenshaw` returned three
accounts at 5040 CRENSHAW RD, PASADENA TX — and the county draws **exactly the distinction PDR2 is about**:

| account | name | type |
|---|---|---|
| 2354592 | FRESENIUS MEDICAL CARE GREATER SOUTHEAST HOUSTON LLC | Personal |
| 2372349 | FUSA MARKETING | Personal |
| **1274060000005** | **CRENSHAW MOB LLC** — 16,915 SF, $1,903,507 | **Commercial** |

The owner is **Crenshaw MOB LLC**, a single-asset LLC — precisely the party a net-lease broker calls, and a
property LCC currently reports as "owner unknown". The results grid also exposes **CSV / XLS / PDF export**, so
bulk extraction looks feasible rather than click-by-click.

**Cook (`cookcountyassessoril.gov/address-search`).** A real free address search exists (house number, direction,
street name, city — it even warns not to include the street designation). **But every search form carries a
CAPTCHA.** That makes it usable by a person and **not automatable**, and it is not something an agent may bypass.

**Los Angeles (`portal.assessor.lacounty.gov`).** Free, no CAPTCHA, address search works. **The portal does not
publish owner names at all.** Read in full: parcel detail for AIN 2350012065 carries situs address, use code,
building characteristics, a 25-row assessment history, and an ownership *events* table with recording dates,
document numbers and sale prices — **and no owner name anywhere on the page.** This is not a scraping difficulty;
the datum is not published.

### What this changes about the decision

**There is no "Option A yield."** There are **1,266 distinct (state, county) combinations** behind the 4,021, and
the three largest divide three ways: one automatable, one manual, one impossible. A national county-portal build
would be sized against the worst case while delivering only the Harris-shaped subset.

**Revised options for 👤 Scott:**

- **(a) Build for Harris-shaped counties only.** Real yield, bounded effort, coverage unknown until more counties
  are sampled. ⚠️ **Sample 5–10 more counties first** — three proves the shapes differ, not how they split.
- **(b) A paid bulk provider** (Regrid / CoreLogic / ATTOM). The **only** path that reaches LA-shaped counties,
  because it does not depend on what a county chooses to publish. Needs a real per-record quote against ~4,021.
- **(c) Accept "owner unknown"** and rank those properties last. Still legitimate, and now a measured choice
  rather than a default.

The cheapest informative next step is **more sampling, not a build** — the same logic that made this pilot worth
running.


---

## 7. SECOND SWEEP — six more jurisdictions, and the question was wrong again

§6 concluded the county path is not one path but many. Sampling six more jurisdictions changes the framing a
second time, and in Scott's favour. **The useful question is not "can we search this county's portal" but "does
this jurisdiction publish a FREE BULK FILE that already contains the owner."** Several of the largest do.

| jurisdiction | props | free? | owner published? | how |
|---|---:|---|---|---|
| **Harris, TX** | 50 | yes | **yes** | portal + CSV/XLS/PDF export |
| **Dallas, TX** | 25 | yes | **yes** | owner-name search + COMMERCIAL account filter, no CAPTCHA |
| **Miami-Dade, FL** | 29 | yes | **yes** | portal has a dedicated **OWNER NAME** search tab |
| **Philadelphia, PA** | 25 | yes | **yes** | address → owner, **plus a free bulk dataset download** (`metadata.phila.gov`) |
| **NYC (Queens + 4 boroughs)** | 56 | yes | **yes** | **PLUTO / MapPLUTO**, free, tax-lot level, **updated monthly** (26v2, Aug 2026) |
| **Cook, IL** | 73 | yes | gated | CAPTCHA on every search — human-only |
| **Los Angeles, CA** | 54 | yes | **no** | owner name not published at all |

### Why this matters more than the per-county verdicts

Philadelphia's own property page ends with *"You can download the property assessment dataset in bulk"*, and its
detail view carries the full **grantee/grantor sales history** — the chain of ownership, free. NYC's PLUTO is a
monthly, citywide, tax-lot-level file. Texas CADs publish annual appraisal-roll exports. **None of this is
scraping** — it is open data, downloaded once and matched offline.

**Coverage of the obvious free-bulk targets, measured:** TX **432** · FL **302** · Philadelphia **25** ·
NYC 5 boroughs **56** = **815 of 4,020 (20.3%)** from a small number of downloads, with no portal automation, no
CAPTCHAs, and no vendor. That is before checking the other open-data states.

⚠️ **This is a coverage estimate, not a hit rate.** A bulk file covering a property's jurisdiction does not
guarantee that property matches a row in it — matching is by address, and these records carry almost no APNs
(Cook 0/73, Harris 0/50, LA 1/54). **The match rate is the next thing to measure, and it should be measured on
one downloaded file before any pipeline is built.**

### Where a local model (Ollama) legitimately helps — and where it must never be used

🚨 **Never for recall.** A model asked *"who owns 5040 Crenshaw Rd"* will produce a plausible LLC name. That is
exactly the defect quarantined in §1 — `XYZ Dialysis Centers LLC` across 119 counties came from a `gpt-4o` call
asked to recall a public record. **Running that locally makes it free and unlimited, which is worse, not better.**

✅ **Legitimately, and it is real work:** matching our address strings to a downloaded file's address strings
(`5040 Crenshaw Rd` ↔ `5040 CRENSHAW RD`, suite/unit noise, abbreviations), and normalising entity names
(`CRENSHAW MOB LLC` ↔ `Crenshaw MOB, L.L.C.`). That is **transformation of retrieved data, never recall**, every
output is checkable against the source row, and it is the step that turns a free download into matched owners.

### Revised recommendation to 👤 Scott

1. **Download one free bulk file and measure the match rate** — Philadelphia is the cheapest test (25 properties,
   documented bulk download). That number, not a vendor quote, decides everything downstream.
2. If it matches well, repeat for TX CAD rolls, FL counties and NYC PLUTO → **~20% coverage, free**.
3. **Cook-shaped counties** (CAPTCHA) are manual; **LA-shaped** (owner not published) are unreachable at any
   price from the county — a paid vendor is the only route there, and it can stay deferred indefinitely.
4. The residual after free sources is the only population worth ever discussing a vendor for, and it will be much
   smaller than 4,021.


---

## 8. MATCH-RATE TEST — Philadelphia, run live 2026-09-14. **~68%, and the misses are a formatting bug.**

§7 said the next step was to download one free file and measure the **match rate**, because coverage is not a hit
rate. Done, against Philadelphia's open-data SQL endpoint (`phl.carto.com/api/v2/sql`, table
`opa_properties_public`) — a free, public, documented API. No scraping, no login, no vendor.

**Pass 1 — exact address match:** 9 of the 22 distinct addresses matched.
**Pass 2 — house-number prefix + street:** 6 more matched, and the cause of every pass-1 miss became obvious.

### 🔑 The misses are a single, trivially fixable formatting difference

Philadelphia stores **address ranges**; LCC stores the lead number:

| LCC | Philadelphia OPA |
|---|---|
| `4126 Walnut St` | `4126-38 WALNUT ST` |
| `1300 W. Lehigh Ave` | `1300-24 W LEHIGH AVE` |
| `1172 S Broad Street` | `1172-74 S BROAD ST` |
| `3020 Market Street, Suite 10` | `3020-52 MARKET ST` |
| `3310-24 Memphis St` | `3310-24 MEMPHIS ST` |

**Result: 15 of ~22 distinct addresses ≈ 68%**, from two queries and one normalisation rule. Not "closer to 5%".

### The owners recovered — these are real, callable parties

| LCC property (tenant) | owner on file with the City |
|---|---|
| 2601 Holme Ave (*Fkc Nazareth*) | NEW FHS HOSP NKA NAZARETH HOSPITAL |
| 109 Dickinson St (*DaVita South Philadelphia*) | **FILIPPONE EDWARD J TR** — revocable trust |
| 1172-74 S Broad St (*DaVita*) | **FILIPPONE-NEWMAN LLC** |
| 4126-38 Walnut St (*DaVita 42nd St*) | UNIV CITY ASSOCIATES |
| 1300-24 W Lehigh Ave (*DaVita Lehigh Ave*) | PHILA SUBURBAN |
| 3310-24 Memphis St (*DaVita Memphis St*) | SIX G'S L P |
| 3020-52 Market St (*DaVita*) | 3020 MARKET OPERATING LP |
| 3701 Market St (*DaVita*) | GI ETS UC LLC |
| 700 Cottman Ave (*Fkc Fox Chase*) | HASBROOK ASSOCIATES L P |
| 2910 S 70th St (*Usrc Philadelphia*) | BLUE BELL ASSOC |
| 5003 Umbria St (*Fkc Roxborough*) | UMBRIA VENTURES LLC |
| 100 E Lehigh Ave (*Fkc Episcopal*) | EPISCOPAL HOSPITAL |
| 4800 Brown St (*DaVita Brown St*) | WEST VILLAGE APARTMENT LO |
| 1438 S Front St | CORONA ROSALIIO |
| 3300 Henry Ave (*Dci Philadelphia*) | Falls Center LPs — **multi-parcel, needs unit disambiguation** |

🚨 **And the first prospecting signal fell out immediately:** **FILIPPONE EDWARD J TR** owns 109 Dickinson St and
**FILIPPONE-NEWMAN LLC** owns 1172-74 S Broad St — **the same family behind two of Team Briggs' dialysis
properties.** That is a portfolio seller prospect that LCC could not see at all yesterday, because both properties
read "owner unknown".

### What this settles

- The free path **works**, at roughly **two-thirds** on the first jurisdiction tested.
- The residual is **not** a data-availability problem but an **address-normalisation** one (ranges, suite noise,
  `CITY AVE` vs `CITY LINE AVE`) — precisely the job §7 identified as the legitimate use of a local model.
- ⚠️ **One jurisdiction is not a rate.** Philadelphia is a well-run open-data city. Re-measure on a Texas CAD and
  a Florida county before projecting 68% onto the 4,021.
- ⚠️ **3300 Henry Ave shows the real hard case:** one street address, six owning entities. Multi-parcel /
  condominium sites need a unit or parcel discriminator, and no amount of address matching resolves them.

**Recommended next: repeat this exact test on Harris TX (50 properties) and Miami-Dade FL (29).** Two more
measurements, no build, and then the coverage question is answered with three real rates instead of one.
