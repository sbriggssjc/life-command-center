# RECON2-d — `holdover_confirmed` → `occupied_term_unknown` rename (2026-09-18)

## Why

`holdover_confirmed` asserted more than was known. The only evidence on file for every row this
state was ever used on is: CoStar shows the lease active with NO expiration date recorded, plus an
independent occupancy signal. There is no evidence of month-to-month tenancy and no evidence of a
renewal. Scott's instruction was to redefine the state so it states exactly what is known and never
invent a date. `occupied_term_unknown` is that redefinition.

## Per-lease, before → after (live, Dialysis_DB `zqzrriwuavgrquhisnoa`)

| lease_id | property | old `expiration_state` | new `expiration_state` | `is_active` before | `is_active` after |
|---|---|---|---|---|---|
| 23259 | 27677 — 2609 Hospital Rd, Goldsboro, NC (tenant: DaVita Kidney Care) | `holdover_confirmed` | `occupied_term_unknown` | true | true |
| 12678 | 25464 — 1131 N Galena Ave, Dixon, IL (tenant: Davita) | `holdover_confirmed` | `occupied_term_unknown` | true | true |
| 13058 | 28547 — 920 South Washington Ave, Scranton, PA (tenant: Davita Commonwealth Dialysis) | `holdover_confirmed` | `occupied_term_unknown` | true | true |

Verified live after the migration:

```sql
select lease_id, expiration_state, is_active, lease_expiration_source_state
from leases where lease_id in (23259,12678,13058);
-- 12678 | occupied_term_unknown | true | null
-- 13058 | occupied_term_unknown | true | null
-- 23259 | occupied_term_unknown | true | null

select count(*) from leases where expiration_state='holdover_confirmed';
-- 0
```

`is_active` was never referenced by the migration and did not change on any row. A rename-audit
entry was appended to each row's `expiration_evidence` array (never rewriting the prior entries)
recording why the state changed, with no new date invented.

## The classifier defect found while verifying the rename

Re-running `dia_recon2_classify_expired_leases(null)` against the 3 freshly-confirmed rows, BEFORE
the classifier fix, proposed:

| lease_id | proposed_state | evidence_type | evidence_detail | conflict |
|---|---|---|---|---|
| 23259 | `expired_confirmed` | `successor_lease` | `successor lease_id=9519` | `false` |
| 13058 | `expired_confirmed` | `termination_record` | `status=Terminated` | `false` |
| 12678 | `expired_confirmed` | `termination_record` | `status=Terminated` | `false` |

This is real and traceable to the leases' own rows: `leases.status` is literally `'Terminated'` on
12678 and 13058, and 23259 has a same-property successor lease (`lease_id=9519`, `lease_start`
2012-05-31 ≥ `lease_expiration` 2012-05-31). None of that is wrong data — it is an OLDER structural
signal that the fresher, human-recorded field evidence (operator locator / Google hours / CoStar
active-lease sighting, all dated 2026-09-18) supersedes. The classifier's own `conflict` detector
(`dia_recon2_evidence_array_conflicts`) did not catch it, because that function only scans the
`observed` key of each evidence entry for textual active-vs-closed contradictions — it never
compares the row's OWN structural signal against its already-confirmed `expiration_state`.

Left unfixed, a future sweep that classifies and then acts on `proposed_state='expired_confirmed'`
would have silently reverted a human confirmation (and flipped `is_active` to `false`) with no
conflict flag to stop it. Nothing in this repo currently auto-applies classifier output — there is
no such sweep function today — so this was not yet an active data-loss bug, but it is the exact
shape of one.

## Classifier fix (shipped in the same migration)

`dia_recon2_classify_expired_leases()` candidate CTE now excludes
`expiration_state IN ('occupied_term_unknown', 'renewed_confirmed')` — a lease a human has already
confirmed is never re-litigated by the same structural signals that made it a candidate in the
first place. Separately, a clinic CMS-confirmed operating **at the same property** with no
closure/termination/successor signal now proposes `occupied_term_unknown` (real positive evidence
of continued occupancy) instead of the generic `expired_unconfirmed`, and the `conflict` flag now
fires when that same signal coexists with a termination/closure/successor signal on the row.

## Full population histogram, before → after (live)

Population = `is_active = true AND lease_expiration IS NOT NULL AND lease_expiration < current_date`
(the classifier's own candidate filter, before the RECON2-d exclusion):

| `expiration_state` | count |
|---|---:|
| `expired_unconfirmed` | 2,447 |
| `holdover_confirmed` (→ `occupied_term_unknown`) | 3 |
| **total** | **2,450** |

`dia_recon2_classify_expired_leases(null)` output, BEFORE the classifier fix (same 2,450 rows,
`holdover_confirmed` rows still included as candidates since `is_active` stayed true for them):

| `proposed_state` | count |
|---|---:|
| `expired_unconfirmed` | 2,447 |
| `expired_confirmed` | 3 (the 3 leases above — the defect) |

`dia_recon2_classify_expired_leases(null)` output, AFTER the classifier fix (2,450 − 3 = 2,447
candidates remain, since the 3 confirmed rows are now excluded):

| `proposed_state` | count |
|---|---:|
| `expired_unconfirmed` | 1,246 |
| `occupied_term_unknown` | 1,201 |
| **total** | **2,447** |

`occupied_term_unknown` appearing at this size (1,201 of 2,447) is the second behaviour change:
before the fix, EVERY one of these rows fell to the generic `expired_unconfirmed` bucket with no
positive signal recorded, even when a clinic is CMS-confirmed operating at that same property. They
now carry the specific, evidence-backed proposal. **This is a proposal only — the classifier never
writes.** No row's stored `expiration_state` changed as a result of this population; a human
confirming a `occupied_term_unknown` proposal still goes through
`dia_recon2_confirm_lease_expired()`, which still requires stated evidence.

`select count(*) from dia_recon2_classify_expired_leases(null) where lease_id in (23259,12678,13058)`
→ **0** (confirmed leases no longer appear as candidates at all).

## Blind-clinic count (`medicare_clinics.chain_organization IS NULL`, operating, non-duplicate rows)

```sql
select count(*) from medicare_clinics
where chain_organization is null
  and coalesce(is_operating, true) is true
  and coalesce(dedup_status,'') is distinct from 'demoted_duplicate';
```

Before this round: **978**. After filling property 35849's live row: **977**.

Top 10 states by count (measured, before the 35849 fill — the fill moves AZ down by exactly 1):

| state | count |
|---|---:|
| CA | 319 |
| AL | 179 |
| AZ | 124 (→ 123 after the 35849 fill) |
| CO | 83 |
| AR | 69 |
| CT | 48 |
| DE | 32 |
| DC | 19 |
| TX | 17 |
| FL | 17 |

## Property/clinic 35849 — "35849's class"

`medicare_clinics` carries TWO rows for `property_id=35849` (629 N Highway 90 Byp, Ste 6, Sierra
Vista, AZ) — a leading-zero CCN duplicate:

| medicare_id | dedup_status | is_operating | chain_organization | operator_id |
|---|---|---|---|---|
| `32520` | `demoted_duplicate` | false | `DaVita` | 4 |
| `032520` | (none) | true | (was NULL) → `DaVita` | (was NULL) → 4 |

Two independent, sourced signals agree: the demoted-duplicate sibling's own `chain_organization`,
and the property's own active lease (`lease_id=18592`, `tenant='DaVita Kidney Care'`,
`is_active=true`). Filled `chain_organization='DaVita'` / `operator_id=4` on the LIVE row
(`medicare_id='032520'`) only — fill-blanks, single row, sourced, reversible via
`dia_recon1_run_log` (`step='chain_organization_fill'`).

**No bulk write was performed on the other 977 blind clinics.** They are reported here as a
backlog item (`RECON2-d-blind-clinics`): each needs its own sourced signal (a lease tenant, an
operator-locator hit, an unambiguous sibling CCN row) before it can be filled the same way.

## Follow-up review rows

The 3 renamed leases still have one genuinely open question each — the actual current lease
term, since CoStar landed no date. Mirroring RECON2-b's existing shape
(`table_name='leases'`, `entity='lease:<id>'`, `status='open'`), 3 `pending_updates` rows were
inserted with `field_name='lease_expiration'` (the RECON2-b enqueuer keys on
`field_name='expiration_state'`, which is now resolved for these rows — the open ask here is the
date, not the state) and `file_name='recon2d_costar_date_followup'`.

## Guards / tests

`tests/test_recon2d_occupied_term_unknown.py` — connects to the live DB via
`src.db_env.get_supabase_db_dsn()` + `psycopg`, `pytest.mark.skipif` when either is unavailable
(neither is available in the CI sandbox used to build this round — no `psycopg` package, no
`SUPABASE_DB_DSN` env var, consistent with this repo's documented "no CMS egress from the sandbox").
Every mutating assertion runs inside a `SAVEPOINT` that is rolled back, and the outer connection is
never committed, mirroring the "self-rolling-back synthetic gate" pattern used throughout this
repo's migrations. All behaviour asserted by the tests was independently verified live via the
Supabase MCP tools during this round (see the query outputs quoted above), because that is the
channel this sandbox actually has to the live Dialysis_DB project.

## Parked, not done here

- **gov-side mirror.** `government-lease` owns its own DB and its own lease-expiration
  reconciliation (if any) — not touched. A parallel `holdover_confirmed`-shaped state there, if one
  exists, needs its own audit in that repo.
- **The remaining 977 blind clinics** (`chain_organization IS NULL`) — sized and left as a backlog
  item; no bulk write, per instruction.
- **The render string** ("Occupied — lease term not on file (expired &lt;date&gt;)") is specified
  here but not wired — that is an LCC-side (life-command-center) change, out of scope for this repo.
