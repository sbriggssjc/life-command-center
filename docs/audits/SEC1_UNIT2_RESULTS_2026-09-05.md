# SEC1-unit2 results — gov sharp two locked, LCC Opps 62 triaged (not swept), dia dedupe ported

Prompt: `docs/claude-code/prompts/SEC1-unit2-gov-sharp-two-and-the-62.md`. Mechanism: CLAUDE.md
§"SECURITY DEFINER PRIVILEGES — the canonical statement" (not restated here).

## Unit 1 — gov, SHIPPED and behaviourally re-probed

Migration `sec1_unit2_lock_gov_sharp_functions` (applied live to gov `scknotsqkcheojiaewwh`),
committed as `supabase/migrations/government/20260905150000_gov_sec1_unit2_lock_sharp_functions.sql`.

| function | before | after | real caller | re-probe |
|---|---|---|---|---|
| `gov_apply_om_confirmed_noi(bigint,numeric,date,text,boolean)` | anon+auth executable (a prior migration revoked PUBLIC but Supabase's default-privilege anon/authenticated grants survived — the exact two-grant mechanism the canon describes) | `anon`/`authenticated` false, `service_role` true | `api/_handlers/om-comp-resolver.js` via `domainQuery('government', …)` — service_role key, verified in source | Ran the caller's exact shape (`p_dry_run=true`) in a rolled-back transaction post-revoke: returned a correct dry-run decision (`decision: "dry_run"`, real prior/new NOI) |
| `gov_truncate_sam_public_staging()` | anon+auth executable, no arguments, TRUNCATEs | locked | `government-lease/src/ingest_sam_public_extract.py` via `supabase_local.get_client()`, which is hard-coded to `SUPABASE_SERVICE_ROLE_KEY` (raises if unset — cannot silently fall back to anon) | Rolled-back call post-revoke: `{"ok":true,"cleared":0}` |
| `gov_match_sam_public_extract(boolean,text)` | anon+auth executable | locked | same Python script, same service-role client | Rolled-back call post-revoke: `{"ok":false,"error":"staging is empty — load an extract first"}` — a real domain response, not a permission error |
| `gov_pse_propagate_to_sale()` | anon+auth executable, `returns trigger` | locked | B6c-dup's `sales_transactions` propagation trigger (fires on `INSERT`, no `EXECUTE` check applies to a trigger) — locked for tidiness, not urgency, per the prompt's explicit instruction |  |

**Census check (the test that a revoke hit its intended population and nothing else):** gov's
anon+mutating-definer count (non-trigger, SECURITY DEFINER, body containing INSERT/UPDATE/DELETE/
TRUNCATE) went **5 → 1**. The residual 1 is `gov_check_queue_slas` — one of the four `*_check_*`
monitors named in the prompt as the `compute_feed_freshness` SHAPE. Left anon **as a deliberate
result**: it is a monitor, matches the documented exception pattern exactly, and was not touched.

## Unit 2 — LCC Opps 62, triaged, NOT swept

Live census reproduced exactly at **62** (query: `pg_proc.prosecdef AND has_function_privilege('anon',…,'EXECUTE') AND prorettype <> 'trigger'::regtype AND body ~* '(insert into|update |delete from|truncate)'`).

**What was done:** every function's signature, whether it builds dynamic SQL, and whether a caller
exists in this repo's `api/`/`mcp/`/`scripts/` trees was censused (below). **What was NOT done, and
is filed rather than guessed at:** an individual behavioural re-probe of each of the 62, and a
search of deployed artifacts outside this repo (Power Automate flows, other edge functions) for a
caller that uses the anon key directly against Supabase — GOVDUP1-a proved that class of caller can
exist and be invisible to a repo grep, and the same could be true here. **Locking any of the 62
without that check would be exactly the "counter-example already exists, triage don't sweep"
mistake the prompt exists to prevent**, so none of the 62 was revoked this round.

### Full census (62/62), repo-caller count from `api/`, `mcp/`, `scripts/`

| function | args | dynamic SQL | repo callers | note |
|---|---|---|---:|---|
| cm_packet_refresh_start | p_vertical text, p_batch integer | no | 0 | no repo caller found — likely cron-internal (pg_cron calls run as the job owner inside the DB, needing no PostgREST/anon grant at all) |
| cm_packet_refresh_tick | p_vertical text, p_max_wait_sec integer | no | 0 | same as above |
| lcc_a2a_merge_ambiguous_chain_entities | p_dry_run, p_batch_tag, p_group_key, p_limit | no | 0 | A2a merge driver; `p_dry_run` present but not a mitigation (an anon caller passes false) |
| lcc_advance_todos | 11 args | no | 7 | real repo caller(s) found — needs per-caller key check before any lock |
| lcc_annotate_match_disambig_assist | p_decision_id, p_assist jsonb | no | 2 | repo caller found |
| lcc_apply_cleared_tombstones | p_dry_run, p_domains[] | **yes** | 0 | dynamic SQL is over a hard-coded VALUES map of column names, NOT a caller-supplied table (already corrected in CLAUDE.md — not the top of the list) |
| lcc_apply_listing_events_page | p_domain, p_content jsonb | no | 0 | `lcc_mirror_tick` leg; p_domain is caller-controlled — MERGE1-severity shape if reachable |
| lcc_apply_loan_maturity_page | p_domain, p_content jsonb | no | 0 | same shape |
| lcc_apply_owner_backfill | p_map jsonb, p_set_by text | no | 1 | repo caller found |
| lcc_apply_property_attributes_page | p_domain, p_content jsonb | no | 0 | same mirror-tick shape |
| lcc_apply_property_owner_facts_page | p_domain, p_content jsonb | no | 0 | same |
| lcc_autoresolve_todos | 5 args | no | 1 | repo caller found |
| lcc_b1_reopen_below_floor | p_dry_run, p_limit, p_min_value, p_batch_tag | no | 0 | B1 reversal tool |
| lcc_b1_unreopen | p_batch_tag | no | 0 | B1 reversal tool |
| lcc_check_feed_freshness | p_mirror_max_age interval | no | 0 | `*_check_*` monitor shape — candidate deliberate-anon, not verified |
| lcc_check_intake_extraction_provenance | p_dry_run, p_min_rows | no | 0 | monitor shape |
| lcc_check_owner_reconcile_queue_depth | p_threshold | no | 0 | monitor shape |
| lcc_check_provenance_flush_health | — | no | 0 | monitor shape |
| lcc_deal_record_milestone | 7 args | no | 3 | repo caller found |
| lcc_enqueue_sf_update | p_sf_object, p_sf_id, p_fields jsonb | no | 0 | writes an SF-update queue row — check for a webhook caller before locking |
| lcc_finalize_feed_freshness | p_max_attempts, p_grace | no | 0 | feed-freshness family |
| lcc_generate_chain_research_tasks | p_limit, p_min_value, p_auto_min_value | no | 1 | repo caller found |
| lcc_generate_deal_next_steps | — | no | 0 | |
| lcc_health_threshold_tick | p_flow_failure_threshold | no | 0 | monitor shape |
| lcc_ingest_cadence_owner_evidence | — | no | 0 | |
| lcc_ingest_deal_owner_evidence | — | no | 0 | |
| lcc_ingest_domain_owner_evidence | p_dry_run, p_limit, p_batch_tag | no | 0 | P113 owner-evidence feeder |
| lcc_ingest_email_owner_evidence | — | no | 0 | |
| lcc_log_offer | p_deal, p_offer jsonb | no | 2 | repo caller found (also `mcp__lcc__log_offer` — check the MCP tool's key) |
| lcc_mailbox_mirror_requeue_stranded | p_dry_run | no | 0 | |
| lcc_mailbox_mirror_retire_cleared_parks | p_dry_run | no | 0 | |
| lcc_mailbox_reconcile_ack | 4 args | no | 1 | repo caller found — likely a Power Automate flow posting directly; check its key |
| lcc_mark_deal_swept | p_entity_id, p_count | no | 1 | repo caller found |
| lcc_merge_fold_pivot | p_loser, p_winner | no | 0 | entity-merge internal (the P196/MERGE1-sec family — worth a dedicated pass, not this one) |
| lcc_merge_snapshot_loser | p_loser, p_winner, p_note | no | 0 | same family |
| lcc_mirror_tick | 6 args | no | 0 | the cross-DB mirror driver — check pg_cron command text, not just repo |
| lcc_move_queue_ack | 5 args | no | 2 | repo caller found — likely PA flow, check key |
| lcc_move_queue_retire_cleared_parks | p_dry_run | no | 0 | |
| lcc_p112_enroll_workable_owners | p_dry_run, p_floor, p_limit, p_batch | no | 0 | |
| lcc_p116_clear_brokerage_owners | p_dry_run, p_batch | no | 0 | |
| lcc_p116_repoint_polluted_owners | p_dry_run, p_batch | no | 0 | |
| lcc_p116_strip_orphan_suffixes | p_dry_run, p_batch | no | 0 | |
| lcc_p195_check_resurrection | — | no | 0 | |
| lcc_p195_merge_byte_identical | p_dry_run, p_risk_slice, p_group_key, p_batch_tag, p_limit | no | 0 | merge family |
| lcc_reconcile_deal_todo | 5 args | no | 4 | repo caller found |
| lcc_reconcile_owner_evidence | p_entity_id, p_min_confidence, p_write | no | 0 | `p_write` boolean — an anon caller can pass true |
| lcc_reconcile_property_owner | p_entity_id, p_min_confidence, p_write | no | 1 | repo caller found; same `p_write` shape |
| lcc_record_flow_failure | 9 args | no | 0 | flow-health monitor shape — likely PA-flow-posted; check key before locking |
| lcc_record_health_event | 8 args | no | 2 | repo caller found |
| lcc_record_match_assist_agreement | p_decision_id, p_agreed, p_detail | no | 1 | repo caller found |
| lcc_record_owner_evidence | 6 args | no | 0 | |
| lcc_record_property_owner_evidence | 6 args | no | 1 | repo caller found |
| lcc_record_property_twin_assist_agreement | 7 args | no | 1 | repo caller found |
| lcc_record_resolver_retrain | p_run jsonb | no | 0 | |
| lcc_record_sf_assist_agreement | 7 args | no | 1 | repo caller found |
| lcc_record_sf_owner_evidence | p_map, p_source, p_weight | no | 1 | repo caller found |
| lcc_retract_listing_events_apply | 5 args | no | 0 | |
| lcc_retract_listing_events_fetch | p_domain, p_lookback_days, p_max_pages | no | 0 | caller-controlled `p_domain` |
| lcc_set_entity_owner_from_sf | p_entity_id, p_sf_owner_id, p_set_by | no | 1 | repo caller found |
| lcc_supersede_property_owner | p_dry_run, p_batch, p_limit | no | 1 | repo caller found |
| lcc_sync_feed_freshness | p_domain, p_attempt | no | 0 | feed-freshness family |
| lcc_todo_completion_mark_filed | p_processing_log_id | no | 2 | repo caller found |

"0 repo callers" is **not** evidence of no caller — the entire GOVDUP1-a finding was that a real,
live writer can be a deployed edge function or a Power Automate flow this repo does not contain.
The "repo callers > 0" column also does not itself prove the caller uses the anon key or the
service key — `lcc_mailbox_reconcile_ack` / `lcc_move_queue_ack` / `lcc_record_flow_failure` read
like Power-Automate-flow targets by name and deserve that check specifically before any lock.

### Deliberate-anon candidates (named, not verified this round)

`lcc_check_feed_freshness`, `lcc_check_intake_extraction_provenance`,
`lcc_check_owner_reconcile_queue_depth`, `lcc_check_provenance_flush_health`,
`lcc_health_threshold_tick`, `lcc_finalize_feed_freshness`, `lcc_sync_feed_freshness`,
`lcc_record_flow_failure`, `lcc_record_health_event` — all match the `compute_feed_freshness`
SHAPE (a monitor/health-recording function that a cross-surface or webhook caller may need to
reach without a service key). Recorded as **candidates**, not verified — the difference between
"this looks like the shape" and "this is a result" is exactly what the canon warns must not be
skipped.

### Not done, filed as backlog `SEC1-unit2-lock` (next unit)

Individually re-probing and locking any of the 62 needs, per function: (1) a caller found in a
DEPLOYED artifact search (edge functions on all three projects, `cron.job` command text, PA flow
definitions — not just this repo), (2) confirmation of which key that caller uses, (3) a
rolled-back service-role re-probe after the revoke. That is 62 individual investigations and was
not completed in this session's budget. **This is diagnosis, matching the shape of prior
diagnosis-only rounds (A5, C1) in this repo — nothing here was locked.**

## Unit 3 — dia `sf_property_id` pre-link, SHIPPED

Migration `govdup1a_sf_property_identity_dedupe_dia_port` (applied live to dia
`zqzrriwuavgrquhisnoa`), committed as
`supabase/migrations/dialysis/20260905150000_dia_sec1_unit2_govdup1a_sf_identity_dedupe.sql`.

- **Sized first, per the prompt:** 65 rows / 64 distinct `sf_property_id` in
  `pending_updates(field_name='_new_property')`, 15 in the last 30 days, newest 2026-09-03 — one
  fan-out of 64. dia's payload column is **`new_value->>'sf_property_id'`**, not gov's
  `source_context->>'sf_property_id'` — a gov-shaped census would have read 0 and looked clean.
- Ported the gov mechanism verbatim: a durable `dia_sf_property_identity(sf_property_id pk →
  property_id)` map, a `BEFORE INSERT` trigger on `sf_property_staging` that pre-links a row whose
  SF identity is already known (so the writer's own `linked_property_id=is.null` selection never
  reaches it), an `AFTER` trigger that keeps the map current from either writer, and a belt-and-
  braces `AFTER INSERT` on `pending_updates` that also learns the identity from the advisory row.
  Backfilled **64 identities** from the 65 existing advisory rows (earliest `property_id` per
  `sf_property_id` — dia has no `properties.status`/archived concept, unlike gov, so the
  live-vs-archived tie-break does not apply).
- All four new SECURITY DEFINER functions locked to `service_role` in the same migration
  (`revoke … from public, anon, authenticated` + `has_function_privilege()` assertion in-file, per
  `test/sql-definer-privilege-stanza.test.mjs`'s contract).
- **Behaviourally proven, rolled back:** inserting a fresh `sf_property_staging` row for an
  already-known `sf_property_id` pre-linked to the correct `property_id`
  (`match_method='sf_identity_dedupe', processed=true`) instead of leaving it open for the
  auto-create path to mint a duplicate.
- Verification surface: `v_dia_sf_property_fanout` — read it after this ships to confirm no new
  `sf_property_id` mints more than one live dia property.
- **GOVDUP1-a's Unit-c retire arm (`expire_orphan_pending_updates`'s archived-parent sweep) was
  NOT ported** — out of scope for "prevention, not cleanup," and dia's fan-out has not yet produced
  the equivalent stale-advisory backlog gov had (measured at 154 rows there).

## Mutation guard

No new source-level guard was written this round — Unit 1 and Unit 3 both reuse the existing
`test/sql-definer-privilege-stanza.test.mjs` contract (in-migration revoke + assertion), which is
what caught nothing here because both migrations were written to satisfy it from the start (the
GOVDUP1-a precedent: "it worked on its first real opportunity"). There is no NEW guard whose
mutation count to report; Unit 1's and Unit 3's own in-transaction `DO $$ … RAISE EXCEPTION $$`
assertions are the guard, and both passed on first application (no re-run needed).

## Verify on

- `has_function_privilege` false for `anon`/`authenticated`, true for `service_role`, on all 4 gov
  functions and all 4 new dia functions — asserted in-migration, both migrations applied clean.
- gov anon+mutating-definer census: **5 → 1** (`gov_check_queue_slas`, a named deliberate-anon
  monitor).
- dia `sf_property_id` identities: **0 → 64**, and a rolled-back insert for a known id pre-links
  rather than leaving `linked_property_id` null.
- LCC Opps anon+mutating-definer census: **62 → 62** (Unit 2 is diagnosis only this round; nothing
  was revoked).
