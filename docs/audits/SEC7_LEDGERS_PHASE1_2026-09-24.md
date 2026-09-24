# SEC7-LEDGERS — phase 1 of SEC7: the ledgers the app trusts to decide identity (2026-09-24)

Backlog: `SEC7`, `DIA-REDIRECTS-ANON-WRITE`, `MERGELOG-GAP-broken-chains`, new `SEC7-views`, `SEC7-policy-withcheck`, `SEC7-phase-2`.
Migrations (applied live 2026-09-24):
- dia → `life-command-center/supabase/migrations/dialysis/20261013130000_dia_sec7_ledgers_lock.sql` (LCC owns Dialysis_DB schema)
- gov → `government-lease/sql/20260924_gov_sec7_ledgers_lock.sql`

Guards (behavioural; a throwaway Postgres cluster seeded with the live pre-lock shape, then the real migration file):
- `life-command-center/test/sec7-dia-ledgers-lock.test.mjs`: 12 tests, 8 of them mutations
- `government-lease/tests/unit/test_gov_sec7_ledgers_lock.py`: 28 tests, 7 of them mutations

## 1. What was locked

| DB | object | before | after |
|---|---|---|---|
| dia | `dia_property_redirects` | RLS off, anon/auth `arwdDxt` | RLS on, `service_role_all_*` policy, anon/auth no grants |
| dia | `dia_property_merge_backup` | same | same |
| dia | `v_dia_property_redirect_resolved` | anon/auth `arwdDxt`, **auto-updatable definer view** | service_role SELECT only |
| gov | `gov_property_merge_backup` | RLS off, anon/auth `arwdDxtm` | RLS on, service-role policy, no client grants |
| gov | `gov_agency_aliases` | same | same |

Sequences behind each key were revoked too. Each DB also gets a standing guard, `<dom>_sec7_ledger_privilege_violations()`. It is invoker rights and service_role-only, and returns one row per client privilege or disabled RLS flag that should not exist. It reads **0** live on both DBs.

`property_merge_log` (dia) already had RLS on with no policy. anon keeps its grants there, but every write matches zero rows or is refused, so it was left alone.

### ⚠️ The view was a second write path, and a table-only fix would have left it open

`v_dia_property_redirect_resolved` is a single-table definer view (`security_invoker` unset). Postgres therefore makes it auto-updatable (`is_updatable = YES`, `is_insertable_into = YES`). A write through it runs as the view **owner**, and the owner bypasses RLS. Measured live before the lock (rolled back): anon `UPDATE v_dia_property_redirect_resolved SET note = …` wrote the base row. The dia guard's mutation `without the view revoke` shows the base-table lock alone does not close it: anon re-points a redirect through the view.

## 2. Writers (inventoried before locking)

Sources: the live catalog (`pg_get_functiondef` grep, `cron.job`, `pg_trigger`, view dependencies), `edge_logs` for 2026-09-17..24 (one 24h window per call; the 19th returned a fetch error on dia), and a grep of all three repos.

| table | writer | role | still works after lock (rolled back) |
|---|---|---|---|
| dia both | `dia_merge_property_reversible`, `dia_unmerge_property` | SECURITY DEFINER, owner postgres; EXECUTE service_role only | ✅ +1 backup, +1 redirect; unmerge sets `unmerged_at` + reverses the redirect |
| dia redirects | `dia_consolidate_property_reviewed`, `merge_dialysis_dup_property` | definer, service_role only | ✅ each wrote its redirect |
| dia redirects | `dia_merge_property` via cron 16 `dia_auto_merge_property_duplicates` | cron as postgres | ✅ |
| dia both | Railway `merge-log-reconcile.js` PATCH `reconciled_lcc_*` / `unmerge_reconciled_lcc_*`; `sidebar-pipeline.js` GET backup; GET view | service_role (edge_logs: 961 + 591 PATCH, 28 + 5 GET on 09-24, UA `node`) | ✅ |
| dia both | Dialysis `src/merge_property_twins.py` | calls the definer RPCs above | ✅ (they are service_role-only already) |
| gov backup | `gov_merge_property_reversible`, `gov_unmerge_property` | definer, service_role only | ✅ |
| gov backup | Railway reconcile stamp PATCH / GET | service_role (1 PATCH, 28 GET) | ✅ |
| gov aliases | none in SQL; one-shot migration statements (ID3a-c, REGISTRY2, AVAIL2) as postgres | postgres | n/a |
| gov aliases | readers: `gov_resolve_agency` (invoker; EXECUTE postgres + service_role only), cron 53 `gov_registry2_agency_id_tick` (postgres), `v_available_listings` / `v_sales_comps` via service_role, definer view `v_gov_agency_registry_health` | — | ✅ resolver returned `SSA` / `TX-HHSC`; listings view 16 codes in 20 rows; anon still reads the health view |

**Zero anon or authenticated REST requests** reached any of the four tables in the 7 days of logs. No edge function references them, and no Power Automate flow names them.

Found in passing and not changed: as `authenticated`, `v_available_listings` / `v_sales_comps` fail with `42501 permission denied for function gov_resolve_agency`, and as anon they return 0 rows. That break predates this change: `gov_resolve_agency` was narrowed to service_role in REGISTRY2. Filed as `SEC7-gov-invoker-views`.

## 3. The 15 broken redirect chains (`MERGELOG-GAP-broken-chains`)

**None is a bad write.** All 15 have `source = 'backfill_property_merge_log'`. They were created in one statement on 2026-09-11 14:02:43 (PDR14a's backfill from `property_merge_log`), and each matches its `property_merge_log` row exactly (`keep_id`, `drop_id`, `merged_at`).

They break because **11 distinct kept rows were later deleted with no record anywhere**: no redirect, no `dia_property_merge_backup`, no `property_merge_log` row as a drop, nothing in `dq7_property_merge_map`, `property_cms_link_history` or `ownership_history`. The deletes happened between 2026-04-29 and 2026-05-15. That is before PDR14a made `dia_merge_property` write a redirect on every merge. The redirect ledger therefore cannot know where they went, and neither can any other ledger we hold.

| redirect(s) | dropped → kept (gone) | LCC entity | new evidence |
|---|---|---|---|
| 631 | 37613 → 35601 | `1bc862e2…` (2860 US Hwy 83 S, Zapata TX) | one live property at that address: **23551** (has a CCN). Single signal, as MERGELOG-GAP already recorded (`candidate`) |
| 627, 9 | 37607 → 22438 → 37734 | `b1a3c739…` (430 Southridge Pkwy, Culpeper VA) | one live property at the address: **29456** (has a CCN). Single signal; MERGELOG-GAP said `unknowable` |
| 1263, 1060, 673 | 3695893 / 39710 → 37758 → 39931 | `ebcebd4e…` ("1117 Arlington Ave", no city) | one live property on that street: **24821** (1117 Arlington Ave N, St Petersburg FL). Single signal, and the entity has no city |
| 738 | 38032 → 30828 | `f3ddf327…` (2494 Second St, Macon GA) | no live property at the address |
| 1122, 1191 | 39908 / 40023 → 26734 | `e62ad611…` ("2329 N 39th St") | none |
| 1146 | 39948 → 33738 | `5cb28e0e…` ("200 S Park Pl") | none |
| 672, 256, 476, 972, 594 | 37755→28321, 32205→38100, 35873→38692, 39249→30234, 37377→39820 | none | nothing to repair: no entity points at either end |

**No chain was repaired.** MERGELOG-GAP's evidence rule requires a merge ledger or two independent signals, and an address alone is one. The three address hits are recorded here as candidates for the existing review lane. `v_dia_property_redirect_resolved` keeps reporting them as broken, and that is correct.

The lesson for the class: **a deletion path that writes no ledger makes every ledger that points at its victim unrepairable.** Since PDR14a, `dia_merge_property` writes a redirect. What deleted these 11 rows in April–May is unknown, and it is not in the live catalog today.

## 4. Inventory for phase 2 (not flipped)

Live counts of tables with **RLS off and anon INSERT/UPDATE/DELETE**:

| DB | cowork round 77 | after this change |
|---|---:|---:|
| Dialysis_DB | 60 | **58** |
| gov | 50 | **48** |
| LCC Opps | 124 | **124** |

The census moved by exactly the predicted amount. The table census alone **undercounts the exposure**, because two more write paths do not show in it:

| class | dia | gov | LCC Opps |
|---|---:|---:|---:|
| RLS **on**, but a policy lets anon write | 17 | 3 | 21 |
| definer view, auto-updatable, anon holds write | 9 | 7 | 21 |

### Classification of the RLS-off tables (by name and measured writers)

- **dia 58:** 14 backup/snapshot tables (`_dia_*`, `_sale1*`, `_pr2_*`), 15 run/audit logs, 6 review queues, and **~15 trust-bearing tables** (rent truth, econ truth, aliases, identity, merge policy, registry). Also `hcad_real_acct_stage` (98.8k, staging) and 5 empty/unused.
- **gov 48:** 22 dated backup tables, 12 run/review logs, **~7 trust-bearing** (`gov_merge_child_policy`, `gov_sf_property_identity`, `gov_b5_transition_feed_log`, `cm_report_snapshots`/`_commentary`, `gov_agency_resolution_review`, `gov_owner_merge_review_log`), 7 staging/unused.
- **LCC Opps 124:** ~40 run/audit logs and dated backups, ~30 review/batch queues, **~20 trust-bearing** (below). The LCC Opps anon key ships in the SPA (GoTrue sign-in), so this project's exposure is the most reachable.

### Top 20 by risk

Ranked by *what one anon write could change that a surface or a decision trusts*. Items 1–3 were **proven live** with a rolled-back anon write.

| # | DB | object | path | why | writers |
|---|---|---|---|---|---|
| 1 | gov | `v_ownership_history_portfolio` → `ownership_history` | updatable definer view | **anon UPDATE matched all 12,697 rows** (proven, rolled back). Ownership chains feed LCC supersession and the owner surfaces | ownership feeders in SQL; LCC reads via anon `pg_net` (SELECT only) |
| 2 | dia | `v_sales_feed_portfolio` → `sales_transactions` | updatable definer view | **anon UPDATE matched all 5,009 rows** (proven). The comps spine, CM book, cap-rate history | ingestors as service_role; LCC reads via anon (SELECT only) |
| 3 | dia | `ingestion_tracker` | RLS on, but `ingestion_tracker_service_role_rw` is `USING (auth.role()='service_role') WITH CHECK (true)` | **anon INSERT of a `run_status='watermark'` row succeeded** (proven). That status arms CMS change-detection, so one row can silence CMS ingestion | `src/ingestion_tracker.py`, `ingestion_lock` (service_role) |
| 4 | gov | `property_sale_events` | policy `Allow anon write` (ALL, true) | an insert propagates through `trg_gov_pse_propagate_to_sale` into `sales_transactions` | LCC `entities-handler.js` (operator panel) |
| 5 | LCC | `lcc_property_owner` (10.9k) | RLS off | the owner of record on every asset panel and the BD queue | 8 SQL writers; `operations.js`, `entities-handler.js`, `sf-seller-owner.js` |
| 6 | LCC | `lcc_property_owner_evidence` (17.3k) | RLS off | the reconcile re-elects from it; a planted row wins the next pass | 6 SQL writers; `scripts/feed-gov-ownership-transitions.mjs` |
| 7 | LCC | `lcc_entity_owner_override` | RLS off | point person drives `v_my_work_scoped` (access scoping) | 5 SQL writers; `broker1-assign.js` |
| 8 | LCC | `lcc_entity_merge_log`, `lcc_p195_merge_log`, `lcc_a2a_merge_log` | RLS off | the only undo ledgers for entity merges (66 P195 merges are reversible from nothing else) | `lcc_merge_entity`, P195/A2a functions |
| 9 | dia+gov | `dia_merge_child_policy`, `gov_merge_child_policy` | RLS off | the merge path reads it to choose fold vs delete per child table | migrations only |
| 10 | dia | `dia_operator_aliases` | RLS off | operator resolver (ID1/ID2a), same shape as `gov_agency_aliases` | `dia_id2a_seed_registry_aliases`, `dia_id2a_resolve_review` |
| 11 | dia+gov | `dia_sf_property_identity`, `gov_sf_property_identity` | RLS off | Salesforce↔property identity | `*_sf_identity_record` |
| 12 | dia | `property_rent_timeline` (156k), `rent_evidence_provenance`, `rent_reconcile_queue` | RLS off | rent truth for comps/BOV | `dia_build_property_rent_timeline` + 10 other SQL writers |
| 13 | dia | `clinic_econ_reconciled` (81k) | RLS off | revenue truth, denormalised into `medicare_clinics` | `dia_reconcile_clinic_econ`, `dia_apply_ebitda_dna` |
| 14 | dia | `salesforce_accounts` | policy `Allow anon full access` | SF account mirror used by ownership linking | Dialysis `ownership_linker.py` |
| 15 | dia | `lease_rent_schedule`, `lease_extensions`, `lease_options` | anon write policies | lease terms feed rent projection | LCC `entities-handler.js` |
| 16 | dia | `facility_patient_counts` | policy `ingestor_can_insert` (anon, authenticated) | census series; an insert with a new `snapshot_date` becomes "latest" | `patient_count_ingestor` |
| 17 | dia | `cmbs_loans`, `cmbs_loan_properties` | same `WITH CHECK (true)` shape as #3 | debt / distress signal | CMBS ingest |
| 18 | gov | `gov_b5_transition_feed_log` | RLS off | `gov_unfeed_sales_transitions` reverses by it; a planted row makes an unfeed delete real history | `gov_feed_sales_transitions` |
| 19 | LCC | `lcc_mirror_sync_watermark` | RLS off | cross-DB mirror cursor; moving it skips pages silently | `lcc_mirror_tick` |
| 20 | gov | `cm_report_snapshots`, `cm_report_commentary` | RLS off | published Capital Markets content | `capital-markets.js` |

### Phase-2 notes

- **Views first.** For the updatable-definer-view class, the fix is `REVOKE INSERT, UPDATE, DELETE, TRUNCATE … FROM anon, authenticated` on each view, keeping SELECT. The LCC `pg_net` anon pulls read these views and never write, so it changes no reader. Before applying, confirm with `edge_logs` that no `POST|PATCH|DELETE /rest/v1/v_*` exists. This is the cheapest, highest-value phase-2 step (`SEC7-views`).
- **Half-written policies.** `USING (auth.role() = 'service_role') WITH CHECK (true)` blocks reads and updates but **not INSERT** (an insert is checked only against WITH CHECK). Fix by dropping the policy for a `TO service_role` one (`SEC7-policy-withcheck`).
- Dated backup tables are the safe bulk of every census: revoke-all with no reader, then consider archiving.
- Run the LCC Opps flip on a Supabase branch first, as SEC7 says: the SPA uses the anon/authenticated roles against this project.
