// api/_handlers/intake-stage-om.js
// Handler for copilot action: intake.stage.om.v1
// Writes to LCC Opps (xengecqvemvfknjvbvrq).
// Replaces the legacy dialysis-targeted staged_intake_items path.

import { createClient } from '@supabase/supabase-js';

const BRIGGSLAND_WORKSPACE_ID = 'a0000000-0000-0000-0000-000000000001';
const VALID_DOMAINS = new Set(['dialysis', 'government', 'netlease']);

let _lccOpps = null;
function lccOpps() {
  if (_lccOpps) return _lccOpps;
  const url = process.env.LCC_OPPS_SUPABASE_URL;
  const key = process.env.LCC_OPPS_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing LCC_OPPS_SUPABASE_URL or LCC_OPPS_SERVICE_ROLE_KEY');
  }
  _lccOpps = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _lccOpps;
}

/**
 * @param {object} args
 * @param {object} args.inputs       - IntakeStageOmInputs from the swagger
 * @param {object} args.authContext  - { email, name, oid, tenant_id } from Copilot caller
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleIntakeStageOm({ inputs, authContext }) {
  const sb = lccOpps();

  // ---- 1. Validate inputs up front so we fail fast with a useful message.
  if (!inputs?.artifacts?.primary_document?.file_id) {
    return { status: 400, body: { error: 'missing_primary_document', detail: 'inputs.artifacts.primary_document.file_id required' } };
  }
  if (!inputs?.intake_channel) {
    return { status: 400, body: { error: 'missing_intake_channel' } };
  }

  const callerEmail = authContext?.email?.toLowerCase();
  const callerName  = authContext?.name ?? callerEmail ?? 'Copilot User';
  const callerOid   = authContext?.oid ?? null;
  const callerTenant = authContext?.tenant_id ?? null;

  if (!callerEmail) {
    return { status: 401, body: { error: 'missing_caller_identity', detail: 'Copilot auth context must include caller email/UPN' } };
  }

  // ---- 2. Resolve (or create) the Microsoft caller in public.users.
  const { data: user, error: userErr } = await sb
    .from('users')
    .upsert(
      { email: callerEmail, display_name: callerName, is_active: true },
      { onConflict: 'email' }
    )
    .select('id, email, display_name')
    .single();
  if (userErr) {
    return { status: 500, body: { error: 'user_upsert_failed', detail: userErr.message } };
  }

  // ---- 3. Ensure the caller is a workspace operator in Briggs CRE.
  const { error: memErr } = await sb
    .from('workspace_memberships')
    .upsert(
      { workspace_id: BRIGGSLAND_WORKSPACE_ID, user_id: user.id, role: 'operator' },
      { onConflict: 'workspace_id,user_id', ignoreDuplicates: true }
    );
  if (memErr) {
    return { status: 500, body: { error: 'membership_upsert_failed', detail: memErr.message } };
  }

  // ---- 4. Per-user Copilot connector row (one per workspace+user+connector_type+external_user_id).
  const { data: connector, error: connErr } = await sb
    .from('connector_accounts')
    .upsert(
      {
        workspace_id: BRIGGSLAND_WORKSPACE_ID,
        user_id: user.id,
        connector_type: 'copilot',
        execution_method: 'direct_api',
        display_name: 'Copilot Studio — Deal Agent',
        status: 'healthy',
        external_user_id: callerEmail,
      },
      { onConflict: 'workspace_id,user_id,connector_type,external_user_id' }
    )
    .select('id')
    .single();
  if (connErr) {
    return { status: 500, body: { error: 'connector_upsert_failed', detail: connErr.message } };
  }

  // ---- 5. Resolve the target domain.
  const rawDomain =
    inputs.seed_data?.domain ??
    inputs.tags?.find((t) => VALID_DOMAINS.has(t)) ??
    inputs.seed_data?.tags?.find((t) => VALID_DOMAINS.has(t)) ??
    null;

  if (!rawDomain || !VALID_DOMAINS.has(rawDomain)) {
    return {
      status: 400,
      body: {
        error: 'missing_or_invalid_domain',
        detail: 'Copilot payload must include a domain of dialysis | government | netlease in seed_data.domain or tags',
      },
    };
  }
  const domain = rawDomain;

  // ---- 6. Compose the inbox_item.
  const property = inputs.seed_data?.property;
  const addrCity  = property?.address?.city  ?? null;
  const addrState = property?.address?.state ?? null;
  const title = property?.name
    ? `OM: ${property.name}${addrCity ? ` (${addrCity}${addrState ? `, ${addrState}` : ''})` : ''}`
    : `OM from Copilot (${inputs.intake_channel})`;

  const itemPayload = {
    workspace_id:        BRIGGSLAND_WORKSPACE_ID,
    source_user_id:      user.id,
    source_type:         'copilot_om',
    source_connector_id: connector?.id ?? null,
    title,
    body:                inputs.intent ?? null,
    domain,
    visibility:          'private',
    status:              'new',
    priority:            'normal',
    tags:                Array.isArray(inputs.seed_data?.tags) ? inputs.seed_data.tags : [],
    metadata: {
      event_source: 'copilot_studio',
      channel:      inputs.intake_channel,
      intake_source: inputs.intake_source,
      intent:       inputs.intent ?? null,
      seed_data:    inputs.seed_data ?? null,
      copilot: {
        conversation_id: inputs.copilot_metadata?.conversation_id ?? null,
        message_id:      inputs.copilot_metadata?.message_id ?? null,
        run_id:          inputs.copilot_metadata?.run_id ?? null,
        model:           inputs.copilot_metadata?.model ?? null,
      },
      caller: { email: callerEmail, oid: callerOid, tenant_id: callerTenant },
    },
  };

  const { data: item, error: itemErr } = await sb
    .from('inbox_items')
    .insert(itemPayload)
    .select('id')
    .single();
  if (itemErr) {
    return { status: 500, body: { error: 'inbox_item_insert_failed', detail: itemErr.message } };
  }

  // ---- 7. Attach the primary document.
  const doc = inputs.artifacts.primary_document;
  const ext = (doc.file_name?.split('.').pop() || '').toLowerCase() || null;

  const { data: artifact, error: artErr } = await sb
    .from('inbox_item_artifacts')
    .insert({
      workspace_id:  BRIGGSLAND_WORKSPACE_ID,
      inbox_item_id: item.id,
      file_id:       doc.file_id,
      file_name:     doc.file_name,
      file_type:     ext,
      storage_path:  doc.storage_path,
      sha256:        doc.sha256 ?? null,
      metadata:      { uploaded_via: 'copilot_stage_om' },
    })
    .select('id')
    .single();
  if (artErr) {
    // Roll back the inbox_item so we don't leave orphans.
    await sb.from('inbox_items').delete().eq('id', item.id);
    return { status: 500, body: { error: 'artifact_insert_failed', detail: artErr.message } };
  }

  // ---- 8. Return IntakeStageOmResponse (per swagger).
  return {
    status: 200,
    body: {
      ok: true,
      status: 'received',
      staged_intake_item_id: item.id,
      // No presigned upload flow yet; the PDF is expected to already be at storage_path.
      upload_url: null,
      upload_expires_at: null,
      upload_method: null,
      max_bytes: 50 * 1024 * 1024,
    },
  };
}