// ============================================================================
// Folder-Feed light attach — connect ALL recognized doc types by path anchor
// Life Command Center · Phase 2, Slice 2d (Unit 2)
//
// Slice 2a only STAGED OM/flyer PDFs (extract → match → enrich). Every other
// recognized working doc in a PROPERTIES folder (lease / BOV / DD / master /
// comp) was classified and then SKIPPED, so the most valuable docs never became
// part of the connected object. This module is the LIGHT path that fixes that:
//
//   resolve the property by the PATH ANCHOR ALONE (subject_hint tenant_brand +
//   City, ST + vertical) — no AI extraction — and on a confident, unambiguous
//   match attach the doc as a <domain>.property_documents row + write provenance.
//   Fill-blanks-only; never creates a property, listing, sale, or contact.
//
//   An unresolved / ambiguous file routes to the EXISTING match_disambiguation
//   decision lane (keyed on the server-relative path), never a guess, never a
//   create. unknown / lcc_generated files are not attached (the caller skips
//   them before reaching here).
//
// OMs/flyers still go through the Slice-2a stage→extract→enrich path; only the
// non-OM recognized types use this attach-only path.
// ============================================================================

import { matchByPathAnchor, emitMatchDisambiguation } from './intake-matcher.js';
import { attachEnrichDocument } from './intake-promoter.js';
import { opsQuery } from '../_shared/ops-db.js';

// Record provenance for the attached doc through the shared registry, tagged
// source='folder_feed_properties' (priority 50, registered for property_documents
// fields by migration 20260718124000). Best-effort — never blocks the attach.
async function recordAttachProvenance({ domain, propertyId, documentId, fileName, docType, sourceUrl, workspaceId, actorId, intakeRef }) {
  if (!documentId) return;
  const targetDatabase = domain === 'dialysis' ? 'dia_db' : 'gov_db';
  const targetTable    = `${domain === 'dialysis' ? 'dia' : 'gov'}.property_documents`;
  const fields = { file_name: fileName || null, document_type: docType || null, source_url: sourceUrl || null };
  const tasks = [];
  for (const [fieldName, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    tasks.push(opsQuery('POST', 'rpc/lcc_merge_field', {
      p_workspace_id:    workspaceId || null,
      p_target_database: targetDatabase,
      p_target_table:    targetTable,
      p_record_pk:       String(documentId),
      p_field_name:      fieldName,
      p_value:           value,
      p_source:          'folder_feed_properties',
      p_source_run_id:   intakeRef || null,
      p_confidence:      0.7,
      p_recorded_by:     actorId || null,
    }).catch(() => null));
  }
  await Promise.allSettled(tasks);
}

/**
 * Attach a recognized non-OM working doc to the property its PROPERTIES path
 * describes. Resolves by path anchor (no extraction). Never creates anything.
 *
 * @param {object} args
 * @param {object} args.subjectHint  - {tenant_brand, city, state, vertical, bucket}
 * @param {string} args.fileName     - the doc file name (for the property_documents row)
 * @param {string} args.sourceUrl    - the server-relative path (becomes source_url)
 * @param {string} args.docType      - the classified type (lease|bov|dd|master|comp)
 * @param {string} [args.pathRef]    - stable subject ref for the disambiguation lane (defaults to sourceUrl)
 * @param {string} [args.workspaceId]
 * @param {string} [args.actorId]
 * @returns {Promise<{ok:boolean, attached:boolean, domain?:string, property_id?:number,
 *                     document?:object, emitted_disambiguation?:boolean, reason?:string, match_status?:string}>}
 */
export async function attachRecognizedDoc(args) {
  const { subjectHint, fileName, sourceUrl, docType, workspaceId, actorId } = args;
  const pathRef = args.pathRef || sourceUrl || fileName || null;

  const match = await matchByPathAnchor(subjectHint).catch(() => null);
  const resolved = match
    && match.status === 'matched'
    && match.property_id != null
    && (match.domain === 'government' || match.domain === 'dialysis');

  if (!resolved) {
    // Unresolved or ambiguous → the Decision Center, keyed on the path so the
    // same file is idempotent across ticks. Never a guess, never a create.
    let emitted = false;
    try {
      await emitMatchDisambiguation(
        null,
        subjectHint?.tenant_brand || null,
        subjectHint?.tenant_brand || null,
        Array.isArray(match?.candidates) ? match.candidates : [],
        {
          subjectRef: 'folder_feed_attach:' + pathRef,
          workspaceId,
          context: { source_path: pathRef, subject_hint: subjectHint || null, doc_type: docType || null },
        },
      );
      emitted = true;
    } catch (err) {
      console.warn('[folder-feed-attach] disambiguation emit failed (non-fatal):', err?.message);
    }
    return {
      ok: false,
      attached: false,
      emitted_disambiguation: emitted,
      reason: match?.status === 'review_required' ? 'ambiguous' : 'unresolved',
      match_status: match?.status || null,
    };
  }

  const domain     = match.domain;
  const propertyId = match.property_id;
  const doc = await attachEnrichDocument(domain, propertyId, {
    fileName: fileName || `attach-${docType || 'doc'}.pdf`,
    docType:  docType || 'document',
    sourceUrl,
  }).catch(e => ({ ok: false, error: e?.message }));

  if (doc?.ok && doc.document_id) {
    await recordAttachProvenance({
      domain, propertyId, documentId: doc.document_id,
      fileName, docType, sourceUrl, workspaceId, actorId, intakeRef: pathRef,
    }).catch(() => {});
  }

  return {
    ok: !!doc?.ok,
    attached: !!doc?.ok,
    domain,
    property_id: propertyId,
    document: doc,
    match_status: 'matched',
  };
}
