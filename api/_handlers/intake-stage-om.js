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

  // --- Bug E fix (2026-04-24): reject inline email-signature graphics ----
  // The flagged-email PA flow fires one stage-om call per attachment, so
  // every flagged email that has an inline signature logo produces a
  // noise row in staged_intake_items. Audit 2026-04-24 found 60% of
  // recent email intake queue was these images. Two signals used:
  //   (a) mime_type starts with 'image/' (PDFs/docx are the real OMs),
  //   (b) file_name matches the well-known signature patterns.
  const mimeType = String(doc.mime_type || '').toLowerCase();
  const fileName = String(doc.file_name || '').trim();
  const isImageMime = mimeType.startsWith('image/');
  const isSignaturePattern =
    /^image\d+\.(png|jpg|jpeg|gif)$/i.test(fileName) ||
    /^outlook-logo/i.test(fileName) ||
    /^signature/i.test(fileName);
  if (isImageMime && isSignaturePattern) {
    return {
      status: 200,
      body: {
        ok: false,
        skipped: 'noise_attachment',
        detail: `Rejected ${fileName} (${mimeType}) — appears to be an email signature graphic, not an OM.`,
      },
    };
  }
  // Also reject image-only attachments even without the signature pattern —
  // OMs are always PDF or docx in practice. A loose image with no telltale
  // name may be a property photo attached separately; still not a stage-able
  // document.
  if (isImageMime) {
    return {
      status: 200,
      body: {
        ok: false,
        skipped: 'unsupported_attachment_type',
        detail: `Rejected ${fileName || 'unnamed'} (${mimeType}) — stage-om only accepts PDF/docx OMs.`,
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
