# B6b — the GSA landlord-change detector, restarted

**Date:** 2026-08-28 · **Kind:** BUILD (gov) + diagnosis · **Backlog:** `B6b`
**Parent:** B6 §2/§8 · B6a (instrument) · B6a-follow-up (alerting)
**Projects:** gov `scknotsqkcheojiaewwh` · LCC Opps `xengecqvemvfknjvbvrq`
**Migration:** `government-lease/sql/20260828_gov_b6b_gsa_change_layer_from_snapshots.sql` (applied)
**Code:** `src/gsa_change_layer.py` (new) · `src/gsa_auto_sync.py` (wired)
**Guard:** `tests/unit/test_gsa_change_layer.py` — 14 tests, **13 source-anchored mutations RED**

---

## 0. The headline

`gsa_lease_change_facts` advanced **356,291 → 374,257 (+17,966)** and now runs to snapshot
**2026-07-01** (was 2026-02-01). `gsa_lease_timeline` **16,471 → 16,779**, current to 2026-07-01
(was 2025-12-01). Both `feed_stale` alerts **auto-resolved** — read on the alert row, not a run log.
The layer has a scheduled caller for the first time in its life.

**The raw feed was never dead.** And the derived layer was not starved of data — it was reading a
**different table**.

| | before | after |
|---|---:|---:|
| `gsa_lease_change_facts` | 356,291 · max 2026-02-01 | **374,257 · max 2026-07-01** |
| `gsa_lease_timeline` | 16,471 · max 2025-12-01 | **16,779 · max 2026-07-01** |
| open `feed_stale` alerts | 6 | **4** (the two B6b ones auto-resolved) |
| derivable backlog | 5 | **0** |

---

## 1. ⚠️ The raw-feed question, ANSWERED: it is alive and waiting on GSA

The brief flagged `gsa_snapshots` at 58 days old and asked whether the feed had died too.
**It has not.** `gsa_source_pull_log` is the instrument and it is unambiguous:

| pulled_at | snapshot_date | action | consecutive_unchanged |
|---|---|---|---:|
| 2026-08-05 | 2026-07-01 | `ingested` (7,368 leases) | 0 |
| 2026-08-10 | 2026-07-01 | `skipped_duplicate` | 1 |
| 2026-08-17 | 2026-07-01 | `skipped_duplicate` | 2 |
| **2026-08-24** | 2026-07-01 | `skipped_duplicate` | **3** |

The Monday `gsa-sync` job (`ci.yml`, `0 5 * * 1`) pulled **four days before this audit**, fetched
the file, fingerprinted it, found it content-identical to what we hold, and correctly declined to
write. Measured cadence over the last 30 snapshot dates is **28–31 days — monthly**, with one
61-day gap (2026-03 → 2026-05; **2026-04 is genuinely absent upstream**, a separate gap not caused
by anything here). GSA has simply not published August.

> **A feed early in its publish cycle and a feed that died are indistinguishable from
> `max(snapshot_date)` alone.** The difference is recorded in the pull ledger, and
> `consecutive_unchanged` is the honest counter. This is the same wrong-SLA-vs-dead-feed ambiguity
> flagged for dia `medicare_clinics`.

The freshness registry already knew this: `gsa_source_pull` (SLA 35d) was **not** among the six open
alerts, while the two derived feeds were. The instrument B6a built had already separated the live
producer from the dead consumer — nobody had read it that way.

---

## 2. ⚠️ The real cause: producer and consumer on two copies of one panel

`derive_change_facts` (`src/ingest_gsa_historical.py`) reads **`gsa_inventory_snapshot_lines`**.
The live weekly job writes **`gsa_snapshots`**. Two panels of the same GSA inventory:

| | rows | dates | newest |
|---|---:|---:|---|
| `gsa_snapshots` (live, weekly job) | 1,201,873 | 150 | **2026-07-01** |
| `gsa_inventory_snapshot_lines` (manual CLI) | 1,181,575 | 147 | **2026-02-01** |

So the change layer was not short of answers and not short of a scheduler alone — **its input had
been frozen since the last time a human ran the CLI.** Scheduling the existing code unchanged would
have derived nothing.

### The equivalence gate, and its positive control

Repointing needed proof, not inspection:

- **137 shared dates; 136 byte-identical** by a per-date digest of `(lease_number|data_hash)`.
- Field-level over **22,030 pairs** on 2025-12/2026-01/2026-02: **0 differences** across all eight
  columns the derivation reads, `data_hash` included. Membership exact both ways (0 rows in either
  panel absent from the other).
- ⚠️ **POSITIVE CONTROL (P182).** That zero is implausible on its face, so the same detector was
  re-keyed one month off: **6,223 `data_hash` / 2,005 rent / 152 lessor differences.** The detector
  fires. The zero is the data.
- The one disagreeing date, **2020-03-01**, is a strict SUBSET relation: 0 manual rows missing from
  live, 0 differing hashes, **165 rows present only in the live panel**. Preferring live loses
  nothing.

### ⚠️ But it is NOT a clean superset — and a 3-month sample said it was

**10 dates exist only in `gsa_inventory_snapshot_lines`** (2013-04, 2013-06, 2013-10, 2013-12,
2015-09, 2019-09, 2020-09, 2020-10, 2021-01, 2022-09), two of them used as `prior_snapshot_date` by
**5,029 existing facts**. My first sample covered three recent months and showed a perfect match;
the full-history digest is what exposed the 10. **The manual panel is therefore unioned in per
date, not retired** — `gov_gsa_change_panel(date)` prefers live and falls back to manual only where
live holds no rows for that date at all.

---

## 3. ⚠️ "Undiffed" is not "derivable" — the spanning guard is the whole safety argument

Across the union of both panels there are **21 undiffed snapshot dates**, not 4. Deriving all of
them would have been wrong:

| backlog_state | dates | why |
|---|---:|---|
| `derivable` | **5** | 2018-03-01 + the four recent months |
| `spanned_by_existing_fact` | **15** | an existing diff already crosses the date |
| `no_prior_snapshot` | 1 | 2013-01-01, the first date |

**13 of the 15 blocked dates sit INSIDE an existing diff** — 2018-06-01 falls within an existing
`2018-03-01 → 2019-04-01` diff carrying **18,821 facts**; 2013-05-01 within `2013-01-01 →
2013-06-01`, 6,551. Deriving them records a **second observation of conveyances the store already
holds** — the A2b per-lease fan-out hazard in the **time** dimension, which is precisely what B6's
28.6× deflation exists to undo. A date is derivable only when nothing spans it.

The four recent months and 2018-03-01 have **0 spanning facts**, which is why they are safe.

### Where the overlap came from — an unreported defect in the old writer

`_previous_snapshot_date` resolves the prior date from whatever metadata existed **at the moment
that file was ingested**, and the 2026-03-11 run processed files essentially out of order:

| written | snapshot_date | prior chosen | spans |
|---|---|---|---|
| 11:38 | 2025-12-01 | 2025-08-01 | **4 months** |
| 12:54 | 2026-02-01 | 2025-12-01 | **2 months** |
| 13:46 | 2026-01-01 | 2025-12-01 | correct |
| 16:52 | 2025-11-01 | 2025-08-01 | **3 months** |
| 17:27 | 2025-10-01 | 2025-08-01 | 2 months |
| 18:12 | 2025-09-01 | 2025-08-01 | correct |

So the existing 356k facts already contain **systematic overlapping intervals** — a fourth inflation
source on top of the three B6 named (re-spelling, per-lease fan-out, oscillation). B6's
`distinct (property, from, to)` stage neutralises it, which is why the published 28.6× still holds.
The SQL port resolves the prior from the actual panel dates and cannot reproduce the defect.

---

## 4. ⚠️ The faithfulness proof failed first, and the STORED data was the wrong one

Re-deriving 2026-02-01 gave **35 new / 26 removed / 630 changed** against a stored
**68 / 63 / 1,845**. The port was not wrong: the stored rows carry `prior_snapshot_date =
2025-12-01`, skipping 2026-01-01 (the out-of-order defect above), so they describe a two-month diff.

Re-run on dates whose stored prior IS panel-adjacent:

| date | port (new/removed/changed/landlord) | stored |
|---|---|---|
| 2026-01-01 | 33 / 37 / 1,339 / 67 | **identical** |
| 2025-09-01 | 32 / 70 / 514 / 33 | **identical** |

Row-level on 2026-01-01: **1,409 rows, 1,409 matched on the key, 0 differing in ANY of the 13
derived columns.** The SQL port is byte-faithful to the Python writer.

> A port verified only against a count would have been "fixed" toward the wrong answer. Verify on
> named rows with stated expected values, and when the port disagrees with production, **establish
> which one is right before adjusting either.**

---

## 5. ⚠️ One row aborted a 17,966-row batch, and the dry run could not see it

The apply failed **22003 numeric field overflow**. `rent_change_pct` is `numeric(8,4)`; lease
**LMT14507** (Confederated Salish & Kootenai Tribes) carried a **$1.00 placeholder rent corrected to
$10,418.00** → ratio **10,417**. Exactly one row in 17,966, on one of the five dates.

`gov_gsa_pct_or_null` now returns **NULL when the ratio is unrepresentable**. NULL is the honest
value — *not representable*, not zero (P180) — and nothing is lost, because `annual_rent_old/new`
stay on the row for a consumer to recompute. Clamping would have been a lie: 10,417 is not a rent
change, it is a placeholder correction.

> **A DRY RUN CANNOT CATCH THIS CLASS.** It never exercises the INSERT, so column constraints,
> CHECKs and FKs are invisible to it. The plan was clean five times over; the write was not. The
> dry-run/apply pair proves the *selection*, never the *write*.

---

## 6. ⚠️ The client timed out and the work had committed anyway

`gov_gsa_change_layer_tick(false, null)` exceeded the 60s PostgREST statement timeout and returned
an error. The row-count delta says it committed in full: **+17,966 facts, max date 2026-07-01,
timeline 16,779 rows all touched**. (P118 corollary 4: verify a batch by the state delta, never by
the function's return value.)

Measured: the five-date backfill ~40s, the timeline rebuild **21.7s** — together over budget. The
tick therefore takes `p_rebuild_timeline` and `src/gsa_change_layer.py` runs them as **separate
RPCs**. ⚠️ Adding that defaulted third parameter creates an **overload**, so the 2-arg signature is
**DROPPED first** or every 2-arg call fails 42725 (N15d / B1).

Two more implementation traps, both live:

- **`create temp table … on commit drop` collides on the tick's second loop iteration** — `on commit
  drop` has not fired yet inside one transaction, so the second date fails 42P07. Explicit drops.
- **An UNASSIGNED plpgsql `record` cannot be dereferenced at all** (55000), not even inside
  `coalesce()`. Using a record for the timeline result crashed the moment
  `p_rebuild_timeline=false`. Scalars.
- **⚠️ AND THE DROP SILENTLY DID NOT HAPPEN — A DDL BATCH THAT ENDS IN A RUNTIME ERROR ROLLS THE
  DDL BACK WITH IT.** The `drop function … (boolean, int)` shipped in the same batch as a `select`
  that then failed 55000 on the unassigned record, so the whole transaction rolled back; the
  follow-up used `create or replace` alone and **the 2-arg signature survived**. Verified after the
  fact by a live signature census: two `gov_gsa_change_layer_tick` overloads, and a positive control
  confirmed a 2-arg call was genuinely ambiguous. Dropped; one signature remains and a 2-arg call now
  resolves. **A migration is not applied because the statement you cared about succeeded — census the
  live objects afterwards.** (The same census produced a FALSE positive on the timeline rebuild,
  which matched `cross join lateral` **inside its own warning comment** — N18/A5c: a source detector
  must strip comments, including when the source is `pg_get_functiondef`.)
- The timeline rebuild must **not** be written as `cross join lateral gov_gsa_change_panel(d)` —
  160 function scans over 1.28M rows measured **19.3s on its own**. A plain `UNION ALL` with the
  fallback restricted to a precomputed lines-only date list is two sequential scans.

---

## 7. The deflation — coverage and depth reported separately

B6's ladder, re-run with **the same instrument** on the pre-B6b subset (excluding the five derived
dates) to make the delta like-for-like rather than comparing two ladders:

| stage | before | after | Δ |
|---|---:|---:|---:|
| `landlord_change_flag = true` | 38,213 | 39,549 | +1,336 |
| both names present | 38,055 | 39,214 | +1,159 |
| **name keys actually differ** | 19,880* | 20,498 | +618 |
| resolve to a property | 13,225 | 13,730 | +505 |
| **distinct (property, from, to)** | 4,845 | 5,156 | +311 |
| properties | 3,675 | 3,752 | **+77** |
| non-oscillating | 4,655 | **4,608** | **−47** |
| **net-new vs `ownership_history`** | 1,334 | **1,406** | **+72** |
| **properties** | 1,200 | **1,263** | **+63** |

\* stages 1–3 and 5–7 reproduce B6's published figures **exactly** (38,213 / 38,055 / 20,271 /
19,880 / 13,225 / 4,845 / 3,675 / 4,655). Net-new reads 1,334 against B6's 1,338 because
`ownership_history` has grown since (B5 landed +2,776 rows the same day) — the anti-join is against
a moving target. A 0.3% drift, explained, not an instrument disagreement.

- **COVERAGE: +63 properties** gain a net-new conveyance. **DEPTH: +72 conveyances**, 1.14 per new
  property. Reported separately per B1 (+901 vs +28).
- **The raw increment deflates 18.6×** (1,336 → 72). Fleet-wide the ratio is now **28.1×**.
- ⚠️ **Non-oscillating went DOWN 47 while conveyances went up 311.** The four new months supplied
  **return legs** for pairs that previously looked one-directional, so the P138 flicker guard now
  catches more. **More data made the deflation stricter** — the guard working, not a loss.

**Nothing was fed to `ownership_history`.** See §9.

---

## 8. ⚠️ B6's G3 row is REFUTED — and by the same trap that produced it

B6's matrix says `gsa_lease_events` carries *"no old/new lessor pair — this is a LESSEE signal, not
a landlord one."* Measured: **16,907 rows carry a `lessor_name` pair, 16,492 usable, 1,176 in the
last 90 days, newest 2026-08-05.**

I got the same wrong answer first. `gsa_lease_events.changed_fields` is a jsonb **string** holding
JSON text (double-encoded), so `changed_fields ? 'lessor_name'` is **structurally unable to match**
and returns a confident **0 of 201,212**. The Python consumer parses it (`json.loads(cf) if
isinstance(cf, str)`) and never noticed. Correct probe: `(changed_fields #>> '{}')::jsonb ? 'key'`.

> Same family as the P157 `reloptions` and P182 deparse traps: a predicate that cannot express the
> question returns a plausible number. **A zero from a text/JSON detector needs a positive control
> before it becomes a finding** — and here the wrong zero had already been published.

---

## 9. ⚠️ What was NOT restarted, and why — with the blast radius measured

The `ownership_change` lead lane and the `gsa_lease_diff` ownership feed are **the same dead
producer**, `ingest_ownership.ingest_acquisitions`, which reads `gsa_lease_events` (fresh) and has
no scheduled caller. It is genuinely restartable — §8 proves its input carries the signal. **It was
not restarted here**, and that is a deliberate scope call, not an oversight:

1. **Blast radius, measured: 10,635 usable lessor-pair events have no `ownership_history` row**
   — and only **995** arrived since the lane died, so **9,640 are historical events the producer
   left behind even while it was running**. That is a large unattended first write.
2. **It cannot be dry-run from here.** The sandbox holds no Supabase credentials, so the Python
   producer cannot be exercised against the DB. Scheduling a 10,635-row write I could not rehearse
   would violate the rule that produced §5's finding.
3. **Its only gate is `is_same_owner`, a name heuristic** — not the A4b/oscillation/property-resolve
   chain §7 uses. Restarting it as-is feeds the ownership store the raw signal this prompt says must
   be deflated first (§3a).
4. **It is a different producer over a different source.** The change layer reads `gsa_snapshots`;
   this reads `gsa_lease_events`. One repair per change, or you cannot tell which moved the number.

**Its consumer is confirmed alive and reachable** (the §4 check): of 7,729 `ownership_change` leads,
**2,041 worked**, **208 pushed to Salesforce**, **2,149 touched in the last 30 days**. This is not a
lane nobody reads — which is exactly why it deserves a measured restart rather than a blind one.
Filed as **B6b-lead**. `prospect_leads_ownership_change` correctly **remains stale (150d) and its
alert correctly remains open.**

---

## 10. ⚠️ A registry defect that would have re-opened the alert on the first quiet month

`gsa_lease_timeline` was registered on **`created_at`** — but the rebuild UPSERTs, so `created_at`
only moves when a **new lease first appears**. A perfectly correct rebuild over a stable lease
roster would read STALE. It reads fresh today only because 308 genuinely new leases happened to
arrive with the four backfilled months. Corrected to **`updated_at`**, the column the rebuild always
touches.

> The accident that hid it is the point: a one-off event made a broken freshness key look healthy.

---

## 11. Verification — on the alert state, not the run log

- `gsa_lease_change_facts` **356,291 → 374,257**, max snapshot **2026-02-01 → 2026-07-01**.
- `gsa_lease_timeline` **16,471 → 16,779**, max **2025-12-01 → 2026-07-01**.
- Derivable backlog **5 → 0**; the tick re-run is a clean no-op (`snapshots_derived: 0`).
- gov `v_feed_freshness`: both feeds `age_days = 0`, `is_stale = false`.
- LCC: drove the real sync (`lcc_sync_feed_freshness('gov',1)` → `fired`;
  `lcc_finalize_feed_freshness` → `gov:200`, 18 feeds), then `lcc_check_feed_freshness` returned
  **`resolved: 2`**, stale 6 → 4. **Both alert rows now read
  `resolved_note = 'Auto-resolved: feed refreshed within SLA'`.**
- Full gov suite **921 passed, 1 skipped**.

**Reversal:** the tick only ever INSERTs facts for dates that had none, so
`delete from gsa_lease_change_facts where snapshot_date in ('2018-03-01','2026-03-01','2026-05-01',
'2026-06-01','2026-07-01');` then `select gov_rebuild_gsa_lease_timeline(false);` restores the prior
state exactly (the timeline is a full rebuild).

---

## 12. Named, not fixed

- **B6b-lead** — restart `ingest_ownership` (§9). 10,635-row blast radius; needs a dry run with
  credentials and a deflation gate before it feeds `ownership_history`.
- **⚠️ `2026-06-01` is a MERGED snapshot.** It holds **7,919 leases** against a 7,348–7,495 norm,
  because two different source files were both labelled June (7,495 on 2026-06-22, then 424 further
  leases from a 7,348-lease file on 2026-07-13). `_ingest_records` upserts on
  `(lease_number, snapshot_date)` and never REPLACES a date's row set, so two files under one label
  **accumulate**. No single GSA publication contained 7,919 leases. Its diff is derived faithfully
  from what we store, and the artifact lands almost entirely in `new`/`removed`
  (June `facts_new` 566, July `facts_removed` 603) — **`landlord_change_flag` requires both sides
  present, so the landlord signal is largely insulated** (June 53, July 27 raw). Filed as
  **B6b-june**.
- **2026-04-01 is missing from the raw feed entirely** — upstream, unchanged by this work.
- **`gsa_lease_timeline.is_active` is a hard-coded constant `true`** for every lease, faithfully
  ported from the Python. A column that never varies; stated, not changed.
- **The out-of-order priors in the existing 356k facts** (§3) are not rewritten. The spanning guard
  stops them growing; repairing history would mean re-deriving dates the store already covers.
