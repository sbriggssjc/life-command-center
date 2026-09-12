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
