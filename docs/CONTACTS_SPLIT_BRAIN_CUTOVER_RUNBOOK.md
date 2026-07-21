# unified_contacts split-brain — cutover runbook (2026-07-21)

Companion to `CONTACTS_SPLIT_BRAIN_DELTA_2026-07-21.md` (the Phase-0a delta). Tracks
what is applied, the remaining Gate-1 cutover steps, reversal, and the gated Phase 1.

## What is DONE (this branch `claude/lcc-contacts-split-brain-88pyof`)

- **0a — delta enumerated + committed** (the artifact doc). both 29,442 / gov-only
  1,053 / ops-only 561; zero content-field drift on shared rows.
- **0b — reversible merge into canonical (LCC Opps), applied live + verified:**
  - 1,009 gov-only owner rows INSERTed (no email → no dup risk).
  - 63 shared-row `recorded_owner_id` fill-blanks (gov had, ops NULL).
  - 44 email-colliders folded into their ops twin (fill-blank + gov `unified_id` and
    the conflicting `company_name` preserved in `merge_history` — never a dup, never a
    guess; 30 had a real company conflict → surfaced, not overwritten).
  - ops `unified_contacts` 30,003 → **31,012**; 1,053 rows tagged
    `field_sources._split_reconcile='split_reconcile_2026-07-21'`.
  - **Reversal ledger** `public._recon_merge_log` (LCC Opps, 1,116 rows) retained.
    All diff-scratch (~98 MB) dropped from the disk-sensitive auth DB.
- **0c code (ships on Railway redeploy of merged `main`):**
  - Split-transaction fix — `CONTACTS_HUB_PATH_RE` now routes `unified_contacts` +
    `contact_change_log` + `contact_merge_queue` together to the hub DB (was: only
    `unified_contacts` followed the flag, stranding the audit/merge-queue on gov).
  - App-code gov readers repointed hub-aware: `fetchHotContacts` (briefing-data.js)
    and the copilot chat-context reader (operations.js).
- **0d code (ships on redeploy):**
  - operations.js `unified_contacts` queries keyed on the nonexistent `id` column
    (PK is `unified_id`) → fixed (were 400ing).
  - The two SF auto-link PATCH blocks (ingest + merge) routed through `auditedPatchGov`
    (was raw `govQuery` → unaudited).
- Full suite **2065 pass / 0 fail / 6 skipped**; `check:boot` green.

## Remaining Gate-1 steps (OPERATIONAL — need Scott / a redeploy)

Do these **in order**. Nothing below has been done autonomously.

1. **Merge & redeploy** this branch to `main` (ships the 0c/0d code). Run
   `npm run verify:deploy`.
2. **Repoint the two Deno edge readers** (they still read gov `unified_contacts`),
   then redeploy them to the **Dialysis_DB** project (`zqzrriwuavgrquhisnoa`):
   - `supabase/functions/daily-briefing/index.ts:477`
   - `supabase/functions/copilot-chat/index.ts:196`
   Each needs the LCC Opps URL/key in its edge env to read the hub when flipped. Until
   done, leave `CONTACTS_HUB` unset so they keep reading gov coherently.
3. **Flip the routing:** set **`CONTACTS_HUB=ops`** in the Railway env. This is the
   only lever — the code already routes reads+writes+change-log+merge-queue to ops when
   set. (The 0b merge already put the gov-only rows on ops, so nothing is lost by the
   flip.)
4. **Verify write-lands-together (Gate 1):** create/patch a contact through the API and
   confirm the contact row AND its `contact_change_log` row both land in **LCC Opps**
   (not gov). Confirm `getHistory`/`merge_queue` read from ops.
5. **Make the gov copy read-only** (rollback anchor; do NOT drop). gov
   `public.unified_contacts` currently has **RLS disabled + full anon DML** (see the
   security note in the delta doc). Revoke `INSERT/UPDATE/DELETE/TRUNCATE` from
   `anon`/`authenticated` on gov `unified_contacts` (+ `contact_change_log`,
   `contact_merge_queue`), leaving `SELECT`. Keep the rows.

Gate 1 = one canonical table (ops), delta reconciled, `CONTACTS_HUB=ops`, a write lands
contact+change-log in the same DB, gov read-only, suite + boot green.

## Reversal (fully reversible)

- **The 0b merge** — from `public._recon_merge_log` (batch `split_reconcile_2026-07-21`)
  on LCC Opps:
  - `gov_only_insert` (1,009): `DELETE FROM unified_contacts WHERE unified_id IN
    (SELECT unified_id FROM _recon_merge_log WHERE action='gov_only_insert');`
  - `fill_recorded_owner` (63): `UPDATE unified_contacts SET recorded_owner_id=NULL,
    field_sources = field_sources - 'recorded_owner_id' WHERE unified_id IN (SELECT
    unified_id FROM _recon_merge_log WHERE action='fill_recorded_owner');`
  - `collider_fold` (44): restore each ops twin's `company_name`/`phone`/`title`/
    `merge_history` from `_recon_merge_log.prev`.
  - Drop the `_split_reconcile` tag: `UPDATE unified_contacts SET field_sources =
    field_sources - '_split_reconcile' WHERE field_sources ? '_split_reconcile';`
- **The code** — revert the branch commits; `CONTACTS_HUB` unset returns routing to gov.
- **The flip** — unset `CONTACTS_HUB`; gov (kept, read-only-revocable) is the rollback DB.

## Phase 1 — NOT started (gated; must NOT begin until Gate 1 passes)

`entity_id` coverage on ops is **700 / 31,012**; bridged owner entities with a PERSON
attached is tiny. Phase 1 backfills `entity_id` from the identity keys, resolves
company/LLC owners, and writes `person→org` edges — reusing `ensureEntityLink` /
`linkPersonToEntity` / `sf-id.js` / `owner-cross-reference.js` (no forked matcher).

**⚠️ Blast-radius (documented incident 2026-07-19):** creating ~15k
`entity_relationships` edges degraded `v_priority_queue_live` from ~1s to >60s and
saturated the LCC-Opps connection pool (auth DB). Phase 1 MUST: dry-run + report first
(Gate 2); apply edges in bounded `--limit` batches; check `lcc_refresh_log`
`lcc_refresh_priority_queue_resolved` duration between batches (baseline ~1.8–3.0s, STOP
if >10s); capture band membership (count + md5 per band) before/after and report the
shift; every edge reversible by `metadata.via='contacts_reconcile:<batch_tag>'`.

## Known gaps (surfaced so they are not rediscovered)

- **Phase 2 (not built):** the incremental reconcile tick; a merge-queue worker that can
  reach the whole table (`detectDuplicates` scans only the top ~200 by `updated_at`, so
  the 30k tail is invisible); scheduled `engagement_score` recompute (recency-weighted
  but only recalculated on write → stale-high rows sit atop "hot leads").
- **Phase 3 (not built):** Outlook contact ingestion (`/me/contacts`), received-mail
  harvesting, bounceback/signature-block extraction.
- **`webex_person_id`:** the telephony API in use structurally cannot return it — do not
  attempt to populate it; if touched, make `getDataQuality`'s `webex_linked` metric
  honest rather than always-0.
- **Security:** gov `unified_contacts` RLS-disabled + anon full DML (step 5 above starts
  hardening; a full pass belongs to a follow-up once gov is retired).
