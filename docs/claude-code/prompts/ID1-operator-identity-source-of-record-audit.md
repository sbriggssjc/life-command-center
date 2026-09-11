# ID1 — Entity identity audit: trace the operator split (and its siblings) to the source of record, then design the one fix

**Repo: `life-command-center`** (and read-only inspection of the Dialysis repo's ingesters, if reachable).
**This prompt is read-only against every live database.** It produces an audit, a writer inventory, and a
repair design with backlog rows. The repair itself is ID2, after Scott reviews this.

**Read first:** `CLAUDE.md` → Core doctrines → **"TRUTH IS FIXED AT ITS SOURCE OF RECORD"** (new, Scott 2026-09-11 —
this prompt is its first application) · `api/_shared/operator-normalize.js` +
`supabase/migrations/dialysis/20260624_dia_operator_normalize.sql` (the existing normalizer) ·
`docs/os/PLANNED-BACKLOG.md` §P0d (data coherence), §P18 MB1e, **PDR2** (the operator is shown as owner), **OWN4**
(the tenant is in the owner slot), the **B6d-cms** family (CMS ingest) · the comps engine (`rpc_query_comps`,
`mcp/comps-tools.js`).

## Why this, why now

MB-a3's dry run showed per-operator cap bands split across `Fresenius` (n=63) vs `Fresenius Medical Care` (n=12)
and `DaVita` vs `DaVita Dialysis`. Scott: *fix the source so the truth persists everywhere, and look for greater
problems underneath.* Cowork's read-only pass on 2026-09-11 (Dialysis_DB `zqzrriwuavgrquhisnoa`) shows this is
an **identity-model defect**, not a naming nit:

- **The comps engine groups on free text.** `rpc_query_comps` reads `p.operator` = `dia.properties.operator`,
  which is free text with **no `operator_id` column**: 45 distinct strings over 10,327 of 11,804 properties.
  The variants include `DaVita` 4,435; `Fresenius` 3,733; `US Renal Care, Inc.` 418 vs `US Renal Care` 47;
  `Fresenius Medical Care` 36; `Satellite Healthcare` 79 vs `Satellite Dialysis` 13; `Dialysis Clinic, Inc.`
  298 vs `…, Inc` 3; and composites like `DaVita | US Army Corps of Engineers`, `DaVita |San Antonio Kidney
  Disease Center`, `DaVita at Home`.
- **The "canonical" `operators` registry is itself duplicated.** It has 67 rows:
  - US Renal Care appears 3 times (ids 2, 57, 73), Dialysis Clinic twice (3, 79), and Satellite 2–3 times (10,
    58, and 43 `ESRD SATELLITE UNIT`).
  - DaVita is split across 4, 28 `DaVita Dialysis`, 70, 75, and 77.
  - Categories are stored as operators: `None`, `Other`, `Independent`, `State Owned`.
  - Non-operators are in the table: `UnitedHealthcare`, `Kaiser Permanente`.
  - `npi_count` is NULL everywhere, and there's no parent/brand hierarchy.
- **Two conflicting canonical spellings.** `operator-normalize.js` declares `Fresenius` canonical (the "dominant
  properties spelling"). `operators` and CMS `chain_organization` say `Fresenius Medical Care`. The normalizer only
  fills *blanks*, only in the OM promoter.
- **FK coverage is partial:**
  - `leases.operator_id`: 3,809 of 12,833 (30%)
  - `tenants.operator_id`: 5,510 of 7,862
  - `medicare_clinics.operator_id`: 6,634 of 8,547
  - **979 eligible clinics have neither a chain nor an operator.** They're silently excluded from every operator
    count.
  - 675 `Independent` clinics carry no `operator_id`.
- **Sibling defect classes already seen today:**
  - **Truncated imports:** DaVita = Fresenius = exactly 2,450 CMS rows, loaded 17 seconds apart.
  - **Dead feeds:** CMS last seen 2026-01-22.
  - **Tenant/operator in the owner slot:** PDR2 (~4,026 properties) and OWN4 (79% of lane properties).
  - **Government strings bleeding into dialysis operator values** (`DaVita | US Army Corps of Engineers`).

## 1. Measure (read-only) — every table, every lane

For dialysis, first:

- Every column that names an operator or tenant, across tables and views, including `cm_*` tables and
  `sales_transactions` via properties.
- Each column's distinct values, row counts, FK coverage, and a variant → family cluster. Use the existing
  alias regexes and add any families you find.
- The same census for **government** (agency and tenant naming in `government`), **LCC Opps** (`entities`
  organization names, `true_owners`/owner placeholders, `cortex_market_intel.tenant`, `sf_*` staging), and
  **Salesforce-synced** tenant/account strings.
- For each lane: how many facts, comps, charts, or dossiers change if variants are merged. For example, recompute
  the TTM band per operator family against the current split.

## 2. Writer inventory — who mints each variant

For every operator/tenant column: every code path that writes it. Cover this repo (`api/`, `mcp/`, `scripts/`,
`supabase/functions/`, migrations), the **Dialysis repo** ingesters (CMS, CSV, CoStar/sidebar, SF sync), and
Power Automate or manual SQL where evidence exists. Per writer, record:

- the value source,
- whether it calls `operator-normalize`,
- whether it can create a new `operators` row,
- the last write seen (from `updated_at`/provenance).

Attribute each observed variant to the writer(s) that produced it, using provenance/`data_source` columns where
present. Trace the composite `DaVita | …` strings and the 2,450 CMS cap to their writers.

## 3. Design the one fix (a proposal — do not execute)

- **Canonical operator registry.** One row per real company, with a parent/brand hierarchy (e.g. DaVita Kidney
  Care as parent; DaVita at Home as a brand). Aliases go in a separate table with provenance. Categories
  (Independent, Other, None, State Owned) become a classification, not operators. Non-operators are removed or
  moved.
  - Settle the canonical display name for each family, e.g. `Fresenius Medical Care` vs `Fresenius`. **Flag this
    as a 👤 decision for Scott, with the trade-offs.** The current UI/CM charts use `display: 'short_operator'` at
    the export layer, so a long canonical plus short display is possible.
- **FKs.** `operator_id` on `properties` (new column), with backfill plans for leases, tenants, and
  medicare_clinics. Include match rules, the review lane for ambiguous matches, and expected counts from §1.
- **One resolver** (JS plus a lock-step SQL mirror), extending `operator-normalize.js` rather than forking it. Every
  writer from §2 routes through it. It fails closed to a review status, and **never mints an operator without
  review**. Include the DB guard (FK plus trigger or constraint) that makes a free-text-only write impossible.
- **Consumers switch to `operator_id`:** `rpc_query_comps`, CM views/exports, market-brief facts, the property
  dossier, and MCP tools. Include a parity plan: before/after counts per surface.
- **Cross-lane identity.** How the same operator is represented in LCC Opps entities and gov, and how this ties
  into PDR2/OWN4 (the operator must never occupy an owner slot). Recommend whether the registry lives in
  Dialysis_DB with LCC Opps referencing it, or in LCC Opps as the cross-lane identity hub. Justify against
  existing doctrine.
- **Sibling sweep:** list every other identity-like field with the same shape (free text used as a grouping key
  with no FK). Tenants and agencies first. Rank by blast radius.

## 4. What NOT to do

No writes to any live DB. No merges, backfills, or migrations applied. No flag flips. Don't patch the
market-brief producer's grouping, because that's the downstream patch the doctrine forbids. MB-b now consumes
`operator_id` after ID2 lands.

## Ship + record

- Write `docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md`: the measurements, writer inventory, attribution,
  design, and decisions.
- Update `PLANNED-BACKLOG.md`: §P0d rows ID1 ✅ and ID2+ (build, split into safe steps), sibling rows ranked, and
  cross-links to MB1e, PDR2, OWN4, and B6d-cms.
- Add a `STATUS.md` entry.
- Commit on a docs branch and open a PR.

Your reply should include the per-lane variant census, the writer attribution, the proposed canonical list with the
👤 naming decisions, the blast radius per surface, and the ranked sibling list.
