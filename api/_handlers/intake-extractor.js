// ============================================================================
// Intake Document Extractor — Claude AI extraction for CRE documents
// Life Command Center
//
// Processes PDF/Excel attachments from staged_intake_artifacts,
// extracts structured deal data via Claude API, and writes results
// to staged_intake_extractions.
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
import { matchIntakeToProperty } from './intake-matcher.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const EXTRACTION_MODEL = 'claude-sonnet-4-20250514';

const SYSTEM_PROMPT = `You are a commercial real estate data extraction specialist. Extract structured deal data from CRE documents. Respond ONLY with a JSON object — no preamble, no markdown, no explanation.

For any field not present in the document, use null.
For monetary values, return numbers only (no $ or commas).
For percentages, return decimals (7.5% → 7.5).
For dates, return YYYY-MM-DD format.`;

const USER_PROMPT = `Extract all available deal data from this document. Return JSON with these fields:
{
  "document_type": "om | rent_roll | lease_abstract | unknown",
  "address": "string",
  "city": "string",
  "state": "string",
  "zip_code": "string",
  "tenant_name": "string",
  "tenant_guarantor": "string",
  "property_type": "string",
  "building_sf": "number",
  "lot_sf": "number",
  "year_built": "number",
  "asking_price": "number",
  "price_per_sf": "number",
  "cap_rate": "number",
  "noi": "number",
  "annual_rent": "number",
  "rent_per_sf": "number",
  "lease_commencement": "string (YYYY-MM-DD)",
  "lease_expiration": "string (YYYY-MM-DD)",
  "lease_term_years": "number",
  "renewal_options": "string",
  "expense_structure": "string",
  "rent_escalations": "string",
  "listing_broker": "string",
  "listing_broker_email": "string",
  "listing_firm": "string",
  "seller_name": "string",
  "parcel_number": "string",
  "confidence_notes": "string"
}`;

// Document type priority for merging — OM data wins over rent roll / lease abstract
const DOC_TYPE_PRIORITY = { om: 3, lease_abstract: 2, rent_roll: 1, unknown: 0 };

// MIME types we can process
const SUPPORTED_PDF_TYPES = ['application/pdf'];
const SUPPORTED_EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
];

function getAnthropicApiKey() {
  return process.env.ANTHROPIC_API_KEY;
}

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
// CLAUDE API EXTRACTION
// ============================================================================

/**
 * Send a document to Claude for structured data extraction.
 * PDFs are passed as native document blocks; Excel files as text placeholders
 * (binary Excel cannot be interpreted as a document block).
 */
async function callClaudeExtraction(base64Data, mediaType) {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const isPdf = SUPPORTED_PDF_TYPES.includes(mediaType);

  const contentBlocks = [];

  if (isPdf) {
    contentBlocks.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64Data }
    });
  } else {
    // Non-PDF (Excel) — Claude cannot read binary spreadsheets as document blocks.
    // Pass a descriptor so the model still attempts best-effort extraction from
    // any embedded text or metadata.
    contentBlocks.push({
      type: 'text',
      text: `[Attached document: ${mediaType}. This is a spreadsheet file — extract any structured data you can identify from the content.]`
    });
  }

  contentBlocks.push({ type: 'text', text: USER_PROMPT });

  const body = {
    model: EXTRACTION_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: contentBlocks }]
  };

  // 2-minute timeout — large PDFs can take a while
  const res = await fetchWithTimeout(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  }, 120000);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  return textBlock?.text || null;
}

/**
 * Parse Claude's JSON response, stripping any accidental markdown fences.
 */
function parseExtractionJson(raw) {
  if (!raw) return null;
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[intake-extractor] Failed to parse Claude response as JSON:', err.message);
    return null;
  }
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
 * 2. Runs Claude extraction for each PDF/Excel artifact
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
    `staged_intake_items?id=eq.${encodeURIComponent(intakeId)}&select=*&limit=1`
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
      `staged_intake_items?id=eq.${encodeURIComponent(intakeId)}`,
      { status: 'extracted', updated_at: new Date().toISOString() }
    );
    return { ok: true, extraction_snapshot: null, error: 'No extractable documents' };
  }

  // 3. Run extraction on each document artifact
  const extractions = [];
  for (const artifact of documentArtifacts) {
    try {
      const { base64, media_type } = await fetchArtifactData(artifact);
      const rawResponse = await callClaudeExtraction(base64, media_type);
      const parsed = parseExtractionJson(rawResponse);
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
    `staged_intake_items?id=eq.${encodeURIComponent(intakeId)}&select=raw_payload&limit=1`
  );
  const currentPayload = currentItem.ok && currentItem.data?.length
    ? (currentItem.data[0].raw_payload || {})
    : {};

  await opsQuery('PATCH',
    `staged_intake_items?id=eq.${encodeURIComponent(intakeId)}`,
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

  if (!getAnthropicApiKey()) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const result = await processIntakeExtraction(intakeId);
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    console.error('[intake-extractor] Manual extraction failed:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
