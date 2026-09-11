# ID1 — Operator/tenant identity audit: trace the split to the source of record

**Status: audit complete, read-only. No live-DB writes, no migrations applied, no flag flips.**
**Prompt: `docs/claude-code/prompts/ID1-operator-identity-source-of-record-audit.md`.**
**Repair (ID2) does not start until Scott has made the 👤 naming decision in §5.**

This document supersedes the prompt file as the ID1 deliverable. The prompt file recorded the
question and Cowork's first-pass numbers; this document adds the writer inventory, the
registry-duplication finding (there are **three** operator registries, not one), the design, and
the ranked sibling sweep.

## 0. What could and could not be measured in this session

This session had **no live Supabase/Postgres credentials** for Dialysis_DB (`zqzrriwuavgrquhisnoa`),
LCC Opps (`xengecqvemvfknjvbvrq`), or Government (`scknotsqkcheojiaewwh`), and no clone of the
Dialysis repo's ingesters. Everything below is one of:

- **A) a live-DB measurement already on record** — taken from Cowork's 2026-09-11 read-only pass
  (recorded verbatim in `CLAUDE.md` §"TRUTH IS FIXED AT ITS SOURCE OF RECORD" worked example and in
  `docs/claude-code/prompts/ID1-operator-identity-source-of-record-audit.md`, and in the existing
  P113 / MB1e / PLANNED-BACKLOG entries) — cited with its source;
- **B) a repo-only finding** — grep/read of this repo's migrations and JS, which needs no DB access
  and is reported as fact;
- **C) a proposed measurement** — a query that has NOT been run, given verbatim in §1.5 for whoever
  has DB access to run before ID2 starts.

Nothing here is fabricated to fill a gap. Where (A) is quoted, it is marked **[measured 2026-09-11]**.
Where a number would be needed but no measurement exists anywhere, it is marked **[NOT MEASURED —
see §1.5]**.

## 1. Measurement — every table, every lane

### 1.1 Dialysis_DB — the primary lane

**[measured 2026-09-11]** `dia.properties.operator` is free text with **no `operator_id` column and
no FK**: 45 distinct strings over 10,327 of 11,804 properties (1,477 properties carry no operator at
all — a separate, larger gap than the "979 clinics" figure below, which is CMS-side). Representative
variants and counts:

| variant | n | family |
|---|---:|---|
| `DaVita` | 4,435 | DaVita |
| `Fresenius` | 3,733 | Fresenius |
| `US Renal Care, Inc.` | 418 | US Renal Care |
| `US Renal Care` | 47 | US Renal Care |
| `Fresenius Medical Care` | 36 | Fresenius |
| `Satellite Healthcare` | 79 | Satellite |
| `Satellite Dialysis` | 13 | Satellite |
| `Dialysis Clinic, Inc.` | 298 | DCI |
| `Dialysis Clinic, Inc` | 3 | DCI |
| `DaVita \| US Army Corps of Engineers` | (composite) | DaVita + gov agency bleed |
| `DaVita \|San Antonio Kidney Disease Center` | (composite) | DaVita + clinic-name bleed |
| `DaVita at Home` | (n) | DaVita (home-dialysis brand — should be a sub-brand, not a sibling) |

MB-a3's dry run (**[measured, cited in PLANNED-BACKLOG §P18 MB1e]**) shows this is not cosmetic — it
changes a client-facing number: per-operator TTM cap bands split `Fresenius` n=63 vs
`Fresenius Medical Care` n=12, and `DaVita` n=67 vs `DaVita Dialysis` n=10. Any grouped
statistic — the comps engine's per-operator cap band, the market-brief's operator fact, a CM
exhibit slice by operator — under-samples the true population for every operator that has a
minority spelling in play, and over-weights whichever spelling happens to be dominant.

**FK coverage against the free-text field (measured):**

| target | populated `operator_id` | of | coverage |
|---|---:|---:|---:|
| `leases.operator_id` | 3,809 | 12,833 | 30% |
| `tenants.operator_id` | 5,510 | 7,862 | 70% |
| `medicare_clinics.operator_id` | 6,634 | 8,547 | 78% |

**979 CMS-eligible clinics carry neither a `chain_organization` nor an `operator_id`** and are
silently excluded from every operator-grouped count that filters on either column — this is the
same failure shape this file's own doctrine calls out repeatedly elsewhere (*"a count that measures
state, not throughput"*, *"NULL is not zero"*): the 979 don't read as zero, they read as absent, and
an absent row never triggers a review.

**675 clinics carry the category value `Independent` and no `operator_id`.** `Independent` is a
*classification* (no chain), not an operator identity — conflating the two in one column is why
§1.3 below finds it minted as a row in the `operators` table itself.

### 1.2 The "canonical" `operators` table is itself duplicated — three separate identities per operator

**[measured 2026-09-11]** `dia.operators` has 67 rows. It is not a clean canonical list:

- **US Renal Care** appears **3 times** (ids 2, 57, 73).
- **Dialysis Clinic, Inc.** appears **twice** (ids 3, 79).
- **Satellite** appears **2–3 times** (10, 58, and 43 `ESRD SATELLITE UNIT`).
- **DaVita** is split across **5 rows** (4, 28 `DaVita Dialysis`, 70, 75, 77).
- **Categories are stored as operators**: `None`, `Other`, `Independent`, `State Owned`.
- **Non-operators are in the table**: `UnitedHealthcare` (a payer, not a dialysis operator),
  `Kaiser Permanente` (an integrated payer/provider, not a comparable operator entity for this
  book).
- `npi_count` is NULL on every row, and there is **no parent/brand hierarchy column** — nothing
  distinguishes a brand (`DaVita at Home`) from its parent (`DaVita`), or a legal-entity alias
  (`Total Renal Care, Inc.`) from the operating brand it is.

So the table that should be the single source of truth for "what operators exist" is itself running
the same defect one level up: it has no unique-per-real-company constraint and no dedup pass has
ever been run on it.

### 1.3 A third registry exists that the prompt did not find — `lcc_operator_affiliate_patterns` (LCC Opps)

**[repo finding, B]** Neither the audit prompt nor the doctrine note that motivated it mention this,
but it is a third, independent operator-identity store, living in a third database:

- `supabase/migrations/20260522340000_lcc_operator_affiliate_registry.sql` (LCC Opps
  `xengecqvemvfknjvbvrq`) creates `public.lcc_operator_affiliate_patterns` — `(parent_entity_id
  uuid REFERENCES entities(id), pattern_name, pattern_type)` — seeded with subsidiary-name patterns
  for DaVita, Fresenius, US Renal Care and American Renal Associates (e.g.
  `bio-medical applications%` → Fresenius, `total renal care%` → DaVita, `spectra renal%` →
  Fresenius, `american renal%` → ARA). This is used by `lease-extractor.js`'s
  `operatorFamiliesContradict()` guard (a fraud/duplicate-detection check comparing a document's
  tenant name against a candidate property's operator-of-record, so the same address is never
  matched across two genuinely different operator families).
- **Its seed resolves `parent_entity_id` by looking up an `entities` row where
  `LOWER(name) = 'fresenius medical care'`** (verbatim from the migration, §1.3.1 below), i.e. the
  LCC Opps `entities` table's canonical spelling for this operator is **`Fresenius Medical Care`**,
  not `Fresenius`.

So there are now **three** independent operator-identity artifacts to reconcile, not two:

| store | database | canonical Fresenius spelling | has parent/brand model? | FK'd to anything? |
|---|---|---|---|---|
| `api/_shared/operator-normalize.js` (this repo) | n/a — hardcoded JS | `Fresenius` | no | writes free text into `dia.properties.operator` |
| `dia.operators` | Dialysis_DB | `Fresenius Medical Care` | no (67 rows, dupes) | referenced by `operator_id` FKs, partially |
| LCC Opps `entities` + `lcc_operator_affiliate_patterns` | LCC Opps | `Fresenius Medical Care` | patterns→parent only, no CMS/NPI tie | patterns FK to `entities.id`; nothing ties this `entities` row back to `dia.operators` |

**Two of three existing stores already say `Fresenius Medical Care`.** `operator-normalize.js` is
the outlier, and by its own comment it chose `Fresenius` only because that was "the dominant existing
`dia.properties.operator` spelling" at the time it was written — i.e. it canonicalized to the
*majority variant of the very defect it was invented to fix*, not to the name any registry or CMS
uses. See §5 for the naming decision this implies.

#### 1.3.1 The exact seed lookup (verbatim, `20260522340000_lcc_operator_affiliate_registry.sql`)

```sql
SELECT id INTO v_fresenius FROM public.entities
 WHERE entity_type='organization' AND merged_into_entity_id IS NULL
   AND LOWER(name) = 'fresenius medical care' LIMIT 1;
```

If no LCC Opps `entities` row named exactly `fresenius medical care` (case-insensitive) exists, this
lookup silently returns NULL and **every Fresenius pattern in the seed block is skipped** — the
migration has no positive control asserting the lookup succeeded. **[NOT MEASURED — see §1.5 Q7]**
whether `v_fresenius`/`v_davita`/`v_usrc`/`v_ara` actually resolved at seed time, or whether this
registry has silently degraded to a subset of its intended four operators.

### 1.4 CMS ingestion — the fourth spelling authority, and the truncated-import sibling

**[measured, cited in `docs/os/PLANNED-BACKLOG.md` and this repo's `CLAUDE.md` B6d-cms family]**
CMS `chain_organization` is a fourth spelling authority (also `Fresenius Medical Care`, per the
prompt's own citation), and the CMS ingestion pipeline (Dialysis repo, `src/run_cms_ingestion.py`)
is independently documented in this repo's CLAUDE.md as having shipped a **truncated import**: DaVita
and Fresenius both land at **exactly 2,450 CMS rows, loaded 17 seconds apart** — the round-number
signature this repo's own doctrine calls out repeatedly (*"a round-number cap usually means a
truncated import"*), and the CMS feed itself is recorded elsewhere in this repo's history as **dead
since 2026-01-22** (no fresh pull since). This repo cannot re-verify the current CMS feed state or
re-run the ingester (Dialysis repo not present in this sandbox) — treat the 2,450/2,450 figure and
the 01-22 dead-feed date as *dated blockers to re-test*, per this repo's own re-measurement doctrine,
before ID2 relies on either.

### 1.5 Government, LCC Opps, Salesforce — proposed measurements (not run this session)

Government has **no operator concept** in the corporate sense — the "operator" of a
government-leased asset is the tenant **federal/state/municipal agency**, and
`docs/os/PLANNED-BACKLOG.md` / this repo's government-lease CLAUDE.md already documents
`gov.properties.agency`/`agency_full_name` as free text with the same class of variant risk (see
§6 sibling ranking — gov agency naming is the closest structural sibling to this defect, not a
different problem). No live gov-DB access this session; the census below is what should be run.

LCC Opps `entities.canonical_name` for organizations was **already measured for a related but
distinct defect** — this repo's CLAUDE.md's Entity identity & dedup section (N15c/P189/P195) already
documents 2,037+ byte-identical-name groups with disagreeing `canonical_name` and a normalizer
(`lcc_normalize_entity_name`) that returns NULL for acronym-named firms. That work did not scope to
operator identity specifically; it is the mechanism this audit's §1.3 registry sits on top of.

**Proposed queries for whoever has DB access, before ID2 starts:**

```sql
-- Q1 (Dialysis_DB) — full distinct-variant census with row counts, re-verify §1.1's 45.
SELECT operator, count(*) FROM dia.properties GROUP BY 1 ORDER BY 2 DESC;
SELECT operator, count(*) FROM dia.tenants GROUP BY 1 ORDER BY 2 DESC;
SELECT operator, count(*) FROM dia.leases GROUP BY 1 ORDER BY 2 DESC;
SELECT chain_organization, count(*) FROM dia.medicare_clinics GROUP BY 1 ORDER BY 2 DESC;

-- Q2 (Dialysis_DB) — the operators table's own dedup state, with a provenance/last-write column.
SELECT id, name, npi_count, created_at, updated_at FROM dia.operators ORDER BY name;

-- Q3 (Dialysis_DB) — the 979/675 unattributed populations, by lane, so a backfill can be sized.
SELECT count(*) FROM dia.medicare_clinics WHERE chain_organization IS NULL AND operator_id IS NULL;
SELECT count(*) FROM dia.medicare_clinics WHERE chain_organization = 'Independent' AND operator_id IS NULL;

-- Q4 (Dialysis_DB) — composite/bleed strings, to size the DaVita-|-gov-agency class exactly.
SELECT operator, count(*) FROM dia.properties WHERE operator LIKE '%|%' GROUP BY 1 ORDER BY 2 DESC;

-- Q5 (Government) — the sibling agency-naming free-text census.
SELECT agency, count(*) FROM government.properties GROUP BY 1 ORDER BY 2 DESC;
SELECT agency_full_name, count(*) FROM government.properties GROUP BY 1 ORDER BY 2 DESC;

-- Q6 (LCC Opps) — cross-lane: how many `entities` rows are operator subsidiaries with no link
-- back to a dia.operators row, and whether the affiliate-pattern registry has any orphaned patterns.
SELECT p.pattern_name, e.canonical_name, e.merged_into_entity_id
FROM public.lcc_operator_affiliate_patterns p JOIN public.entities e ON e.id = p.parent_entity_id;

-- Q7 (LCC Opps) — did the 2026-05-22 seed actually resolve all four parent ids? (§1.3.1)
SELECT count(*) FROM public.lcc_operator_affiliate_patterns;  -- expect > 0 per operator if seed took

-- Q8 (Salesforce-synced staging, if reachable) — tenant/account name variance for the same 4-5 families.
SELECT account_name, count(*) FROM sf_staged_accounts GROUP BY 1 ORDER BY 2 DESC;  -- exact table TBD, grep sf_* staging tables first
```

### 1.6 What changes downstream if variants are merged (blast radius by surface)

| surface | reads | effect of merging variants |
|---|---|---|
| **Comps engine** (`rpc_query_comps`, `mcp/comps-tools.js`) | `dia.properties.operator` (free text, grouped) | Every per-operator comp set currently under-counts; merging the 6+ known families changes the population size feeding every operator-filtered comp pull. `Fresenius` alone gains ~36 comps (+~1%); `US Renal Care` gains ~47 (+~11%) — small individually, material for the smaller operators. |
| **Capital Markets exhibits** | operator-sliced cap-rate/volume charts | MB-a3's own dry run already showed a *band-level* split (n=63 vs n=12 for Fresenius); merging changes the reported median/quartile cap rate per operator, not just the count — this is the number a client sees. |
| **Market Brief (MB-b, in flight)** | per-operator facts | **Explicitly withheld** per `PLANNED-BACKLOG.md` MB1e/MB3/MB4 until ID2 lands (marked "sequenced after ID1 → ID2 (per-operator bands withheld as a named gap until then)") — this audit does not change that sequencing, it is the gate MB-b is already waiting on. |
| **Property dossier** | operator display + dossier's own comp pulls | A dossier for a DaVita-leased asset currently reads whichever spelling that row happens to carry; no visible defect on a single-property dossier, but any dossier section that aggregates "other DaVita properties" undercounts. |
| **MCP tools** (`get_property_context`, `query_comps`, `generate_comps`) | same underlying tables as the comps engine | Same undercount, surfaced to Scott directly rather than through a rendered exhibit. |
| **P113 owner-guard surfaces** (priority queue, owner reconciliation) | `is_operator_not_owner` / `owner_type='operator'` / `owner_role='operator'` — a BOOLEAN/enum flag, not the free-text column | **Not directly affected by variant merging** — but the flag is set by NAME MATCH in places, so an unmerged variant can be the reason a given row never got the flag set in the first place. This is exactly the PDR2/OWN4 overlap (§5.4). |

## 2. Writer inventory — who mints each variant

Attribution below is by CODE PATH read in this session (repo finding, B), cross-referenced against
this repo's own dated writer notes where they exist. "Last write seen" is only reported where this
repo's docs already date it; otherwise marked unmeasured.

| # | writer | file:context | writes | calls `operator-normalize`? | can mint a new `operators` row? | last write seen |
|---|---|---|---|---|---|---|
| W1 | **OM intake promoter, fill-blanks step** | `api/_handlers/intake-promoter.js` line ~972–983 | `dia.properties.operator` (+ `operator_status='tenant_derived'`) | **yes** — the only writer that does | no — assigns only from the 6 hardcoded canonical targets in `operator-normalize.js`; never creates a variant or a new operator | live path (part of the standing OM pipeline) |
| W2 | **CoStar sidebar / lease-term carry-forward** | `api/_handlers/sidebar-pipeline.js` `upsertDomainLeases`, ~line 11497 | `dia.leases.operator` (carries forward the **parent lease's raw value verbatim** when a new lease term's incoming `operator` is blank) | **no** | no (never assigns a canonical value, only propagates whatever string was already stored — so a bad variant on term 1 propagates to every renewal term) | live (sidebar capture pipeline) |
| W3 | **`asset-entity.js` mint path** | `api/_shared/asset-entity.js` `buildAssetEntityName` / the `firstNonBlank(l.tenant, l.tenant_name, l.operator, l.guarantor)` fallback | LCC Opps `entities.canonical_name` (asset-entity minting) — reads `properties.operator` as a NAME SOURCE when no tenant/lease name is available | **no** | **yes, indirectly** — this is the mechanism by which a raw `dia.properties.operator` string can become a brand-new LCC Opps `entities` row with no tie back to `dia.operators` or `lcc_operator_affiliate_patterns` at all | unmeasured |
| W4 | **`lease-extractor.js` guard (read-only)** | `api/_handlers/lease-extractor.js` `operatorFamiliesContradict()` | reads only — does not write `operator`, but reads `lcc_operator_affiliate_patterns` to decide whether a document-tenant/property-operator pair is a plausible match | n/a (reader) | n/a | n/a |
| W5 | **`sf-link-reconcile.js` P113 skip guard** | `api/_handlers/sf-link-reconcile.js` `isOperator()` | reads `true_owners.is_operator_not_owner` / `owner_type` / `owner_role` to SKIP linking an operator as an SF Account owner | n/a (reader/guard, not a writer of the free-text operator field) | n/a | n/a |
| W6 | **CMS ingestion (Dialysis repo)** | `src/run_cms_ingestion.py` (not in this sandbox) | `dia.medicare_clinics.chain_organization` and, per this repo's CLAUDE.md B6d-cms family, has produced the 2,450/2,450 truncated-import artifact | unmeasured (external repo) | unmeasured | dead since **2026-01-22** per this repo's own dated note — **re-verify before relying on this** |
| W7 | **CoStar/CSV/manual SQL first-seed** | (historical; not a live writer, but the origin of most of the 45 variants — every family's minority spelling reads as a one-time capture that was never re-normalized) | `dia.properties.operator` at initial ingest | no | n/a — this is the population the OM promoter (W1) only fills BLANKS in, never corrects | historical |
| W8 | **`lcc_operator_affiliate_patterns` seed migration** | `supabase/migrations/20260522340000_lcc_operator_affiliate_registry.sql` | one-time seed of LCC Opps `entities`-keyed patterns | n/a (its own registry, not a consumer of `operator-normalize.js`) | **no** — looks up an EXISTING `entities` row by exact lowercase name match and silently no-ops if absent (§1.3.1) | one-time, 2026-05-22 |
| W9 | **Government agency writer** | `api/_handlers/sidebar-pipeline.js` line ~5185, `patch.agency = lease.agency \|\| null` | `government.properties.agency` (free text, no normalizer at all — the sibling defect, §6) | no (no gov equivalent of `operator-normalize.js` exists) | n/a — gov has no operator/agency registry table analogous to `dia.operators` | live |

**Composite/bleed strings (`DaVita \| US Army Corps of Engineers`, `DaVita \|San Antonio Kidney
Disease Center`).** No single writer in this inventory constructs a `|`-joined string — the pattern
(operator, then a literal `|`, then a second free-text token) is not present in any of `operator-
normalize.js`, `intake-promoter.js`, or `sidebar-pipeline.js`'s operator-touching code. **[NOT
MEASURED — see §1.5 Q4]**: the composite is most plausibly a downstream DISPLAY concatenation
(e.g. an export or dossier renderer joining `operator` + a second field for a multi-tenant/
mixed-use row) that was captured back into the stored column by a later write, rather than a
single ingest writer choosing to store it that way — but this needs a direct row read (or the
export/renderer code that builds `|`-joined strings, which was not found in this pass) to confirm.
Flagged as an open attribution gap for whoever runs Q4.

**2,450/2,450 CMS cap** attributes to **W6**, the Dialysis-repo CMS ingester, per this repo's own
prior documentation — this repo cannot re-derive the mechanism without the Dialysis repo's source.

## 3. Registry-duplication finding (summary)

There is not one duplicated `operators` table (§1.2). There are **three independent identity
stores for the same six operator families**, in three different databases, reconciled by nobody:

1. `api/_shared/operator-normalize.js` (this repo, hardcoded JS, 6 families, no persistence)
2. `dia.operators` (Dialysis_DB, 67 rows, itself duplicated — §1.2)
3. LCC Opps `entities` + `lcc_operator_affiliate_patterns` (4 of the 6 families, patterns keyed to
   `entities.id`, no tie back to (1) or (2))

None of the three references either of the others. A backfill or normalization pass run against any
one of them, alone, cannot fix the split — it will make that one store internally consistent while
leaving the other two (and every writer that reads from them) exactly as fragmented as before. **This
is the central finding this audit exists to produce**: the "one fix" in ID2 must be a single
registry all three collapse into, not a fix to any one of the three in isolation.

## 4. Sibling defect classes already on record (cross-referenced, not re-derived here)

- **PDR2** — operator shown as owner (this repo's PLANNED-BACKLOG, ~4,026 properties per the ID1
  prompt's citation).
- **OWN4** — tenant in the owner slot (79% of lane properties per the ID1 prompt's citation) — this
  is the P113 guard's own subject matter (§2 W5), i.e. the guard exists and is imperfect, not
  absent.
- **B6d-cms family** — CMS ingestion (truncated import, dead feed) — see §1.4/§2 W6.
- **Government agency naming** — no normalizer exists at all (§2 W9); ranked in §6 below as the
  nearest sibling by shape (free text used as a grouping key with an implicit multi-spelling risk,
  no FK, no registry).

## 5. Design — the one fix (proposal only; do not execute in ID1)

### 5.1 Canonical operator registry (single, cross-lane)

One table, one row per real operator, with:

- `operator_id` (stable surrogate key — this is what every consumer switches to, §5.4)
- `canonical_name` (the display name — §5.2 for the naming decision)
- `parent_operator_id` (nullable self-FK — lets `DaVita at Home` be a **brand row under** `DaVita`
  rather than a sibling, and lets a legal-entity alias like `Total Renal Care, Inc.` be modeled
  explicitly rather than folded invisibly into the alias table)
- `npi_count` (currently NULL everywhere in `dia.operators` — either populate from CMS or drop the
  column; do not carry forward a column nobody has ever written)
- `is_operator boolean default true` (or a `kind` enum `operator|category|payer`) so `None` /
  `Other` / `Independent` / `State Owned` become an explicit classification value on the PROPERTY/
  CLINIC row (e.g. `operator_id IS NULL AND chain_status='independent'`), never a row in the
  operator table, and so `UnitedHealthcare`/`Kaiser Permanente` are either removed from the table
  entirely or explicitly typed `kind='payer'` and excluded from every operator-grouped query by
  construction.

A **separate alias table** (`operator_aliases`: `operator_id`, `alias_text`, `source` (which writer
observed it), `first_seen_at`, `last_seen_at`) replaces both the ad-hoc regex list currently
hardcoded in `operator-normalize.js` and the pattern rows in `lcc_operator_affiliate_patterns` —
one alias store, keyed to the one canonical registry, with provenance per alias so a future auditor
can answer "who minted this spelling and when" without re-running a code archaeology pass like this
one.

### 5.2 👤 Canonical display-name decision for Scott

**Fresenius vs Fresenius Medical Care.** Two of the three existing stores (`dia.operators`, LCC
Opps `entities`/`lcc_operator_affiliate_patterns`) and the CMS `chain_organization` field (a fourth
independent source, §1.4) all say **`Fresenius Medical Care`**. Only `operator-normalize.js` says
`Fresenius`, and its own code comment states it chose that spelling only because it was "the
dominant existing spelling" in the free-text column it was built to clean up — i.e. it canonicalized
to the majority instance of the defect, not to any external authority.

- **Trade-off toward `Fresenius Medical Care`:** agrees with 3 of 4 independent sources (registry,
  LCC Opps entity, CMS); is the full legal/brand name; is what a client-facing exhibit or dossier
  would look most correct printing.
- **Trade-off toward `Fresenius`:** shorter for chart labels; is what the *majority of already-
  captured rows* say today, so choosing it minimizes the number of rows whose free-text
  `operator` column differs from the canonical spelling (though under the ID2 design every row
  gets an `operator_id` regardless of its free-text spelling, so this advantage mostly disappears
  once the FK lands).
- **The CM export layer already solves the display-length problem independently of this
  decision** — `cm-native-chart-injector.js` / the chart catalog's `display: 'short_operator'`
  token (cited in the original prompt) can map a long canonical name to a short chart label at
  export time. So choosing the long, more-authoritative name does **not** force long labels onto
  every chart; it only requires that the short-label map be seeded for whichever canonical name is
  chosen.

**Recommendation (not a decision — Scott's call):** `Fresenius Medical Care`, on the "3 of 4
independent sources agree" evidence, with `short_operator: 'Fresenius'` seeded in the export
display-name map so no chart-facing behavior changes.

The same class of decision recurs for at least:
- **US Renal Care** — `US Renal Care, Inc.` (418 rows, the legal-entity form) vs `US Renal Care`
  (47 rows, the bare brand form). CMS and most external references use the bare brand form for
  display; the legal-entity form is more common in this DB's captured rows.
- **Dialysis Clinic, Inc.** — essentially settled (298 vs 3, and no competing spelling from another
  registry) — flagged for completeness, no real decision needed.
- **DaVita** — settled; `DaVita` is the majority spelling AND matches every other source. `DaVita at
  Home` is a brand, not a naming variant — model it as a child row under the `DaVita`
  `parent_operator_id` per §5.1, never merge it into `DaVita`'s alias list.

### 5.3 FKs and backfill

- Add `dia.properties.operator_id` (new column, nullable, FK to the new registry). Do **not** drop
  `operator` — keep it as the raw captured value for audit, per this repo's own "never delete, keep
  the free-text as evidence" convention used elsewhere (e.g. the county-records / broker-identity
  audits already in this repo).
- Backfill order, safest-first: (1) rows whose free-text value exact-matches (case-insensitive) a
  canonical name or a known alias in the new alias table — auto-fill, no review; (2) rows matched by
  the existing `operator-normalize.js` family regexes (already conservative/anchored, per its own
  design) — auto-fill; (3) everything else (including every `DaVita \|...` composite, per §2's open
  attribution question) — a review lane, never an auto-write, mirroring this repo's standard
  "surface ambiguity, never guess" doctrine.
- `leases.operator_id` (30%), `tenants.operator_id` (70%), `medicare_clinics.operator_id` (78%) all
  backfill the same way, through the same resolver (§5.4) — never a second, table-specific matching
  pass, which is exactly the "normaliser drift" class this repo's CLAUDE.md warns about repeatedly.
- The **979 unattributed clinics** and **675 unattributed `Independent`** clinics are a distinct
  step: they do not get an `operator_id` at all (there is no operator to assign), they get the
  `kind='category'`/`chain_status='independent'` treatment from §5.1 so they stop being silently
  dropped from operator-grouped counts and start reading as an explicit, counted "no operator"
  bucket.

### 5.4 One resolver, every writer, DB guard

- Extend `operator-normalize.js` in place (do not fork) to become the JS resolver, with a **lock-
  step SQL mirror** (the module's own header already states this discipline — follow it, don't
  replace it). The resolver takes a raw tenant/operator string and returns `{operator_id, status}`
  — `matched` (auto-write), `unmatched_dialysis` (review), `non_dialysis` (never assign).
- **Every writer in §2's table (W1, W2, W3, W6, W7, W9-analog-for-a-future-gov-resolver) routes
  through the one resolver.** W2 (`sidebar-pipeline.js` lease carry-forward) is the most important
  behavior change: today it silently propagates whatever raw string the parent lease held; under
  the resolver it must resolve to `operator_id` at write time, so a bad variant on term 1 cannot
  propagate to every renewal.
- **W6 (CMS ingester) lives in the Dialysis repo** — ID2 must include a companion change there,
  routed through the SQL mirror (Python calling the SQL function, not re-implementing the alias
  list a third time in Python — a third copy is exactly the registry-duplication defect this audit
  exists to close).
- **DB guard:** a `CHECK`/trigger on the operator/tenant tables that refuses a write assigning a
  brand-new, unregistered `operator` free-text value without a matching `operator_id` resolution
  attempt having been logged — i.e. it does not have to *require* `operator_id IS NOT NULL` (some
  rows genuinely have no operator, §5.3), but it must make it structurally impossible for a writer
  to insert/update the free-text `operator` column while silently skipping the resolver call. The
  exact mechanism (trigger vs application-layer-only enforcement with a periodic drift detector
  mirroring this repo's `v_field_provenance_unranked` pattern) is an ID2 implementation decision,
  not decided here.
- **Never mint a new `operators` row from a writer.** Per the prompt's own instruction and
  consistent with every other registry in this repo (entities, `field_source_priority`, etc.): an
  unmatched string always goes to review; only a human (or a to-be-designed one-time reconciliation
  pass, itself reviewed) creates a new canonical operator row.

### 5.5 Consumers switch to `operator_id`

`rpc_query_comps`, the CM views/exports, the market-brief facts producer (MB-b, already sequenced to
wait on this per §4), the property dossier, and the MCP tools (`get_property_context`,
`query_comps`, `generate_comps`, `synthesize_comps`) all currently group/filter on the free-text
`operator` column. Switch order (safest-first, each with a before/after parity check comparing
group counts and, where applicable, the reported median/quartile statistic, per surface):

1. **Comps engine `rpc_query_comps`** first — it is the shared substrate every other surface above
   reads from or mirrors; fixing it first fixes the input to everything downstream without touching
   those surfaces' own code.
2. **CM exports / MB-b** — MB-b is already blocked on this per the backlog; ship it once (1) lands.
3. **Property dossier, MCP tools** — lowest urgency; no material client-facing exhibit currently
   depends on their operator grouping being exactly right, but they should not regress once the
   registry exists.

### 5.6 Cross-lane identity — where the registry lives

**Recommendation: the canonical registry lives in Dialysis_DB, with LCC Opps referencing it** — not
the reverse, and not a fourth copy in LCC Opps. Reasoning, against this repo's own stated doctrine:

- The free-text defect originates in `dia.properties`/`dia.leases`/`dia.medicare_clinics` — the
  domain database. This repo's core doctrine (*"truth is fixed at its source of record... trace it
  to the table and column that owns the fact"*) says the fix belongs where the fact is owned, and
  the fact here — "what dialysis operator runs this facility" — is a **domain (Dialysis_DB) fact**,
  not an LCC-internal one, exactly the same way `dia.true_owners`/`recorded_owners` own the
  ownership fact and LCC Opps only REFERENCES it via `external_identities`.
- This exactly mirrors the existing `external_identities` pattern this repo already uses for
  cross-lane identity (domain property/owner anchors, `source_system='dia'|'gov'`,
  `source_type='asset'|'true_owner'`) — add `source_type='operator'` to that same canonical scheme
  rather than inventing a new cross-lane mechanism. `lcc_operator_affiliate_patterns.parent_
  entity_id` then either gets retired in favor of `external_identities`, or becomes a thin
  LCC-Opps-side cache keyed off the domain `operator_id` via `external_identities` — never an
  independent identity of its own, which is what it is today (§1.3).
- Government has no operator concept (§1.5), so this is dia-only for now — consistent with the
  original `lcc_operator_affiliate_patterns` migration's own stated scope ("Government doesn't have
  an operator concept in the same sense... patterns are dia-focused for now").

## 6. Sibling sweep — ranked by blast radius

| rank | field | shape | blast radius (why ranked here) |
|---|---|---|---|
| 1 | **Government `properties.agency`/`agency_full_name`** | free text, no FK, no normalizer at all (§2 W9) — a strictly WORSE starting position than dialysis operator (which at least has `operator-normalize.js` and a registry, however duplicated) | Government's entire lease-analysis pipeline (firm-term resolver, cap-rate framework, CM exhibits) is agency-sliced the same way dialysis is operator-sliced; this repo's own government-lease CLAUDE.md already documents composite/bleed strings analogous to `DaVita \| US Army Corps` on the dialysis side. Highest-priority sibling — same shape, no existing partial fix to build on. |
| 2 | **`dia.tenants`/`dia.leases.tenant`** free text vs the operator field it should often equal | The tenant string is the RAW capture (CoStar/OM); operator is meant to be its resolved identity, but §2 shows the resolver (W1) only fires for OM intake, leaving CoStar-captured leases (W2) with an unresolved tenant string that never becomes an operator at all unless a later OM pass happens to touch the same property. | Directly upstream of the operator defect itself — fixing operator without also routing tenant capture through the same resolver at ingest time (not just fill-blank later) reproduces the split on every new CoStar capture. |
| 3 | **LCC Opps `entities.canonical_name` for organizations generally** | Already measured (this repo's CLAUDE.md N15c/P189/P195) as carrying thousands of disagreeing-canonical-name groups; §1.3/§2 W3 shows the operator-mint path (`asset-entity.js`) is one specific feeder into this broader, already-documented defect. | Largest population by row count of any field in this table, but already has a standing detector (`v_lcc_canonical_name_drift`) and an active remediation arc — ranked below the two dialysis-specific gaps because it is not unowned, it is in progress. |
| 4 | **`cortex_market_intel.tenant`** | Named explicitly in the ID1 prompt as in scope; **not found as a writer or reader in this repo's `api/`/`mcp/`/`scripts/` during this session's grep** — could not locate the table's schema or a writer in this codebase. | Ranked last because its existence and blast radius could not be confirmed this session — **[NOT MEASURED]**: run `\d cortex_market_intel` and a distinct-value count on `tenant` before ranking it definitively; it may belong above rank 2 or may not exist as an active table at all. |

## 7. What this audit did NOT do (per the prompt's own constraint)

No merges, backfills, or migrations were applied. No flag flips. `operator-normalize.js` was read,
not edited. The market-brief producer's grouping was not patched — MB-b remains sequenced to consume
`operator_id` after ID2, per the existing backlog entry, unchanged by this document.

## 8. Open items for ID2 (carried into the backlog, §9)

1. Scott's 👤 canonical-name decision (§5.2), at minimum for Fresenius; ideally for every family
   with a competing spelling across the three registries.
2. Run §1.5's proposed queries (Q1–Q8) with real DB access before ID2 begins, to replace this
   audit's cited-but-not-rerun 2026-09-11 numbers with current ones (per this repo's own
   re-measurement doctrine — a number is a hypothesis to re-test, not a fact to build on unchecked).
3. Resolve the `DaVita | ...` composite-string attribution gap (§2) — needs a direct row read or the
   export/render code that builds `|`-joined strings, neither of which this session could locate.
4. Confirm whether the LCC Opps affiliate-pattern seed (§1.3.1) actually resolved all four parent
   entity ids, or has silently degraded to fewer.
5. Decide the DB-guard mechanism (§5.4) — trigger-enforced vs a periodic drift detector mirroring
   `v_field_provenance_unranked`.

## Sources

- `docs/claude-code/prompts/ID1-operator-identity-source-of-record-audit.md` (the original prompt;
  carries Cowork's 2026-09-11 live-DB numbers cited throughout §1)
- `docs/os/PLANNED-BACKLOG.md` — ID1/ID2/ID3, MB1e, MB3, MB4, PDR2, OWN4 entries
- `CLAUDE.md` — "TRUTH IS FIXED AT ITS SOURCE OF RECORD" doctrine; P113 operator-in-owner-slot;
  Entity identity & dedup (N15c/P189/P195); B6d-cms family
- `api/_shared/operator-normalize.js`
- `api/_handlers/intake-promoter.js` (W1)
- `api/_handlers/sidebar-pipeline.js` (W2, W9)
- `api/_shared/asset-entity.js` (W3)
- `api/_handlers/lease-extractor.js` (W4, `operatorFamiliesContradict`)
- `api/_handlers/sf-link-reconcile.js` (W5, P113 guard)
- `supabase/migrations/20260522340000_lcc_operator_affiliate_registry.sql` (§1.3, §1.3.1)
- `supabase/migrations/dialysis/20260624_dia_operator_normalize.sql` (referenced, not independently
  re-read against a live DB this session)
