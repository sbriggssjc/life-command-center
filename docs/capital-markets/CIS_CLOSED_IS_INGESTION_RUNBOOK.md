# Recurring Salesforce Closed-IS (CIS) ingestion → `dia_nm_cis_closings`

The CIS national export is Northmarq's **own** closed Investment-Sales book. It is the
authoritative attribution layer that certifies `is_northmarq` on our dialysis/medical
sales in `v_dia_nm_attribution_audit`. This runbook wires it as a recurring feed.

## Flow

```
Scheduled SF report ("Closed IS", dialysis/medical, ALL owners)
   → Power Automate (scheduled "Get report/records" + HTTP POST)
   → POST /api/intake-sf-cis        (== /api/intake?_route=sf-cis)
   → UPSERT Dialysis_DB public.dia_nm_cis_closings  (idempotency key = SF record id)
   → dia_nm_cis_link()  links each closing to a property + sale, flags is_northmarq
   → v_dia_nm_closing_evidence (already UNIONs the table) → v_dia_nm_attribution_audit  ⇒ certified_nm
   → every batch writes an sf_sync_log row (sync_type='dia_nm_cis_ingest')
```

## Salesforce report

- **Report type:** Opportunities (Closed IS).
- **Filters:** `StageName = Closed IS`; property type in the dialysis / medical set;
  **owner = all** (not "My"); `CloseDate >= 2023-01-01` on the **first run** (full
  backfill), rolling window thereafter (a wider window is harmless — re-sends are
  idempotent on the SF record id).
- **Columns to surface (any casing / either name works — the mapper accepts SF
  managed-package field names and friendly names):**
  `Id` (→ `sf_record_id`, **required, the idempotency key**), property address,
  city, state, `CloseDate`, `Deal_Price__c`/price, listing broker, procuring broker,
  `Name`/deal name.

## Power Automate flow

1. **Recurrence** (e.g. daily 06:00 CT).
2. **Salesforce – Get report rows** (or list Opportunity records with the filters above).
3. **HTTP – POST** to `https://<railway-host>/api/intake-sf-cis`
   - Headers: `Content-Type: application/json`, `X-LCC-Key: <LCC_API_KEY>`,
     `X-LCC-Workspace: <workspace id>` (operator role required).
   - Body: `{ "import_batch": "cis_@{utcNow('yyyy-MM-dd')}", "records": [ <report rows> ] }`
     — a bare array is also accepted. Max 5000 rows/batch; page larger reports.

## Idempotency & backfill

- The UPSERT keys on `sf_record_id` (`uq_dia_nm_cis_sf_record_id`), so the first-run
  2023+ backfill and every subsequent re-send fold into the same rows — no duplicates.
- `mapCisRecord` value-gates each row: an `sf_record_id` **and** a sale date **and**
  (an address **or** a deal name) are required, else the row is skipped (never staged blank).

## Linking / certification

- `dia_nm_cis_link(p_dry_run, p_batch_tag)` (SQL) resolves each unlinked closing to
  **one unambiguous** property (normalized address + state), then **one unambiguous**
  live sale within ±150 days / ±$100k (the same tolerance the audit certifies on),
  fills `linked_property_id`/`linked_sale_id`, and flags the sale
  `is_northmarq = true, is_northmarq_source = 'cis_export'`.
- Fired in real time by the ingest (best-effort; disable with `CIS_LINK_REALTIME=false`)
  **and** nightly by cron `dia-nm-cis-link` (05:32, before `dia-nm-comp-promote` 05:40).
- Ambiguous / unmatched closings are **never guessed** — they surface in
  `v_dia_nm_cis_unlinked` with an `unlinked_reason`.

## Reversibility

- Ingest rows: `DELETE FROM dia_nm_cis_closings WHERE import_batch = :tag;`
- Link/flag writes: reverse by `dia_nm_cis_link_log` (`batch_tag`) — see the REVERSAL
  RUNBOOK at the foot of `supabase/migrations/dialysis/20260808_dia_nm_cis_closings_ingest.sql`.

## Files

- Migration: `supabase/migrations/dialysis/20260808_dia_nm_cis_closings_ingest.sql` (applied live to `zqzrriwuavgrquhisnoa`).
- Handler: `api/_handlers/sf-cis-ingest.js`; dispatch `api/intake.js` (`case 'sf-cis'`); mount `server.js` (`/api/intake-sf-cis`).
- Tests: `test/sf-cis-ingest.test.mjs`.
