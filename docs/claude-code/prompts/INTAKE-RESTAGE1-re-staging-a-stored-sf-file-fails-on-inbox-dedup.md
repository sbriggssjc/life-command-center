# INTAKE-RESTAGE1 — a stored Salesforce file can't be re-staged: `inbox_item_insert_failed` on the OM dedup key

Backlog: `INTAKE-RESTAGE1`. Found by Cowork on 2026-09-23 while re-running the Findlay OM (GOV-AVAIL1 / Q45).

## Measured

- The file is kept. Dia `sf_files` row 1747 (`USRenalMOB_Findlay_OH_OM_SB.pdf`, ContentVersion `068Vs000019XB2IIAW`) is `ingestion_status='stored'`, with its bytes in the `salesforce-files` bucket and a sha256. GOV-AVAIL1's "the file wasn't kept" was wrong for Salesforce files.
- The re-trigger path is to set `extraction_status='queued'`. The cron `sf-files-stage-queued-15m` then POSTs `intake-salesforce-files?action=stage-queued`, which calls LCC `/api/intake/stage-om`.
- Requeue #1 (14:20 UTC) came back `extract_failed` / `stage-om failed: inbox_item_insert_failed`.
- Cause: `api/_shared/intake-om-pipeline.js` (~379–425) keys the inbox card `external_id = om_sha256:<sha>`. The first pass's card (`9c2dc902…`) already holds that key under `inbox_items_workspace_external_id_unique (workspace_id, external_id) WHERE external_id IS NOT NULL`.
- The insert sends `Prefer: resolution=merge-duplicates` with **no `on_conflict`**. PostgREST therefore resolves on the primary key only, and the partial unique index raises. The dedup meant to stop a *second visible card* instead blocks *any* re-staging of the same file.
- Workaround used for Findlay: the old card's `external_id` got a `:superseded-20260923-gov-avail1` suffix (noted in its metadata), then a second requeue.

## Ask

1. A re-stage of an identical file (same sha256) should reuse the existing inbox card, not fail and not mint a second one. Do it with an explicit `on_conflict=workspace_id,external_id` upsert (check that PostgREST can target a partial index; if it can't, fall back to lookup-then-attach). Then continue the extraction and matching against a fresh `staged_intake_items` row, or the existing one. Say which, and why.
2. Keep the anti-duplicate-card guarantee. Two concurrent stages still produce one card.
3. Add a supported re-run path that doesn't need SQL. Candidates: an `intake-salesforce-files?action=requeue&content_version_id=…` (webhook-secret gated), or an Inbox-card "Re-extract" action that re-queues the file behind the card. Pick one and document it for Scott.
4. Tests: a re-stage of the same sha reuses the card and completes, concurrent double-stage gives one card, and the partial-index conflict is handled. Each needs a mutation that turns it red.

## Done means

- The backlog row is updated.
- Deploy = redeploy both Railway services, plus any edge-function change deployed to the Dialysis_DB project (say which).
- Cowork re-verifies by requeueing one already-extracted file.
