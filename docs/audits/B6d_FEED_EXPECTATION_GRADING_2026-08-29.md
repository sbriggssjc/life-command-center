# B6d — grade the feed expectations before the alert surface becomes noise (2026-08-29)

**Closes** the B6a → B6a-follow-up → B6b → B6b-lead arc. **Contract:** `data-coherence-invariants.md`
**I4/I11**. **Playbook:** Class 21 (a guard that fails into silence), Class 26 (a status value is not a
human verdict). **Backlog row:** `B6d`.

> **Read this first.** Two of the four open `feed_stale` alerts were hypothesised in the brief to be
> mis-sized expectations. **Both are genuine ingestion outages.** Widening either bound — the obvious
> way to make an alert go away — would have buried a two-month CMS outage and a five-week SAM outage
> against sources that are both still publishing. That is the whole finding.

---

## 1. What changed

**25 registered feeds** (not 23 — see §2), every one now carrying a `cadence_class`, and either a
bound with a stated `expectation_basis` or no bound with a stated `unwatched_reason`. Enforced by
CHECK constraints, so the next person cannot add a round number with no reasoning behind it.

Open `feed_stale` alerts: **4 → 2**, and both survivors are real breaks.

| | before | after |
|---|---:|---:|
| registered feeds | 25 | 25 |
| carrying a graded expectation | 0 | 23 |
| deliberately unwatched, recorded | 0 | 2 |
| open `feed_stale` alerts | 4 | **2** |
| open alerts that describe a decision, not a break | 2 | **0** |
| feeds at 45 days because 45 is a round number | 10 | **0** |

Migrations: `government-lease/sql/20260829_gov_b6d_feed_expectation_grading.sql`,
`Dialysis/supabase/migrations/20260829_dia_b6d_feed_expectation_grading.sql`,
`life-command-center/supabase/migrations/20261004120000_lcc_b6d_feed_expectation_grading_local.sql`
and `…120100_lcc_b6d_resolve_alerts_for_unwatched_feeds.sql`. All applied live; every committed
function body and all 25 registry rows verified byte-identical to the live objects by md5.

---

## 2. ⚠️ The population is 25, not 23

The brief counted gov (18) + dia (5). **LCC Opps carries its own registry with two more feeds** —
`om_intake` and `salesforce_sync` — evaluated by the same `lcc_check_feed_freshness` through its
`lcc_local` arm. They were invisible to a count taken from the domain databases.

Both are daily (p50 gap 1d, max 3d over 120 and 103 observation dates). `om_intake` was at 14 days,
roughly 5× the largest silence ever observed; it is now 7, matching `salesforce_sync`, whose cadence
is identical.

**Before quoting a monitored population, enumerate every registry that feeds the monitor** — not just
the ones the question was framed around.

---

## 3. ⚠️ The two alerting feeds are REAL BREAKS (rule 3c)

### 3a. `medicare_clinics` (dia) — 65d against a 45d bound. Bound unchanged.

The plausible story was in the brief: CMS publishes slowly, `facility_patient_counts` is documented
as roughly annual, so the SLA is probably wrong. Measured:

- 23 observation dates, **p50 gap 2d, p90 18.5d, max 41d**. The current age of **65d is above the
  largest gap this feed has ever had**, so 45 is not the problem.
- `ingestion_tracker` holds **27 `failed` and 6 `abandoned` `cms_ingestion` runs**, last success
  **2026-06-25**, most recent attempt 2026-08-27.
- The same rows carry **`dataset_modified_date = 2026-08-25`** — **CMS has published and we are
  failing to ingest it.**

**Widening this bound would have buried a two-month ingestion outage against a live source.** Filed
as backlog **B6d-cms**; the producer is not fixed here.

### 3b. `sam_lease_opportunities` (gov) — 33d, re-scoped 14 → 21, **still violated on purpose**

Re-scoping a bound and leaving it violated is the test that the re-scope is not silencing a defect.

- The producer is fine: `feed-ingest.yml` runs every Monday and **`usajobs_market_signals`, fed by
  the same workflow, landed 2026-08-24**. In the scheduled era SAM reads p50 gap 7d, max 9d.
- The SAM step itself fails: **`401 Client Error: Unauthorized`** on
  `api.sam.gov/prod/opportunities/v2/search`, every run since 2026-08-24, and `partial` with
  `rows_fetched = 0` before that. Last row written 2026-07-27.

⚠️ **The brief proposed re-scoping this on the grounds that "SAM is documented at a ~10 lookups/day
rate limit, so 14 days is not achievable". That is a different SAM.** CLAUDE.md §18's rate limit is
`SAM_GOV_API_KEY` on the entity-lookup edge function; this is `SAM_API_KEY` on the opportunities API
— a different key against a different endpoint. §18 also carries a prominent correction saying an
earlier 401 there was *not* real. **A dated note saying "the 401 is not real" is exactly what makes a
real 401 easy to dismiss.** Filed as **B6d-sam**.

---

## 4. ⚠️ The method: measuring a feed's own gaps is circular when the feed has been dead

The obvious method — set the bound above the feed's observed p90 — fails in two distinct ways, and
both are present in this population:

- **An outage is a CLOSED gap and enters its own distribution.** `gsa_lease_change_facts` has exactly
  two observation dates and one 170-day gap, which *is* the outage B6b repaired. A 3 × p90 rule would
  derive a **510-day** bound. B6a's own `is_overdue` rule does not have this problem for pipeline
  *steps* (a dead step's gap is still open and never closes), so **the rule does not transfer from
  steps to feeds.**
- **A lifetime distribution mixes ERAS.** `usajobs_market_signals` reads p90 31.8 / max 95 over its
  life, but the 95 is the pre-schedule era; since the weekly workflow landed 2026-06-20 it is p50 7 /
  max 16.

So the **primary basis is the producer's declared schedule**, with the observed distribution over the
current regime as corroboration. Below three observed gaps the honest answer is *cannot be sized from
data* — recorded as such (`county_ingest_pull`, the three GSA-derived feeds), not dressed up.

**And the same trap bit the grading instrument itself.** The first cut of `v_feed_expectation_grade`
compared the bound against the observed **max** gap and labelled **six correctly-sized feeds**
`sla_below_observed_max` — purely because they have broken before. **A gap larger than the bound is
exactly what the bound EXISTS to catch.** The verdict now keys on the **median**, which is robust to
both outages and regime changes; the max is still reported as `observed_silence_exceeds_sla`, under a
name that says it means *has broken before*.

---

## 5. The grading

### 5a. The weekly-scheduled family: one rule, measured

Five gov feeds run on a weekly workflow and **all read p50 gap = 7d exactly** in the scheduled era.
They carried 14 / 30 / 35 / 45. All are now **21 = 3 × cadence**: one missed run tolerated, two
consecutive misses fire.

14 was too tight — `usajobs_market_signals` **already produced a false fire** on 2026-07-05 off a
single 16-day gap and auto-resolved four days later. 45 was six missed runs, i.e. a month and a half
of silence before anyone hears about it.

| feed | producer | p50 / max (era) | was | now |
|---|---|---|---:|---:|
| `agency_risk_signals` | `ingest_agency_risk.py`, ci.yml weekly | 7 / 7 | 14 | 21 |
| `federal_lease_awards` | `ingest_usaspending.py`, ci.yml weekly | 7 / 7 | 45 | 21 |
| `investment_scores` | `investment_scorer.py`, ci.yml weekly | 7 / 12 | 30 | 21 |
| `gsa_source_pull` | `gsa_auto_sync.py`, Mon 05:00 | 7 / 13 | 35 | 21 |
| `sam_lease_opportunities` | `ingest_sam_opportunities.py`, Mon 08:00 | 7 / 9 | 14 | 21 |
| `usajobs_market_signals` | `ingest_usajobs.py`, Mon 08:00 | 7 / 16 | 14 | 21 |

### 5b. ⚠️ The GSA family: four feeds, one publisher, four different bounds

`gsa_leases_snapshot`, `gsa_lease_events`, `gsa_lease_change_facts` and `gsa_lease_timeline` all take
their cadence from **one external publisher**, and carried 65 / 35 / 45 / 45 — **three of them below
the publication cycle's own peak.**

Measured publication behaviour: monthly reference dates, appearing with a **21–51 day lag** (snapshot
`2026-05-01` first ingested 2026-06-21 = 51d; `2026-06-01` on 2026-06-22 = 21d; `2026-07-01` on
2026-08-05 = 35d). So the steady-state peak age of the newest **data** date is ~31 + 51 ≈ **82 days**.

- `gsa_leases_snapshot` **65 → 90**. It was **6 days from firing** when this was measured — and it
  would have fired for a non-defect reason: `gsa_source_pull` is green and
  `gsa_source_pull_log.consecutive_unchanged = 3` proves **GSA has simply not published August**.
- The three derived feeds **→ 75**, sized from the parent and pinned by a guard so they cannot drift
  back to three different numbers. `gsa_lease_events` was **35 and would have fired 2026-09-10 on a
  healthy feed**: it wrote weekly until 2026-08-05 because the pull re-ingested each week, and since
  the fingerprint dedupe began returning `skipped_duplicate` (2026-08-10) it writes only once per GSA
  publication. **Its cadence changed three weeks ago and its bound had not.**

**`gsa_source_pull` deliberately stays tight (21d).** It answers *did WE stop pulling*;
`gsa_leases_snapshot` answers *is GSA still publishing*. Two questions, two owners, two bounds.

### 5c. ⚠️ `opm_workforce`: a bound the process could not meet, 120 → 200

It sat at exactly 120/120 and would have alerted the next day. Measured on the only two import
events that exist:

- 2026-03-17 loaded data through 2026-01-01; 2026-07-14 through 2026-05-01. So the newest data is
  **74–75 days old at the moment of a successful import**, and the one observed interval between
  imports is **119 days** (n = 1 — cannot be sized).
- Max age actually reached: **195 days**, just before the July import.

**A 120-day bound was therefore unmeetable by the process that feeds it.** It fired three times in
three months and *every* resolution was "expected" or "manual import done" — an alert structurally
guaranteed to fire and always closed as expected is the badge-that-is-noise failure. 200 = 75 + 119 +
slack: it cannot fire during normal operation and fires only if an import cycle is missed entirely.

### 5d. Unchanged, and now with a reason

`available_listings` (21), gov `deed_records` (30), gov `loans` (30), gov/dia `sales_transactions`
(45), dia `clinic_financial_estimates` / `deed_records` / `loans` (45), `county_ingest_pull` (40),
`salesforce_sync` (7). Each carries its measured distribution in `expectation_basis`.
`county_ingest_pull` explicitly records that it rests on a **declared** monthly schedule because only
two pull dates exist — a weaker claim than a measured one, and meant to be visible as such.

---

## 6. ⚠️ Retiring an expectation made its alert PERMANENT

**This is the defect that made the round urgent, and it was already live when B6d started.**

`lcc_check_feed_freshness` auto-resolves a `feed_stale` alert only when the feed is **present** in the
evaluated set and not stale. A feed whose expectation is retired leaves that set entirely, so the
`EXISTS` can never be satisfied. B6c-dup retired `property_sale_events` earlier the same day by
setting `is_active = false`, and **alert 5376 was left open, unresolvable by any automatic path, with
no reason attached** — on a surface whose entire purpose is that every open row is worth reading.

**The fix is B6a's own lesson applied one layer up: a retired feed must EMIT, not vanish.**
`compute_feed_freshness` now returns unwatched feeds with `status = 'unwatched'` and a NULL bound —
a *positive statement* that something is deliberately not watched — and a second resolve arm closes
alerts against that statement, with a note saying the expectation was retired and where the reason
lives.

Three ways a naive version goes wrong, all avoided:

- **Resolving on ABSENCE** would close alerts for feeds that vanished because their query errored or
  their mirror went blind — *"I cannot see this feed"* rendering as *"this feed is fine"*, the exact
  confusion `_ff_blind` exists to prevent. `compute_feed_freshness` carries the registry's bound
  through **even when the per-feed query throws**, so an erroring feed keeps a non-NULL bound and can
  never be mistaken for a retired one.
- **Reading the NULL bound off a stale mirror** would let a retirement someone reverted hours ago
  close today's alert. The unwatched set requires a mirror row inside the same 3-day freshness window.
- **Auto-resolving the residual case** (deregistered outright, hard-deleted) would close a
  *disappearance* identically to a *decision*. It is instead counted and named as `alerts_orphaned`,
  never updated.

Both retirements — `property_sale_events` (B6c-dup's decision, kept verbatim; only the mechanism
corrected) and `prospect_leads_ownership_change` (B6b-lead's) — now carry `is_active = true`, a NULL
bound, and a paragraph of `unwatched_reason`. Their alerts closed with the B6d note.

---

## 7. Positive controls (rule 3d)

A bound widened so far that nothing can trip it is the same failure as no monitor at all. Each
control ran live in a rolled-back transaction:

| control | expected | observed |
|---|---|---|
| `opm_workforce` @ 199d (inside the new 200d bound) | no alert | `new_alerts: 0` ✅ |
| `opm_workforce` @ 205d | alert opens | `new_alerts: 1` ✅ |
| `gsa_leases_snapshot` @ 95d (new 90d bound) | alert opens | `new_alerts: 1` ✅ |
| `property_sale_events` @ 1800d, unwatched | never alerts | `new_alerts: 0`, `orphaned: 0` ✅ |
| `medicare_clinics` mirror row deleted | orphan counter fires | `alerts_orphaned: 1`, named ✅ |

The last one is the P182 discipline applied to a counter that currently reads zero: **a zero is only
evidence once the detector has been shown capable of a non-zero.**

Post-control state verified clean: 23 mirror rows, `opm_workforce` age restored to 120,
`medicare_clinics` row restored, 2 open alerts.

---

## 8. What was NOT done

- **No producer was started, stopped or altered.** The two real breaks (**B6d-cms**, **B6d-sam**) are
  named and filed, not fixed — fixing them here would make it impossible to tell which change moved
  which number.
- **`prospect_leads_ownership_change` stays dead**, per B6b-lead. B6d only stops its alert from
  describing that decision forever.
- **The `alerts_orphaned` residual is reported, not auto-resolved.** We cannot distinguish a
  deliberate deregistration from a row that silently disappeared, so it stays visible and human.

---

## 9. Verification

```sql
-- gov / dia: every feed graded, and the grade next to the measurement
SELECT feed_name, cadence_class, sla_days, p50_gap, grade, observed_silence_exceeds_sla
  FROM v_feed_expectation_grade ORDER BY grade, feed_name;

-- LCC: the alert surface. Every open row should be worth reading.
SELECT jsonb_pretty(lcc_check_feed_freshness());
--   stale_total                 -> only genuine breaks
--   unwatched_alerts_resolved   -> retirements that closed
--   alerts_orphaned             -> feeds that left the surface without saying so
```

- **Every open `feed_stale` alert names a real break.** Today: `medicare_clinics` (CMS ingestion
  failing since 2026-06-25) and `sam_lease_opportunities` (SAM opportunities API 401).
- **`opm_workforce` and `gsa_leases_snapshot` must not fire in the next 7 days.** Both would have
  under their old bounds; both are healthy.
- **`alerts_orphaned` must stay 0.** Non-zero means a feed left the surface without a recorded
  decision — the failure mode §6 exists to make visible.
- ⚠️ **`grade = 'cannot_be_sized_from_data'` is not a defect**, it is an honest statement that the
  bound rests on a declared schedule. Re-grade those four once three runs have been observed.

Guards: `life-command-center/test/b6d-feed-expectation-grading.test.mjs` (7 tests, **12/12 mutations
verified RED**) and `government-lease/tests/unit/test_b6d_feed_expectation_grading.py` (8 tests,
**12/12 mutations verified RED**).

---

## 10. ⚠️ Three lessons the guards themselves paid for

**Both guards initially passed a mutation they were written to catch, for the same reason, twice —
and the reason is already documented in this repo.**

1. **`'feed_mirror_stale'` appears in both an INSERT and its auto-resolve arm.** A whole-body grep for
   the literal stayed **green** when the INSERT was deleted. This is B6c-dup's finding verbatim — *a
   file-wide grep for a predicate that legitimately appears twice is not a guard; anchor on the
   branch* — reproduced in a guard written after it was documented.
2. **B6d added a third copy of `synced_at > now() - p_mirror_max_age`.** The assertion inherited from
   B6a's guard grepped the whole function body for it, so deleting the one in `domain_mirror` stayed
   green. **A change that adds a legitimate second occurrence of a predicate silently disarms every
   whole-body assertion about it.**
3. ⚠️ **Comment-stripping was not enough, and the gov guard failed on itself proving it.** B6d records
   each retirement's reasoning in `feed_freshness_registry.unwatched_reason` — a **data value** — and
   `property_sale_events`' reason explains that B6c-dup used `is_active = false`. So the phrase the
   guard forbids appears verbatim in a string literal that is not a comment and must not be deleted.
   **This is the A5c/N18 defect one level deeper: prose satisfying a grep for the code it describes,
   stored in a column rather than a comment.** Any assertion about SQL *code* must run over code with
   string literals blanked, and the guard now asserts its own literal-stripper is exercised.

---

## 11. Security note

`compute_feed_cadence` is SECURITY DEFINER and builds dynamic SQL from the registry, exactly like
`compute_feed_freshness` — so it inherits the privilege vector B6a closed by revoking anon writes on
`feed_freshness_registry` (**verified still closed 2026-08-29: anon holds SELECT only on gov and
dia**). It was first granted to `anon` out of habit; nothing cross-DB reads it (the LCC pull reads
`v_feed_freshness`), so it and `v_feed_expectation_grade` are now **service_role only**. A future
accidental re-grant of registry writes cannot then be chained through a second definer function.
Identifiers go through `format()` `%I` and the filter value through `%L`, pinned by the gov guard.
