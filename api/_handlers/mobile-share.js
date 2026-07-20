// ============================================================================
// Mobile Share-Sheet Ingestion — POST /api/intake?_route=mobile-share
//
// The iPhone "Send to LCC" Share Sheet action (an iOS Shortcut) posts a URL +
// title (+ optional selected text) from LinkedIn / Safari / any app. It feeds
// the SAME cross-vertical lead pipeline the Google/News-Alert channel uses
// (`news_alert_leads` on LCC Opps), so LinkedIn posts and web articles are
// covered alongside inbox-based Google Alerts. One tap, no app switching.
//
// Reuse, not fork:
//   - Classification/confidence reuses the news-alert scoring module verbatim
//     (`matchTenant` / `scoreNewsAlert` / `routeNewsAlert` — the SAME functions
//     the lead-ingest edge handler uses; imported from the pure-ESM module that
//     `test/news-alert.test.mjs` already imports, so there is no drift and no
//     Deno dependency reaches the Node runtime).
//   - A match to an EXISTING entity logs an activity touch on that entity,
//     mirroring the Outlook add-in touch-logging shape (`activity_events`, the
//     same table `bridgeLogActivity` writes).
//
// Routing (mirrors the news-alert decision tree):
//   - tracked tenant resolves to an EXISTING LCC entity → log an activity touch
//     (outcome 'logged') — never a new lead.
//   - high-confidence tenant/location signal, no existing record → create a
//     `news_alert_leads` row, status 'developer_unknown' (outcome 'lead_created').
//   - low confidence / no match → a lightweight 'needs_review' row carrying the
//     raw url + title (outcome 'needs_review') for Scott to eyeball.
//
// Response is a one-line-friendly `{ status:'ok', outcome }` so the Shortcut can
// show a confirmation banner on the phone without opening anything.
// ============================================================================

import { createHash } from 'crypto';
import { authenticate, requireRole } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { normalizeCanonicalName } from '../_shared/entity-link.js';
import {
  matchTenant, scoreNewsAlert, routeNewsAlert, tenantDedupKey,
  NEWS_ALERT_DEDUP_DAYS, DEFAULT_TRACKED_TENANTS,
} from '../../supabase/functions/lead-ingest/news-alert.js';

// The watchlist may be overridden via env (same knob as the edge handler) so
// Scott maintains the real tracked-tenant list without a code change.
function loadTrackedTenants() {
  const raw = process.env.TRACKED_TENANTS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      console.warn('[mobile-share] TRACKED_TENANTS_JSON invalid — using seed watchlist');
    }
  }
  return DEFAULT_TRACKED_TENANTS;
}

// First "City, ST" in the text — mirrors the parseGoogleAlert location regex so
// the completeness bonus + the lead row carry a location when the share text
// names one. 1-3 Title-Case words before the comma, so "...center in Dallas,
// TX" yields "Dallas" (internal caps like "DaVita" are not mistaken for a city).
export function extractCityState(text) {
  const m = String(text || '').match(/\b([A-Z][a-z.\-']+(?:\s+[A-Z][a-z.\-']+){0,2}),\s*([A-Z]{2})\b/);
  return { city: m ? m[1].trim() : null, state: m ? m[2].trim() : null };
}

function isLinkedInUrl(url) {
  return /(^|\.)linkedin\.com(\/|$)/i.test(String(url || '').replace(/^https?:\/\//i, '').split(/[\/?#]/)[0]);
}

/**
 * PURE classifier — runs the shared news-alert scoring over a mobile share.
 * No I/O. Returns the classification the router + writers consume.
 */
export function classifyMobileShare({ url, title, selected_text }, watchlist = DEFAULT_TRACKED_TENANTS) {
  const source = isLinkedInUrl(url) ? 'linkedin' : 'web_share';
  const parts = [title, selected_text];
  const match = matchTenant(parts, watchlist);
  const { city, state } = extractCityState([title, selected_text].filter(Boolean).join(' '));
  const article_url = /^https?:\/\//i.test(String(url || '')) ? url : null;
  const confidence = scoreNewsAlert(match, { city, state, article_url });
  const route = routeNewsAlert(confidence);
  return {
    source,
    tenant: (match && match.tenant) || null,
    domain: (match && match.domain) || null,
    match_kind: (match && match.match_kind) || 'none',
    matched: (match && match.matched) || null,
    confidence,
    route,          // { route:'auto'|'review', status, archive }
    city,
    state,
    article_url,
  };
}

/**
 * PURE routing decision. Given the classification + whether the tenant resolved
 * to an existing LCC entity, decide the outcome. Kept separate + deps-free so
 * the decision tree is unit-testable without the DB.
 *   - existing entity          → 'logged'        (log a touch on it)
 *   - auto (new strong signal) → 'lead_created'  (developer_unknown lead)
 *   - otherwise                → 'needs_review'
 */
export function decideMobileShareOutcome(classification, { existingEntity } = {}) {
  if (existingEntity && existingEntity.id) return 'logged';
  if (classification.route && classification.route.route === 'auto') return 'lead_created';
  return 'needs_review';
}

// Stable idempotency key so re-sharing the same URL is idempotent (mirrors the
// news-alert (source, source_ref) unique-index idempotency).
function shareSourceRef(source, url) {
  const basis = `${source}|${String(url || '').trim().toLowerCase()}`;
  return 'mobile-share:' + createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

// Resolve a tracked-tenant name to an EXISTING (non-tombstoned) LCC entity in
// the workspace. Exact canonical-name match only — conservative, so a touch is
// only logged against a clean existing record (never a guess / never a mint).
async function resolveExistingEntity(workspaceId, tenant) {
  if (!tenant) return null;
  const canonical = normalizeCanonicalName(tenant);
  if (!canonical) return null;
  const q = `entities?workspace_id=eq.${encodeURIComponent(workspaceId)}`
    + `&canonical_name=eq.${encodeURIComponent(canonical)}`
    + `&merged_into_entity_id=is.null`
    + `&select=id,name,entity_type,domain&limit=1`;
  const r = await opsQuery('GET', q);
  if (r.ok && Array.isArray(r.data) && r.data.length) return r.data[0];
  return null;
}

// ── Writers ─────────────────────────────────────────────────────────────────

// Log an activity touch on an existing entity — same `activity_events` shape as
// bridgeLogActivity (the Outlook add-in touch-logging path).
async function logShareTouch({ workspaceId, userId, entity, classification, url, title, selected_text, shared_at }) {
  const occurredAt = (typeof shared_at === 'string' && !Number.isNaN(Date.parse(shared_at)))
    ? new Date(shared_at).toISOString()
    : new Date().toISOString();
  const label = classification.source === 'linkedin' ? 'LinkedIn' : 'Web';
  const result = await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId,
    actor_id: userId,
    category: 'note',
    title: `${label} share: ${title || url || 'link'}`.slice(0, 500),
    body: (selected_text && String(selected_text).slice(0, 2000)) || null,
    entity_id: entity.id,
    source_type: classification.source,
    domain: classification.domain || entity.domain || null,
    visibility: 'shared',
    metadata: {
      bridge_source: 'mobile_share',
      mobile_share: {
        source: classification.source, url: url || null,
        match_kind: classification.match_kind, confidence: classification.confidence,
      },
    },
    occurred_at: occurredAt,
  });
  return result;
}

// Create (or idempotently return) a news_alert_leads row — the cross-vertical
// lead home. status 'developer_unknown' for a strong signal, 'needs_review' for
// a low-confidence / no-match share. Mirrors handleNewsAlertIngest.
async function createShareLead({ classification, status, url, title, selected_text, shared_at }) {
  const dedupKey = tenantDedupKey(classification.tenant);
  const sourceRef = shareSourceRef(classification.source, url);

  // 90-day tenant + city/state repost guard (a share of a story we already have).
  if (dedupKey) {
    const sinceIso = new Date(Date.now() - NEWS_ALERT_DEDUP_DAYS * 86400000).toISOString();
    let q = `news_alert_leads?select=news_lead_id&dedup_key=eq.${encodeURIComponent(dedupKey)}`
      + `&created_at=gte.${encodeURIComponent(sinceIso)}&limit=1`;
    if (classification.city) q += `&city=ilike.${encodeURIComponent(classification.city)}`;
    if (classification.state) q += `&state=ilike.${encodeURIComponent(classification.state)}`;
    const dup = await opsQuery('GET', q);
    if (dup.ok && Array.isArray(dup.data) && dup.data.length) {
      return { ok: true, duplicate: true, news_lead_id: dup.data[0].news_lead_id };
    }
  }

  const insert = await opsQuery('POST', 'news_alert_leads', {
    source: classification.source,           // 'linkedin' | 'web_share'
    domain: classification.domain,
    tenant: classification.tenant,
    match_kind: classification.match_kind,
    confidence: classification.confidence,
    city: classification.city,
    state: classification.state,
    article_url: classification.article_url,
    article_title: title || null,
    summary: (selected_text && String(selected_text).slice(0, 2000)) || title || null,
    status,
    dedup_key: dedupKey || null,
    source_ref: sourceRef,
    raw_subject: title || null,
    metadata: {
      channel: 'mobile_share',
      shared_at: (typeof shared_at === 'string' && shared_at) || null,
      matched: classification.matched,
      selected_text: (selected_text && String(selected_text).slice(0, 2000)) || null,
    },
  }, { 'Prefer': 'return=representation' });

  // A (source, source_ref) collision = the same URL re-shared → idempotent dup.
  if (!insert.ok) {
    if (insert.status === 409) return { ok: true, duplicate: true };
    return { ok: false, status: insert.status };
  }
  const row = Array.isArray(insert.data) ? insert.data[0] : insert.data;
  return { ok: true, news_lead_id: row?.news_lead_id || null };
}

// ── HTTP handler ─────────────────────────────────────────────────────────────

export async function handleMobileShare(req, res) {
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

  const { url, title, selected_text, shared_at } = req.body || {};
  if (!url && !title && !selected_text) {
    return res.status(400).json({ error: 'url, title, or selected_text is required' });
  }

  const classification = classifyMobileShare({ url, title, selected_text }, loadTrackedTenants());

  // Match to an existing record (contact/property/owner entity) → log a touch.
  const existingEntity = await resolveExistingEntity(workspaceId, classification.tenant);
  const outcome = decideMobileShareOutcome(classification, { existingEntity });

  try {
    if (outcome === 'logged') {
      const r = await logShareTouch({
        workspaceId, userId: user.id, entity: existingEntity,
        classification, url, title, selected_text, shared_at,
      });
      if (!r.ok) return res.status(r.status || 500).json({ error: 'Failed to log activity touch' });
      const activity = Array.isArray(r.data) ? r.data[0] : r.data;
      return res.status(201).json({
        status: 'ok', outcome, entity_id: existingEntity.id,
        tenant: classification.tenant, domain: classification.domain,
        confidence: classification.confidence, activity_id: activity?.id || null,
      });
    }

    const status = outcome === 'lead_created' ? 'developer_unknown' : 'needs_review';
    const r = await createShareLead({ classification, status, url, title, selected_text, shared_at });
    if (!r.ok) return res.status(r.status || 500).json({ error: 'Failed to record mobile share' });
    return res.status(201).json({
      status: 'ok', outcome,
      duplicate: r.duplicate || false,
      news_lead_id: r.news_lead_id || null,
      source: classification.source,
      tenant: classification.tenant, domain: classification.domain,
      match_kind: classification.match_kind, confidence: classification.confidence,
    });
  } catch (err) {
    console.error('[mobile-share] error:', err.message);
    return res.status(500).json({ error: 'Mobile share ingestion failed' });
  }
}
