# Data & Pipeline — Gaps & Findings Register

**Maintained from:** 2026-05-20. **Purpose:** the single circle-back list of everything found and its status, so nothing is lost as the infrastructure is built out. Status legend: ✅ fixed live (reversible) · 🔧 spec'd for branch · ⏸ deferred (dependency) · ⚠ open/needs decision.

---

## A. Data-quality (DQ-1…DQ-10) — audit + remediation
| ID | Finding | Status | Where |
|----|---------|--------|-------|
| DQ-1 | Implausible cap rates counted in metrics (gov 458 >10%, dia 55 <3%) | ✅ excluded + tagged | `DATA_INTEGRITY_REMEDIATION_LOG` |
| DQ-2 | Triple-pipeline duplicate sales (dia 446, gov 203) | ✅ excluded w/ survivor ref | same |
| DQ-3 | gov listings not closed + status casing | ✅ normalized + 5 closed | same |
| DQ-4 | Ownership-chain breaks (free-text buyer/seller) | ⏸ needs entity-linking (see C) | same |
| DQ-5 | Owner dedup (≈3,156 merged, ≈4,637 FK repoints) | ✅ merged + logged | same |
| DQ-6 | Facility-name-as-address (~466) | 🔧 geocode/review queue | worklist |
| DQ-7 | Placeholder property fan-out (9,019 quarantined) + 23 real dups merged | ✅ + collision views | same; `DQ7_*` |
| DQ-8 | Lease anomalies (1 dia inverted, 11 gov multi-active) | 🔧 surfaced for review | same |
| DQ-9 | Unlinkable/undated rows flagged | ✅ flagged | same |
| DQ-10 | gov NULL-price "sales" (ownership stubs) | ✅ reclassed/flagged | same |

## B. Pipeline / scheduling / silent failures
| ID | Finding | Status | Where |
|----|---------|--------|-------|
| P-1 | LCC Opps connection exhaustion (no pooler, dense */5 crons) → outage | ✅ restarted; 🔧 pooler + stagger | `INTAKE_FIXES_ADDENDUM` §1 |
| P-2 | `staged_intake_items` status bug: matcher writes `review_needed` (invalid) / promote writes `promoted` | 🔧 one-line fixes | `INTAKE_FIXES_ADDENDUM` §2 |
| P-3 | OM extractor pins subject to office/contact-block address (6120 S Yale) | ✅ 11 flagged+tracked; 🔧 `isOwnFirmAddress` guard | `INTAKE_FIXES_ADDENDUM` §3 |
| P-4 | **dia `auto-link-and-refresh-property-queue` 100% failing** (~2,935/3d, medicare_id unique violation) | ✅ hardened: 1a guard (skip in-use medicare_id) + 1b per-row isolation→alert + 1c per-linker isolation w/ unconditional MV refresh + 1d dropped dead no-arg overloads, cadence */1→*/15; verified green run (errors:[]) | live on dia, `AUTO_LINK_FIXES` Fix 1 |
| P-5 | dia `auto-merge-property-duplicates` timing out (~929/7d, 53%) → dup buildup | ✅ root cause = `ingestion_log` shared-row write-mutex (AFTER-stmt `stamp_ingestion_log` upserts one row per source; a long 50-batch holds it, concurrent writers block→statement_timeout). Fixed: batch 50→20 (shorter lock-hold, completes in 300s) + surfaced swallowed `WHEN OTHERS` via `auto_merge_property_failures` alert (Fix 5). Verified: completes every run, 17/20 merge | live on dia, `AUTO_LINK_FIXES` Fix 2 |
| P-5b | **NEW (surfaced by P-5 alerting):** `dia_merge_property` can't fold two properties that BOTH have unique-constrained child rows — repoint hits unique_violation, gets swallowed, then the delete FK-fails. ~3/20 pairs affected. | 🟡 leases-collision case fixed (pre-step deletes duplicate drop-side leases + their RESTRICT children lease_escalations/expenses); 🔧 remaining: cascade-aware fold for `available_listings`, `sales_transactions` (RESTRICT grandchildren: broker_market_coverage, loans, property_documents) — needs a deliberate tested merge-dedup helper, NOT inline patching. Now visible (alert) + contained (failed pairs roll back clean, no corruption). 17 collision-prone child tables total. | dia `dia_merge_property` |
| P-6 | gov `data-hygiene-sweep` FK error (guard misses FK children) | ✅ guard already extended (R4-3: covers oh.sale_id+matched_sale_id, broker_txns, loans, property_documents, sales_txn_properties) — was failing 3/7 runs on the OLD version; now ✅ added per-step BEGIN/EXCEPTION isolation + `data_hygiene_sweep_step_error` alert so future FK-guard drift can't abort the whole sweep; 2 clean runs verified (errors:[]) | live on gov, `AUTO_LINK_FIXES` Fix 3 |
| P-7 | **Alerting gap**: `lcc_check_cron_health` didn't surface 2,935 failures | ✅ verified already fixed on dia — `lcc_check_cron_health` now reads `cron.job_run_details`, opens `cron_failure` alerts, auto-resolves on later success; scheduled `dia-cron-health-check` (hourly :15) + `lcc-health-alert-teams-push` (7,37). Confirm gov/LCC parity next | `AUTO_LINK_FIXES` Fix 4 |
| P-8 | Exception-swallowing (`WHEN OTHERS`→notice) in merge fns | 🔧 raise+alert | `AUTO_LINK_FIXES` Fix 5 |
| P-9 | dia every-minute linker + concurrent MV refresh (over-scheduled) | 🔧 →5–15 min/event-driven | `PROPAGATION_AND_SCHEDULING_REVIEW` |

## C. Ownership intelligence — sources & linkage
| ID | Finding | Status | Where |
|----|---------|--------|-------|
| O-1 | property→recorded owner: gov 44% / dia 13% | ✅ gap/coverage views live; GSA backfill +182 | `OWNERSHIP_*`, views |
| O-2 | Owner→Salesforce links 1.5–20% | 🔧 SF link/create route | `OWNERSHIP_ORCHESTRATION_BLUEPRINT` |
| O-3 | `unified_contacts` was SF-only; gov owners now wired (13,111) | ✅ + `resolve_company` + cron | `SPEC_resolve_company…`, executed |
| O-4 | `unified_contacts` doesn't exist on dia; cross-domain home undecided | ⚠ infra decision | blueprint §2 |
| O-5 | **SOS/registered-agent/managers = 0** (research queued, never run: 461 gov + 1,235 dia) | 🟡 sidebar-assisted SOS write-back shipped (demand-driven workhorse — all 50 states day 1); 🔧 per-state auto-adapters = long tail | `SPEC_sos_direct_scraper`, doc E below |
| O-6 | SAM works but underfed (127) + **unpropagated** | ✅ `sam_propagate_to_owners` (210 contacts, 126 addrs) + cron; 🔧 feed GSA lessors | `SPEC_owner_data_ingestion` |
| O-7 | **Deed/county not propagating** — linkage IS captured in `property_public_records` bridge; was just un-propagated | ✅ `propagate_deed_to_property` built+scheduled, gov deed-grantees 813→4,407, dia 509→550 | views + cron `propagate-deed-to-property` |
| O-7b | Chain-of-title from deeds gated: only 505/5,421 gov deeds have a `recording_date`; deed coverage low (dia 635) | 🔧 scraper capture recording_date + drive coverage + persist property_id at fetch | `SPEC_deed_county_ingestion_fix` |
| O-8 | Address matcher has zero fuel (`normalized_address`='' on all) | ⏸ after O-5/O-7 | `SPEC_owner_data_ingestion` |
| O-9 | NBA `research_tasks`/`action_items` empty (no generator) | ✅ NBA feed views live; 🔧 generator route | `SPEC_research_task_generator` |
| O-10 | Coverage rollup + regression/stalled alerts | ✅ live both DBs (SOS-stalled alert firing) | views + cron |
| O-11 | **Assessor (parcel) owner_name (9,402 scraped) was orphaned** — never cross-referenced to recorded owner / hub | ✅ `propagate_parcel_owner_to_property` built+run+scheduled (gov): 9,409 processed → 8,624 corroborate, 561 diverge, 465 assessor aliases, 1 filled; 361 divergence research-leads enqueued | `parcel_owner_xref`, `v_recorded_vs_assessor_owner_divergence`, cron `propagate-parcel-owner-to-property` |

## D. Deed/county + SOS ingestion — root cause (2026-05-21)
**Deed/county (O-7):** the scrapers run and capture **real owner data** but **persist no property linkage** — `parcel_records`/`deed_records` have no `property_id`, and `situs_address`/`apn`/`mailing_address` are null (even in `raw_payload`). So 9,402 gov parcel owner names + thousands of deeds are **orphaned** and never reach properties/owners (only ~813 gov / 509 dia properties have a deed grantee, all via the sidebar, not these tables). **Not SQL-recoverable** (the link is gone). **Fix is in the scraper** (`county_scraper`/`public_record_ingest`): persist `property_id` (known at fetch time) + `situs_address`/`apn`; then a backfill re-link + a deed→`ownership_history`/`properties` propagation (the gov `propagate_ownership_to_property` trigger already exists to carry it onward). See `SPEC_deed_county_ingestion_fix`.

**SOS (O-5):** see `SPEC_sos_direct_scraper`.

## E. SOS sidebar-assisted write-back — SHIPPED (2026-05-21)
The demand-driven workhorse from the agreed plan. The Chrome sidebar's public-records scanner (`extension/content/public-records.js::scanSOS`) already extracts the SOS entity-detail fields (registered agent, agent/principal address, officers/members, filing number, formation date, status, jurisdiction). Before this, the sidebar's "Save to LCC" only created a generic org entity and **dropped all the filing data**. Now wired end-to-end:

- **Route** `POST /api/admin?_route=sos-writeback` (rewrite `/api/sos-writeback`) — `handleSosWriteback` in `api/admin.js`. Maps the capture → `recorded_owners` (`registered_agent_name/address`, `manager_name/role` from officer parse, `filing_id/date/status`, `filing_state`/`state_of_incorporation`) using the **same field mapping as the automated `llc-research-tick`**, then marks the originating `llc_research_queue` row `done`. `llc_research_source='sos_manual_sidebar'`. Helpers: `parseSosOfficer`, `normalizeStateCode`, `parseSosDate`.
- **Queue list** `handleLlcResearchQueueList` made **domain-aware** (`?domain=government|dialysis`, default dialysis for back-compat) and now returns `recorded_owner_id` (required for write-back). Gov ranks by `gross_rent`; dia by `v_property_value_signal.rev_value`.
- **Sidebar** (`extension/sidepanel.js`): `renderLlcResearchQueue(domain)` shows the ranked queue; "Look up SOS" stashes the active research target (queue_id + recorded_owner_id + domain) and opens a Google-routed SOS search (works all 50 states day 1). After the broker Scans the SOS page, the org view's **"SOS → Owner"** button posts the capture + stashed target to `sos-writeback` and closes the queue row. Storage helpers `setActiveLlcResearch`/`getActiveLlcResearch`.
- **Why this over the paid OpenCorporates key:** compliant (broker opens the official SOS page), free, covers all states immediately, drains the high-value head now. Per-state automated adapters (`SOS_DIRECT_ADAPTERS` registry in `api/_shared/llc-research.js`, FL Sunbiz bulk-file first) remain the long-tail follow-up.
- ⚠ **Status-value drift noted (not yet fixed):** `llc-research-tick` and `sos-writeback` write queue status `'done'`; the older `resolve-llc-research` route writes `'completed'`. Harmonize to one value in a later pass.

## F. Working-tree file corruption found + repaired (2026-05-21)
While editing, two files in `life-command-center` were found **truncated mid-line in the working tree** (committed HEAD versions intact — likely an earlier interrupted sync/write): `vercel.json` (cut at line ~114, would break any deploy) and `extension/sidepanel.js` (cut at `$('#searchInput'…`, lost ~190 lines incl. `init()`). Both **rebuilt from HEAD** with the new edits re-applied; `node --check` / JSON-parse clean. Worth a `git status` sweep for any other truncated working-tree files before the next commit.

---

## Live DB objects created this session (all reversible/droppable)
Merge maps/logs (`dq5_*`, `dq7_*`), `dq7_office_misaddress_queue`, `owner_unification_review_queue`, `gsa_owner_backfill_log`, `ownership_coverage_history`, `parcel_owner_xref`; functions `company_canonical_key`, `is_generic_gov_owner`, `resolve_company`, `unify_owners_tick`, `gsa_backfill_recorded_owners`, `sam_propagate_to_owners`, `capture_ownership_coverage`, `propagate_deed_to_property`, `propagate_parcel_owner_to_property`; views `v_ownership_gaps`, `v_ownership_coverage`, `v_next_best_research`, `v_property_address_collisions`, `v_recorded_vs_assessor_owner_divergence`; crons `unify-owners-incremental`, `capture-ownership-coverage`, `sam-propagate-to-owners`, `propagate-deed-to-property`, `propagate-parcel-owner-to-property`.

## Spec docs (branch implementation)
`DQ7_ROOT_CAUSE_AND_CODE_FIX`, `INTAKE_FIXES_ADDENDUM`, `AUTO_LINK_FIXES`, `PROPAGATION_AND_SCHEDULING_REVIEW`, `OWNERSHIP_INTELLIGENCE_WIRING_DESIGN`, `OWNERSHIP_ORCHESTRATION_BLUEPRINT`, `SPEC_resolve_company_and_owner_unification`, `SPEC_research_task_generator`, `SPEC_owner_data_ingestion`, `SPEC_deed_county_ingestion_fix` (new), `SPEC_sos_direct_scraper` (new), `gov supersede DRAFT`.
