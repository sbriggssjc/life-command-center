// ============================================================================
// Intake Document Extractor — AI extraction for CRE documents
// Life Command Center
//
// Processes PDF/Excel attachments from staged_intake_artifacts,
// extracts structured deal data via the shared AI provider
// (invokeChatProvider → OpenAI / edge / ollama based on AI_CHAT_* env),
// and writes results to staged_intake_extractions.
//
// Usage:
//   import { processIntakeExtraction } from './_handlers/intake-extractor.js';
//   processIntakeExtraction(intakeId).catch(err => console.error(err));
//
// Manual trigger:
//   POST /api/intake?_route=extract&intake_id=<uuid>
// ============================================================================

import { opsQuery, fetchWithTimeout } from '../_shared/ops-db.js';
import { authenticate, requireRole } from '../_shared/auth.js';
import { invokeChatProvider, getAiConfig } from '../_shared/ai.js';
import { matchIntakeToProperty } from './intake-matcher.js';

// Document type priority for merging — OM data wins over rent roll / lease abstract
const DOC_TYPE_PRIORITY = { om: 3, lease_abstract: 2, rent_roll: 1, unknown: 0 };

// MIME types we can process
const SUPPORTED_PDF_TYPES = ['application/pdf'];
const SUPPORTED_EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
];

// ============================================================================
// ARTIFACT DATA RETRIEVAL
// ============================================================================

/**
 * Fetch artifact binary data — from inline_data (base64) or Supabase storage.
 * @param {object} artifact - staged_intake_artifacts row
 * @returns {{ base64: string, media_type: string }}
 */
async function fetchArtifactData(artifact) {
  // Path 1: inline base64 data
  if (artifact.inline_data) {
    return {
      base64: artifact.inline_data,
      media_type: artifact.mime_type || 'application/pdf'
    };
  }

  // Path 2: Supabase storage
  if (artifact.storage_path) {
    const OPS_URL = process.env.OPS_SUPABASE_URL;
    const OPS_KEY = process.env.OPS_SUPABASE_KEY;
    if (!OPS_URL || !OPS_KEY) {
      throw new Error('OPS_SUPABASE_URL/KEY required to fetch storage artifacts');
    }

    const storageUrl = `${OPS_URL}/storage/v1/object/${artifact.storage_path}`;
    const res = await fetchWithTimeout(storageUrl, {
      headers: {
        apikey: OPS_KEY,
        Authorization: `Bearer ${OPS_KEY}`
      }
    }, 30000);

    if (!res.ok) {
      throw new Error(`Storage fetch failed: ${res.status} ${res.statusText}`);
    }

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return {
      base64,
      media_type: artifact.mime_type || res.headers.get('content-type') || 'application/pdf'
    };
  }

  throw new Error('Artifact has neither inline_data nor storage_path');
}

// ============================================================================
// AI PROVIDER EXTRACTION
// ============================================================================

/**
 * Send a document to the configured AI provider for structured data extraction.
 * PDFs are passed as file attachments; Excel / binary spreadsheets are handled
 * as prompt-only best-effort extraction (binary xlsx cannot be parsed as text).
 *
 * Returns the parsed JSON extraction object, or throws on provider / parse error.
 */
async function callAiExtraction(base64Data, mediaType) {
  const isPdf = mediaType === 'application/pdf';
  const isExcel = /spreadsheet|excel|xlsx|xls/i.test(mediaType || '');

  // Build the attachment for invokeChatProvider.
  // OpenAI accepts base64 images; PDFs are passed as file attachments that
  // downstream providers can interpret. Excel/other binary types get no
  // attachment — the model does best-effort extraction from the prompt.
  const attachment = isPdf && base64Data ? {
    type: 'file',
    name: 'document.pdf',
    mimeType: 'application/pdf',
    data: base64Data,
  } : null;

  const prompt = `Extract all available deal data from this CRE document.
Return ONLY a JSON object — no markdown, no explanation, no preamble.

For any field not present in the document, use null.
For monetary values, return numbers only (no $ or commas).
For percentages, return decimals (7.5% → 7.5).
For dates, return YYYY-MM-DD format.

${isExcel && !attachment ? '[Note: source is a binary spreadsheet the model cannot parse directly — extract any identifiable fields from context.]\n\n' : ''}{
  "document_type": "om|rent_roll|lease_abstract|flyer|unknown",
  "address": null,
  "city": null,
  "state": null,
  "zip_code": null,
  "tenant_name": null,
  "tenant_guarantor": null,
  "property_type": null,
  "building_sf": null,
  "lot_sf": null,
  "year_built": null,
  "asking_price": null,
  "price_per_sf": null,
  "cap_rate": null,
  "noi": null,
  "annual_rent": null,
  "rent_per_sf": null,
  "lease_commencement": null,
  "lease_expiration": null,
  "lease_term_years": null,
  "renewal_options": null,
  "expense_structure": null,
  "rent_escalations": null,
  "listing_broker": null,
  "listing_broker_email": null,
  "listing_firm": null,
  "seller_name": null,
  "parcel_number": null,
  "confidence_notes": null
}`;

  const result = await invokeChatProvider({
    message:     prompt,
    attachments: attachment ? [attachment] : [],
    context:     null,
    history:     [],
    user:        { id: 'system' },
    workspaceId: null,
  });

  if (!result.ok) {
    throw new Error(`AI provider error ${result.status}: ${JSON.stringify(result.data)}`);
  }

  // Extract JSON from response text
  const text = result.data?.response || result.data?.content || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in AI response');
  return JSON.parse(jsonMatch[0]);
}

// ============================================================================
// MULTI-DOCUMENT MERGE
// ============================================================================

/**
 * Merge multiple extraction results. OM data takes priority over lease abstracts
 * and rent rolls. Null fields are filled from lower-priority documents.
 */
function mergeExtractions(results) {
  if (!results.length) return null;
  if (results.length === 1) return results[0];

  // Sort by document type priority (highest first)
  const sorted = [...results].sort((a, b) =>
    (DOC_TYPE_PRIORITY[b.document_type] || 0) - (DOC_TYPE_PRIORITY[a.document_type] || 0)
  );

  // Start with highest-priority result, fill nulls from lower-priority
  const merged = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const secondary = sorted[i];
    for (const [key, val] of Object.entries(secondary)) {
      if (merged[key] === null || merged[key] === undefined) {
        merged[key] = val;
      }
    }
  }

  merged.confidence_notes = [
    merged.confidence_notes,
    `Merged from ${results.length} documents: ${results.map(r => r.document_type).join(', ')}`
  ].filter(Boolean).join('. ');

  return merged;
}

// ============================================================================
// MAIN EXTRACTION PIPELINE
// ============================================================================

/**
 * Process all document artifacts for a staged intake item.
 *
 * 1. Fetches staged_intake_item + its artifacts
 * 2. Runs AI extraction for each PDF/Excel artifact
 * 3. Merges results (OM preferred over rent roll)
 * 4. Writes to staged_intake_extractions
 * 5. Updates staged_intake_items.status → 'extracted'
 *
 * @param {string} intakeId — UUID of the staged_intake_item
 * @returns {{ ok: boolean, extraction_snapshot: object|null, error?: string }}
 */
export async function processIntakeExtraction(intakeId) {
  console.log(`[intake-extractor] Starting extraction for intake_id=${intakeId}`);

  // 1. Fetch the staged intake item
  const itemResult = await opsQuery('GET',
    `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}&select=*&limit=1`
  );
  if (!itemResult.ok || !itemResult.data?.length) {
    const msg = `Intake item not found: ${intakeId}`;
    console.error(`[intake-extractor] ${msg}`);
    return { ok: false, extraction_snapshot: null, error: msg };
  }

  // 2. Fetch associated artifacts
  const artifactsResult = await opsQuery('GET',
    `staged_intake_artifacts?intake_id=eq.${encodeURIComponent(intakeId)}&select=*&order=created_at.asc`
  );
  const artifacts = artifactsResult.ok ? (artifactsResult.data || []) : [];

  // Filter to document types we can extract from
  const documentArtifacts = artifacts.filter(a => {
    const mime = (a.mime_type || '').toLowerCase();
    return SUPPORTED_PDF_TYPES.includes(mime) || SUPPORTED_EXCEL_TYPES.includes(mime);
  });

  if (!documentArtifacts.length) {
    console.log(`[intake-extractor] No extractable documents for intake_id=${intakeId}`);
    await opsQuery('PATCH',
      `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}`,
      { status: 'extracted', updated_at: new Date().toISOString() }
    );
    return { ok: true, extraction_snapshot: null, error: 'No extractable documents' };
  }

  // 3. Run extraction on each document artifact
  const extractions = [];
  for (const artifact of documentArtifacts) {
    try {
      const { base64, media_type } = await fetchArtifactData(artifact);
      const parsed = await callAiExtraction(base64, media_type);
      if (parsed) {
        extractions.push(parsed);
      } else {
        console.warn(`[intake-extractor] No parseable result for artifact_id=${artifact.id}`);
      }
    } catch (err) {
      console.error(`[intake-extractor] Artifact extraction failed (artifact_id=${artifact.id}):`, err.message);
    }
  }

  // 4. Merge results (prefer OM > lease_abstract > rent_roll)
  const mergedSnapshot = mergeExtractions(extractions);

  // 5. Write to staged_intake_extractions
  if (mergedSnapshot) {
    const insertResult = await opsQuery('POST', 'staged_intake_extractions', {
      intake_id: intakeId,
      extraction_snapshot: mergedSnapshot
    }, { Prefer: 'return=representation' });

    if (!insertResult.ok) {
      console.error('[intake-extractor] Failed to write extraction:', insertResult.data);
    }
  }

  // 6. Update staged_intake_items status + store extraction summary in raw_payload
  const currentItem = await opsQuery('GET',
    `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}&select=raw_payload&limit=1`
  );
  const currentPayload = currentItem.ok && currentItem.data?.length
    ? (currentItem.data[0].raw_payload || {})
    : {};

  await opsQuery('PATCH',
    `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}`,
    {
      status: 'extracted',
      raw_payload: {
        ...currentPayload,
        extraction_result: mergedSnapshot
          ? {
              document_type: mergedSnapshot.document_type,
              address: mergedSnapshot.address,
              tenant_name: mergedSnapshot.tenant_name,
              asking_price: mergedSnapshot.asking_price,
              cap_rate: mergedSnapshot.cap_rate,
              extracted_at: new Date().toISOString(),
              artifact_count: documentArtifacts.length,
              extraction_count: extractions.length
            }
          : { error: 'No valid extractions', extracted_at: new Date().toISOString() }
      },
      updated_at: new Date().toISOString()
    }
  );

  console.log(`[intake-extractor] Done: intake_id=${intakeId}, extractions=${extractions.length}/${documentArtifacts.length}`);

  // Run property matcher after extraction completes
  if (mergedSnapshot) {
    try {
      const matchResult = await matchIntakeToProperty(intakeId, mergedSnapshot);
      console.log('[intake-matcher]', intakeId, matchResult.status, matchResult.confidence);
    } catch (err) {
      console.error('[intake-matcher] Match failed:', intakeId, err.message);
    }
  }

  return { ok: true, extraction_snapshot: mergedSnapshot };
}

// ============================================================================
// HTTP HANDLER — manual extraction trigger
// POST /api/intake?_route=extract&intake_id=<uuid>
// ============================================================================

export async function handleExtractRoute(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  if (!requireRole(user, 'operator', workspaceId)) {
    return res.status(403).json({ error: 'Operator role required' });
  }

  const intakeId = req.query.intake_id || req.body?.intake_id;
  if (!intakeId) {
    return res.status(400).json({ error: 'intake_id is required' });
  }

  // AI provider key checks are handled by invokeChatProvider — a missing key
  // returns { ok: false, status: 503 } which processIntakeExtraction surfaces
  // per-artifact.  No pre-flight env check required.
  void getAiConfig();

  try {
    const result = await processIntakeExtraction(intakeId);
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    console.error('[intake-extractor] Manual extraction failed:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
