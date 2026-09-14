# A9b — unified_contacts cutover design (LCC hub becomes authoritative)

Status: **design / not executed.** A9a is done (gov→hub data migration complete: hub = 29,634 rows ≈ gov's 29,481). A9b is the consequential step — repointing the live Contacts feature from gov.unified_contacts to the LCC Opps hub (Decision #1). It changes production app behavior, so it's staged behind explicit sign-off.

## Current state

- **App reads/writes** `unified_contacts` via `contacts-handler.js` → **`govQuery`** (the gov DB). All `govQuery` calls in that handler target `unified_contacts` only; `opsQuery` (the LCC client) is already imported and used for other tables (`pending_updates`, `data_corrections`, events).
- **The hub** (`xengecqvemvfknjvbvrq.unified_contacts`) holds 29,634 rows: 197 originals + 13,403 gov owners + 16,034 gov SF — a near-complete copy of gov.unified_contacts (minus 44 email-collision skips).
- The cutover is conceptually a `govQuery → opsQuery` swap for the contacts operations.

## Cutover prerequisites (blockers)

1. **Schema parity — the 4 gov-only columns.** The handler references `teams_user_id`, `email_aliases`, `last_activity_date`, `total_touches` in 18 places (reads, filters like `?teams_user_id=eq.X`, writes). The hub lacks all four. A blind cutover → PostgREST `column does not exist` (400) on those queries.
   - **Fix:** `ALTER TABLE unified_contacts ADD COLUMN` the four on the hub, then backfill them from gov for the 29,437 migrated rows (the A9a script intentionally omitted them).

2. **Unique-email constraint difference.** The hub has `idx_uc_email` (partial `UNIQUE (lower(email))`); gov does not. The handler's **create/upsert path** must handle a duplicate-email insert gracefully (today it can't fail that way against gov). Without handling, creating a contact whose email already exists → 23505.
   - **Fix:** the create path should match-existing-by-email and update, or surface a clean "contact exists" — not a raw 500.

3. **44-row same-identity dedup.** The 44 broker-owners skipped in A9a (owner row + SF row, same email) should have `sf_contact_id`/`sf_account_id` backfilled onto their existing hub (owner) row, so SF-id lookups (`?sf_contact_id=eq.X`) resolve post-cutover. Part of the systematic contact-dedup pass.

4. **dia representation ("dia projection").** The hub barely contains dia data (141 `dia_contact_id` links). A9b's plan calls for dia contacts/owners in the hub + dia properties carrying a `unified_id` backref (dia.properties has none today). Scope TBD — may be a mirror of A9a for dia owners + a dia.contacts migration. Needed only if the Contacts feature must surface dia contacts from the hub.

## Risks

- **UI breakage** if any consumed column is missing on the hub (the 4 above are the known set — a full column-diff should run before flip).
- **Write-path regressions** (email-uniqueness, any hub triggers the handler doesn't expect).
- **Completeness**: the hub must be a superset of what the app shows today, or contacts "disappear."
- **Hard to reverse once writes land on the hub** — new contacts created post-cutover live only on the hub; a rollback to gov would lose them. So the flip should be gated + monitored.

## Proposed phased plan (each phase shippable + reversible)

1. **Schema parity** — add the 4 columns to the hub; backfill from gov for migrated rows (workstation script, dry-run-first). *No app change.*
2. **Full column-diff audit** — confirm the hub has every column the handler/UI reads. Add + backfill any others found. *No app change.*
3. **Dedup pass** — merge the 44 (and any other same-email identities) — backfill `sf_contact_id`/`sf_account_id` onto survivors. *No app change.*
4. **Create-path hardening** — make `contacts-handler` create/upsert email-collision-safe. *Behavior-preserving against gov.*
5. **Repoint behind a flag** — swap `govQuery → opsQuery` for contacts ops, gated on an env flag (`CONTACTS_HUB=ops`), defaulting off. Flip in a low-traffic window; monitor; instant rollback by unsetting the flag. *The cutover.*
6. **dia projection + property `unified_id` backfill** (A9b proper) — once the hub is authoritative.
7. **Projection-sync worker** — if domains still need local contact copies (hub → domain), as a Vercel cron (LCC has no domain creds in vault).

## Decisions to confirm before executing

- **Go/no-go on the cutover** at all (vs. leaving gov as the contacts backend and treating the hub as a read-replica/BD store).
- **dia scope** — does the Contacts feature need dia contacts surfaced from the hub, or is gov+SF the relevant universe? (Determines whether phase 6 is required.)
- **Sequencing** — start with phase 1 (schema parity, safe), or pause A9b and do A8/C7 first.

## Progress

- **Phase 1a — schema parity columns: ✅ DONE (2026-05-29).** Added `teams_user_id`, `email_aliases text[]`, `last_activity_date`, `total_touches` to the hub (migration `20260527190000_lcc_a9b_unified_contacts_parity_columns.sql`, applied to LCC Opps). Full column-diff now shows **`in_gov_not_hub = NULL`** — the hub has every gov column (hub-only extra `sf_last_synced` is harmless). The cutover's "column does not exist" risk is eliminated. Audit log 51.
- **Phase 1b — value backfill: ✅ DONE (2026-05-29).** `scripts/A9b_backfill_parity_cols.mjs --apply` backfilled the 3 populated parity columns from gov onto the migrated hub rows. 16,990 gov rows with parity data → **44 skipped** (the email-collision rows not in hub — update-only guard prevented junk inserts) → **16,946 updated**. Verified: hub total unchanged at 29,634; `last_activity_date` 16,892, `total_touches` 16,946, `email_aliases` 16,629 (each = gov count − 44). Audit log 52. **Hub now has full schema + value parity with gov.unified_contacts for the migrated set.**

Remaining A9b phases (3–7) per the plan above are unstarted and gated on sign-off at the repoint step.

## Phase 4 finding (create-path email-safety) — already largely satisfied

Investigated `ingestContact` (the create path). It does **Tier 0 = email exact match first** (`unified_contacts?email=ilike.<email>&limit=1`); on a hit it takes the MERGE/update branch, never inserting a second row for that email. So duplicate-email inserts are already prevented in the normal flow — the hub's `UNIQUE (lower(email))` won't break the cutover. (`ilike` exact ≈ case-insensitive equality, aligns with the `lower(email)` index.)

Residual: a **concurrent-create race** (two requests, same email, both miss the lookup, both insert) → one hits 23505 and currently 500s. This only matters *after* the repoint (gov has no such constraint, so it can't fire today). The fix — catch 23505 and fall back to email-match-update — belongs **with the phase-5 repoint** (a gov-side fallback now would be unreachable dead code). So phases 4 + 5 are one unit.

## Recommendation: treat phases 3–7 as a single, tested cutover unit

The safe prep is done (A9a data migration + phase 1/2 schema & value parity, column-diff clean). What's left is the **actual cutover** — repoint `contacts-handler` `govQuery → opsQuery` behind a flag, with the 23505-race fallback, exercised against the hub in a low-traffic window with instant flag rollback — plus the 44-row dedup (folds into the systematic contact-dedup) and the dia projection (phases 6–7). These change live Contacts behavior and should be done deliberately as one tested chunk with sign-off, **not** bolted onto the live handler piecemeal.

## Audit / files

A9a audit entries: 44 (staged), 47 (owners applied), 50 (SF applied). A9b: 51 (phase 1a parity columns), 52 (phase 1b value backfill).
