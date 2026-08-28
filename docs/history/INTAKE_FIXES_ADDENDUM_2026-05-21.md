# Intake Pipeline — Fixes Addendum (2026-05-21)

**Companion to:** `DQ7_ROOT_CAUSE_AND_CODE_FIX_2026-05-21.md`
**Status:** diagnoses + recommended fixes. Code changes are NOT applied — they touch the live intake path and your repo requires `pytest`/CI green before merge. Apply on a branch.

Three distinct intake problems were root-caused this session: (1) the LCC app/intake slowness, (2) a status-value constraint bug that strands intakes and floods the logs, and (3) the OM extractor pinning subject properties to the firm's own office address (the 6120 S Yale Ave case).

---

## 1. LCC app/intake slowness — connection exhaustion on LCC Opps

**Root cause (confirmed, then resolved by a DB restart):** LCC Opps (`xengecqvemvfknjvbvrq`) ran out of database connections (`max_connections=60`). Symptoms while saturated: direct admin connections and the performance advisor both timed out; the `daily-briefing` edge function flipped from 200 / ~1s to **401 after a flat ~10s** on every call (waiting for a DB connection, timing out, failing its auth lookup). dia/gov were unaffected, isolating it to LCC Opps. After the restart, `pg_stat_activity` shows ~32/60 connections, all idle, no long-running queries — healthy.

**Recurrence prevention (do these so it doesn't come back):**
- **Use the pooler.** The postgres logs showed a continuous stream of fresh `postgrest` connections (churn). Point the app + edge functions at Supavisor/PgBouncer **transaction mode** (port 6543), not direct connections (5432), so per-request churn can't exhaust the 60-slot ceiling.
- **Fix the status bug in §2.** Failed status transitions leave intakes stranded and generate retry/error churn against the DB.
- **Watchpoint query** (run if it slows again):
  ```sql
  SELECT application_name, state, count(*), max(now()-query_start) AS longest
  FROM pg_stat_activity WHERE datname=current_database()
  GROUP BY 1,2 ORDER BY 3 DESC;
  ```
- Consider raising `max_connections` / compute tier if broker concurrency keeps growing.

---

## 2. `staged_intake_items_status_check` violations — status-value mismatches

**Symptom:** recurring postgres error `new row for relation "staged_intake_items" violates check constraint "staged_intake_items_status_check"`. Intakes that hit these paths fail to transition status, so they linger in the inbox / get re-touched.

**Constraint allows ONLY:** `queued, processing, review_required, failed, finalized, discarded, matched, no_match`.

**Bug 2a — matcher writes a non-existent status.**
`api/_handlers/intake-matcher.js:466`
```js
{ status: match.status === 'matched' ? 'matched' : 'review_needed' }   // 'review_needed' is INVALID
```
The constant should be **`'review_required'`** (what the rest of the system + the constraint use; there are 2,677 correctly-written `review_required` rows from other paths). Every non-match the matcher processes throws this constraint error and leaves the row's status unchanged.
**Fix:** `'review_needed'` → `'review_required'`.

**Bug 2b — promote flow writes a non-existent status.**
`api/intake.js:1628`
```js
{ status: 'promoted', updated_at: ... }   // 'promoted' is NOT in the allowed set
```
**Fix:** use `'finalized'` (the intended terminal state) — OR, if "promoted" is semantically needed, extend the constraint:
```sql
ALTER TABLE public.staged_intake_items DROP CONSTRAINT staged_intake_items_status_check;
ALTER TABLE public.staged_intake_items ADD CONSTRAINT staged_intake_items_status_check
  CHECK (status = ANY (ARRAY['queued','processing','review_required','failed',
    'finalized','discarded','matched','no_match','promoted']));
```
Recommend reusing `'finalized'` rather than adding a value, to keep the state machine small. (The discard path at `intake.js:1790` already correctly uses `'discarded'`.)

**Verify** `api/_handlers/intake-feedback.js::updateIntakeStatus` (~line 199-216) maps every decision to one of the allowed values too.

**Test:** unit-test the matcher non-match path and the promote path assert the PATCH returns ok and the row lands in an allowed status; add a guard test that any status written to `staged_intake_items` is in the constraint set.

---

## 3. OM extractor pins subject properties to the firm's own office address (the 6120 S Yale Ave case)

**What happened:** 11 dia property rows (+15 leases, +3 *real active listings* brokered by Scott Briggs / Ben Brigham) were created at `6120 S Yale Ave Ste 300, Tulsa OK` — the Briggs/Northmarq office — via `email_intake`. The OM/flyer extractor returned the **contact-block address** as the subject property address.

**Root cause:** `api/_handlers/intake-extractor.js` prompt (line ~318-329) asks the model for `"address"` with no instruction to distinguish the **subject property** from the **broker/marketing contact block**, and nothing downstream validates the extracted address against the firm's own address.

**Recommended guard (defense in depth):**

1. **Prompt fix** (`intake-extractor.js` ~line 318): add an explicit instruction —
   > `"address"` must be the SUBJECT PROPERTY's street address. Do NOT return the listing broker's, marketing firm's, or contact block's address (often in the header/footer/"For more information contact" section). If only a contact address is present and no subject address, return null.

2. **Code-level denylist guard** (defense in depth, runs regardless of model behavior). Add a shared helper and call it where the extracted address is consumed (`intake-extractor.js` mergedSnapshot, the promoter, and `sidebar-pipeline.js::upsertDomainProperty` which already has `isJunkAddress()` — extend it):
   ```js
   // _shared/own-firm-addresses.js
   const OWN_FIRM_ADDRESSES = [
     '6120 s yale ave ste 300',   // Briggs/Northmarq office, Tulsa OK 74136
     // add other office / signature addresses here
   ];
   function isOwnFirmAddress(addr) {
     if (!addr) return false;
     const n = addr.toLowerCase().replace(/[^a-z0-9]/g,'');
     return OWN_FIRM_ADDRESSES.some(a => n.includes(a.replace(/[^a-z0-9]/g,'')));
   }
   ```
   In `upsertDomainProperty`, reject like the existing junk-address guard:
   ```js
   if (isOwnFirmAddress(address)) {
     _lastDomainPropertyError = `own_firm_address_rejected:${address}`;
     return null;   // don't create a property at our own office
   }
   ```
3. **Heuristic guard:** if the extracted property `address` equals the listing broker's contact address on the same document, treat the property address as unknown (null) and route to review rather than creating a mis-located property.

**Already done on the data side (reversible):** the 11 properties + 3 listings are flagged `WRONG-ADDRESS` (notes), kept live, and recorded in `dia.dq7_office_misaddress_queue` (29 rows). When the true subject addresses are known, fill `corrected_address` there and re-point. Gov already had 8 such rows quarantined (`junk_no_data`).

---

## Priority

1. **§1 pooler** + **§2a `review_needed`→`review_required`** — these stop the recurring failures and the connection pressure. Smallest changes, biggest stability win.
2. **§2b promote status** — one-line fix.
3. **§3 office-address guard** — prevents new mis-located properties; the DQ-7 sidebar guard (separate handoff) and this share the same `isJunkAddress`/address-validation seam.

*No code applied. Data-side flags are reversible (clear the notes / drop the tracking + queue tables).*
