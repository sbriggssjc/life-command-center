// api/_handlers/intake-finalize-om.js
// Handler for copilot action: intake.finalize.om.v1
// Transitions the staged inbox_item from 'new' → 'triaged' for downstream processing.

import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';

export async function handleIntakeFinalizeOm({ inputs }) {
  if (!inputs?.staged_intake_item_id) {
    return { status: 400, body: { error: 'missing_staged_intake_item_id' } };
  }
  if (inputs.confirm_upload_complete !== true) {
    return { status: 400, body: { error: 'confirm_upload_complete must be true' } };
  }

  const itemId = inputs.staged_intake_item_id;

  // 1. Load item + current metadata (so we can merge, not overwrite)
  const itemSel = await opsQuery('GET',
    `inbox_items?id=eq.${pgFilterVal(itemId)}&select=id,status,workspace_id,domain,metadata&limit=1`
  );
  if (!itemSel.ok) {
    return { status: 500, body: { error: 'lookup_failed', detail: itemSel.data } };
  }
  if (!itemSel.data?.length) {
    return { status: 404, body: { error: 'inbox_item_not_found', staged_intake_item_id: itemId } };
  }
  const item = itemSel.data[0];

  // 2. Confirm at least one artifact is attached
  const artSel = await opsQuery('GET',
    `inbox_item_artifacts?inbox_item_id=eq.${pgFilterVal(itemId)}&select=id,storage_path,sha256&order=created_at.asc&limit=1`
  );
  if (!artSel.ok) {
    return { status: 500, body: { error: 'artifact_lookup_failed', detail: artSel.data } };
  }
  if (!artSel.data?.length) {
    return { status: 409, body: { error: 'no_artifact_found', detail: 'stage-om must be called before finalize-om' } };
  }
  const artifact = artSel.data[0];

  // 3. Merge finalization metadata with existing, transition status
  const mergedMeta = {
    ...(item.metadata || {}),
    finalized: {
      confirmed_at:   new Date().toISOString(),
      notes:          inputs.notes ?? null,
      intake_channel: inputs.intake_channel ?? null,
    },
  };

  const updRes = await opsQuery('PATCH',
    `inbox_items?id=eq.${pgFilterVal(itemId)}`,
    {
      status: 'triaged',
      triaged_at: new Date().toISOString(),
      metadata: mergedMeta,
      updated_at: new Date().toISOString(),
    }
  );
  if (!updRes.ok) {
    return { status: updRes.status || 500, body: { error: 'finalize_update_failed', detail: updRes.data } };
  }

  return {
    status: 200,
    body: {
      ok: true,
      status: 'queued',
      staged_intake_item_id: item.id,
      intake_artifact_id: artifact.id,
      processing_job_id: null, // populated once the extraction pipeline is wired up
    },
  };
}