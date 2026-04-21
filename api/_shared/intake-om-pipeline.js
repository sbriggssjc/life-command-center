// ============================================================================
// Intake OM Pipeline — shared worker for Copilot + email OM ingestion
// Life Command Center
//
// This is the canonical path for pushing a PDF (or other document) into the
// LCC intake pipeline. It is channel-agnostic: called by the Copilot action
// (intake.stage.om.v1), the email flagged-intake bridge, and any future
// uploader (Teams, Outlook plugin, sidebar).
//
// Contract:
//   stageOmIntake({ bytes_base64, file_name, ... }) →
//     1. Resolve / create the caller's public.users row (idempotent)
//     2. Ensure workspace_membership (operator)
//     3. Create an inbox_items row on LCC Opps with full metadata
//     4. Bridge to staged_intake_items + staged_intake_artifacts (LCC Opps)
//        using inline_data = base64 bytes
//     5. Fire processIntakeExtraction with a race timeout so the caller gets
//        a fast response while extraction + matching continues async
//     6. Log a copilot_action activity_event for the entity-scoped memory layer
//     7. Return a rich envelope: { ok, intake_id, status, extraction_status,
//        entity_match_status, matched_entity_id, message }
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';
import { logCopilotInteraction } from './memory.js';
import { processIntakeExtraction } from '../_handlers/intake-extractor.js';

const BRIGGSLAND_WORKSPACE_ID = 'a0000000-0000-0000-0000-000000000001';
const OM_INLINE_MAX_BYTES     = 25 * 1024 * 1024; // 25 MB (PVA + Copilot Chat cap)
const EXTRACT_RACE_MS         = 7000;             // keep under Vercel 10s timeout

/**
 * @typedef {object} StageOmInput
 * @property {string}  [bytes_base64]       — raw base64 PDF/doc bytes (EITHER this OR data_uri is required)
 * @property {string}  [data_uri]           — full data: URI. Server strips the prefix and populates bytes_base64.
 * @property {string}  file_name            — original filename inc. extension
 * @property {string}  [mime_type]          — defaults to 'application/pdf'
 * @property {string}  [sha256]             — optional integrity hash
 * @property {string}  [note]               — free-text caller intent
 * @property {string}  [entity_id]          — optional pre-link to a property/contact
 * @property {('copilot_chat'|'outlook'|'teams'|'sidebar'|'email')} channel
 * @property {object}  [seed_data]          — pre-extracted property hints (optional)
 * @property {object}  [copilot_metadata]   — Copilot conversation context
 */

/**
 * @typedef {object} AuthContext
 * @property {string} email     — caller email (required)
 * @property {string} [name]
 * @property {string} [oid]
 * @property {string} [tenant_id]
 */

/**
 * Run the full OM intake pipeline. Idempotent-ish: safe to call once per
 * upload. Duplicate detection is deferred to the matcher (content-hashed).
 *
 * @param {StageOmInput} input
 * @param {AuthContext}  auth
 * @param {string}       [workspaceId]  — defaults to Briggsland single-tenant
 * @returns {Promise<{status:number, body:object}>}
 */
export async function stageOmIntake(input, auth, workspaceId) {
  // ---- 0a. Accept a data URI as an alternate to bytes_base64 —
  //     lets Copilot Studio topics forward System.Activity.Attachments[1].ContentUrl
  //     straight through without any Power Fx string-splitting on the client side.
  if (input?.data_uri && typeof input.data_uri === 'string' && !input.bytes_base64) {
    const dataUri = input.data_uri;
    const commaIdx = dataUri.indexOf(',');
    if (dataUri.startsWith('data:') && commaIdx > 0) {
      input = {
        ...input,
        bytes_base64: dataUri.slice(commaIdx + 1),
      };
      // Pick up mime type from the data URI header if not already set
      if (!input.mime_type) {
        const header = dataUri.slice(5, commaIdx);          // e.g. "application/pdf;base64"
        const semiIdx = header.indexOf(';');
        const mime = semiIdx > 0 ? header.slice(0, semiIdx) : header;
        if (mime) input.mime_type = mime;
      }
    } else {
      return {
        status: 400,
        body: {
          error: 'invalid_data_uri',
          detail: 'data_uri must start with "data:" and contain a comma separator.',
        },
      };
    }
  }

  // ---- 0b. Validate bytes_base64 (after data-URI unwrap)
  if (!input?.bytes_base64 || typeof input.bytes_base64 !== 'string') {
    return { status: 400, body: { error: 'missing_bytes_base64', detail: 'bytes_base64 (or data_uri) is required' } };
  }
  if (!input?.file_name || typeof input.file_name !== 'string') {
    return { status: 400, body: { error: 'missing_file_name', detail: 'file_name (string) is required' } };
  }
  if (!input?.channel) {
    return { status: 400, body: { error: 'missing_channel', detail: 'channel is required (copilot_chat|outlook|teams|sidebar|email)' } };
  }

  const bytesLen = Math.ceil((input.bytes_base64.length * 3) / 4);
  if (bytesLen > OM_INLINE_MAX_BYTES) {
    return {
      status: 413,
      body: {
        error: 'file_too_large',
        detail: `Inline OM payload must be ≤ ${OM_INLINE_MAX_BYTES} bytes (~25MB). Received ~${bytesLen}.`,
        hint: 'For larger files, use the future presigned-upload action (not yet enabled).',
      },
    };
  }

  const callerEmail  = (auth?.email || '').toLowerCase();
  if (!callerEmail) {
    return { status: 401, body: { error: 'missing_caller_identity', detail: 'auth.email is required' } };
  }
  const callerName   = auth?.name ?? callerEmail;
  const callerOid    = auth?.oid ?? null;
  const callerTenant = auth?.tenant_id ?? null;

  const wsId = workspaceId || BRIGGSLAND_WORKSPACE_ID;

  // ---- 1. Resolve caller → public.users (select-then-insert, idempotent)
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

  // ---- 2. Ensure workspace_membership (operator)
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

  // ---- 3. Per-channel connector row (unique by ws+user+type+external_user_id)
  let connectorId = null;
  const connectorType = input.channel === 'email' ? 'outlook' : input.channel;
  {
    const sel = await opsQuery('GET',
      `connector_accounts?workspace_id=eq.${wsId}` +
      `&user_id=eq.${pgFilterVal(user.id)}` +
      `&connector_type=eq.${pgFilterVal(connectorType)}` +
      `&external_user_id=eq.${pgFilterVal(callerEmail)}` +
      `&select=id&limit=1`
    );
    if (sel.ok && sel.data?.length) {
      connectorId = sel.data[0].id;
    } else {
      const ins = await opsQuery('POST', 'connector_accounts', {
        workspace_id: wsId,
        user_id: user.id,
        connector_type: connectorType,
        execution_method: 'direct_api',
        display_name: connectorType === 'copilot_chat'
          ? 'Copilot Studio — Deal Agent'
          : connectorType,
        status: 'healthy',
        external_user_id: callerEmail,
      });
      if (ins.ok) {
        const row = Array.isArray(ins.data) ? ins.data[0] : ins.data;
        connectorId = row?.id ?? null;
      }
    }
  }

  // ---- 4. Compose the inbox_items title
  const property  = input.seed_data?.property;
  const addrCity  = property?.address?.city  ?? null;
  const addrState = property?.address?.state ?? null;
  const title = property?.name
    ? `OM: ${property.name}${addrCity ? ` (${addrCity}${addrState ? `, ${addrState}` : ''})` : ''}`
    : `OM: ${input.file_name}`;

  // Body = short human-readable preview (note + file) — NOT the full text
  const body = input.note && input.note.trim()
    ? input.note.trim()
    : `Uploaded via ${input.channel}. Filename: ${input.file_name}. Awaiting extraction.`;

  const mimeType = input.mime_type || 'application/pdf';
  const fileExt  = (input.file_name.split('.').pop() || '').toLowerCase() || null;

  // ---- 5. Validate optional entity_id belongs to workspace
  let validatedEntityId = null;
  if (input.entity_id) {
    if (!/^[0-9a-fA-F-]{36}$/.test(input.entity_id)) {
      return { status: 400, body: { error: 'invalid_entity_id', detail: 'entity_id must be a UUID' } };
    }
    const entRes = await opsQuery('GET',
      `entities?id=eq.${pgFilterVal(input.entity_id)}&workspace_id=eq.${pgFilterVal(wsId)}&select=id&limit=1`
    );
    if (!entRes.ok || !entRes.data?.length) {
      return { status: 400, body: { error: 'entity_not_in_workspace', entity_id: input.entity_id } };
    }
    validatedEntityId = input.entity_id;
  }

  // ---- 6. Insert inbox_items (canonical intake row on LCC Opps)
  const nowIso = new Date().toISOString();
  const itemPayload = {
    workspace_id:        wsId,
    source_user_id:      user.id,
    assigned_to:         user.id,
    source_type:         `${input.channel}_om`,           // e.g. 'copilot_chat_om', 'email_om'
    source_connector_id: connectorId,
    title,
    body,
    visibility:          'private',
    status:              'new',
    priority:            'normal',
    entity_id:           validatedEntityId,
    tags: Array.isArray(input.seed_data?.tags) ? input.seed_data.tags : [],
    metadata: {
      event_source:  'intake_om_pipeline',
      channel:       input.channel,
      file_name:     input.file_name,
      mime_type:     mimeType,
      size_bytes:    bytesLen,
      sha256:        input.sha256 ?? null,
      note:          input.note ?? null,
      seed_data:     input.seed_data ?? null,
      copilot: input.copilot_metadata
        ? {
            conversation_id: input.copilot_metadata.conversation_id ?? null,
            message_id:      input.copilot_metadata.message_id ?? null,
            run_id:          input.copilot_metadata.run_id ?? null,
            model:           input.copilot_metadata.model ?? null,
          }
        : null,
      caller: { email: callerEmail, oid: callerOid, tenant_id: callerTenant },
      ingested_at: nowIso,
    },
    received_at: nowIso,
  };

  const itemRes = await opsQuery('POST', 'inbox_items', itemPayload, {
    Prefer: 'return=representation',
  });
  if (!itemRes.ok) {
    return {
      status: itemRes.status || 500,
      body: { error: 'inbox_item_insert_failed', detail: itemRes.data },
    };
  }
  const item = Array.isArray(itemRes.data) ? itemRes.data[0] : itemRes.data;
  const inboxItemId = item?.id;

  // ---- 7. Bridge to staged_intake_items + staged_intake_artifacts on LCC Opps
  //     intake_id reuses inbox_items.id for 1:1 correlation.
  const stageRes = await opsQuery('POST', 'staged_intake_items', {
    intake_id:           inboxItemId,
    workspace_id:        wsId,
    source_type:         input.channel === 'email' ? 'email' : 'copilot',
    internet_message_id: null,
    status:              'queued',
    raw_payload: {
      file_name:     input.file_name,
      inbox_item_id: inboxItemId,
      channel:       input.channel,
      seed_data:     input.seed_data ?? null,
      copilot:       input.copilot_metadata ?? null,
    },
  });

  if (!stageRes.ok) {
    // Roll back the inbox_item to avoid orphans.
    await opsQuery('DELETE', `inbox_items?id=eq.${pgFilterVal(inboxItemId)}`);
    return {
      status: stageRes.status || 500,
      body: {
        error: 'staged_intake_insert_failed',
        detail: stageRes.data,
        hint: 'Verify migration 037_staged_intake_on_lcc_opps.sql has been applied.',
      },
    };
  }

  const artRes = await opsQuery('POST', 'staged_intake_artifacts', {
    intake_id:    inboxItemId,
    file_name:    input.file_name,
    file_type:    fileExt,
    mime_type:    mimeType,
    inline_data:  input.bytes_base64,
    size_bytes:   bytesLen,
    sha256:       input.sha256 ?? null,
  });
  if (!artRes.ok) {
    await opsQuery('DELETE', `staged_intake_items?intake_id=eq.${pgFilterVal(inboxItemId)}`);
    await opsQuery('DELETE', `inbox_items?id=eq.${pgFilterVal(inboxItemId)}`);
    return {
      status: artRes.status || 500,
      body: { error: 'staged_intake_artifact_insert_failed', detail: artRes.data },
    };
  }

  // ---- 8. Fire extraction + matching with a race timeout
  //     Whichever finishes first wins: either we return real classification,
  //     or we return 'queued' and the pipeline continues asynchronously.
  let extractionResult = null;
  let raceTimedOut     = false;
  try {
    const extraction = processIntakeExtraction(inboxItemId)
      .catch((err) => {
        console.error('[intake-om-pipeline] extraction failed:', inboxItemId, err?.message);
        return { ok: false, extraction_snapshot: null, error: err?.message || 'extraction_error' };
      });

    const timeout = new Promise((resolve) => setTimeout(() => {
      raceTimedOut = true;
      resolve({ ok: null, extraction_snapshot: null, timedOut: true });
    }, EXTRACT_RACE_MS));

    extractionResult = await Promise.race([extraction, timeout]);
  } catch (err) {
    console.error('[intake-om-pipeline] race error:', inboxItemId, err?.message);
    extractionResult = { ok: false, extraction_snapshot: null, error: 'race_error' };
  }

  const extractionStatus = raceTimedOut
    ? 'processing'
    : (extractionResult?.extraction_snapshot ? 'review_required' : 'failed');

  const snapshot   = extractionResult?.extraction_snapshot || null;
  const classifiedDomain = snapshot?.domain
    ?? snapshot?.property_type_domain
    ?? null;
  const matchedEntityId  = snapshot?.matched_entity_id
    ?? null;

  // ---- 9. Log activity_event for entity-scoped memory
  try {
    await logCopilotInteraction({
      workspaceId: wsId,
      actorId:     user.id,
      entityId:    matchedEntityId || validatedEntityId || null,
      channel:     input.channel,
      actionId:    'intake.stage.om.v1',
      summary:     `Staged OM "${input.file_name}" via ${input.channel} (${extractionStatus})`,
      turnText:    input.note ?? null,
      metadata: {
        inbox_item_id:     inboxItemId,
        intake_id:         inboxItemId,
        file_name:         input.file_name,
        size_bytes:        bytesLen,
        extraction_status: extractionStatus,
        classified_domain: classifiedDomain,
      },
      inboxItemId,
    });
  } catch (err) {
    // Non-fatal — memory logging never blocks ingestion.
    console.error('[intake-om-pipeline] memory log failed:', err?.message);
  }

  return {
    status: 200,
    body: {
      ok: true,
      status:               extractionStatus === 'processing' ? 'received' : 'received',
      intake_id:            inboxItemId,
      staged_intake_item_id: inboxItemId,     // alias for backwards compatibility
      inbox_item_id:        inboxItemId,
      extraction_status:    extractionStatus,  // 'processing' | 'review_required' | 'failed'
      classified_domain:    classifiedDomain,
      matched_entity_id:    matchedEntityId,
      entity_match_status:  matchedEntityId ? 'matched' : (snapshot ? 'unmatched' : 'pending'),
      size_bytes:           bytesLen,
      message: buildMessage({
        fileName: input.file_name,
        extractionStatus,
        classifiedDomain,
        matchedEntityId,
      }),
    },
  };
}

function buildMessage({ fileName, extractionStatus, classifiedDomain, matchedEntityId }) {
  if (extractionStatus === 'processing') {
    return `Received "${fileName}" and kicked off extraction. Check back in ~30s for classification and property match.`;
  }
  if (extractionStatus === 'failed') {
    return `Received "${fileName}" but could not extract deal data. Flagged for manual triage.`;
  }
  // review_required
  const dom = classifiedDomain ? ` (${classifiedDomain})` : '';
  const match = matchedEntityId ? ' Matched to an existing property.' : ' No property match yet — awaiting triage.';
  return `Staged "${fileName}"${dom}.${match}`;
}
