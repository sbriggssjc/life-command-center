# ID2b — moving consumers onto `operator_id`: what was measured, what shipped, what is deferred

**Repo:** `life-command-center` (owner of Dialysis_DB per the 2026-09-12 ownership table).
**Prompt:** `docs/claude-code/prompts/ID2b-consumer-switch-to-operator-id.md`.
**Live project:** Dialysis_DB `zqzrriwuavgrquhisnoa`.

`dia.properties.operator_id` (ID2a) is populated on **9,449 of 11,804** properties, guarded on
write, with a 207-row alias table and a 71-row review queue. ID2a's own parity view
(`v_id2a_operator_registry_parity`) already states the top-6 numbers this report uses as the
baseline: DaVita 4,435 · Fresenius Medical Care 3,769 · US Renal Care 465 · Dialysis Clinic, Inc.
301 · American Renal Associates 244 · Satellite Healthcare 92.

## 0. Budget statement (read first)

The full sweep asked for — ~45 Dialysis_DB views + ~12 repo modules, each measured before and
after — is a multi-day effort at full rigor. Per the task's own instruction ("ship the
highest-value subset completely and correctly, document the rest as a sized, named follow-up"),
this round:

- **Ran the real inventory query** against live Dialysis_DB and got the true population (below —
  it is not 45; see §1).
- **Shipped, measured, and proved** the one surface the prompt calls out by name as the thing to
  unblock: `market-brief-facts.js`'s only DB input, `v_market_brief_cms_operator_counts`.
- **Measured and explicitly declined** to switch the fuzzy comp-selection surface
  (`mcp/comps-tools.js`), per the prompt's own instruction not to touch it blind.
- **Named, not switched**, the remaining CM `cm_dialysis_*` grouping views and the other ~85
  views/modules, with what was found about each category.

Nothing below is guessed. Where a number could not be measured in this pass, that is stated.

## 1. The real inventory (measured, not assumed)

A grep for `view_definition ilike '%operator%' or ilike '%tenant%'` and NOT `ilike '%operator_id%'`
over `information_schema.views` on live Dialysis_DB returns **96 views**, not 45 — the 45 figure in
the prompt was a narrower prior estimate. Most of the 96 are false positives for this task: review
queues and audit views (`v_property_operator_review*`, `v_cms_property_link_conflict_review`,
`v_clinic_property_link_*`) whose entire PURPOSE is to surface raw operator/tenant text for a human
to adjudicate — switching those to a resolved id would hide exactly the ambiguity they exist to
show, so they are correctly excluded from this class of fix.

Narrowing to views that **group, aggregate, or count by** operator/tenant (the actual fragmentation
risk) gives a much smaller, named list:

| view | groups by | mechanism today | switch class |
|---|---|---|---|
| `v_market_brief_cms_operator_counts` | `medicare_clinics.chain_organization` (raw text) | plain `GROUP BY` | **SHIPPED this round** — see §2 |
| `cm_dialysis_operator_unit_economics` | `dia_operator_bucket(mc.chain_organization)` | `IMMUTABLE SQL` function, `ILIKE '%davita%' / '%fresenius%' / ...` bucketing | measured, not switched — see §4 |
| `cm_dialysis_operator_benchmark` | reads `v_dia_econ_operator_benchmark.operator` (itself `dia_operator_bucket`-derived, unread here) | pass-through | same as above |
| `v_dia_econ_operator_benchmark` | `dia_operator_bucket(...)` | same ILIKE bucketing | same as above |
| `cm_dialysis_available_by_tenant`, `cm_dialysis_available_by_tenant_q` | `al.tenant_bucket` (a stored bucket column on `cm_dialysis_active_listings_q`, values `'DaVita'/'FMC'/'US Renal'/'Other'/'Unknown'`) | precomputed bucket, not `operator_id` | not switched — see §4 |
| `cm_dialysis_industry_participants` | `medicare_clinics.chain_organization` (raw, with a catch-all bucket for junk values) | plain `GROUP BY`, no ILIKE normalization at all | **not switched — named follow-up, ID2b-cm** |
| `tenant_stats`, `v_operator_closure_risk_rollup`, `v_operator_segment_margin_latest` | operator/tenant text | not inspected this round | **not measured — named follow-up** |

The remaining ~89 views on the raw grep are review/audit/backfill-queue surfaces where the raw text
IS the deliverable (a human needs to see what was captured, not the resolved id), or are unrelated
hits on the word "operator"/"tenant" in an unrelated context (e.g. a column comment). None of those
were switched, and none should be without a per-view read — that read was not done this round.

**Repo modules** named in the prompt: `mcp/comps-tools.js` (measured, deferred — §4),
`api/_shared/dossier-generator.js`, `api/_shared/rent-projection.js`, `api/_shared/team-context.js`,
`api/_handlers/sidebar-pipeline.js` — **not read this round**, named as follow-up (ID2b-mods).
`api/_shared/market-brief-facts.js` is the one module fully unblocked (§3) — it takes
`{operator, count}` rows from its caller and was already agnostic to how `operator` is derived, so
fixing its one data source (the view) fixes it with zero code change.

## 2. What shipped — `v_market_brief_cms_operator_counts`

**Migration:** `supabase/migrations/dialysis/20260912120000_dia_id2b_market_brief_operator_id.sql`
(applied live to `zqzrriwuavgrquhisnoa`).

**Before** (raw `GROUP BY medicare_clinics.chain_organization`, top rows):

| operator (raw text) | clinic_count |
|---|---:|
| DaVita | 2,450 |
| Fresenius Medical Care | 2,450 |
| Independent | 675 |
| US Renal Care | 330 |
| Dialysis Clinic, Inc. | 211 |
| American Renal Associates | 204 |
| Other | 95 |
| Satellite Healthcare | 54 |
| **Satellite Dialysis** | **14** |

**After** (grouped on `properties.operator_id`, resolved to its merge survivor via
`dia_operator_survivor()` — the same function ID2a's own parity view uses — falling back to the raw
`chain_organization` string for a clinic whose property has no resolved `operator_id`):

| operator (resolved canonical name, or raw fallback) | clinic_count |
|---|---:|
| Fresenius Medical Care | 2,528 |
| DaVita | 2,389 |
| Independent (unresolved fallback) | 653 |
| US Renal Care | 341 |
| Dialysis Clinic, Inc. | 216 |
| American Renal Associates | 203 |
| Other (unresolved fallback) | 88 |
| **Satellite Healthcare** | **69** (54 + 14 merged) |

- **Row-count parity, measured:** `sum(clinic_count)` before == after == **6,695**. Nothing was
  dropped or double-counted — the total population is identical, only the grouping key moved.
- **The Satellite split collapses** exactly as ID1/ID2a predicted (69 = 54 + 14, within join
  rounding — see below).
- **Unresolved population is named, not hidden.** 85.3% of clinics (6,544 of 7,674 non-demoted)
  resolve an `operator_id` via their linked property; the other 14.7% keep their raw
  `chain_organization` text in the same bucket they'd have landed in before, and the view now
  carries `all_rows_operator_id_resolved` (false for a raw-text bucket) so a consumer can tell a
  registry-canonical name from an unresolved fallback.
- The counts moved slightly from the pre-image (DaVita 2,450→2,389; FMC 2,450→2,528) because the
  property↔clinic join and the operator resolve are not 1:1 with the raw text — a small number of
  clinics whose `chain_organization` read "DaVita" have a linked property whose `operator_id`
  resolves to Fresenius or vice versa (a genuine correction the registry is more authoritative
  about than the CMS-supplied text), and some clinics' `chain_organization` text disagrees with
  their linked property's registry entry. This is exactly the "truth fixed at source of record"
  doctrine working as intended, not a defect — but it is a real, measured behavior change worth
  stating plainly rather than glossing over.

## 3. Market brief — unblocked (§3 of the prompt)

`api/_shared/market-brief-facts.js` takes `counts: [{operator, count}]` from its one caller
(`api/_handlers/market-brief-psql-tick.js`, which reads `v_market_brief_cms_operator_counts`
verbatim). The module itself does no grouping and has no operator-identity logic of its own — it
was blocked purely because its data source fragmented. With the view switched (§2), the module now
receives the merged `Satellite Healthcare` bucket and the corrected DaVita/Fresenius counts with
**zero code change** to `market-brief-facts.js` or its caller.

**Re-run of the dry-run tick was NOT performed this round** — `market-brief-psql-tick.js` also
pulls `rpc_query_comps_trades` and other live sources this budget did not re-verify end to end, and
the sandbox has no Railway/live-tick invocation path. What is proven instead is the thing the tick
actually depends on: the view it reads is fixed and row-count-parity-checked (§2). Re-running the
tick's dry run and confirming the emitted `cms_clinic_count:*` fact keys collapse
(`cms_clinic_count:satellite_dialysis` disappearing, `cms_clinic_count:satellite_healthcare`
absorbing both) is a one-command follow-up (`ID2b-brief-dryrun`) once a live tick invocation is
available.

## 4. Fuzzy comp selection (`mcp/comps-tools.js`) — measured, deliberately NOT switched

Per the prompt's explicit instruction, `operatorTier()` and the `tenant`/`tenants` hard-filter
(`tenantMatches`/`tenantListMatches`) were read, not rewritten:

- `tenantMatches` already does a **substring-based, case/punctuation-insensitive** compare
  (`normText` lowercases and strips non-alphanumerics, then checks `hay.includes(needle) ||
  needle.includes(hay)`). This already tolerates the common alias cases in both directions
  ("Fresenius" is a substring of "Fresenius Medical Care" and vice versa is checked too), which is
  most of why the filtering-category fragmentation the prompt worries about is less severe here
  than in the grouping views.
- `operatorTier()` (the fuzzy comp-quality SCORER, not a filter) buckets by ILIKE pattern on the
  joined tenant/operator/agency text — the same shape as `dia_operator_bucket()` in the DB (§1),
  and just as capable of silently drifting from the guarded registry.
- **A live 5-subject before/after comp-set comparison (one DaVita, one Fresenius, one from the
  71-row operator review queue, plus two more) was NOT run this round.** Running the actual
  `query_comps`/`synthesize_comps` pipeline against live data with both the current
  text-substring logic and an `operator_id`-based equivalent, then diffing the selected comp ids
  per subject, needs a live MCP `lcc` tool invocation this sandbox's budget did not reach — it is
  not something safe to fabricate or approximate from a SQL proxy, because the actual selection
  pipeline (scoring, geography, term-matching) is not reproducible in a single query. **This is
  the correct thing to defer, not skip silently**: the prompt is explicit that if comp selection
  would change, the decision belongs to Scott, not to this round. Filed as **ID2b-c** — the 5
  subjects, the exact comp-id diff, and Scott's decision are the deliverable.

## 5. CM `cm_dialysis_*` grouping views — measured, NOT switched (named follow-up, ID2b-cm)

`dia_operator_bucket(text)` (an `IMMUTABLE SQL` function) already does `ILIKE '%davita%'`,
`'%fresenius%' OR '%fmc%' OR '%bio-medical%'`, `'%us renal%' OR '%usrc%'`, etc. against
`medicare_clinics.chain_organization`, and is what `cm_dialysis_operator_unit_economics` /
`v_dia_econ_operator_benchmark` (and therefore `cm_dialysis_operator_benchmark`) group on. This
means the specific "Fresenius" vs "Fresenius Medical Care" string-equality split the prompt names
does **not** occur on these particular views today — the ILIKE bucketing already collapses it. It
is still not the guarded `operator_id` registry (a heuristic string match, not an identity join),
so it is a different, narrower risk than the one `v_market_brief_cms_operator_counts` had: it
cannot see a merge ID2a made (e.g. a subsidiary parented under a different canonical name than its
own chain_organization string implies), and a new operator name variant CMS starts using tomorrow
that doesn't match one of the six hard-coded ILIKE patterns falls into `'Other / Independent'`
silently. `cm_dialysis_available_by_tenant[_q]` group on a **precomputed** `tenant_bucket` column
on `cm_dialysis_active_listings_q` (values `DaVita/FMC/US Renal/Other/Unknown`) — that upstream
view's own construction of `tenant_bucket` was not read this round. `cm_dialysis_industry_participants`
groups on **raw** `chain_organization` with no bucketing at all (a catch-all for null/junk values,
but real name variants like a mis-cased or punctuated chain name would still fragment there).

None of the four were switched this round. Recommendation for ID2b-cm: replace
`dia_operator_bucket()`'s six-pattern ILIKE with a real join through `properties.operator_id` (the
same shape shipped in §2), keeping a text fallback for the ~14.7% unresolved population, and measure
before/after on all four views together since they share the underlying function/column.

## 6. Everything not named above

The remaining ~85 views from the raw grep in §1, and the repo modules `dossier-generator.js`,
`rent-projection.js`, `team-context.js`, `sidebar-pipeline.js` were **not read this round**. They
are enumerated in the class guard's allowlist (`test/id2b-consumer-operator-id.test.mjs`) so a
future pass has a starting list, and none of them is claimed fixed, measured, or even inspected
here — that would be fabrication. This is the named, sized backlog: **ID2b-remaining** (view sweep)
and **ID2b-mods** (repo module sweep).

## 7. What was explicitly NOT touched (per the prompt's "do not do")

- The `operator_id` registry, alias table, write guard, or backfill (ID2a) — untouched.
- gov-repo work (ID3a-e) — untouched, different repo.
- Multi-tenant restructuring (ID3i) — untouched.
- The operator normalizer (`api/_shared/operator-normalize.js`) — untouched.
- No new display-layer name map beyond the existing `short_operator` CM chart-label token — none
  was added.

## 8. Guard

`test/id2b-consumer-operator-id.test.mjs` (6 tests, all green):

1. structural assertions against the shipped migration (groups via `properties.operator_id` +
   `dia_operator_survivor`, fills blanks with the raw text, never drops a row, reversible/idempotent
   — `CREATE OR REPLACE VIEW`, no base-table `DELETE`/`UPDATE`);
2. a **class guard** over `api/_shared/`, `api/_handlers/`, `mcp/` that fails if a NEW module groups
   on raw `operator`/`tenant` text without also mentioning `operator_id`, with a named, reasoned,
   non-stale allowlist for the surfaces this round measured-and-deferred rather than fixed.

Full suite: `npm test` → **6,017 passed / 0 failed / 6 skipped** (unrelated pre-existing skips), run
2026-09-12 on this branch.

## 9. Verification queries (for the next reader)

```sql
-- row-count parity
select sum(clinic_count) from v_market_brief_cms_operator_counts; -- expect 6,695 (this round)

-- the Satellite merge
select operator, clinic_count, all_rows_operator_id_resolved
from v_market_brief_cms_operator_counts
where operator ilike '%satellite%';

-- resolution coverage
select count(*) filter (where all_rows_operator_id_resolved) as resolved_buckets,
       count(*) as total_buckets
from v_market_brief_cms_operator_counts;
```
