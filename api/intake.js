// ============================================================================
// Unified Intake API — Consolidated from intake-outlook-message.js + intake-summary.js
// Life Command Center  (cache-bust: force rebuild of handler imports)
//
// POST /api/intake?_route=outlook-message   — deterministic single-message intake
// GET  /api/intake?_route=summary           — Teams/Automation formatted summary
// POST /api/intake?_route=extract           — manual document extraction trigger
// POST /api/intake?_route=copilot-action    — Copilot action gateway (dispatches by action_id)
// POST /api/intake?_route=parse-om          — OM lease abstract parser + provenance push
// POST /api/intake?_route=ingest_pdf        — PDF upload ingestion (Copilot chat / REST)
//
// CONSOLIDATION NOTE (2026-04-03):
// Merged to stay within Vercel Hobby plan 12-function limit.
// See LCC_ARCHITECTURE_STRATEGY.md and .github/AI_INSTRUCTIONS.md
// ============================================================================

import { createHash, randomUUID } from 'crypto';
import { createRequire } from 'module';

// CJS require for packages that don't work under ESM dynamic import (see
// pdf-parse 1.1.1 debug-block issue documented in intake-extractor.js).
const nodeRequire = createRequire(import.meta.url);
import { authenticate, handleCors, requireRole } from './_shared/auth.js';
import { fetchWithTimeout, opsQuery, pgFilterVal, requireOps, withErrorHandler } from './_shared/ops-db.js';
import { getAiConfig } from './_shared/ai.js';
import { writeSignal } from './_shared/signals.js';
import { sendTeamsAlert } from './_shared/teams-alert.js';
import { ensureEntityLink, normalizeCanonicalName } from './_shared/entity-link.js';
import { processIntakeExtraction, handleExtractRoute } from './_handlers/intake-extractor.js';
import { processSidebarExtraction } from './_handlers/sidebar-pipeline.js';
import { parseOmLeaseAbstract, processOmDocument } from './_handlers/om-parser.js';
import { handleIntakeStageOm } from './_handlers/intake-stage-om.js';
import { handleIntakeFinalizeOm } from './_handlers/intake-finalize-om.js';
import { stageOmIntake } from './_shared/intake-om-pipeline.js';

// ============================================================================
// EDGE FUNCTION PROXY — forwards requests to Supabase Edge Functions
// ============================================================================

const INTAKE_EDGE_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/intake-receiver';

async function proxyToIntakeReceiver(req, res, action) {
  const url = new URL(INTAKE_EDGE_URL);
  url.searchParams.set('action', action);

  const headers = { 'Content-Type': 'application/json' };
  const forwardHeaders = [
    'x-lcc-workspace', 'x-lcc-key', 'x-pa-webhook-secret',
    'x-lcc-user-id', 'x-lcc-user-email', 'authorization'
  ];
  for (const h of forwardHeaders) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }

  try {
    const edgeRes = await fetch(url.toString(), {
      method: req.method,
      headers,
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    const data = await edgeRes.json();
    return res.status(edgeRes.status).json(data);
  } catch (err) {
    console.error('[edge-proxy] intake-receiver failed, falling back to local:', err.message);
    return null;
  }
}

// ============================================================================
// ROUTE DISPATCHER
// ============================================================================

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const route = req.query._route;

  switch (route) {
    case 'outlook-message': {
      // When edge_intake_receiver flag is enabled, proxy to Supabase Edge Function
      try {
        const wsId = req.headers['x-lcc-workspace'];
        if (wsId) {
          const wsResult = await opsQuery('GET', `workspaces?id=eq.${pgFilterVal(wsId)}&select=config`);
          const wsConfig = wsResult.data?.[0]?.config || {};
          const flags = wsConfig.feature_flags || {};
          if (flags.edge_intake_receiver) {
            const proxyResult = await proxyToIntakeReceiver(req, res, 'outlook-message');
            if (proxyResult) return;
            console.warn('[intake-proxy] Edge proxy failed, falling back to local handler');
          }
        }
      } catch (err) {
        console.warn('[intake-proxy] Flag check failed, using local handler:', err.message);
      }
      return handleOutlookMessage(req, res);
    }
    case 'summary':
      return handleIntakeSummary(req, res);
    case 'extract':
      return handleExtractRoute(req, res);
    case 'queue':
      return handleIntakeQueue(req, res);
    case 'promote':
      return handleIntakePromote(req, res);
    case 'discard':
      return handleIntakeDiscard(req, res);
    case 'copilot-action':
      return handleCopilotAction(req, res);
    case 'parse-om':
      return handleParseOm(req, res);
    case 'ingest_pdf':
      return handleIngestPdf(req, res);
    case 'feedback': {
      const { handleIntakeFeedback } = await import('./_handlers/intake-feedback.js');
      return handleIntakeFeedback(req, res);
    }
    case 'accuracy': {
      const { handleMatcherAccuracy } = await import('./_handlers/intake-feedback.js');
      return handleMatcherAccuracy(req, res);
    }
    default:
      return res.status(400).json({
        error: 'Invalid _route. Use: outlook-message, summary, extract, queue, promote, discard, copilot-action, parse-om, ingest_pdf, feedback, accuracy'
      });
  }
});

// ============================================================================
// OUTLOOK SINGLE-MESSAGE INTAKE (was intake-outlook-message.js)
// ============================================================================

function isoOrNow(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function normalizeSender(sender) {
  if (!sender) return { name: null, email: null };
  if (typeof sender === 'string') return { name: null, email: sender };
  if (sender.emailAddress) {
    return {
      name: sender.emailAddress.name || null,
      email: sender.emailAddress.address || null
    };
  }
  return {
    name: sender.name || null,
    email: sender.email || null
  };
}

function deterministicCorrelationId(workspaceId, externalId, receivedAtIso) {
  const base = `${workspaceId}|${externalId}|${receivedAtIso}`;
  const digest = createHash('sha1').update(base).digest('hex').slice(0, 12);
  const ts = new Date(receivedAtIso).getTime();
  return `outlook-msg-${digest}-${ts}`;
}

function firstNonEmpty(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

// Fetch a remote PDF as a base64 artifact. Limited to a small allowlist of
// trusted file-host patterns so we don't blindly hit arbitrary URLs from email
// bodies. Returns null on any failure (untrusted, non-PDF, network, timeout).
async function fetchUrlArtifact(url) {
  const TRUSTED_PATTERNS = [
    /dropbox\.com\/s\//,
    /drive\.google\.com\/file\//,
    /app\.box\.com\/s\//,
    /1drv\.ms\//,              // OneDrive share links
    /sharepoint\.com\/.*\.pdf/i,
    /\.pdf(\?|$)/i,            // Direct PDF URLs
  ];
  if (!TRUSTED_PATTERNS.some(p => p.test(url))) return null;

  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'LCC-Intake/1.0' },
    }, 15000);
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!/pdf/i.test(contentType)) return null;

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const fileName = url.split('/').pop()?.split('?')[0] || 'document.pdf';

    return { base64, contentType: 'application/pdf', fileName };
  } catch {
    return null;
  }
}

// Pick the OM-eligible attachment from a Power Automate attachments[] array.
//
// Background: Outlook emails commonly arrive with 3 attachments — the actual
// OM PDF plus two signature graphics (image001.png + image002.jpg). The
// previous "first with storage_path" picker grabbed image001.png because PA
// uploads attachments in their email-order and the sig images come first in
// most Outlook payloads. The OM PDF was uploaded to storage but never staged.
//
// This helper screens out signature-shaped images and other non-OM types
// before applying the storage_path > inline > index-zero preference.
//
// Bug E follow-up (2026-04-25): the noise filter inside stageOmIntake catches
// signature images after the picker passes them through, but it can't tell
// the picker to look at the next attachment instead. Filter at the picker.
function pickPrimaryOmAttachment(atts) {
  if (!Array.isArray(atts) || atts.length === 0) return null;

  const isLikelyOm = (a) => {
    const fn = String(a?.file_name || a?.name || '').toLowerCase().trim();
    const mt = String(a?.file_type || a?.contentType || a?.mime_type || '').toLowerCase();

    // Reject obvious noise — Outlook signature graphics + bare images.
    if (mt.startsWith('image/')) return false;
    if (/^image\d+\.(png|jpg|jpeg|gif|bmp)$/i.test(fn)) return false;
    if (/^outlook-logo/i.test(fn) || /^signature/i.test(fn)) return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg)$/i.test(fn)) return false;

    // Accept OM-shaped attachments: PDF / Word.
    if (/\.(pdf|docx?)$/i.test(fn)) return true;
    if (mt === 'application/pdf') return true;
    if (mt.includes('msword') || mt.includes('officedocument.wordprocessingml')) return true;

    // Anything else (xlsx, zip, eml, unknown) — skip; the OM is virtually
    // always a PDF or docx in practice.
    return false;
  };

  const eligible = atts.filter(isLikelyOm);
  return eligible.find(a => a.storage_path)
      || eligible.find(a => a.inline_data || a.content)
      || eligible[0]
      || null;
}

async function handleOutlookMessage(req, res) {
  console.log('[intake-outlook-message] diag req:', JSON.stringify({ method: req.method, bodyKeys: Object.keys(req.body || {}), hasMessageId: !!(req.body?.message_id || req.body?.id || req.body?.internet_message_id || req.body?.internetMessageId), hasWorkspaceHeader: !!req.headers['x-lcc-workspace'], bodyType: typeof req.body }));
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

  const payload = req.body || {};
  // Prefer internet_message_id as canonical dedup key — stable across folder moves.
  // Graph REST id changes when the message moves between folders.
  const internetMsgId = firstNonEmpty(payload.internet_message_id, payload.internetMessageId, null);
  const graphRestId = firstNonEmpty(payload.message_id, payload.id, null);
  const messageId = internetMsgId || graphRestId;
  const subject = firstNonEmpty(payload.subject, '(No subject)');
  const bodyPreview = firstNonEmpty(payload.body_preview, payload.bodyPreview, payload.body, '');
  // Power Automate's bodyPreview is capped at ~255 chars. If the flow attaches
  // a full body via a "Get email (V3)" step (passed as body_text), prefer it
  // for URL scanning so we can find PDF links beyond the preview window.
  const bodyForUrlScan = firstNonEmpty(payload.body_text, payload.bodyText, bodyPreview, '');
  const webLink = firstNonEmpty(payload.web_link, payload.webLink, null);
  const receivedAtIso = isoOrNow(firstNonEmpty(payload.received_date_time, payload.receivedDateTime, payload.received_at));
  const sender = normalizeSender(firstNonEmpty(payload.from, payload.sender, payload.sender_email));
  const hasAttachments = Boolean(firstNonEmpty(payload.has_attachments, payload.hasAttachments, false));
  const attachmentCount = Array.isArray(payload.attachments) ? payload.attachments.length : null;

  if (!messageId) {
    return res.status(400).json({ error: 'message_id (or id/internet_message_id) is required' });
  }

  const correlationId = deterministicCorrelationId(workspaceId, String(messageId), receivedAtIso);

  // Build deeplink: prefer Graph webLink (survives moves), fall back to REST id link
  const deepLink = webLink
    || (graphRestId ? `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(graphRestId)}` : null);

  // Dedup guard: Power Automate's flagged-email trigger fires multiple times
  // (typically 3–6) for the same email within a minute. Check if this
  // correlation_id already exists in inbox_items before inserting a new row.
  // NOTE: we also select `metadata` so we can read the bridged_to_intake_id
  // that the fresh-path writes on successful staging. Without this, replays
  // would (a) re-stage the email because the alreadyStaged check was looking
  // up staged_intake_items by the WRONG UUID (inbox_item.id instead of the
  // staged intake's own id), and (b) return an invalid staged_intake_id to
  // the caller.
  const existingCheck = await opsQuery('GET',
    `inbox_items?metadata->>correlation_id=eq.${encodeURIComponent(correlationId)}` +
    `&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&select=id,status,metadata&limit=1`
  );

  if (existingCheck.ok && existingCheck.data?.length) {
    const existing = existingCheck.data[0];
    const bridgedIntakeId = existing.metadata?.bridged_to_intake_id || null;
    const stagingStartedAt = existing.metadata?.staging_started_at || null;

    // Bug F (2026-04-25): Power Automate's flagged-email V3 trigger fires
    // the flow 2-6 times for a single flag event within ~10 seconds. The
    // legacy dedup checked `staged_intake_items.intake_id = existing.id`
    // (the flagged_email row's own id) — which never matches because
    // staging uses a separate email_om bridge uuid. Plus, the
    // `bridged_to_intake_id` metadata patch only happens AFTER stageOmIntake
    // completes (3-10s), so concurrent POSTs in that window all saw "no
    // bridge yet" and re-staged. Result: duplicate staged_intake_items per
    // flag event, with the LCC-Opps side double-billed even when the
    // dialysis listing was idempotent.
    //
    // Fix: pre-claim the slot via `staging_started_at` written BEFORE the
    // stageOmIntake await (see fresh-path below). Subsequent arrivals see
    // a recent claim and short-circuit. After 60s the claim is treated as
    // stale (the original call presumably died) and re-stage is allowed.
    const STAGING_CLAIM_WINDOW_MS = 60_000;
    const stagingInFlight = !!(stagingStartedAt &&
      (Date.now() - new Date(stagingStartedAt).getTime() < STAGING_CLAIM_WINDOW_MS));

    let alreadyStaged = false;
    if (bridgedIntakeId) {
      const stagedCheck = await opsQuery('GET',
        `staged_intake_items?intake_id=eq.${pgFilterVal(bridgedIntakeId)}&select=intake_id&limit=1`
      );
      alreadyStaged = stagedCheck.ok && stagedCheck.data?.length > 0;
    }

    // Re-stage only when the prior attempt is genuinely lost — no bridge
    // recorded AND no recent staging claim. Otherwise trust the in-flight
    // call (within window) or the already-staged row (bridge present).
    if (!alreadyStaged && !stagingInFlight && hasAttachments) {
      const atts = Array.isArray(payload.attachments) ? payload.attachments : [];
      let primaryDocument = null;

      if (atts.length > 0) {
        const first = pickPrimaryOmAttachment(atts);
        if (first) {
          primaryDocument = {
            bytes_base64: first.inline_data || first.content || null,
            storage_path: first.storage_path || null,
            file_name:    first.file_name || first.name || 'attachment.pdf',
            mime_type:    first.file_type || first.contentType || first.mime_type || 'application/pdf',
          };
        }
      }
      // Fall through to body-URL scan when no OM-eligible attachment was
      // picked — covers emails whose only attachments are signature images
      // but the real OM is linked from the body.
      if (!primaryDocument && bodyForUrlScan) {
        const urlMatches = bodyForUrlScan.match(/https?:\/\/[^\s"'<>]+/g) || [];
        for (const url of urlMatches.slice(0, 3)) {
          const fetched = await fetchUrlArtifact(url);
          if (fetched) {
            primaryDocument = {
              bytes_base64: fetched.base64,
              storage_path: null,
              file_name:    fetched.fileName || 'om.pdf',
              mime_type:    fetched.contentType || 'application/pdf',
            };
            break;
          }
        }
      }

      // Bug O fix: same email-body fallback as the fresh-path. See above.
      if (!primaryDocument) {
        const synthParts = [];
        if (subject) synthParts.push(`Subject: ${subject}`);
        const bodyText = bodyForUrlScan || bodyPreview || '';
        if (bodyText) synthParts.push(bodyText);
        const synthText = synthParts.join('\n\n').trim();
        if (synthText.length >= 100) {
          const synthBase64 = Buffer.from(synthText, 'utf8').toString('base64');
          const filenameSuffix = (graphRestId || internetMsgId || 'msg').slice(-12).replace(/[^A-Za-z0-9_-]/g, '');
          primaryDocument = {
            bytes_base64: synthBase64,
            storage_path: null,
            file_name:    `email-body-${filenameSuffix}.txt`,
            mime_type:    'text/plain',
          };
        }
      }

      if (primaryDocument && (primaryDocument.bytes_base64 || primaryDocument.storage_path)) {
        await stageOmIntake(
          {
            bytes_base64:     primaryDocument.bytes_base64 || undefined,
            storage_path:     primaryDocument.storage_path || undefined,
            file_name:        primaryDocument.file_name,
            mime_type:        primaryDocument.mime_type,
            channel:          'email',
            note:             subject || null,
            seed_data: { tags: ['email_intake', 'dedup_replay'] },
          },
          {
            email:      sender?.email || user.email,
            name:       sender?.name  || user.display_name || null,
          },
          workspaceId,
        ).catch(err =>
          console.error('[intake] dedup-path stageOmIntake failed:', existing.id, err.message)
        );
      }
    }

    return res.status(200).json({
      ok: true,
      deduplicated: true,
      correlation_id: correlationId,
      inbox_item_id:    existing.id,
      // Always return the real staged intake id (from metadata bridge) when
      // we have one — regardless of whether we re-ran staging on this replay.
      staged_intake_id: bridgedIntakeId || null,
      message: 'Already ingested',
    });
  }

  const result = await opsQuery('POST', 'inbox_items', {
    workspace_id: workspaceId,
    source_user_id: user.id,
    assigned_to: user.id,
    title: String(subject),
    body: bodyPreview ? String(bodyPreview) : null,
    source_type: 'flagged_email',
    source_connector_id: null,
    external_id: String(messageId),
    external_url: deepLink,
    status: 'new',
    priority: 'normal',
    visibility: 'private',
    metadata: {
      sender_name: sender.name,
      sender_email: sender.email,
      received_at: receivedAtIso,
      has_attachments: hasAttachments,
      attachment_count: attachmentCount,
      graph_rest_id: graphRestId || null,
      internet_message_id: internetMsgId || null,
      event_source: 'outlook_power_automate',
      correlation_id: correlationId
    },
    received_at: receivedAtIso
  }, { Prefer: 'return=representation,resolution=merge-duplicates' });

  if (!result.ok) {
    return res.status(result.status || 500).json({ error: 'Failed to ingest Outlook message', detail: result.data });
  }

  const item = Array.isArray(result.data) ? result.data[0] : result.data;

  // Bug F claim (2026-04-25): mark the slot as "staging in progress" BEFORE
  // we await stageOmIntake (which can take 3-10s for the extraction race).
  // Subsequent PA replays of the same flag event see this timestamp and
  // short-circuit in the dedup branch instead of staging duplicates.
  if (item?.id) {
    await opsQuery('PATCH', `inbox_items?id=eq.${pgFilterVal(item.id)}`, {
      metadata: {
        ...(item.metadata || {}),
        staging_started_at: new Date().toISOString(),
      },
    }).catch(err => console.error('[intake] staging claim PATCH failed:', err?.message));
  }

  // If email has attachments (or a findable PDF URL in the body), bridge to
  // the unified stageOmIntake pipeline. This replaces the legacy dual-DB
  // path (dialysis_db writes, LCC-Opps reads) with a single LCC-Opps-native
  // call that creates staged_intake_items + staged_intake_artifacts, fires
  // the extractor, runs the matcher, and logs an entity-scoped memory event.
  let stagedIntakeId = null;
  {
    // Collect the first candidate PDF: either an inline attachment or a
    // body-URL-fetched PDF. Multi-PDF emails are not the common case; if one
    // comes in, we stage the first and log a note for the rest.
    const atts = Array.isArray(payload.attachments) ? payload.attachments : [];
    let primaryDocument = null;

    if (atts.length > 0) {
      // pickPrimaryOmAttachment screens out signature graphics (image001.png,
      // image002.jpg, etc.) before applying the storage_path > inline >
      // index-zero preference. Power Automate's Outlook flow for large emails
      // uploads attachments to Supabase via prepare-upload first, then posts
      // this endpoint with just the storage references; the picker selects
      // the OM PDF rather than whichever signature graphic happens to be
      // first in the email's attachment order.
      const first = pickPrimaryOmAttachment(atts);
      if (first) {
        primaryDocument = {
          bytes_base64: first.inline_data || first.content || null,
          storage_path: first.storage_path || null,
          file_name:    first.file_name || first.name || 'attachment.pdf',
          mime_type:    first.file_type || first.contentType || first.mime_type || 'application/pdf',
        };
      }
    }
    // Fall through to body-URL scan when no OM-eligible attachment was
    // picked — covers emails whose only attachments are signature images
    // but the real OM is linked from the body (Dropbox / Google Drive / etc.).
    if (!primaryDocument && bodyForUrlScan) {
      const urlMatches = bodyForUrlScan.match(/https?:\/\/[^\s"'<>]+/g) || [];
      for (const url of urlMatches.slice(0, 3)) {
        const fetched = await fetchUrlArtifact(url);
        if (fetched) {
          primaryDocument = {
            bytes_base64: fetched.base64,
            storage_path: null,
            file_name:    fetched.fileName || 'om.pdf',
            mime_type:    fetched.contentType || 'application/pdf',
          };
          break;
        }
      }
    }

    // Bug O fix (2026-04-25): when the email has neither an OM-eligible
    // attachment nor a trusted-host PDF URL, stage the email BODY itself
    // as a text artifact so the AI extractor still runs on it. This
    // captures price-change updates, broker-list emails, marketing copy
    // and other deal-relevant emails that don't carry a PDF.
    // Threshold: 100 chars of combined subject+body. Below that, the
    // email is signal-light enough that staging would just add inbox
    // noise (e.g. "Thanks!" replies).
    if (!primaryDocument) {
      const synthParts = [];
      if (subject) synthParts.push(`Subject: ${subject}`);
      const bodyText = bodyForUrlScan || bodyPreview || '';
      if (bodyText) synthParts.push(bodyText);
      const synthText = synthParts.join('\n\n').trim();
      if (synthText.length >= 100) {
        const synthBase64 = Buffer.from(synthText, 'utf8').toString('base64');
        const filenameSuffix = (graphRestId || internetMsgId || 'msg').slice(-12).replace(/[^A-Za-z0-9_-]/g, '');
        primaryDocument = {
          bytes_base64: synthBase64,
          storage_path: null,
          file_name:    `email-body-${filenameSuffix}.txt`,
          mime_type:    'text/plain',
        };
      }
    }

    if (primaryDocument && (primaryDocument.bytes_base64 || primaryDocument.storage_path)) {
      const stageRes = await stageOmIntake(
        {
          bytes_base64:     primaryDocument.bytes_base64 || undefined,
          storage_path:     primaryDocument.storage_path || undefined,
          file_name:        primaryDocument.file_name,
          mime_type:        primaryDocument.mime_type,
          channel:          'email',
          note:             subject || null,
          seed_data: {
            property: null,
            tags:     ['email_intake'],
          },
          copilot_metadata: null,
        },
        {
          email:      sender?.email || user.email,
          name:       sender?.name  || user.display_name || null,
          oid:        null,
          tenant_id:  null,
        },
        workspaceId,
      );

      if (stageRes.status === 200 && stageRes.body?.ok) {
        stagedIntakeId = stageRes.body.intake_id;
        // Link the email's inbox_item to the new staging record via metadata.
        if (item?.id && stagedIntakeId && stagedIntakeId !== item.id) {
          await opsQuery('PATCH', `inbox_items?id=eq.${pgFilterVal(item.id)}`, {
            metadata: {
              ...(item.metadata || {}),
              bridged_to_intake_id: stagedIntakeId,
            },
          }).catch(() => {});
        } else if (item?.id) {
          stagedIntakeId = item.id;
        }
      } else {
        console.error('[intake] stageOmIntake from email failed:', stageRes.status, stageRes.body?.error);
      }
    }
  }

  // Fire-and-forget entity extraction — NEVER blocks the intake response
  runEntityExtraction(workspaceId, user, item, subject, bodyPreview, sender)
    .catch(err => console.error('[Intake extraction error]', err.message || err));

  return res.status(200).json({
    ok: true,
    correlation_id: correlationId,
    inbox_item_id: item?.id || null,
    staged_intake_id: stagedIntakeId,
    external_id: String(messageId),
    status: item?.status || 'new'
  });
}

// ============================================================================
// ENTITY EXTRACTION FROM EMAIL (fire-and-forget after intake response)
// ============================================================================

// STEP 4 — Extraction gate: env flag, minimum body length, skip internal domains
function shouldRunExtraction(body, senderEmail) {
  if (process.env.INTAKE_EXTRACTION_ENABLED !== 'true') return false;
  if (!body || body.length < 100) return false;
  const internalDomains = (process.env.INTERNAL_EMAIL_DOMAINS || '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
  if (senderEmail && internalDomains.length) {
    const senderDomain = senderEmail.split('@')[1]?.toLowerCase();
    if (senderDomain && internalDomains.includes(senderDomain)) return false;
  }
  return true;
}

function buildExtractionPrompt(subject, body) {
  return `You are a commercial real estate data extraction assistant. Extract all structured entities from this email. Return ONLY valid JSON — no markdown, no explanation.

Email Subject: ${subject}
Email Body: ${body}

Extract and return this exact JSON structure:
{
  "properties": [
    {
      "address": "full street address or null",
      "city": "city or null",
      "state": "two-letter state or null",
      "zip": "zip or null",
      "asset_type": "government_leased | dialysis_clinic | net_lease | unknown",
      "asking_price": number or null,
      "cap_rate": number or null,
      "lease_term_years": number or null,
      "tenant": "tenant name or null",
      "leasable_sf": number or null,
      "noi": number or null,
      "confidence": "high | medium | low"
    }
  ],
  "contacts": [
    {
      "first_name": "or null",
      "last_name": "or null",
      "email": "or null",
      "phone": "or null",
      "company": "or null",
      "title": "or null",
      "role": "broker | owner | buyer | lender | attorney | unknown"
    }
  ],
  "organizations": [
    {
      "name": "company or entity name",
      "org_type": "operator | owner | lender | agency | broker_firm | unknown"
    }
  ],
  "financial_signals": {
    "is_listing_om": boolean,
    "is_deal_inquiry": boolean,
    "is_comp_data": boolean,
    "is_owner_outreach": boolean,
    "contains_pricing": boolean
  },
  "domain": "government | dialysis | net_lease | unknown",
  "extraction_confidence": "high | medium | low"
}

If a field has no data, use null. Return empty arrays if no entities found.
Do not invent data — only extract what is explicitly stated.`;
}

// STEP 1 — AI extraction call (cheapest model for high-volume path)
async function callExtractionAI(prompt) {
  const cfg = getAiConfig();

  // Prefer direct OpenAI call with cheapest model
  if (cfg.openaiApiKey) {
    const model = cfg.chatModel || 'gpt-5-mini';
    const res = await fetch(`${cfg.openaiBaseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.openaiApiKey}`
      },
      body: JSON.stringify({
        model,
        instructions: 'You are a commercial real estate data extraction assistant. Return ONLY valid JSON — no markdown, no explanation.',
        input: prompt,
        store: false
      })
    });
    const data = await res.json();
    return data?.output_text || '';
  }

  // Fallback to edge function
  if (cfg.edgeBaseUrl) {
    const res = await fetch(`${cfg.edgeBaseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt, context: {}, history: [], attachments: [] })
    });
    const data = await res.json();
    return data?.response || data?.data?.response || '';
  }

  return null;
}

function parseExtractionResponse(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    console.error('[Intake extraction] Failed to parse AI response as JSON');
    return null;
  }
}

async function extractEntitiesFromEmail(subject, body, senderEmail, senderName) {
  const prompt = buildExtractionPrompt(subject, body);
  const rawResponse = await callExtractionAI(prompt);
  return parseExtractionResponse(rawResponse);
}

// STEP 2 — Process extracted properties
async function processExtractedProperties(properties, workspaceId, userId, inboxItemId) {
  const propertyIds = [];
  for (const prop of properties) {
    if (!prop.address || (prop.confidence !== 'high' && prop.confidence !== 'medium')) continue;

    try {
      // Dedup: check for existing entity by address
      const encodedAddr = encodeURIComponent(prop.address);
      const lookup = await opsQuery('GET',
        `entities?workspace_id=eq.${workspaceId}&entity_type=eq.asset&address=ilike.*${encodedAddr}*&select=*&limit=1`
      );
      const existing = lookup.ok && lookup.data?.length ? lookup.data[0] : null;

      if (existing) {
        // Update metadata with new financial signals
        const meta = { ...(existing.metadata || {}) };
        if (prop.asking_price != null) meta.asking_price = prop.asking_price;
        if (prop.cap_rate != null) meta.cap_rate = prop.cap_rate;
        if (prop.lease_term_years != null) meta.lease_term_years = prop.lease_term_years;
        if (prop.tenant) meta.tenant = prop.tenant;
        if (prop.leasable_sf != null) meta.leasable_sf = prop.leasable_sf;
        if (prop.noi != null) meta.noi = prop.noi;

        await opsQuery('PATCH',
          `entities?id=eq.${existing.id}&workspace_id=eq.${workspaceId}`,
          { metadata: meta, updated_at: new Date().toISOString() }
        );

        // Link existing entity to intake item
        await ensureEntityLink({
          workspaceId, userId,
          sourceSystem: 'intake_email',
          sourceType: 'property',
          externalId: `intake-prop-${inboxItemId}-${propertyIds.length}`,
          entityId: existing.id
        });

        propertyIds.push(existing.id);
      } else if (prop.confidence === 'high') {
        // Create new entity for high-confidence extractions only
        const domain = prop.asset_type === 'government_leased' ? 'government'
          : prop.asset_type === 'dialysis_clinic' ? 'dialysis' : null;

        const linkResult = await ensureEntityLink({
          workspaceId, userId,
          sourceSystem: 'intake_email',
          sourceType: 'property',
          externalId: `intake-prop-${inboxItemId}-${propertyIds.length}`,
          domain,
          seedFields: {
            name: prop.address,
            address: prop.address,
            city: prop.city || null,
            state: prop.state || null,
            zip: prop.zip || null,
            asset_type: prop.asset_type || null,
            metadata: {
              asking_price: prop.asking_price || null,
              cap_rate: prop.cap_rate || null,
              lease_term_years: prop.lease_term_years || null,
              tenant: prop.tenant || null,
              leasable_sf: prop.leasable_sf || null,
              noi: prop.noi || null,
              source: 'intake_email_extraction'
            }
          }
        });
        if (linkResult.ok) propertyIds.push(linkResult.entityId);
      }

      // Write signal for each extracted property
      await writeSignal({
        signal_type: 'entity_extracted_from_email',
        signal_category: 'intelligence',
        entity_type: 'asset',
        entity_id: propertyIds[propertyIds.length - 1] || null,
        user_id: userId,
        payload: {
          source: 'intake_email',
          confidence: prop.confidence,
          financial_signals: {
            asking_price: prop.asking_price || null,
            cap_rate: prop.cap_rate || null,
            noi: prop.noi || null
          },
          inbox_item_id: inboxItemId
        }
      });
    } catch (err) {
      console.error('[Intake extraction] Property processing error:', err.message || err);
    }
  }
  return propertyIds;
}

// STEP 2 — Process extracted contacts
async function processExtractedContacts(contacts, workspaceId, userId, senderEmail, inboxItemId) {
  const contactIds = [];
  for (const contact of contacts) {
    // Skip sender — handled separately
    if (contact.email && senderEmail && contact.email.toLowerCase() === senderEmail.toLowerCase()) continue;

    try {
      const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();

      // Dedup: check by email first, then by canonical name
      let existing = null;
      if (contact.email) {
        const emailLookup = await opsQuery('GET',
          `entities?workspace_id=eq.${workspaceId}&entity_type=eq.person&email=eq.${encodeURIComponent(contact.email)}&select=*&limit=1`
        );
        existing = emailLookup.ok && emailLookup.data?.length ? emailLookup.data[0] : null;
      }
      if (!existing && fullName) {
        const canonical = normalizeCanonicalName(fullName);
        if (canonical) {
          const nameLookup = await opsQuery('GET',
            `entities?workspace_id=eq.${workspaceId}&entity_type=eq.person&canonical_name=ilike.*${encodeURIComponent(canonical)}*&select=*&limit=1`
          );
          existing = nameLookup.ok && nameLookup.data?.length ? nameLookup.data[0] : null;
        }
      }

      if (existing) {
        // Update null fields with new data
        const updates = {};
        if (!existing.phone && contact.phone) updates.phone = contact.phone;
        if (!existing.title && contact.title) updates.title = contact.title;
        if (!existing.email && contact.email) updates.email = contact.email;
        if (Object.keys(updates).length) {
          updates.updated_at = new Date().toISOString();
          await opsQuery('PATCH',
            `entities?id=eq.${existing.id}&workspace_id=eq.${workspaceId}`,
            updates
          );
        }

        // Link to intake item
        await ensureEntityLink({
          workspaceId, userId,
          sourceSystem: 'intake_email',
          sourceType: 'contact',
          externalId: `intake-contact-${inboxItemId}-${contactIds.length}`,
          entityId: existing.id
        });

        contactIds.push(existing.id);
      } else {
        // Create new contact entity
        const linkResult = await ensureEntityLink({
          workspaceId, userId,
          sourceSystem: 'intake_email',
          sourceType: 'contact',
          externalId: `intake-contact-${inboxItemId}-${contactIds.length}`,
          seedFields: {
            name: fullName || contact.email || 'Unknown contact',
            first_name: contact.first_name || null,
            last_name: contact.last_name || null,
            email: contact.email || null,
            phone: contact.phone || null,
            title: contact.title || null,
            metadata: {
              company: contact.company || null,
              role: contact.role || null,
              source: 'intake_email_extraction'
            }
          }
        });
        if (linkResult.ok) contactIds.push(linkResult.entityId);
      }

      // Write signal
      await writeSignal({
        signal_type: 'entity_extracted_from_email',
        signal_category: 'intelligence',
        entity_type: 'person',
        entity_id: contactIds[contactIds.length - 1] || null,
        user_id: userId,
        payload: {
          source: 'intake_email',
          inbox_item_id: inboxItemId
        }
      });
    } catch (err) {
      console.error('[Intake extraction] Contact processing error:', err.message || err);
    }
  }
  return contactIds;
}

// STEP 2 — Always process the sender as a contact
async function processSender(senderEmail, senderName, workspaceId, userId, inboxItemId) {
  if (!senderEmail) return null;

  try {
    // Dedup check by email
    const lookup = await opsQuery('GET',
      `entities?workspace_id=eq.${workspaceId}&entity_type=eq.person&email=eq.${encodeURIComponent(senderEmail)}&select=*&limit=1`
    );
    const existing = lookup.ok && lookup.data?.length ? lookup.data[0] : null;

    if (existing) {
      // Tag with email_sender if not already tagged
      const tags = existing.tags || [];
      if (!tags.includes('email_sender')) {
        await opsQuery('PATCH',
          `entities?id=eq.${existing.id}&workspace_id=eq.${workspaceId}`,
          { tags: [...tags, 'email_sender'], updated_at: new Date().toISOString() }
        );
      }
      return existing.id;
    }

    // Create new sender entity
    const nameParts = (senderName || '').trim().split(/\s+/);
    const firstName = nameParts[0] || null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    const linkResult = await ensureEntityLink({
      workspaceId, userId,
      sourceSystem: 'intake_email',
      sourceType: 'contact',
      externalId: `sender-${senderEmail.toLowerCase()}`,
      seedFields: {
        name: senderName || senderEmail,
        first_name: firstName,
        last_name: lastName,
        email: senderEmail
      }
    });

    if (linkResult.ok) {
      const entity = linkResult.entity;
      const tags = entity?.tags || [];
      if (!tags.includes('email_sender')) {
        await opsQuery('PATCH',
          `entities?id=eq.${entity.id}&workspace_id=eq.${workspaceId}`,
          { tags: [...tags, 'email_sender'], updated_at: new Date().toISOString() }
        );
      }
      return linkResult.entityId;
    }
  } catch (err) {
    console.error('[Intake extraction] Sender processing error:', err.message || err);
  }
  return null;
}

// Orchestrator — runs all extraction steps (fire-and-forget, never throws)
async function runEntityExtraction(workspaceId, user, inboxItem, subject, body, sender) {
  if (!shouldRunExtraction(body, sender.email)) return;

  const inboxItemId = inboxItem?.id;
  const userId = user.id;

  // Step 1: AI extraction
  const extraction = await extractEntitiesFromEmail(subject, body, sender.email, sender.name);
  if (!extraction) {
    console.error('[Intake extraction] No valid extraction result');
    return;
  }

  // Step 2: Process extracted entities
  const propertyIds = await processExtractedProperties(
    extraction.properties || [], workspaceId, userId, inboxItemId
  );
  const contactIds = await processExtractedContacts(
    extraction.contacts || [], workspaceId, userId, sender.email, inboxItemId
  );

  // Always process the sender as a contact
  const senderId = await processSender(sender.email, sender.name, workspaceId, userId, inboxItemId);
  if (senderId && !contactIds.includes(senderId)) {
    contactIds.push(senderId);
  }

  // Step 3: Enrich inbox item with extraction results
  if (inboxItemId) {
    const current = await opsQuery('GET',
      `inbox_items?id=eq.${inboxItemId}&workspace_id=eq.${workspaceId}&select=metadata&limit=1`
    );
    const currentMeta = current.ok && current.data?.length ? (current.data[0].metadata || {}) : {};

    await opsQuery('PATCH',
      `inbox_items?id=eq.${inboxItemId}&workspace_id=eq.${workspaceId}`,
      {
        metadata: {
          ...currentMeta,
          extracted_entities: {
            property_count: propertyIds.length,
            contact_count: contactIds.length,
            domain: extraction.domain || 'unknown',
            financial_signals: extraction.financial_signals || {},
            property_ids: propertyIds,
            contact_ids: contactIds
          },
          extraction_at: new Date().toISOString(),
          extraction_confidence: extraction.extraction_confidence || 'low'
        }
      }
    );
  }

  // Fire Teams alert for deal-classified emails (listing OM or deal inquiry)
  const financialSignals = extraction.financial_signals || {};
  if (financialSignals.is_listing_om || financialSignals.is_deal_inquiry) {
    const extractedDomain = extraction.domain || 'Unknown';
    sendTeamsAlert({
      title: 'New Deal Email Received',
      summary: subject,
      severity: 'high',
      facts: [
        ['From', sender.name || sender.email || 'Unknown'],
        ['Classified as', financialSignals.is_listing_om ? 'Listing OM' : 'Deal Inquiry'],
        ['Domain', extractedDomain],
        ['Properties found', propertyIds.length]
      ],
      actions: [{ label: 'View in LCC', url: `${process.env.LCC_BASE_URL || ''}/ops` }]
    }).catch(() => {});
  }

  console.log(`[Intake extraction] Done: inbox=${inboxItemId}, properties=${propertyIds.length}, contacts=${contactIds.length}`);
}

// ============================================================================
// INTAKE SUMMARY (was intake-summary.js)
// ============================================================================

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 20;

function parseLimit(raw) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function buildAppBaseUrl(req) {
  if (process.env.LCC_APP_URL) return process.env.LCC_APP_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

function truncate(text, maxLen = 220) {
  if (!text) return '';
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}...`;
}

function correlationToIsoFloor(correlationId) {
  const raw = String(correlationId || '');
  let ts = null;
  const emailMatch = raw.match(/^email-(\d{10,})/);
  if (emailMatch) {
    ts = Number(emailMatch[1]);
  } else {
    const tailMatch = raw.match(/-(\d{10,})$/);
    if (tailMatch) ts = Number(tailMatch[1]);
  }
  if (!Number.isFinite(ts)) return null;
  return new Date(Math.max(0, ts - 5 * 60 * 1000)).toISOString();
}

function mapItemForTeams(item, appBase) {
  const senderName = item.metadata?.sender_name || item.metadata?.sender_email || 'Unknown sender';
  const senderEmail = item.metadata?.sender_email || null;
  const subject = item.title || '(No subject)';
  const summary = truncate(item.body || item.metadata?.body_preview || '');
  const inboxUrl = `${appBase}/?page=pageInbox&inbox_id=${encodeURIComponent(item.id)}`;
  return {
    inbox_item_id: item.id,
    sender: senderName,
    sender_email: senderEmail,
    subject,
    summary,
    received_at: item.received_at || null,
    status: item.status || 'new',
    priority: item.priority || 'normal',
    has_attachments: Boolean(item.metadata?.has_attachments),
    lcc_item_url: inboxUrl,
    suggested_actions: ['triage', 'assign', 'promote']
  };
}

async function handleIntakeSummary(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const limit = parseLimit(req.query.limit);
  const correlationId = req.query.correlation_id ? String(req.query.correlation_id) : '';
  const appBase = buildAppBaseUrl(req);

  let path = `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&source_type=eq.flagged_email&select=id,title,body,status,priority,received_at,metadata&order=received_at.desc&limit=${limit * 6}`;
  const floorIso = correlationToIsoFloor(correlationId);
  if (floorIso) path += `&received_at=gte.${encodeURIComponent(floorIso)}`;

  const result = await opsQuery('GET', path);
  if (!result.ok) {
    return res.status(result.status || 500).json({ error: 'Failed to fetch inbox intake summary' });
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  const filtered = correlationId
    ? rows.filter(r => String(r.metadata?.correlation_id || '') === correlationId)
    : rows;
  const top = filtered.slice(0, limit);
  const items = top.map(item => mapItemForTeams(item, appBase));

  return res.status(200).json({
    correlation_id: correlationId || null,
    workspace_id: workspaceId,
    count: items.length,
    items
  });
}

// ============================================================================
// INTAKE QUEUE — Staged items with extractions + match results
// GET /api/intake?_route=queue[&domain=dialysis|government][&limit=50]
// ============================================================================

async function handleIntakeQueue(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const limit = parseLimit(req.query.limit);
  const domain = req.query.domain || null; // optional: 'dialysis' | 'government'
  const singleIntakeId = req.query.intake_id ? String(req.query.intake_id) : null;

  // Query staged_intake_items joined with extractions and matches.
  // Single-intake mode (when ?intake_id=X is supplied) drops the status
  // filter so finalized intakes can also be looked up — the inbox UI's
  // "View match →" pill calls this with a finalized intake_id and needs
  // the matched property/domain regardless of status.
  let path = `staged_intake_items?workspace_id=eq.${encodeURIComponent(workspaceId)}`;
  if (singleIntakeId) {
    path += `&intake_id=eq.${encodeURIComponent(singleIntakeId)}`;
  } else {
    path += `&status=in.(extracted,matched,review_needed)`;
  }
  path += `&select=intake_id,status,raw_payload,source_email_subject,source_email_sender,created_at,`
    + `staged_intake_extractions(extraction_snapshot),`
    + `staged_intake_matches(match_result,confidence,matched_property_id,matched_domain,property_id,domain,decision,reason)`
    + `&order=created_at.desc&limit=${singleIntakeId ? 1 : limit}`;

  // If domain filter requested, only show items whose match or extraction indicates that domain
  if (domain && !singleIntakeId) {
    path += `&or=(staged_intake_matches.matched_domain.eq.${encodeURIComponent(domain)},`
      + `raw_payload->>domain.eq.${encodeURIComponent(domain)})`;
  }

  const result = await opsQuery('GET', path);
  if (!result.ok) {
    return res.status(result.status || 500).json({ error: 'Failed to fetch intake queue' });
  }

  const rows = (result.data || []).map(row => {
    const extraction = row.staged_intake_extractions?.[0]?.extraction_snapshot || null;
    const match = row.staged_intake_matches?.[0] || null;
    return {
      intake_id: row.intake_id,
      status: row.status,
      source_email_subject: row.source_email_subject || row.raw_payload?.subject || '(No subject)',
      source_email_sender: row.source_email_sender || row.raw_payload?.sender?.email || row.raw_payload?.from || 'Unknown',
      created_at: row.created_at,
      document_type: extraction?.document_type || 'unknown',
      address: extraction?.address || null,
      city: extraction?.city || null,
      state: extraction?.state || null,
      tenant_name: extraction?.tenant_name || null,
      cap_rate: extraction?.cap_rate || null,
      noi: extraction?.noi || null,
      asking_price: extraction?.asking_price || null,
      annual_rent: extraction?.annual_rent || null,
      building_sf: extraction?.building_sf || null,
      match_status: match?.match_result?.status || 'no_match',
      match_reason: match?.match_result?.reason || null,
      match_property_id: match?.matched_property_id || match?.match_result?.property_id || null,
      match_domain: match?.matched_domain || match?.match_result?.domain || null,
      match_candidates: match?.match_result?.candidates || [],
      confidence: match?.confidence ?? null,
      extraction_snapshot: extraction,
    };
  });

  return res.status(200).json({
    workspace_id: workspaceId,
    domain: domain || 'all',
    count: rows.length,
    items: rows
  });
}

// ============================================================================
// PROMOTE — Push extraction data through sidebar pipeline into domain DB
// POST /api/intake?_route=promote  { intake_id, property_id? }
// ============================================================================

async function handleIntakePromote(req, res) {
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

  const { intake_id, property_id } = req.body || {};
  if (!intake_id) return res.status(400).json({ error: 'intake_id required' });

  // 1. Fetch the staged item + extraction
  const itemResult = await opsQuery('GET',
    `staged_intake_items?intake_id=eq.${encodeURIComponent(intake_id)}`
    + `&workspace_id=eq.${encodeURIComponent(workspaceId)}`
    + `&select=intake_id,status,raw_payload,source_email_subject,source_email_sender`
  );
  if (!itemResult.ok || !itemResult.data?.length) {
    return res.status(404).json({ error: 'Intake item not found' });
  }
  const item = itemResult.data[0];

  const extResult = await opsQuery('GET',
    `staged_intake_extractions?intake_id=eq.${encodeURIComponent(intake_id)}&select=extraction_snapshot&limit=1`
  );
  const extraction = extResult.data?.[0]?.extraction_snapshot;
  if (!extraction) {
    return res.status(400).json({ error: 'No extraction data for this intake item' });
  }

  // 2. Build entity metadata in the same shape as a CoStar sidebar save
  const metadata = {
    address: extraction.address || null,
    city: extraction.city || null,
    state: extraction.state || null,
    zip_code: extraction.zip_code || null,
    property_type: extraction.property_type || null,
    tenant_name: extraction.tenant_name || null,
    tenant_guarantor: extraction.tenant_guarantor || null,
    primary_tenant: extraction.tenant_name || null,
    square_footage: extraction.building_sf || null,
    lot_sf: extraction.lot_sf || null,
    year_built: extraction.year_built || null,
    asking_price: extraction.asking_price || null,
    price_per_sf: extraction.price_per_sf || null,
    cap_rate: extraction.cap_rate || null,
    noi: extraction.noi || null,
    annual_rent: extraction.annual_rent || null,
    rent_per_sf: extraction.rent_per_sf || null,
    lease_commencement: extraction.lease_commencement || null,
    lease_expiration: extraction.lease_expiration || null,
    lease_term_years: extraction.lease_term_years || null,
    renewal_options: extraction.renewal_options || null,
    expense_structure: extraction.expense_structure || null,
    rent_escalations: extraction.rent_escalations || null,
    roof_responsibility: extraction.roof_responsibility || null,
    hvac_responsibility: extraction.hvac_responsibility || null,
    structure_responsibility: extraction.structure_responsibility || null,
    parking_responsibility: extraction.parking_responsibility || null,
    document_type: extraction.document_type || null,
    listing_broker: extraction.listing_broker || null,
    listing_broker_email: extraction.listing_broker_email || null,
    listing_firm: extraction.listing_firm || null,
    contacts: [],
    _intake_promoted: true,
    _intake_id: intake_id,
    _intake_source: item.source_email_subject || 'email-intake',
  };

  // Build contacts array from extraction for sidebar pipeline
  if (extraction.listing_broker) {
    metadata.contacts.push({
      name: extraction.listing_broker,
      email: extraction.listing_broker_email || null,
      company: extraction.listing_firm || null,
      role: 'listing_broker',
    });
  }
  if (extraction.seller_name) {
    metadata.contacts.push({
      name: extraction.seller_name,
      role: 'true_seller_contact',
    });
  }

  // 3. Create or link entity
  const entityName = extraction.address
    ? `${extraction.address}${extraction.city ? ', ' + extraction.city : ''}${extraction.state ? ', ' + extraction.state : ''}`
    : item.source_email_subject || 'Intake Property';

  const linkResult = await ensureEntityLink({
    workspaceId,
    userId: user.user_id,
    sourceSystem: 'email_intake',
    sourceType: 'property',
    externalId: intake_id,
    domain: null, // let sidebar pipeline classify
    seedFields: {
      canonical_name: normalizeCanonicalName(entityName),
      display_name: entityName,
      entity_type: 'property',
    },
    metadata,
  });

  const entityId = linkResult.entity?.id || linkResult.entityId;
  if (!entityId) {
    return res.status(500).json({ error: 'Failed to create/link entity' });
  }

  // 4. Run sidebar extraction pipeline (classify domain, propagate to DB)
  const pipelineResult = await processSidebarExtraction(entityId, workspaceId, user.user_id);

  // 5. Record promotion result
  await opsQuery('POST', 'staged_intake_promotions', {
    intake_id,
    workspace_id: workspaceId,
    entity_id: entityId,
    promoted_by: user.user_id,
    pipeline_result: pipelineResult,
    promoted_at: new Date().toISOString(),
  });

  // 6. Update intake item status
  await opsQuery('PATCH',
    `staged_intake_items?intake_id=eq.${encodeURIComponent(intake_id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    { status: 'promoted', updated_at: new Date().toISOString() }
  );

  // 7. Write signal
  await writeSignal({
    workspace_id: workspaceId,
    signal_type: 'intake_promoted',
    entity_id: entityId,
    payload: {
      intake_id,
      domain: pipelineResult.domain,
      property_id: pipelineResult.domain_property_id,
      propagated: pipelineResult.domain_propagated,
    },
    user_id: user.user_id,
  });

  return res.status(200).json({
    ok: true,
    intake_id,
    entity_id: entityId,
    domain: pipelineResult.domain || null,
    domain_property_id: pipelineResult.domain_property_id || null,
    propagated: pipelineResult.domain_propagated || false,
    pipeline_summary: pipelineResult,
  });
}

// ============================================================================
// DISCARD — Mark intake item as discarded
// POST /api/intake?_route=discard  { intake_id }
// ============================================================================

// ============================================================================
// COPILOT ACTION GATEWAY
// POST /api/intake?_route=copilot-action  { action_id, inputs }
// Dispatches typed Copilot actions to their handlers.
// ============================================================================

async function handleCopilotAction(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const user = await authenticate(req, res);
    if (!user) return;

    // Vercel lazy-parses req.body; accessing it on an unparseable payload throws.
    let body;
    try {
      body = req.body || {};
    } catch (bodyErr) {
      return res.status(400).json({ error: 'invalid_json_body', detail: bodyErr?.message });
    }
    // action_id from body OR from the convenience-path rewrite query param
    const action_id = body.action_id || req.query?._preset_action || null;
    const inputs = body.inputs || (action_id && body.action_id ? null : body); // convenience-path: body IS the inputs
    if (!action_id) return res.status(400).json({ error: 'action_id required' });
    if (!inputs)    return res.status(400).json({ error: 'inputs required' });

    // Prefer X-MS-Caller-* headers (multi-user future); fall back to the
    // authenticated LCC user so today's single-user path works even before
    // the Copilot Studio connector wires the caller headers.
    const authContext = {
      email:     (req.headers['x-ms-caller-email']  || user.email        || '').toLowerCase() || null,
      name:       req.headers['x-ms-caller-name']   || user.display_name || null,
      oid:        req.headers['x-ms-caller-oid']    || null,
      tenant_id:  req.headers['x-ms-caller-tenant'] || null,
    };

    const workspaceId = req.headers['x-lcc-workspace']
      || user.memberships?.[0]?.workspace_id
      || process.env.LCC_DEFAULT_WORKSPACE_ID
      || null;

    let result;
    if (action_id === 'intake.stage.om.v1') {
      result = await handleIntakeStageOm({ inputs, authContext, workspaceId });
    } else if (action_id === 'intake.finalize.om.v1') {
      result = await handleIntakeFinalizeOm({ inputs });
    } else if (action_id === 'context.retrieve.entity.v1') {
      const { handleRetrieveEntityContext } = await import('./_handlers/retrieve-entity-context.js');
      result = await handleRetrieveEntityContext({ inputs, authContext, workspaceId });
    } else if (action_id === 'memory.log.turn.v1') {
      const { handleMemoryLogTurn } = await import('./_handlers/memory-log-turn.js');
      result = await handleMemoryLogTurn({ inputs, authContext, workspaceId });
    } else if (action_id === 'intake.prepare_upload.v1') {
      const { handleIntakePrepareUpload } = await import('./_handlers/intake-prepare-upload.js');
      result = await handleIntakePrepareUpload({ inputs, authContext });
    } else if (action_id === 'intake.artifact_download.v1') {
      const { handleIntakeArtifactDownload } = await import('./_handlers/intake-artifact-download.js');
      result = await handleIntakeArtifactDownload({ inputs, authContext });
    } else {
      return res.status(400).json({
        error: 'unknown_action_id',
        action_id,
        supported: [
          'intake.stage.om.v1',
          'intake.finalize.om.v1',
          'context.retrieve.entity.v1',
          'memory.log.turn.v1',
        ],
      });
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    // Log the full error server-side for diagnostics, but return a user-safe
    // envelope so the Copilot agent doesn't surface "SystemError" for what
    // are often soft/expected failures (missing entity, malformed input, etc.)
    console.error('[copilot-action] handler threw:', {
      action_id: req.body?.action_id,
      error: err?.message,
      name: err?.name,
      code: err?.code,
      stack: err?.stack,
    });
    if (res.headersSent) return;
    const isDev = process.env.LCC_ENV === 'development';
    return res.status(500).json({
      ok: false,
      error: 'copilot_action_exception',
      detail: isDev ? (err?.message || String(err)) : 'Unexpected server error. Contact LCC support with the request id.',
      action_id: req.body?.action_id || null,
      hint: 'If this persists, the underlying handler raised a runtime error. Check LCC logs for the request trace.',
      ...(isDev ? { name: err?.name || null, code: err?.code || null } : {}),
    });
  }
}

// ============================================================================
// DISCARD — Mark intake item as discarded
// POST /api/intake?_route=discard  { intake_id }
// ============================================================================

async function handleIntakeDiscard(req, res) {
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

  const { intake_id } = req.body || {};
  if (!intake_id) return res.status(400).json({ error: 'intake_id required' });

  await opsQuery('PATCH',
    `staged_intake_items?intake_id=eq.${encodeURIComponent(intake_id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    { status: 'discarded', updated_at: new Date().toISOString() }
  );

  return res.status(200).json({ ok: true, intake_id, status: 'discarded' });
}

// ============================================================================
// PARSE OM — Extract lease data from raw OM text + push through provenance
// POST /api/intake?_route=parse-om  { text, lease_id?, domain?, filename? }
//
// Two modes:
//   1. Parse only (no lease_id): returns parsed data for preview/review
//   2. Parse + provenance (with lease_id + domain): parses AND pushes
//      responsibility fields through lease_field_provenance at tier 3
// ============================================================================

async function handleParseOm(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const { text, lease_id, domain, filename } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text (raw OM text) required' });
  }

  // Mode 1: Parse only — return structured data for preview
  const parsed = parseOmLeaseAbstract(text);

  if (!lease_id) {
    return res.status(200).json({ ok: true, mode: 'parse_only', parsed });
  }

  // Mode 2: Parse + push through provenance
  if (!domain || !['dialysis', 'government'].includes(domain)) {
    return res.status(400).json({ error: 'domain (dialysis|government) required when lease_id is provided' });
  }

  const result = await processOmDocument(domain, lease_id, text, filename || 'manual-om-paste');

  return res.status(200).json({
    ok: true,
    mode: 'parse_and_provenance',
    parsed: result.parsed,
    provenance_results: result.provenanceResults,
    lease_id,
    domain,
  });
}

// ============================================================================
// PDF INGESTION (Copilot chat / REST)
// ============================================================================
// Accepts a PDF via base64 body or remote URL, extracts text with pdf-parse,
// and creates one inbox_items row flagged for triage. Called from two paths:
//   1. Copilot dispatch: operations.js imports ingestPdfWorker() and invokes
//      it with (params, user, workspaceId) after action validation.
//   2. REST: POST /api/intake?_route=ingest_pdf (or /api/intake-pdf rewrite).

const INGEST_PDF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

async function loadPdfBuffer({ file_content_base64, file_url }) {
  if (file_content_base64) {
    const buf = Buffer.from(file_content_base64, 'base64');
    if (buf.length > INGEST_PDF_MAX_BYTES) {
      throw new Error(`PDF exceeds ${INGEST_PDF_MAX_BYTES} bytes`);
    }
    return { buffer: buf, source: 'base64' };
  }
  if (file_url) {
    const fetched = await fetchUrlArtifact(file_url);
    if (!fetched) {
      throw new Error('file_url could not be fetched (untrusted host, non-PDF, or network failure)');
    }
    const buf = Buffer.from(fetched.base64, 'base64');
    if (buf.length > INGEST_PDF_MAX_BYTES) {
      throw new Error(`PDF exceeds ${INGEST_PDF_MAX_BYTES} bytes`);
    }
    return { buffer: buf, source: 'url', remoteFileName: fetched.fileName };
  }
  throw new Error('Must provide file_content_base64 or file_url');
}

async function extractPdfText(buffer) {
  try {
    const pdfParse = nodeRequire('pdf-parse');
    const out = await pdfParse(buffer);
    return {
      ok: true,
      text: out.text || '',
      pageCount: out.numpages || 0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
      text: '',
      pageCount: 0,
    };
  }
}

/**
 * Core worker. Shared by Copilot dispatch (operations.js) and REST route.
 * @param {object} params - { file_name, file_content_base64?, file_url?, entity_id?, note? }
 * @param {object} user   - authenticated user from auth.js
 * @param {string} workspaceId
 * @returns {Promise<{ok:boolean, data?:object, error?:string}>}
 */
export async function ingestPdfWorker(params, user, workspaceId) {
  const { file_name, file_content_base64, file_url, entity_id, note } = params || {};

  if (!file_name || typeof file_name !== 'string') {
    return { ok: false, error: 'file_name (string) is required' };
  }
  if (!file_content_base64 && !file_url) {
    return { ok: false, error: 'Either file_content_base64 or file_url is required' };
  }

  // Validate entity_id (if provided) belongs to this workspace — cheap safety check
  let validatedEntityId = null;
  if (entity_id) {
    if (typeof entity_id !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(entity_id)) {
      return { ok: false, error: 'entity_id must be a UUID' };
    }
    const entRes = await opsQuery(
      'GET',
      `entities?id=eq.${pgFilterVal(entity_id)}&workspace_id=eq.${pgFilterVal(workspaceId)}&select=id&limit=1`
    );
    if (!entRes.ok || !entRes.data?.length) {
      return { ok: false, error: `entity_id ${entity_id} not found in this workspace` };
    }
    validatedEntityId = entity_id;
  }

  // Load PDF bytes
  let loaded;
  try {
    loaded = await loadPdfBuffer({ file_content_base64, file_url });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const sizeBytes = loaded.buffer.length;

  // Extract text (soft-fail: we still create the intake item)
  const extraction = await extractPdfText(loaded.buffer);
  const fullText = extraction.text || '';
  const pageCount = extraction.pageCount || 0;
  const textPreview = fullText.slice(0, 500);

  const nowIso = new Date().toISOString();
  const title = (note && note.trim()) || file_name;

  const body = extraction.ok
    ? (textPreview || null)
    : '[PDF text extraction failed — manual review required]';

  const metadata = {
    file_name,
    file_size_bytes: sizeBytes,
    page_count: pageCount,
    extracted_text: extraction.ok ? fullText : null,
    extraction_error: extraction.ok ? null : extraction.error,
    note: note || null,
    source_variant: loaded.source,                // 'base64' | 'url'
    remote_file_name: loaded.remoteFileName || null,
    event_source: 'copilot_chat',
    ingested_at: nowIso,
  };

  const insert = await opsQuery('POST', 'inbox_items', {
    workspace_id: workspaceId,
    source_user_id: user.id,
    assigned_to: user.id,
    title,
    body,
    source_type: 'copilot_pdf',
    source_connector_id: null,
    external_id: null,
    external_url: null,
    status: 'new',
    priority: 'normal',
    visibility: 'private',
    entity_id: validatedEntityId,
    metadata,
    received_at: nowIso,
  }, { Prefer: 'return=representation' });

  if (!insert.ok) {
    return {
      ok: false,
      error: 'Failed to create intake item',
      detail: insert.data,
      status: insert.status || 500,
    };
  }

  const item = Array.isArray(insert.data) ? insert.data[0] : insert.data;
  const inboxItemId = item?.id || null;

  const sizeKb = Math.max(1, Math.round(sizeBytes / 1024));
  const pageLabel = pageCount === 1 ? '1 page' : `${pageCount} pages`;
  const baseMsg = extraction.ok
    ? `Created intake item for "${file_name}" (${pageLabel}, ${sizeKb}KB). Triage it in the intake queue.`
    : `Captured "${file_name}" (${sizeKb}KB) but text extraction failed (${extraction.error}). File flagged for manual review.`;

  return {
    ok: true,
    action: 'ingest_pdf_document',
    data: {
      inbox_item_id: inboxItemId,
      file_name,
      page_count: pageCount,
      size_bytes: sizeBytes,
      text_preview: textPreview,
      extraction_ok: extraction.ok,
      entity_id: validatedEntityId,
      message: baseMsg,
    },
  };
}

async function handleIngestPdf(req, res) {
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

  const result = await ingestPdfWorker(req.body || {}, user, workspaceId);
  const status = result.ok ? 200 : (result.status || 400);
  return res.status(status).json(result);
}
