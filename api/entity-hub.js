// ============================================================================
// Entity Hub API — Consolidated router for contacts.js + entities.js
// Life Command Center
//
// Routes:
//   /api/entity-hub?_domain=contacts&...  → Unified Contact Hub (contacts-handler.js)
//   /api/entity-hub?_domain=entities&...  → Canonical Entity API (entities-handler.js)
//   /api/unified-contacts?...             → contacts (via vercel.json rewrite)
//   /api/entities?...                     → entities (via vercel.json rewrite)
//
// CONSOLIDATION NOTE (2026-04-03):
// Merged to stay within Vercel Hobby plan 12-function limit.
// See LCC_ARCHITECTURE_STRATEGY.md and .github/AI_INSTRUCTIONS.md
// ============================================================================

import { contactsHandler } from './_handlers/contacts-handler.js';
import { entitiesHandler } from './_handlers/entities-handler.js';

export default async function handler(req, res) {
  const domain = req.query._domain;

  if (domain === 'contacts') {
    return contactsHandler(req, res);
  }

  if (domain === 'entities') {
    return entitiesHandler(req, res);
  }

  // Default: check if this looks like a contacts or entities request
  // based on the action parameter patterns
  const { action } = req.query;
  const contactActions = new Set([
    'list', 'get', 'history', 'merge_queue', 'data_quality',
    'hot_leads', 'messages_teams', 'messages_webex', 'messages_sms',
    'message_templates', 'ingest', 'ingest_webex_calls',
    'ingest_calendar_contacts', 'detect_duplicates', 'classify',
    'merge', 'dismiss_merge', 'update'
  ]);

  const entityActions = new Set([
    'search', 'duplicates', 'quality', 'quality_details',
    'link', 'add_alias', 'set_precedence'
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
