# BD Engine — Post-Work Audit (2026-05-22 session)

**Branch:** `claude/fervent-cori-FR1JQ`
**Session window:** 2026-05-22, ~9.5 hours
**Commits shipped:** 16 topics, all merged via per-topic PRs
**Lines added:** ~6,100 across migrations + audit doc
**Audit doc sections:** §11.22 – §11.37 (full per-topic log)

---

## 1. What this session shipped

This session built out the **BD doctrine database layer** from the v5
fact-based owner-role classification (already in place from earlier
rounds) to a fully operational priority-queue + listing-fan-out engine
with cron-scheduled syncs. Sixteen topics shipped end-to-end.

### Per-topic ledger

| Topic | Audit § | Commit | What landed |
|---|---|---|---|
| 10 | §11.22 | 7c964c1 | LCC entity sync from dia/gov true_owners |
| A3 | §11.23 | c71a9fe | Cross-vertical portfolio facts + enriched priority queue |
| 11 | §11.24 | a2268d5 | Strict cross-domain entity merge (canonical name) |
| A6 | §11.25 | 48a47c4 | 7-touch onboarding cadence state machine |
| A6.5 | §11.26 | b43fbcd | Activity-driven cadence auto-advance + dashboard |
| A10-MVP | §11.27 | 0ea937c | Same-owner listing fan-out (Lane 1) |
| 12 | §11.28 | c00cfe5 | Property attribute sync + Lane 3 (geographic neighbors) |
| A10 Lane 2 | §11.29 | ddd4833 | Buyer cohort fan-out |
| 13 | §11.30 | 4d2a4d5 | Priority queue bands P1/P2/P3 |
| 14 | §11.31 | db0d1f3 | Fuzzy entity resolution (normalized-name) |
| 15 | §11.32 | 43beb80 | Listing-event watcher |
| 16 | §11.33 | 626236f | Operator-affiliate registry |
| 17 | §11.34 | 1d2baf7 | Operator concentration + sale-leaseback + SPE override |
| 18 | §11.35 | b0ade9b | Priority queue bands P4 / P5 |
| 19 | §11.36 | 9d1d889 | Federal-activity signals + priority queue band P8 |
| 20 | §11.37 | 4dc57bd | BD-data sync cron schedule |

---

## 2. Final database state

### Tables added on LCC Opps

| Table | Rows | Purpose |
|---|--:|---|
| `lcc_entity_portfolio_facts` | 5,888 | Per (entity, source_domain, source_property_id) ownership edge |
| `lcc_property_attributes` | 30,625 | Synced property attributes (lat/lng, size, year, lease, federal) |
| `lcc_listing_events` | 293 | sales_transactions events pulled from dia + gov |
| `lcc_operator_affiliate_patterns` | 18 | Operator → subsidiary-name patterns |
| `lcc_onboarding_schedule` | 7 | 7-touch onboarding cadence rules |
| `lcc_entity_sync_inflight` | — | pg_net tracking (entity sync) |
| `lcc_portfolio_sync_inflight` | — | pg_net tracking (portfolio) |
| `lcc_property_attribute_sync_inflight` | — | pg_net tracking (property attrs) |
| `lcc_listing_event_sync_inflight` | — | pg_net tracking (listing events) |

### Columns added to existing tables

- `public.entities`: `merged_into_entity_id uuid` + index
- `public.lcc_property_attributes`: 6 federal-activity columns
  (`sam_active_opportunities`, `total_federal_investment`,
  `federal_employee_count`, `federal_award_count`,
  `federal_award_total`, `federal_award_latest_date`)
- `public.touchpoint_cadence`: expanded `phase` constraint
  (`onboarding`, `steady_state`, `unsubscribed`) and `priority_tier`
  constraint (`D` added)

### Views added on LCC Opps

| View | Purpose |
|---|---|
| `v_entity_portfolio_all` | Per-entity portfolio rollup |
| `v_priority_queue` | 9-band priority queue (P0..P8 + dynamic bands) |
| `v_priority_queue_enriched` | Queue + portfolio rollup + property context |
| `v_bd_cadence_dashboard` | Per-cadence operator dashboard |
| `v_lcc_merge_candidates` | Fuzzy entity merge candidates |
| `v_lcc_operator_affiliates` | Affiliate ↔ parent operator resolution |
| `v_lcc_operator_effective_portfolio` | Parent + affiliates rolled up |
| `v_lcc_listing_event_queue` | Operator-facing listing event queue |

### Views added on gov

| View | Purpose |
|---|---|
| `v_ownership_history_portfolio` | Anon-readable PII-stripped ownership history |
| `v_property_attributes_portfolio` | Anon-readable property attributes + federal signals |
| `v_sales_transactions_portfolio` | Anon-readable sales (column-aliased to dia shape) |

### Functions added (LCC Opps)

| Function | What |
|---|---|
| `lcc_normalize_entity_name(text)` | Strip case/punctuation/suffix for fuzzy matching |
| `lcc_merge_entity(loser, winner)` | Reusable entity merge with portfolio fact rollup |
| `lcc_apply_fuzzy_merges(dry_run)` | Batch-apply candidate merges |
| `lcc_seed_onboarding_cadence(...)` | Create cadence row at step 0 |
| `lcc_advance_onboarding_cadence(...)` | State-machine step advance |
| `lcc_steady_state_interval_days(tier)` | A=30 / B=91 / C=240 / D=365 |
| `lcc_open_prospect_opportunity(...)` | Manually open a prospect opp (idempotent) |
| `lcc_mark_listing_event_processed(...)` | Stamp processed_at |
| `lcc_listing_same_owner_cohort(...)` | A10 Lane 1 fan-out |
| `lcc_listing_geographic_neighbors(...)` | A10 Lane 3 fan-out (haversine) |
| `lcc_listing_buyer_cohort(...)` | A10 Lane 2 fan-out |
| `lcc_sync_classified_owners(...)` | pg_net fire (entity sync) |
| `lcc_finalize_classified_owners()` | pg_net finalize |
| `lcc_sync_entity_portfolios(...)` | pg_net fire (portfolio) |
| `lcc_finalize_entity_portfolios()` | pg_net finalize |
| `lcc_sync_property_attributes(...)` | pg_net fire (attributes) |
| `lcc_finalize_property_attributes()` | pg_net finalize |
| `lcc_sync_listing_events(...)` | pg_net fire (sales events) |
| `lcc_finalize_listing_events()` | pg_net finalize |

### Triggers added

| Trigger | On | What |
|---|---|---|
| `bd_opportunity_auto_seed_cadence` | `bd_opportunities` AFTER INSERT | Auto-seed cadence for new prospect opps |
| `activity_event_advance_cadence` | `activity_events` AFTER INSERT | Auto-advance cadence on email/call/meeting |

### pg_cron jobs registered

| Job | Schedule (UTC) | What |
|---|---|---|
| `lcc-entity-sync-fire` | `5 */4 * * *` | Entity classification sync |
| `lcc-entity-sync-finalize` | `10 */4 * * *` | … |
| `lcc-portfolio-sync-fire` | `15 */4 * * *` | Portfolio facts sync |
| `lcc-portfolio-sync-finalize` | `20 */4 * * *` | … |
| `lcc-listing-event-sync-fire` | `25 */4 * * *` | Listing event watcher |
| `lcc-listing-event-sync-finalize` | `30 */4 * * *` | … |
| `lcc-property-attrs-sync-fire` | `35 4 * * *` | Property attributes (daily) |
| `lcc-property-attrs-sync-finalize` | `40 4 * * *` | … |
| `lcc-pg-net-response-cleanup` | `45 * * * *` | Drop `net._http_response` > 24h |

All registered with `active = true`; will no-op until vault secrets seed.

### Final classification + queue state

**Entities (post all merges):**
- 4,003 classified entities surfaced from dia + gov (initial backfill)
- 306 merged via §11.24 strict + §11.31 fuzzy
- Net canonical classified universe used by the queue: ~3,700 entities

**Priority queue band counts (steady state):**
- P0.5 = 472 (developers/user_owners without an open opportunity)
- P1 = 66 (gov lease expiring 0–24mo)
- P2 = 30 (gov firm term < 2yr)
- P3 = 56 (gov 10-year window)
- P4 = 14 (recent acquisition streak ≥2 in 18mo)
- P5 = 66 (aged building, ≥25yr, no recent reno)
- P7 = 168 (steady-state cadence due — varies by time of day)
- P8 = 88 (gov active SAM solicitations)
- P0 / P6 dynamic — zero rows until the operator console activates

**Cross-vertical entities (entities owning property in both dia AND gov):**
- 5: Truist Bank, Embree, Jamestown LP, Jana Collins LLC, Northwood
  Properties LLC

**Operator effective portfolios (parent + affiliates):**
- Davita: 96 total / 3 current
- Fresenius Medical Care: 11 total / 3 current
- US Renal Care: 4 total / 0 current
- American Renal Associates: 0 / 0

**Listing events (90-day backfill):**
- 293 events total (242 gov + 51 dia)
- 1 confirmed sale-leaseback surfaced (Davita → Pearl Wang, Terre
  Haute, $3.73M)

---

## 3. Validation status

### Tested end-to-end (real-world sample workflows)

- ✅ Entity sync from dia + gov via pg_net (Topic 10 backfill)
- ✅ Portfolio sync, including the gov current-owner window logic
- ✅ Cross-domain merge — Truist Bank gov consolidated into dia parent
- ✅ Fuzzy merge — 246 net duplicates resolved, no false positives in
  19-row short-norm-name spot check
- ✅ Cadence state machine — 7-touch walk for Elliott Bay Capital
  completed with correct graduation to tier-A steady state
- ✅ Cadence auto-advance — activity event INSERT triggered cadence
  step bump for tested entity
- ✅ Listing fan-out Lane 1 — Elliott Bay property 26621 → 92 other
  current properties surfaced
- ✅ Listing fan-out Lane 2 — Seguin TX 30281 → 6 classified TX-active
  buyers anchored by recent acquisitions
- ✅ Listing fan-out Lane 3 — Michigan property → TEP Grand Rapids
  developer 19 mi away (haversine validated)
- ✅ Priority queue bands P1–P5, P8 — all populated and sample rows
  inspected for plausibility
- ✅ Sale-leaseback detection — Davita Terre Haute event tagged
  correctly with `is_sale_leaseback=true`
- ✅ SPE behavioral override — DAVITA LLW AMIGO FRED VA LLC + 2 FMC
  shells flipped to operator override, dropped out of P0.5

### Structural-only (no production data flowed through)

- 🔶 SF Opportunity sync — `bd_opportunities` schema in place but
  populated only by manual `lcc_open_prospect_opportunity()` calls
  (1 test row, cleaned up post-test)
- 🔶 Email template bodies — `onboarding_email_*` / `onboarding_vm_*`
  names live in `lcc_onboarding_schedule`, but actual subject/body
  text lives elsewhere (TBD — likely email-send infra)
- 🔶 Cron activation — 9 jobs registered + `active = true`, but four
  vault secrets are missing so they no-op gracefully

### Known data limitations

- **Northwood Inc ↔ Northwood Properties LLC merge** — fuzzy merge
  treated these as same entity (norm name = "northwood" with all
  suffixes stripped). Could be different entities; blast radius is
  small (2 total properties), surfaced for review via
  `v_lcc_merge_candidates` going forward.
- **dia recent-federal-award properties** — 26 properties have
  `federal_award_latest_date` in last 12mo but only 1 has a
  classified owner. P9 deferred until classification coverage on
  these properties improves.
- **gov v_property_attributes_portfolio counts only classified owners
  for P1–P8** — many gov properties owned by unclassified entities
  don't surface at all in the BD queue. Expected; not a defect.

---

## 4. Architectural gotchas + tech debt discovered

### Documented in migration comments

1. **`CREATE OR REPLACE VIEW` is append-only.** Postgres treats
   middle-of-list column insertions as renames and rejects them with
   `42P16`. Hit during Topic 13 (P1-P3) and Topic 17 (listing event
   queue enrichment). All affected views (`v_priority_queue`,
   `v_priority_queue_enriched`, `v_lcc_listing_event_queue`) have
   their new columns at the end of the SELECT list.

2. **`lcc_merge_entity` dedupe-in-CTE concurrency bug.** The §11.24
   implementation packed a DELETE-duplicates and UPDATE-move into one
   WITH statement. Postgres ran both off the pre-CTE snapshot and the
   UPDATE collided on the PK when winner + loser both had a row for
   the same `(domain, property)`. §11.24's losers all had zero
   portfolio edges so the bug never surfaced; §11.31's fuzzy merge
   triggered it on the Davita Healthcare Prtnrs → Davita merge.
   Fixed in `20260522305000_lcc_merge_entity_dedupe_fix.sql` by
   splitting DELETE and UPDATE into sequential statements.

3. **PL/pgSQL `#variable_conflict use_column`** required in functions
   whose `RETURNS TABLE` parameters share names with table columns
   (`source_domain`, `owner_role`, `is_cross_vertical`, etc.).
   Encountered in every A10 lane function and the listing-event
   finalize.

4. **`days_overdue` column repurposed** for P4 (acquisition streak
   count), P5 (building age years), P8 (SAM solicitation count). The
   priority queue contract was originally "days past `next_touch_due`"
   but is now overloaded to carry per-band metrics. The operator
   console must interpret `days_overdue` differently per band; the
   `reason` column carries the band-specific label that disambiguates.

5. **Generated columns on `bd_opportunities` and
   `lcc_entity_portfolio_facts`.** `bd_opportunities.is_open` is
   `GENERATED ALWAYS AS (closed_at IS NULL)` — INSERT must omit it.
   `lcc_entity_portfolio_facts.is_current` is
   `GENERATED ALWAYS AS (ownership_end_date IS NULL) STORED` — same
   constraint. Both are documented in their migration comments.

### Bad-data shapes encountered (not all addressed)

| Issue | Where | Status |
|---|---|---|
| `year_built = 0` (NULL-as-zero) | gov & dia properties | Filter `year_built > 1800` in P5 |
| `agency_full_name` casing variance | gov | Not normalized; affects affiliate-pattern hit rate |
| Multiple "Davita X Dialysis" entity-hub legacy rows | LCC | 60+ rows with 0 portfolio — match affiliate prefix but show as `member_count=77` for Davita while only 4 have non-zero portfolio |
| `recorded_owner_id` vs `true_owner_id` divergence on gov sales | gov | Inherited from existing data; LCC sync uses `true_owner_id` |

---

## 5. Operational readiness

### What runs automatically right now
- Nothing yet (cron jobs are scheduled but their sync functions
  no-op without vault secrets).

### What's needed to flip the engine live

1. **Seed four Vault secrets on LCC Opps:**
   ```sql
   SELECT vault.create_secret('dia_supabase_url', 'https://zqzrriwuavgrquhisnoa.supabase.co');
   SELECT vault.create_secret('dia_supabase_anon_key', '<dia anon key>');
   SELECT vault.create_secret('gov_supabase_url', 'https://scknotsqkcheojiaewwh.supabase.co');
   SELECT vault.create_secret('gov_supabase_anon_key', '<gov anon key>');
   ```
   The anon keys live in the Supabase dashboard for each project —
   they're the same keys already published in client-side LCC code,
   so no new credentials are needed; this is just placing them in
   the LCC Opps vault for the sync functions to read.

2. **Verify a cron tick.** Wait for the next `:05` (entity sync fire)
   to land, then `:10` (finalize). Check:
   ```sql
   SELECT * FROM cron.job_run_details
   WHERE jobname LIKE 'lcc-entity-sync%'
   ORDER BY start_time DESC LIMIT 5;
   ```
   Expect `succeeded`. Any error here is the most likely failure
   mode on initial activation (typically: anon key permissions on
   the source table).

3. **Verify the listing event queue is populating.** After the
   `:25/:30` tick:
   ```sql
   SELECT COUNT(*) FROM lcc_listing_events
   WHERE detected_at > now() - interval '24 hours';
   ```
   Should grow over time as new sales_transactions land in
   dia/gov.

### What to monitor for the first week

- `cron.job_run_details` for any non-`succeeded` rows on the new
  LCC-prefixed jobs
- `net._http_response` row count (should stay around
  `(syncs_per_day × pages_per_sync × 1 row)` ≈ 900/day under the
  hourly cleanup)
- `lcc_*_sync_inflight` tables — should drain to empty after each
  finalize. A row older than 24h indicates a `net._http_response`
  row never landed (network error, gone before consumption).
  Existing 24h sweep in each finalize function handles it but is
  worth eyeballing.

---

## 6. Deferred / not addressed in this session

| Item | Type | Why |
|---|---|---|
| SF Opportunity inbound sync writer | External integration | Requires Salesforce API credentials + Vercel deploy path |
| Email message template bodies for `onboarding_email_*` / `_vm_*` | Email infra | Lives in PowerAutomate or email-send service, not the database |
| Operator console UI (priority queue + listing event queue rendering) | Frontend | Beyond SQL scope |
| Priority queue band P9 (recent federal award) | Data quality | Only 1 dia property with recent CMS award is owned by a classified entity; band is one UNION ALL when coverage improves |
| Listing-event-driven auto-fan-out (writes cohort rows to a table) | Open design | Currently operator-driven via the three `lcc_listing_*_cohort` functions; auto-persist might cause queue noise |
| Operator-affiliate concentration risk math (% of tenant concentration in property's MSA) | Future round | Needs additional gov metro_area coverage + dia metro/region mapping |
| `Northwood Inc` vs `Northwood Properties LLC` merge review | Data fix | Surfaced in `v_lcc_merge_candidates` for human review |
| Audit `behavioral_override='operator'` overrides quarterly | Ops process | 3 SPEs flipped today; new ones should be flipped as they're discovered |

---

## 7. Recommendations for the next session

In rough order of leverage:

1. **Seed the four vault secrets and watch one cron cycle.** Smallest
   action with the highest payoff — flips the entire BD data engine
   from "shipped but quiet" to "live and self-maintaining."

2. **SF Opportunity inbound sync.** The `bd_opportunities` schema is
   in place; the `lcc_open_prospect_opportunity()` helper covers the
   manual path; the cadence auto-seed trigger fires correctly on
   INSERT. Wiring this to Salesforce closes the only major loop that
   today requires manual intervention.

3. **Operator console UI on `v_priority_queue_enriched` +
   `v_bd_cadence_dashboard` + `v_lcc_listing_event_queue`.** All three
   views are stable contracts now. A UI on top of them is what makes
   the doctrine visible to operators day-to-day.

4. **Northwood / affiliate-pattern review.** Spend an hour reviewing
   `v_lcc_merge_candidates` and the 18 affiliate patterns to catch
   any false-positive merges or missing patterns (e.g., USRC has 3
   patterns but only 0 effective affiliates surface — there may be
   USRC-affiliated entities the patterns miss).

5. **Email template content.** Even rough draft bodies for
   `onboarding_email_1_introduction` through `_7_graduation` would
   make the operator console actionable. The template-name → body
   resolution lives outside the database, so this is mostly
   content-writing work.

---

## 8. Quick-reference SQL for next session

```sql
-- Snapshot the priority queue
SELECT priority_band, COUNT(*) FROM public.v_priority_queue GROUP BY 1 ORDER BY 1;

-- Operator dashboard for an entity by name
SELECT * FROM public.v_bd_cadence_dashboard
WHERE entity_name ILIKE '%elliott bay%';

-- Open a manual opportunity (triggers cadence auto-seed)
SELECT public.lcc_open_prospect_opportunity(
  p_entity_id := (SELECT id FROM public.entities WHERE name = 'Elliott Bay Capital' LIMIT 1),
  p_owner_user_id := '<auth.users.id>',
  p_vertical := 'dia',
  p_source := 'manual'
);

-- Fan-out for any listing event
SELECT * FROM public.lcc_listing_same_owner_cohort('dia', '26621');
SELECT * FROM public.lcc_listing_buyer_cohort('dia', '30281', 50, 36, 15);
SELECT * FROM public.lcc_listing_geographic_neighbors('dia', '26621', 10, 20);

-- New listing events to triage
SELECT * FROM public.v_lcc_listing_event_queue
WHERE processed_at IS NULL
ORDER BY event_date DESC LIMIT 20;

-- Watch the cron
SELECT jobname, schedule, active FROM cron.job
WHERE jobname LIKE 'lcc-%-sync%' OR jobname = 'lcc-pg-net-response-cleanup'
ORDER BY schedule;

SELECT jobname, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobname LIKE 'lcc-%-sync%'
ORDER BY start_time DESC LIMIT 20;
```

---

*Generated 2026-05-22 during the post-work documentation pass at the
end of the 16-topic session. See DEVELOPER_BD_AUDIT_v3.md §11.22 –
§11.37 for the full per-topic implementation log.*
