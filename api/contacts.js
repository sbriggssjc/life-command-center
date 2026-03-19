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
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { withErrorHandler } from './_shared/ops-db.js';

const GOV_URL = process.env.GOV_SUPABASE_URL;
const GOV_KEY = process.env.GOV_SUPABASE_KEY;

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

export default withErrorHandler(async function handler(req, res) {
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
      case 'hot_leads':    return getHotLeads(req, res);
      default:
        return res.status(400).json({ error: 'GET action: list, get, history, merge_queue, data_quality, hot_leads' });
    }
  }

  // ---- POST endpoints ----
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }
    switch (action) {
      case 'ingest':            return ingestContact(req, res, user);
      case 'ingest_webex_calls': return ingestWebexCalls(req, res, user);
      case 'classify':          return classifyContact(req, res, user, id);
      case 'merge':             return mergeContacts(req, res, user);
      case 'dismiss_merge':     return dismissMerge(req, res, user);
      default:
        return res.status(400).json({ error: 'POST action: ingest, ingest_webex_calls, classify, merge, dismiss_merge' });
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
  const orderBy = order || 'updated_at.desc';

  let path = `unified_contacts?contact_class=eq.${contact_class}&limit=${limit}&offset=${offset}&order=${orderBy}`;

  // Filter by minimum engagement score if specified
  if (min_engagement) {
    const minScore = parseInt(min_engagement);
    if (minScore > 0) path += `&engagement_score=gte.${minScore}`;
  }

  if (search) {
    // Search across name, email, company using OR filter
    const q = search.replace(/'/g, "''");
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

  const result = await govQuery('GET', `unified_contacts?unified_id=eq.${id}&limit=1`);
  if (!result.ok || !result.data?.length) return res.status(404).json({ error: 'Contact not found' });

  const contact = result.data[0];

  // Build source badges
  const sources = [];
  if (contact.sf_contact_id) sources.push({ system: 'salesforce', id: contact.sf_contact_id, synced: contact.last_synced_sf });
  if (contact.outlook_contact_id) sources.push({ system: 'outlook', id: contact.outlook_contact_id, synced: contact.last_synced_outlook });
  if (contact.last_synced_calendar) sources.push({ system: 'calendar', synced: contact.last_synced_calendar });
  if (contact.webex_person_id) sources.push({ system: 'webex', id: contact.webex_person_id });
  if (contact.icloud_contact_id) sources.push({ system: 'icloud', id: contact.icloud_contact_id });
  if (contact.gov_contact_id) sources.push({ system: 'gov_db', id: contact.gov_contact_id });
  if (contact.dia_contact_id) sources.push({ system: 'dia_db', id: contact.dia_contact_id });

  // Engagement summary
  const engagementSummary = {
    score: contact.engagement_score || 0,
    last_call: contact.last_call_date,
    last_email: contact.last_email_date,
    last_meeting: contact.last_meeting_date,
    total_calls: contact.total_calls || 0,
    total_emails: contact.total_emails_sent || 0,
    heat: contact.engagement_score >= 60 ? 'hot'
      : contact.engagement_score >= 30 ? 'warm'
      : contact.engagement_score > 0 ? 'cool'
      : 'cold'
  };

  return res.status(200).json({ contact, sources, engagement: engagementSummary });
}

// ============================================================================
// HISTORY — change log for a contact
// ============================================================================

async function getHistory(req, res, id) {
  if (!id) return res.status(400).json({ error: 'id is required' });

  const result = await govQuery('GET',
    `contact_change_log?unified_id=eq.${id}&order=changed_at.desc&limit=100`
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
    webex_person_id, icloud_contact_id,
    entity_type, contact_type, industry,
    engagement  // optional: { call_date, call_duration, email_date, meeting_date }
  } = req.body || {};

  const VALID_SOURCES = ['salesforce', 'outlook', 'calendar', 'webex', 'iphone', 'icloud', 'manual'];
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
      `unified_contacts?sf_contact_id=eq.${sf_contact_id}&limit=1`
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
      `unified_contacts?outlook_contact_id=eq.${outlook_contact_id}&limit=1`
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
      `unified_contacts?webex_person_id=eq.${webex_person_id}&limit=1`
    );
    if (webexMatch.ok && webexMatch.data?.length > 0) {
      existingId = webexMatch.data[0].unified_id;
      matchTier = 0;
      matchScore = 1.0;
    }
  }

  // Tier 3c: iCloud contact ID match
  if (!existingId && icloud_contact_id) {
    const icloudMatch = await govQuery('GET',
      `unified_contacts?icloud_contact_id=eq.${icloud_contact_id}&limit=1`
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
    : source === 'calendar' ? 'last_synced_calendar'
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
    const existing = (await govQuery('GET', `unified_contacts?unified_id=eq.${existingId}&limit=1`)).data?.[0];
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
      await govQuery('PATCH', `unified_contacts?unified_id=eq.${existingId}`, updates);

      // Log the merge
      if (Object.keys(fieldsChanged).length > 0) {
        await govQuery('POST', 'contact_change_log', {
          unified_id: existingId,
          change_type: 'update',
          source,
          fields_changed: fieldsChanged,
          changed_by: user.display_name || user.id
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

    const result = await govQuery('POST', 'unified_contacts', newContact);
    if (!result.ok) {
      return res.status(result.status).json({ error: 'Failed to create contact', detail: result.data });
    }

    const created = Array.isArray(result.data) ? result.data[0] : result.data;

    // Log creation
    await govQuery('POST', 'contact_change_log', {
      unified_id: created.unified_id,
      change_type: 'create',
      source,
      fields_changed: incomingFields,
      changed_by: user.display_name || user.id
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
  const existing = await govQuery('GET', `unified_contacts?unified_id=eq.${id}&select=contact_class&limit=1`);
  if (!existing.ok || !existing.data?.length) return res.status(404).json({ error: 'Contact not found' });

  const oldClass = existing.data[0].contact_class;
  if (oldClass === contact_class) {
    return res.status(200).json({ message: 'Already classified as ' + contact_class });
  }

  await govQuery('PATCH', `unified_contacts?unified_id=eq.${id}`, { contact_class });

  // Log classification change
  await govQuery('POST', 'contact_change_log', {
    unified_id: id,
    change_type: 'classify',
    source: 'manual',
    fields_changed: { contact_class: { old: oldClass, new: contact_class } },
    changed_by: user.display_name || user.id
  });

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
  const existing = await govQuery('GET', `unified_contacts?unified_id=eq.${id}&limit=1`);
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

  await govQuery('PATCH', `unified_contacts?unified_id=eq.${id}`, updates);

  if (Object.keys(fieldsChanged).length > 0) {
    await govQuery('POST', 'contact_change_log', {
      unified_id: id,
      change_type: 'update',
      source: 'manual',
      fields_changed: fieldsChanged,
      changed_by: user.display_name || user.id
    });
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
    govQuery('GET', `unified_contacts?unified_id=eq.${keep_id}&limit=1`),
    govQuery('GET', `unified_contacts?unified_id=eq.${merge_id}&limit=1`)
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
    'webex_person_id', 'icloud_contact_id'
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
    await govQuery('PATCH', `unified_contacts?unified_id=eq.${keep_id}`, updates);
  }

  // Log the merge
  await govQuery('POST', 'contact_change_log', {
    unified_id: keep_id,
    change_type: 'merge',
    source: 'manual',
    fields_changed: updates,
    merged_from: merge_id,
    changed_by: user.display_name || user.id
  });

  // Delete the merged contact
  await govQuery('DELETE', `unified_contacts?unified_id=eq.${merge_id}`);

  // Update merge queue if queue_id provided
  if (queue_id) {
    await govQuery('PATCH', `contact_merge_queue?queue_id=eq.${queue_id}`, {
      status: 'merged',
      reviewed_by: user.display_name || user.id,
      reviewed_at: now
    });
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

  await govQuery('PATCH', `contact_merge_queue?queue_id=eq.${queue_id}`, {
    status: 'dismissed',
    reviewed_by: user.display_name || user.id,
    reviewed_at: new Date().toISOString()
  });

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
  const webexToken = process.env.WEBEX_ACCESS_TOKEN;
  if (!webexToken) {
    return res.status(503).json({ error: 'WEBEX_ACCESS_TOKEN not configured' });
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
    return res.status(502).json({ error: 'Failed to fetch WebEx call history', detail: e.message });
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
        const existing = (await govQuery('GET', `unified_contacts?unified_id=eq.${existingId}&select=last_call_date,total_calls,last_email_date,last_meeting_date,total_emails_sent,engagement_score&limit=1`)).data?.[0];
        if (existing) {
          const callTimestamp = new Date(callDate).toISOString();
          const newTotalCalls = (existing.total_calls || 0) + 1;
          const newLastCall = !existing.last_call_date || callTimestamp > existing.last_call_date
            ? callTimestamp : existing.last_call_date;

          const newScore = computeEngagementScore(
            newLastCall, existing.last_email_date, existing.last_meeting_date,
            newTotalCalls, existing.total_emails_sent || 0
          );

          await govQuery('PATCH', `unified_contacts?unified_id=eq.${existingId}`, {
            last_call_date: newLastCall,
            total_calls: newTotalCalls,
            engagement_score: newScore
          });

          // Log engagement update
          await govQuery('POST', 'contact_change_log', {
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

        const result = await govQuery('POST', 'unified_contacts', newContact);
        if (result.ok) {
          const createdContact = Array.isArray(result.data) ? result.data[0] : result.data;
          await govQuery('POST', 'contact_change_log', {
            unified_id: createdContact.unified_id,
            change_type: 'create',
            source: 'webex',
            fields_changed: { phone, name: titleCaseName, call_date: callTimestamp, direction },
            changed_by: 'system'
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
