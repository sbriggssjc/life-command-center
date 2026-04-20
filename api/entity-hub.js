// ============================================================================
// Entity Hub API — Consolidated router for contacts.js + entities.js
// Life Command Center  (cache-bust: force rebuild of handler imports)
//
// Routes:
//   /api/entity-hub?_domain=contacts&...  → Unified Contact Hub (contacts-handler.js)
//   /api/entity-hub?_domain=entities&...  → Canonical Entity API (entities-handler.js)
//   /api/entity-hub?_domain=property&...  → Property context (property-handler.js)
//   /api/entity-hub?_domain=contact&...   → Contact context (contact-handler.js)
//   /api/entity-hub?_domain=search&...    → Unified search (search-handler.js)
//   /api/entity-hub?_domain=briefing-email&... → Briefing email digest (briefing-email-handler.js)
//   /api/entity-hub?_domain=cap-rate-recalc&... → Cap-rate recalc (cap-rate-recalc-handler.js)
//   /api/unified-contacts?...             → contacts (via vercel.json rewrite)
//   /api/entities?...                     → entities (via vercel.json rewrite)
//   /api/property?...                     → property context (via vercel.json rewrite)
//   /api/contact?...                      → contact context (via vercel.json rewrite)
//   /api/search?...                       → unified search (via vercel.json rewrite)
//   /api/briefing-email?...               → briefing email digest (via vercel.json rewrite)
//   /api/recalculate-cap-rates?...        → cap-rate recalc (via vercel.json rewrite)
//
// CONSOLIDATION NOTE (2026-04-03):
// Merged to stay within Vercel Hobby plan 12-function limit.
// See LCC_ARCHITECTURE_STRATEGY.md and .github/AI_INSTRUCTIONS.md
// ============================================================================

import { contactsHandler } from './_handlers/contacts-handler.js';
import { entitiesHandler } from './_handlers/entities-handler.js';
import { propertyHandler } from './_handlers/property-handler.js';
import { contactHandler } from './_handlers/contact-handler.js';
import { searchHandler } from './_handlers/search-handler.js';
import { briefingEmailHandler } from './_handlers/briefing-email-handler.js';
import { capRateRecalcHandler } from './_handlers/cap-rate-recalc-handler.js';

export default async function handler(req, res) {
  const domain = req.query._domain;

  if (domain === 'contacts') {
    return contactsHandler(req, res);
  }

  if (domain === 'entities') {
    return entitiesHandler(req, res);
  }

  if (domain === 'property') {
    return propertyHandler(req, res);
  }

  if (domain === 'contact') {
    return contactHandler(req, res);
  }

  if (domain === 'search') {
    return searchHandler(req, res);
  }

  if (domain === 'briefing-email') {
    return briefingEmailHandler(req, res);
  }

  if (domain === 'cap-rate-recalc') {
    return capRateRecalcHandler(req, res);
  }

  // Default: check if this looks like a contacts or entities request
  // based on the action parameter patterns
  const { action } = req.query;
  const contactActions = new Set([
    'list', 'get', 'history', 'merge_queue', 'data_quality',
    'hot_leads', 'messages_teams', 'messages_webex', 'messages_sms',
    'message_templates', 'ingest', 'ingest_webex_calls',
    'ingest_calendar_contacts', 'detect_duplicates', 'classify',
    'merge', 'dismiss_merge', 'update',
    'send_teams', 'send_webex', 'send_sms'
  ]);

  const entityActions = new Set([
    'search', 'duplicates', 'quality', 'quality_details',
    'link', 'add_alias', 'set_precedence', 'process_sidebar_extraction'
  ]);

  if (contactActions.has(action)) {
    return contactsHandler(req, res);
  }

  if (entityActions.has(action)) {
    return entitiesHandler(req, res);
  }

  // If no action and no _domain, default to entities (for CRUD by id/method)
  return entitiesHandler(req, res);
}
