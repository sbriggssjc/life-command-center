// api/_handlers/intake-stage-om.js
// Handler for Copilot action: intake.stage.om.v1
//
// This is now a thin adapter over the shared intake-om-pipeline. It maps the
// Copilot action's typed input envelope to the pipeline's cleaner signature
// and returns the richer result shape declared in copilot/openapi.yaml.
//
// All real work (user resolution, inbox_items insert, staged_intake bridge,
// extraction race, memory logging) lives in _shared/intake-om-pipeline.js.

import { stageOmIntake } from '../_shared/intake-om-pipeline.js';

/**
 * @param {object} args
 * @param {object} args.inputs       — IntakeStageOmInputs per openapi.yaml
 * @param {object} args.authContext  — { email, name, oid, tenant_id } from Copilot caller
 * @param {string} [args.workspaceId] — optional X-LCC-Workspace override
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleIntakeStageOm({ inputs, authContext, workspaceId }) {
  // ---- Envelope validation ------------------------------------------------
  if (!inputs || typeof inputs !== 'object') {
    return { status: 400, body: { error: 'missing_inputs' } };
  }
  if (!inputs.intake_source) {
    return { status: 400, body: { error: 'missing_intake_source' } };
  }
  if (!inputs.intake_channel) {
    return { status: 400, body: { error: 'missing_intake_channel' } };
  }

  const doc = inputs?.artifacts?.primary_document;
  if (!doc?.bytes_base64 && !doc?.data_uri && !doc?.storage_path) {
    return {
      status: 400,
      body: {
        error: 'missing_primary_document_bytes',
        detail: 'Provide artifacts.primary_document.bytes_base64, data_uri, or storage_path.',
      },
    };
  }

  // ---- Delegate to shared pipeline ----------------------------------------
  return stageOmIntake(
    {
      bytes_base64:     doc.bytes_base64 || null,
      data_uri:         doc.data_uri     || null,
      storage_path:     doc.storage_path || null,
      size_bytes:       doc.size_bytes   || null,
      file_name:        doc.file_name    || 'upload.pdf',
      mime_type:        doc.mime_type    || 'application/pdf',
      sha256:           doc.sha256       || null,
      channel:          inputs.intake_channel,
      note:             inputs.intent || null,
      entity_id:        inputs.seed_data?.entity_id || null,
      seed_data:        inputs.seed_data || null,
      copilot_metadata: inputs.copilot_metadata || null,
    },
    authContext,
    workspaceId,
  );
}
