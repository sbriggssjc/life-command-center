// ============================================================================
// SharePoint document extract — on-demand body fetch + intake handoff
// Life Command Center — Phase 2.5
// ----------------------------------------------------------------------------
// Phase 2's indexer landed metadata-only rows in `sharepoint_documents` with
// `extraction_status='pending'`. Phase 2.5 turns those into actual extracted
// content via a two-leg flow:
//
//   1. trigger — LCC POSTs to a PA webhook (`PA_SP_EXTRACT_URL`) with the
//      driveItem id + doc_type + caller identity. The doc's
//      `extraction_status` is flipped to 'queued' and we return 202.
//   2. PA flow does the actual download (delegated SP auth), routes to
//      whichever extractor fits the doc_type (OM, lease, comp, ...), and
//      lands the result in LCC's existing intake pipeline (e.g.
//      /api/intake-pdf or /api/intake-extract). PA then POSTs to the
//      callback below with { doc_id, status, intake_id?, error? }.
//   3. callback — updates `sharepoint_documents` with the outcome.
//
// LCC code never holds a SharePoint token. Same architectural pattern as
// the inbound bridges: PA owns the M365 connection, LCC orchestrates.
// ============================================================================

import { opsQuery, isOpsConfigured, pgFilterVal, fetchWithTimeout } from './ops-db.js';

const LCC_APP_BASE_URL = process.env.LCC_APP_BASE_URL || '';

async function fetchDoc(workspaceId, docId) {
  const r = await opsQuery('GET',
    `sharepoint_documents?id=eq.${pgFilterVal(docId)}` +
    `&workspace_id=eq.${pgFilterVal(workspaceId)}&limit=1`,
    null, { countMode: 'none' }
  );
  if (r.ok && r.data?.length) return r.data[0];
  return null;
}

/**
 * Trigger an extract for a single sharepoint_documents row.
 *
 * Returns { ok, status, doc_id, already?, error? }. The HTTP status is set
 * by the caller (route handler) from `status`. 202 means "accepted, PA is
 * doing the work"; 200 with `already=done|queued` means we returned the
 * cached state without re-firing.
 *
 * Pass `force=true` to re-trigger when extraction_status is already
 * 'queued' or 'done' — handy for the "Re-extract" button after a content
 * change.
 */
export async function triggerSharepointExtract({ workspaceId, docId, user, force = false }) {
  if (!isOpsConfigured()) return { ok: false, status: 503, error: 'ops_not_configured' };
  if (!workspaceId)       return { ok: false, status: 400, error: 'workspace_required' };
  if (!docId)             return { ok: false, status: 400, error: 'doc_id_required' };

  const doc = await fetchDoc(workspaceId, docId);
  if (!doc) return { ok: false, status: 404, error: 'doc_not_found' };

  // No-op for already-queued / already-done docs unless caller forces.
  if (!force && (doc.extraction_status === 'queued' || doc.extraction_status === 'done')) {
    return {
      ok: true, status: 200,
      doc_id: docId,
      already: doc.extraction_status,
      message: `Doc already ${doc.extraction_status} — pass force=1 to re-extract`
    };
  }

  // Per-bridge config — extract surface is on the
  // `sharepoint.properties.extract` bridge so its activation status, schedule
  // and write_policy follow the same lifecycle as the inbound bridges.
  const bridgeR = await opsQuery('GET',
    `connector_bridges?workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&bridge_key=eq.sharepoint.properties.extract&select=status,direction&limit=1`,
    null, { countMode: 'none' }
  );
  const bridge = bridgeR.ok && bridgeR.data?.[0];
  if (!bridge) return { ok: false, status: 404, error: 'bridge_not_seeded' };
  if (bridge.status !== 'active') {
    return {
      ok: false, status: 409,
      error: `bridge_status:${bridge.status}`,
      message: 'sharepoint.properties.extract is not active — set status=active to enable'
    };
  }

  const webhookUrl = process.env.PA_SP_EXTRACT_URL;
  if (!webhookUrl) {
    return { ok: false, status: 503, error: 'PA_SP_EXTRACT_URL_not_set' };
  }

  const callbackUrl = LCC_APP_BASE_URL
    ? `${LCC_APP_BASE_URL.replace(/\/+$/, '')}/api/sharepoint-extract-callback`
    : null;

  // Fire the PA webhook. PA acks immediately; the actual download +
  // extraction runs async in the flow and posts back to the callback.
  let webhookOk = false;
  let webhookErr = null;
  try {
    const r = await fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_id:             docId,
        workspace_id:       workspaceId,
        drive_id:           doc.drive_id,
        item_id:            doc.item_id,
        web_url:            doc.web_url,
        name:               doc.name,
        doc_type:           doc.doc_type,
        parent_path:        doc.parent_path,
        property_entity_id: doc.property_entity_id || null,
        tenant_entity_id:   doc.tenant_entity_id || null,
        tenant_name:        doc.tenant_name || null,
        callback_url:       callbackUrl,
        requested_by: {
          user_id: user?.id || null,
          email:   user?.email || null
        },
        requested_at: new Date().toISOString()
      })
    }, 10000);
    webhookOk = r.ok;
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      webhookErr = `pa_webhook_${r.status}: ${text.slice(0, 200)}`;
    }
  } catch (err) {
    webhookErr = `pa_webhook_threw: ${err?.message || String(err)}`;
  }

  if (!webhookOk) {
    // Mark error so the UI can surface a "retry" affordance instead of
    // leaving the doc stuck in 'pending'. The user can hit force=1 once
    // the underlying issue (PA flow down, env unset) is fixed.
    await opsQuery('PATCH',
      `sharepoint_documents?id=eq.${pgFilterVal(docId)}` +
      `&workspace_id=eq.${pgFilterVal(workspaceId)}`,
      {
        extraction_status: 'error',
        metadata: {
          ...(doc.metadata || {}),
          extract_error:        webhookErr,
          extract_error_at:     new Date().toISOString(),
          extract_requested_by: user?.id || null
        }
      }
    );
    return { ok: false, status: 502, error: webhookErr };
  }

  // Mark queued. Worker can sweep this back to 'pending' if the callback
  // hasn't landed within a configurable window (Phase 2.5.1 follow-up;
  // for now, manual recovery via SQL).
  await opsQuery('PATCH',
    `sharepoint_documents?id=eq.${pgFilterVal(docId)}` +
    `&workspace_id=eq.${pgFilterVal(workspaceId)}`,
    {
      extraction_status: 'queued',
      metadata: {
        ...(doc.metadata || {}),
        extract_requested_at: new Date().toISOString(),
        extract_requested_by: user?.id || null,
        extract_force:        !!force
      }
    }
  );

  return {
    ok: true, status: 202,
    doc_id: docId,
    status_was: doc.extraction_status,
    extraction_status: 'queued'
  };
}

/**
 * Callback endpoint payload handler. Called by PA after the extract
 * pipeline completes (or fails).
 *
 * Payload shape:
 *   {
 *     doc_id:             "<sharepoint_documents.id>",
 *     status:             "done" | "error" | "skipped",
 *     intake_id?:         "<staged_intake_promotions.id>",  // when piped to intake
 *     extracted_doc_type?: "om" | "lease" | ...,            // refinement of heuristic
 *     text_preview?:      "<first 500 chars>",              // for UI tooltip
 *     error?:             "<message>",                      // when status='error'
 *     extracted_at?:      ISO timestamp                     // defaults to now
 *   }
 */
export async function handleSharepointExtractCallback({ workspaceId, body }) {
  if (!isOpsConfigured()) return { ok: false, status: 503, error: 'ops_not_configured' };
  if (!workspaceId)       return { ok: false, status: 400, error: 'workspace_required' };

  const docId  = body?.doc_id;
  const status = body?.status;
  if (!docId)                                   return { ok: false, status: 400, error: 'doc_id_required' };
  if (!['done','error','skipped'].includes(status)) return { ok: false, status: 400, error: 'invalid_status' };

  const doc = await fetchDoc(workspaceId, docId);
  if (!doc) return { ok: false, status: 404, error: 'doc_not_found' };

  const update = {
    extraction_status: status,
    extracted_at:      body.extracted_at || new Date().toISOString()
  };

  // PA may refine the doc_type after reading the body (e.g. filename heuristic
  // said 'other' but the document is actually a lease). Honor the refinement.
  if (body.extracted_doc_type
      && body.extracted_doc_type !== doc.doc_type
      && /^(om|lease|comp|ownership_research|financial|marketing|other)$/.test(body.extracted_doc_type)) {
    update.doc_type = body.extracted_doc_type;
  }

  const meta = { ...(doc.metadata || {}) };
  if (body.intake_id)         meta.intake_id = body.intake_id;
  if (body.text_preview)      meta.text_preview = String(body.text_preview).slice(0, 500);
  if (body.extracted_doc_type) meta.refined_doc_type = body.extracted_doc_type;
  if (status === 'error') {
    meta.extract_error    = body.error || 'unspecified';
    meta.extract_error_at = new Date().toISOString();
  } else {
    // Clear stale error on a successful re-extract.
    delete meta.extract_error;
    delete meta.extract_error_at;
  }
  meta.extract_completed_at = update.extracted_at;
  update.metadata = meta;

  await opsQuery('PATCH',
    `sharepoint_documents?id=eq.${pgFilterVal(docId)}` +
    `&workspace_id=eq.${pgFilterVal(workspaceId)}`,
    update
  );

  return {
    ok: true, status: 200,
    doc_id: docId,
    extraction_status: status,
    intake_id: body.intake_id || null
  };
}
