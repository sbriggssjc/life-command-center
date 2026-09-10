# Research Workbench (UX-T1b, 2026-09-08)

> **Read first:** `docs/architecture/app-ux-review-2026-09-02.md` rows UX32/UX35/UX36,
> `docs/audits/A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md` (the model this unit copies),
> `docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md` and the C1a-e execution
> commits (`git log --oneline | grep 'C1[a-e]:'`), `docs/os/PLANNED-BACKLOG.md` row **UX-T1b**.

## 0. What this is

The Research page (`ops.js renderResearchPage`, `pageResearch`) used to be one undifferentiated
list over **~18 live `research_type`s**, picked with a flat chip picker
(`researchLanePickerHTML`). That picker already existed and was itself a real improvement over an
earlier, worse state (A1) — but it puts a lane with 0 real completions ever right next to
`establish_ownership_history`, which has 1,336, and gives an operator no reason to know which is
which without reading `v_lcc_research_lane_summary.answerable` themselves.

UX-T1b adds a **workbench** layer on top: one tab per lane that is a genuine human queue TODAY,
each answering one question with one action (the A1/UX49 contract), plus a **Flow Dashboard**
landing page showing the automation/human split per lane. The raw picker is kept, unmodified,
under an **"All (legacy)"** tab — nothing that worked before stopped working.

## 1. Live census (LCC Opps `research_tasks`, measured 2026-09-08 — re-measure before quoting)

```sql
select research_type,
  count(*) filter (where status not in ('completed','skipped')) as open_ct,
  count(*) filter (where status='completed' and (outcome#>>'{}') not ilike '%gap_resolved%') as real_completions,
  count(*) filter (where status='completed') as any_completions,
  count(*) as total
from research_tasks group by research_type order by open_ct desc;
```

| research_type | open | real completions | any completions | disposition |
|---|---:|---:|---:|---|
| `owner_needs_salesforce` | 1,678 | 0 | 0 | C1a-e: `lane_no_consumer`/retire **decided, not executed** — see §3 |
| `property_missing_recorded_owner` | 1,469 | 0 | 3,975 (all `gap_resolved`) | A5/A5a: false throughput, no disposition — **out of scope, gap** |
| `true_owner_needs_salesforce` | 837 | 0 | 528 | C1a-e: `lane_no_consumer`/retire **decided, not executed** — see §3 |
| `establish_ownership_history` | 512 | 1,336 | 1,336 | **workbench tab** — A1 split, 68 human-actionable |
| `owner_contact_manual` | 312 | 0 | 0 | **workbench tab** — P131 decidability, 5 decidable |
| `property_missing_county_record` | 111 | 0 | 0 | no capture path, no disposition — **out of scope, gap** |
| `npi_missing_inventory` | 62 | 0 | 0 | **workbench tab** (`npi`) — already P181-gated at mint |
| `confirm_tenant_mismatch` | 26 | 0 | 0 | **workbench tab** (`followups`) |
| `trace_ownership_to_developer` | 19 | 71 | 71 | has an automated closer — **out of scope, gap** |
| `npi_new_registration` | 19 | 0 | 0 | **workbench tab** (`npi`) |
| `person_email_merge_review` | 8 | 0 | 0 | **workbench tab** (`followups`) |
| `state_lease_distress_review` | 8 | 0 | 0 | **workbench tab** (`followups`) |
| `confirm_deed_transfer_sale` | 4 | 0 | 0 | **workbench tab** (`followups`) |
| `confirm_true_owner` | 1 | 0 | 0 | **workbench tab** (`followups`) |
| `merge_duplicate_entities` | 1 | 0 | 0 | **workbench tab** (`followups`) |
| `systemic_findings_report` | 1 | 0 | 0 | **workbench tab** (`followups`) |
| `news_alert_development_followup` | 1 | 0 | 0 | **workbench tab** (`followups`) |
| `property_missing_true_owner` | 0 | 282 | 282 | dormant — no chip drawn regardless |

Owner Contact and NPI residues, read live off the existing signals rather than invented anew:

- **`owner_contact_manual`** → `v_lcc_owner_contact_decidability` (P131, unchanged by this unit):
  `decidable=true and status<>'completed'` = **5** rows (`bench_restates_owner_or_row_labels` 183,
  `no_candidate_on_file` 123, `public_body_not_prospected` 1 blocked). This is the SAME view UX36's
  doctrine asks for — it already existed, it was simply never wired into the workbench UI.
- **`npi_missing_inventory` + `npi_new_registration`** → both are already the **post-gate**
  population (CLAUDE.md P181: 141 of the original 203 `npi_missing_inventory` rows were dropped as
  unanswerable at mint time; `ever_skipped: 141` on the lane summary confirms it). Every open row
  carries `metadata.best_match_score` (0.500–0.875, `batch: 'p181-npi-gate-20260826'`) except the 19
  `npi_new_registration` rows, which carry no score at all. **No further threshold was invented** —
  doing so would be a new lexical/numeric classification this unit is explicitly barred from adding
  without a producer-side grading pass (out of scope). The NPI tab therefore shows the whole
  post-gate population (81), each card printing `best_match_score` where present so a human can
  triage by confidence without the UI inventing a cutoff.

## 2. Tab structure

| tab | source | action shape | today's count |
|---|---|---|---:|
| **Flow Dashboard** (default landing) | `v_lcc_research_workbench_flow` | none — a rollup with click-through | — |
| **Ownership History** | `research_type=establish_ownership_history` + the EXISTING A1 lane-action split | confirm / route / retire per A1's four (now five, with `sponsor_spe`) buckets | 512 open / 68 human-actionable |
| **Owner Contact** | `workbench=owner_contact` → `v_lcc_owner_contact_decidability` | read → "Find the contact" (P173's existing button) | 312 open / **5** decidable shown |
| **NPI Intel** | `workbench=npi` → `research_type in (npi_missing_inventory, npi_new_registration)` | read the match/registration signal → confirm or dismiss | 81 |
| **Follow-ups** | `workbench=followups` → the 8-type allowlist below | read title/instructions → Complete/Dismiss (existing generic card actions) | 50 |
| **All (legacy)** | unchanged — the pre-existing ~18-entry chip picker + full list | whatever that lane's card already offers | everything, incl. the excluded lanes below |

`followups` allowlist (one shared action shape — read + Complete/Dismiss, all one-off DC-verdict
spawns): `confirm_tenant_mismatch`, `state_lease_distress_review`, `person_email_merge_review`,
`confirm_deed_transfer_sale`, `confirm_true_owner`, `merge_duplicate_entities`,
`systemic_findings_report`, `news_alert_development_followup`.

**Front-door card count: ~4,900 raw open across every lane → 204 across the four workbench tabs**
(68 + 5 + 81 + 50). Everything else is reachable via the "All (legacy)" tab; nothing was deleted.

## 3. Excluded lanes — named, not guessed

- **`owner_needs_salesforce` (1,678 open) / `true_owner_needs_salesforce` (837 open)** — C1a-e
  (commits `74e99b0`…`3b59fc8`) diagnosed and disposed these as `c1c_lane_no_consumer` / retire.
  **Re-verified live 2026-09-08: the retirement was never applied.** Both are still 100%
  `status='queued'`; `lcc_c1c_retire_sf_lanes(p_dry_run boolean default true, …)` exists in
  migration `20260908130300_lcc_c1c_retire_sf_lanes.sql` but has never been called with
  `p_dry_run=false` against production. This is the repo's own "merged is not running" doctrine —
  the SQL function shipped, the sweep that would actually retire the rows has not run. Retiring the
  data is a producer-side operation (calling a write RPC against live rows), explicitly out of this
  unit's scope ("no re-litigating C1a-e … inherit dispositions", "no producer changes"). **Filed as
  UX-T1b-g2** — an operator/cron action: run `select * from lcc_c1c_retire_sf_lanes(false, 'uxt1b-g2', 2000);`
  then re-measure this table.
- **`property_missing_recorded_owner` (1,469 open), `property_missing_county_record` (111 open),
  `property_missing_true_owner` (0 open)** — `answerable=false` on `v_lcc_research_lane_summary`;
  the two non-zero lanes' historical "completions" are 100% the A5/A5a auto-close false-throughput
  defect (`gap_resolved`, never a human/worker verdict); no C-series audit has disposed of these as
  automate/gate/retire the way C1a-e did for the SF lanes; no capture path exists. Building a tab
  for a raw 1,580-row backlog with no known-good disposition would recreate exactly the noise this
  unit exists to remove. **Filed as UX-T1b-g1** — needs its own C1a-e-shaped diagnosis before a tab
  (or a retirement) is warranted.
- **`trace_ownership_to_developer` (19 open, 71 real completions)** — `answerable=false` on the
  summary view, yet it has genuine completions via an automated closer (CLAUDE.md: *"close the loop
  from trace_ownership_to_developer tasks now chain_complete"*, a cron). Its remaining 19 open rows
  may already need no human at all; that requires reading the closer's own logic to confirm, which
  is a producer-side investigation out of this unit's scope. **Filed as UX-T1b-g3.**

## 4. "Flag for research" (UX35)

Found: three literal, unguarded client-side buttons in `dialysis.js` — `.cms-flag-btn` (CMS Data
tab), `.npi-flag-btn` (NPI Intel BD events), `.lease-flag-btn` (Lease Watchlist) — each POSTing
directly from the browser via `applyInsertWithFallback` into `dia.research_queue_outcomes` with
**no server-side validation** and **no bridge to the unified research workbench** (a second,
entirely isolated queue system parallel to `research_tasks`, read back only by `dialysis.js`
itself and `api/admin.js`'s `property_review` arm).

Disposition per UX35's prescription: **narrowed to a guarded code path + review lane**, not
removed (a real producer for these three signals does not yet auto-import equivalent findings, so
the human escalation still earns its place).

- New endpoint: `POST /api/queue?_route=flag-for-research` (`api/queue.js::handleFlagForResearch`).
  Validates `domain` (dialysis/government only), `clinic_id` (required), `queue_type` (one of
  `property_review` / `cms_data` / `npi_intel` / `lease_watchlist`). Writes an idempotent upsert to
  `research_queue_outcomes` on the table's own `UNIQUE(queue_type, clinic_id)` (the real dedup
  already lived at the DB layer per the existing `dialysis.js` comment on that constraint — the gap
  was validation and visibility, not duplicate risk), then best-effort creates a linked
  `research_tasks` row (`research_type='clinic_manual_flag'`) so the flag surfaces on the workbench
  **Follow-ups** tab. A research_task write failure never undoes the queue write (the human-visible
  flag already landed) — logged, not fatal.
- Client rewire: all three buttons now call a shared `flagForResearchGuarded(id, name, queueType, notes)`
  helper (`dialysis.js`) that POSTs to the new endpoint instead of writing directly.
- **NOT rewired, named as a gap:** `research_queue_outcomes` has at least 5 other writer call sites
  in `dialysis.js` (clinic-lead save, dismiss actions, property-review resolution) with different
  intents (save/resolve, not escalate); rewiring those was out of scope for this unit and is not a
  UX35 "Flag for research" instance.

## 5. Deployment reality

- **JS changes (`api/queue.js`, `ops.js`, `dialysis.js`) need a Railway redeploy of merged `main`**
  before any of this is live — "merged is not running." The migration (`v_lcc_research_workbench_flow`)
  is live the instant it is applied (already applied to LCC Opps directly during this build, in
  addition to being committed as a migration file, so the DB and repo agree).
- **No edge-allowlist change needed anywhere in this unit.** Every new read
  (`v_lcc_research_workbench_flow`, `v_lcc_owner_contact_decidability`) is server-mediated via
  `opsQuery` (LCC Opps service key), not a browser-side `diaQuery`/`govQuery` tile — the
  `DIA_READ_TABLES`/`GOV_READ_TABLES` edge allowlist only gates the latter. The
  `flag-for-research` write goes through `domainQuery` (server-side, service-key), same reasoning.
- **Pagination is real, not silently truncated** — the `workbench` param rides the SAME
  `page`/`per_page` → `limit`/`offset` machinery A1 already fixed for `lane_action`
  (`researchPagination`), and `owner_contact` pages the decidability view server-side exactly like
  `fetchOwnershipLaneTaskIds` pages the ownership split (count=exact on the WHOLE filtered set,
  never the page). `npi`/`followups` use a plain PostgREST `limit`/`offset` + `count=exact` on the
  `research_type in (...)` filter — no cap silently drops rows below page 1.
- **Chips filter server-side, and the chip count gates on the same predicate as the list** (the
  P139 lying-badge rule): the Flow Dashboard's `human_needed_tasks` count is produced by the SAME
  SQL view the tab's list query effectively narrows to (the decidability view for `owner_contact`,
  the A1 split's `human_actionable` for `ownership_history`), not a client-side re-derivation.

## 6. Guard

`test/uxt1b-workbench-lane-parity.test.mjs` (7 tests, mutation-verified):
1. the SQL migration's `lane_defs` CTE and the JS `workbench-lane.js` exports carry the identical
   `research_type` vocabulary per lane (parses both, diffs the arrays) — a JS mirror of a SQL
   classifier is the normaliser-drift footgun this repo has been bitten by repeatedly;
2. the four lane keys are exactly `ownership_history`/`owner_contact`/`npi`/`followups` on both
   sides;
3. every excluded lane is named in the migration header (not silently dropped from the census);
4. v1 `case 'research'` and `v2GetResearch` in `api/queue.js` both wire the `workbench` param
   (parity — the P132/A1 lesson: a param added to one branch and not the other silently stops
   filtering the moment `queue_v2_enabled` flips, with no error);
5. both echo `workbench` on the response;
6. the `research_workbench_lanes` view case is registered;
7. positive control — a divergent SQL array is caught by the parity check.

## 7. What was NOT touched (explicitly out of scope, per the task spec)

- No producer changes: A2/A3/A4/A5c value gates, W5.2 NPI routing, ingestion — untouched.
- No re-litigating C1a-e's automate/gate/retire calls (inherited as-is; §3 records that the SQL
  side of C1c has not actually been executed, which is a fact about deployment, not a re-litigation
  of the decision).
- No Decision Center bucket-by-bucket audit — that is UX-T1c.
- No Today re-cut — UX-T1a-today already shipped.
- No new lexical/regex classification — the NPI tab reads the existing `best_match_score` signal
  verbatim rather than adding a threshold; the Owner Contact tab reads the existing P131
  decidability view verbatim.

## 7b. `county_records_needed` — SIZED, NOT SHIPPED (PR-scanner-writeback, 2026-09-10)

`public-records-source-lane.md` §7 item 4 called for a `county_records_needed`/`sos_research_needed`
`research_type` folded into this workbench, to rank which owners/properties still need a manual
county/SOS lookup (the population the new sidepanel Save flow in §7a actually captures against).
**Not built this round.**

- **Why:** every value-gate this repo has shipped (`{dia,gov}_research_gate_value_floor()` = $500k,
  P161's weak-role floor, C2a's asset-mint curve, B1's chain-lane split) was calibrated against a
  LIVE population read off the production databases, then the predicted delta was checked against the
  measured one before shipping (A2's `on conflict do nothing` overcount, C2e-T2a's ±2-row canonical-key
  miss — both caught only because a prediction existed to compare against). This session has **no
  Supabase/DB access**, so there is no way to measure: how many properties/owners actually lack an
  assessor or SOS record on file, what the rent distribution of that population looks like (to pick a
  floor, or confirm $500k transfers), or what `research_workbench_lanes`/`v_lcc_research_lane_summary`
  would report post-ship. Shipping a migration and a floor without that is exactly the "we must
  acquire the data" / unmeasured-write mistake CLAUDE.md documents paying for repeatedly (B4/B5, N18).
- **Where it should fold in, decided but not executed:** into `establish_ownership_history`'s
  EXISTING split (`v_lcc_ownership_history_lane_split`, the A1/A2/A3/A4/A4b action vocabulary) as a
  SIXTH action — `county_records_needed` — rather than a brand-new `research_type`, because the split
  already asks "why can't this chain be confirmed automatically" per property, and "we have no county
  record on file at all" is one more disposition in that same question, not a separate lane. This
  mirrors A3's `sponsor_spe` precedent (a fifth action added to the same split, never folded into
  `agrees` because it is a materially different decision). The value gate is the split's existing
  `human_actionable` floor (`lcc_chain_human_value_floor()`), not a new one — B1 already established
  that this lane's human-facing gate must be per-lane and named, not a fourth repeat of the $500k
  literal.
- **What would need to be measured before shipping:** (1) population — properties in
  `v_lcc_ownership_history_lane_split` whose chain is blocked purely on a missing county/SOS record,
  cross-referenced against `parcel_records`/`deed_records` coverage (§2's producer-set diff, Class 20);
  (2) whether the population overlaps `no_records`/`all_guarded` (A4/A4b already retire/adjudicate part
  of this) — a new action must not duplicate an existing one; (3) the predicted vs. actual delta on
  `v_lcc_research_lane_summary.open_tasks` for this lane before and after, per the A2/C2e-T2a
  discipline.
- **Filed:** `PLANNED-BACKLOG.md` §P3/PR-scanner (row `PR-scanner-3`).
