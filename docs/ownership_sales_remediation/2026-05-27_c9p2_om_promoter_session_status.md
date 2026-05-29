# Ownership & Sales Remediation — 2026-05-27 Session Status (C9 Phase 2: OM promoter)

Picks up after the deed-parser migration (commit `b0673fc`, still on-branch — see the branch-reconcile note below). Focus this round: **C9 Phase 2 — second writer migration: OM intake promoter**.

## Branch reconcile note (start of session)

Discovered at sync time that the C9 Phase 2 deed-parser change (`b0673fc`) was **never merged to main** — no PR #958 exists (latest merged is #957/B6), and `validateDeedIngest` is confirmed absent from `main`'s `deed-parser.js`. Main had received a direct "GPT changes" commit (a weekly-report `.md` only). Per the user's call, merged `origin/main` into the branch (conflict-free, merge commit `1140c49`) and continued — the deed-parser commit + this round's work will ship together in the next PR.

## What the investigation found

The OM promoter writes a **different table set** than deed-parser: `available_listings`, `leases`, `properties` (PATCH), `contacts` (broker), `prospect_leads`, `property_financials`. None are sales/owners/deeds, so the existing `SaleIngestDTO` / `OwnerIngestDTO` / `DeedIngestDTO` didn't map.

The highest-value contract application is the **name-bearing writes**, where junk-name + federal-anti-pattern filtering prevents garbage from landing — the same protection the sidebar already has, now extended to the OM channel.

## What landed

### Contract extension: `ContactIngestDTO` + `validateContactIngest`

New in `api/_shared/ingest-contract.js`:
- A contact needs at least one identifier (name OR email)
- When a name is present: must not be a junk/section-label pattern (`isJunkContactName`) or federal-anti-pattern (`isFederalOwnerAntiPattern`)
- Email shape check
- Reuses the already-imported canonical filters — no new regex

### `promoteBrokerContact` migration

Validates the broker name through the contract before the insert. **Name-focused** logic:
- Junk/federal name → **nulled** (the row falls back to `email` / `'Unknown Broker'`)
- Never drops a contact that still has a usable email (a malformed email does NOT skip a valid-name contact)
- Skips only when neither a usable name nor an email survives

This keeps CoStar/OM section-label leaks ("Listing Broker", "View More", "Per SF") and federal bleed-through ("U S A", "Government") out of the `contacts` table when they leak into the `listing_broker` field.

### `promoteProspectLead` guard

Suppresses federal-anti-pattern owner strings before they land as `true_owner` / `recorded_owner` on the prospect lead. `snapshot.seller_name || snapshot.owner_name` is nulled when it matches the anti-pattern (Round 76ek.i bleed-through) rather than written.

## Smoke tests (7 contact-validation paths, all correct)

```text
valid broker person (name + email)          → ok
section-label leak "Listing Broker"         → rejected (name) → nulled, email kept
section-label "View More" + email           → rejected (name) → nulled, email kept
federal anti-pattern "U S A"                → rejected (name) → nulled
email only (no name)                        → ok
nothing (no name, no email)                 → rejected → skip
"Jane Broker" + malformed email             → email error only → name preserved, NOT skipped
```

The last case proves the refinement: a valid name survives even when the email is malformed — the migration never drops a good broker contact over a bad email.

## Why this is non-breaking

- Existing successful writes unaffected — only junk/federal NAMES are filtered (and even then, the contact is preserved via email when possible)
- No data movement, no new cron, no new route, no env vars
- The `'Unknown Broker'` fallback already existed; this just routes more cases through it

## Plan status

- ✅ **DONE** (27): F1-F4, C1, C2, C3 (N/A), C4, C6, C8, B8, B6, B1, B2, B4, B5, B7, A1, A2, A3, A4, A5, A6, A7
- ⏳ **PARTIAL** (2): C5 (Phase 1 + Phase 2 prep) + **C9** (Phase 1 + Phase 2: deed-parser + OM promoter)
- ⬜ **TODO** (4): C7, B3, A8, A9

## Audit-log inventory

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 39 | C9_phase2_om_promoter_migration_2026_05_27_001 | all | 0 (writer migration; no data movement) |

## Files changed

| File | Change |
|---|---|
| `api/_shared/ingest-contract.js` | NEW `ContactIngestDTO` + `validateContactIngest` |
| `api/_handlers/intake-promoter.js` | broker-name validation in `promoteBrokerContact`; federal-anti-pattern guard in `promoteProspectLead`; contract imports |
| `docs/ownership_sales_remediation/2026-05-27_c9p2_om_promoter_session_status.md` | NEW — this doc |

Plus the carried-over deed-parser commit `b0673fc` (api/_handlers/deed-parser.js) ships in the same PR.

## C9 Phase 2 progress

| Writer | Status |
|---|---|
| deed-parser | ✅ migrated (deed DTO) — commit b0673fc |
| OM intake promoter | ✅ migrated (contact DTO) — this round |
| RCM/LoopNet ingest | ⬜ next |
| CoStar sidebar | ⬜ last (biggest) |

## Recommended priorities for next session

1. **C9 Phase 2 next writer — RCM/LoopNet `lead-ingest` Edge Function** (validateContactIngest on the parsed lead name/email; webhook-driven, well-bounded)
2. **C5 Phase 2 final** — grandfather-WHERE EXCLUDE, closes out C5
3. **A9 — unified_contacts consolidation** (biggest remaining)
4. **B3 — deed-relink-tick** (lower priority post-A4b)
