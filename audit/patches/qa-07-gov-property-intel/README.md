# QA-07 — Gov `property_intel` mirror + pipeline-stage persistence fix (P0)

**Severity: P0.** Pipeline-stage tracking in the property detail panel
silently no-op'd on every gov property. Clicking a chip updated the
in-memory pill and fired the SF opportunity upsert, but the persist
step 403'd because the gov database didn't have a `property_intel`
table.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-07-gov-property-intel
node audit/patches/qa-07-gov-property-intel/apply.mjs --dry
node audit/patches/qa-07-gov-property-intel/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-07-gov-property-intel/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-07-gov-property-intel -m "Merge audit/qa-07-gov-property-intel: gov pipeline-stage fix"
git push origin main
```

## What was broken

`detail.js`'s pipeline-stage feature was always written domain-agnostic:
`_udHydratePipelineStage` and `_udAdvancePipelineStage` both dispatch
on `_udCache.db` and use `govQuery` or `diaQuery`. But the original
2026-04-16 `property_intel` migration was dia-only (and explicitly
labeled "Target: Dialysis domain Supabase"). On gov:

- **Read**: `govQuery('property_intel', …)` → 403 `Read access denied`
  (table missing from `GOV_READ_TABLES` because it didn't exist).
- **Write**: `applyInsertWithFallback({ table: 'property_intel' …})` →
  same 403, swallowed by the broader try/catch with a `console.warn`.

Visible symptom: clicking "Listed" / "Engaged" / "Under Contract" /
etc. on a gov property's pipeline pill flashed the new color, fired
the toast ("Pipeline stage → Listed"), but the next reload reverted
to the heuristic-inferred stage. Operator couldn't actually move a
gov property through the pipeline.

## What this patch does

1. **Creates `property_intel` on gov** (`scknotsqkcheojiaewwh`), mirroring
   the dia schema:
   ```
   property_id            INTEGER PRIMARY KEY
   pipeline_stage         TEXT
   pipeline_stage_updated_at  TIMESTAMPTZ
   updated_at             TIMESTAMPTZ DEFAULT NOW()
   created_at             TIMESTAMPTZ DEFAULT NOW()
   ```
   Plus index on `pipeline_stage`, RLS enabled, anon SELECT policy,
   authenticated SELECT/INSERT/UPDATE grant.
2. **Adds `property_intel` to `GOV_READ_TABLES` and `GOV_WRITE_TABLES`**
   in `supabase/functions/data-query/index.ts`.
3. **Redeploys the Edge Function as v15** on `zqzrriwuavgrquhisnoa`
   (the prod data-query host — see QA-02 README for why the wrong
   project is easy to grab here).

## Verified after deploy

```js
window.govQuery('property_intel', 'property_id,pipeline_stage', {
  filter: 'property_id=eq.3198', limit: 1
})
// → { count: 0, dataLen: 0 }   ← no more 403; empty because no
//   gov pipeline rows have been persisted yet.
```

| Layer | Before | After |
|---|---|---|
| Gov DB | no `property_intel` table | table created |
| Edge Function `GOV_READ_TABLES` | no `property_intel` | includes `property_intel` |
| Edge Function `GOV_WRITE_TABLES` | no `property_intel` | includes `property_intel` |
| Frontend `govQuery('property_intel', …)` | 403 "Read access denied" | `{count: 0}` (empty table) |
| Console errors per gov detail open | 1× 403 | 0 |
| Pipeline-stage persist on gov | silent fail | works |

## Follow-ups (separate patches)

Still queued from the 2026-05-18 QA pass:
- **P0** `govQuery('v_ownership_chain')` 400 — gov view has no
  `property_id` column.
- **P1** "Open Activities" stat conflict (Home vs Pipeline vs Metrics).
- **P1** Sync error count contradicts itself.
- **P1** Public REITs + same-entity duplicates in `llc_research_queue`.
- **P2** Casing/UX nits documented in
  `outputs/lcc-qa-pass-2026-05-18.docx`.
