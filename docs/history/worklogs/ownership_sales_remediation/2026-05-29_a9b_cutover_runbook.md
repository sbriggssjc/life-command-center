# A9b Contacts-backend cutover — turnkey implementation runbook

Goal: repoint the live Contacts feature's `unified_contacts` operations from **gov** → the **LCC Opps hub**, behind a default-off flag, with full test + rollback. Execute from a workstation/staging context where the Contacts UI + Vercel runtime can be exercised (this remote agent can't runtime-test it).

> **CODE LANDED (2026-05-29).** The flag-gated repoint is implemented in `api/_handlers/contacts-handler.js` (commit on branch `claude/gifted-wozniak-Y8rng`): `CONTACTS_HUB` flag (default `gov`), path-based routing inside `govQuery()` (unified_contacts → hub when `ops`; everything else stays gov), accurate audit `target_source`, and a clean-409 guard for the email-dup race. **Default off = zero behavior change today** (verified: routing branch is dead unless `CONTACTS_HUB=ops`; flag/path logic unit-tested). The agent could NOT runtime-test the Contacts UI against the hub — so Steps 0/5/6 below (delta re-sync → test on staging → flip) are still required before trusting the flag in production.

Prereqs already satisfied (this engagement): A9a data migration (hub = 29,634 ≈ gov's contacts), A9b phase 1/2 schema + value parity (column-diff clean: `in_gov_not_hub = NULL`), create-path verified email-safe via Tier-0 match. Hub PK `unified_id`; partial `UNIQUE (lower(email))` = `idx_uc_email`; no FKs.

---

## ⚠️ Step 0 — Delta re-sync immediately before the flip (do not skip)

The hub was snapshotted during A9a. The live gov-backed handler keeps writing to `gov.unified_contacts`, so the hub **drifts behind** by every contact created/edited since the migration. Right before flipping, re-run the migration to capture the delta:

```bash
# picks up gov rows not yet in the hub (ON CONFLICT unified_id ignore-duplicates)
node scripts/A9a_migrate_gov_owner_contacts.mjs --scope=all --apply
node scripts/A9b_backfill_parity_cols.mjs --apply
```

Then confirm counts line up:
```sql
-- gov
SELECT count(*) FROM unified_contacts;
-- hub (expect >= gov count, minus the ~44 email-collision skips, plus 197 originals)
SELECT count(*) FROM unified_contacts;   -- on LCC Opps
```
(Edits — not just inserts — made on gov rows since the snapshot won't be re-pulled by ignore-duplicates. If edit-drift matters, run a one-off "PATCH hub from gov where updated_at > snapshot" pass, or accept that post-cutover the hub is authoritative and minor pre-cutover edits are superseded.)

---

## Step 1 — The flag + client selector

`api/_handlers/contacts-handler.js`:

```js
// Default 'gov' = today's behavior, unchanged. Flip to 'ops' to cut over.
const CONTACTS_DB = (process.env.CONTACTS_HUB || 'gov').toLowerCase() === 'ops' ? 'ops' : 'gov';

// Reads: route unified_contacts queries to the selected backend.
async function contactsQuery(method, path, body, extraHeaders = {}) {
  return CONTACTS_DB === 'ops'
    ? opsQuery(method, path, body, extraHeaders)
    : govQuery(method, path, body, extraHeaders);
}
```

`opsQuery` is already imported (line 21) and used in this file, so the OPS client is proven.

## Step 2 — Repoint the reads (unified_contacts only)

Replace `govQuery(` → `contactsQuery(` **only on the calls whose path starts with `unified_contacts`** (38 `govQuery` calls exist; the unified_contacts subset is the target — verify each path). Leave `govQuery` calls for other gov tables (`contact_change_log`, etc.) untouched. Grep to enumerate:
```bash
grep -nE "govQuery\('(GET|POST|PATCH|DELETE)', *\`?unified_contacts" api/_handlers/contacts-handler.js
```

`pgVal`/`ilike` filters are unchanged. Note: `email=ilike.<x>` ≈ case-insensitive equality, which aligns with the `lower(email)` unique index — no change needed.

## Step 3 — Repoint the audited writes (unified_contacts only)

`auditedGovWrite` (line 207) and `auditedInsertGov` do the write via `govQuery(...)` with `target_source:'gov'` hardcoded; the audit log (`pending_updates`/`data_corrections`) already goes to OPS. Branch on `targetTable`:

```js
// inside auditedGovWrite / auditedInsertGov, where it currently calls govQuery:
const writeToHub = CONTACTS_DB === 'ops' && targetTable === 'unified_contacts';
const result = await (writeToHub ? opsQuery : govQuery)(method, path, changedFields);
// and set target_source accordingly in the audit rows:
const targetSource = writeToHub ? 'ops' : 'gov';
```

`contact_change_log` writes stay on gov (or move them too if you want the change log co-located — optional, out of scope for the flip).

## Step 4 — 23505 fallback (race-safety, only relevant on the hub)

In the create path (`ingestContact`, ~line 894), after the insert, handle the partial-unique violation that the hub can raise (gov can't):

```js
if (!result.ok) {
  const isEmailDup = result.status === 409
    && /idx_uc_email|unique/i.test(JSON.stringify(result.data || ''));
  if (isEmailDup && email) {
    // A concurrent create won the race. Re-fetch by email and update instead.
    const existing = (await contactsQuery('GET',
      `unified_contacts?email=ilike.${encodeURIComponent(email)}&limit=1`)).data?.[0];
    if (existing) { /* run the same merge/update branch used for existingId */ }
  } else {
    return res.status(result.status).json({ error: 'Failed to create contact', detail: result.data });
  }
}
```

(Low-frequency; the Tier-0 email match already prevents the common case.)

## Step 5 — Test checklist (run with CONTACTS_HUB=ops on staging / a preview deploy)

Reads:
- [ ] List contacts (`GET /api/contacts`) — count ≈ 29,634, pagination works.
- [ ] Get by `unified_id`; search by name/email/phone.
- [ ] Lookup by each id column: `sf_contact_id`, `outlook_contact_id`, `webex_person_id`, `teams_user_id`, `icloud_contact_id` (these are the parity columns added in phase 1a — confirm no 400s).
- [ ] Stale-flag panels (`email_stale`, `phone_stale` counts) render.

Writes:
- [ ] Create a brand-new contact (unique email) → inserts on the hub; appears.
- [ ] Create a contact whose email already exists → takes the merge/update path (no 500, no duplicate).
- [ ] Edit a contact (PATCH) → persists on the hub; `data_corrections` row logged with `target_source='ops'`.
- [ ] Dedup/merge endpoint → keeper survives, merge_id deleted, links transferred.
- [ ] Engagement signals + SF auto-link on create still work.

Cross-check: every write lands on `LCC Opps.unified_contacts` (not gov) while the flag is on.

## Step 6 — Flip + monitor

Set `CONTACTS_HUB=ops` in the Vercel env (low-traffic window). Watch function logs + the Contacts UI for ~30 min.

## Rollback (instant, no data migration)

Unset `CONTACTS_HUB` (or set `=gov`) and redeploy. Reads/writes revert to gov immediately. **Caveat:** any contact created/edited during the cutover window lives only on the hub — re-run the delta sync gov←hub for that window if you roll back after writes have landed, or accept the brief divergence. Keep the window short.

## After the cutover (phases 6–7, later)

- gov.unified_contacts goes stale (no longer written). Decide: retire it, or make it a downward **projection** synced from the hub (the `unified-contacts-projection-tick` Vercel cron — LCC has no domain creds in vault, so it must be a Vercel handler, not in-DB pg_net).
- A9b dia projection: give dia.properties a `unified_id` backref + surface dia contacts from the hub, if the Contacts feature must show dia contacts (today the hub holds gov owners + SF + 141 dia links).
- Systematic contact-dedup pass: merge the 44 email-collision broker-owners (backfill `sf_contact_id` onto the owner rows) + any other same-email identities.

## Risk summary

- **Highest risk = the refactor breaking the *current* gov path**, not the dormant hub path. Keep the default-off wrapper a pass-through to today's exact `govQuery` call; review every repointed call-site; test default-off first (behavior must be identical), then `=ops`.
- Completeness: the hub must be ≥ what the UI shows today — the delta re-sync (Step 0) guarantees this.
- Reversibility: flag flip is instant; the only one-way aspect is writes landing on the hub during the window.
