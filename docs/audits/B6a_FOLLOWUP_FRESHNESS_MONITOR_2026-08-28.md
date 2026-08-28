# B6a-follow-up — the monitor went quiet at the moment it went blind

**2026-08-28 · LCC Opps `xengecqvemvfknjvbvrq` (+ one dia grant) · contract I11 · playbook Class 21
· backlog B6a-follow-up**

`feeds_evaluated` **2 → 25**. `feeds_excluded_stale_mirror` **18 → 0**. Mirror `synced_at`
**2026-07-26 (gov) / 2026-07-29 (dia) → today**, for the first time in 33 and 30 days.
**Six `feed_stale` alerts opened**, including all four producers B6a registered. Two
`feed_mirror_stale` alerts opened *and auto-resolved*, which is the monitor demonstrating it can now
see its own blindness.

**gov was not touched.** The one domain-side change is a dia GRANT (§3).

---

## 1. What shipped

| | |
|---|---|
| `supabase/migrations/20261002100000_lcc_b6a_followup_feed_freshness_loud.sql` | (1a) finalize counts + surfaces + retries non-200; (1b) check alerts on the set it refuses to evaluate; `lcc_feed_freshness_sync_status` watermark; finalize cron becomes a retry cycle |
| `supabase/migrations/dialysis/20261002100100_dia_b6a_followup_restore_feed_freshness_anon_grant.sql` | restores the anon EXECUTE R56 gave dia, **and** closes the registry write hole that grant would otherwise reopen |
| `test/b6a-followup-feed-freshness-loud.test.mjs` | 17 tests, **15 mutations verified RED**, comments stripped before matching |

**No new alert system, no new registry.** `lcc_check_bd_sync_freshness` already does exactly this
for the BD mirror (`bd_sync_stale` / `bd_sync_leg_stale` / `bd_sync_secret_missing`, off
`lcc_mirror_sync_watermark`). This follows that shape rather than inventing one.

---

## 2. ⚠️ The transport was TWO different causes, and neither was the one the shape suggested

All 18 feeds across both domains froze within three days of each other, which reads like one bug in
the shared pull. **It is two unrelated bugs that happened to land in the same week**, and a fix
aimed at either alone would have left the other silent — while the honest counts from (1a) would
have kept reporting the survivor as broken.

Reproducing the exact production request (same URL, same vault key, no inflight side effects):

| domain | HTTP | body | class |
|---|---:|---|---|
| **gov** | **500** | `{"code":"57014","message":"canceling statement due to statement timeout"}` | marginal |
| **dia** | **401** | `{"code":"42501","message":"permission denied for function compute_feed_freshness"}` | hard |

### 2a. gov is a COLD-CACHE timeout at the 3-second boundary — not a break

`anon`'s `statement_timeout` on gov is **3 s** (`authenticated` 8 s, `service_role` none).
`compute_feed_freshness()` runs `max(<ts>)` over 18 registered tables, most of them unindexed on
that column.

| measurement | result |
|---|---:|
| warm, as owner | **221 ms** (18 feeds) |
| warm, `SET LOCAL ROLE anon` through the view | **311 ms** |
| **cold**, first touch of the day, **top 8 feeds only** | **2,601 ms** — with 10 feeds still to go |
| — of which `prospect_leads_ownership_change` alone | **1,578 ms** |

**Positive control, the decisive measurement — the same URL and the same anon key, three minutes
apart:**

* **17:41, cold → HTTP 500 / 57014.**
* **17:44, warm → HTTP 200, 3,786 bytes, all 18 feeds.**

So the gov leg is **flapping on a boundary, not broken**, which is exactly why it worked for a year
and then stopped: the tables grew until a cold 05:30 run — the first touch of the day, by
construction — no longer fitted in 3 seconds.

> ⚠️ **A marginal failure is the worst kind to diagnose from a status code.** `500` reads as "the
> server is broken"; the server was fine and answered correctly ninety seconds later. Had the retry
> below been in place, this outage would never have happened at all.

### 2b. dia is a hard permission break

dia's ACL on `compute_feed_freshness` was `{postgres=X, service_role=X}` against gov's
`{authenticated, anon, service_role}`. **`anon` lost the EXECUTE grant R56 gave it.** No retry can
fix that, which is the point: the retry must never be able to hide a real break.

### 2c. ⚠️ The brief's own premise was partly refuted, and that matters

Brief §2c says *"Do not touch gov. **Its view is correct.**"* Its view is correct **and not
servable to the caller that reads it**, which is a different property and the one that failed. gov
is still not touched — its leg is mitigated LCC-side (§4) — but "the view is correct" was not
sufficient grounds to stop looking.

---

## 3. The one domain-side change, and why it could not ship alone

Restoring dia's `anon` EXECUTE is a one-line return to the documented R56 contract. **It cannot ship
by itself.** Measured before applying, dia's registry ACL was

```
{postgres=arwdDxt, anon=arwdDxt, authenticated=arwdDxt, service_role=arwdDxt}
```

`compute_feed_freshness` is **SECURITY DEFINER**, so `anon` EXECUTE over a registry `anon` can
**write** lets any anonymous caller repoint a feed at an arbitrary table and read `max()` of it, or
delete the registry and silently disable every freshness alert. **That is precisely the hole B6a
closed on gov, still open on dia** — restoring EXECUTE without closing it would have reopened it.
Both halves ship together. `SELECT` is retained: the LCC cross-DB pull reads the registry as anon.

Verified after: `exec_roles {authenticated, anon, service_role}`, registry `anon=rxt` (no write),
and the live dia request **401 → 200 with 5 rows**.

---

## 4. (1a) A fail-soft that swallows the failure is not soft, it is silent

`lcc_finalize_feed_freshness` knew **two** outcomes — `status_code = 200`, and everything else,
which it dropped with a `WHERE` clause and left in the inflight table for 24 hours. It now
classifies **four**, and the fourth is the one nobody had named:

| class | meaning | action |
|---|---|---|
| `responded_ok` | 200 with a non-empty body | consume |
| `responded_bad` | any other status | **record** — this was the silent drop |
| `lost` | no response row, and past the grace window | **record** — see below |
| `pending` | no response row yet, inside the grace window | leave alone; not a failure |

> ⚠️ **`lost` had to be its own class or the fix would have been incomplete.**
> `net._http_response` is pruned to a **~6-hour** window (measured: 11:42→17:41 today) while the
> inflight row lingered **24 hours**. A response arriving even one minute after finalize ran could
> therefore **never** be consumed — by the next day's pass it was long since pruned. That is a
> second, permanent silent loss sitting underneath the first, and it is invisible unless you ask
> what happens to a request that is neither answered nor answerable.

**Also fixed, and it was a third silent path:** the missing-vault-secret branch did `RAISE NOTICE`
and `CONTINUE` — a no-op into a log nobody reads. It now records `no_secret`.

**And a fourth, pre-emptively:** a `200` carrying an **empty array** is not a success. PostgREST
answers `200 []` for a view `anon` cannot read under RLS (the P157 class), so a status-code check
passes while nothing arrives. Read the body, not the code.

Failures now land in **`lcc_feed_freshness_sync_status`**, a per-domain watermark on the
`lcc_mirror_sync_watermark` precedent — because **a failed leg had nowhere to be recorded**, which
is how a month of failures left no trace anywhere.

**The retry** (bounded, 3 attempts) is the LCC-side mitigation for gov's marginal timeout: attempt 2
meets a cache the failed attempt has already warmed. It is a **mitigation, not a cure** — see §8.

> ⚠️ **A retry re-fired inside a single finalize can never be consumed by that same call**, and by
> the next day's run its response is pruned. So the finalize cron became a **cycle** —
> `35,40,45 5 * * *`. Each pass consumes what is ready and re-fires what failed; the next pass
> consumes the retry. The schedule *is* the mechanism, not a convenience.

### The contrast, on the real stranded requests

This morning's 05:30 cron left two inflight rows whose responses were pruned hours ago. The old code
on this exact state returned `(0, 0)`. The new code:

```
finalized_requests 0 | rows_upserted 0 | failed_requests 0 | lost_requests 2 | pending_requests 0
domains_ok []        | domains_failed [dia, gov]           | retried_domains [dia, gov]
status_codes {"dia:lost": 1, "gov:lost": 1}
```

Second pass, consuming the retries: `finalized_requests 2`, **`rows_upserted 23`** (18 gov + 5 dia),
`domains_ok [dia, gov]`, `status_codes {"dia:200":1, "gov:200":1}`.

---

## 5. (1b) The exclusion stays. The excluded set becomes the alert.

The tempting fix is to delete the 3-day mirror exclusion. **That is the wrong fix and it is worse
than the bug**: the check would then emit alerts about ages it explicitly cannot vouch for.

The exclusion is kept, and the set it removes is now its own alertable condition —
**`feed_mirror_stale`**, one row per domain, deduped, auto-resolving, carrying the leg's last
outcome and HTTP status so the operator lands on the cause rather than the symptom. A domain with
**zero** mirror rows is blind too, not absent, so the scan enumerates both domains rather than
grouping what happens to be there.

`feeds_evaluated` and `feeds_excluded_stale_mirror` are now **separate honest counts**, because *"I
evaluated nothing"* and *"nothing is wrong"* had been rendering identically for a month.

> **The two failures are opposite, and each is a plausible "fix" for the other.** Delete the
> exclusion → false alerts. Keep it without alerting on what it removes → silence on the next
> transport break. `test/b6a-followup-feed-freshness-loud.test.mjs` pins **both**, and each is
> mutation-verified: M8 deletes the exclusion **from the evaluable set only** (it survives in the
> blind-spot scan, so a body-wide `includes()` stayed green — the assertion had to be tightened to a
> slice of the named CTE).

---

## 6. The positive control — the monitor seen going red on its own blindness, then green

Not simulated. Run against the live month-old mirror, then again after the sync recovered.

| | mirror STALE (before) | mirror FRESH (after) |
|---|---:|---:|
| `feeds_evaluated` | **2** (LCC-local only) | **25** |
| `feeds_excluded_stale_mirror` | **18** | **0** |
| `mirror_alerts_new` | **2** | 0 |
| `mirror_alerts_resolved` | 0 | **2** |
| `new_alerts` (`feed_stale`) | **0** | **6** |

The left-hand column is the state the system had been in for a month. **Under the old code it
returned `{"new_alerts": 0, "stale": []}`.** Both `feed_mirror_stale` alerts are now `resolved` —
the round trip ran on real data, in both directions (P195: a reversal never run is a claim).

Re-running the check is idempotent: `new_alerts 0`, `mirror_alerts_new 0`, inflight drained to 0.

---

## 7. The first honest run is loud, and it is six

Brief §2b said to expect a burst and to cap and rank it rather than suppress it. Measured, the burst
is **6** — loud, not a wall, because the alerts were already deduped per feed:

| feed | domain | last data | age | SLA | severity |
|---|---|---|---:|---:|---|
| `gsa_lease_change_facts` | gov | 2026-03-11 | **170d** | 45 | error |
| `gsa_lease_timeline` | gov | 2026-03-11 | **170d** | 45 | error |
| `prospect_leads_ownership_change` | gov | 2026-03-31 | **150d** | 45 | error |
| `property_sale_events` | gov | 2026-04-06 | **144d** | 45 | error |
| `medicare_clinics` | dia | 2026-06-25 | 64d | 45 | warn |
| `sam_lease_opportunities` | gov | 2026-07-27 | 32d | 14 | error |

**All four of B6a's registered producers are here.** That is the whole point of the chain: B6a made
them visible on gov's view, and this makes that visibility reach an alert. The payload is still
ranked by age and capped at 25 with an explicit `stale_omitted` count — an uncapped list is the
badge-that-is-noise failure waiting to happen as the registry grows.

**Two feeds this surfaces were nobody's stated target and are real:** dia `medicare_clinics` (64d)
and gov `sam_lease_opportunities` (32d, against a 14-day SLA — the §18 SAM rate-limit ceiling,
now visible instead of inferred).

---

## 8. ⚠️ What is NOT fixed — read this before quoting the monitor as healthy

**8a. gov's cold-cache timeout is MITIGATED, not cured.** The retry works because attempt 2 meets a
warm cache, and the measured margin is comfortable (231 ms warm vs a 3,000 ms budget). But the
*first* attempt of each day will still usually fail, the mitigation is probabilistic, and the margin
shrinks every time a feed is registered or a table grows. **The durable fix is domain-side** — an
index on the hot `ts_column`s, or raising `anon`'s `statement_timeout` on gov, or moving the pull to
`service_role`. Filed as **B6a-follow-up-b**; deliberately not done here (brief §2c). The honest
read: a gov leg that needs its retry every morning will now *say so* in
`lcc_feed_freshness_sync_status.last_attempt_no`, which is the metric to watch.

**8b. §2e sweep — this was the only one, and one sibling already does it right.** All ten
`lcc_check_*` functions were read for the same shape (an exclusion of inputs it cannot trust, with
no counterpart that alerts on the excluded set):

| function | verdict |
|---|---|
| `lcc_check_feed_freshness` | **the shape** — fixed here |
| `lcc_check_bd_sync_freshness` | **already correct, and the precedent this fix follows** — alerts on a stale mirror, a stale/failing leg (`http_error`/`no_secret`/`partial_no_response`/`suspect_empty_source`) and missing vault secrets |
| `lcc_check_provenance_flush_health` | its `last_success_at IS NULL OR < 3h` is the **alert condition**, not an exclusion — correct direction |
| `lcc_check_cron_health` | a 24h scan window over `cron.job_run_details`; a job that never ran is covered by its sibling `lcc_check_disabled_critical_crons`. **Nearest neighbour, and covered** — but note the coverage is a *separate function*, so retiring that sibling would open this shape |
| the other six | no trust-exclusion |

**Named, not fixed.** Nothing else warranted a change today.

**8c. The four producers are still dead.** This round moved **visibility only** — same as B6a.
`gsa_lease_change_facts` and `gsa_lease_timeline` still have no scheduled caller. **B6b** owns the
restart, and it can now proceed: its premise was being able to tell whether a restarted producer
stays up, and until today it could not be told.

**8d. ⚠️ B6a's `record_skip` has STILL not been exercised by a real run, and the RED rows are not
proof that it has.** Measured on gov `run_log` at 17:5x UTC: **0 rows carrying `skip_reason` ever,
0 rows of any kind since B6a shipped**, newest row 2026-08-27 18:52. The daily runner fires
`0 8 * * *` and the weekly `0 6 * * 1`, so **no run has passed through the new code yet.** The four
RED producers are a **registry** result — they prove the config rows, not the emission fix.
**Until a run passes through, "no bad rows" and "no rows at all" read identically** (B6a §7a's own
lesson, applied to B6a). The check due tomorrow is a `Task skipped` row for `gsa_ingest_+_diff`
carrying `skip_reason='gsa_download_folder_empty'` and `skip_declared: true`.

---

## 9. The durable lessons

1. **A guard that filters out what it cannot trust must alert on what it filtered.** The exclusion
   here was individually defensible and collectively fatal. *"I cannot see this"* and *"this is
   fine"* must never render identically. (**I11**)
2. **A fail-soft that returns a clean zero is not soft, it is silent.** `(0,0)` may never mean both
   *nothing to do* and *everything failed*. Count the failures and name them.
3. **Diagnose the transport before patching the consumer, and do not stop at the first cause.**
   Two domains froze three days apart and it read as one bug; it was a marginal timeout and a
   revoked grant, sharing nothing but a week.
4. **A `500` from a marginal cost is not a break.** The decisive evidence was re-firing the
   identical request against a warm cache and getting `200`. Before diagnosing a timing failure,
   try it twice.
5. **A retry must never be able to hide a hard failure.** Bound it, and make the exhausted case
   alert. dia's 401 would have retried forever and stayed quiet.
6. **Reuse the sibling that already got it right.** `lcc_check_bd_sync_freshness` had the whole
   pattern; the sweep that found it was the same sweep the brief asked for.
7. ⚠️ **`CREATE OR REPLACE` does not replace a function of different arity.** All three functions
   here changed signature; each is `DROP`ped first. Missing it on `lcc_check_feed_freshness()` alone
   would have made cron 193's call ambiguous (42725) and taken the hourly health tick's **other
   three checks** down with it — a monitoring fix that silences monitoring.
8. ⚠️ **plpgsql resolves an identifier to a DECLAREd variable before a SQL alias.** Aliasing
   `net._http_response` as `r` beside a `DECLARE r record` **plans fine and dies only when
   executed** (`55000 record "r" is not assigned yet`). No structural check catches it. It was found
   by *running the function*, which is the general rule (P195: run the round trip).
9. ⚠️ **A `sed`-style fix over a function body over-reaches.** Renaming the alias with a regexp
   rewrote four references inside the `FOR r IN` loop as well. Caught by listing every affected line
   afterwards rather than trusting the substitution — *verify the edit, not just the intent*.
10. ⚠️ **A mutation that leaves the test green is a gap in the guard, not a passing test.** Four of
    the first fifteen did: `'lost'` also appears in a `FILTER` count, the return-column names are
    also *assigned* in the body, the watermark table is also named in an `ON CONFLICT` qualifier,
    and the mirror predicate also appears in the blind-spot scan. **A body-wide `includes()` is a
    weak assertion whenever the token appears more than once.** All four were tightened to the
    specific construct and re-verified RED.

---

## 10. Verification

```sql
-- 1. The mirror is alive, and that is the state delta -- NEVER the cron's status.
select source_domain, count(*) feeds, max(synced_at),
       (now()::date - max(synced_at)::date) as mirror_age_days
  from public.lcc_domain_feed_freshness group by 1;          -- gov 18 / dia 5, age 0

-- 2. feeds_evaluated > 0 for both domains; excluded back to 0.
select public.lcc_check_feed_freshness() - 'stale' - 'mirror_unevaluable';
--    feeds_evaluated 25, feeds_excluded_stale_mirror 0, new_alerts 0 on a re-run

-- 3. The alerts that matter are open, including B6a's four.
select source, severity from public.lcc_health_alerts
 where alert_kind = 'feed_stale' and resolved_at is null order by source;

-- 4. Per-leg health -- read last_outcome and last_attempt_no, not the cron.
--    last_attempt_no persistently > 1 on gov means 8a is biting; escalate to
--    B6a-follow-up-b rather than raising the retry cap.
select * from public.lcc_feed_freshness_sync_status;
```

**Reverse** with the runbook at the foot of the LCC migration (both functions restored from the R56
bodies, the single finalize schedule re-registered, the additive tables optionally dropped), and the
dia grant with the `REVOKE`/`GRANT` pair in its own header.
