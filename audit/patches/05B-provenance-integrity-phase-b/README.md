# Item #5 Phase B — Provenance integrity (D-13 + gating)

Closes the silent-write loop on `ownership_research_queue` that's been
generating ~thousands of `ingest_write_failures` rows since the table was
migrated to the AI-pipeline shape. Adds backwards-compatible gating to
`pushProvenance` so future writes can opt out when the upstream write
failed.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/05B-provenance-integrity-phase-b
node audit/patches/05B-provenance-integrity-phase-b/apply.mjs --dry
node audit/patches/05B-provenance-integrity-phase-b/apply.mjs --apply
git add -A
git commit -F audit/patches/05B-provenance-integrity-phase-b/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/05B-provenance-integrity-phase-b -m "Merge audit/05B-provenance-integrity-phase-b: D-13 + provenance gating"
git push origin main
```

No SQL migration. No backend changes outside `sidebar-pipeline.js`.

## What's in this patch

**1. D-13 fix — neutralize broken queue writers.**

Two writers in `sidebar-pipeline.js` have been POSTing wrong columns to
`ownership_research_queue`:
- Line ~1851: `BROKER_FIRSTNAME_ONLY` enqueue
- Line ~2684: `autoEnqueueOwnerResearch`

Schema mismatch verified via MCP: production has `lead_id, task_type,
task_status, ai_*` etc., not the legacy `property_id, address, city,
state, recorded_owner_*` set. Every POST 4xx'd silently.

Both writers now log a `[sidebar-pipeline] D-13: skipped` debug line and
return. The Python AI pipeline already handles both cases via the
`lead_id`-based queue with `task_type='contact_discovery'` (brokers) or
`'entity_resolution'` (unknown true_owner).

**2. pushProvenance gating signature.**

```js
function pushProvenance(provCollect, table, recordPk, fields, confidence, source, writeResult) {
  if (writeResult && writeResult.ok === false) return; // gate
  // ... existing logic
}
```

Backwards compatible. New call sites can opt in by passing the upstream
PATCH/POST result as the 7th arg:

```js
const patchRes = await domainPatch(...);
pushProvenance(provCollect, 'parcel_records', id, fields, undefined, undefined, patchRes);
```

One concrete migration in this patch: the `parcel_records` PATCH in
`upsertPublicRecords` (line ~3590) now passes the patch result through,
so a 4xx no longer records phantom provenance.

**3. Discovery captured: Item #3 Phase B re-scoped.**

Verified via MCP that all 13,338 NULL-owner dia properties have **zero**
owner signal anywhere — no ownership_history, no deed_records, no
sales_transactions, no `latest_deed_grantee`, no `assessed_owner`. The
Phase A reconciler has nothing to reconcile from. Item #3 Phase B is
re-classified as Phase C with an explanatory note in `AUDIT_PROGRESS.md`.
Real resolution requires external enrichment (SoS scraper, county
recorder ingest, or a commercial property-records API).

## Smoke test (post-merge + Railway redeploy)

1. Run a fresh CoStar sidebar capture against a gov property that has:
   - At least one broker contact with first-name-only extracted, and
   - An unknown `true_owner_id`.
2. Check console for `[sidebar-pipeline] D-13: skipped` log lines.
3. Query `ingest_write_failures` on LCC Opps for new rows tagged
   `ownership_research_queue` from the last hour:
   ```sql
   SELECT count(*)
   FROM public.ingest_write_failures
   WHERE created_at > now() - interval '1 hour'
     AND path LIKE '%ownership_research_queue%';
   ```
   Should return 0.

## Phase C follow-ups

- Sweep the remaining ~30 `pushProvenance` call sites in
  `sidebar-pipeline.js` and pass their upstream result through, adopting
  the gating pattern across the file.
- Item #3 Phase C: design + ship an external owner-enrichment pipeline
  for the 13,338 orphaned dia properties.
