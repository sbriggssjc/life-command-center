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
import { invokeChatProvider, invokeOpenAIResponses, getAiConfig } from '../_shared/ai.js';
import { matchIntakeToProperty } from './intake-matcher.js';
import { promoteIntakeToDomainListing } from './intake-promoter.js';
import { sendTeamsAlert } from '../_shared/teams-alert.js';
import { createRequire } from 'module';

// Document types worth signalling to Teams. These are the ones the PDF
// extractor produces when the artifact is clearly deal-relevant (listing
// OM, broker flyer, lease abstract showing financials, sold comp). Other
// types (rent_roll, unknown) don't fire alerts to avoid channel noise.
const DEAL_DOCUMENT_TYPES = new Set(['om', 'flyer', 'marketing_brochure', 'comp', 'lease_abstract']);

// createRequire'd to avoid pdf-parse 1.1.1's broken-under-ESM debug block
// in index.js (it tries to readFileSync a bundled test PDF at load time).
// require() sets module.parent correctly so the debug block stays dormant.
const nodeRequire = createRequire(import.meta.url);

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
  // Infer a media type from whatever the row has. Falls back to
  // application/pdf since most OM artifacts are PDFs.
  const inferMediaType = (contentTypeHeader) => {
    if (artifact.mime_type) return artifact.mime_type;
    if (contentTypeHeader)  return contentTypeHeader;
    const fileName = (artifact.file_name || '').toLowerCase();
    if (fileName.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (fileName.endsWith('.xls'))  return 'application/vnd.ms-excel';
    return 'application/pdf';
  };

  // Path 1: inline base64 data
  if (artifact.inline_data) {
    return {
      base64: artifact.inline_data,
      media_type: inferMediaType(null),
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
      const bodyText = await res.text().catch(() => '');
      // Surface response headers before throwing so the per-artifact diag can
      // see WHY the fetch failed.
      globalThis.__lastStorageFetchInfo = {
        status:         res.status,
        content_length: res.headers.get('content-length'),
        content_type:   res.headers.get('content-type'),
        url:            storageUrl,
        body_snippet:   bodyText.slice(0, 200),
      };
      throw new Error(
        `Storage fetch failed: ${res.status} ${res.statusText} — url=${storageUrl} body=${bodyText.slice(0, 200)}`
      );
    }

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    // Expose success-case metadata too — so even a 200-with-empty-body case
    // surfaces Supabase's reported content-length vs. the bytes we actually
    // received. A mismatch (content-length > buffer.byteLength) points at a
    // chunked-transfer or encoding bug; matching zeros means the object is
    // really empty in storage.
    globalThis.__lastStorageFetchInfo = {
      status:         res.status,
      content_length: res.headers.get('content-length'),
      content_type:   res.headers.get('content-type'),
      actual_bytes:   buffer.byteLength,
      url:            storageUrl,
    };
    return {
      base64,
      media_type: inferMediaType(res.headers.get('content-type')),
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

  // Extract PDF text server-side with pdf-parse rather than trying to pass
  // the raw file inline. The OpenAI Responses API path for PDFs via
  // input_file has been unreliable across model versions, and our Supabase
  // edge-function proxy strips attachments that don't match its legacy
  // {data_url} shape. Text extraction sidesteps both issues and works with
  // any model.
  let pdfText = '';
  let pdfPages = 0;
  let pdfExtractError = null;
  if (isPdf && base64Data) {
    try {
      const pdfParse = nodeRequire('pdf-parse');
      const buffer = Buffer.from(base64Data, 'base64');
      const parsed = await pdfParse(buffer);
      pdfText  = (parsed?.text || '').trim();
      pdfPages = Number(parsed?.numpages || 0);
    } catch (err) {
      pdfExtractError = err?.message || String(err);
      console.error('[intake-extractor] pdf-parse failed:', pdfExtractError);
    }
  }
  // Emit sidechannel diagnostics so the per-artifact diagnostics row shows
  // what pdf-parse actually did.
  globalThis.__lastPdfParseInfo = {
    pages: pdfPages,
    textLen: pdfText.length,
    error: pdfExtractError,
  };

  // Truncate extremely long text so we stay well under the model's context
  // window and response budget. ~200k chars is well within gpt-4o-mini's
  // 128k-token limit (roughly 500k chars) while leaving room for the prompt
  // and response. Most OMs are 20-80k chars of text.
  const MAX_TEXT_CHARS = 200_000;
  if (pdfText.length > MAX_TEXT_CHARS) {
    pdfText = pdfText.slice(0, MAX_TEXT_CHARS) + '\n\n[...truncated]';
  }

  const documentBody = isPdf
    ? (pdfText
        ? `Document (${pdfPages} pages) — extracted text:\n\n${pdfText}\n`
        : '[Note: PDF text extraction returned empty. The file may be a scanned image. Attempt best-effort extraction from whatever structured metadata is available; return unknown/null for fields you cannot determine.]\n')
    : '[Note: source is a non-PDF binary document. Extract any identifiable fields from context.]\n';

  const prompt = `Extract all available deal data from this CRE document.
Return ONLY a JSON object — no markdown, no explanation, no preamble.

For any field not present in the document, use null.
For monetary values, return numbers only (no $ or commas).
For percentages, return decimals (7.5% → 7.5).
For dates, return YYYY-MM-DD format.

${documentBody}
{
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
  "roof_responsibility": null,
  "hvac_responsibility": null,
  "structure_responsibility": null,
  "parking_responsibility": null,
  "listing_broker": null,
  "listing_broker_email": null,
  "listing_firm": null,
  "seller_name": null,
  "parcel_number": null,
  "confidence_notes": null
}

Responsibility fields: for roof, hvac, structure, parking — return "tenant", "landlord", or "shared" based on lease language.
Look for keywords like "repair", "replace", "maintain", "responsible" near "roof", "HVAC"/"heating"/"cooling", "structural"/"foundation"/"walls", "parking"/"lot"/"striping".
If the document is an OM, these may appear in the lease abstract section.
If not determinable, use null.`;

  // Text-in-prompt extraction works with any provider (edge, openai, ollama)
  // because we've already turned the PDF into plain text via pdf-parse.
  const result = await invokeChatProvider({
    message:     prompt,
    attachments: [],                // text is inline in the prompt now
    context:     null,
    history:     [],
    user:        { id: 'system' },
    workspaceId: null,
  });

  if (!result.ok) {
    throw new Error(`AI provider error ${result.status}: ${JSON.stringify(result.data)}`);
  }

  // Extract JSON from response text. AI models return content in different
  // shapes depending on provider/SDK version; check the most common first.
  const text =
    result.data?.response ||
    result.data?.content  ||
    result.data?.choices?.[0]?.message?.content ||
    result.data?.completion ||
    (typeof result.data === 'string' ? result.data : '') ||
    '';

  if (!text || typeof text !== 'string') {
    throw new Error(
      `AI response had no text content. data keys: ${Object.keys(result.data || {}).join(', ')}`
    );
  }

  // Strategy 1: markdown fenced block (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch (e) {
      console.warn('[intake-extractor] fenced-JSON parse failed:', e.message);
    }
  }

  // Strategy 2: greediest outer object match
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch (e) {
      console.warn('[intake-extractor] brace-JSON parse failed:', e.message);
    }
  }

  // If we're here, no JSON was found. Throw with a rich diagnostic so the
  // per-artifact diagnostics log shows WHAT the model actually returned.
  const preview = text.slice(0, 600).replace(/\s+/g, ' ');
  throw new Error(
    `No JSON found in AI response. Text preview (first 600 chars): "${preview}"`
  );
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
 * 5. Updates staged_intake_items.status → 'review_required' (or 'failed')
 *
 * @param {string} intakeId — UUID of the staged_intake_item
 * @returns {{ ok: boolean, extraction_snapshot: object|null, error?: string }}
 */
export async function processIntakeExtraction(intakeId, context = {}) {
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

  // Fall back to the staged intake's own workspace_id if the caller didn't
  // supply one. Actor_id is best-effort: if the HTTP handler passed one,
  // use it; otherwise fall through to the inbox_item's source_user_id
  // (the person who originally triggered the intake) so property timeline
  // entries attribute correctly.
  const stagedItem = itemResult.data[0];
  const resolvedWorkspaceId = context.workspaceId || stagedItem?.workspace_id || null;
  let resolvedActorId = context.actorId || null;
  if (!resolvedActorId) {
    // Try to look up the linked inbox_item's source_user_id.
    const inboxLookup = await opsQuery('GET',
      `inbox_items?id=eq.${encodeURIComponent(intakeId)}&select=source_user_id&limit=1`
    );
    if (inboxLookup.ok && Array.isArray(inboxLookup.data) && inboxLookup.data.length) {
      resolvedActorId = inboxLookup.data[0].source_user_id || null;
    }
  }

  // 1b. Short-circuit if an extraction already exists for this intake.
  //     This happens when the Copilot race-timeout fired before the
  //     matcher+promoter could complete in the same invocation — the
  //     extraction row landed but downstream steps got killed by the
  //     Vercel 10s cap. Re-running AI extraction would cost 6-8s and
  //     leave no budget for matcher/promoter, so reuse the existing
  //     snapshot and skip straight to match+promote (which fits in 3-4s).
  //
  //     Bypass with context.forceReextract=true to get the original
  //     full-rerun behavior (e.g. when the user explicitly requests
  //     re-extraction after editing the artifact).
  if (!context.forceReextract) {
    const existingEx = await opsQuery('GET',
      `staged_intake_extractions?intake_id=eq.${encodeURIComponent(intakeId)}` +
      `&select=extraction_snapshot,document_type,created_at` +
      `&order=created_at.desc&limit=1`
    );
    if (existingEx.ok && Array.isArray(existingEx.data) && existingEx.data.length) {
      const cachedSnapshot = existingEx.data[0].extraction_snapshot;
      if (cachedSnapshot && typeof cachedSnapshot === 'object') {
        console.log(`[intake-extractor] Reusing existing extraction for intake_id=${intakeId} (skipping AI)`);
        return await runDownstreamPipeline(intakeId, cachedSnapshot, {
          workspaceId: resolvedWorkspaceId,
          actorId:     resolvedActorId,
        });
      }
    }
  }

  // 2. Fetch associated artifacts
  const artifactsResult = await opsQuery('GET',
    `staged_intake_artifacts?intake_id=eq.${encodeURIComponent(intakeId)}&select=*&order=created_at.asc`
  );
  const artifacts = artifactsResult.ok ? (artifactsResult.data || []) : [];

  // Filter to document types we can extract from. Match on mime_type first
  // (if populated), and fall back to file_type / file_name extension so rows
  // with missing mime_type still get extracted.
  const documentArtifacts = artifacts.filter(a => {
    const mime     = (a.mime_type || '').toLowerCase();
    const fileType = (a.file_type || '').toLowerCase();
    const fileName = (a.file_name || '').toLowerCase();

    if (SUPPORTED_PDF_TYPES.includes(mime))   return true;
    if (SUPPORTED_EXCEL_TYPES.includes(mime)) return true;

    // Extension-based fallback for rows where mime_type isn't set.
    if (fileType === 'pdf' || fileName.endsWith('.pdf')) return true;
    if (['xlsx', 'xls'].includes(fileType))  return true;
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) return true;

    // If neither mime nor extension resolved but the artifact has bytes or
    // a storage path, try it anyway — better to attempt than to silently
    // filter it out. The AI extractor will reject unreadable content.
    if (a.inline_data || a.storage_path) return true;

    return false;
  });

  if (!documentArtifacts.length) {
    console.log(`[intake-extractor] No extractable documents for intake_id=${intakeId}`);
    await opsQuery('PATCH',
      `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}`,
      { status: 'failed', updated_at: new Date().toISOString() }
    );
    return { ok: true, extraction_snapshot: null, error: 'No extractable documents' };
  }

  // 3. Run extraction on each document artifact, tracking per-artifact status
  const extractions = [];
  const perArtifactDiagnostics = [];
  for (const artifact of documentArtifacts) {
    const diag = {
      artifact_id: artifact.id,
      file_name:   artifact.file_name,
      mime_type:   artifact.mime_type,
      has_inline:  !!artifact.inline_data,
      has_storage: !!artifact.storage_path,
    };
    try {
      const t0 = Date.now();
      const { base64, media_type } = await fetchArtifactData(artifact);
      diag.fetch_ms  = Date.now() - t0;
      diag.fetched   = true;
      diag.fetch_bytes = base64 ? Math.ceil(base64.length * 3 / 4) : 0;
      diag.fetched_media_type = media_type;
      // Attach storage-fetch sidechannel (Content-Length, Content-Type, etc.)
      // so a mismatch between Supabase's reported size and the bytes we
      // decoded is visible in the per-artifact diagnostic row.
      if (typeof globalThis.__lastStorageFetchInfo === 'object' && globalThis.__lastStorageFetchInfo !== null) {
        diag.storage_content_length = globalThis.__lastStorageFetchInfo.content_length;
        diag.storage_content_type   = globalThis.__lastStorageFetchInfo.content_type;
        diag.storage_actual_bytes   = globalThis.__lastStorageFetchInfo.actual_bytes;
        diag.storage_status         = globalThis.__lastStorageFetchInfo.status;
      }

      const t1 = Date.now();
      // callAiExtraction returns a result object and may have annotated
      // extraction metadata on the call — we also attach pdf-parse diagnostics
      // via a module-level sidechannel so the per-artifact row shows WHY
      // text extraction returned empty, if it did.
      const parsed = await callAiExtraction(base64, media_type);
      if (typeof globalThis.__lastPdfParseInfo === 'object') {
        diag.pdf_pages = globalThis.__lastPdfParseInfo.pages;
        diag.pdf_text_len = globalThis.__lastPdfParseInfo.textLen;
        diag.pdf_parse_error = globalThis.__lastPdfParseInfo.error;
      }
      diag.ai_ms = Date.now() - t1;

      if (parsed) {
        diag.ai_ok = true;
        diag.document_type = parsed.document_type || null;
        extractions.push(parsed);
      } else {
        diag.ai_ok = false;
        diag.ai_error = 'no_parseable_result';
        console.warn(`[intake-extractor] No parseable result for artifact_id=${artifact.id}`);
      }
    } catch (err) {
      diag.fetched = diag.fetched ?? false;
      diag.ai_ok   = false;
      diag.error   = err?.message || String(err);
      console.error(`[intake-extractor] Artifact extraction failed (artifact_id=${artifact.id}):`, err.message);
    }
    perArtifactDiagnostics.push(diag);
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
      status: mergedSnapshot ? 'review_required' : 'failed',
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

  // Hand off to the downstream pipeline (matcher → promoter → Teams alert).
  // Extracted into its own helper so /api/intake-extract retries (and the
  // cached-extraction short-circuit above) can skip re-running AI and still
  // get the full matcher+promoter cycle within the 10s budget.
  const downstream = await runDownstreamPipeline(intakeId, mergedSnapshot, {
    workspaceId:       resolvedWorkspaceId,
    actorId:           resolvedActorId,
    artifactCount:     documentArtifacts.length,
    extractionCount:   extractions.length,
    diagnostics:       perArtifactDiagnostics,
  });
  return downstream;
}

// ============================================================================
// Downstream pipeline: matcher → promoter → Teams alert.
// Called from both the fresh-extraction path (processIntakeExtraction main
// body) and the cached-extraction short-circuit. Takes a merged snapshot
// rather than running AI — all steps here are DB-only and finish in 3-4s,
// which is why this path is safe to retry after the 7s Copilot race killed
// downstream work on the first attempt.
// ============================================================================
async function runDownstreamPipeline(intakeId, mergedSnapshot, ctx = {}) {
  const resolvedWorkspaceId = ctx.workspaceId || null;
  const resolvedActorId     = ctx.actorId     || null;

  // Run property matcher
  let matchResult = null;
  let matchError  = null;
  if (mergedSnapshot) {
    try {
      matchResult = await matchIntakeToProperty(intakeId, mergedSnapshot);
      console.log('[intake-matcher]', intakeId, matchResult.status, matchResult.confidence);
    } catch (err) {
      matchError = err.message;
      console.error('[intake-matcher] Match failed:', intakeId, err.message);
    }
  }

  // Promote confident OM matches into the matched domain's available_listings table
  let promotionResult = null;
  if (mergedSnapshot && matchResult) {
    try {
      promotionResult = await promoteIntakeToDomainListing(
        intakeId,
        mergedSnapshot,
        matchResult,
        { workspaceId: resolvedWorkspaceId, actorId: resolvedActorId }
      );
      console.log('[intake-promoter]', intakeId, JSON.stringify(promotionResult));
    } catch (err) {
      promotionResult = { ok: false, error: err?.message };
      console.error('[intake-promoter] Promotion failed:', intakeId, err?.message);
    }
  }

  // Fire Teams alert when the PDF itself is clearly deal-relevant. This is
  // more reliable than the email-body-only classifier in intake.js's
  // runEntityExtraction — that path sees only the email text (usually a
  // disclaimer/signature) and misses OMs where the deal content lives in
  // the PDF attachment. Fires in parallel with runEntityExtraction; the
  // two paths send different cards and both are harmless if duplicated.
  const docType = mergedSnapshot?.document_type || '';
  const isDealDoc = DEAL_DOCUMENT_TYPES.has(docType);
  const hasWebhookUrl = !!process.env.TEAMS_INTAKE_WEBHOOK_URL;
  console.log('[intake-extractor] Teams alert check:', JSON.stringify({
    intake_id: intakeId,
    document_type: docType,
    is_deal_doc: isDealDoc,
    has_webhook_url: hasWebhookUrl,
    will_fire: isDealDoc && hasWebhookUrl,
  }));
  let teamsAlertResult = null;
  if (mergedSnapshot && isDealDoc) {
    const docTypeLabel =
        mergedSnapshot.document_type === 'om'                 ? 'Listing OM'
      : mergedSnapshot.document_type === 'flyer'              ? 'Broker Flyer'
      : mergedSnapshot.document_type === 'marketing_brochure' ? 'Marketing Brochure'
      : mergedSnapshot.document_type === 'comp'               ? 'Sales Comp'
      : mergedSnapshot.document_type === 'lease_abstract'     ? 'Lease Abstract'
      : mergedSnapshot.document_type;

    const facts = [
      ['Document', docTypeLabel],
    ];
    if (mergedSnapshot.address) {
      const loc = [mergedSnapshot.address, mergedSnapshot.city, mergedSnapshot.state]
        .filter(Boolean).join(', ');
      facts.push(['Property', loc]);
    }
    if (mergedSnapshot.tenant_name)  facts.push(['Tenant',       mergedSnapshot.tenant_name]);
    if (mergedSnapshot.asking_price) facts.push(['Asking price', `$${Number(mergedSnapshot.asking_price).toLocaleString()}`]);
    if (mergedSnapshot.cap_rate)     facts.push(['Cap rate',     `${mergedSnapshot.cap_rate}%`]);
    if (mergedSnapshot.noi)          facts.push(['NOI',          `$${Number(mergedSnapshot.noi).toLocaleString()}`]);
    if (matchResult?.status === 'matched') {
      facts.push(['Matched',        `${matchResult.domain} / ${matchResult.reason} (${matchResult.confidence})`]);
    } else if (matchResult?.status === 'unmatched') {
      facts.push(['Match',          'No match — triage required']);
    }

    const baseUrl = process.env.LCC_BASE_URL || 'https://life-command-center-nine.vercel.app';
    // IMPORTANT: await this fetch. On Vercel serverless, fire-and-forget
    // promises get terminated when the function returns — the fetch
    // starts but never completes (or never reaches the wire).
    try {
      teamsAlertResult = await sendTeamsAlert({
        title:    'New OM / Deal Document Staged',
        summary:  mergedSnapshot.address
                    ? `${docTypeLabel} for ${mergedSnapshot.address}`
                    : `${docTypeLabel} staged for review`,
        severity: matchResult?.status === 'matched' ? 'success' : 'high',
        facts,
        actions:  [{ label: 'View intake in LCC', url: `${baseUrl}/ops?intake=${intakeId}` }],
      });
      console.log('[intake-extractor] Teams alert result:', JSON.stringify(teamsAlertResult));
    } catch (err) {
      teamsAlertResult = { ok: false, reason: 'extractor_caught', error: err?.message };
      console.warn('[intake-extractor] Teams alert failed (non-fatal):', err?.message);
    }
  }

  // Surface runtime config status inline so the extract endpoint is
  // self-diagnosing — Vercel's runtime-log MCP surface only returns HTTP
  // access logs, not console.log output, which makes debugging config
  // drift hard. Instead, return the relevant env-var presence flags in
  // the response body so a single curl can confirm what's set.
  const webhookUrl = process.env.TEAMS_INTAKE_WEBHOOK_URL || '';
  let webhookHost = null;
  try { webhookHost = webhookUrl ? new URL(webhookUrl).host : null; } catch { /* ignore */ }
  const runtimeConfig = {
    has_teams_webhook_url:      !!webhookUrl,
    teams_webhook_host:         webhookHost,
    document_type:              mergedSnapshot?.document_type || null,
    is_deal_doc:                DEAL_DOCUMENT_TYPES.has(mergedSnapshot?.document_type || ''),
    teams_alert_attempted:      !!webhookUrl && DEAL_DOCUMENT_TYPES.has(mergedSnapshot?.document_type || ''),
    teams_alert_result:         teamsAlertResult,
  };

  return {
    ok: true,
    extraction_snapshot: mergedSnapshot,
    artifact_count:   ctx.artifactCount ?? 0,
    extraction_count: ctx.extractionCount ?? 0,
    diagnostics:      ctx.diagnostics || [],
    match_result:     matchResult,
    match_error:      matchError,
    promotion_result: promotionResult,
    runtime_config:   runtimeConfig,
  };
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
    const result = await processIntakeExtraction(intakeId, {
      workspaceId,
      actorId: user.id,
    });
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    console.error('[intake-extractor] Manual extraction failed:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
