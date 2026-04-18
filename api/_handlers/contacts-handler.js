// ============================================================================
// Unified Contact Hub API
// Life Command Center
//
// Endpoints (routed via vercel.json):
//   POST /api/contacts?action=ingest           — ingest contact from any source
//   GET  /api/contacts?action=list             — list unified contacts
//   GET  /api/contacts?action=get&id=          — get single contact with history
//   GET  /api/contacts?action=history&id=      — get change log for a contact
//   GET  /api/contacts?action=merge_queue      — pending merge suggestions
//   GET  /api/contacts?action=data_quality     — stale/duplicate stats
//   PATCH /api/contacts?action=update&id=      — update a contact
//   POST  /api/contacts?action=classify&id=    — reclassify personal/business
//   POST  /api/contacts?action=merge           — merge two contacts
//   POST  /api/contacts?action=dismiss_merge   — dismiss a merge suggestion
//   POST  /api/contacts?action=ingest_calendar_contacts — extract attendees from calendar events
//   POST  /api/contacts?action=detect_duplicates — run fuzzy match to populate merge queue
// ============================================================================

import { authenticate, requireRole, handleCors } from '../_shared/auth.js';
import { opsQuery, isOpsConfigured, withErrorHandler } from '../_shared/ops-db.js';

const GOV_URL = process.env.GOV_SUPABASE_URL;
const GOV_KEY = process.env.GOV_SUPABASE_KEY;

/** Encode a user-supplied value for safe use in PostgREST filter strings */
function pgVal(v) { return encodeURIComponent(String(v)); }

// Personal email domains — contacts from these default to 'personal'
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'me.com', 'live.com', 'msn.com', 'protonmail.com',
  'mail.com', 'zoho.com', 'yandex.com', 'gmx.com', 'comcast.net',
  'att.net', 'sbcglobal.net', 'cox.net', 'charter.net', 'verizon.net'
]);

// Field-level authority: which source wins for each field
const FIELD_PRIORITY = {
  email:        ['salesforce', 'outlook', 'calendar', 'iphone', 'manual'],
  phone:        ['salesforce', 'outlook', 'webex', 'iphone', 'manual'],
  mobile_phone: ['iphone', 'outlook', 'salesforce', 'manual'],
  title:        ['salesforce', 'outlook', 'manual'],
  company_name: ['salesforce', 'gov_contacts', 'dia_activities', 'outlook', 'manual'],
  city:         ['salesforce', 'gov_contacts', 'manual'],
  state:        ['salesforce', 'gov_contacts', 'manual'],
};

// WebEx API base URL
const WEBEX_API_URL = 'https://webexapis.com/v1';

// Microsoft Graph API base URL
const GRAPH_API_URL = 'https://graph.microsoft.com/v1.0';

/**
 * Get a valid WebEx access token, auto-refreshing if expired.
 * Priority: DB-stored token → env var token → refresh flow.
 */
async function getWebexToken() {
  // 1. Check DB for a stored token
  const dbToken = await govQuery('GET', 'system_tokens?token_key=eq.webex&limit=1');
  if (dbToken.ok && dbToken.data?.length > 0) {
    const row = dbToken.data[0];
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
    // If token is still valid (with 5-min buffer), use it
    if (expiresAt && expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return row.access_token;
    }
    // Token expired — try to refresh using DB-stored refresh token
    const refreshToken = row.refresh_token || process.env.WEBEX_REFRESH_TOKEN;
    if (refreshToken) {
      const refreshed = await refreshWebexToken(refreshToken);
      if (refreshed) return refreshed.access_token;
    }
  }

  // 2. No DB token — try env var
  const envToken = process.env.WEBEX_ACCESS_TOKEN;
  if (envToken) {
    // Test if env token is still valid
    const testRes = await fetch(`${WEBEX_API_URL}/people/me`, {
      headers: { 'Authorization': `Bearer ${envToken}` }
    });
    if (testRes.ok) {
      // Seed DB with env token (no known expiry, assume 14 days from now)
      const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      await upsertWebexToken(envToken, process.env.WEBEX_REFRESH_TOKEN || null, expires);
      return envToken;
    }
    // Env token expired — try refresh
    const refreshToken = process.env.WEBEX_REFRESH_TOKEN;
    if (refreshToken) {
      const refreshed = await refreshWebexToken(refreshToken);
      if (refreshed) return refreshed.access_token;
    }
  }

  return null;
}

/**
 * Refresh WebEx token using OAuth2 refresh_token grant.
 */
async function refreshWebexToken(refreshToken) {
  const clientId = process.env.WEBEX_CLIENT_ID;
  const clientSecret = process.env.WEBEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  });

  const res = await fetch('https://webexapis.com/v1/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) return null;

  const data = await res.json();
  const expiresAt = new Date(Date.now() + (data.expires_in || 1209599) * 1000).toISOString();
  const refreshExpiresAt = data.refresh_token_expires_in
    ? new Date(Date.now() + data.refresh_token_expires_in * 1000).toISOString()
    : null;

  await upsertWebexToken(data.access_token, data.refresh_token || refreshToken, expiresAt, refreshExpiresAt);
  return data;
}

/**
 * Store/update WebEx token in system_tokens table.
 */
async function upsertWebexToken(accessToken, refreshToken, expiresAt, refreshExpiresAt) {
  // Try update first
  const existing = await govQuery('GET', 'system_tokens?token_key=eq.webex&limit=1');
  if (existing.ok && existing.data?.length > 0) {
    const updates = { access_token: accessToken, expires_at: expiresAt };
    if (refreshToken) updates.refresh_token = refreshToken;
    if (refreshExpiresAt) updates.refresh_expires_at = refreshExpiresAt;
    await auditedPatchGov({
      table: 'system_tokens',
      filter: 'token_key=eq.webex',
      recordIdentifier: 'webex',
      idColumn: 'token_key',
      changedFields: updates,
      sourceSurface: 'contacts_token_refresh',
      notes: 'Refresh WebEx token material',
      propagationScope: 'system_token'
    });
  } else {
    await auditedInsertGov({
      table: 'system_tokens',
      recordIdentifier: 'webex',
      idColumn: 'token_key',
      changedFields: {
      token_key: 'webex',
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      refresh_expires_at: refreshExpiresAt
      },
      sourceSurface: 'contacts_token_refresh',
      notes: 'Create WebEx token material',
      propagationScope: 'system_token'
    });
  }
}

/**
 * Query Gov Supabase via PostgREST.
 */
async function govQuery(method, path, body, extraHeaders = {}) {
  if (!GOV_URL || !GOV_KEY) {
    return { ok: false, status: 503, data: { error: 'Gov database not configured' } };
  }
  const url = `${GOV_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': GOV_KEY,
    'Authorization': `Bearer ${GOV_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'GET' ? 'count=exact' : 'return=representation',
    ...extraHeaders
  };
  const opts = { method, headers };
  if (body && (method === 'POST' || method === 'PATCH')) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  let count = 0;
  const contentRange = res.headers.get('content-range');
  if (contentRange) {
    const match = contentRange.match(/\/(\d+)/);
    if (match) count = parseInt(match[1], 10);
  }
  return { ok: res.ok, status: res.status, data, count };
}

async function auditedGovWrite({
  workspaceId,
  user,
  method,
  path,
  targetTable,
  recordIdentifier = null,
  idColumn = null,
  changedFields = {},
  sourceSurface = 'contacts_api',
  notes = null,
  propagationScope = null
}) {
  const resolvedWorkspaceId = workspaceId || user?.memberships?.[0]?.workspace_id || null;
  const result = await govQuery(method, path, changedFields);

  if (!isOpsConfigured() || !resolvedWorkspaceId) {
    return result;
  }

  const actor = user?.display_name || user?.email || user?.id || 'system';
  const correctionBase = {
    workspace_id: resolvedWorkspaceId,
    actor,
    source_surface: sourceSurface,
    target_table: targetTable,
    target_source: 'gov',
    record_identifier: recordIdentifier != null ? String(recordIdentifier) : null,
    id_column: idColumn,
    changed_fields: changedFields || {},
    notes,
    propagation_scope: propagationScope || null,
    applied_at: new Date().toISOString()
  };

  if (!result.ok) {
    await opsQuery('POST', 'pending_updates', {
      workspace_id: resolvedWorkspaceId,
      target_source: 'gov',
      target_table: targetTable,
      record_identifier: recordIdentifier != null ? String(recordIdentifier) : null,
      id_column: idColumn,
      mutation_mode: method === 'POST' ? 'insert' : 'patch',
      source_surface: sourceSurface,
      actor,
      status: 'needs_review',
      changed_fields: changedFields || {},
      notes,
      error_details: {
        stage: method.toLowerCase(),
        status: result.status,
        detail: result.data
      },
      propagation_scope: propagationScope || null
    }).catch(e => console.warn('[contacts] Audit log failed:', e.message));

    return result;
  }

  await opsQuery('POST', 'data_corrections', {
    ...correctionBase,
    applied_mode: method === 'POST' ? 'contacts_insert' : 'contacts_patch',
    reconciliation_result: {},
    propagation_result: {}
  }).catch(e => console.warn('[contacts] Audit log failed:', e.message));

  return result;
}

function auditedPatchGov({ workspaceId, user, table, filter, recordIdentifier, idColumn, changedFields, sourceSurface, notes, propagationScope }) {
  return auditedGovWrite({
    workspaceId,
    user,
    method: 'PATCH',
    path: `${table}?${filter}`,
    targetTable: table,
    recordIdentifier,
    idColumn,
    changedFields,
    sourceSurface,
    notes,
    propagationScope
  });
}

function auditedInsertGov({ workspaceId, user, table, recordIdentifier, idColumn, changedFields, sourceSurface, notes, propagationScope }) {
  return auditedGovWrite({
    workspaceId,
    user,
    method: 'POST',
    path: table,
    targetTable: table,
    recordIdentifier,
    idColumn,
    changedFields,
    sourceSurface,
    notes,
    propagationScope
  });
}

function ensureGovWriteOk(result, res, fallbackMessage) {
  if (result?.ok) return true;
  if (res && !res.headersSent) {
    res.status(result?.status || 500).json({
      error: fallbackMessage || 'Gov write failed',
      detail: result?.data || null
    });
  }
  return false;
}

export const contactsHandler = withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (!GOV_URL || !GOV_KEY) {
    return res.status(503).json({ error: 'Gov database not configured. Set GOV_SUPABASE_URL and GOV_SUPABASE_KEY.' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const { action, id } = req.query;

  // ---- GET endpoints ----
  if (req.method === 'GET') {
    switch (action) {
      case 'list':         return listContacts(req, res);
      case 'get':          return getContact(req, res, id);
      case 'history':      return getHistory(req, res, id);
      case 'merge_queue':  return getMergeQueue(req, res);
      case 'data_quality': return getDataQuality(req, res);
      case 'hot_leads':       return getHotLeads(req, res);
      case 'messages_teams':  return getTeamsMessages(req, res, id);
      case 'messages_webex':  return getWebexMessages(req, res, id);
      case 'messages_sms':    return getSmsMessages(req, res, id);
      case 'message_templates': return getMessageTemplates(req, res);
      default:
        return res.status(400).json({ error: 'GET action: list, get, history, merge_queue, data_quality, hot_leads, messages_teams, messages_webex, messages_sms, message_templates' });
    }
  }

  // ---- POST endpoints ----
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }
    switch (action) {
      case 'ingest':                  return ingestContact(req, res, user);
      case 'ingest_webex_calls':      return ingestWebexCalls(req, res, user);
      case 'ingest_calendar_contacts': return ingestCalendarContacts(req, res, user, workspaceId);
      case 'detect_duplicates':       return detectDuplicates(req, res, user);
      case 'classify':                return classifyContact(req, res, user, id);
      case 'merge':                   return mergeContacts(req, res, user);
      case 'dismiss_merge':           return dismissMerge(req, res, user);
      case 'send_teams':             return sendTeamsMessage(req, res, user, id);
      case 'send_webex':             return sendWebexMessage(req, res, user, id);
      case 'send_sms':               return sendSmsMessage(req, res, user, id);
      default:
        return res.status(400).json({ error: 'POST action: ingest, ingest_webex_calls, ingest_calendar_contacts, detect_duplicates, classify, merge, dismiss_merge, send_teams, send_webex, send_sms' });
    }
  }

  // ---- PATCH endpoints ----
  if (req.method === 'PATCH') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }
    if (action === 'update') return updateContact(req, res, user, id);
    return res.status(400).json({ error: 'PATCH action: update' });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
});

// ============================================================================
// LIST — paginated, filtered unified contacts
// ============================================================================

async function listContacts(req, res) {
  const {
    contact_class = 'business',
    search,
    limit: limitParam,
    offset: offsetParam,
    order,
    min_engagement
  } = req.query;

  const limit = Math.min(Math.max(parseInt(limitParam) || 50, 1), 500);
  const offset = Math.max(parseInt(offsetParam) || 0, 0);
  const rawOrder = order || 'updated_at.desc';
  const orderBy = /^[a-zA-Z0-9_.,]+$/.test(rawOrder) ? rawOrder : 'updated_at.desc';

  let path = `unified_contacts?contact_class=eq.${pgVal(contact_class)}&limit=${limit}&offset=${offset}&order=${orderBy}`;

  // Filter by minimum engagement score if specified
  if (min_engagement) {
    const minScore = parseInt(min_engagement, 10);
    if (minScore > 0) path += `&engagement_score=gte.${minScore}`;
  }

  if (search) {
    // Search across name, email, company using OR filter
    const q = pgVal(search);
    path += `&or=(full_name.ilike.*${q}*,email.ilike.*${q}*,company_name.ilike.*${q}*,phone.ilike.*${q}*)`;
  }

  const result = await govQuery('GET', path);
  if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch contacts', detail: result.data });

  return res.status(200).json({
    contacts: result.data || [],
    total: result.count,
    limit,
    offset
  });
}

// ============================================================================
// GET — single contact with source badges
// ============================================================================

async function getContact(req, res, id) {
  if (!id) return res.status(400).json({ error: 'id is required' });

  const result = await govQuery('GET', `unified_contacts?unified_id=eq.${pgVal(id)}&limit=1`);
  if (!result.ok || !result.data?.length) return res.status(404).json({ error: 'Contact not found' });

  const contact = result.data[0];

  // Build source badges
  const sources = [];
  if (contact.sf_contact_id) sources.push({ system: 'salesforce', id: contact.sf_contact_id, synced: contact.last_synced_sf });
  if (contact.outlook_contact_id) sources.push({ system: 'outlook', id: contact.outlook_contact_id, synced: contact.last_synced_outlook });
  if (contact.last_synced_calendar) sources.push({ system: 'calendar', synced: contact.last_synced_calendar });
  if (contact.webex_person_id) sources.push({ system: 'webex', id: contact.webex_person_id });
  if (contact.teams_user_id) sources.push({ system: 'teams', id: contact.teams_user_id });
  if (contact.icloud_contact_id) sources.push({ system: 'icloud', id: contact.icloud_contact_id });
  if (contact.gov_contact_id) sources.push({ system: 'gov_db', id: contact.gov_contact_id });
  if (contact.dia_contact_id) sources.push({ system: 'dia_db', id: contact.dia_contact_id });

  // Touchpoint count: fan out across every known email address for this
  // contact (primary, secondary, and any learned aliases) and sum matches
  // in inbox_items. This is what drives the "Touchpoints" stat on the
  // contact detail drawer — a single-address join misses contacts like
  // Sarah Martin / Nathanael Berwaldt who email from multiple addresses.
  const workspaceId = req.headers['x-lcc-workspace'];
  const touchpoint = await computeContactTouchpoints(contact, workspaceId);

  // Engagement summary
  const engagementSummary = {
    score: contact.engagement_score || 0,
    last_call: contact.last_call_date,
    last_email: contact.last_email_date || touchpoint.last_touch_date,
    last_meeting: contact.last_meeting_date,
    total_calls: contact.total_calls || 0,
    total_emails: contact.total_emails_sent || 0,
    touchpoint_count: touchpoint.count,
    touchpoint_addresses: touchpoint.addresses,
    last_touch_date: touchpoint.last_touch_date,
    heat: contact.engagement_score >= 60 ? 'hot'
      : contact.engagement_score >= 30 ? 'warm'
      : contact.engagement_score > 0 ? 'cool'
      : 'cold'
  };

  return res.status(200).json({ contact, sources, engagement: engagementSummary });
}

// ============================================================================
// TOUCHPOINT COUNT — match inbox_items against all known addresses
// ============================================================================

/**
 * Collect every email address we know about for a contact. Handles
 * display-name-wrapped values like `"Sarah Martin <sarah@x.com>"` and
 * comma/semicolon delimited lists in case legacy rows have them.
 */
function collectContactEmails(contact) {
  const out = new Set();
  const push = (val) => {
    if (val == null) return;
    const str = String(val);
    // Extract anything that looks like an email address (incl. from
    // display-name-wrapped strings like "Jane Doe <jane@x.com>")
    const matches = str.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    for (const m of matches) out.add(m.toLowerCase().trim());
  };

  push(contact.email);
  push(contact.email_secondary);
  if (Array.isArray(contact.email_aliases)) {
    for (const a of contact.email_aliases) push(a);
  } else if (typeof contact.email_aliases === 'string') {
    push(contact.email_aliases);
  }
  return Array.from(out);
}

/**
 * Count inbox_items whose stored email metadata references any of the
 * contact's known addresses. We match on:
 *   - metadata->>'sender_email'  (from address)
 *   - metadata->>'reply_to'      (reply-to header, when captured)
 *   - metadata->>'to_emails'     (delivered-to list, when captured)
 *   - metadata->>'cc_emails'     (cc list, when captured)
 *
 * Any row that references any of the contact's addresses in any of those
 * fields counts once.
 */
async function computeContactTouchpoints(contact, workspaceId) {
  const emails = collectContactEmails(contact);
  const empty = { count: 0, addresses: emails, last_touch_date: null };
  if (!emails.length || !isOpsConfigured()) return empty;

  // Build a single OR filter that hits every email-bearing metadata field
  // for every known address. PostgREST disallows commas inside OR children,
  // so we percent-encode the value (includes the leading `*`).
  const fields = ['sender_email', 'reply_to', 'to_emails', 'cc_emails'];
  const orClauses = [];
  for (const email of emails) {
    const enc = encodeURIComponent(`*${email}*`);
    for (const f of fields) {
      orClauses.push(`metadata->>${f}.ilike.${enc}`);
    }
  }
  if (!orClauses.length) return empty;

  const workspaceFilter = workspaceId
    ? `workspace_id=eq.${encodeURIComponent(workspaceId)}&`
    : '';
  const path =
    `inbox_items?${workspaceFilter}` +
    `or=(${orClauses.join(',')})` +
    `&select=id,received_at&order=received_at.desc&limit=500`;

  try {
    const result = await opsQuery('GET', path);
    if (!result.ok) {
      console.warn('[contacts] touchpoint query failed:', result.status, result.data);
      return empty;
    }
    const rows = Array.isArray(result.data) ? result.data : [];
    const lastTouch = rows[0]?.received_at || null;
    return {
      count: rows.length,
      addresses: emails,
      last_touch_date: lastTouch
    };
  } catch (err) {
    console.warn('[contacts] touchpoint query error:', err.message || err);
    return empty;
  }
}

// ============================================================================
// HISTORY — change log for a contact
// ============================================================================

async function getHistory(req, res, id) {
  if (!id) return res.status(400).json({ error: 'id is required' });

  const result = await govQuery('GET',
    `contact_change_log?unified_id=eq.${pgVal(id)}&order=changed_at.desc&limit=100`
  );

  return res.status(200).json({ history: result.data || [] });
}

// ============================================================================
// INGEST — receive a contact from any source, run entity resolution, create or merge
// ============================================================================

async function ingestContact(req, res, user) {
  const {
    source, contact_class: requestedClass,
    first_name, last_name, email, phone, mobile_phone,
    company_name, title, city, state, website,
    sf_contact_id, sf_account_id, outlook_contact_id,
    webex_person_id, teams_user_id, icloud_contact_id,
    entity_type, contact_type, industry,
    engagement  // optional: { call_date, call_duration, email_date, meeting_date }
  } = req.body || {};

  const VALID_SOURCES = ['salesforce', 'outlook', 'calendar', 'webex', 'teams', 'teams_call', 'iphone', 'icloud', 'iphone_call', 'manual'];
  if (!source || !VALID_SOURCES.includes(source)) {
    return res.status(400).json({ error: `source is required, one of: ${VALID_SOURCES.join(', ')}` });
  }
  if (!first_name && !last_name && !email && !phone) {
    return res.status(400).json({ error: 'At least first_name, last_name, email, or phone is required' });
  }

  // Auto-classify if not specified
  let contactClass = requestedClass;
  if (!contactClass) {
    contactClass = autoClassify(source, email);
  }

  // --- Entity Resolution ---
  // Try to find existing contact by email, phone, or name+company
  let existingId = null;
  let matchTier = null;
  let matchScore = 0;

  // Tier 0: Email exact match
  if (email) {
    const emailMatch = await govQuery('GET',
      `unified_contacts?email=ilike.${encodeURIComponent(email)}&limit=1`
    );
    if (emailMatch.ok && emailMatch.data?.length > 0) {
      existingId = emailMatch.data[0].unified_id;
      matchTier = 0;
      matchScore = 1.0;
    }
  }

  // Tier 1: Phone exact match (if no email match)
  if (!existingId && phone) {
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length >= 7) {
      const phoneMatch = await govQuery('GET',
        `unified_contacts?phone=ilike.*${digits.slice(-7)}*&limit=5`
      );
      if (phoneMatch.ok && phoneMatch.data?.length > 0) {
        // Verify digits match
        for (const candidate of phoneMatch.data) {
          const candidateDigits = (candidate.phone || '').replace(/[^0-9]/g, '');
          if (candidateDigits === digits) {
            existingId = candidate.unified_id;
            matchTier = 1;
            matchScore = 0.9;
            break;
          }
        }
      }
    }
  }

  // Tier 2: SF contact ID match
  if (!existingId && sf_contact_id) {
    const sfMatch = await govQuery('GET',
      `unified_contacts?sf_contact_id=eq.${pgVal(sf_contact_id)}&limit=1`
    );
    if (sfMatch.ok && sfMatch.data?.length > 0) {
      existingId = sfMatch.data[0].unified_id;
      matchTier = 0;
      matchScore = 1.0;
    }
  }

  // Tier 3: Outlook contact ID match
  if (!existingId && outlook_contact_id) {
    const outlookMatch = await govQuery('GET',
      `unified_contacts?outlook_contact_id=eq.${pgVal(outlook_contact_id)}&limit=1`
    );
    if (outlookMatch.ok && outlookMatch.data?.length > 0) {
      existingId = outlookMatch.data[0].unified_id;
      matchTier = 0;
      matchScore = 1.0;
    }
  }

  // Tier 3b: WebEx person ID match
  if (!existingId && webex_person_id) {
    const webexMatch = await govQuery('GET',
      `unified_contacts?webex_person_id=eq.${pgVal(webex_person_id)}&limit=1`
    );
    if (webexMatch.ok && webexMatch.data?.length > 0) {
      existingId = webexMatch.data[0].unified_id;
      matchTier = 0;
      matchScore = 1.0;
    }
  }

  // Tier 3c: Teams user ID match
  if (!existingId && teams_user_id) {
    const teamsMatch = await govQuery('GET',
      `unified_contacts?teams_user_id=eq.${pgVal(teams_user_id)}&limit=1`
    );
    if (teamsMatch.ok && teamsMatch.data?.length > 0) {
      existingId = teamsMatch.data[0].unified_id;
      matchTier = 0;
      matchScore = 1.0;
    }
  }

  // Tier 3d: iCloud contact ID match
  if (!existingId && icloud_contact_id) {
    const icloudMatch = await govQuery('GET',
      `unified_contacts?icloud_contact_id=eq.${pgVal(icloud_contact_id)}&limit=1`
    );
    if (icloudMatch.ok && icloudMatch.data?.length > 0) {
      existingId = icloudMatch.data[0].unified_id;
      matchTier = 0;
      matchScore = 1.0;
    }
  }

  const now = new Date().toISOString();
  const syncField = source === 'salesforce' ? 'last_synced_sf'
    : source === 'outlook' ? 'last_synced_outlook'
    : (source === 'calendar' || source === 'teams' || source === 'teams_call') ? 'last_synced_calendar'
    : null;

  // Build field_sources provenance
  const fieldSources = {};
  const incomingFields = { first_name, last_name, email, phone, mobile_phone, title, company_name, city, state, website };
  for (const [key, val] of Object.entries(incomingFields)) {
    if (val) {
      fieldSources[key] = { source, updated_at: now };
    }
  }

  if (existingId) {
    // --- MERGE: Update existing contact ---
    const existing = (await govQuery('GET', `unified_contacts?unified_id=eq.${pgVal(existingId)}&limit=1`)).data?.[0];
    if (!existing) return res.status(500).json({ error: 'Failed to fetch existing contact for merge' });

    const updates = {};
    const fieldsChanged = {};

    // Apply field-level authority resolution
    for (const [field, val] of Object.entries(incomingFields)) {
      if (!val) continue;
      const currentVal = existing[field];
      if (currentVal === val) continue; // No change

      const priority = FIELD_PRIORITY[field];
      if (priority) {
        const currentSource = existing.field_sources?.[field]?.source;
        const currentPriority = currentSource ? priority.indexOf(currentSource) : 999;
        const incomingPriority = priority.indexOf(source);
        // Incoming wins if higher priority (lower index) or same priority (most recent wins)
        if (incomingPriority !== -1 && (incomingPriority <= currentPriority || currentPriority === -1 || currentPriority === 999)) {
          updates[field] = val;
          fieldsChanged[field] = { old: currentVal, new: val };
        }
      } else {
        // No priority defined — fill if empty, otherwise most recent from same source wins
        if (!currentVal) {
          updates[field] = val;
          fieldsChanged[field] = { old: null, new: val };
        }
      }
    }

    // Always update source linkages
    if (sf_contact_id && !existing.sf_contact_id) updates.sf_contact_id = sf_contact_id;
    if (sf_account_id && !existing.sf_account_id) updates.sf_account_id = sf_account_id;
    if (outlook_contact_id && !existing.outlook_contact_id) updates.outlook_contact_id = outlook_contact_id;
    if (webex_person_id && !existing.webex_person_id) updates.webex_person_id = webex_person_id;
    if (teams_user_id && !existing.teams_user_id) updates.teams_user_id = teams_user_id;
    if (icloud_contact_id && !existing.icloud_contact_id) updates.icloud_contact_id = icloud_contact_id;
    if (entity_type && !existing.entity_type) updates.entity_type = entity_type;
    if (contact_type && !existing.contact_type) updates.contact_type = contact_type;
    if (industry && !existing.industry) updates.industry = industry;
    if (syncField) updates[syncField] = now;

    // Update engagement signals if provided
    if (engagement) {
      if (engagement.call_date) {
        const callDate = new Date(engagement.call_date).toISOString();
        if (!existing.last_call_date || callDate > existing.last_call_date) {
          updates.last_call_date = callDate;
        }
        updates.total_calls = (existing.total_calls || 0) + 1;
      }
      if (engagement.email_date) {
        const emailDate = new Date(engagement.email_date).toISOString();
        if (!existing.last_email_date || emailDate > existing.last_email_date) {
          updates.last_email_date = emailDate;
        }
        updates.total_emails_sent = (existing.total_emails_sent || 0) + 1;
      }
      if (engagement.meeting_date) {
        const meetingDate = new Date(engagement.meeting_date).toISOString();
        if (!existing.last_meeting_date || meetingDate > existing.last_meeting_date) {
          updates.last_meeting_date = meetingDate;
        }
      }
      // Recompute engagement score
      updates.engagement_score = computeEngagementScore(
        updates.last_call_date || existing.last_call_date,
        updates.last_email_date || existing.last_email_date,
        updates.last_meeting_date || existing.last_meeting_date,
        updates.total_calls ?? existing.total_calls ?? 0,
        updates.total_emails_sent ?? existing.total_emails_sent ?? 0
      );
    }

    // Merge field_sources
    const mergedFieldSources = { ...(existing.field_sources || {}), ...fieldSources };
    updates.field_sources = mergedFieldSources;

    if (Object.keys(updates).length > 0) {
      await auditedPatchGov({
        user,
        table: 'unified_contacts',
        filter: `unified_id=eq.${pgVal(existingId)}`,
        recordIdentifier: existingId,
        idColumn: 'unified_id',
        changedFields: updates,
        sourceSurface: 'contacts_ingest_merge',
        propagationScope: 'unified_contact'
      });

      // Log the merge
      if (Object.keys(fieldsChanged).length > 0) {
        await auditedInsertGov({
          user,
          table: 'contact_change_log',
          recordIdentifier: existingId,
          idColumn: 'unified_id',
          changedFields: {
          unified_id: existingId,
          change_type: 'update',
          source,
          fields_changed: fieldsChanged,
          changed_by: user.display_name || user.id
          },
          sourceSurface: 'contacts_ingest_merge',
          propagationScope: 'contact_change_log'
        });
      }
    }

    return res.status(200).json({
      action: 'merged',
      unified_id: existingId,
      match_tier: matchTier,
      match_score: matchScore,
      fields_updated: Object.keys(fieldsChanged)
    });
  } else {
    // --- CREATE: New contact ---
    const newContact = {
      contact_class: contactClass,
      first_name: first_name || null,
      last_name: last_name || null,
      email: email || null,
      phone: phone || null,
      mobile_phone: mobile_phone || null,
      title: title || null,
      company_name: company_name || null,
      city: city || null,
      state: state || null,
      website: website || null,
      entity_type: entity_type || null,
      contact_type: contact_type || null,
      industry: industry || null,
      sf_contact_id: sf_contact_id || null,
      sf_account_id: sf_account_id || null,
      outlook_contact_id: outlook_contact_id || null,
      webex_person_id: webex_person_id || null,
      teams_user_id: teams_user_id || null,
      icloud_contact_id: icloud_contact_id || null,
      field_sources: fieldSources,
      match_confidence: 1.0,
      match_method: source === 'manual' ? 'manual' : `${source}_import`
    };
    if (syncField) newContact[syncField] = now;

    // Set initial engagement signals if provided
    if (engagement) {
      if (engagement.call_date) {
        newContact.last_call_date = new Date(engagement.call_date).toISOString();
        newContact.total_calls = 1;
      }
      if (engagement.email_date) {
        newContact.last_email_date = new Date(engagement.email_date).toISOString();
        newContact.total_emails_sent = 1;
      }
      if (engagement.meeting_date) {
        newContact.last_meeting_date = new Date(engagement.meeting_date).toISOString();
      }
      newContact.engagement_score = computeEngagementScore(
        newContact.last_call_date, newContact.last_email_date,
        newContact.last_meeting_date, newContact.total_calls || 0,
        newContact.total_emails_sent || 0
      );
    }

    const result = await auditedInsertGov({
      user,
      table: 'unified_contacts',
      changedFields: newContact,
      sourceSurface: 'contacts_ingest_create',
      propagationScope: 'unified_contact'
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: 'Failed to create contact', detail: result.data });
    }

    const created = Array.isArray(result.data) ? result.data[0] : result.data;

    // Log creation
    await auditedInsertGov({
      user,
      table: 'contact_change_log',
      recordIdentifier: created.unified_id,
      idColumn: 'unified_id',
      changedFields: {
      unified_id: created.unified_id,
      change_type: 'create',
      source,
      fields_changed: incomingFields,
      changed_by: user.display_name || user.id
      },
      sourceSurface: 'contacts_ingest_create',
      propagationScope: 'contact_change_log'
    });

    return res.status(201).json({
      action: 'created',
      unified_id: created.unified_id,
      contact_class: contactClass
    });
  }
}

// ============================================================================
// CLASSIFY — reclassify a contact between personal and business
// ============================================================================

async function classifyContact(req, res, user, id) {
  if (!id) return res.status(400).json({ error: 'id is required' });
  const { contact_class } = req.body || {};
  if (!contact_class || !['business', 'personal'].includes(contact_class)) {
    return res.status(400).json({ error: 'contact_class must be "business" or "personal"' });
  }

  // Get current class
  const existing = await govQuery('GET', `unified_contacts?unified_id=eq.${pgVal(id)}&select=contact_class&limit=1`);
  if (!existing.ok || !existing.data?.length) return res.status(404).json({ error: 'Contact not found' });

  const oldClass = existing.data[0].contact_class;
  if (oldClass === contact_class) {
    return res.status(200).json({ message: 'Already classified as ' + contact_class });
  }

  const classifyResult = await auditedPatchGov({
    user,
    table: 'unified_contacts',
    filter: `unified_id=eq.${pgVal(id)}`,
    recordIdentifier: id,
    idColumn: 'unified_id',
    changedFields: { contact_class },
    sourceSurface: 'contacts_classify',
    propagationScope: 'unified_contact'
  });
  if (!ensureGovWriteOk(classifyResult, res, 'Failed to classify contact')) return;

  // Log classification change
  const classLogResult = await auditedInsertGov({
    user,
    table: 'contact_change_log',
    recordIdentifier: id,
    idColumn: 'unified_id',
    changedFields: {
    unified_id: id,
    change_type: 'classify',
    source: 'manual',
    fields_changed: { contact_class: { old: oldClass, new: contact_class } },
    changed_by: user.display_name || user.id
    },
    sourceSurface: 'contacts_classify',
    propagationScope: 'contact_change_log'
  });
  if (!ensureGovWriteOk(classLogResult, res, 'Failed to log classification change')) return;

  return res.status(200).json({
    unified_id: id,
    old_class: oldClass,
    new_class: contact_class
  });
}

// ============================================================================
// UPDATE — manual field edits
// ============================================================================

async function updateContact(req, res, user, id) {
  if (!id) return res.status(400).json({ error: 'id is required' });

  const allowedFields = [
    'first_name', 'last_name', 'email', 'email_secondary', 'phone', 'mobile_phone',
    'title', 'company_name', 'city', 'state', 'website',
    'entity_type', 'contact_type', 'industry', 'is_1031_buyer'
  ];

  const body = req.body || {};
  const updates = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  // Get existing for change tracking
  const existing = await govQuery('GET', `unified_contacts?unified_id=eq.${pgVal(id)}&limit=1`);
  if (!existing.ok || !existing.data?.length) return res.status(404).json({ error: 'Contact not found' });

  const fieldsChanged = {};
  for (const [k, v] of Object.entries(updates)) {
    if (existing.data[0][k] !== v) {
      fieldsChanged[k] = { old: existing.data[0][k], new: v };
    }
  }

  // Update field_sources for changed fields
  const now = new Date().toISOString();
  const fieldSources = { ...(existing.data[0].field_sources || {}) };
  for (const field of Object.keys(fieldsChanged)) {
    fieldSources[field] = { source: 'manual', updated_at: now };
  }
  updates.field_sources = fieldSources;

  const updateResult = await auditedPatchGov({
    user,
    table: 'unified_contacts',
    filter: `unified_id=eq.${pgVal(id)}`,
    recordIdentifier: id,
    idColumn: 'unified_id',
    changedFields: updates,
    sourceSurface: 'contacts_update',
    propagationScope: 'unified_contact'
  });
  if (!ensureGovWriteOk(updateResult, res, 'Failed to update contact')) return;

  if (Object.keys(fieldsChanged).length > 0) {
    const updateLogResult = await auditedInsertGov({
      user,
      table: 'contact_change_log',
      recordIdentifier: id,
      idColumn: 'unified_id',
      changedFields: {
      unified_id: id,
      change_type: 'update',
      source: 'manual',
      fields_changed: fieldsChanged,
      changed_by: user.display_name || user.id
      },
      sourceSurface: 'contacts_update',
      propagationScope: 'contact_change_log'
    });
    if (!ensureGovWriteOk(updateLogResult, res, 'Failed to log contact update')) return;
  }

  return res.status(200).json({ unified_id: id, fields_updated: Object.keys(fieldsChanged) });
}

// ============================================================================
// MERGE — combine two contacts into one
// ============================================================================

async function mergeContacts(req, res, user) {
  const { keep_id, merge_id, queue_id } = req.body || {};
  if (!keep_id || !merge_id) {
    return res.status(400).json({ error: 'keep_id and merge_id are required' });
  }

  // Fetch both
  const [keepResult, mergeResult] = await Promise.all([
    govQuery('GET', `unified_contacts?unified_id=eq.${pgVal(keep_id)}&limit=1`),
    govQuery('GET', `unified_contacts?unified_id=eq.${pgVal(merge_id)}&limit=1`)
  ]);

  if (!keepResult.data?.length) return res.status(404).json({ error: 'keep_id contact not found' });
  if (!mergeResult.data?.length) return res.status(404).json({ error: 'merge_id contact not found' });

  const keep = keepResult.data[0];
  const merge = mergeResult.data[0];

  // Fill empty fields from the merged contact
  const updates = {};
  const fillableFields = [
    'first_name', 'last_name', 'email', 'email_secondary', 'phone', 'mobile_phone',
    'title', 'company_name', 'city', 'state', 'website',
    'entity_type', 'contact_type', 'industry',
    'sf_contact_id', 'sf_account_id', 'gov_contact_id', 'dia_contact_id',
    'true_owner_id', 'recorded_owner_id', 'outlook_contact_id',
    'webex_person_id', 'teams_user_id', 'icloud_contact_id'
  ];

  for (const field of fillableFields) {
    if (!keep[field] && merge[field]) {
      updates[field] = merge[field];
    }
  }

  // If keep has no email but merge does, and merge has a secondary, preserve both
  if (!keep.email && merge.email) {
    updates.email = merge.email;
    if (merge.email_secondary) updates.email_secondary = merge.email_secondary;
  } else if (keep.email && merge.email && keep.email !== merge.email && !keep.email_secondary) {
    updates.email_secondary = merge.email;
  }

  // Update merge history
  const now = new Date().toISOString();
  const mergeHistory = [...(keep.merge_history || []), {
    merged_from: merge_id,
    merged_at: now,
    fields_updated: Object.keys(updates)
  }];
  updates.merge_history = mergeHistory;
  updates.field_sources = { ...(keep.field_sources || {}), ...(merge.field_sources || {}) };

  // Apply updates to kept contact
  if (Object.keys(updates).length > 0) {
    const mergePatchResult = await auditedPatchGov({
      user,
      table: 'unified_contacts',
      filter: `unified_id=eq.${pgVal(keep_id)}`,
      recordIdentifier: keep_id,
      idColumn: 'unified_id',
      changedFields: updates,
      sourceSurface: 'contacts_merge',
      propagationScope: 'unified_contact'
    });
    if (!ensureGovWriteOk(mergePatchResult, res, 'Failed to update kept contact during merge')) return;
  }

  // Log the merge
  const mergeLogResult = await auditedInsertGov({
    user,
    table: 'contact_change_log',
    recordIdentifier: keep_id,
    idColumn: 'unified_id',
    changedFields: {
    unified_id: keep_id,
    change_type: 'merge',
    source: 'manual',
    fields_changed: updates,
    merged_from: merge_id,
    changed_by: user.display_name || user.id
    },
    sourceSurface: 'contacts_merge',
    propagationScope: 'contact_change_log'
  });
  if (!ensureGovWriteOk(mergeLogResult, res, 'Failed to log contact merge')) return;

  // Delete the merged contact
  await govQuery('DELETE', `unified_contacts?unified_id=eq.${pgVal(merge_id)}`);

  // Update merge queue if queue_id provided
  if (queue_id) {
    const mergeQueueResult = await auditedPatchGov({
      user,
      table: 'contact_merge_queue',
      filter: `queue_id=eq.${pgVal(queue_id)}`,
      recordIdentifier: queue_id,
      idColumn: 'queue_id',
      changedFields: {
      status: 'merged',
      reviewed_by: user.display_name || user.id,
      reviewed_at: now
      },
      sourceSurface: 'contacts_merge',
      propagationScope: 'contact_merge_queue'
    });
    if (!ensureGovWriteOk(mergeQueueResult, res, 'Failed to update merge queue')) return;
  }

  return res.status(200).json({
    action: 'merged',
    kept: keep_id,
    removed: merge_id,
    fields_filled: Object.keys(updates)
  });
}

// ============================================================================
// DISMISS MERGE — dismiss a merge suggestion
// ============================================================================

async function dismissMerge(req, res, user) {
  const { queue_id } = req.body || {};
  if (!queue_id) return res.status(400).json({ error: 'queue_id is required' });

  const dismissResult = await auditedPatchGov({
    user,
    table: 'contact_merge_queue',
    filter: `queue_id=eq.${pgVal(queue_id)}`,
    recordIdentifier: queue_id,
    idColumn: 'queue_id',
    changedFields: {
    status: 'dismissed',
    reviewed_by: user.display_name || user.id,
    reviewed_at: new Date().toISOString()
    },
    sourceSurface: 'contacts_dismiss_merge',
    propagationScope: 'contact_merge_queue'
  });
  if (!ensureGovWriteOk(dismissResult, res, 'Failed to dismiss merge suggestion')) return;

  return res.status(200).json({ queue_id, status: 'dismissed' });
}

// ============================================================================
// MERGE QUEUE — pending duplicates for review
// ============================================================================

async function getMergeQueue(req, res) {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const result = await govQuery('GET',
    `contact_merge_queue?status=eq.pending&order=match_score.desc,created_at.desc&limit=${limit}`
  );

  return res.status(200).json({ queue: result.data || [], total: result.count });
}

// ============================================================================
// DATA QUALITY — stale contacts, duplicate stats
// ============================================================================

async function getDataQuality(req, res) {
  const [staleEmail, stalePhone, mergeQueueCount, totalContacts, hotLeads, withWebex] = await Promise.all([
    govQuery('GET', 'unified_contacts?email_stale=eq.true&select=unified_id&limit=0'),
    govQuery('GET', 'unified_contacts?phone_stale=eq.true&select=unified_id&limit=0'),
    govQuery('GET', 'contact_merge_queue?status=eq.pending&select=queue_id&limit=0'),
    govQuery('GET', 'unified_contacts?select=unified_id&limit=0'),
    govQuery('GET', 'unified_contacts?contact_class=eq.business&engagement_score=gte.60&select=unified_id&limit=0'),
    govQuery('GET', 'unified_contacts?webex_person_id=not.is.null&select=unified_id&limit=0')
  ]);

  return res.status(200).json({
    total_contacts: totalContacts.count || 0,
    stale_emails: staleEmail.count || 0,
    stale_phones: stalePhone.count || 0,
    pending_merges: mergeQueueCount.count || 0,
    hot_leads: hotLeads.count || 0,
    webex_linked: withWebex.count || 0
  });
}

// ============================================================================
// HOT LEADS — top engaged business contacts
// ============================================================================

async function getHotLeads(req, res) {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const result = await govQuery('GET',
    `unified_contacts?contact_class=eq.business&engagement_score=gt.0&order=engagement_score.desc&limit=${limit}&select=unified_id,full_name,email,phone,company_name,title,engagement_score,last_call_date,last_email_date,last_meeting_date,total_calls,total_emails_sent,sf_contact_id,webex_person_id`
  );

  const contacts = (result.data || []).map(c => ({
    ...c,
    heat: c.engagement_score >= 60 ? 'hot'
      : c.engagement_score >= 30 ? 'warm'
      : c.engagement_score > 0 ? 'cool'
      : 'cold'
  }));

  return res.status(200).json({ hot_leads: contacts, total: result.count });
}

// ============================================================================
// INGEST WEBEX CALLS — bulk ingest call history from WebEx API
// ============================================================================

async function ingestWebexCalls(req, res, user) {
  const webexToken = await getWebexToken();
  if (!webexToken) {
    return res.status(503).json({ error: 'WebEx token not configured or refresh failed. Set WEBEX_ACCESS_TOKEN, WEBEX_REFRESH_TOKEN, WEBEX_CLIENT_ID, WEBEX_CLIENT_SECRET.' });
  }

  const { max = 200 } = req.body || {};

  // WebEx API requires separate calls for placed vs received
  let callHistory = [];
  try {
    const [placedRes, receivedRes] = await Promise.all([
      fetch(`${WEBEX_API_URL}/telephony/calls/history?type=placed&max=${max}`, {
        headers: { 'Authorization': `Bearer ${webexToken}` }
      }),
      fetch(`${WEBEX_API_URL}/telephony/calls/history?type=received&max=${max}`, {
        headers: { 'Authorization': `Bearer ${webexToken}` }
      })
    ]);

    if (!placedRes.ok && !receivedRes.ok) {
      const errText = await placedRes.text().catch(() => '');
      return res.status(placedRes.status).json({ error: 'WebEx API error', detail: errText });
    }

    if (placedRes.ok) {
      const placed = await placedRes.json();
      callHistory.push(...(placed.items || []));
    }
    if (receivedRes.ok) {
      const received = await receivedRes.json();
      callHistory.push(...(received.items || []));
    }
  } catch (e) {
    console.error('[contacts] WebEx call history fetch failed:', e.message);
    return res.status(502).json({ error: 'Failed to fetch WebEx call history' });
  }

  // Deduplicate by number+time (same call can appear in both placed/received for internal)
  const seen = new Set();
  callHistory = callHistory.filter(call => {
    const key = `${call.number}|${call.time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let matched = 0, created = 0, skipped = 0, failed = 0;
  const now = new Date().toISOString();

  for (const call of callHistory) {
    try {
      // Actual WebEx API format: { type, name, number, time, privacyEnabled }
      const phone = call.number;
      const name = call.name || '';
      const callDate = call.time || now;
      const direction = call.type; // 'placed' or 'received'

      if (!phone) continue;

      // Skip generic/unknown callers like "WIRELESS CALLER"
      const skipNames = ['WIRELESS CALLER', 'UNKNOWN', 'ANONYMOUS', 'PRIVATE'];
      const isUnknownName = !name || skipNames.includes(name.toUpperCase());

      // Try to find existing contact by phone
      const digits = phone.replace(/[^0-9]/g, '');
      let existingId = null;

      if (digits.length >= 7) {
        const phoneMatch = await govQuery('GET',
          `unified_contacts?phone=ilike.*${digits.slice(-7)}*&limit=5`
        );
        if (phoneMatch.ok && phoneMatch.data?.length > 0) {
          for (const candidate of phoneMatch.data) {
            const candidateDigits = (candidate.phone || '').replace(/[^0-9]/g, '');
            if (candidateDigits === digits || candidateDigits.endsWith(digits.slice(-10))) {
              existingId = candidate.unified_id;
              break;
            }
          }
        }
      }

      // Also try mobile_phone
      if (!existingId && digits.length >= 7) {
        const mobileMatch = await govQuery('GET',
          `unified_contacts?mobile_phone=ilike.*${digits.slice(-7)}*&limit=5`
        );
        if (mobileMatch.ok && mobileMatch.data?.length > 0) {
          for (const candidate of mobileMatch.data) {
            const candidateDigits = (candidate.mobile_phone || '').replace(/[^0-9]/g, '');
            if (candidateDigits === digits || candidateDigits.endsWith(digits.slice(-10))) {
              existingId = candidate.unified_id;
              break;
            }
          }
        }
      }

      if (existingId) {
        // Update engagement signals on existing contact
        const existing = (await govQuery('GET', `unified_contacts?unified_id=eq.${pgVal(existingId)}&select=last_call_date,total_calls,last_email_date,last_meeting_date,total_emails_sent,engagement_score&limit=1`)).data?.[0];
        if (existing) {
          const callTimestamp = new Date(callDate).toISOString();
          const newTotalCalls = (existing.total_calls || 0) + 1;
          const newLastCall = !existing.last_call_date || callTimestamp > existing.last_call_date
            ? callTimestamp : existing.last_call_date;

          const newScore = computeEngagementScore(
            newLastCall, existing.last_email_date, existing.last_meeting_date,
            newTotalCalls, existing.total_emails_sent || 0
          );

          await auditedPatchGov({
            user,
            table: 'unified_contacts',
            filter: `unified_id=eq.${pgVal(existingId)}`,
            recordIdentifier: existingId,
            idColumn: 'unified_id',
            changedFields: {
            last_call_date: newLastCall,
            total_calls: newTotalCalls,
            engagement_score: newScore
            },
            sourceSurface: 'contacts_webex_ingest',
            propagationScope: 'unified_contact_engagement'
          });

          // Log engagement update
          await auditedInsertGov({
            user,
            table: 'contact_change_log',
            recordIdentifier: existingId,
            idColumn: 'unified_id',
            changedFields: {
            unified_id: existingId,
            change_type: 'engagement',
            source: 'webex',
            fields_changed: {
              call_date: callTimestamp,
              direction,
              new_total_calls: newTotalCalls,
              new_score: newScore
            },
            changed_by: 'system'
            },
            sourceSurface: 'contacts_webex_ingest',
            propagationScope: 'contact_change_log'
          });

          matched++;
        }
      } else if (isUnknownName) {
        // Don't create stubs for "WIRELESS CALLER" etc. with no match
        skipped++;
      } else {
        // Create a new contact stub from WebEx call
        // Parse name: WebEx returns "FIRST LAST" in uppercase for caller ID
        const titleCaseName = name.replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        const nameParts = titleCaseName.trim().split(/\s+/);
        const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : nameParts[0] || null;
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;
        const callTimestamp = new Date(callDate).toISOString();

        const newContact = {
          contact_class: 'business',
          first_name: firstName,
          last_name: lastName,
          phone,
          last_call_date: callTimestamp,
          total_calls: 1,
          engagement_score: computeEngagementScore(callTimestamp, null, null, 1, 0),
          field_sources: { phone: { source: 'webex', updated_at: now } },
          match_confidence: 0.5,
          match_method: 'webex_call'
        };

        const result = await auditedInsertGov({
          user,
          table: 'unified_contacts',
          changedFields: newContact,
          sourceSurface: 'contacts_webex_ingest',
          propagationScope: 'unified_contact'
        });
        if (result.ok) {
          const createdContact = Array.isArray(result.data) ? result.data[0] : result.data;
          await auditedInsertGov({
            user,
            table: 'contact_change_log',
            recordIdentifier: createdContact.unified_id,
            idColumn: 'unified_id',
            changedFields: {
            unified_id: createdContact.unified_id,
            change_type: 'create',
            source: 'webex',
            fields_changed: { phone, name: titleCaseName, call_date: callTimestamp, direction },
            changed_by: 'system'
            },
            sourceSurface: 'contacts_webex_ingest',
            propagationScope: 'contact_change_log'
          });
          created++;
        }
      }
    } catch (e) {
      failed++;
    }
  }

  return res.status(200).json({
    action: 'webex_call_ingest',
    total_calls: callHistory.length,
    matched,
    created,
    skipped,
    failed
  });
}

// ============================================================================
// INGEST CALENDAR CONTACTS — extract meeting attendees into unified contacts
// ============================================================================

async function ingestCalendarContacts(req, res, user, workspaceId) {
  const { days_back = 90, limit: maxEvents = 500 } = req.body || {};

  // Pull calendar events from OPS Supabase (already synced by /api/sync?action=ingest_calendar)
  const eventsResult = await opsQuery('GET',
    `activity_events?category=eq.meeting&source_type=eq.outlook&workspace_id=eq.${workspaceId}&order=occurred_at.desc&limit=${maxEvents}&select=metadata,occurred_at`
  );

  if (!eventsResult.ok) {
    return res.status(500).json({ error: 'Failed to fetch calendar events', detail: eventsResult.data });
  }

  const events = eventsResult.data || [];
  const cutoff = new Date(Date.now() - days_back * 86400000);
  let matched = 0, created = 0, skipped = 0, failed = 0;
  const seen = new Set(); // dedupe by email within this batch

  for (const event of events) {
    const eventDate = event.occurred_at;
    if (new Date(eventDate) < cutoff) continue;

    const attendees = event.metadata?.attendees || [];
    for (const att of attendees) {
      try {
        const email = (att.emailAddress?.address || att.email || '').trim().toLowerCase();
        const name = att.emailAddress?.name || att.name || '';

        if (!email || seen.has(email)) continue;
        seen.add(email);

        // Skip the user's own email
        if (email === user.email?.toLowerCase()) continue;

        // Skip noreply/resource addresses
        if (email.includes('noreply') || email.includes('resource') || email.includes('room@') || email.includes('conf-')) {
          skipped++;
          continue;
        }

        // Check if contact already exists by email
        const existing = await govQuery('GET',
          `unified_contacts?email=ilike.${encodeURIComponent(email)}&limit=1`
        );

        if (existing.ok && existing.data?.length > 0) {
          // Update meeting engagement on existing contact
          const contact = existing.data[0];
          const meetingDate = new Date(eventDate).toISOString();
          const newLastMeeting = !contact.last_meeting_date || meetingDate > contact.last_meeting_date
            ? meetingDate : contact.last_meeting_date;

          const newScore = computeEngagementScore(
            contact.last_call_date, contact.last_email_date, newLastMeeting,
            contact.total_calls || 0, contact.total_emails_sent || 0
          );

          await auditedPatchGov({
            user,
            table: 'unified_contacts',
            filter: `unified_id=eq.${pgVal(contact.unified_id)}`,
            recordIdentifier: contact.unified_id,
            idColumn: 'unified_id',
            changedFields: {
            last_meeting_date: newLastMeeting,
            engagement_score: newScore
            },
            sourceSurface: 'contacts_calendar_ingest',
            propagationScope: 'unified_contact_engagement'
          });
          matched++;
        } else {
          // Create new contact from attendee
          const nameParts = name.trim().split(/\s+/);
          const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : nameParts[0] || null;
          const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;
          const contactClass = autoClassify('calendar', email);
          const meetingDate = new Date(eventDate).toISOString();
          const now = new Date().toISOString();

          const newContact = {
            contact_class: contactClass,
            first_name: firstName,
            last_name: lastName,
            email,
            last_meeting_date: meetingDate,
            last_synced_calendar: now,
            engagement_score: computeEngagementScore(null, null, meetingDate, 0, 0),
            field_sources: {
              email: { source: 'calendar', updated_at: now },
              first_name: { source: 'calendar', updated_at: now }
            },
            match_confidence: 0.7,
            match_method: 'calendar_attendee'
          };

          const result = await auditedInsertGov({
            user,
            table: 'unified_contacts',
            changedFields: newContact,
            sourceSurface: 'contacts_calendar_ingest',
            propagationScope: 'unified_contact'
          });
          if (result.ok) {
            const createdContact = Array.isArray(result.data) ? result.data[0] : result.data;
            await auditedInsertGov({
              user,
              table: 'contact_change_log',
              recordIdentifier: createdContact.unified_id,
              idColumn: 'unified_id',
              changedFields: {
              unified_id: createdContact.unified_id,
              change_type: 'create',
              source: 'calendar',
              fields_changed: { email, name, meeting_date: meetingDate },
              changed_by: 'system'
              },
              sourceSurface: 'contacts_calendar_ingest',
              propagationScope: 'contact_change_log'
            });
            created++;
          } else {
            failed++;
          }
        }
      } catch (e) {
        failed++;
      }
    }
  }

  return res.status(200).json({
    action: 'calendar_contact_ingest',
    events_scanned: events.length,
    unique_attendees: seen.size,
    matched,
    created,
    skipped,
    failed
  });
}

// ============================================================================
// DETECT DUPLICATES — fuzzy match contacts and populate merge queue
// ============================================================================

async function detectDuplicates(req, res, user) {
  const { batch_size = 200, min_score = 0.7 } = req.body || {};

  // Fetch contacts that haven't been checked recently (or all for first run)
  const contactsResult = await govQuery('GET',
    `unified_contacts?contact_class=eq.business&order=updated_at.desc&limit=${batch_size}&select=unified_id,first_name,last_name,full_name,email,phone,company_name`
  );

  if (!contactsResult.ok) {
    return res.status(500).json({ error: 'Failed to fetch contacts', detail: contactsResult.data });
  }

  const contacts = contactsResult.data || [];
  let duplicatesFound = 0, alreadyQueued = 0;

  // Get existing pending queue entries to avoid re-queuing
  const existingQueue = await govQuery('GET',
    'contact_merge_queue?status=eq.pending&select=contact_a,contact_b&limit=5000'
  );
  const queuedPairs = new Set();
  if (existingQueue.ok && existingQueue.data) {
    for (const q of existingQueue.data) {
      queuedPairs.add(`${q.contact_a}|${q.contact_b}`);
      queuedPairs.add(`${q.contact_b}|${q.contact_a}`);
    }
  }

  for (let i = 0; i < contacts.length; i++) {
    const a = contacts[i];

    for (let j = i + 1; j < contacts.length; j++) {
      const b = contacts[j];
      if (a.unified_id === b.unified_id) continue;

      // Skip if already in queue
      if (queuedPairs.has(`${a.unified_id}|${b.unified_id}`)) {
        alreadyQueued++;
        continue;
      }

      let score = 0;
      let reason = '';

      // 1. Duplicate email (exact match, different records)
      if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
        score = 1.0;
        reason = 'duplicate_email';
      }

      // 2. Phone match (last 7+ digits)
      if (!reason && a.phone && b.phone) {
        const aDigits = a.phone.replace(/[^0-9]/g, '');
        const bDigits = b.phone.replace(/[^0-9]/g, '');
        if (aDigits.length >= 7 && bDigits.length >= 7 && aDigits.slice(-10) === bDigits.slice(-10)) {
          score = 0.9;
          reason = 'phone_match';
        }
      }

      // 3. Name + Company fuzzy match
      if (!reason && a.last_name && b.last_name && a.company_name && b.company_name) {
        const nameA = (a.full_name || '').toLowerCase();
        const nameB = (b.full_name || '').toLowerCase();
        const companyA = a.company_name.toLowerCase();
        const companyB = b.company_name.toLowerCase();

        // Same company, similar names
        if (companyA === companyB || companyA.includes(companyB) || companyB.includes(companyA)) {
          const nameSim = jaroWinkler(nameA, nameB);
          if (nameSim >= min_score) {
            score = nameSim;
            reason = 'name_company_fuzzy';
          }
        }
      }

      // 4. Exact name match (different records, no email/phone to distinguish)
      if (!reason && a.full_name && b.full_name) {
        const nameA = a.full_name.toLowerCase().trim();
        const nameB = b.full_name.toLowerCase().trim();
        if (nameA === nameB && nameA.length > 3) {
          score = 0.85;
          reason = 'exact_name_match';
        }
      }

      if (score >= min_score && reason) {
        await auditedInsertGov({
          user,
          table: 'contact_merge_queue',
          recordIdentifier: a.unified_id,
          idColumn: 'contact_a',
          changedFields: {
          contact_a: a.unified_id,
          contact_b: b.unified_id,
          match_score: score,
          match_reason: reason,
          status: 'pending'
          },
          sourceSurface: 'contacts_detect_duplicates',
          propagationScope: 'contact_merge_queue'
        });
        queuedPairs.add(`${a.unified_id}|${b.unified_id}`);
        duplicatesFound++;
      }
    }
  }

  return res.status(200).json({
    action: 'detect_duplicates',
    contacts_scanned: contacts.length,
    duplicates_found: duplicatesFound,
    already_queued: alreadyQueued
  });
}

/**
 * Jaro-Winkler similarity (0..1). Used for fuzzy name matching.
 */
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1.length || !s2.length) return 0.0;

  const maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0, transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler: boost for common prefix (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

// ============================================================================
// ENGAGEMENT SCORE COMPUTATION (JavaScript mirror of SQL function)
// ============================================================================

function computeEngagementScore(lastCallDate, lastEmailDate, lastMeetingDate, totalCalls, totalEmailsSent) {
  let score = 0;
  const now = Date.now();

  // Call recency (max 30)
  if (lastCallDate) {
    const daysSinceCall = (now - new Date(lastCallDate).getTime()) / 86400000;
    if (daysSinceCall < 7) score += 30;
    else if (daysSinceCall < 30) score += 20;
    else if (daysSinceCall < 90) score += 10;
    else if (daysSinceCall < 365) score += 3;
  }

  // Email recency (max 20)
  if (lastEmailDate) {
    const daysSinceEmail = (now - new Date(lastEmailDate).getTime()) / 86400000;
    if (daysSinceEmail < 7) score += 20;
    else if (daysSinceEmail < 30) score += 15;
    else if (daysSinceEmail < 90) score += 5;
    else if (daysSinceEmail < 365) score += 2;
  }

  // Call frequency (max 20)
  if (totalCalls > 10) score += 20;
  else if (totalCalls > 5) score += 15;
  else if (totalCalls > 0) score += 10;

  // Meeting recency (max 15)
  if (lastMeetingDate) {
    const daysSinceMeeting = (now - new Date(lastMeetingDate).getTime()) / 86400000;
    if (daysSinceMeeting < 7) score += 15;
    else if (daysSinceMeeting < 30) score += 10;
    else if (daysSinceMeeting < 90) score += 5;
    else if (daysSinceMeeting < 365) score += 2;
  }

  // Email frequency bonus (max 15)
  if (totalEmailsSent > 20) score += 15;
  else if (totalEmailsSent > 10) score += 10;
  else if (totalEmailsSent > 3) score += 5;

  return Math.min(score, 100);
}

// ============================================================================
// AUTO-CLASSIFICATION
// ============================================================================

function autoClassify(source, email) {
  // Salesforce contacts are always business
  if (source === 'salesforce') return 'business';

  // WebEx contacts are always business (org calls)
  if (source === 'webex') return 'business';

  // Teams contacts/calls are always business (org communications)
  if (source === 'teams' || source === 'teams_call') return 'business';

  // iPhone call log: default business unless personal domain detected
  if (source === 'iphone_call') return 'business';

  // iCloud-only contacts default to personal
  if (source === 'icloud') return 'personal';

  // iPhone contacts: check email domain, default business (Exchange sync path)
  if (source === 'iphone') {
    if (email) {
      const domain = email.split('@')[1]?.toLowerCase();
      if (domain && PERSONAL_DOMAINS.has(domain)) return 'personal';
    }
    return 'business';
  }

  // Check email domain for personal detection
  if (email) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && PERSONAL_DOMAINS.has(domain)) {
      return 'personal';
    }
  }

  // Default to business (don't lose potential deals)
  return 'business';
}

// ============================================================================
// MESSAGE TEMPLATES — shorter variants for chat/SMS channels
// ============================================================================

const MESSAGE_TEMPLATES = [
  {
    id: 'quick_followup',
    name: 'Quick Follow-Up',
    channels: ['teams', 'webex'],
    template: 'Hi {first_name}, wanted to follow up on {deal_name}. Do you have a few minutes this week to connect? I can share some recent market data that may be relevant.'
  },
  {
    id: 'market_update',
    name: 'Market Update',
    channels: ['sms', 'teams', 'webex'],
    template: 'Hi {first_name}, 10Y Treasury at {rate}%. Seeing interesting activity in the {deal_type} space. Happy to discuss — Scott Briggs, Northmarq'
  },
  {
    id: 'meeting_invite',
    name: 'Meeting Invite',
    channels: ['teams', 'webex'],
    template: 'Hi {first_name}, would you be available for a quick call about {deal_name}? I have some comps and market insights to share. Let me know what works.'
  },
  {
    id: 'intro_sms',
    name: 'Introduction',
    channels: ['sms'],
    template: 'Hi {first_name}, this is Scott Briggs from Northmarq. I wanted to reach out regarding {deal_name}. Would you have time for a brief call?'
  },
  {
    id: 'thank_you',
    name: 'Thank You',
    channels: ['teams', 'webex', 'sms'],
    template: 'Hi {first_name}, thanks for taking the time to connect today. I\'ll follow up with the details we discussed. Looking forward to next steps.'
  }
];

function getMessageTemplates(req, res) {
  const { channel } = req.query;
  const templates = channel
    ? MESSAGE_TEMPLATES.filter(t => t.channels.includes(channel))
    : MESSAGE_TEMPLATES;
  return res.status(200).json({ templates });
}

// ============================================================================
// TEAMS MESSAGING — read & send via Microsoft Graph API
// ============================================================================

async function getTeamsMessages(req, res, id) {
  if (!id) return res.status(400).json({ error: 'id is required' });

  const graphToken = process.env.MS_GRAPH_TOKEN;
  if (!graphToken) {
    return res.status(503).json({ error: 'MS_GRAPH_TOKEN not configured. Set up delegated OAuth for Teams messaging.' });
  }

  // Look up the contact to get their email or teams_user_id
  const contact = await getContactForMessaging(id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  if (!contact.email && !contact.teams_user_id) {
    return res.status(400).json({ error: 'Contact has no email or Teams user ID for messaging' });
  }

  try {
    // Find the 1:1 chat with this contact
    const chatId = await findTeamsChat(graphToken, contact.email || contact.teams_user_id);
    if (!chatId) {
      return res.status(200).json({ messages: [], chat_id: null, note: 'No existing Teams chat with this contact' });
    }

    // Fetch messages from the chat
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const msgRes = await fetch(
      `${GRAPH_API_URL}/me/chats/${chatId}/messages?$top=${limit}&$orderby=createdDateTime desc`,
      { headers: { 'Authorization': `Bearer ${graphToken}` } }
    );

    if (!msgRes.ok) {
      const errText = await msgRes.text().catch(() => '');
      return res.status(msgRes.status).json({ error: 'Failed to fetch Teams messages', detail: errText });
    }

    const msgData = await msgRes.json();
    const messages = (msgData.value || []).map(m => ({
      id: m.id,
      from: m.from?.user?.displayName || 'Unknown',
      from_email: m.from?.user?.email || null,
      content: m.body?.content || '',
      content_type: m.body?.contentType || 'text',
      created_at: m.createdDateTime,
      is_from_me: m.from?.user?.id === 'me' || false
    }));

    return res.status(200).json({ messages, chat_id: chatId, channel: 'teams' });
  } catch (e) {
    console.error('[contacts] Teams API error:', e.message);
    return res.status(502).json({ error: 'Teams API error' });
  }
}

async function sendTeamsMessage(req, res, user, id) {
  if (!id) return res.status(400).json({ error: 'id is required' });

  const graphToken = process.env.MS_GRAPH_TOKEN;
  if (!graphToken) {
    return res.status(503).json({ error: 'MS_GRAPH_TOKEN not configured' });
  }

  const { message, template_id } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });

  const contact = await getContactForMessaging(id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  if (!contact.email && !contact.teams_user_id) {
    return res.status(400).json({ error: 'Contact has no email or Teams user ID' });
  }

  try {
    // Find or create a 1:1 chat
    let chatId = await findTeamsChat(graphToken, contact.email || contact.teams_user_id);

    if (!chatId) {
      // Create a new 1:1 chat
      const createRes = await fetch(`${GRAPH_API_URL}/me/chats`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${graphToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chatType: 'oneOnOne',
          members: [
            { '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `${GRAPH_API_URL}/users('me')` },
            { '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `${GRAPH_API_URL}/users('${contact.email || contact.teams_user_id}')` }
          ]
        })
      });
      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => '');
        return res.status(createRes.status).json({ error: 'Failed to create Teams chat', detail: errText });
      }
      const chatData = await createRes.json();
      chatId = chatData.id;
    }

    // Send the message
    const sendRes = await fetch(`${GRAPH_API_URL}/me/chats/${chatId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${graphToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ body: { content: message } })
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text().catch(() => '');
      return res.status(sendRes.status).json({ error: 'Failed to send Teams message', detail: errText });
    }

    const sentMsg = await sendRes.json();

    // Update engagement: Teams messages count as digital correspondence
    await updateEngagementOnMessage(id, 'teams', user);

    // Log in change log
    await auditedInsertGov({
      workspaceId: user.memberships?.[0]?.workspace_id,
      user,
      table: 'contact_change_log',
      recordIdentifier: id,
      idColumn: 'unified_id',
      changedFields: {
      unified_id: id,
      change_type: 'engagement',
      source: 'teams',
      fields_changed: { message_sent: { channel: 'teams', template_id: template_id || null, timestamp: new Date().toISOString() } },
      changed_by: user.display_name || user.id
      },
      sourceSurface: 'contacts_send_teams',
      propagationScope: 'contact_change_log'
    });

    return res.status(200).json({ sent: true, message_id: sentMsg.id, chat_id: chatId, channel: 'teams' });
  } catch (e) {
    console.error('[contacts] Teams send error:', e.message);
    return res.status(502).json({ error: 'Teams send error' });
  }
}

async function findTeamsChat(graphToken, contactIdentifier) {
  // List 1:1 chats and find the one with this contact
  const res = await fetch(
    `${GRAPH_API_URL}/me/chats?$filter=chatType eq 'oneOnOne'&$expand=members&$top=50`,
    { headers: { 'Authorization': `Bearer ${graphToken}` } }
  );
  if (!res.ok) return null;

  const data = await res.json();
  const identifier = contactIdentifier.toLowerCase();

  for (const chat of (data.value || [])) {
    const members = chat.members || [];
    for (const member of members) {
      const email = (member.email || '').toLowerCase();
      const userId = (member.userId || '').toLowerCase();
      if (email === identifier || userId === identifier) {
        return chat.id;
      }
    }
  }
  return null;
}

// ============================================================================
// WEBEX MESSAGING — read & send via WebEx REST API
// ============================================================================

async function getWebexMessages(req, res, id) {
  if (!id) return res.status(400).json({ error: 'id is required' });

  const webexToken = process.env.WEBEX_ACCESS_TOKEN;
  if (!webexToken) {
    return res.status(503).json({ error: 'WEBEX_ACCESS_TOKEN not configured' });
  }

  const contact = await getContactForMessaging(id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  if (!contact.email && !contact.webex_person_id) {
    return res.status(400).json({ error: 'Contact has no email or WebEx person ID for messaging' });
  }

  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    // WebEx: list direct messages with a person by email
    const personEmail = contact.email;
    if (!personEmail) {
      return res.status(200).json({ messages: [], note: 'WebEx messaging requires email' });
    }

    // List 1:1 rooms, then get messages from the direct room
    const roomsRes = await fetch(
      `${WEBEX_API_URL}/rooms?type=direct&max=50`,
      { headers: { 'Authorization': `Bearer ${webexToken}` } }
    );

    if (!roomsRes.ok) {
      return res.status(roomsRes.status).json({ error: 'Failed to list WebEx rooms' });
    }

    const roomsData = await roomsRes.json();
    let targetRoomId = null;

    // Find the room with this contact — check memberships
    for (const room of (roomsData.items || [])) {
      const memberRes = await fetch(
        `${WEBEX_API_URL}/memberships?roomId=${room.id}&max=10`,
        { headers: { 'Authorization': `Bearer ${webexToken}` } }
      );
      if (memberRes.ok) {
        const memberData = await memberRes.json();
        const hasContact = (memberData.items || []).some(m =>
          m.personEmail?.toLowerCase() === personEmail.toLowerCase()
        );
        if (hasContact) {
          targetRoomId = room.id;
          break;
        }
      }
    }

    if (!targetRoomId) {
      return res.status(200).json({ messages: [], room_id: null, note: 'No existing WebEx conversation with this contact' });
    }

    // Fetch messages from the room
    const msgRes = await fetch(
      `${WEBEX_API_URL}/messages?roomId=${targetRoomId}&max=${limit}`,
      { headers: { 'Authorization': `Bearer ${webexToken}` } }
    );

    if (!msgRes.ok) {
      return res.status(msgRes.status).json({ error: 'Failed to fetch WebEx messages' });
    }

    const msgData = await msgRes.json();
    const messages = (msgData.items || []).map(m => ({
      id: m.id,
      from: m.personEmail || 'Unknown',
      content: m.text || m.html || '',
      content_type: m.html ? 'html' : 'text',
      created_at: m.created,
      is_from_me: m.personEmail?.toLowerCase() !== personEmail.toLowerCase()
    }));

    return res.status(200).json({ messages, room_id: targetRoomId, channel: 'webex' });
  } catch (e) {
    console.error('[contacts] WebEx API error:', e.message);
    return res.status(502).json({ error: 'WebEx API error' });
  }
}

async function sendWebexMessage(req, res, user, id) {
  if (!id) return res.status(400).json({ error: 'id is required' });

  const webexToken = process.env.WEBEX_ACCESS_TOKEN;
  if (!webexToken) {
    return res.status(503).json({ error: 'WEBEX_ACCESS_TOKEN not configured' });
  }

  const { message, template_id } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });

  const contact = await getContactForMessaging(id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  if (!contact.email) {
    return res.status(400).json({ error: 'Contact has no email for WebEx messaging' });
  }

  try {
    // Send directly — WebEx auto-creates a 1:1 space when sending to an email
    const sendRes = await fetch(`${WEBEX_API_URL}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${webexToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        toPersonEmail: contact.email,
        text: message
      })
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text().catch(() => '');
      return res.status(sendRes.status).json({ error: 'Failed to send WebEx message', detail: errText });
    }

    const sentMsg = await sendRes.json();

    await updateEngagementOnMessage(id, 'webex', user);

    await auditedInsertGov({
      workspaceId: user.memberships?.[0]?.workspace_id,
      user,
      table: 'contact_change_log',
      recordIdentifier: id,
      idColumn: 'unified_id',
      changedFields: {
      unified_id: id,
      change_type: 'engagement',
      source: 'webex',
      fields_changed: { message_sent: { channel: 'webex', template_id: template_id || null, timestamp: new Date().toISOString() } },
      changed_by: user.display_name || user.id
      },
      sourceSurface: 'contacts_send_webex',
      propagationScope: 'contact_change_log'
    });

    return res.status(200).json({ sent: true, message_id: sentMsg.id, room_id: sentMsg.roomId, channel: 'webex' });
  } catch (e) {
    console.error('[contacts] WebEx send error:', e.message);
    return res.status(502).json({ error: 'WebEx send error' });
  }
}

// ============================================================================
// SMS MESSAGING — read & send via WebEx Calling SMS
// ============================================================================

async function getSmsMessages(req, res, id) {
  if (!id) return res.status(400).json({ error: 'id is required' });

  const webexToken = process.env.WEBEX_ACCESS_TOKEN;
  if (!webexToken) {
    return res.status(503).json({ error: 'WEBEX_ACCESS_TOKEN not configured' });
  }

  const contact = await getContactForMessaging(id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  if (!contact.phone && !contact.mobile_phone) {
    return res.status(400).json({ error: 'Contact has no phone number for SMS' });
  }

  try {
    // WebEx Calling SMS endpoint — availability depends on org plan
    const phone = contact.mobile_phone || contact.phone;
    const digits = phone.replace(/[^0-9+]/g, '');

    const smsRes = await fetch(
      `${WEBEX_API_URL}/telephony/sms?address=${encodeURIComponent(digits)}&max=20`,
      { headers: { 'Authorization': `Bearer ${webexToken}` } }
    );

    if (!smsRes.ok) {
      // SMS may not be available on all org plans
      if (smsRes.status === 404 || smsRes.status === 403) {
        return res.status(200).json({ messages: [], note: 'SMS not available on this WebEx Calling plan', channel: 'sms' });
      }
      return res.status(smsRes.status).json({ error: 'Failed to fetch SMS history' });
    }

    const smsData = await smsRes.json();
    const messages = (smsData.items || []).map(m => ({
      id: m.id,
      from: m.from || m.sender || 'Unknown',
      to: m.to || m.destination || '',
      content: m.message || m.text || '',
      created_at: m.created || m.timestamp,
      direction: m.direction || (m.from === digits ? 'outbound' : 'inbound')
    }));

    return res.status(200).json({ messages, channel: 'sms' });
  } catch (e) {
    console.error('[contacts] SMS API error:', e.message);
    return res.status(502).json({ error: 'SMS API error' });
  }
}

async function sendSmsMessage(req, res, user, id) {
  if (!id) return res.status(400).json({ error: 'id is required' });

  const webexToken = process.env.WEBEX_ACCESS_TOKEN;
  if (!webexToken) {
    return res.status(503).json({ error: 'WEBEX_ACCESS_TOKEN not configured' });
  }

  const { message, template_id } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });

  const contact = await getContactForMessaging(id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const phone = contact.mobile_phone || contact.phone;
  if (!phone) {
    return res.status(400).json({ error: 'Contact has no phone number for SMS' });
  }

  try {
    const digits = phone.replace(/[^0-9+]/g, '');
    // Ensure we have a proper E.164 format
    const destination = digits.startsWith('+') ? digits : (digits.length === 10 ? '+1' + digits : '+' + digits);

    const sendRes = await fetch(`${WEBEX_API_URL}/telephony/sms`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${webexToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        destination,
        message
      })
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text().catch(() => '');
      if (sendRes.status === 403 || sendRes.status === 404) {
        return res.status(sendRes.status).json({ error: 'SMS not available on this WebEx Calling plan', detail: errText });
      }
      return res.status(sendRes.status).json({ error: 'Failed to send SMS', detail: errText });
    }

    const sentData = await sendRes.json().catch(() => ({}));

    await updateEngagementOnMessage(id, 'webex', user);

    await auditedInsertGov({
      workspaceId: user.memberships?.[0]?.workspace_id,
      user,
      table: 'contact_change_log',
      recordIdentifier: id,
      idColumn: 'unified_id',
      changedFields: {
      unified_id: id,
      change_type: 'engagement',
      source: 'webex',
      fields_changed: { sms_sent: { destination, template_id: template_id || null, timestamp: new Date().toISOString() } },
      changed_by: user.display_name || user.id
      },
      sourceSurface: 'contacts_send_sms',
      propagationScope: 'contact_change_log'
    });

    return res.status(200).json({ sent: true, destination, channel: 'sms', detail: sentData });
  } catch (e) {
    console.error('[contacts] SMS send error:', e.message);
    return res.status(502).json({ error: 'SMS send error' });
  }
}

// ============================================================================
// MESSAGING HELPERS
// ============================================================================

async function getContactForMessaging(id) {
  const result = await govQuery('GET',
    `unified_contacts?unified_id=eq.${pgVal(id)}&select=unified_id,email,phone,mobile_phone,first_name,last_name,full_name,company_name,webex_person_id,teams_user_id,outlook_contact_id,last_email_date,total_emails_sent,engagement_score,last_call_date,last_meeting_date,total_calls&limit=1`
  );
  return result.ok && result.data?.length > 0 ? result.data[0] : null;
}

async function updateEngagementOnMessage(unifiedId, _source, _user) {
  const contact = await getContactForMessaging(unifiedId);
  if (!contact) return;

  const now = new Date().toISOString();
  const newTotalEmails = (contact.total_emails_sent || 0) + 1;
  const newLastEmail = now;
  const newScore = computeEngagementScore(
    contact.last_call_date, newLastEmail, contact.last_meeting_date,
    contact.total_calls || 0, newTotalEmails
  );

  await auditedPatchGov({
    workspaceId: _user?.memberships?.[0]?.workspace_id,
    user: _user,
    table: 'unified_contacts',
    filter: `unified_id=eq.${pgVal(unifiedId)}`,
    recordIdentifier: unifiedId,
    idColumn: 'unified_id',
    changedFields: {
    last_email_date: newLastEmail,
    total_emails_sent: newTotalEmails,
    engagement_score: newScore
    },
    sourceSurface: 'contacts_message_engagement',
    propagationScope: 'unified_contact_engagement'
  });
}
