# Ownership & Sales Remediation — 2026-05-27 Session Status (B3 investigation: deed-relink-tick)

Picks up after C5 Phase 2 final (merged). A9 (the chosen item) was **blocked** mid-session by LCC Opps connection timeouts (see below), so per a pivot decision we investigated **B3 — deed-relink-tick** instead, since its logic runs against dia/gov (responsive).

## Outcome: B3 closed as **not feasible as an auto-relink cron** — already covered

The original B3 spec — "hourly cron that re-links deed_records / parcel_records rows with `property_id IS NULL` but a non-null situs/APN" — does not match the actual schema or data on either domain. A deterministic relink is impossible, and the symptom B3 targeted is already handled by at-insert linking + existing health-view monitoring. **No code was shipped; this is a documented decision to prevent a future round re-attempting it.**

### Why the spec doesn't hold

**Schema reality:**
- `dia.deed_records`: links via `property_id`; has **no** address/APN/situs column. Linking historically came from the `property_public_records` (ppr) join table (A4a backfilled 364 rows from it).
- `dia.parcel_records`: has **no `property_id` column at all** — not linkable to properties by FK.
- `gov.deed_records`: has **no `property_id`** — uses `parcel_id` (UUID FK to parcel_records). The writer (`upsertGovernmentDeedRecords`) captures deeds from the CoStar sales tab keyed only by `document_number` and **never sets `parcel_id`**.
- `gov.parcel_records`: has `apn`/`situs_address` but **no `property_id`**.

**The only deterministic, safe relink** is the A4a operation: copy an *already-established* ppr link into a deed's own FK column (pure denormalization-sync, zero fuzzy matching). Its applicability:

| Domain | Orphans | Deterministic relink possible? | Why |
|---|---|---|---|
| dia | 3 (`property_id IS NULL`) | **No** | `property_public_records` has **0** deed links; `deed-parser` sets `property_id` at insert → recoverable-orphan source is dead. `deed_column_backfill_pending = 0` permanently. |
| gov | 93 (`parcel_id IS NULL`) | **No** | `deed_records` has no `property_id` column to sync; ppr links deeds→`property_id`, which can't supply `parcel_id` (no stored property↔parcel map). |

**The 93 gov parcel-orphans, characterized:**
- 26 have a ppr→property link (tied to a property, but `parcel_id` still underivable)
- 67 fully unlinked — no property, no parcel, and their `raw_payload` carries **no** APN / parcel_number / situs address (only transaction-party data: buyer/seller, document_number, party mailing addresses)

`gov.sales_transactions` has `property_id` but **no `document_number`**, so there's no key to bridge deed→sale either.

**Conclusion:** the only way to relink the residual orphans is fuzzy matching on party names / mailing addresses — which would create false links (a buyer's mailing address ≠ the subject property). That is precisely the bad-data pattern this entire remediation has been eliminating (the EXCLUDE constraint, the ingest contract, the federal-anti-pattern guard). So auto-relinking is not just infeasible — it would be actively harmful.

### Why the symptom is already covered

- **New writes link at insert.** `deed-parser.js` sets `property_id` for dia deeds at write time; no new recoverable orphans are created.
- **Orphan counts are already monitored.** Both `dia` and `gov` have `v_data_health_ownership`, which tracks `deed_orphans` and (dia) `deed_column_backfill_pending`. The "deed_records orphans" symptom was the A4 track's job and is marked FIXED; B3 was only the optional future-proofing cron, and the at-insert linking already provides that.

### What would actually move the needle (deferred, not B3)

The residual 96 orphans (3 dia + 93 gov) are a tiny, genuinely-unmatchable tail. If the team ever wants to resolve them, it requires **human research** (look up each document_number in the county recorder, associate the parcel manually) — not an automated cron. A row-level review view could surface them, but with no resolution key and orphan counts already visible in `v_data_health_ownership`, the ROI is low. Not built.

## LCC Opps connectivity note (the reason A9 was deferred)

Mid-session, `execute_sql` against **LCC Opps** (`xengecqvemvfknjvbvrq`, us-east-1) began timing out at the connection level (`Connection terminated due to connection timeout`) on every attempt — including `SELECT 1` — while `gov` (us-west-2) and `dia` (us-west-1) responded instantly in the same session, and audit-log writes to LCC Opps had **succeeded earlier this same session** (entries 40–42).

Diagnosis via the management API (which doesn't use a DB connection):
- `get_project` → `ACTIVE_HEALTHY`
- postgres logs → DB is **alive and busy**: pg_cron jobs firing (artifact-offload, geocode-tick, cron-health, refresh_work_counts), PostgREST authorizing a high volume of connections every second, checkpoints running. **No** disk-full / read-only / FATAL / PANIC entries.

So this is **not** a recurrence of the 2026-05-29 disk-full outage (the app/auth path via the pooler is fine). It's a **direct-connection availability** issue: PostgREST connection churn + several crons firing on the minute boundary are saturating direct-connection slots, so the MCP's direct session can't get in. Intermittent — it worked earlier and should recover.

**Implication for A9:** A9 requires reliable schema + ~29k-row writes *into* LCC Opps. Attempting that multi-step migration through an intermittently-timing-out connection risks a half-applied state. A9 should resume once LCC Opps direct connections are reliable again (re-verify with a `SELECT 1` first).

## A9 pre-investigation (gathered before the block)

Useful for when A9 resumes:
- **gov** `unified_contacts`: exists, **29,481 rows** (plan note "~13,111 wired" likely referred to the source-linked subset, not the total)
- **dia** `unified_contacts`: **does not exist**
- **LCC Opps** `unified_contacts`: unknown — could not query (connection timeouts). First A9 step on resume: confirm whether the canonical table already exists on LCC Opps and its schema.

## Plan status (unchanged by this investigation)

- ✅ **DONE** (28): F1-F4, C1, C2, C3 (N/A), C5, C4, C6, C8, B8, B6, B1, B2, B4, B5, B7, A1, A2, A3, A4, A5, A6, A7
- ⏳ **PARTIAL** (1): C9 (writer sweep complete; optional commit_* orchestrators remain)
- ⬜ **TODO** (3, ↓1): C7, A8, A9 — **B3 closed as N/A** (covered by at-insert linking + `v_data_health_ownership`; auto-relink infeasible)

## Files changed

| File | Change |
|---|---|
| `docs/ownership_sales_remediation/2026-05-27_b3_investigation_session_status.md` | NEW — this investigation + decision |

No schema/code changes. No audit_run_log entry (nothing was modified).

## Recommended next steps

1. **A9 — unified_contacts consolidation** once LCC Opps direct connections recover (re-verify connectivity first; A9 pre-investigation above gives a head start)
2. **A8 — CoStar Contacts harvest** feasibility (dia/gov reads; unaffected by the LCC Opps issue)
3. **C7 — SOS adapter framework** (lower priority per the free-SOS-direct preference)
