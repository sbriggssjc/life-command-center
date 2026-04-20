// api/_handlers/intake-stage-om.js
// Handler for copilot action: intake.stage.om.v1
// Writes to LCC Opps via opsQuery. Replaces the legacy dialysis staged_intake_items path.

import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';

const BRIGGSLAND_WORKSPACE_ID = 'a0000000-0000-0000-0000-000000000001';
const VALID_DOMAINS = new Set(['dialysis', 'government', 'netlease']);

/**
 * @param {object} args
 * @param {object} args.inputs       - IntakeStageOmInputs per swagger
 * @param {object} args.authContext  - { email, name, oid, tenant_id } from Copilot caller
 * @param {string} [args.workspaceId] - Optional X-LCC-Workspace override
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleIntakeStageOm({ inputs, authContext, workspaceId }) {
  // ---- 1. Validate inputs
  if (!inputs?.artifacts?.primary_document?.file_id) {
    return { status: 400, body: { error: 'missing_primary_document', detail: 'inputs.artifacts.primary_document.file_id required' } };
  }
  if (!inputs?.intake_channel) {
    return { status: 400, body: { error: 'missing_intake_channel' } };
  }

  const callerEmail  = authContext?.email?.toLowerCase();
  const callerName   = authContext?.name ?? callerEmail ?? 'Copilot User';
  const callerOid    = authContext?.oid ?? null;
  const callerTenant = authContext?.tenant_id ?? null;

  if (!callerEmail) {
    return { status: 401, body: { error: 'missing_caller_identity', detail: 'Copilot auth context must include caller email/UPN' } };
  }

  const wsId = workspaceId || BRIGGSLAND_WORKSPACE_ID;

  // ---- 2. Resolve Microsoft caller → public.users (select-then-insert, idempotent)
  let user;
  {
    const sel = await opsQuery('GET',
      `users?email=eq.${pgFilterVal(callerEmail)}&select=id,email,display_name&limit=1`
    );
    if (sel.ok && sel.data?.length) {
      user = sel.data[0];
    } else {
      const ins = await opsQuery('POST', 'users', {
        email: callerEmail,
        display_name: callerName,
        is_active: true,
      });
      if (ins.ok) {
        user = Array.isArray(ins.data) ? ins.data[0] : ins.data;
      } else {
        // Race on unique(email) → retry SELECT
        const retry = await opsQuery('GET',
          `users?email=eq.${pgFilterVal(callerEmail)}&select=id,email,display_name&limit=1`
        );
        if (!retry.ok || !retry.data?.length) {
          return { status: 500, body: { error: 'user_upsert_failed', detail: ins.data } };
        }
        user = retry.data[0];
      }
    }
  }

  // ---- 3. Ensure workspace_membership (operator)
  {
    const sel = await opsQuery('GET',
      `workspace_memberships?workspace_id=eq.${wsId}&user_id=eq.${pgFilterVal(user.id)}&select=id&limit=1`
    );
    if (!sel.ok || !sel.data?.length) {
      const ins = await opsQuery('POST', 'workspace_memberships', {
        workspace_id: wsId,
        user_id: user.id,
        role: 'operator',
      });
      if (!ins.ok && ins.status !== 409) {
        return { status: 500, body: { error: 'membership_upsert_failed', detail: ins.data } };
      }
    }
  }

  // ---- 4. Per-user Copilot connector row (unique by ws+user+type+external_user_id)
  let connectorId = null;
  {
    const sel = await opsQuery('GET',
      `connector_accounts?workspace_id=eq.${wsId}` +
      `&user_id=eq.${pgFilterVal(user.id)}` +
      `&connector_type=eq.copilot` +
      `&external_user_id=eq.${pgFilterVal(callerEmail)}` +
      `&select=id&limit=1`
    );
    if (sel.ok && sel.data?.length) {
      connectorId = sel.data[0].id;
    } else {
      const ins = await opsQuery('POST', 'connector_accounts', {
        workspace_id: wsId,
        user_id: user.id,
        connector_type: 'copilot',
        execution_method: 'direct_api',
        display_name: 'Copilot Studio — Deal Agent',
        status: 'healthy',
        external_user_id: callerEmail,
      });
      if (ins.ok) {
        const row = Array.isArray(ins.data) ? ins.data[0] : ins.data;
        connectorId = row?.id ?? null;
      } else if (ins.status !== 409) {
        return { status: 500, body: { error: 'connector_upsert_failed', detail: ins.data } };
      }
    }
  }

  // ---- 5. Resolve target domain
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
        detail: 'Copilot payload must include domain of dialysis | government | netlease in seed_data.domain or tags',
      },
    };
  }
  const domain = rawDomain;

  // ---- 6. Compose + insert inbox_item
  const property  = inputs.seed_data?.property;
  const addrCity  = property?.address?.city  ?? null;
  const addrState = property?.address?.state ?? null;
  const title = property?.name
    ? `OM: ${property.name}${addrCity ? ` (${addrCity}${addrState ? `, ${addrState}` : ''})` : ''}`
    : `OM from Copilot (${inputs.intake_channel})`;

  const itemPayload = {
    workspace_id:        wsId,
    source_user_id:      user.id,
    source_type:         'copilot_om',
    source_connector_id: connectorId,
    title,
    body:                inputs.intent ?? null,
    domain,
    visibility:          'private',
    status:              'new',
    priority:            'normal',
    tags: Array.isArray(inputs.seed_data?.tags) ? inputs.seed_data.tags : [],
    metadata: {
      event_source:  'copilot_studio',
      channel:       inputs.intake_channel,
      intake_source: inputs.intake_source,
      intent:        inputs.intent ?? null,
      seed_data:     inputs.seed_data ?? null,
      copilot: {
        conversation_id: inputs.copilot_metadata?.conversation_id ?? null,
        message_id:      inputs.copilot_metadata?.message_id ?? null,
        run_id:          inputs.copilot_metadata?.run_id ?? null,
        model:           inputs.copilot_metadata?.model ?? null,
      },
      caller: { email: callerEmail, oid: callerOid, tenant_id: callerTenant },
    },
  };

  const itemRes = await opsQuery('POST', 'inbox_items', itemPayload);
  if (!itemRes.ok) {
    return { status: itemRes.status || 500, body: { error: 'inbox_item_insert_failed', detail: itemRes.data } };
  }
  const item = Array.isArray(itemRes.data) ? itemRes.data[0] : itemRes.data;

  // ---- 7. Attach primary document
  const doc = inputs.artifacts.primary_document;
  const ext = (doc.file_name?.split('.').pop() || '').toLowerCase() || null;

  const artRes = await opsQuery('POST', 'inbox_item_artifacts', {
    workspace_id:  wsId,
    inbox_item_id: item.id,
    file_id:       doc.file_id,
    file_name:     doc.file_name,
    file_type:     ext,
    storage_path:  doc.storage_path,
    sha256:        doc.sha256 ?? null,
    metadata:      { uploaded_via: 'copilot_stage_om' },
  });
  if (!artRes.ok) {
    // Roll back the inbox_item to avoid orphans
    await opsQuery('DELETE', `inbox_items?id=eq.${pgFilterVal(item.id)}`);
    return { status: artRes.status || 500, body: { error: 'artifact_insert_failed', detail: artRes.data } };
  }

  return {
    status: 200,
    body: {
      ok: true,
      status: 'received',
      staged_intake_item_id: item.id,
      upload_url: null,
      upload_expires_at: null,
      upload_method: null,
      max_bytes: 50 * 1024 * 1024,
    },
  };
}