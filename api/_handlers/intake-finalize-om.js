// api/_handlers/intake-finalize-om.js
// Handler for Copilot action: intake.finalize.om.v1
//
// Under the new inline-base64 pipeline (post 2026-04-21), stage-om already
// creates the inbox_items row, writes the staged_intake_* tables, and fires
// the extractor in a race with a timeout. So this "finalize" action is now
// an *idempotent status probe*: it flips inbox_items.status from 'new' to
// 'triaged', surfaces the current extraction status, and reports the
// matched entity_id (if any) for the agent to display.
//
// It returns cleanly even if called against an already-finalized item.

import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';

export async function handleIntakeFinalizeOm({ inputs }) {
  if (!inputs?.staged_intake_item_id) {
    return { status: 400, body: { error: 'missing_staged_intake_item_id' } };
  }
  if (inputs.confirm_upload_complete !== true) {
    return { status: 400, body: { error: 'confirm_upload_complete must be true' } };
  }

  const itemId = inputs.staged_intake_item_id;

  // 1. Load inbox_item + current metadata
  const itemSel = await opsQuery('GET',
    `inbox_items?id=eq.${pgFilterVal(itemId)}&select=id,status,workspace_id,domain,entity_id,metadata&limit=1`
  );
  if (!itemSel.ok) {
    return { status: 500, body: { error: 'lookup_failed', detail: itemSel.data } };
  }
  if (!itemSel.data?.length) {
    return { status: 404, body: { error: 'inbox_item_not_found', staged_intake_item_id: itemId } };
  }
  const item = itemSel.data[0];

  // 2. Confirm staged_intake row + at least one artifact
  const stagedSel = await opsQuery('GET',
    `staged_intake_items?intake_id=eq.${pgFilterVal(itemId)}&select=intake_id,status&limit=1`
  );
  if (!stagedSel.ok || !stagedSel.data?.length) {
    return {
      status: 409,
      body: {
        error: 'staged_intake_not_found',
        detail: 'stage-om must succeed before finalize-om can run.',
        hint: 'Verify intake.stage.om.v1 returned { ok: true, intake_id: ... }',
      },
    };
  }
  const staged = stagedSel.data[0];

  const artSel = await opsQuery('GET',
    `staged_intake_artifacts?intake_id=eq.${pgFilterVal(itemId)}&select=id&order=created_at.asc&limit=1`
  );
  if (!artSel.ok) {
    return { status: 500, body: { error: 'artifact_lookup_failed', detail: artSel.data } };
  }
  if (!artSel.data?.length) {
    return {
      status: 409,
      body: {
        error: 'no_artifact_found',
        detail: 'Staged intake has no artifacts — stage-om may have failed silently.',
      },
    };
  }

  // 3. Pull latest extraction (if any) to report status
  const extrSel = await opsQuery('GET',
    `staged_intake_extractions?intake_id=eq.${pgFilterVal(itemId)}` +
    `&select=extraction_snapshot,document_type,created_at&order=created_at.desc&limit=1`
  );
  const extraction = extrSel.ok && extrSel.data?.length ? extrSel.data[0] : null;
  const snapshot   = extraction?.extraction_snapshot || null;

  // 4. Merge finalize metadata and flip inbox_items.status if still 'new'
  const mergedMeta = {
    ...(item.metadata || {}),
    finalized: {
      confirmed_at:   new Date().toISOString(),
      notes:          inputs.notes ?? null,
      intake_channel: inputs.intake_channel ?? null,
    },
  };

  const patchBody = {
    metadata:    mergedMeta,
    updated_at:  new Date().toISOString(),
  };
  if (item.status === 'new') {
    patchBody.status     = 'triaged';
    patchBody.triaged_at = new Date().toISOString();
  }

  const updRes = await opsQuery('PATCH',
    `inbox_items?id=eq.${pgFilterVal(itemId)}`,
    patchBody,
  );
  if (!updRes.ok) {
    return { status: updRes.status || 500, body: { error: 'finalize_update_failed', detail: updRes.data } };
  }

  return {
    status: 200,
    body: {
      ok: true,
      status:                 staged.status === 'review_required' ? 'processing' : 'queued',
      staged_intake_item_id:  item.id,
      intake_id:              item.id,
      extraction_status:      staged.status,     // 'queued' | 'processing' | 'review_required' | 'failed'
      classified_domain:      snapshot?.domain || snapshot?.property_type_domain || null,
      matched_entity_id:      snapshot?.matched_entity_id || item.entity_id || null,
      message:
        staged.status === 'review_required'
          ? 'Extraction complete — ready for triage.'
          : staged.status === 'failed'
            ? 'Extraction failed — manual review required.'
            : 'Extraction in progress. Check back shortly.',
    },
  };
}
