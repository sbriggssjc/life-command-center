// api/_handlers/intake-finalize-om.js
// Handler for copilot action: intake.finalize.om.v1
// Confirms staged_intake_item is uploaded and transitions it into the triage queue.

import { createClient } from '@supabase/supabase-js';

let _lccOpps = null;
function lccOpps() {
  if (_lccOpps) return _lccOpps;
  const url = process.env.LCC_OPPS_SUPABASE_URL;
  const key = process.env.LCC_OPPS_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing LCC_OPPS_SUPABASE_URL or LCC_OPPS_SERVICE_ROLE_KEY');
  _lccOpps = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _lccOpps;
}

export async function handleIntakeFinalizeOm({ inputs }) {
  const sb = lccOpps();

  if (!inputs?.staged_intake_item_id) {
    return { status: 400, body: { error: 'missing_staged_intake_item_id' } };
  }
  if (inputs.confirm_upload_complete !== true) {
    return { status: 400, body: { error: 'confirm_upload_complete must be true' } };
  }

  const itemId = inputs.staged_intake_item_id;

  // 1. Confirm the inbox_item exists + has at least one artifact.
  const { data: item, error: itemErr } = await sb
    .from('inbox_items')
    .select('id, status, workspace_id, domain')
    .eq('id', itemId)
    .maybeSingle();
  if (itemErr)      return { status: 500, body: { error: 'lookup_failed', detail: itemErr.message } };
  if (!item)        return { status: 404, body: { error: 'inbox_item_not_found', staged_intake_item_id: itemId } };

  const { data: artifact, error: artErr } = await sb
    .from('inbox_item_artifacts')
    .select('id, storage_path, sha256')
    .eq('inbox_item_id', itemId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (artErr)       return { status: 500, body: { error: 'artifact_lookup_failed', detail: artErr.message } };
  if (!artifact)    return { status: 409, body: { error: 'no_artifact_found', detail: 'stage-om must be called before finalize-om' } };

  // 2. Transition status from 'new' to 'triaged' and record finalization metadata.
  const { data: updated, error: updErr } = await sb
    .from('inbox_items')
    .update({
      status: 'triaged',
      triaged_at: new Date().toISOString(),
      metadata: {
        finalized: {
          confirmed_at: new Date().toISOString(),
          notes: inputs.notes ?? null,
          intake_channel: inputs.intake_channel ?? null,
        },
      },
    })
    .eq('id', itemId)
    .select('id')
    .single();
  if (updErr)       return { status: 500, body: { error: 'finalize_update_failed', detail: updErr.message } };

  return {
    status: 200,
    body: {
      ok: true,
      status: 'queued',
      staged_intake_item_id: updated.id,
      intake_artifact_id: artifact.id,
      processing_job_id: null, // populated once extraction pipeline is wired up
    },
  };
}