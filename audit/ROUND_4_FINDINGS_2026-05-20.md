# LCC Round 4 Audit — Findings (2026-05-20)

Fresh holistic sweep across cron/edge/pipeline health, domain-DB integrity (dia +
gov), and the data-quality/self-learning loops. Mode: **audit + fix as I go** —
clear-cut low-risk items remediated immediately, bigger ones flagged.

Projects: **LCC Opps** `xengecqvemvfknjvbvrq` (PG17) · **Dialysis_DB**
`zqzrriwuavgrquhisnoa` (PG15) · **government** `scknotsqkcheojiaewwh` (PG17). All
ACTIVE_HEALTHY.

---

## R4-1. ✅ FIXED · [HIGH] Poison-pill: dia property-link queue failing 1440×/day, silently

**Symptom.** `dia-auto-link-and-refresh-property-queue` (pg_cron job 25, every
minute) had **1440/1440 runs fail in 24h** — 100%, every minute — and presumably
for far longer.

**Root cause.** `apply_property_link_outcome()` did a bare
`UPDATE properties SET medicare_id = p_clinic_id` with no handling for the case
where *another* property already holds that `medicare_id`. A duplicate-clinic
situation (medicare_clinics had both `032544` and unpadded `32544` pointing at
property 33472) produced `duplicate key value violates "properties_medicare_id_key"`,
which aborted the whole queue tick. The worker re-selected the same poison-pill
item every minute, never advancing — and every other pending link sat blocked
behind it.

**Fix (applied, dia).** Made `apply_property_link_outcome` conflict-tolerant: a
fast-path pre-check that skips when a different property owns the id, **plus** an
authoritative `EXCEPTION WHEN unique_violation` handler around the UPDATE that
returns a `conflict` flag instead of raising. Migrations
`dia_r4_1_apply_property_link_outcome_conflict_tolerant` +
`dia_r4_1b_..._catch_unique_violation`.

**Verified (live cron).** Job 25 failed 17:16-17:19, then **succeeded 17:20 /
17:21 / 17:22** and is running normally. The first post-fix manual run also
drained **19 links** (9 exact + 10 orphan) that had been stuck behind the poison
pill. Real recovery, not just error suppression.

**Follow-up (data hygiene):** `medicare_clinics` has duplicate rows for the same
facility (`032544` vs `32544`). Worth a dedup pass; the conflict flag now makes
these visible instead of fatal.

---

## R4-2. ✅ FIXED (my regression) · [HIGH] dia_merge_property per-merge MV refresh timing out

**Symptom.** `dia-auto-merge-property-duplicates` (job 16, every 5 min) failing
~287/288 runs in 24h with `statement timeout` on
`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_property_value_signal` inside
`dia_merge_property`.

**Root cause — mine.** The R2-X-2 migration (2026-05-19, version tag
`r2_x2_runtime_fk_discovery_2026_05_19`) added a per-merge concurrent MV refresh.
The auto-merge calls `dia_merge_property` per duplicate pair; refreshing the MV on
every single merge is O(merges) expensive and hit `statement_timeout`, aborting
each merge. (A dedicated daily cron `refresh-mv-property-value-signal` at 06:50
already owns MV freshness, so the per-merge refresh was both redundant and the
cause — and since it was failing, the MV was only ever refreshed by the daily
cron anyway.)

**Fix (applied, dia).** Removed the per-merge MV refresh from `dia_merge_property`
(migration `dia_r4_1_merge_property_drop_per_merge_mv_refresh`); kept the runtime
FK-discovery rewire loop + drop-row delete verbatim. Version tag now
`r4_2_no_per_merge_mv_refresh_2026_05_20`.

---

## R4-2b. ✅ FIXED+verified · [MEDIUM] auto-merge timed out on unindexed FK-child rewires

**UPDATE 2026-05-20 — fully fixed.** Root cause of the remaining timeout: the
merge's FK-rewire `UPDATE`s ran full-table scans on large **unindexed** FK-child
columns — `learning_logs.property_id` (1.24M rows / 171 MB) and
`facility_patient_counts.property_id` (145K / 127 MB). Indexed both
`CONCURRENTLY` + 9 small unindexed FK-child columns (migration
`dia_r4_2b_index_remaining_property_fk_children`). With the 300s function timeout
(below) the merge now completes: a live `dia_auto_merge_property_duplicates(2)`
returned **`merged: 2, failed: 0`** — the subsystem that had *never* completed a
merge now works and will drain the duplicate backlog hourly. Materialized
normalized-address columns turned out unnecessary (detection completes in budget
once the rewires are fast). Original analysis below.

### Original analysis (stopgap)

**Symptom.** After R4-2 removed the MV-refresh timeout, job 16 *still* times out —
now in the duplicate-**detection** CTE (`dia_normalize_address`, the scan that
finds dup pairs). So `dia-auto-merge-property-duplicates` has **effectively never
completed** — it was timing out at the MV refresh before, and at detection after.

**Root cause.** `dia_auto_merge_property_duplicates` recomputes the regex-heavy
`dia_normalize_address()` / `dia_normalize_state()` over the **full properties
table multiple times** in nested CTEs every run, then ran every 5 minutes — so it
always blew the cron's `statement_timeout` and never drained the duplicate
backlog (≈1,061 dup addresses per the dia data-quality audit).

**Stopgap (applied, dia).** (1) `ALTER FUNCTION … SET statement_timeout='300s'` so
the scan + a 50-pair merge batch can finish; (2) dropped cadence from `*/5` to
hourly (`35 * * * *`) — duplicate-merging isn't time-sensitive and 50/hour drains
any realistic backlog within a day. Next run (:35) will confirm success.

**Deeper layer found (post-stopgap).** With the 300s timeout the run now gets
*past* detection into the merge, but `dia_merge_property`'s FK-rewire `UPDATE`s on
large child tables (`learning_logs`, `facility_patient_counts`, …) themselves time
out — those `property_id` FK columns appear unindexed. So merges still don't
complete. Net effect of R4-2/R4-2b: removed my MV-refresh regression + cut the
failure spam (every-5-min → hourly), but the subsystem still can't finish a merge.

**Proper fix (deferred — R4-2b-follow-up).** Two parts: (1) index the FK-child
`property_id` columns the merge rewires (also a general perf win — unindexed FKs);
(2) materialize `normalized_address` / `normalized_state` on `properties`
(+ index, trigger-maintained) so detection is a fast indexed self-join. Together
these remove the timeout root causes so duplicate-merging actually works.

---

## R4-3. ✅ FIXED+verified · [MEDIUM] data-hygiene-sweep broken on BOTH dia and gov

**UPDATE 2026-05-20 — both fixed & verified, two different root causes:**
- **dia:** the sweep embeds `dia_auto_merge_property_duplicates(100)` — it died on
  the same merge timeout as R4-2b. With R4-2b fixed + a 600s function timeout
  (`ALTER FUNCTION lcc_data_hygiene_sweep SET statement_timeout='600s'`), a live
  run completed: **100 property merges + 32 lease supersedes**. The duplicate
  backlog is now draining.
- **gov:** a FK-ordering bug, not a timeout — the bare-dup `DELETE` removed a
  `sales_transactions` row still referenced by `ownership_history.sale_id` (6 FK
  children exist; the sweep only severed one, after the delete). Fix (migration
  `gov_r4_3_hygiene_sweep_fk_safe_dedup_delete`): the dedup DELETE now skips any
  bare_id still FK-referenced (those are already suppressed from metrics by the
  `exclude_from_market_metrics` step, so analytics stay clean) + 600s timeout. A
  live run completed and corrected **~1,300 rows** that had been blocked for
  days: 1,242 dashboard-dup suppressions, 33 lease supersedes, 16 dedup deletes,
  5 owner backfills.

**Follow-up (R4-3-gov-followup):** referenced bare-dup sales aren't hard-deleted
yet (only suppressed); a repoint-aware pass (rewire the 6 FK children bare→keep,
like `dia_merge_property` does for properties) would let them be removed too.

### Original symptom

**Symptom.** `dia-data-hygiene-sweep` (dia job 19, daily 03:00) **and**
`gov-data-hygiene-sweep` (gov job 10, daily 03:30) both fail daily.
dia error: `statement timeout … while inserting index tuple in relation
"ingestion_log"` — an `INSERT INTO ingestion_log … ON CONFLICT` from a trigger
(`TG_TABLE_NAME`) firing during the sweep. gov has 3 open `cron_failure` alerts
for its sweep (same vintage). Suggests `ingestion_log` index bloat / lock
contention, or the sweep doing a large write that fans out trigger inserts past
the timeout. Fails once/day each (lower urgency). **Action:** investigate the
`ingestion_log` upsert trigger + table bloat on both DBs; likely needs a
`statement_timeout` bump on the sweep and/or REINDEX/VACUUM of `ingestion_log`.
Not yet remediated.

---

## R4-4. 🟥 OPEN · [HIGH] Domain-DB health alerts are detected but NEVER surfaced

**The big structural finding.** Round 3 built health-alert surfacing (R3-M-2 Teams
push + briefing) for **LCC Opps only**. But the two *domain* DBs — dia and gov,
where the actual data work happens — each run their own `*-cron-health-check` that
writes to their own `lcc_health_alerts`, and **nothing pushes those anywhere.**

Evidence: dia has open `error` alerts since **2026-05-17** for
`auto-link-and-refresh-property-queue`, `dia-auto-merge-property-duplicates`,
`dia-data-hygiene-sweep`; gov has 3 open `error` alerts for its hygiene sweep.
These sat unactioned for days — nobody knew the dia link queue was failing
1440×/day. Detection works on all three DBs; surfacing exists on one.

**Fix — ✅ BUILT (dormant), 2026-05-20.** Deployed the proven
`lcc_notify_health_alerts_teams()` push + `independent_notified_at` dedup column +
`v_lcc_health_alerts_open` view + every-30-min cron onto **dia and gov**, mirroring
R3-M-2. Migrations `dia_r4_4_health_alert_independent_teams_push` /
`gov_r4_4_...`. Crons staggered off LCC Opps (:00/:30): dia `7,37 * * * *`, gov
`13,43 * * * *`. Card title tagged per DB ("Dialysis_DB" / "Government"). Both
verified **dormant** (return `{status: dormant}` until the secret is set).

**Final step (user — credential):** set the Vault secret on dia AND gov with the
same LCC Alerts webhook URL already in LCC Opps Vault:
```sql
-- 1. read the URL from LCC Opps (run on the LCC Opps project):
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='lcc_health_alert_webhook';
-- 2. on EACH of dia + gov, create the secret with that URL:
SELECT vault.create_secret('<paste URL>', 'lcc_health_alert_webhook', 'R4-4 domain health-alert webhook');
```
On first activation each DB's push will surface its currently-open error alerts
(dia: auto-merge + hygiene timeouts; the auto-link alert should auto-resolve once
the hourly cron-health-check sees job 25 succeeding. gov: 3 hygiene). That burst
is the system finally working — exactly the failures that were invisible for days.
Left to the user so the webhook URL doesn't transit the assistant transcript.

## R4-5. 🟧 REVIEW · [MEDIUM] 163 unranked provenance writer-paths (schema drift)

`v_field_provenance_unranked` = **163** on LCC Opps (should be 0 by design). These
are `(target_table, field, source)` triples writing to `field_provenance` with no
matching `field_source_priority` rule — so `lcc_merge_field` can't arbitrate those
writes (they fall through to default). New writer paths were added without
priority entries. **Action:** triage the 163 and add priority rules (or confirm
intentional). Registry currently has 1,393 rules; 868,698 provenance rows logged.

## R4-6. 🟧 REVIEW · [MEDIUM] Self-learning loop logs conflicts but doesn't close them

`v_field_provenance_conflicts` = **485** open conflicts on LCC Opps. The audit
question "is the loop closing or just logging?" — **it's logging, not closing.**

### Collaborative review (2026-05-20) — root cause is deeper than "missing precedence"
Reviewed the conflict clusters + concrete values with Scott. The 485 collapse onto
a few source-pair relationships, dominated by **rca_sidebar vs costar_sidebar** and
**om_extraction vs costar_sidebar** (tenant, contact role, broker name/email,
prices, cap rates, lease dates). Two structural causes:

1. **Enforcement rollout stalled (the real blocker).** The precedence rules largely
   *exist and are sensible* — e.g. `dia.properties.tenant` is already om=45 < rca=50
   < costar=65. But `enforce_mode` is almost entirely **`record_only`** (a few
   `warn`, rare `strict`). Per the Phase-3 "gradual rollout" plan
   (`data_quality_self_learning_loop.md`), these were meant to advance
   record_only → warn → strict, but never did. In `record_only` the merge *records*
   the disagreement and lets the lower-priority write land anyway → conflicts
   accumulate (many historical, from before the rules were refined; `field_provenance`
   is append-only so they persist).
2. **CoStar sidebar capture-quality bugs** (separate, sidebar-parser finding): CoStar
   grabs titles-as-names (`contacts.contact_name` = "Managing Partner"), unparsed
   price strings (`"$3,690,000 ($246.00/SF)"` vs clean `3690000`), and nulls — which
   is *why* om/rca should outrank it for those fields.

### Scott's precedence decisions (2026-05-20)
- **OM vs CoStar → field-by-field:** OM wins deal economics + parties (price, cap,
  tenant, broker name/email, contact_name); CoStar wins `role` (it's richer:
  "buyer_broker,listing_broker"). Mostly already encoded (om < costar); confirm role.
- **CoStar vs RCA → field-by-field:** RCA wins contact-identity fields
  (address/city/state/phone/email/name/company); CoStar wins property attributes
  (year_built, address, parcel, source_url) + role.
- **Email vs OM → OM wins** for lease terms (expiration/start/renewal_options).
  NOTE: currently these are a true tie (both priority 35) — this is the one set that
  genuinely needs a priority change (bump om above email_intake).

### Resolution plan (deliberate, staged — NOT done inline; touches live governance)
1. **Adjust the few rankings** that don't match the decisions (chiefly email_intake
   vs om_extraction lease fields: make om win; confirm `role` → costar).
2. **Complete the Phase-3 enforcement rollout** for the decided fields: flip
   `enforce_mode` record_only → `warn` (observe the JS-side warnings for a cycle) →
   `strict` (block lower-priority writes). Staged, per the original plan.
3. **Re-arbitrate the existing 485:** for conflicts where the current domain value is
   from the now-losing source, backfill the winning source's value, then resolve the
   conflict-log rows. (Touches live dia/gov values — do carefully, reversibly.)
4. **Fix the CoStar sidebar parser** (titles-as-names, unparsed price strings) — a
   `sidebar-pipeline.js` `isJunk*`-style guard, parallel to the existing filters.

This is a focused next-round project (governance + live-data changes), not an
end-of-session inline edit. Confirm lcc_merge_field's exact conflict-assignment +
enforce_mode interaction before flipping modes.

## ✅ Verified / cleared this sweep

- **LCC Opps `lcc-template-health-rollup` (job 31)** — never run (created after its
  Mon-06:00 slot). Test-fired 2026-05-20 (request 1703): **HTTP 200, `ok:true`, 14
  templates evaluated** → the R2-L-1 cron will fire correctly Monday. (Minor note:
  all 14 templates report `stale` — none drafted in 120d; expected if not actively
  templating.)
- **LCC Opps cron portfolio (24 jobs)** — all healthy; the `connecting`/null
  entries are high-frequency jobs caught mid-launch, confirmed via
  `lcc_audit_cron_health()` (only job 31 flagged, now de-risked).
- **gov cron portfolio** — healthy except the data-hygiene sweep (R4-3).

## Deferred / not fully triaged

- **Security & performance advisors (all 3 DBs)** — the security advisor output is
  ~450KB of lints (mostly RLS-disabled / mutable `search_path`), much of which is
  by-design on these service-role-only pipeline DBs and needs per-table judgment
  about anon exposure. **Recommend a focused security pass** confirming: (a) the
  anon/publishable key cannot reach sensitive tables via PostgREST on dia/gov,
  (b) SECURITY DEFINER functions pin `search_path`. Not triaged in this round.

## R4-7. ✅ HEALTHY · domain DB integrity deep-dive (cap-rate / geocode / sales / leases)

Closed the integrity gap flagged earlier. Both domain DBs are fundamentally sound:

| Check | dia | gov |
|---|---|---|
| Properties geocoded (lat+lng) | 13,012 / 15,120 = **86%** | 15,742 / 17,599 = **89%** |
| sales_transactions with NULL sale_date | **0** | **0** |
| cap_rate_history outside [0.005, 0.30] guardrail | **0** / 8,126 | **0** / 2,804 |
| Properties with multiple active/current leases | **0** | 482 (informational) |

Notes:
- **Geocode coverage is strong** (86% / 89%) — the `lcc-geocode-backfill` cron +
  Google fallback worked (dia was ~20% pre-fallback per the CLAUDE.md note). The
  remaining ~11–14% are the chronic Census/Google misses (corrupted legacy
  addresses); the cron maintains coverage as new rows arrive.
- **dia multi-active leases = 0** — the R4-3 hygiene-sweep fix already cleared the
  backlog (was ~1,007 per the prior audit; the sweep superseded the extras).
- **gov 482 multi-current leases = informational, not a defect** — government
  buildings are routinely multi-tenant (several agency leases per building); the
  sweep deliberately only auto-supersedes clear single-winner cases.
- **Cap-rate guardrails hold** on both DBs — `gov_compute_cap_rate` + triggers drop
  out-of-range values; nothing slipped through.

`dia.v_data_quality_summary` — the one large backlog is **`duplicate_property_address`
= 2,789** (the other rows are minor: 195 anchor-rent-no-bump, 372 orphan medicare_id,
7 no-address, 4,330 "unverified" status flag). That dup-address backlog is exactly
what the now-fixed **R4-2b auto-merge** attacks — frozen/growing before today (the
merge never completed), now draining ~100/run hourly. Optional accel: bump the
auto-merge batch/cadence to clear it faster than the ~1-day natural drain.

No new defects; the integrity audit confirms the data BOVs/OMs depend on is sound,
and the Round 4 fixes (R4-2b, R4-3) are already paying down the largest backlog.

## Summary

| ID | Sev | Status | What |
|----|-----|--------|------|
| R4-1 | HIGH | ✅ FIXED+verified | dia link-queue poison-pill (1440 fails/day) |
| R4-2 | HIGH | ✅ FIXED (my regression) | dia_merge_property per-merge MV refresh timeout |
| R4-2b | MED | ✅ FIXED+verified | auto-merge FK-rewire timeouts (indexed FK children) |
| R4-3 | MED | ✅ FIXED+verified | data-hygiene-sweep broken on dia (timeout) + gov (FK bug) |
| R4-4 | HIGH | 🟥 open (recommended build) | dia/gov health alerts never surfaced |
<<<<<<< HEAD
| R4-5 | MED | 🟧 review | 163 unranked provenance writer-paths |
| R4-6 | MED | 🟧 review | 485 provenance conflicts logged, not closed |
| R4-7 | — | ✅ healthy | domain integrity (geocode 86/89%, cap-rate guardrails hold, dup-address backlog now draining) |
=======
| R4-5 | MED | 🟢 mostly fixed | 163 → 22 unranked (residual is writer bug, fixed in JS this round; see `R4_PROVENANCE_PHASE3_2026-05-20.md`) |
| R4-6 | MED | 🟢 partially fixed | 485 → 212 conflicts (273 stale resolved, 193 await domain backfill review, 19 legit ties); Phase-3 warn flips applied |
>>>>>>> 5ae81499a48ebce0623d00a4033249cabbc60eab
| advisors | — | deferred | focused RLS/search_path security pass |
