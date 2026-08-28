# Data coherence invariants — every source must propel the whole system

**Created 2026-08-28** from Scott's standing requirement:

> *"We want to eliminate these exact types of code and/or logical gaps or misconnections that are
> happening in all our databases in the LCC in the future (current two and planned others) so that
> all data sources and ingestion is propelling the entire database forward, not just a bunch of
> different component parts or subdatabases or tables."*

> 📍 **This is the standing architectural contract. It applies to LCC Opps, Dialysis_DB, Government,
> and every domain database added later.** It is not an audit — audits are the evidence that
> produced it (`DEAD_END_AUDIT_PLAYBOOK.md`, B5, B6). **When you add a source, a table, a trigger,
> or a whole database, this is the checklist.**

---

## 0. The failure this exists to prevent

Every defect below was **live in production**, found in one 48-hour window, and **not one of them
raised an error, a zero row, or an alert.** They are all the same shape: *a component works
correctly in isolation while the system does not advance.*

| defect | measured | why nothing caught it |
|---|---|---|
| gov never consumed its own `sales_transactions` as ownership history | **9,514 named sellers, 1.8% consumed**; the fix wrote **2,776 rows / 2,000 properties, 677 with no prior history at all** | **a missing feeder has no representation anywhere** — no error, no zero row, no queue |
| `property_sale_events` link columns are `bigint` against `uuid` PKs | **5,208 rows, both link columns populated on ZERO** | a writer raises `22P02`; nobody wrote one, so nobody saw it. dia's twin has a compatible PK and 52 populated rows |
| four ingestion producers dead since March–April 2026 | health view **all green** | **a FAILED step is a red row; a SKIPPED step is NO row**, and the view is built on emitted rows |
| `parcel_owner_xref` corroboration engine | **561 divergences**, cron running every 30 min | the producer works; **nothing consumes its disagreements** |
| `gsa_lease_diff` — the ownership store's largest source | **unregistered** on `field_source_priority` | the ladder is consulted per write; an absent rung reads as "no answer", not as an error |
| `propagate_ownership_to_property` trigger | nulled `properties.recorded_owner_id` on any text-party insert; **7,567 rows already in that shape**, would have destroyed **1,446 of 9,312** | `AFTER INSERT`, no ledger, silent, unrecoverable |

**The pattern:** each table, cron and view was individually correct. **The system did not move
because the CONNECTIONS between them were never asserted anywhere.**

---

## 1. The invariants

**Every one of these is a property of a CONNECTION, not of a component.** That is why component
tests, boot checks and health views all pass while the invariant is violated.

### I1 — Every producer names its consumer, and every consumer names its producer

A source with no consumer is a **finding, not a state** (`DEAD_END_AUDIT_PLAYBOOK.md` Class 2). A
consumer wired to a producer that does not exist fails **exactly like a consumer bug** (P137).

> **On adding a producer:** name the consumer in the migration/handler header. If you cannot name
> one, **do not build the producer.**
> **On adding a consumer:** verify the producer WRITES the field you read — by name, not by concept.
> C1: a lane's predicate read `unified_contacts.sf_account_id` while its only writer wrote
> `recorded_owners.sf_account_id`. **1,961 owners already linked, 29 agreeing, and nothing errored.**

### I2 — A fact store's producer set must be the SAME SHAPE in every domain

**This is the Class 20 detector and it is the highest-yield query in this document.** Group the
store by its provenance column, split by domain. **A source bucket present for one domain and
absent for another IS the finding** — no hypothesis required.

```sql
select source_domain, split_part(coalesce(<provenance_col>,'(null)'),':',1) as src_bucket,
       count(*) , count(distinct <subject_col>)
from <fact_store> group by 1,2 order by 1, 3 desc;
```

**A difference is not automatically a defect** — a domain may legitimately lack a source (dia has no
GSA lease inventory; gov's tenant is a federal agency so it has no operator-vs-owner conflation).
**But it must be an explained difference, not an unnoticed one.**

### I3 — A cross-store link column must be type-compatible with its target and carry an FK

`property_sale_events.ownership_history_id` is `bigint`; `ownership_history`'s PK is `uuid`. **The
column cannot hold the value it is named for.** With no FK, nothing declares the intent, and the
defect is invisible until someone writes.

> **Rule:** a column named `<table>_id` must be the type of `<table>`'s PK and carry an FK, or carry
> a comment stating why not. **A nullable FK is cheap; a type mismatch is unpayable.**

### I4 — A producer emits a run row even when it does nothing, and ESPECIALLY when it SKIPS

**Playbook Class 21.** `pipeline_runner` guards the GSA diff on a local folder that is always empty
on CI: the guard logs *"Task completed"*, the guarded task is never invoked, writes no `run_log`
row, and therefore **has no row in `v_pipeline_task_health`** — which is built on emitted rows.
**Four producers died for five months behind an all-green view.**

> **A failed step is a red row. A skipped step is no row. A health view over emitted rows cannot
> tell "skipped" from "never scheduled" from "healthy and quiet."**
> **Rule:** open the run row **before** the work (P123), close it after, and record a SKIP with its
> reason as a first-class outcome. Health must be computed against **expected** runs, not observed.

✅ **CLOSED 2026-08-28 (B6a)** — `docs/audits/B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md`.
Four corrections to the statement above, each of which changed the fix:

- **⚠️ "No row" was only half the mechanism, and the worse half is a STALE GREEN ROW.**
  `gsa_ingest_+_diff` was **not absent** from `v_pipeline_task_health` — it carried
  `status='ok'`, *"Task completed"*, **67 days stale**, on a step whose own history says it ran
  every 7 days, because `status` read the last outcome's `event_type` and nothing compared it to
  when that outcome should have been superseded. **The recommended fix — "enumerate declared
  steps, not logged ones" — would not have caught it**, because it was never missing. The missing
  dimension is **cadence**, not enumeration.
- **The fix is at the EMISSION POINT, and that dissolves the enumeration problem.** Once both
  branches of every guard write (`record_skip` / `run_guarded_task`), the **logged set IS the
  declared set** — so no step registry was needed, and a fourth registry was not built beside
  `feed_freshness_registry`, `data_freshness_monitor.SOURCES` and this view.
- **⚠️ A PRODUCER IS NOT A TABLE.** R56's `feed_freshness_registry` already implements this
  invariant end to end — SLA, cross-DB mirror, deduped auto-resolving alert — and read healthy
  over the four dead producers **because nobody registered them**. Registering `prospect_leads`
  plainly would still have been GREEN: the table is fresh (other lead sources are live) while its
  `ownership_change` lane died 2026-03-31. A table-keyed freshness row is fresh whenever **any**
  of its producers writes. Fixed with a structured `filter_column`/`filter_value` (`%I`/`%L`,
  never free SQL — the function is `SECURITY DEFINER`) and a both-or-neither CHECK.
- **A legitimate skip must be DECLARABLE, and the declaration must have no default.** A skip
  somebody chose is healthy and must be visible without alerting; an undeclared skip is the
  finding. Read **`tasks_skipped_undeclared`**, never `tasks_skipped` (which previously counted
  dry runs).

⚠️ **And the instrument one level up is still blind.** The cross-DB monitor has evaluated **no
gov or dia feed since 2026-07-26**: the mirror is stale, `lcc_finalize_feed_freshness` drops any
non-200 response silently and returns `(0,0)`, and `lcc_check_feed_freshness` excludes mirror
rows older than 3 days — so **when the sync stops, the check stops checking and reports nothing
wrong.** gov reads a stale feed today with no open `feed_stale` alert. **B6a-follow-up**, named
and sized, deliberately not fixed inside a gov instrument change.

### I5 — Every source is registered on the authority ladder before it writes

`field_source_priority` is the single place that answers *"if two sources disagree, who wins."*
`v_field_provenance_unranked` is the drift detector and **should return 0 rows**.
⚠️ It currently returns **33** — pre-existing drift, and `gsa_lease_diff` is not the only large
source missing a rung.

### I6 — A corroboration signal must have a consumer for its DISAGREEMENTS

A source that agrees adds confidence; **a source that disagrees is the finding**, and it needs a
review lane. `parcel_owner_xref` produces **561 divergences every 30 minutes** into nothing.

> **Rule:** contradictions go to a review lane, **never to a silent winner**. And note two sources
> can BOTH be right about different questions — a GSA lessor-of-record change is *who the government
> pays*, a recorded deed is *who holds title*, and in a ground lease **both are true at once**
> (Scott, on Sunflower). **Do not collapse a semantic difference into a precedence rule.**

### I7 — A change signal reaches EVERY store it belongs in

An owner/lessee change is simultaneously **transaction history (comps)** and **ownership history**.
Reaching one is not reaching both. B6 swept 19 signals against this invariant.

### I8 — A trigger that propagates must guard the absence of what it propagates

`propagate_ownership_to_property` wrote `NEW.recorded_owner_id` unconditionally, so any row naming
its parties as *text* — which is how `gsa_lease_diff`, `deed_extraction` and B5 all write —
**overwrote a real owner with NULL.**

> **Rule:** an `AFTER INSERT/UPDATE` propagation must be **fill-forward** — never write NULL over a
> populated field — and must be positive-controlled **in both directions** (it preserves when the
> source is null; it propagates when the source is set).

### I9 — Provenance must be recoverable, and `updated_at` is not provenance

`lcc_entity_portfolio_facts` has **no creation timestamp**, and the nightly re-upsert touches
**11,828 of 14,076 rows daily** — so **every source reads "written today."** This cost a wrong
conclusion in this very arc.

> **Rule:** a fact store carries `created_at` **and** a provenance column. Never date a producer off
> `updated_at` on an upserted table; find the producer in code.

### I10 — A one-shot backfill is not a producer

If the mechanism that filled a store was a migration or a script, the store **decays from the moment
it lands** (Class 8). dia's seller-exit backfill was a one-shot plus a standing sidebar writer —
which is *fine*, and had to be checked rather than assumed.

---

## 2. Onboarding a NEW domain database

Scott's requirement explicitly covers **planned future databases**. A new domain is not "another
Supabase project"; it is a new set of connections that must be asserted on day one.

1. **Declare its `source_domain` short code** and add it to the canonical set (`dia`/`gov`/`lcc`/
   `cre`). ⚠️ **The alias class has recurred many times** — canonicalize on the way in.
2. **Run I2 against every shared fact store** and produce the producer-set diff *before* go-live.
   **Any bucket the new domain lacks is either wired or explained in writing.**
3. **Register every source on `field_source_priority`** (I5) and confirm
   `v_field_provenance_unranked` does not grow.
4. **Register every scheduled producer with an EXPECTED cadence** so I4's health check can see a
   silence.
5. **Add its anon-readable portfolio views** with `security_invoker=off` ⚠️ (P157: `on` returns
   **HTTP 200 `[]`** to anon and looks exactly like "no new data" — it froze a sync for 23 days).
6. **Type-check every cross-store link column against its target PK** (I3).
7. **Add it to this document's coverage table below.**

---

## 3. Standing detectors — the ones that exist, and the ones that do not

| invariant | detector | status |
|---|---|---|
| I5 | `v_field_provenance_unranked` | ✅ exists · ⚠️ **33 rows** (drift) |
| I2 | provenance `group by` split by domain | ⚠️ **manual** — run in B5/B6; **no standing view** |
| I3 | link-column type check against target PK | ❌ **none** |
| I4 | expected-vs-observed run health | ✅ **B6a, 2026-08-28** — skips emit; `is_overdue` vs the step's own p90 cadence; the four dead producers registered and RED. ⚠️ The **cross-DB mirror** that carries this to an alert has been silent since 2026-07-26 (**B6a-follow-up**) |
| I6 | divergence consumer | ⚠️ `parcel_owner_xref.diverges` has none → **B6d** |
| I1 | producer/consumer registry | ❌ **none** — this is the biggest hole |
| I8 | fill-forward trigger audit | ❌ **none** — one instance fixed (B5), others unaudited |
| I9 | fact stores lacking `created_at` | ❌ **none** |

**The honest state: two of ten invariants have a standing detector.** Everything else was found by
a human asking the right question, which does not scale and is exactly what Scott is asking us to
stop relying on. **Backlog `D1–D4` turns the highest-yield ones into scheduled checks.**

---

## 4. Coverage today

| database | ref | swept against these invariants |
|---|---|---|
| LCC Opps | `xengecqvemvfknjvbvrq` | I2 (ownership facts), I5 (partial) |
| Government | `scknotsqkcheojiaewwh` | I1–I8 via B6 (19 signals) |
| Dialysis_DB | `zqzrriwuavgrquhisnoa` | I2, I10 (partial — B6g reports two blind spots, unfixed) |

---

## 5. Related

- `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` — **Class 20** (unwired sibling source), **Class 21**
  (skipped step emits nothing), plus 19 other detectors.
- `docs/audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md` — the 19-signal sweep.
  ⛔ **Its §6 is superseded** — do not act on its resizing of B5.
- `docs/audits/B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md` — the feeder and the trigger bug.
- `docs/architecture/connectivity-and-open-threads.md` §4j — the route-level view.
- `CLAUDE.md` — *"we must acquire the data is the most expensive conclusion available."*
