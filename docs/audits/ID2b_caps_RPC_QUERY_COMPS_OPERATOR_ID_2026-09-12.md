# ID2b-caps — `rpc_query_comps` carries operator_id; the per-operator cap-rate band fragmentation is fixed (2026-09-12)

**Repo:** `life-command-center` (Dialysis_DB, `zqzrriwuavgrquhisnoa`). Companion to ID2a (registry) and ID2b
(the CMS-clinic-count consumer switch, `v_market_brief_cms_operator_counts`) — this unit is the CAP-RATE-BAND
half MB1e/ID2b left unverified: *"the per-operator cap-rate bands MB1e names come from a DIFFERENT producer
than the CMS-count facts fixed [by ID2b] — not re-verified this round."*

## The defect, re-confirmed live before the fix

`rpc_query_comps()` (the sale/listing arms) emitted `'tenant', public.comp_tenant(p.chain_canonical, p.operator,
p.tenant)` and nothing else identity-bearing. `market-brief-psql-tick.js`'s per-operator TTM cap-rate band
grouped on that free TEXT via `normKey(tenant)`, so two spellings of one registry operator produced two bands.
Live dry-run figures at the time this was written (`prompts/ID2bcaps-comps-engine-operator-id-passthrough.md`):
`cap_rate_ttm_band:fresenius` n=63 vs `:fresenius_medical_care` n=11; `:davita` n=67 vs `:davita_dialysis` n=9.

## The fix

1. **`rpc_query_comps` — additive only.** Migration
   `supabase/migrations/dialysis/20260912130000_dia_id2bcaps_rpc_query_comps_operator_id.sql`, applied live to
   `zqzrriwuavgrquhisnoa`. Appends `operator_id` / `operator_canonical` to the sale and listing arms via
   `p.operator_id -> dia_operator_survivor(p.operator_id) -> operators.name` (the same resolution
   `20260912120000_dia_id2b_market_brief_operator_id.sql` uses); the `sf_comp_staging` arm (no `properties`
   join) gets explicit `NULL`s for both, so every comp row carries the same key set. Every pre-existing key,
   value and ordering is unchanged — proven by construction: both additions are `jsonb || jsonb_build_object(...)`
   merges appended after the pre-existing object, never an edit inside it (the sf-comp arm's inline
   `jsonb_build_object` call was already at Postgres's 100-argument ceiling, so its two new keys are appended
   via the same `||` pattern rather than inline, which is also why the SF arm needed its own small syntax fix
   mid-flight — see the migration header). `mcp/comps-tools.js::operatorTier`/`compTenantText` and every other
   reader of `tenant` are untouched, so comp SELECTION and scoring cannot have changed.

   Only the 13-arg overload (`p_tenant` present) is touched — both `market-brief-psql-tick.js` and
   `mcp/comps-tools.js` always pass `p_tenant` explicitly (verified 2026-09-11/12), so that overload is the
   only one either caller can resolve to; the 12-arg overload is dead for these two callers and was left alone.

2. **The band grouping — `planOperatorCapRateBands()`** (new, pure, exported from
   `api/_handlers/market-brief-psql-tick.js`). Groups TTM sale comps on `operator_id` when the RPC resolved
   one (label = `operator_canonical`), falling back to the pre-ID2b-caps raw-tenant-text grouping for any comp
   whose linked property has never resolved an `operator_id` (~20% of dia properties, per ID2a) — never
   dropped, never silently merged into an unrelated bucket. `buildCapRateBandFact()` gained an `operatorKey`
   parameter so the `fact_key` can be `cap_rate_ttm_band:<operator_id>` instead of
   `cap_rate_ttm_band:<normKey(label)>` when an id is available.

3. **Superseding the old fragments.** A different `fact_key` never auto-supersedes another
   (`decideFactWrite` compares only within one `fact_key`), so the stale text-keyed fragments would sit live
   beside the merged id-keyed band forever without an explicit step. `planOperatorCapRateBands()` also returns
   a `retire` list: every raw tenant-text spelling actually observed under a resolved `operator_id` this run,
   as a `cap_rate_ttm_band:<normKey(text)>` key — **except** a key this same run also needed as a genuinely
   live band for OTHER, unresolved rows (a raw text can be both "an alias of a resolved operator" for some
   rows and "still the only home" for others in the same run; the freshly-emitted fact always wins). The
   handler processes `retire` after the normal write loop via a new `retireStaleFact()` — marks the existing
   live row `status='superseded'` with no `supersedes_id` chain (the replacement lives under a different key,
   already written earlier in the same run). Idempotent: a key already retired has nothing left to retire.

## Verified live (2026-09-12, `zqzrriwuavgrquhisnoa`)

Additive-only field check (excerpt, full-population, `p_limit=10000`):

| tenant text | operator_id | operator_canonical |
|---|---:|---|
| Fresenius | 5 | Fresenius Medical Care |
| DaVita | 4 | DaVita |
| DaVita Dialysis | (null — property unresolved) | (null) |

Exact TTM window the tick itself uses (`p_date_from = today-366d`, `p_limit=900`), grouped the way
`planOperatorCapRateBands` groups:

| group_key | n |
|---|---:|
| `id:4` (DaVita) | 72 |
| `id:5` (Fresenius Medical Care) | 68 |
| `text:fresenius_medical_care` (unresolved property) | 13 |
| `text:davita_dialysis` (unresolved property) | 12 |
| `id:73` (US Renal Care) | 6 |
| `text:davita_kidney_care` (unresolved property) | 5 |

**Result:** the dominant Fresenius/DaVita fragmentation is repaired — one `cap_rate_ttm_band:5` band (n=68)
and one `cap_rate_ttm_band:4` band (n=72), each well above the `MIN_N_CAP_BAND=5` floor, in place of the four
separate bands the pre-fix engine would have emitted. The residual text-keyed bands
(`:fresenius_medical_care` n=13, `:davita_dialysis` n=12, `:davita_kidney_care` n=5) are **not** a re-emergence
of the same defect — they are comps whose linked *property* has never resolved an `operator_id` at all (ID2a
backfill coverage gap, 80.1% today), correctly kept separate rather than guessed into the wrong bucket. Closing
that residue is ID2a's backfill completion, not this unit's job.

Read on named rows, one pre-existing data-quality mismatch surfaced (not introduced by this change, not
fixed here): one comp resolves `operator_id=4` (DaVita) via its property while `comp_tenant()` computes
`tenant='Fresenius'` from a different source field on the same row — the two identity signals disagree on
that single comp. `operator_id` is the more reliable of the two (it is the registry, survivor-resolved); this
is exactly the class of defect the id-keyed grouping is meant to be robust against, and it is.

## Selection-identity proof (comp SELECTION is untouched)

`mcp/comps-tools.js::operatorTier()`/`compTenantText()` read only `tenant`/`operator`/`agency`/`anchor_tenant`
off the comp row — none of them read `operator_id`/`operator_canonical`. Since those two fields were appended
via `||` after the pre-existing object (never edited inside it), and no existing key's expression changed,
every comp row's pre-existing fields are byte-identical to the pre-fix engine's output; `operatorTier()` and
`compTenantText()` therefore see identical input on every comp, for every subject, before and after this
migration. This is a structural proof (the same class of proof N18/A2 document repeatedly in this repo's
CLAUDE.md as stronger than a live diff): a function that never reads a new key cannot behave differently when
that key is added beside the ones it does read.

## Tests

`test/id2b-caps-operator-id-bands.test.mjs` (12 tests, all pass): fragmentation repair (Fresenius, DaVita),
NULL-operator_id fallback (never dropped, never bled into an unrelated bucket), the retire-vs-still-live
collision guard (caught by this test suite before shipping — an earlier draft of `planOperatorCapRateBands`
would have retired a key the SAME run also needed as a live band for unresolved rows), small-n suppression on
the merged population, and the wiring assertions (the lane builder returns `retire`, the handler processes it
after the write loop, `retireStaleFact` is exported). Full suite: 6,044 pass / 0 fail / 6 skipped (pre-existing).

## Explicitly not done here (by design)

- `MARKET_BRIEF_PSQL` was not flipped — MB-b owns that decision.
- No change to comp SELECTION/scoring, the registry, any alias table, or any guard.
- No gov work.
- ID2b-remaining (the CM views, dossier, MCP tools beyond the selection-identity proof above) is sized below,
  not shipped.

## ID2b-remaining — sized, not built

| consumer | what it would take | size |
|---|---|---|
| `cm_dialysis_available_by_tenant[_q]`, `cm_dialysis_industry_participants` (ID2b-cm) | switch each view's `GROUP BY` from raw operator text to `properties.operator_id` (survivor-resolved), fill-blanks fallback to raw text for unresolved rows — same shape as the `v_market_brief_cms_operator_counts` migration and this unit's `rpc_query_comps` change | 1 migration per view (2 views); each needs its own before/after row-count parity check the way ID2b and this unit both ran |
| `cm_dialysis_operator_unit_economics`, `v_dia_econ_operator_benchmark` | already run `dia_operator_bucket()` ILIKE bucketing, largely masking the Fresenius/DaVita split today — re-grade whether the registry buys anything over the existing heuristic before touching | measurement first (1 query), then a decision — likely smaller than a full switch |
| `dossier-generator.js` | read whether it renders a per-operator rollup at all; if so, same additive pass-through pattern as `rpc_query_comps` | 1 read + possibly 1 small JS change |
| `sidebar-pipeline.js`, `rent-projection.js`, `team-context.js` | named in ID2b as unread; grep for any operator-text GROUP BY / dedup key in each before assuming a change is needed | 3 reads, likely 0 changes (none of the three obviously groups by operator) |
| the ~85 remaining views ID2b's audit counted (`docs/audits/ID2b_OPERATOR_ID_CONSUMER_SWITCH_2026-09-12.md`) | most are review/audit surfaces where raw text is the deliverable by design (named in that audit) — enumerate the minority that actually GROUP BY operator text before scoping further work | 1 targeted re-read of that audit's own list, filtering to `GROUP BY`/`DISTINCT` on an operator column |

## Addendum — Cowork live re-check, 2026-09-12 (read-only, deployed `c5fc261f`)

**The gate did not hold, and the failure mode is worse than the original defect.** A dry run of the P-SQL tick against
the deployed build returns FIVE per-operator bands, two pairs of which now carry the **same display name**:

| fact key | label | n |
|---|---|---|
| `cap_rate_ttm_band:5` | Fresenius Medical Care | 63 |
| `cap_rate_ttm_band:fresenius_medical_care` | **Fresenius Medical Care** | 12 |
| `cap_rate_ttm_band:4` | DaVita | 68 |
| `cap_rate_ttm_band:davita_dialysis` | DaVita Dialysis | 10 |
| `cap_rate_ttm_band:73` | US Renal Care | 6 |

**Root cause: a third comp source the passthrough never reached.** The migration added `operator_id` to
`rpc_query_comps`'s sale and listing arms — both of which read dia `properties`, where coverage is good (every TTM
DaVita/Fresenius sale row resolves: DaVita 49, Fresenius 39, Fresenius Medical Care 1, all with `operator_id`). The
leftover comps come from **`sf_comp_staging`** — the Salesforce-staged comps, i.e. **Team Briggs' own closed deals** —
which has no property link and therefore no `operator_id`. It carries **196 `DaVita Dialysis`** and **179 `Fresenius
Medical Care`** rows, spelled exactly as the alias table already maps them (`DaVita Dialysis` → 4, `Fresenius Medical
Care` → 5). The tick's text fallback never consults `dia_operator_aliases`, so those comps mint a second band under a
canonical-looking label.

**Two fixes, both small:** (1) resolve the SF-staged arm's tenant through `dia_operator_aliases` (or give
`sf_comp_staging` its own resolved `operator_id`, guarded like the others); (2) a rendering-level invariant — **two
live band facts may never share a display label** — as a test, so this class cannot ship again. Tracked as
**ID2b-caps-2**.

## Addendum — ID2b-caps-2 SHIPPED + VERIFIED LIVE, 2026-09-12

Both fixes above landed, and the gate now holds. Migrations
`supabase/migrations/dialysis/20260912140000_dia_id2bcaps2_sf_comp_staging_operator_id.sql` and
`.../20260912150000_dia_id2bcaps2_rpc_query_comps_sf_operator_id.sql`, applied live to `zqzrriwuavgrquhisnoa`.

**Chose option (b) — a first-class `sf_comp_staging.operator_id` column — not the query-time resolve.**
Checked first, per the doctrine this file itself is an instance of ("trace it to the source of record"): a repo
grep for `sf_comp_staging` outside migrations/SQL found exactly two readers
(`api/_handlers/entities-handler.js`, `api/_handlers/om-comp-resolver.js`), both reading only linkage keys
(`sf_comp_id`/`linked_property_id`/`linked_sale_id`) — **neither reads `.tenant`.** So today `rpc_query_comps`
is the only consumer of this fact. Chose (b) anyway, for the same reason ID2a gave `properties` an `operator_id`
column instead of resolving `properties.operator` at read time everywhere it's queried: `sf_comp_staging.tenant`
IS the raw fact for this row (there is no `properties` row to hang an id off), so a future second consumer of
this table should not have to re-derive the same resolution a second way. The resolver itself is not
duplicated — both the column's fill-blanks trigger and the RPC's lateral join call the SAME
`dia_resolve_operator(text)` ID2a already ships, resolved through the same survivor chain
(`dia_operator_survivor`) the sale/listing arms already use.

**Deliberately lighter than the `properties` precedent in one respect.** `properties.operator` is written only
from inside this repo's own JS/SQL, so ID2a's hard-block `dia_operator_write_guard()` trigger (RAISE on an
unresolved write) is safe there. `sf_comp_staging` is fed by the Salesforce sync pipeline in the separate
Dialysis repo (`sf_object_sync.py`), which this session did not read or touch — a hard block here could either
fail that external writer's upserts outright, or, if it silently retries, spam `dia_operator_write_review` once
per sync cycle for the same unresolved tenant. The trigger shipped instead
(`dia_sf_comp_staging_operator_fill()`) is **fill-blanks only** (never overwrites a non-null `operator_id`,
never raises) and **de-dupes its own review-lane writes** against an already-open row for the same
`(table_name, record_pk, raw_operator_text)`, so a row re-touched by every sync cycle logs once, not once per
sync.

**Live dry-run before applying anything, against `zqzrriwuavgrquhisnoa` (via `mcp__Supabase__execute_sql`):**

```
select st.tenant, r.operator_id, r.canonical_name, r.status, count(*)
from sf_comp_staging st cross join lateral dia_resolve_operator(st.tenant) r
where st.tenant is not null and btrim(st.tenant) <> '' group by 1,2,3,4 order by count(*) desc;
```

confirmed the resolver already agrees exactly with the audit's numbers: `DaVita Dialysis` → operator_id 4
(196), `Fresenius Medical Care` → operator_id 5 (179), plus `US Renal Care`→73 (13), `Dialysis Clinic Inc
(DCi)`→79 (4), `Southside Kidney Clinic`→76 (4), `Innovative Renal Care`/`American Renal Associates`→8 (4). Six
rows failed to resolve (`Reliant Renal Care`, `Dialysis Care Center`, `Georgia Nephrology`, `KidneySpa`,
`Physicians Choice Dialysis` → `needs_review`; `Vanderbilt University` → `non_dialysis`) — 406 total, matching
24 NULL-tenant rows to reach the table's full population.

**Live backfill result** (`dia_id2acleanup2_backfill_sf_comp_staging_operator_ids`): dry-run reported
`candidates: 406, would_auto_apply: 400, would_review: 6` — applied with `p_dry_run=false`, got
`auto_applied: 400, sent_to_review: 6`, byte-identical to the prediction. `dia_operator_write_review` gained
exactly 6 open rows tagged `table_name='sf_comp_staging'`.

**Live re-check of the tick's own TTM window after both migrations** (the exact `rpc_query_comps` call
`market-brief-psql-tick.js::fetchDialysisCapRates()` makes, `p_date_from = today-366d`, `p_limit=900`, grouped
the way `planOperatorCapRateBands` groups):

| group_key | label | n |
|---|---|---:|
| `id:4` | DaVita | 58 |
| `id:5` | Fresenius Medical Care | 48 |
| `id:73` | US Renal Care | 7 |
| `text:fresenius_medical_care` | Fresenius Medical Care | 1 |
| `id:8` | American Renal Associates | 1 |
| `text:assured_home_health` | Assured Home Health | 1 |
| `text:indiana_university_health` | Indiana University Health | 1 |

**Exactly three bands clear `MIN_N_CAP_BAND=5` and ship: DaVita, Fresenius Medical Care, US Renal Care.** The
four n≤1 fragments never reach the small-n floor, so nothing duplicate-labeled is ever written even before the
new invariant runs. ⚠️ **These absolute counts (58/48/7) do not match the prompt's stated targets (75/78/6) or
the original addendum's numbers (63+12/68+10/6)** because the rolling 366-day TTM window moves with `today()` —
every prior measurement in this document was taken on a different calendar day against a different window.
**The population SHAPE is what was predicted and is now correct**: one band per resolved operator, no
duplicate-labeled live pair. Traced the one residual same-label fragment
(`text:fresenius_medical_care`, n=1) to `comp_id: dia_db:14785` — the `dialysis_db` (properties) arm, NOT
`sf_comp_staging` — a single property whose `operator_id` has never resolved (the documented ~20% ID2a
coverage gap this file already named as out of scope). This is the SAME accepted fallback class the pre-existing
test suite protects (`test/id2b-caps-operator-id-bands.test.mjs`, "a raw-text alias is never retired if OTHER,
unresolved rows still need it") — not a re-emergence of the SF-staging defect, and it self-suppresses below the
floor regardless.

**Duplicate-label invariant, shipped in `planOperatorCapRateBands()`.** Scoped deliberately to **id-keyed
groups only** — two DIFFERENT resolved `operator_id`s rendering under one canonical label (a registry defect:
two operator rows nobody merged, or a resolution bug minting two ids for one operator) — and explicitly NOT
applied to an id-keyed group sharing a label with a text-keyed (unresolved) fallback group, which is the
documented, tested, intentional ID2a coverage-gap behaviour above. A blanket "no two live facts may ever share
a label" rule was considered and rejected: it would have broken that exact accepted fallback and the existing
test asserting it. On a genuine collision the guard logs loudly (`console.error`, named reason), keeps the
larger-`n` band, and routes the loser through the SAME `retireStaleFact()` supersede mechanism the raw-text
aliases already use (`status='superseded'`, never a second live fact, never a silent drop) — verified with a
constructed fixture (two operator_ids, same canonical label) since no live instance of this specific defect
exists in the registry today; the invariant exists to make the CLASS structurally impossible, not to describe
a currently-open one.

**Tests:** `test/id2bcaps2-sf-operator-resolution.test.mjs` (13 tests) — SF-arm resolution fixtures (merge,
DaVita spelling, unresolvable-tenant fallback), the duplicate-label invariant (collision, no-op on genuinely
different labels, exemption for the coverage-gap fallback), source-level regression checks (sale/listing arms'
operator resolution untouched — exactly 2 occurrences of the pre-existing resolve pattern; the SF arm's old
`null::bigint` literal is gone; `mcp/comps-tools.js` reads none of the `operator_id` fields), and the migration
shape (fill-blanks trigger never raises inside its own function body — the migration's unrelated startup guard
DOES raise on a wrong-DB target, scoped out of that assertion; review-lane de-dup; dry-run-default backfill).
Full suite: **6,057 pass / 0 fail / 6 skipped** (up from 6,044 — exactly the 13 new tests).

**Not done, deliberately:** `MARKET_BRIEF_PSQL` was not flipped (MB-b's call); no change to comp
SELECTION/scoring, the registry merge machinery, or any alias-table write path beyond the one new alias-lookup
consumer (`sf_comp_staging`'s trigger/backfill call the EXISTING resolver, they do not add rows to
`dia_operator_aliases`); no gov work; the 6 unresolvable `sf_comp_staging` tenants sit in
`dia_operator_write_review` exactly like any other unresolved operator string — resolve them via
`dia_id2a_resolve_review(review_id, operator_id)` the same way any other review row is resolved.
