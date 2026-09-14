# B6b — restart the GSA landlord-change detector, and find out why the raw feed stopped too

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B6b`.
**Repo:** **government-lease** (the pipeline) + LCC only if a consumer needs wiring.
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` (definition of done) ·
`docs/architecture/data-coherence-invariants.md` **I4/I11**.
**Source:** `docs/audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md` §2/§8 ·
`B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md`.

---

## 0. Why this is unblocked now

B6a made the four dead producers **visible** (registry + declared skips; RED at 170/170/150/144
days). B6a-follow-up made them **alertable** — the freshness chain is alive again (gov **13 → 18
feeds**, both domains synced today, **6 real `feed_stale` alerts open** after 33 days of zero).
**That was the precondition: you can now tell whether a restarted producer stays up.** Two of those
six alerts are this prompt's target.

**The prize.** `gsa_lease_change_facts` holds **336,303 rows** with a **thirteen-year** landlord-change
series (`landlord_change_flag` on **38,213** rows / 8,845 leases, **38,055** carrying both
`lessor_name_old` and `lessor_name_new`, 2013-02 → 2026-02). Deflated by B6: **1,338 net-new
ownership transitions across 1,202 properties** — and that is a **FLOOR**, not a forecast, because
snapshots sit undiffed.

**It also revives a proven lane.** `prospect_leads.lead_source='ownership_change'` holds **7,729
leads, 2,041 of them historically WORKED**, dead since **2026-03-31**. ⚠️ **That distinguishes this
from most restarts: it is not a speculative producer, it is one with a measured consumption
record.**

---

## 1. ⚠️ The finding to start from — and a SECOND one I measured today

**Known (B6 §8): the raw feed and the derived layer have DIFFERENT writers, and only one is
scheduled.** `gsa_lease_change_facts` + `gsa_lease_timeline` are written **only** by
`src/ingest_gsa_historical.py` — a manual CLI reachable from `run_pipeline.py:172`, which CI does not
run. **No scheduled caller exists on either project.** The live Monday job (`src/gsa_auto_sync`)
imports `run_diff` and writes `gsa_snapshots` + `gsa_lease_events` — **not** the change layer.

**🚨 NEW, measured 2026-08-28 (Cowork) — THE RAW FEED IS STALE TOO:**

| object | newest | note |
|---|---|---|
| `gsa_lease_change_facts.snapshot_date` | **2026-02-01** | the derived layer, dead ~7 months |
| `gsa_snapshots.snapshot_date` | **2026-07-01** | **the RAW feed, ~58 days old** — 150 snapshot dates total |
| undiffed snapshots | **4** — `2026-03-01, 2026-05-01, 2026-06-01, 2026-07-01` | `2026-04` is genuinely absent from the raw feed |
| `prospect_leads` (`ownership_change`) | **2026-03-31** | 7,729 rows, 2,041 worked |

**This changes the shape of the job.** Restarting only the diff processes the four backlog months,
reports success, and then **stops again at 2026-07 with nothing for August** — while the
`feed_stale` alert stays open and everyone believes it is fixed. **That is the B6a lesson repeating
one layer up: follow the signal all the way to the source before declaring a restart.**

⚠️ **Do not assume the raw feed is broken.** GSA publishes on a lag and monthly. **Establish what the
expected cadence actually is** — is a 2026-08 snapshot due yet? Does the Monday `gsa_auto_sync` job
still run, and what did it do on its last runs? **A feed that is merely early in its cycle and a
feed that died look identical from a `max(snapshot_date)`** — the same *wrong-SLA-vs-dead-feed*
ambiguity flagged for dia `medicare_clinics`.

---

## 2. What to do

1. **Diagnose the raw feed first.** Is `gsa_auto_sync` still scheduled and succeeding? What is the
   true publish cadence, and is `2026-04`'s absence an upstream gap or a failed pull? **Name the
   answer before touching the diff.**
2. **Give the derived layer a scheduled caller** — the change layer must run whenever a new snapshot
   lands, not by hand. Prefer extending the existing Monday job over adding a parallel scheduler
   (**one owner per state transition**).
3. **Backfill the four undiffed snapshots**, in order, dry-run first.
4. **Confirm the lead lane revives** — `ownership_change` leads resume, and check the **consumer**
   still exists and is reachable before celebrating volume (2,041 worked historically; verify the
   surface that worked them is still live).
5. **Feed the result to the ownership store** only if it is clean — see §3.

---

## 3. ⚠️ Rules

**3a. `landlord_change_flag` is a RAW SIGNAL. Deflate before quoting, and never feed it raw into
`ownership_history`.** Three documented inflators, all present:
- **46.7% of the flag is a pure name RE-SPELLING** — it is computed on raw string inequality, not a
  normalized key. That is the single largest deflator and B6 measured it.
- **A2b per-lease fan-out** — this table is keyed on `lease_number`, so it is **maximally exposed**:
  one conveyance emits one row per lease on the building.
- **P138 flicker** — an SPE↔parent oscillation with a return leg; the DATE is real, the DIRECTION is
  not (`is_oscillating_pair`).
**Deflated: 38,213 → 1,338 / 1,202 properties (28.6×).** Quote the deflated number, show the
deflation, and **report the coverage delta and the depth delta separately** (B1: +901 vs +28).

**3b. Reuse the existing guards and the existing apply path.** `gov_strip_brokerage_suffix`
(**strip, never reject**), self-transition and oscillating-pair exclusions,
`lcc_ownership_chain_name_key`, and the A2 apply path (cron 244) already exist and were each
calibrated on named rows. ⚠️ **`lcc_owner_strict_core` was measured and REJECTED for this
population.** Do not add a new comparator.

**3c. ⚠️ The `ownership_history` propagation trigger nulls a real owner if the row names its parties
as TEXT.** B5 fixed `trg_propagate_ownership_to_property` to be fill-forward after finding **7,567
rows already damaged** and **1,446 of 9,312** about to be. **This producer writes text parties — the
exact shape.** Confirm the fix is in place, snapshot before the batch, and positive-control both
directions (preserves when null, propagates when set).

**3d. Register the new scheduled step in B6a's producer registry** with an expected cadence, and
**declare its skip conditions**, or you have restarted a producer into the same blindness B6a just
fixed. **The `feed_stale` alert for `gsa_lease_change_facts` must CLOSE on its own** when the feed
resumes — that is the acceptance test, not a green run log.

**3e. Do not fix `property_sale_events` here** (the `bigint`-vs-`uuid` link columns, **B6c**) even
though its alert is adjacent. One repair per change, or you cannot tell which moved the number.

**3f. Python, in government-lease** — every network call carries its own `timeout=` (SIGALRM does
not bound a blocked C-level socket read).

---

## 4. Verification

- **State delta, both layers:** `max(gsa_lease_change_facts.snapshot_date)` advances past
  **2026-02-01**, and the four undiffed snapshots are consumed.
- **The `feed_stale` alerts for `gsa_lease_change_facts` and `gsa_lease_timeline` AUTO-RESOLVE.**
  ⚠️ **Read the alert state, not the run log** — that is the whole point of B6a-follow-up.
- **`prospect_leads` `ownership_change` resumes** past 2026-03-31, **and its consumer is confirmed
  reachable.**
- **The raw feed question is ANSWERED in writing**, whether or not it needed a fix.
- **Ownership-store effect reported as coverage vs depth**, deflated, with the residue named by class.
- Guards mutation-verified RED, **comments stripped before matching**.

## 5. Deliverable — and the turn is not done without it

`docs/audits/B6b_GSA_LANDLORD_CHANGE_RESTART_2026-08-28.md`, plus **the `BUILD-TURN-PROTOCOL.md`
closing checklist**: update `PLANNED-BACKLOG.md` (B6b, and B6's ranked table), the
`data-coherence-invariants.md` **I4** row if the registry gained a producer,
`connectivity-and-open-threads.md` **§4j**, gov's own `CLAUDE.md` if a durable footgun was found, and
a **STATUS** entry naming what moved and what it cost.

**If the honest answer is that the raw feed is dead upstream and the diff has nothing new to eat,
say so and stop.** Backfilling four months is still worth doing on its own — but report it as a
one-shot backfill, **not** as a restarted producer. *A one-shot repair of a recurring producer is a
chore you repeat silently forever.*
