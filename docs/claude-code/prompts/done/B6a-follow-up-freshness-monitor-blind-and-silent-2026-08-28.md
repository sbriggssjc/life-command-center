# B6a-follow-up — the freshness monitor went quiet at the moment it went blind

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B6a-follow-up`.
**Repo:** **life-command-center** (LCC Opps side). gov is already correct — do not change it.
**Contract:** `docs/architecture/data-coherence-invariants.md` **I11** (added from this finding).
**Source:** `docs/audits/B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md` §7a.

---

## 0. The finding, verified twice

B6a registered four ingestion producers dead since March–April 2026 and they now read **RED** on
gov's own view (170/170/150/144 days against a 45-day SLA). **They will never reach an alert**,
because the chain that carries gov's verdict to LCC's alerting has been dead for a month — **and
every layer of it reports success.**

| layer | state | what it reports |
|---|---|---|
| gov `v_feed_freshness` | ✅ **correct** — says `sam_lease_opportunities` is 32d stale | the truth |
| LCC crons **140/141** (daily) | fire, record **`succeeded`** | success |
| `lcc_finalize_feed_freshness` | consumes only `status_code = 200`, **silently drops everything else** | **`(0,0)`** — identical to *nothing to do* |
| `lcc_domain_feed_freshness.synced_at` | frozen **2026-07-26** (gov) / **2026-07-29** (dia) | a mirror that looks populated |
| `lcc_check_feed_freshness` | **excludes mirror rows older than 3 days** | **`new_alerts: 0, stale: []`** |

**Independently verified 2026-08-28 (Cowork):** gov mirror **33 days** stale across **13 feeds**,
dia **30** across **5**; `lcc_health_alerts` `feed_stale` — **8 ever, 0 open, last detected
2026-07-24**, i.e. **two days before the sync died.** The alerts stopped when the monitoring
stopped, and the surface has read healthy ever since.

> **The staleness guard on the mirror IS the silent failure.** The exclusion is individually
> defensible — evaluating a stale mirror would emit false alerts — but **"I cannot see this feed"
> and "this feed is fine" must never render identically.**

---

## 1. What to fix — two changes, both on the LCC side

**1a. `lcc_finalize_feed_freshness` must COUNT and SURFACE non-200 outcomes.** A fail-soft that
swallows the failure and returns `(0,0)` makes *everything failed* indistinguishable from *nothing
to do*. Return the non-200 count and the distinct status codes seen; a run where **every** page was
non-200 is a failure, not a no-op.

**1b. `lcc_check_feed_freshness` must ALERT on a stale mirror instead of falling silent.** The
exclusion stays — do not evaluate untrustworthy rows — but the excluded set becomes its own
alertable condition (`feed_mirror_stale`, deduped, auto-resolving on the next successful sync).
**Report `feeds_evaluated` and `feeds_excluded_stale_mirror` as separate honest counts.**

⚠️ **Diagnose the transport before you patch the consumer.** `synced_at` frozen on the same date
across **all 18 feeds in both domains** points at the fetch, not at per-feed logic. **Find out what
the non-200 actually is** (auth? a retired host? the P194 class — a client pointed at a deployment
nobody tore down? RLS/`security_invoker` returning `200 []`, the P157 class?). ⚠️ **`200 []` would
pass a status-code check while carrying nothing** — check the body, not just the code. **If the
transport is the whole bug, say so and fix that; 1a/1b are still required so the next outage is
loud, but do not report a transport fix as if the blindness were fixed too.**

---

## 2. ⚠️ Rules

**2a. Positive-control both changes — this is the same requirement B6a met and it is why B6a is
trustworthy.** Deliberately starve the check (a stale mirror) and **prove `feed_mirror_stale`
opens**; restore and prove it auto-resolves. **A monitor that has never been seen going red on its
own blindness is a claim, not a monitor** — which is precisely the state being repaired.

**2b. Expect a burst of REAL alerts on first correct run, and do not suppress it.** Thirteen gov
feeds and five dia feeds have been unevaluated for a month, and B6a's four producers are 144–170
days overdue. **The first honest run should be loud.** ⚠️ **But cap and rank it** — a wall of alerts
is the badge-that-is-noise failure. Dedupe per feed, and separate *"the feed is stale"* from
*"we could not evaluate the feed."*

**2c. Do not touch gov.** Its view is correct and B6a's registry is correct. **This is an LCC
transport-and-alerting repair.** Mixing a gov change in makes it impossible to tell which side moved
the number (the same reason B6a deliberately left this alone).

**2d. Read `new_alerts` and `feeds_evaluated`, never `succeeded`.** Crons 140/141 have recorded
`succeeded` daily throughout the outage. **A cron's exit status is not a state delta** — that is the
doctrine this whole finding is an instance of.

**2e. Check whether other checks share the shape.** `lcc_check_feed_freshness` is unlikely to be the
only check that filters out inputs it cannot trust. **Grep the other `lcc_check_*` functions for an
exclusion on staleness/nullness and report which ones can go silent the same way** — name them,
size them, do not fix them here.

---

## 3. Verification

- **`feeds_evaluated` > 0 for both gov and dia**, and `lcc_domain_feed_freshness.synced_at` moves to
  today. **That is the state delta** — not the cron's status.
- **`feed_stale` alerts open for the genuinely stale feeds**, including the four B6a producers.
- **Both new behaviours seen firing and auto-resolving** (§2a).
- **The transport cause is NAMED**, even if the fix is elsewhere.
- Guards mutation-verified RED, **comments stripped before matching** (a header that quotes the
  broken predicate otherwise satisfies a naive grep — the A5c/N18 defect).

## 4. Deliverable

`docs/audits/B6a_FOLLOWUP_FRESHNESS_MONITOR_2026-08-28.md`, folded into
`docs/architecture/data-coherence-invariants.md` **I11** (update its detector-status row — it
currently reads ❌ VIOLATED, LIVE), the backlog row, and a STATUS entry.

⚠️ **One open item from B6a rides along and must be reported, not fixed here:** `record_skip` has
**not yet been exercised by a real run** (daily `0 8 * * *`, weekly `0 6 * * 1`). The four RED
producers are a **registry** result, proving the config rows, not the emission fix. **Check whether
a `Task skipped` row for `gsa_ingest_+_diff` has appeared in `run_log` with
`skip_reason='gsa_download_folder_empty'` and `skip_declared: true`** — and if the run has not
happened yet, **say that plainly rather than reporting the RED rows as proof of the fix.** Until a
run passes through, *no bad rows* and *no rows at all* read identically.
