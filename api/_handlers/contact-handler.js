// ============================================================================
// Contact Handler — HTTP mirror of Railway MCP get_contact_context tool
// Life Command Center
//
// Exposed via:
//   GET /api/contact?entity_id=<uuid>   → (vercel.json rewrite)
//   GET /api/contact?email=<str>        → (vercel.json rewrite)
//   GET /api/contact?name=<str>         → (vercel.json rewrite)
// Which rewrites to /api/entity-hub?_domain=contact and dispatches here.
//
// Parity target: mcp/server.js get_contact_context (lines ~351-450).
// Returns the same JSON shape so Railway MCP and direct HTTP callers can
// share response parsing code:
//   {
//     entity,                       // person entity row + external_identities
//     salesforce_id,                // external_identities[source=salesforce|sf].external_id or null
//     last_touch_date,              // occurred_at of most recent activity_event, or null
//     touchpoint_count,             // count of signals where signal_type=touchpoint_logged
//     days_since_contact,           // floor((now - last_touch_date) / 86400s), or null
//     active_deals,                 // open/in_progress/waiting action_items
//     recent_events,                // activity_events (last 20)
//     recommended_next_action       // heuristic based on days_since_contact
//   }
//
// Auth: STRICT X-LCC-Key enforcement via the exact same verifyApiKey helper
// exported from property-handler.js — no reimplementation.
// ============================================================================

import { opsQuery } from '../_shared/ops-db.js';
import { verifyApiKey } from './property-handler.js';

function enc(v) {
  return encodeURIComponent(String(v));
}

export async function contactHandler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LCC-Key');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }

  // Strict API key auth — reject missing or wrong key
  const providedKey = req.headers['x-lcc-key'] || '';
  if (!verifyApiKey(providedKey)) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid X-LCC-Key header' });
    return;
  }

  let { entity_id, email, name, q } = req.query;

  // Resolve q → entity_id, email, or name when the dedicated params are absent
  if (!entity_id && !email && !name && q) {
    const trimmed = q.trim();
    // UUIDs (8-4-4-4-12) or prefixed IDs like "gov:11136"
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
        || /^[a-z]+:/i.test(trimmed)) {
      entity_id = trimmed;
    } else if (trimmed.includes('@')) {
      email = trimmed;
    } else {
      name = trimmed;
    }
  }

  if (!entity_id && !email && !name) {
    res.status(400).json({ error: 'One of q, entity_id, email, or name query parameters is required' });
    return;
  }

  if (!process.env.OPS_SUPABASE_URL || !process.env.OPS_SUPABASE_KEY) {
    res.status(503).json({ error: 'OPS database not configured' });
    return;
  }

  // ── Resolve entity ────────────────────────────────────────────────────────
  let entity = null;
  if (entity_id) {
    const r = await opsQuery(
      'GET',
      `entities?id=eq.${enc(entity_id)}&entity_type=eq.person&select=*,external_identities(*)`
    );
    entity = r.data?.[0] || null;
  } else if (email) {
    const r = await opsQuery(
      'GET',
      `entities?entity_type=eq.person&email=eq.${enc(email)}&select=*,external_identities(*)&limit=1`
    );
    entity = r.data?.[0] || null;
  } else if (name) {
    const r = await opsQuery(
      'GET',
      `entities?entity_type=eq.person&or=(name.ilike.*${enc(name)}*,canonical_name.ilike.*${enc(name.toLowerCase())}*)&select=*,external_identities(*)&limit=1`
    );
    entity = r.data?.[0] || null;
  }

  if (!entity) {
    res.status(404).json({
      error: 'Contact not found',
      entity_id: entity_id || null,
      name: name || null,
      email: email || null,
    });
    return;
  }

  const eid = entity.id;

  // ── Parallel fetches ──────────────────────────────────────────────────────
  const [eventsRes, signalsRes, dealsRes] = await Promise.all([
    // Activity events (last 20)
    opsQuery(
      'GET',
      `activity_events?entity_id=eq.${enc(eid)}&select=id,category,title,source_type,occurred_at,metadata&order=occurred_at.desc&limit=20`
    ),
    // Signals (touchpoint_logged)
    opsQuery(
      'GET',
      `signals?entity_id=eq.${enc(eid)}&signal_type=eq.touchpoint_logged&select=id,signal_type,created_at,metadata&order=created_at.desc&limit=10`
    ),
    // Active deals (action_items linked to this entity)
    opsQuery(
      'GET',
      `action_items?entity_id=eq.${enc(eid)}&status=in.(open,in_progress,waiting)&select=id,title,status,priority,due_date,action_type&order=due_date.asc.nullslast&limit=10`
    ),
  ]);

  const events = eventsRes?.data || [];
  const signals = signalsRes?.data || [];

  // Derive touchpoint stats
  const touchpoints = signals.length;
  const lastTouch = events.length > 0 ? events[0].occurred_at : null;
  const daysSinceContact = lastTouch
    ? Math.floor((Date.now() - new Date(lastTouch).getTime()) / 86400000)
    : null;

  // Salesforce ID from external_identities
  const sfIdentity = (entity.external_identities || []).find(
    (x) => x.source_system === 'salesforce' || x.source_system === 'sf'
  );

  // Simple outreach recommendation
  let recommendedNextAction = 'No recommendation';
  if (daysSinceContact === null) {
    recommendedNextAction = 'No prior touchpoints — consider introductory outreach';
  } else if (daysSinceContact > 30) {
    recommendedNextAction = `${daysSinceContact} days since last contact — re-engagement outreach recommended`;
  } else if (daysSinceContact > 14) {
    recommendedNextAction = `${daysSinceContact} days since last contact — follow-up recommended`;
  } else {
    recommendedNextAction = 'Recently contacted — maintain cadence';
  }

  res.status(200).json({
    entity,
    salesforce_id: sfIdentity?.external_id || null,
    last_touch_date: lastTouch,
    touchpoint_count: touchpoints,
    days_since_contact: daysSinceContact,
    active_deals: dealsRes?.data || [],
    recent_events: events,
    recommended_next_action: recommendedNextAction,
  });
}
