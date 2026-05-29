# Ownership & Sales Remediation — 2026-05-27 Session Status (A9a: unified_contacts consolidation, owner subset)

LCC Opps recovered from its restart. Resumed **A9 — unified_contacts consolidation**, scoped (per decision) to **A9a owner-subset, staged**. This round delivers the investigation + a reversible, dry-run-first migration script; **no rows were written** (the live migration runs from a workstation).

## The landscape (investigated this round)

| Store | Rows | Linkage convention |
|---|---|---|
| **LCC Opps** `unified_contacts` (canonical hub) | 197 | `dia_contact_id` (141) / `gov_contact_id` (54) / SF (139); **0** `recorded_owner_id` |
| **gov** `unified_contacts` | 29,481 | `recorded_owner_id` (13,403) / SF (16,990); **0** `gov_contact_id` |
| **dia** `unified_contacts` | — | does not exist (A9b territory) |

The two stores key contacts **differently**, so A9 is a mapping migration, not a blind copy. A9a handles the owner-linked slice.

### Owner-subset profile (the A9a scope)

gov `unified_contacts` WHERE `recorded_owner_id IS NOT NULL` = **13,403 rows** → **13,397 distinct canonical owners**:
- only **6** same-owner duplicates (two UC rows sharing a `recorded_owner_id`)
- **0** point at an A1-merged loser (the A1 remap is a future-proof no-op here)

### Why a workstation script (not pg_net / in-DB)

LCC Opps vault holds only `lcc_api_key`, `lcc_health_alert_webhook`, `lcc_railway_url` — **no gov/dia DB credentials**. Yet `entities` (15,263) and `lcc_entity_portfolio_facts` (5,873) are populated, which means the BD engine was seeded by a **one-shot workstation backfill**, not its in-DB pg_net sync (whose `gov_supabase_*` secrets were never set). A9a follows that same established pattern (cf. `scripts/geocode-properties-backfill.mjs`, `scripts/merge-duplicate-owners.mjs`). This also handles the contact PII cleanly (service-key access on both ends).

### Pre-flight safety gates (all green)

- **Disk**: LCC Opps at **7.21 GB** (warn 11 / crit 12.5; `sf_sync_log` reclaimed to 28 MB). 13.4k contact rows ≈ ~30–60 MB → ample headroom.
- **PK**: `unified_contacts_pkey (unified_id)` → idempotent `ON CONFLICT (unified_id)` works.
- **No FKs** on the hub's link columns → carrying gov UUIDs (`recorded_owner_id`, etc.) won't violate anything.
- **No NOT-NULL-without-default** columns → inserts can't fail on a missing required field (`contact_class` defaulted to `'business'` defensively).

## Deliverable: `scripts/A9a_migrate_gov_owner_contacts.mjs`

A reversible, dry-run-first migration:
- **1:1 migration, preserves `unified_id`** (so any FK referencing it survives). No destructive collapse — the 6 same-owner dupes migrate as-is (distinct unified_ids); deduping `unified_contacts` is a separate future pass.
- **Idempotent**: upserts with `on_conflict=unified_id, resolution=ignore-duplicates`. Re-running skips already-migrated rows.
- **A1-canonical remap**: a row whose `recorded_owner_id` points at an A1-merged loser is remapped to the survivor (0 hits today; future-proof, resolves up to 5 hops).
- **Reversible**: every migrated row is tagged `field_sources->>'_a9a_migrated' = <run_id>`. Full rollback:
  ```sql
  DELETE FROM unified_contacts WHERE field_sources ? '_a9a_migrated';
  ```
- **Audited**: on `--apply`, best-effort `audit_run_begin/finish` on LCC Opps (signatures verified). A logging hiccup never aborts the migration.
- Carries the shared column set (gov-only `teams_user_id`/`last_activity_date`/`total_touches`/`email_aliases` and LCC-only `sf_last_synced` intentionally omitted).

Verified: `node -c` clean; transform logic smoke-tested (unified_id preserved, A1 remap fires, `field_sources` tag + `contact_class` default correct).

## How to run it (workstation with both service keys in env / `.env.local`)

```bash
# Required env: GOV_SUPABASE_URL + GOV_SUPABASE_SERVICE_KEY,
#               OPS_SUPABASE_URL + OPS_SUPABASE_SERVICE_KEY

# 1) Dry-run (no writes) — review the summary counts:
node scripts/A9a_migrate_gov_owner_contacts.mjs
#    expect: source ~13,403, distinct canonical ~13,397, would-upsert ~13,403

# 2) Small live batch to spot-check the hub, then full:
node scripts/A9a_migrate_gov_owner_contacts.mjs --apply --limit=200
node scripts/A9a_migrate_gov_owner_contacts.mjs --apply

# Rollback if needed:
#   DELETE FROM unified_contacts WHERE field_sources ? '_a9a_migrated';
```

Post-apply verification:
```sql
SELECT count(*) FILTER (WHERE field_sources ? '_a9a_migrated') AS migrated,
       count(*) AS total
FROM unified_contacts;        -- migrated ≈ 13,403, total ≈ 13,600
```

## What's deferred (follow-on rounds)

- **A9a remainder**: the 16,990 SF-linked-only gov rows; the `unified-contacts-projection-tick` worker (5-min) that pushes hub→domain diffs.
- **A9b**: stand up the dia projection; backfill 13,964 dia properties; final verification (hub row count = union of distinct canonical entities).
- **Contact dedup**: a future pass to collapse the ~6 same-owner dupes (and any hub-vs-197 overlaps) — analogous to A1 for owners.

## Plan status

- ✅ **DONE** (28): F1-F4, C1, C2, C3 (N/A), C5, C4, C6, C8, B8, B6, B1, B2, B4, B5, B7, A1, A2, A3, A4, A5, A6, A7
- ⏳ **PARTIAL** (2): C9 (writer sweep complete; optional orchestrators remain) + **A9** (A9a script staged + dry-run pending; A9a-SF + A9b deferred)
- ⬜ **TODO** (2): C7, A8 — (B3 closed N/A last round)

## Audit-log inventory

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 44 | A9a_script_authored_2026_05_27_001 | gov_db | 0 (script staged, dry-run pending) |

## Files changed

| File | Change |
|---|---|
| `scripts/A9a_migrate_gov_owner_contacts.mjs` | NEW — reversible, dry-run-first gov→LCC owner-contact migration |
| `docs/ownership_sales_remediation/2026-05-27_a9a_session_status.md` | NEW — this doc |

## Recommended next steps

1. **Run A9a** (dry-run → review → apply) from a workstation, then I'll record the live audit entry + verify the hub.
2. **A9a-SF + projection worker**, then **A9b** (dia projection) — the rest of A9.
3. **A8** (CoStar Contacts harvest feasibility) / **C7** (SOS adapters) — the last two plan items.
