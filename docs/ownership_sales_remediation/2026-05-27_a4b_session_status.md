# Ownership & Sales Remediation — 2026-05-27 Session Status (A4b)

Picks up after PR #952 (C8 RCM/LoopNet PA flow specs, merged + deployed). Focus this round: **A4b — deed-records orphans research + cleanup**.

## What the investigation found

The orphan-count framing (232 dia + 88 gov) was correct on the dia side at a surface level — but the **dia cohort was almost entirely synthetic test data**, and dia had a **second, larger cohort of synthetic non-orphans** (rows with `property_id` populated but every other signal screaming "fake"). The gov cohort was different: real CoStar Sale History captures that just landed without `parcel_id` (by design per the writer's own code comment).

### dia clusters

| Cluster | Rows | Signature | Action |
|---|---:|---|---|
| **Synthetic orphan batch** | 228 | Recorded 2026-05-20 / -21 / -22 / -23 at 07:00 UTC, 16-hex-char `data_hash`, "ABC Realty"/"XYZ Dialysis"/"John Doe" grantor-grantee, only 4 distinct recording_dates across 34 states, "Ridgeville Business Park"-shaped fabricated legal descriptions | **Deleted** |
| **Synthetic non-orphan batch** | 364 | Recorded 2026-03-31 within ~15 min, same 16-hex-char hash pattern, but with `property_id` populated. Every other field is empty/NULL. Same `data_hash="cde830ca5e639690"` reused across 3 properties in GA/TX/IN. Linked via `property_public_records` rows with empty notes + confidence=1.0 + verified=false (linkage rows also synthetic) | **Deleted (both the deeds and the 364 fake PPR linkage rows)** |
| **April genuine orphans** | 4 | CoStar Sale History shape (`buyer/seller_address/title_company/transaction_type` in raw_payload), real LLC names (NS Retail Holdings, Kairos Properties, etc.), base64 hash matching `upsertDialysisDeedRecords` format | **1 recovered**, 3 remaining |

The 1 recovery: deed `ea855834-3b10-4f8b-99d7-3e1d9e46388c` (NS Retail Holdings LLC, Montgomery County PA, 2025-10-06) → linked to property `28549` (1849 Davisville Rd, Willow Grove PA — name match + same state + same county).

The 3 remaining orphans (Samson/Northwest Bank, Quentin Gilberoni, Kairos Properties) have known `recorded_owner_id` matches but the matched owners have NO linked properties anywhere — so the deed can't be attached to a specific property until a real property capture for those owners lands. Left for future research.

**dia result: 743 deed_records → 151 (real rows only).** 592 cleaned out.

### gov clusters

All 88 gov orphans were **real CoStar captures** (legit LLCs like "CITY OF TALLAHASSEE", "INVESTAR PROPERTIES LLC", "SOUTHERN HOMES OF MIAMI II INC", real document numbers like "2024.31067" / "2008.319"). The writer (`upsertGovernmentDeedRecords` in `sidebar-pipeline.js:5779`) explicitly writes without `parcel_id` per its own code comment ("since we may not have a parcel UUID"). So the orphans are by-design, not a bug.

Recovery via `property_public_records` linkage where the grantee → recorded_owner name matched (similarity >0.7) AND the owner has exactly one property in the same state: **26 of 88 gov orphans recovered** (37% of matchable, ~30% of total). The remaining 62 either have no name match or have an ambiguous multi-property match — left for manual research.

**gov result: 88 orphans → 62 remaining** (26 PPR linkages added).

## Forward-only protection

`dia.deed_records` gets a new CHECK constraint:

```sql
ALTER TABLE public.deed_records
  ADD CONSTRAINT chk_deed_records_data_hash_min_len
  CHECK (length(data_hash) >= 24);
```

All real writers produce hashes of length ≥ 24 (current min in real data is 28). Only the synthetic scaffolding produced 16-char hex hashes. This blocks any future row from landing with the synthetic pattern. Migration:
`supabase/migrations/dialysis/20260527150000_dia_a4b_deed_records_min_hash_len.sql`.

Gov doesn't need the same guard — its orphans aren't synthetic, they're a writer-design property that's hard to retrofit without breaking captures-without-parcel-context.

## Audit-log inventory (LCC Opps)

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 32 | A4b_dia_deed_records_synthetic_cleanup_2026_05_27_001 | dia | 592 |
| 33 | A4b_gov_deed_records_orphan_recovery_2026_05_27_001 | gov | 26 |

## Plan status

- ✅ **DONE** (25, ↑1): F1-F4, C1, C2, C3 (N/A), C4, C6, C8, B8, B1, B2, B4, B5, B7, **A4 (full now — A4b done)**, A1, A2, A3, A5, A6, A7
- ⬜ **TODO** (7, ↓1): C5, C7, C9, B3, B6, A8, A9

A4 (deed-records orphans) is fully closed — A4a addressed the property_id sync via the legacy join-table (596 → 232 last round), A4b cleaned the remaining 232 + 364 synthetic non-orphans + 88 gov orphans.

## Symptom tracking

| User complaint | Status |
|---|---|
| Duplicates for the same sale on the same property | ✅ FIXED + can't recur |
| Missing many elements of a sales transaction | ⏳ MEANINGFUL PROGRESS, visible in B8 tile |
| Ownership history not in unison | ✅ FIXED + auto-close trigger + visible |
| RCM/LoopNet 401ing → 0 leads landing | ⏳ RCM working, LoopNet needs the user to build the PA flow per Flow 3 spec |
| (new) deed_records cluttered with synthetic / orphan rows | ✅ **FIXED** (dia 743→151 real, gov 88→62 unrecoverable, CHECK constraint blocks recurrence) |

## Recommended priorities for next session

1. **C5 — EXCLUDE constraint hardening** (formalize the no-overlap rule that A6a's trigger enforces de facto)
2. **C9 — standard ingest contract** (define a writer contract + CI lint; would have caught the synthetic-deed pattern earlier)
3. **B6 — provenance review queue staffing**
4. **A8/A9 — remaining ownership-side items** (need a refresher on what's left)

## Files changed

| File | Change |
|---|---|
| `supabase/migrations/dialysis/20260527150000_dia_a4b_deed_records_min_hash_len.sql` | NEW — CHECK constraint blocking hashlen<24 |
| `docs/ownership_sales_remediation/2026-05-27_a4b_session_status.md` | NEW — this doc |

No code changes (cleanup was data-only via direct SQL). No new cron workers.
