// ============================================================================
// Operations API — Consolidated from bridge.js + workflows.js
// Life Command Center
//
// BRIDGE ACTIONS (domain activity logging):
//   POST /api/operations?action=log_activity       — log domain activity
//   POST /api/operations?action=complete_research   — mark research complete
//   POST /api/operations?action=log_call           — log call activity
//   POST /api/operations?action=save_ownership     — ownership save → activity
//   POST /api/operations?action=dismiss_lead       — lead dismissal → activity
//   POST /api/operations?action=update_entity      — sync domain → canonical entity
//
// WORKFLOW ACTIONS (multi-step team operations):
//   POST /api/operations?action=promote_to_shared   — inbox → shared action
//   POST /api/operations?action=sf_task_to_action   — SF task → entity-linked action
//   POST /api/operations?action=research_followup   — research → follow-up action
//   POST /api/operations?action=reassign            — reassign work item
//   POST /api/operations?action=escalate            — escalate to manager
//   POST /api/operations?action=watch               — subscribe to item updates
//   POST /api/operations?action=unwatch             — unsubscribe from updates
//   POST /api/operations?action=bulk_assign         — assign multiple items
//   POST /api/operations?action=bulk_triage         — triage multiple inbox items
//   GET  /api/operations?action=oversight           — manager team overview
//   GET  /api/operations?action=unassigned          — unassigned work items
//   GET  /api/operations?action=watchers            — list watchers
//
// TEMPLATE DRAFTS:
//   GET  /api/operations?_route=draft               — list templates
//   GET  /api/operations?_route=draft&template_id=X  — get single template
//   POST /api/operations?_route=draft&action=generate     — generate draft
//   POST /api/operations?_route=draft&action=batch        — batch draft generation
//   POST /api/operations?_route=draft&action=record_send  — record a sent draft
//   POST /api/operations?_route=draft&action=listing_bd   — run listing-as-BD pipeline
//
// COPILOT INTEGRATION:
//   GET  /api/copilot-spec                          — OpenAPI 3.0 spec (no auth)
//   GET  /api/copilot-manifest                      — Plugin manifest (no auth)
//   POST /api/chat  { copilot_action, params, surface } — action dispatch gateway
//   POST /api/chat  { copilot_followup }            — follow-up signal (learning loop)
//
// CHAT:
//   POST /api/operations?_route=chat               — AI copilot chat
//
// CONTEXT BROKER (intelligence layer):
//   POST /api/context?action=assemble               — assemble/retrieve single packet
//   POST /api/context?action=assemble-multi          — batch assemble multiple packets
//   POST /api/context?action=invalidate              — invalidate cached packets
//   POST /api/context?action=preassemble-nightly     — nightly batch pre-assembly of context packets
//   POST /api/context?action=weekly-intelligence-report — weekly signal feedback report
//   (routed via vercel.json: /api/context → /api/operations?_route=context)
//   (routed via vercel.json: /api/preassemble → /api/operations?_route=context&action=preassemble-nightly)
//   (routed via vercel.json: /api/weekly-report → /api/operations?_route=context&action=weekly-intelligence-report)
//
// CONSOLIDATION NOTE (2026-04-03):
// Merged to stay within Vercel Hobby plan 12-function limit.
// See LCC_ARCHITECTURE_STRATEGY.md and .github/AI_INSTRUCTIONS.md
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, pgFilterVal, requireOps, withErrorHandler, insertEntityRelationship } from './_shared/ops-db.js';
import { closeResearchLoop } from './_shared/research-loop.js';
import { ensureEntityLink, normalizeCanonicalName, refreshPlaceholderEntityNameById, looksLikePersonName } from './_shared/entity-link.js';
import { invokeChatProvider } from './_shared/ai.js';
import { generateDraft, generateBatchDrafts, listActiveTemplates, loadTemplate, recordTemplateSend, computeEditDistance, chooseBestTemplate } from './_shared/templates.js';
import { runListingBdPipeline } from './_shared/listing-bd.js';
import { buildTeamContextWithSales, getTrackRecordSummary } from './_shared/team-context.js';
import { getCadenceForDraft, advanceCadence, getCadenceState } from './_shared/cadence-engine.js';
import { linkPersonToEntity, stampContactOnActiveCadence } from './_shared/contact-attach.js';
import { evaluateTemplateHealth, flagTemplateForRevision, generateRevisionSuggestion } from './_shared/template-refinement.js';
import { writeSignal } from './_shared/signals.js';
import { sendTeamsAlert } from './_shared/teams-alert.js';
import { createOutlookDraftViaPA } from './_shared/outlook-draft.js';
import { ACTION_SCHEMAS, generateOpenApiSpec, generateSwagger2Spec, generatePluginManifest } from './_shared/action-schemas.js';
import { validateActionInput } from './_shared/schema-validator.js';
import { ingestPdfWorker } from './intake.js';
import {
  canTransitionInbox, canTransitionAction,
  buildTransitionActivity, ACTION_TYPES, PRIORITIES, VISIBILITY_SCOPES, isValidEnum
} from './_shared/lifecycle.js';
import { diaSupabaseKey, govSupabaseKey } from './_shared/supabase-keys.js';

// ============================================================================
// EDGE FUNCTION PROXY — forwards requests to Supabase Edge Functions
// Used by feature flags to gradually migrate routes off Vercel
// ============================================================================

const EDGE_FUNCTION_BASE = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1';

async function proxyToEdgeFunction(req, res, functionName) {
  const url = new URL(`${EDGE_FUNCTION_BASE}/${functionName}`);

  // Forward query params (except _route which is Vercel-internal)
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key !== '_route') url.searchParams.set(key, value);
  }

  const headers = {
    'Content-Type': 'application/json',
  };
  // Forward auth-relevant headers
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
      signal: AbortSignal.timeout(25000), // 25s timeout (Vercel hobby = 30s)
    });

    const data = await edgeRes.json();
    return res.status(edgeRes.status).json(data);
  } catch (err) {
    console.error(`[edge-proxy] ${functionName} failed, falling back to local:`, err.message);
    // Return null to signal caller should fall back to local handler
    return null;
  }
}

// ============================================================================
// MAIN DISPATCHER
// ============================================================================

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  // Chat route (via vercel.json _route=chat)
  // When edge_copilot_chat flag is enabled, proxy chat messages & followup signals
  // to Supabase Edge Function. copilot_action dispatch + GET spec/manifest stay local.
  if (req.query._route === 'chat') {
    const isChatMessage = req.method === 'POST' && (req.body?.message || req.body?.copilot_followup);
    if (isChatMessage) {
      try {
        const wsId = req.headers['x-lcc-workspace'];
        if (wsId) {
          const wsResult = await opsQuery('GET', `workspaces?id=eq.${pgFilterVal(wsId)}&select=config`);
          const flags = wsResult.data?.[0]?.config?.feature_flags || {};
          if (flags.edge_copilot_chat) {
            const edgeAction = req.body?.copilot_followup ? 'followup' : 'chat';
            const proxyResult = await proxyToEdgeFunction(req, res, `copilot-chat?action=${edgeAction}`);
            if (proxyResult) return;
            console.warn('[chat-proxy] Edge proxy failed, falling back to local handler');
          }
        }
      } catch (err) {
        console.warn('[chat-proxy] Flag check failed, using local handler:', err.message);
      }
    }
    return handleChatRoute(req, res);
  }

  // Template draft route (via vercel.json _route=draft)
  // When edge_template_service flag is enabled, proxy to Supabase Edge Function.
  // listing_bd action stays local (depends on listing-bd.js pipeline).
  if (req.query._route === 'draft') {
    const isListingBd = req.method === 'POST' && req.query.action === 'listing_bd';
    if (!isListingBd) {
      try {
        const wsId = req.headers['x-lcc-workspace'];
        if (wsId) {
          const wsResult = await opsQuery('GET', `workspaces?id=eq.${pgFilterVal(wsId)}&select=config`);
          const flags = wsResult.data?.[0]?.config?.feature_flags || {};
          if (flags.edge_template_service) {
            // Map _route query params to edge function format
            const edgeAction = req.query.action || (req.method === 'GET' ? null : 'generate');
            const edgeUrl = edgeAction ? `template-service?action=${edgeAction}` : 'template-service';
            const proxyResult = await proxyToEdgeFunction(req, res, edgeUrl);
            if (proxyResult) return;
            console.warn('[draft-proxy] Edge proxy failed, falling back to local handler');
          }
        }
      } catch (err) {
        console.warn('[draft-proxy] Flag check failed, using local handler:', err.message);
      }
    }
    return handleDraftRoute(req, res);
  }

  // R16 contact-acquisition worker (via vercel.json _route=contact-acquisition-tick).
  // Cron-driven drain — authenticates internally (like the other tick workers).
  if (req.query._route === 'contact-acquisition-tick') {
    const { handleContactAcquisitionTick } = await import('./_handlers/contact-acquisition.js');
    return handleContactAcquisitionTick(req, res);
  }

  // Context broker route (via vercel.json _route=context)
  // When edge_context_broker flag is enabled, proxy to Supabase Edge Function
  if (req.query._route === 'context') {
    try {
      const wsId = req.headers['x-lcc-workspace'];
      if (wsId) {
        const wsResult = await opsQuery('GET', `workspaces?id=eq.${pgFilterVal(wsId)}&select=config`);
        const wsConfig = wsResult.data?.[0]?.config || {};
        const flags = wsConfig.feature_flags || {};
        if (flags.edge_context_broker) {
          const proxyResult = await proxyToEdgeFunction(req, res, 'context-broker');
          if (proxyResult) return; // proxy succeeded
          // proxyResult === null means proxy failed, fall through to local
          console.warn('[context-proxy] Edge proxy failed, falling back to local handler');
        }
      }
    } catch (err) {
      console.error('[context-proxy] Flag check failed, falling back to local:', err.message);
    }
    return handleContextRoute(req, res);
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const { action } = req.query;

  // ---- GET endpoints (workflows) ----
  if (req.method === 'GET') {
    switch (action) {
      case 'oversight':   return await getOversight(req, res, user, workspaceId);
      case 'unassigned':  return await getUnassigned(req, res, user, workspaceId);
      case 'watchers':    return await getWatchers(req, res, user, workspaceId);
      case 'buyer_contacts': return await getBuyerContacts(req, res, user, workspaceId);
      case 'cadence_dashboard': return await getCadenceDashboard(req, res, user, workspaceId);
      case 'contact_qualify_worklist': return await getContactQualifyWorklist(req, res, user, workspaceId);
      default: return res.status(400).json({ error: 'Invalid GET action. Use: oversight, unassigned, watchers, buyer_contacts, cadence_dashboard, contact_qualify_worklist' });
    }
  }

  // ---- POST endpoints ----
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    switch (action) {
      // Bridge actions
      case 'log_activity':       return await bridgeLogActivity(req, res, user, workspaceId);
      case 'complete_research':  return await bridgeCompleteResearch(req, res, user, workspaceId);
      case 'log_call':           return await bridgeLogCall(req, res, user, workspaceId);
      case 'save_ownership':     return await bridgeSaveOwnership(req, res, user, workspaceId);
      case 'create_lead':        return await bridgeCreateLead(req, res, user, workspaceId);
      case 'initiate_cadence':   return await bridgeInitiateCadence(req, res, user, workspaceId);
      case 'open_opportunity':   return await bridgeOpenOpportunity(req, res, user, workspaceId);
      case 'open_government_buyer': return await bridgeOpenGovernmentBuyer(req, res, user, workspaceId);
      case 'select_buyer_contact': return await bridgeSelectBuyerContact(req, res, user, workspaceId);
      case 'select_prospecting_contact': return await bridgeSelectProspectingContact(req, res, user, workspaceId);
      case 'qualify_contact':    return await bridgeQualifyContact(req, res, user, workspaceId);
      case 'dismiss_lead':       return await bridgeDismissLead(req, res, user, workspaceId);
      case 'update_entity':      return await bridgeUpdateEntity(req, res, user, workspaceId);
      case 'advance_cadence':    return await bridgeAdvanceCadence(req, res, user, workspaceId);

      // Workflow actions
      case 'promote_to_shared':  return await promoteToShared(req, res, user, workspaceId);
      case 'sf_task_to_action':  return await sfTaskToAction(req, res, user, workspaceId);
      case 'research_followup':  return await researchFollowup(req, res, user, workspaceId);
      case 'reassign':           return await reassignItem(req, res, user, workspaceId);
      case 'escalate':           return await escalateItem(req, res, user, workspaceId);
      case 'watch':              return await addWatch(req, res, user, workspaceId);
      case 'unwatch':            return await removeWatch(req, res, user, workspaceId);
      case 'bulk_assign':        return await bulkAssign(req, res, user, workspaceId);
      case 'bulk_triage':        return await bulkTriage(req, res, user, workspaceId);

      default:
        return res.status(400).json({
          error: 'Invalid POST action. Bridge: log_activity, complete_research, log_call, save_ownership, dismiss_lead, update_entity, advance_cadence. Workflows: promote_to_shared, sf_task_to_action, research_followup, reassign, escalate, watch, unwatch, bulk_assign, bulk_triage. Prospecting: create_lead, initiate_cadence, open_opportunity, open_government_buyer'
        });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
});

// ============================================================================
// BRIDGE: Generic activity logging for any domain save operation
// ============================================================================

async function bridgeLogActivity(req, res, user, workspaceId) {
  const {
    category, title, body, domain, entity_id, external_id,
    source_system, source_type, metadata
  } = req.body || {};

  if (!title) return res.status(400).json({ error: 'title is required' });

  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    // R35 (2026-06-16): resolve-only — an activity log ATTACHES to an existing
    // entity, it must never MINT one. The old create path used the activity
    // `title` as the entity name and the caller-supplied `external_id` as the
    // identity, so dia property-review logs (passing a clinic CCN as external_id
    // with title "Property link approved" / "Clinic lead outcome recorded" /
    // "Research outcome saved") piled 345 (dia, asset, <CCN>) rows onto a single
    // junk-named entity. resolveOnly stops that recurrence at the choke point:
    // unresolved => the activity still logs, just unlinked.
    const link = await ensureEntityLink({
      workspaceId, userId: user.id, sourceSystem: source_system,
      sourceType: source_type || 'asset', externalId: external_id,
      domain, seedFields: { name: title, metadata },
      resolveOnly: true
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  const activityMetadata = { ...metadata, bridge_source: 'domain_save' };
  if (req.body.gov_change_event_id) activityMetadata.gov_change_event_id = req.body.gov_change_event_id;
  if (req.body.gov_correlation_id) activityMetadata.gov_correlation_id = req.body.gov_correlation_id;
  if (req.body.source_record_id) activityMetadata.source_record_id = req.body.source_record_id;
  if (req.body.source_table) activityMetadata.source_table = req.body.source_table;

  const result = await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: category || 'note', title,
    body: body || null, entity_id: resolvedEntityId || null,
    source_type: source_system || 'system', domain: domain || null,
    visibility: 'shared', metadata: activityMetadata,
    occurred_at: new Date().toISOString()
  });

  if (!result.ok) return res.status(result.status).json({ error: 'Failed to log activity' });

  return res.status(201).json({
    activity: Array.isArray(result.data) ? result.data[0] : result.data,
    entity_id: resolvedEntityId
  });
}

// ============================================================================
// BRIDGE: Research completion → canonical activity + optional follow-up action
// ============================================================================

async function bridgeCompleteResearch(req, res, user, workspaceId) {
  const {
    domain, research_type, research_task_id, entity_id,
    external_id, external_url, source_system, source_type,
    source_record_id, source_table, outcome, notes,
    follow_up_title, follow_up_due, follow_up_assignee,
    title, instructions, entity_fields, metadata
  } = req.body || {};

  if (!research_type) return res.status(400).json({ error: 'research_type is required' });

  const researchMetadata = { ...(metadata || {}), research_type, outcome, bridge_source: 'research_completion' };
  if (req.body.gov_change_event_id) researchMetadata.gov_change_event_id = req.body.gov_change_event_id;
  if (req.body.gov_correlation_id) researchMetadata.gov_correlation_id = req.body.gov_correlation_id;
  if (source_record_id) researchMetadata.source_record_id = source_record_id;
  if (source_table) researchMetadata.source_table = source_table;

  const closure = await closeResearchLoop({
    workspaceId, user, researchTaskId: research_task_id,
    sourceSystem: source_system, sourceType: source_type || 'asset',
    sourceRecordId: source_record_id || external_id,
    sourceTable: source_table || null,
    externalId: external_id, externalUrl: external_url,
    researchType: research_type, domain,
    entityId: entity_id, entitySeedFields: entity_fields || {},
    title, instructions,
    outcome: typeof outcome === 'string' ? { status: outcome } : (outcome || { status: 'completed' }),
    notes,
    followupTitle: outcome === 'needs_followup' ? follow_up_title : (follow_up_title || null),
    followupAssignee: follow_up_assignee,
    followupDue: follow_up_due,
    activityMetadata: researchMetadata,
    researchMetadata
  });

  if (!closure.ok) {
    return res.status(closure.status || 500).json({ error: closure.error, detail: closure.detail });
  }

  // Fire Teams alert for research completion
  const entityName = closure.entity?.name || entity_fields?.name || null;
  const address = closure.entity?.address || entity_fields?.address || entityName;
  const ownerName = entity_fields?.true_owner_name || entity_fields?.owner_name || metadata?.true_owner_name || null;
  const sfOpportunityId = metadata?.sf_opportunity_id || null;
  const sfUrl = sfOpportunityId
    ? `https://northmarq.lightning.force.com/lightning/r/Opportunity/${sfOpportunityId}/view`
    : null;
  sendTeamsAlert({
    title: 'Ownership Research Complete',
    summary: entityName || address || research_type,
    severity: 'success',
    facts: [
      ['Property', address || entityName || 'See record'],
      ['Owner found', ownerName || 'See record'],
      ['SF Opportunity', sfOpportunityId ? 'Created' : 'Pending'],
      ['Next action', 'Review and initiate outreach']
    ],
    actions: [
      { label: 'View in LCC', url: `${process.env.LCC_BASE_URL || ''}/gov` },
      { label: 'Open in Salesforce', url: sfUrl || '#' }
    ]
  }).catch(() => {});

  return res.status(201).json({
    logged: true,
    entity_id: closure.entity?.id || closure.researchTask?.entity_id || null,
    research_task: closure.researchTask,
    follow_up: closure.followupAction,
    created_research_task: closure.createdResearchTask
  });
}

// ============================================================================
// BRIDGE: Call logging → canonical activity
// ============================================================================

async function bridgeLogCall(req, res, user, workspaceId) {
  const {
    subject, notes, outcome, domain, entity_id, external_id,
    source_system, source_type, sf_contact_id, sf_company_id, activity_date
  } = req.body || {};

  if (!subject) return res.status(400).json({ error: 'subject is required' });

  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    const link = await ensureEntityLink({
      workspaceId, userId: user.id, sourceSystem: source_system,
      sourceType: source_type || 'asset', externalId: external_id,
      domain, seedFields: { name: subject, metadata: { sf_contact_id, sf_company_id } }
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  const result = await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: 'call', title: subject, body: notes || null,
    entity_id: resolvedEntityId || null, source_type: 'salesforce',
    domain: domain || null, visibility: 'shared',
    metadata: {
      outcome, sf_contact_id, sf_company_id,
      activity_date: activity_date || new Date().toISOString(),
      bridge_source: 'log_call'
    },
    occurred_at: activity_date || new Date().toISOString()
  });

  if (!result.ok) return res.status(result.status).json({ error: 'Failed to log call' });

  return res.status(201).json({
    activity: Array.isArray(result.data) ? result.data[0] : result.data,
    entity_id: resolvedEntityId
  });
}

// ============================================================================
// BRIDGE: Advance cadence (manual "Log touch" from the priority queue) → R10
//
// The single advance owner is the JS advanceCadence() function. This endpoint:
//   1. resolves the active cadence for the entity (or an explicit cadence_id),
//   2. advances it (advanceCadence ALWAYS reschedules now — R10 Unit 1),
//   3. writes an activity_events row with the REAL category so history renders
//      and downstream consumers see the touch. That row is tagged
//      metadata.skip_cadence_advance='true' so the AFTER-INSERT trigger
//      lcc_activity_event_advance_cadence does NOT double-advance,
//   4. refreshes the materialized priority queue so the card leaves its band.
//
// Reached via the main action router (POST /api/operations?action=advance_cadence).
// The Copilot draft-route alias (?_route=draft&action=advance_cadence) still
// advances but does not log an activity — see handleDraftRoute.
// ============================================================================

// Map a logged touch type to a canonical activity_events category.
// Generic 'touch' (the priority-queue "Log touch" CTA) → 'call' per doctrine:
// the category describes WHAT HAPPENED, and a manual touch is, by default, a
// human reach-out. email/phone/vm/meeting pass through to their categories.
function touchTypeToActivityCategory(touchType) {
  switch ((touchType || '').toLowerCase()) {
    case 'email':   return 'email';
    case 'meeting': return 'meeting';
    case 'phone':
    case 'vm':
    case 'call':
    case 'touch':
    default:        return 'call';
  }
}

async function bridgeAdvanceCadence(req, res, user, workspaceId) {
  const { cadence_id, sf_contact_id, entity_id, contact_id,
          type, template_id, outcome, opened } = req.body || {};

  // 1. Resolve the cadence to advance. Prefer an explicit cadence_id; otherwise
  //    find the active, most-overdue cadence for the entity. We fetch (never
  //    create) — a "Log touch" only makes sense against an existing cadence.
  let cadence = null;
  if (cadence_id) {
    const r = await opsQuery('GET', `touchpoint_cadence?id=eq.${pgFilterVal(cadence_id)}&limit=1`);
    cadence = r.ok ? (r.data?.[0] || null) : null;
  } else if (entity_id || sf_contact_id || contact_id) {
    const filters = [];
    if (entity_id) filters.push(`entity_id=eq.${pgFilterVal(entity_id)}`);
    if (sf_contact_id) filters.push(`sf_contact_id=eq.${pgFilterVal(sf_contact_id)}`);
    if (contact_id) filters.push(`contact_id=eq.${pgFilterVal(contact_id)}`);
    // Active phases only; most-overdue first (the row driving the queue band).
    const path = `touchpoint_cadence?${filters.join('&')}`
      + `&phase=in.(prospecting,onboarding,steady_state,maintenance,buy_side)`
      + `&order=next_touch_due.asc.nullslast&limit=1`;
    const r = await opsQuery('GET', path);
    cadence = r.ok ? (r.data?.[0] || null) : null;
  }

  if (!cadence) {
    return res.status(404).json({ error: 'No active cadence found to advance (provide cadence_id, or an entity with an open cadence)' });
  }

  // 2. Advance — advanceCadence reschedules next_touch_due into the future.
  const advanceResult = await advanceCadence(cadence.id, { type, template_id, outcome, opened });
  if (!advanceResult.ok) {
    return res.status(500).json(advanceResult);
  }
  const advanced = advanceResult.cadence || cadence;

  // 3. Log the touch as an activity_events row (real category; skip-tagged so
  //    the advance trigger does not double-advance). Best-effort: a failed log
  //    must not fail the advance, but we report it.
  let activityLogged = false;
  if (cadence.entity_id) {
    const category = touchTypeToActivityCategory(type);
    const actMeta = {
      skip_cadence_advance: 'true',
      bridge_source: 'advance_cadence',
      touch_type: type || 'touch',
      cadence_id: cadence.id
    };
    if (outcome) actMeta.outcome = outcome;
    const actRow = {
      workspace_id: workspaceId, actor_id: user.id,
      category, title: `Touch logged (${type || 'touch'})`,
      body: null, entity_id: cadence.entity_id,
      source_type: 'system', domain: cadence.domain || null,
      visibility: 'shared', metadata: actMeta,
      occurred_at: new Date().toISOString()
    };
    if (cadence.bd_opportunity_id) actRow.bd_opportunity_id = cadence.bd_opportunity_id;
    const actResult = await opsQuery('POST', 'activity_events', actRow);
    activityLogged = !!actResult.ok;
    if (!activityLogged) {
      console.warn('[advance_cadence] activity log failed (non-blocking):', actResult.status);
    }
  }

  // 4. Refresh the materialized queue so the card leaves its band immediately
  //    (Slice-1 staleness contract). Soft — a stale cache only costs latency.
  try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }

  return res.status(200).json({
    ok: true,
    cadence_id: cadence.id,
    cadence: advanced,
    next_touch_due: advanced.next_touch_due,
    activity_logged: activityLogged,
    recommendation: advanceResult.recommendation
  });
}

// ============================================================================
// BRIDGE: Ownership save → canonical activity
// ============================================================================

async function bridgeSaveOwnership(req, res, user, workspaceId) {
  const {
    domain, entity_id, external_id, source_system,
    owner_name, true_owner_name, notes
  } = req.body || {};

  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    const link = await ensureEntityLink({
      workspaceId, userId: user.id, sourceSystem: source_system,
      sourceType: req.body.source_type || 'asset', externalId: external_id,
      domain, seedFields: { name: true_owner_name || owner_name, org_type: 'owner' }
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  const title = true_owner_name
    ? `Ownership resolved: ${true_owner_name}${owner_name ? ` (recorded: ${owner_name})` : ''}`
    : `Ownership data saved${owner_name ? `: ${owner_name}` : ''}`;

  const ownershipMetadata = { owner_name, true_owner_name, bridge_source: 'ownership_save' };
  if (req.body.gov_change_event_id) ownershipMetadata.gov_change_event_id = req.body.gov_change_event_id;
  if (req.body.gov_correlation_id) ownershipMetadata.gov_correlation_id = req.body.gov_correlation_id;
  if (req.body.source_record_id) ownershipMetadata.source_record_id = req.body.source_record_id;
  if (req.body.source_table) ownershipMetadata.source_table = req.body.source_table;

  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: 'research', title, body: notes || null,
    entity_id: resolvedEntityId || null,
    source_type: source_system || 'system', domain: domain || null,
    visibility: 'shared', metadata: ownershipMetadata,
    occurred_at: new Date().toISOString()
  });

  return res.status(201).json({ logged: true, entity_id: resolvedEntityId });
}

// ============================================================================
// BRIDGE: Lead dismissal → canonical activity
// ============================================================================

async function bridgeDismissLead(req, res, user, workspaceId) {
  const {
    domain, entity_id, external_id, source_system, reason, notes
  } = req.body || {};

  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    const link = await ensureEntityLink({
      workspaceId, userId: user.id, sourceSystem: source_system,
      sourceType: req.body.source_type || 'asset', externalId: external_id,
      domain, seedFields: { name: reason || notes || 'Dismissed lead' }
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: 'status_change',
    title: `Lead dismissed${reason ? ': ' + reason : ''}`,
    body: notes || null, entity_id: resolvedEntityId || null,
    source_type: source_system || 'system', domain: domain || null,
    visibility: 'shared', metadata: { reason, bridge_source: 'lead_dismiss' },
    occurred_at: new Date().toISOString()
  });

  return res.status(201).json({ logged: true, entity_id: resolvedEntityId });
}

// ============================================================================
// BRIDGE: Entity update — sync domain record field changes to canonical entity
// ============================================================================

async function bridgeUpdateEntity(req, res, user, workspaceId) {
  const { external_id, source_system, source_type, fields } = req.body || {};

  if (!external_id || !source_system) {
    return res.status(400).json({ error: 'external_id and source_system are required' });
  }

  if (!fields || Object.keys(fields).length === 0) {
    return res.status(200).json({ updated: false, reason: 'No fields to update' });
  }

  const link = await ensureEntityLink({
    workspaceId, userId: user.id, sourceSystem: source_system,
    sourceType: source_type || 'asset', externalId: external_id,
    seedFields: fields, metadata: { bridge_source: 'update_entity' }
  });
  if (!link.ok) {
    return res.status(500).json({ error: link.error, detail: link.detail });
  }

  const entityId = link.entityId;
  const allowedFields = ['name', 'description', 'first_name', 'last_name', 'title', 'phone', 'email',
    'org_type', 'address', 'city', 'state', 'zip', 'county', 'latitude', 'longitude', 'asset_type'];

  const updates = { updated_at: new Date().toISOString() };
  let fieldCount = 0;
  for (const f of allowedFields) {
    if (fields[f] !== undefined) {
      updates[f] = fields[f];
      fieldCount++;
    }
  }

  if (fields.name) {
    updates.canonical_name = normalizeCanonicalName(fields.name);
  }

  if (fieldCount === 0) {
    return res.status(200).json({ updated: false, reason: 'No recognized fields to update' });
  }

  const result = await opsQuery('PATCH',
    `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}`,
    updates
  );

  await opsQuery('PATCH',
    `external_identities?entity_id=eq.${entityId}&source_system=eq.${pgFilterVal(source_system)}`,
    { last_synced_at: new Date().toISOString() }
  );

  if (!result.ok) {
    return res.status(result.status || 500).json({ error: 'Failed to update entity' });
  }

  return res.status(200).json({
    updated: true,
    entity_id: entityId,
    fields_updated: fieldCount
  });
}

// ============================================================================
// BRIDGE: Prospecting Convergence (Phase 8, PR2 2026-05-30)
// create_lead       — property + resolved owner -> tracked lead + entity + BD opp
// initiate_cadence  — place an owner entity into the BD cadence (onboarding)
// Schema verified read-only against live DBs 2026-05-30. See
// audit/data-flow-2026-05-30/DRAFT_operations_create_lead_initiate_cadence.js
// ============================================================================

async function domainInsert(domain, table, row) {
  const isGov = domain === 'gov' || domain === 'government';
  const baseUrl = isGov ? process.env.GOV_SUPABASE_URL : process.env.DIA_SUPABASE_URL;
  const key = isGov ? govSupabaseKey() : diaSupabaseKey();
  if (!baseUrl || !key) {
    return { ok: false, status: 503, error: (isGov ? 'GOV' : 'DIA') + ' database not configured' };
  }
  try {
    const resp = await fetch(baseUrl + '/rest/v1/' + table, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_e) { data = text; }
    if (!resp.ok) return { ok: false, status: resp.status, error: 'Domain insert failed', detail: data };
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, status: 500, error: 'Domain insert threw', detail: err.message };
  }
}

// Read-only companion to domainInsert: GET against a domain REST collection.
// `pathWithQuery` is the table + PostgREST query string (e.g.
// 'prospect_leads?select=lead_id&...'). Soft-fails to {ok:false,data:null} so
// callers can degrade gracefully.
async function domainSelect(domain, pathWithQuery) {
  const isGov = domain === 'gov' || domain === 'government';
  const baseUrl = isGov ? process.env.GOV_SUPABASE_URL : process.env.DIA_SUPABASE_URL;
  const key = isGov ? govSupabaseKey() : diaSupabaseKey();
  if (!baseUrl || !key) return { ok: false, status: 503, data: null };
  try {
    const resp = await fetch(baseUrl + '/rest/v1/' + pathWithQuery, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_e) { data = null; }
    if (!resp.ok) return { ok: false, status: resp.status, data: null };
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err) {
    return { ok: false, status: 500, data: null };
  }
}

// R5 (2026-06-05): does an entity reconcile to a repeat-buyer PARENT? Repeat
// buyers are buy-side relationships — they never get a standard prospect
// opportunity (showings + buy-side outreach instead). Soft-fails to null so a
// transient LCC Opps hiccup never blocks the normal lead flow. The DB-side
// BEFORE-INSERT trigger is the hard guarantee; this is the friendly UI refusal.
async function resolveBuyerParent(entityId) {
  if (!entityId) return null;
  try {
    const r = await opsQuery('POST', 'rpc/lcc_resolve_buyer_parent', { p_entity_id: entityId });
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (r.ok && row && row.parent_entity_id) {
      return { parent_entity_id: row.parent_entity_id, parent_name: row.parent_name || null, match_tier: row.match_tier || null };
    }
  } catch (_e) { /* soft-fail */ }
  return null;
}

async function bridgeCreateLead(req, res, user, workspaceId) {
  const {
    domain, property_id, entity_id, owner_name, true_owner_name,
    true_owner_is_operator, owner_role, label, property_address, notes, source,
  } = req.body || {};

  if (!domain || (domain !== 'gov' && domain !== 'dia' && domain !== 'government' && domain !== 'dialysis')) {
    return res.status(400).json({ error: "domain is required ('gov' or 'dia')" });
  }
  if (!property_id) {
    return res.status(400).json({ error: 'property_id is required' });
  }

  const normDomain = (domain === 'government') ? 'gov' : (domain === 'dialysis') ? 'dia' : domain;
  const leadSource = source || 'property_flow';
  // BD outreach targets the landlord, never the tenant. When the caller flags
  // the resolved "true owner" as the operator (dialysis operator-chain model),
  // the true_owner is the tenant — anchor the entity/lead on the recorded owner
  // instead. Belt-and-suspenders to the frontend null-ing it (Bug a, 2026-06-03).
  const effectiveTrueOwner = true_owner_is_operator ? null : true_owner_name;
  const ownerDisplay = effectiveTrueOwner || owner_name || label || ('Property ' + property_id);

  // 1. Resolve/create the canonical owner entity, anchored to the asset.
  let resolvedEntityId = entity_id || null;
  let createdEntity = false;
  if (!resolvedEntityId) {
    const link = await ensureEntityLink({
      workspaceId, userId: user.id,
      sourceSystem: normDomain,
      sourceType: 'asset',
      externalId: String(property_id),
      domain: normDomain,
      seedFields: { name: ownerDisplay, org_type: 'owner', owner_role: owner_role || null, address: property_address || null },
    });
    if (!link.ok) {
      return res.status(link.status || 500).json({ error: link.error || 'Entity link failed', detail: link.detail });
    }
    resolvedEntityId = link.entityId;
    createdEntity = !!link.createdEntity;
  } else {
    // entity_id supplied (the property detail resolved the asset entity and
    // passed it). ensureEntityLink is skipped, so refresh the placeholder name
    // here too — the resolved asset entity often still reads "property <uuid>".
    // (E2E#6 follow-up, 2026-06-03)
    try { await refreshPlaceholderEntityNameById(resolvedEntityId, workspaceId, ownerDisplay); }
    catch (_e) { /* non-fatal: BD surfaces just keep the placeholder name */ }
  }

  // 1b. GATE (R5, 2026-06-05): SPE->parent reconciliation runs BEFORE opening.
  // If the resolved owner reconciles to a repeat-buyer parent, refuse the
  // standard prospect lead/opportunity and hand the caller the buy-side path
  // ("Open Government Buyer opportunity on <Parent>"). No lead, no opp created.
  const buyerParent = await resolveBuyerParent(resolvedEntityId);
  if (buyerParent) {
    return res.status(200).json({
      ok: true,
      blocked: 'repeat_buyer_spe',
      entity_id: resolvedEntityId,
      created_entity: createdEntity,
      parent_entity_id: buyerParent.parent_entity_id,
      parent_name: buyerParent.parent_name,
      message: 'This is an SPE of ' + (buyerParent.parent_name || 'a top repeat buyer')
        + ' — a repeat buyer. Buyers are prospected buy-side (showings + buy-side outreach), '
        + 'not with a standard prospect lead.',
    });
  }

  // 2. Insert the domain lead row (prospect_leads on gov, marketing_leads on dia).
  let leadRow, leadTable;
  if (normDomain === 'gov') {
    leadTable = 'prospect_leads';
    leadRow = {
      lead_source: leadSource,
      matched_property_id: property_id,
      address: property_address || label || null,
      recorded_owner: owner_name || null,
      true_owner: effectiveTrueOwner || null,
      owner_type: owner_role || null,
      pipeline_status: 'new',
      research_status: 'pending',
      research_notes: notes || null,
    };
  } else {
    leadTable = 'marketing_leads';
    leadRow = {
      source: leadSource,
      // Stamp the property id so the lead-row idempotency guard has a stable
      // key (marketing_leads has no property FK). (E2E#6 follow-up, 2026-06-03)
      source_ref: String(property_id),
      lead_name: ownerDisplay,
      lead_company: owner_name || effectiveTrueOwner || null,
      property_address: property_address || label || null,
      status: 'new',
      priority: 'normal',
      notes: notes || null,
    };
  }

  // Lead-row idempotency (E2E#6 follow-up, 2026-06-03): mirror the opportunity
  // guard at the domain-lead level. A verified double-click previously produced
  // ONE opportunity but TWO lead rows. Skip the insert when an OPEN lead for the
  // same property + source already exists. Voided / closed leads do NOT block —
  // re-creating after a void is the intended recovery path.
  const TERMINAL_LEAD_STATUS = '(void,closed,dead,disqualified,lost)';
  let leadId = null;
  let existingLead = false;
  let dup;
  if (normDomain === 'gov') {
    dup = await domainSelect('gov',
      'prospect_leads?select=lead_id&matched_property_id=eq.' + encodeURIComponent(property_id)
      + '&lead_source=eq.' + encodeURIComponent(leadSource)
      + '&pipeline_status=not.in.' + TERMINAL_LEAD_STATUS + '&limit=1');
  } else {
    dup = await domainSelect('dia',
      'marketing_leads?select=lead_id&source=eq.' + encodeURIComponent(leadSource)
      + '&source_ref=eq.' + encodeURIComponent(String(property_id))
      + '&status=not.in.' + TERMINAL_LEAD_STATUS + '&limit=1');
  }
  if (dup && dup.ok && Array.isArray(dup.data) && dup.data[0]) {
    leadId = dup.data[0].lead_id || dup.data[0].id || null;
    existingLead = true;
  }

  if (!existingLead) {
    const leadResult = await domainInsert(normDomain, leadTable, leadRow);
    if (!leadResult.ok) {
      return res.status(leadResult.status || 500).json({ error: leadResult.error, detail: leadResult.detail });
    }
    leadId = (leadResult.data && (leadResult.data.lead_id || leadResult.data.id)) || null;
  }

  // 3. Open a BD opportunity on LCC (is_open is GENERATED — omit it).
  // Idempotency (Bug b, 2026-06-03): a second "Create lead" / "open opportunity"
  // click must NOT open a duplicate. If this entity already has an OPEN prospect
  // opportunity, reuse it (and its already-seeded cadence) instead of inserting.
  let bdOpportunityId = null;
  let alreadyOpen = false;
  let cadenceSeeded = false;
  let cadenceNextTouchDue = null;

  const existingOpp = await opsQuery('GET',
    'bd_opportunities?select=id&entity_id=eq.' + pgFilterVal(resolvedEntityId)
    + '&type=eq.prospect&is_open=is.true&order=opened_at.desc&limit=1');
  if (existingOpp.ok && Array.isArray(existingOpp.data) && existingOpp.data[0]) {
    bdOpportunityId = existingOpp.data[0].id;
    alreadyOpen = true;
  }
  // Cross-flow / re-resolved-entity dedupe (design note 1, 2026-06-03): the
  // property flow anchors on the ASSET entity (lookup_asset) while other paths
  // may resolve a different entity for the same building. The entity-keyed
  // guard above misses those, so also reuse an OPEN prospect opp previously
  // opened for this exact property+vertical (stamped in metadata). Forward-safe:
  // only ADDS a reuse path, never creates a duplicate. (Full org-vs-asset
  // entity unification — having the queue's open_opportunity stamp
  // source_property_id, or property-flow prefer the queue's owner entity — is
  // deferred; see PR notes.)
  if (!bdOpportunityId) {
    const existingByProp = await opsQuery('GET',
      'bd_opportunities?select=id&type=eq.prospect&is_open=is.true'
      + '&metadata->>source_property_id=eq.' + encodeURIComponent(String(property_id))
      + '&metadata->>source_domain=eq.' + encodeURIComponent(normDomain)
      + '&order=opened_at.desc&limit=1');
    if (existingByProp.ok && Array.isArray(existingByProp.data) && existingByProp.data[0]) {
      bdOpportunityId = existingByProp.data[0].id;
      alreadyOpen = true;
    }
  }
  if (!bdOpportunityId) {
    const oppResult = await opsQuery('POST', 'bd_opportunities', {
      workspace_id: workspaceId,
      entity_id: resolvedEntityId,
      type: 'prospect',
      stage: 'identified',
      vertical: normDomain,
      owner_user_id: user.id,
      opened_at: new Date().toISOString(),
      metadata: { origin: 'property_flow', source_domain: normDomain, source_property_id: String(property_id), lead_id: leadId },
    });
    if (oppResult.ok) {
      const opp = Array.isArray(oppResult.data) ? oppResult.data[0] : oppResult.data;
      bdOpportunityId = (opp && opp.id) || null;
    } else {
      console.warn('[create_lead] bd_opportunity insert failed (non-fatal):', oppResult.data);
    }
  }

  if (bdOpportunityId) {
    // The bd_opportunity_auto_seed_cadence trigger fires synchronously on INSERT,
    // so a cadence exists (whether just-seeded or from the pre-existing opp). Read
    // back its next touch so the property "Next step" banner can render
    // "On cadence ✓ — next touch <date>" instead of redundantly offering
    // "Add to cadence" (Nit 2).
    cadenceSeeded = true;
    try {
      const cadR = await opsQuery('GET',
        'touchpoint_cadence?select=next_touch_due&entity_id=eq.' + pgFilterVal(resolvedEntityId)
        + '&order=updated_at.desc&limit=1');
      if (cadR.ok && Array.isArray(cadR.data) && cadR.data[0]) {
        cadenceNextTouchDue = cadR.data[0].next_touch_due || null;
      }
    } catch (_e) { /* non-fatal: banner falls back to a date-less "On cadence ✓" */ }
  }

  // 4. Canonical activity for the timeline.
  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: 'status_change',
    title: 'Lead created from property: ' + ownerDisplay,
    body: notes || null,
    entity_id: resolvedEntityId,
    source_type: 'system', domain: normDomain,
    visibility: 'shared',
    metadata: { bridge_source: 'create_lead', lead_id: leadId, bd_opportunity_id: bdOpportunityId, source_property_id: String(property_id) },
    occurred_at: new Date().toISOString(),
  });

  // 5. Best-effort Teams alert.
  sendTeamsAlert({
    title: 'New BD Lead Created',
    summary: ownerDisplay,
    severity: 'success',
    facts: [
      ['Owner', ownerDisplay],
      ['Property', property_address || label || String(property_id)],
      ['Vertical', normDomain],
      ['Next action', 'Add to cadence / begin outreach'],
    ],
    actions: [{ label: 'View in LCC', url: (process.env.LCC_BASE_URL || '') + '/' + normDomain }],
  }).catch(function () {});

  return res.status(201).json({
    ok: true,
    lead_id: leadId,
    entity_id: resolvedEntityId,
    bd_opportunity_id: bdOpportunityId,
    already_open: alreadyOpen,
    created_entity: createdEntity,
    cadence_seeded: cadenceSeeded,
    cadence_next_touch_due: cadenceNextTouchDue,
  });
}

async function bridgeInitiateCadence(req, res, user, workspaceId) {
  const {
    entity_id, contact_id, sf_contact_id,
    property_id, property_address, domain,
    phase, priority_tier,
  } = req.body || {};

  if (!entity_id && !contact_id && !sf_contact_id) {
    return res.status(400).json({ error: 'At least one of entity_id, contact_id, sf_contact_id is required' });
  }

  // R8 Unit 2 (gate-predicate sweep): a repeat-buyer parent/SPE must NOT get a
  // prospect/onboarding cadence — that's a buy-side relationship (it gets a
  // 'buy_side' cadence via Open Government Buyer → Select prospecting contact).
  // The R5 DB trigger only guards bd_opportunities; touchpoint_cadence has no
  // such trigger, so this IS the gate for the cadence path (including Copilot /
  // agent calls). Refuse the same shape as create_lead / open_opportunity and
  // offer the Government Buyer path. Buy-side cadences (the legitimate route) set
  // phase='buy_side' and pass through. Runs BEFORE getCadenceState so no cadence
  // row is created on refusal.
  const _wantPhaseGate = phase || 'onboarding';
  if (entity_id && _wantPhaseGate !== 'buy_side') {
    const parent = await resolveBuyerParent(entity_id);
    if (parent) {
      return res.status(200).json({
        ok: true, blocked: 'repeat_buyer_spe', cadence_id: null,
        parent_entity_id: parent.parent_entity_id, parent_name: parent.parent_name,
        message: 'This entity reconciles to repeat-buyer parent "'
          + (parent.parent_name || parent.parent_entity_id)
          + '". Repeat buyers are a buy-side relationship — open a Government Buyer '
          + 'opportunity on the parent and add a buy-side cadence via the '
          + 'prospecting-contact step, not an onboarding cadence.',
        next: { action: 'open_government_buyer', entity_id: parent.parent_entity_id },
      });
    }
  }

  const state = await getCadenceState(
    { entity_id, contact_id, sf_contact_id },
    { property_id, property_address, domain }
  );
  if (!state.ok) {
    return res.status(state.status || 500).json({ error: state.error || 'Failed to initialize cadence', detail: state.detail });
  }

  const cadence = state.cadence;
  const wantPhase = phase || 'onboarding';
  const wantTier = priority_tier || cadence.priority_tier || 'B';

  if (state.is_new || cadence.phase !== wantPhase || cadence.priority_tier !== wantTier) {
    const patch = await opsQuery('PATCH', 'touchpoint_cadence?id=eq.' + pgFilterVal(cadence.id), { phase: wantPhase, priority_tier: wantTier });
    if (patch.ok && Array.isArray(patch.data) && patch.data[0]) {
      Object.assign(cadence, patch.data[0]);
    } else {
      console.warn('[initiate_cadence] phase/tier patch failed (non-fatal):', patch.data);
    }
  }

  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: 'status_change',
    title: 'Added to ' + wantPhase + ' cadence',
    entity_id: entity_id || cadence.entity_id || null,
    source_type: 'system', domain: domain || cadence.domain || null,
    visibility: 'shared',
    metadata: { bridge_source: 'initiate_cadence', cadence_id: cadence.id, phase: wantPhase, priority_tier: wantTier, source_property_id: property_id ? String(property_id) : null },
    occurred_at: new Date().toISOString(),
  });

  return res.status(201).json({ ok: true, cadence_id: cadence.id, next_touch_due: cadence.next_touch_due || null, is_new: !!state.is_new });
}

// ============================================================================
// BRIDGE: Open a BD opportunity for an owner-level priority-queue row (QA#2)
// ============================================================================
//
// The P0.5 band ("Needs a BD opportunity opened") is the top of the priority
// queue but had no actionable control — every row showed an inert owner-level
// badge. Each row carries entity_id; LCC Opps already has
// public.lcc_open_prospect_opportunity() to spin up the bd_opportunity. This
// makes the queue self-propelling: one click opens the opportunity and the row
// advances.

async function bridgeOpenOpportunity(req, res, user, workspaceId) {
  const { entity_id, vertical } = req.body || {};

  if (!entity_id) {
    return res.status(400).json({ error: 'entity_id is required' });
  }

  const rpc = await opsQuery('POST', 'rpc/lcc_open_prospect_opportunity', {
    p_entity_id: entity_id,
    p_owner_user_id: user.id,
    p_vertical: vertical || null,
    p_source: 'priority_queue',
  });
  if (!rpc.ok) {
    console.warn('[open_opportunity] rpc failed:', rpc.status, rpc.data);
    return res.status(rpc.status || 500).json({ error: 'open_opportunity_failed', detail: rpc.data });
  }

  // The RPC returns a single row {opportunity_id, already_open, blocked,
  // parent_entity_id, parent_name}. R5: a repeat-buyer SPE/parent is refused a
  // prospect opportunity — surface the structured refusal so the caller (and
  // the bulk "Open top N") can skip-and-report and offer the buy-side path.
  // PostgREST surfaces a RETURNS TABLE function as an array of rows.
  const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
  if (row && row.blocked === 'repeat_buyer_spe') {
    return res.status(200).json({
      ok: true,
      blocked: 'repeat_buyer_spe',
      bd_opportunity_id: null,
      already_open: false,
      parent_entity_id: row.parent_entity_id || null,
      parent_name: row.parent_name || null,
    });
  }
  const oppId = row ? (row.opportunity_id || null) : null;
  const alreadyOpen = !!(row && row.already_open);
  return res.status(alreadyOpen ? 200 : 201).json({
    ok: true,
    bd_opportunity_id: oppId,
    already_open: alreadyOpen,
  });
}

// ============================================================================
// BRIDGE: Open a GOVERNMENT BUYER opportunity on a repeat-buyer PARENT (R5)
// ============================================================================
//
// Doctrine: top repeat buyers are buy-side relationships. The only opportunity
// they may carry is a "Government Buyer" opportunity, and it sits on the actual
// PARENT account, never a subsidiary SPE. The RPC resolves an SPE to its parent
// and is idempotent (one open government_buyer per parent). When the parent has
// no mapped Salesforce account, the open-path logs a research task ("map
// <Parent> to SF parent account") and the opportunity sync holds.
async function bridgeOpenGovernmentBuyer(req, res, user, workspaceId) {
  const { entity_id } = req.body || {};
  if (!entity_id) return res.status(400).json({ error: 'entity_id is required' });

  const rpc = await opsQuery('POST', 'rpc/lcc_open_government_buyer_opportunity', {
    p_entity_id: entity_id,
    p_owner_user_id: user.id,
    p_source: 'priority_queue',
  });
  if (!rpc.ok) {
    console.warn('[open_government_buyer] rpc failed:', rpc.status, rpc.data);
    return res.status(rpc.status || 500).json({ error: 'open_government_buyer_failed', detail: rpc.data });
  }
  const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
  const oppId = row ? (row.opportunity_id || null) : null;
  const alreadyOpen = !!(row && row.already_open);
  const parentId = row ? (row.parent_entity_id || null) : null;
  const parentName = row ? (row.parent_name || null) : null;
  const needsSfMapping = !!(row && row.needs_sf_mapping);

  // SF parent-account routing: when unmapped, never route to a subsidiary —
  // log a research task and let the opportunity sync hold (surfaced in
  // v_lcc_government_buyer_sync_health). Best-effort; never fails the open.
  if (needsSfMapping && parentId && !alreadyOpen) {
    try {
      await opsQuery('POST', 'activity_events', {
        workspace_id: workspaceId, actor_id: user.id,
        category: 'status_change',
        title: 'Research task: map ' + (parentName || 'buyer parent') + ' to its Salesforce parent account',
        body: 'Government Buyer opportunity opened on the parent but no Salesforce Account is linked. '
            + 'Map the SF parent account so the opportunity can sync (never route to a subsidiary SPE).',
        entity_id: parentId,
        source_type: 'system', domain: row.vertical || null,
        visibility: 'shared',
        metadata: { bridge_source: 'open_government_buyer', bd_opportunity_id: oppId, sf_mapping_needed: true },
        occurred_at: new Date().toISOString(),
      });
    } catch (_e) { /* non-fatal */ }
  }

  return res.status(alreadyOpen ? 200 : 201).json({
    ok: true,
    bd_opportunity_id: oppId,
    already_open: alreadyOpen,
    parent_entity_id: parentId,
    parent_name: parentName,
    needs_sf_mapping: needsSfMapping,
  });
}

// ============================================================================
// BUY-SIDE CONTACT STEP (R7 Phase 2.4)
// ============================================================================
// After a Government Buyer opp is open + the parent is SF-mapped, the next
// action is selecting the prospecting CONTACT, then a buy-side cadence. The
// account-level opp routes to the parent; the cadence carries the person.

// GET ?action=buyer_contacts&entity_id=<parent> — candidate contacts for the
// buy-side cadence, from three sources: (a) person entities already related to
// the parent, (b) Salesforce contacts on the mapped account, (c) name-matched
// person entities (e.g. the ~18 captured "Boyd" persons not yet linked).
async function getBuyerContacts(req, res, user, workspaceId) {
  const entityId = String(req.query.entity_id || '').trim();
  if (!entityId) return res.status(400).json({ error: 'entity_id required' });

  // Parent name + mapped SF account.
  let parentName = null, sfAccountId = null;
  try {
    const pe = await opsQuery('GET', 'entities?id=eq.' + pgFilterVal(entityId) + '&select=name&limit=1');
    if (pe.ok && Array.isArray(pe.data) && pe.data[0]) parentName = pe.data[0].name || null;
    const bp = await opsQuery('GET', 'lcc_buyer_parents?parent_entity_id=eq.' + pgFilterVal(entityId)
      + '&select=sf_account_id&limit=1');
    if (bp.ok && Array.isArray(bp.data) && bp.data[0]) sfAccountId = bp.data[0].sf_account_id || null;
  } catch (_e) { /* soft */ }

  // (a) Related person entities (associated_with, either direction).
  const related = [];
  const relatedIds = new Set();
  try {
    const rel = await opsQuery('GET', 'entity_relationships?select=from_entity_id,to_entity_id,relationship_type'
      + '&or=(from_entity_id.eq.' + pgFilterVal(entityId) + ',to_entity_id.eq.' + pgFilterVal(entityId) + ')&limit=100');
    const otherIds = new Set();
    if (rel.ok && Array.isArray(rel.data)) {
      for (const r of rel.data) {
        const other = r.from_entity_id === entityId ? r.to_entity_id : r.from_entity_id;
        if (other && other !== entityId) otherIds.add(other);
      }
    }
    if (otherIds.size) {
      const ids = Array.from(otherIds).map(pgFilterVal).join(',');
      const persons = await opsQuery('GET', 'entities?select=id,name,entity_type,metadata&entity_type=eq.person&id=in.(' + ids + ')&limit=50');
      if (persons.ok && Array.isArray(persons.data)) {
        for (const p of persons.data) {
          // Skip rows already flagged junk; a related person should still be a
          // plausible human (a mistyped firm linked here is not a contact).
          // R17 Unit 3: also skip orphan-flagged entities (dead-weight graph rows).
          if (p.metadata && (p.metadata.junk_name_flagged === true || p.metadata.orphan_flagged === true)) continue;
          related.push({ entity_id: p.id, name: p.name }); relatedIds.add(p.id);
        }
      }
    }
  } catch (_e) { /* soft */ }

  // (b) Salesforce contacts on the mapped account. sf_status is honest about
  // WHY a section is empty (never a silent blank): no_account / not_configured /
  // unavailable (flow op missing) / no_contacts / ok.
  let sfContacts = [];
  let sfStatus = sfAccountId ? 'unknown' : 'no_account';
  if (sfAccountId) {
    try {
      const { getSalesforceContactsByAccount } = await import('./_shared/salesforce.js');
      const r = await getSalesforceContactsByAccount(sfAccountId);
      if (r.ok && Array.isArray(r.contacts)) {
        sfContacts = r.contacts.map(c => ({ sf_contact_id: c.Id, name: c.Name, title: c.Title, email: c.Email }));
        sfStatus = sfContacts.length ? 'ok' : 'no_contacts';
      } else {
        sfStatus = r.reason === 'sf_not_configured' ? 'not_configured'
                 : r.reason === 'bad_account_id'    ? 'no_account'
                 : 'unavailable';   // flow op missing / lookup failed
      }
    } catch (_e) { sfStatus = 'unavailable'; }
  }

  // (c) Name-matched PLAUSIBLE-HUMAN person entities not already related (the
  // real "Boyd" people), excluding capture artifacts + junk-flagged rows.
  const nameMatches = [];
  if (parentName) {
    const pnLower = String(parentName).toLowerCase().trim();
    const core = String(parentName).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/)[0] || '';
    if (core.length >= 3) {
      try {
        const nm = await opsQuery('GET', 'entities?select=id,name,metadata&entity_type=eq.person'
          + '&name=ilike.' + pgFilterVal('%' + core + '%') + '&limit=60');
        if (nm.ok && Array.isArray(nm.data)) {
          for (const p of nm.data) {
            if (relatedIds.has(p.id)) continue;
            // R17 Unit 3: drop junk-named AND orphan-flagged entities from the picker.
            if (p.metadata && (p.metadata.junk_name_flagged === true || p.metadata.orphan_flagged === true)) continue;
            if (!looksLikePersonName(p.name)) continue;   // only selectable humans
            // Exclude the firm name itself mistyped as a person ("Boyd Watterson"
            // / "Boyd Watterson Global" both ⊆/⊇ the parent name) — a contact is
            // a human, not the company.
            const cn = String(p.name).toLowerCase().trim();
            if (pnLower && (pnLower.indexOf(cn) !== -1 || cn.indexOf(pnLower) !== -1)) continue;
            nameMatches.push({ entity_id: p.id, name: p.name });
            if (nameMatches.length >= 15) break;
          }
        }
      } catch (_e) { /* soft */ }
    }
  }

  return res.status(200).json({
    ok: true, parent_entity_id: entityId, parent_name: parentName,
    sf_account_id: sfAccountId, sf_status: sfStatus,
    related, sf_contacts: sfContacts, name_matches: nameMatches,
  });
}

// POST select_buyer_contact { entity_id, bd_opportunity_id, contact_entity_id?,
//   sf_contact_id?, contact_name?, new_contact_name?, domain? }
// Effect-first: resolve/create the person, link person→parent, seed the
// buy-side cadence (lcc_seed_buyer_cadence), then record primary_contact on the
// opportunity. Outcome-truthful: a failed cadence seed 502s and records nothing.
async function bridgeSelectBuyerContact(req, res, user, workspaceId) {
  const b = req.body || {};
  const entityId = String(b.entity_id || '').trim();
  const oppId = b.bd_opportunity_id ? String(b.bd_opportunity_id).trim() : null;
  if (!entityId) return res.status(400).json({ error: 'entity_id (parent) is required' });

  let contactEntityId = b.contact_entity_id ? String(b.contact_entity_id).trim() : null;
  let sfContactId = b.sf_contact_id ? String(b.sf_contact_id).trim() : null;
  let contactName = b.contact_name ? String(b.contact_name).trim() : null;
  const newName = b.new_contact_name ? String(b.new_contact_name).trim() : null;
  const domain = b.domain ? String(b.domain).trim() : null;

  // Create a new person entity when requested.
  if (!contactEntityId && !sfContactId && newName) {
    const canon = (typeof normalizeCanonicalName === 'function') ? normalizeCanonicalName(newName) : newName.toLowerCase();
    const ins = await opsQuery('POST', 'entities',
      { workspace_id: workspaceId, entity_type: 'person', name: newName, canonical_name: canon, domain: 'lcc' });
    const row = (ins.ok && Array.isArray(ins.data)) ? ins.data[0] : null;
    if (!ins.ok || !row) return res.status(502).json({ error: 'create_contact_failed', detail: ins.data });
    contactEntityId = row.id; contactName = newName;
  }
  if (!contactEntityId && !sfContactId) {
    return res.status(400).json({ error: 'Provide contact_entity_id, sf_contact_id, or new_contact_name' });
  }

  // Link person→parent (associated_with) — best-effort, guarded against dupes
  // (no unique index on entity_relationships, so pre-check).
  if (contactEntityId) {
    try {
      const exists = await opsQuery('GET', 'entity_relationships?select=id&relationship_type=eq.associated_with'
        + '&from_entity_id=eq.' + pgFilterVal(entityId) + '&to_entity_id=eq.' + pgFilterVal(contactEntityId) + '&limit=1');
      if (!(exists.ok && Array.isArray(exists.data) && exists.data[0])) {
        await insertEntityRelationship({
          workspace_id: workspaceId, from_entity_id: entityId, to_entity_id: contactEntityId,
          relationship_type: 'associated_with', metadata: { role: 'buy_side_contact', via: 'priority_queue' },
        });
      }
    } catch (_e) { /* non-fatal */ }
    // Pull the name if not supplied.
    if (!contactName) {
      try {
        const ce = await opsQuery('GET', 'entities?id=eq.' + pgFilterVal(contactEntityId) + '&select=name&limit=1');
        if (ce.ok && Array.isArray(ce.data) && ce.data[0]) contactName = ce.data[0].name || null;
      } catch (_e) { /* soft */ }
    }
  }

  // Effect FIRST: seed the buy-side cadence.
  const seed = await opsQuery('POST', 'rpc/lcc_seed_buyer_cadence', {
    p_bd_opportunity_id: oppId, p_entity_id: entityId,
    p_contact_id: contactEntityId, p_sf_contact_id: sfContactId,
    p_contact_name: contactName, p_owner_user_id: user.id, p_domain: domain,
  });
  if (!seed.ok) {
    console.warn('[select_buyer_contact] cadence seed failed:', seed.status, seed.data);
    return res.status(502).json({ error: 'cadence_seed_failed', detail: seed.data });
  }
  const cad = Array.isArray(seed.data) ? seed.data[0] : seed.data;

  // R16: fire the SF Task at contact-selection time (WhoId is now known). A
  // government buyer is a plain buy-side touchpoint → NMType BLANK (never
  // "Opportunity"). Best-effort + outcome-truthful: a missing sf_contact_id is
  // recorded as `sf_task_pending_contact` (we do NOT invent a WhoId), and a
  // failed SF write never fails the selection and never fabricates an sf_opp_id.
  let sfTaskId = null;
  let sfTaskStatus = sfContactId ? null : 'sf_task_pending_contact';
  let parentName = null;
  let sfAccountId = null;
  if (sfContactId) {
    try {
      try {
        const pe = await opsQuery('GET', 'entities?id=eq.' + pgFilterVal(entityId) + '&select=name&limit=1');
        if (pe.ok && Array.isArray(pe.data) && pe.data[0]) parentName = pe.data[0].name || null;
      } catch (_e) { /* soft */ }
      try {
        const bp = await opsQuery('GET', 'lcc_buyer_parents?parent_entity_id=eq.' + pgFilterVal(entityId) + '&select=sf_account_id&limit=1');
        if (bp.ok && Array.isArray(bp.data) && bp.data[0]) sfAccountId = bp.data[0].sf_account_id || null;
      } catch (_e) { /* soft */ }
      const { createSalesforceTask } = await import('./_shared/salesforce.js');
      const sf = await createSalesforceTask({
        whoId: sfContactId,
        subject: (parentName || contactName || 'Buyer') + ' — Government Buyer',
        nmType: null,            // buyer = blank NMType
        status: 'Open',
        whatId: sfAccountId,
        // R16b: Task Due Date = the buy-side cadence's next_touch_due (the row
        // we just seeded). Helper defaults to today when absent.
        activityDate: (cad && cad.next_touch_due) ? cad.next_touch_due : undefined,
        idempotencyKey: oppId || undefined,
      });
      if (sf.ok && sf.task && sf.task.Id) { sfTaskId = sf.task.Id; sfTaskStatus = 'created'; }
      else { sfTaskStatus = 'sf_task_failed:' + (sf.reason || 'unknown'); }
    } catch (_e) { sfTaskStatus = 'sf_task_error'; }
  }

  // Record primary_contact (+ the SF task id) on the opportunity. On a
  // successful SF Task create, also stamp sf_opp_id (the 00T id) so the
  // gov-buyer sync sees it `synced` and never double-creates.
  if (oppId) {
    try {
      const cur = await opsQuery('GET', 'bd_opportunities?id=eq.' + pgFilterVal(oppId) + '&select=metadata&limit=1');
      const meta = (cur.ok && Array.isArray(cur.data) && cur.data[0] && cur.data[0].metadata) ? cur.data[0].metadata : {};
      const nextMeta = Object.assign({}, meta, {
        primary_contact: {
          entity_id: contactEntityId, sf_contact_id: sfContactId, name: contactName,
          sf_task_id: sfTaskId, set_at: new Date().toISOString(),
        },
      });
      const patch = { metadata: nextMeta };
      if (sfTaskId) patch.sf_opp_id = sfTaskId;
      await opsQuery('PATCH', 'bd_opportunities?id=eq.' + pgFilterVal(oppId), patch);
    } catch (_e) { /* non-fatal */ }
  }

  // Staleness hook: the parent now lives in the cadence bands, not "to decide".
  try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }

  return res.status(200).json({
    ok: true, entity_id: entityId, bd_opportunity_id: oppId,
    contact_entity_id: contactEntityId, sf_contact_id: sfContactId, contact_name: contactName,
    cadence_id: cad ? cad.id : null, phase: cad ? cad.phase : 'buy_side',
    next_touch_due: cad ? cad.next_touch_due : null,
    sf_task_id: sfTaskId, sf_task_status: sfTaskStatus,
  });
}

// ============================================================================
// GET cadence_dashboard (R10 Unit 4) — render v_bd_cadence_dashboard
//
// One row per active cadence with phase, touch N, due/overdue, last outcome,
// engagement counts, and the portfolio context. Drives the cadence tab + the
// draft/mark-sent outreach surface. Ordered most-overdue first.
// ============================================================================
async function getCadenceDashboard(req, res, user, workspaceId) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const phase = req.query.phase ? String(req.query.phase).trim() : null;
  // R34 Unit 2: highest relationship value first (the column the view now
  // exposes — same source as the priority queue's rank_annual_rent), then
  // most-overdue. High-value owner relationships lead; brokers/small contacts
  // fall below — honest ranking, no exclusion.
  let path = 'v_bd_cadence_dashboard?workspace_id=eq.' + pgFilterVal(workspaceId)
    + '&order=rank_value.desc.nullslast,days_overdue.desc.nullslast,next_touch_due.asc.nullslast'
    + '&limit=' + limit;
  if (phase) {
    path += '&phase=eq.' + pgFilterVal(phase);
  } else {
    // R34 Unit 3: parked/opted-out cadences are not active work — keep them out
    // of the default dashboard (a paused >180d-overdue row leaves the set).
    // 'converted' (engaged) and 'dormant' (annual check-in) stay visible.
    path += '&phase=not.in.(paused,unsubscribed)';
  }
  const r = await opsQuery('GET', path, undefined, { countMode: 'exact' });
  if (!r.ok) return res.status(r.status || 500).json({ error: 'Failed to load cadence dashboard', detail: r.data });
  return res.status(200).json({ ok: true, items: Array.isArray(r.data) ? r.data : [], total: r.count ?? null });
}

// ============================================================================
// BRIDGE: Select prospecting contact (R10 Unit 3) — P-CONTACT lane
//
// A prospecting cadence with no reachable contact is parked in P-CONTACT. This
// attaches the chosen contact to the EXISTING active cadence (it does NOT seed a
// new buy-side cadence — that is the P-BUYER path). Effect: resolve/create the
// person, link person→entity (associated_with → makes the entity "connected"),
// and stamp the contact onto the entity's active cadence (contact_id has no FK;
// sf_contact_id is free text), so the reachability gate now passes and the row
// leaves P-CONTACT for the cadence bands. Refreshes the queue cache.
// ============================================================================
async function bridgeSelectProspectingContact(req, res, user, workspaceId) {
  const b = req.body || {};
  const entityId = String(b.entity_id || '').trim();
  if (!entityId) return res.status(400).json({ error: 'entity_id is required' });

  let contactEntityId = b.contact_entity_id ? String(b.contact_entity_id).trim() : null;
  let sfContactId = b.sf_contact_id ? String(b.sf_contact_id).trim() : null;
  let contactName = b.contact_name ? String(b.contact_name).trim() : null;
  const newName = b.new_contact_name ? String(b.new_contact_name).trim() : null;

  // Create a new person entity when requested.
  if (!contactEntityId && !sfContactId && newName) {
    const canon = (typeof normalizeCanonicalName === 'function') ? normalizeCanonicalName(newName) : newName.toLowerCase();
    const ins = await opsQuery('POST', 'entities',
      { workspace_id: workspaceId, entity_type: 'person', name: newName, canonical_name: canon, domain: 'lcc' });
    const row = (ins.ok && Array.isArray(ins.data)) ? ins.data[0] : null;
    if (!ins.ok || !row) return res.status(502).json({ error: 'create_contact_failed', detail: ins.data });
    contactEntityId = row.id; contactName = newName;
  }
  if (!contactEntityId && !sfContactId) {
    return res.status(400).json({ error: 'Provide contact_entity_id, sf_contact_id, or new_contact_name' });
  }

  // Link person→entity (associated_with) — dupe-guarded (no unique index).
  // Shared with the R16 contact-acquisition worker via contact-attach.js.
  if (contactEntityId) {
    await linkPersonToEntity({ workspaceId, entityId, contactEntityId, role: 'prospecting_contact', via: 'priority_queue' });
    if (!contactName) {
      try {
        const ce = await opsQuery('GET', 'entities?id=eq.' + pgFilterVal(contactEntityId) + '&select=name&limit=1');
        if (ce.ok && Array.isArray(ce.data) && ce.data[0]) contactName = ce.data[0].name || null;
      } catch (_e) { /* soft */ }
    }
  }

  // Stamp the contact onto the entity's active cadence (effect FIRST). Most
  // overdue active cadence is the one driving the P-CONTACT card.
  let cadenceId = null;
  let cadenceOppId = null;
  let cadenceNextDue = null;
  if (contactEntityId || sfContactId) {
    const stamp = await stampContactOnActiveCadence({ entityId, contactEntityId, sfContactId });
    if (!stamp.ok && stamp.reason === 'no_active_cadence') {
      return res.status(404).json({ error: 'no_active_cadence', detail: 'No active cadence on this entity to attach the contact to' });
    }
    if (!stamp.ok) return res.status(502).json({ error: 'cadence_attach_failed', detail: stamp.detail });
    cadenceId = stamp.cadenceId;
    cadenceOppId = stamp.cadenceOppId;
    cadenceNextDue = stamp.cadenceNextDue;
  }

  // R16: fire the SF Task at contact-selection time (WhoId is now known). A
  // seller prospect carries NMType="Opportunity". Best-effort + outcome-
  // truthful: no sf_contact_id → `sf_task_pending_contact` (no invented WhoId);
  // a failed SF write never fails the selection. When the cadence is tied to a
  // bd_opportunity and the task is created, stamp sf_opp_id (the 00T id).
  let sfTaskId = null;
  let sfTaskStatus = sfContactId ? null : 'sf_task_pending_contact';
  if (sfContactId) {
    try {
      let entityName = contactName;
      try {
        const ee = await opsQuery('GET', 'entities?id=eq.' + pgFilterVal(entityId) + '&select=name&limit=1');
        if (ee.ok && Array.isArray(ee.data) && ee.data[0]) entityName = ee.data[0].name || entityName;
      } catch (_e) { /* soft */ }
      const { createSalesforceTask } = await import('./_shared/salesforce.js');
      const sf = await createSalesforceTask({
        whoId: sfContactId,
        subject: (entityName || contactName || 'Prospect') + ' — Prospect',
        nmType: 'Opportunity',   // seller prospect
        status: 'Open',
        // R16b: Task Due Date = the cadence's next_touch_due (the row we just
        // stamped the contact onto). Helper defaults to today when absent.
        activityDate: cadenceNextDue || undefined,
        idempotencyKey: cadenceOppId || undefined,
      });
      if (sf.ok && sf.task && sf.task.Id) { sfTaskId = sf.task.Id; sfTaskStatus = 'created'; }
      else { sfTaskStatus = 'sf_task_failed:' + (sf.reason || 'unknown'); }
    } catch (_e) { sfTaskStatus = 'sf_task_error'; }
    if (sfTaskId && cadenceOppId) {
      try {
        await opsQuery('PATCH', 'bd_opportunities?id=eq.' + pgFilterVal(cadenceOppId), { sf_opp_id: sfTaskId });
      } catch (_e) { /* non-fatal */ }
    }
  }

  // Staleness hook: the entity is now reachable — it leaves P-CONTACT.
  try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }

  return res.status(200).json({
    ok: true, entity_id: entityId, contact_entity_id: contactEntityId,
    sf_contact_id: sfContactId, contact_name: contactName, cadence_id: cadenceId,
    sf_task_id: sfTaskId, sf_task_status: sfTaskStatus,
  });
}

// ============================================================================
// GET contact_qualify_worklist (R28 Unit 2) — value-ranked captured contacts
//
// The ~421 new_contact_qualify inbox rows are real CoStar-captured contacts,
// connected to the entity graph but never activated. This lists them as a
// bounded worklist (junk excluded at the view), persons-with-email first then
// by the value of the property they were captured on (rank_value). `total` is
// the full workable universe; `items` is the top-N to actually work.
// ============================================================================
// R29 Unit 2 — a CONTACT-qualify worklist must contain only real qualifiable
// contacts. The view already drops junk/orphan-flagged rows, but it can't
// express the R20 person-name-shape guard, so firms mistyped as persons
// (entity_type='person' with a firm-shaped / single-token name — Jamestown,
// Akridge, MetLife …) still leak in and pollute the qualify pile. Exclude them
// with the SAME looksLikePersonName guard the contact picker / reachability gate
// use (reuse, don't reinvent). Non-person rows (organizations) pass untouched.
// Pure + exported so the exclusion is unit-tested.
export function filterQualifiableContacts(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) =>
    String(row && row.entity_type) !== 'person' || looksLikePersonName(row && row.contact_name));
}

async function getContactQualifyWorklist(req, res, user, workspaceId) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  // R28 ordering (emailable first, then by captured-property value) is the
  // single ordering source. Fetch the full ordered workable page (PostgREST
  // caps responses at 1000 rows), apply the R29 firm-as-person exclusion, then
  // slice to `limit` so BOTH `items` and `total` reflect the post-exclusion
  // universe (honest count — the old `total` counted the leaked firms too).
  const path = 'v_lcc_contact_qualify_worklist?workspace_id=eq.' + pgFilterVal(workspaceId)
    + '&order=has_email.desc,rank_value.desc.nullslast,received_at.asc'
    + '&limit=1000';
  const r = await opsQuery('GET', path, undefined, { countMode: 'none' });
  if (!r.ok) return res.status(r.status || 500).json({ error: 'Failed to load contact-qualify worklist', detail: r.data });
  const qualifiable = filterQualifiableContacts(Array.isArray(r.data) ? r.data : []);
  return res.status(200).json({ ok: true, items: qualifiable.slice(0, limit), total: qualifiable.length });
}

// ============================================================================
// BRIDGE: Qualify a captured contact (R28 Unit 2) — the "activate" terminal
//
// Turns a parked new_contact_qualify inbox row into an active relationship that
// feeds the (contact-starved) outreach engine, then dispositions the inbox row
// terminal so it leaves the pile. Reuses the R16/R20 contact-attach machinery:
//   1. Resolve the OWNER of the property the contact was captured on (owns edge).
//   2. Link the captured person → owner (associated_with, dupe-guarded).
//   3. Stamp the contact onto a CONTACTLESS active cadence — the owner's first
//      (so it never clobbers an existing contact), else the person's OWN cadence
//      (R20: a person is their own contact), so a real recipient lands on a
//      cadence that lacked one.
//   4. Set the inbox row → 'promoted' (the activate terminal) — the guaranteed
//      effect even when no cadence is stampable; link/stamp are best-effort and
//      reported (outcome-truthful).
// ============================================================================
// Deps-injected core (testable, mirrors performCreRegister / performDocWriteback).
// deps: { getRow, resolveOwner, linkPerson, stampCadence, dispositionInbox, refreshQueue }
export async function performContactQualify({ inboxItemId, workspaceId }, deps) {
  if (!/^[0-9a-fA-F-]{36}$/.test(String(inboxItemId || ''))) {
    return { status: 400, body: { error: 'inbox_item_id (uuid) is required' } };
  }
  const row = await deps.getRow(inboxItemId, workspaceId);
  if (!row) return { status: 404, body: { error: 'contact_qualify_row_not_found' } };
  if (row.status !== 'new') {
    return { status: 200, body: { ok: true, already_qualified: true, status: row.status } };
  }
  const personId = row.entity_id;
  if (!personId) return { status: 400, body: { error: 'inbox row has no entity_id (no contact to qualify)' } };

  const meta = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
  const propEid = (typeof meta.property_entity_id === 'string' && /^[0-9a-fA-F-]{36}$/.test(meta.property_entity_id))
    ? meta.property_entity_id : null;
  const sfContactId = (typeof meta.sf_contact_id === 'string' && meta.sf_contact_id.trim()) ? meta.sf_contact_id.trim() : null;

  // 1. Resolve the owner of the captured property (the cadence-bearing entity).
  let ownerId = propEid ? await deps.resolveOwner(propEid) : null;

  // 2. Link person → owner (associated_with) — best-effort, dupe-guarded.
  let linked = false;
  if (ownerId && ownerId !== personId) {
    const link = await deps.linkPerson(ownerId, personId);
    linked = !!(link && link.ok);
  }

  // 3. Stamp a CONTACTLESS cadence — owner first (never clobbers an existing
  //    contact), else the person's OWN cadence (R20: a person is their contact).
  let cadenceStamped = null;
  if (ownerId) {
    const s = await deps.stampCadence(ownerId, { contactEntityId: personId, sfContactId, onlyContactless: true });
    if (s && s.ok && s.cadenceId) cadenceStamped = { target: 'owner', entity_id: ownerId, cadence_id: s.cadenceId };
  }
  if (!cadenceStamped) {
    const s = await deps.stampCadence(personId, { contactEntityId: personId, sfContactId, onlyContactless: true });
    if (s && s.ok && s.cadenceId) cadenceStamped = { target: 'self', entity_id: personId, cadence_id: s.cadenceId };
  }

  // 4. Disposition the inbox row terminal (the guaranteed effect). A failed PATCH
  //    keeps the row 'new' (the link/stamp above are idempotent on a retry).
  const nowIso = new Date().toISOString();
  const disp = await deps.dispositionInbox(inboxItemId, {
    status: 'promoted',
    triaged_at: nowIso,
    metadata: Object.assign({}, meta, {
      contact_qualify: {
        at: nowIso,
        linked_owner_entity_id: linked ? ownerId : null,
        cadence_stamped: cadenceStamped,
        source: 'r28_unit2',
      },
    }),
    updated_at: nowIso,
  });
  if (!disp || !disp.ok) {
    return { status: 502, body: { error: 'inbox_disposition_failed', detail: disp && disp.detail } };
  }

  // Staleness hook: a stamped cadence may now be reachable / leave P-CONTACT.
  if (cadenceStamped && deps.refreshQueue) { try { await deps.refreshQueue(); } catch (_e) { /* soft */ } }

  return {
    status: 200,
    body: {
      ok: true,
      inbox_item_id: inboxItemId,
      person_entity_id: personId,
      owner_entity_id: ownerId,
      linked,
      cadence_stamped: cadenceStamped,
      status: 'promoted',
    },
  };
}

async function bridgeQualifyContact(req, res, user, workspaceId) {
  const inboxItemId = String((req.body || {}).inbox_item_id || '').trim();
  const deps = {
    getRow: async (id, ws) => {
      const get = await opsQuery('GET', 'inbox_items?id=eq.' + pgFilterVal(id)
        + '&workspace_id=eq.' + pgFilterVal(ws)
        + '&source_type=eq.new_contact_qualify'
        + '&select=id,entity_id,status,metadata&limit=1');
      return (get.ok && Array.isArray(get.data)) ? (get.data[0] || null) : null;
    },
    resolveOwner: async (propEid) => {
      const own = await opsQuery('GET', 'entity_relationships?to_entity_id=eq.' + pgFilterVal(propEid)
        + '&relationship_type=eq.owns&select=from_entity_id&limit=1');
      return (own.ok && Array.isArray(own.data) && own.data[0]) ? (own.data[0].from_entity_id || null) : null;
    },
    linkPerson: (ownerId, personId) => linkPersonToEntity({ workspaceId, entityId: ownerId, contactEntityId: personId, role: 'prospecting_contact', via: 'contact_qualify' }),
    stampCadence: (entityId, args) => stampContactOnActiveCadence(Object.assign({ entityId }, args)),
    dispositionInbox: (id, patch) => opsQuery('PATCH', 'inbox_items?id=eq.' + pgFilterVal(id) + '&status=eq.new', patch),
    refreshQueue: () => opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}),
  };
  const out = await performContactQualify({ inboxItemId, workspaceId }, deps);
  return res.status(out.status).json(out.body);
}

// ============================================================================
// CHAT: Route /api/chat → invokeChatProvider (AI copilot)
// ============================================================================

async function fetchPortfolioStats() {
  const stats = { gov_stats: null, dia_stats: null };

  const govUrl = process.env.GOV_SUPABASE_URL;
  const govKey = govSupabaseKey();
  const diaUrl = process.env.DIA_SUPABASE_URL;
  const diaKey = diaSupabaseKey();

  const fetches = [];

  if (govUrl && govKey) {
    const govHeaders = { 'apikey': govKey, 'Authorization': `Bearer ${govKey}` };
    fetches.push(
      fetch(`${govUrl}/rest/v1/mv_gov_overview_stats?select=*&limit=1`, { headers: govHeaders })
        .then(r => r.ok ? r.json() : null)
        .then(rows => { if (Array.isArray(rows) && rows[0]) stats.gov_stats = rows[0]; })
        .catch(e => console.warn('[operations] Gov stats fetch failed:', e.message))
    );
    // Fetch government pipeline opportunities
    fetches.push(
      fetch(`${govUrl}/rest/v1/v_opportunity_domain_classified?domain=eq.government&status=eq.Open&order=activity_date.desc.nullslast&limit=10&select=deal_display_name,contact_name,company_name,activity_date,deal_priority`, { headers: govHeaders })
        .then(r => r.ok ? r.json() : [])
        .then(rows => { if (Array.isArray(rows)) stats.gov_opportunities = rows; })
        .catch(() => {})
    );
  }

  if (diaUrl && diaKey) {
    const diaHeaders = { 'apikey': diaKey, 'Authorization': `Bearer ${diaKey}` };
    fetches.push(
      fetch(`${diaUrl}/rest/v1/v_counts_freshness?select=*&limit=1`, { headers: diaHeaders })
        .then(r => r.ok ? r.json() : null)
        .then(rows => { if (Array.isArray(rows) && rows[0]) stats.dia_stats = rows[0]; })
        .catch(e => console.warn('[operations] Dialysis stats fetch failed:', e.message))
    );
    fetches.push(
      fetch(`${diaUrl}/rest/v1/clinic_financial_estimates?select=count&limit=1`, {
        headers: { ...diaHeaders, 'Prefer': 'count=exact' }
      })
        .then(r => {
          const range = r.headers.get('content-range');
          if (range) {
            const match = range.match(/\/(\d+)/);
            if (match) stats.dia_clinic_count = parseInt(match[1], 10);
          }
          return null;
        })
        .catch(e => console.warn('[operations] Dialysis clinic count fetch failed:', e.message))
    );
    // Fetch dialysis pipeline opportunities
    fetches.push(
      fetch(`${diaUrl}/rest/v1/v_opportunity_domain_classified?domain=eq.dialysis&status=eq.Open&order=activity_date.desc.nullslast&limit=10&select=deal_display_name,contact_name,company_name,activity_date,deal_priority`, { headers: diaHeaders })
        .then(r => r.ok ? r.json() : [])
        .then(rows => { if (Array.isArray(rows)) stats.dia_opportunities = rows; })
        .catch(() => {})
    );
    // Fetch top-growth clinics (patient count movers)
    fetches.push(
      fetch(`${diaUrl}/rest/v1/v_facility_patient_counts_mom?patient_delta=gt.5&order=patient_delta.desc&limit=5&select=facility_name,city,state,patient_count,patient_delta,pct_change`, { headers: diaHeaders })
        .then(r => r.ok ? r.json() : [])
        .then(rows => { if (Array.isArray(rows)) stats.dia_growth_clinics = rows; })
        .catch(() => {})
    );
  }

  await Promise.all(fetches);
  return stats;
}

// ---------------------------------------------------------------------------
// ACTION DISPATCHER — structured action invocation from Copilot
// ---------------------------------------------------------------------------

const ACTION_REGISTRY = {
  // Tier 0: read-only
  get_daily_briefing_snapshot: { tier: 0, handler: 'daily_briefing' },
  list_staged_intake_inbox:    { method: 'GET', path: 'inbox', tier: 0 },
  get_my_execution_queue:      { method: 'GET', path: 'queue-v2?view=my_work', tier: 0, alias: 'queue?_version=v2&view=my_work' },
  get_sync_run_health:         { method: 'GET', path: 'sync?action=health', tier: 0 },
  get_hot_business_contacts:   { method: 'GET', path: 'contacts?action=hot_leads', tier: 0, alias: 'entity-hub?_domain=contacts&action=hot_leads' },
  search_entity_targets:       { method: 'GET', path: 'entities?action=search', tier: 0, alias: 'entity-hub?_domain=entities&action=search' },
  fetch_listing_activity_context: { method: 'GET', path: 'queue-v2?view=entity_timeline', tier: 0, alias: 'queue?_version=v2&view=entity_timeline' },
  list_government_review_observations: { method: 'GET', path: 'gov-evidence?endpoint=research-observations', tier: 0, alias: 'data-proxy?_route=gov-evidence&endpoint=research-observations' },
  list_dialysis_review_queue:  { method: 'GET', path: 'dia-query?table=v_clinic_property_link_review_queue&select=*', tier: 0, alias: 'data-proxy?_source=dia&table=v_clinic_property_link_review_queue&select=*' },
  get_work_counts:             { method: 'GET', path: 'queue-v2?view=work_counts', tier: 0, alias: 'queue?_version=v2&view=work_counts' },
  search_deals:                { tier: 0, handler: 'search_deals' },

  // Tier 0-1: AI-powered actions (fetch context + generate content)
  generate_prospecting_brief:  { tier: 0, handler: 'prospecting_brief' },
  draft_outreach_email:        { tier: 1, handler: 'draft_outreach', confirm: 'explicit' },
  draft_seller_update_email:   { tier: 1, handler: 'draft_seller_update', confirm: 'explicit' },
  draft_reply_from_inbox:      { tier: 1, handler: 'draft_reply_from_inbox', confirm: 'explicit' },

  // Tier 2: Microsoft To Do task creation (Wave 2)
  create_todo_task:            { tier: 2, handler: 'create_todo_task', confirm: 'explicit' },

  // Tier 0: Template engine (Wave 2)
  list_email_templates:          { method: 'GET', path: 'draft', tier: 0, alias: 'operations?_route=draft' },
  get_email_template:            { method: 'GET', path: 'draft&template_id=', tier: 0, alias: 'operations?_route=draft&template_id=' },
  generate_template_draft:       { method: 'POST', path: 'draft&action=generate', tier: 1, confirm: 'lightweight', alias: 'operations?_route=draft&action=generate' },
  generate_batch_drafts:         { method: 'POST', path: 'draft&action=batch', tier: 1, confirm: 'explicit', alias: 'operations?_route=draft&action=batch' },
  record_template_send:          { method: 'POST', path: 'draft&action=record_send', tier: 2, confirm: 'explicit', alias: 'operations?_route=draft&action=record_send' },
  get_template_performance:      { method: 'POST', path: 'draft&action=performance', tier: 0, alias: 'operations?_route=draft&action=performance' },
  evaluate_template_health:      { method: 'POST', path: 'draft&action=health', tier: 0, alias: 'operations?_route=draft&action=health' },
  run_listing_bd_pipeline:       { method: 'POST', path: 'draft&action=listing_bd', tier: 1, confirm: 'explicit', alias: 'operations?_route=draft&action=listing_bd' },

  // Tier 0: AI-powered listing pursuit (Wave 2)
  generate_listing_pursuit_dossier: { tier: 0, handler: 'listing_pursuit_dossier' },

  // Tier 0: Teams card generation (Wave 2)
  generate_teams_card:         { tier: 0, handler: 'teams_card' },

  // Tier 0-1: Wave 2-3 intelligence and document actions
  get_relationship_context:    { tier: 0, handler: 'relationship_context' },
  get_pipeline_intelligence:   { tier: 0, handler: 'pipeline_intelligence' },
  guided_entity_merge:         { tier: 0, handler: 'guided_entity_merge' },
  generate_document:           { tier: 1, handler: 'document_assembly', confirm: 'explicit' },

  // Tier 1-2: mutations (require confirmation)
  ingest_outlook_flagged_emails: { method: 'POST', path: 'sync?action=ingest_emails', tier: 1, confirm: 'lightweight' },
  ingest_pdf_document:         { tier: 1, handler: 'ingest_pdf', confirm: 'lightweight' },
  triage_inbox_item:           { method: 'PATCH', path: 'inbox', tier: 2, confirm: 'lightweight' },
  promote_intake_to_action:    { method: 'POST', path: 'workflows?action=promote_to_shared', tier: 2, confirm: 'explicit', alias: 'operations?action=promote_to_shared' },
  create_listing_pursuit_followup_task: { method: 'POST', path: 'actions', tier: 2, confirm: 'explicit' },
  update_execution_task_status: { method: 'PATCH', path: 'actions', tier: 2, confirm: 'explicit' },
  retry_sync_error_record:     { method: 'POST', path: 'sync?action=retry', tier: 2, confirm: 'explicit' },

  // Tier 2-3: Wave 2 workflow actions (existing endpoints, now dispatchable)
  research_followup:           { method: 'POST', path: 'operations?action=research_followup', tier: 2, confirm: 'explicit' },
  reassign_work_item:          { method: 'POST', path: 'operations?action=reassign', tier: 2, confirm: 'explicit' },
  escalate_action:             { method: 'POST', path: 'operations?action=escalate', tier: 3, confirm: 'explicit' },
};

/**
 * Build a short human-readable summary of a dispatched action for the
 * activity_events timeline. Kept intentionally compact — action-specific
 * handlers can override the summary in their own memory writes.
 */
function deriveActionSummary(actionName, params, result) {
  const safeParams = params || {};
  switch (actionName) {
    case 'draft_outreach_email':
      return `Drafted outreach email${safeParams.contact_name ? ` for ${safeParams.contact_name}` : ''}`;
    case 'draft_seller_update_email':
      return `Drafted seller update${safeParams.property_name ? ` for ${safeParams.property_name}` : ''}`;
    case 'draft_reply_from_inbox':
      return `Drafted reply${safeParams.inbox_item_id ? ` to inbox item ${String(safeParams.inbox_item_id).slice(0, 8)}` : ''}`;
    case 'create_todo_task':
      return `Created To Do task${safeParams.title ? `: "${safeParams.title}"` : ''}`;
    case 'generate_document':
      return `Generated ${safeParams.document_type || 'document'}${safeParams.entity_id ? ` for entity ${safeParams.entity_id.slice(0, 8)}` : ''}`;
    case 'ingest_pdf_document':
      return `Ingested PDF: ${safeParams.file_name || 'unnamed'}`;
    case 'triage_inbox_item':
      return `Triaged inbox item → ${safeParams.status || 'updated'}`;
    case 'promote_intake_to_action':
      return `Promoted inbox item to shared action`;
    case 'update_execution_task_status':
      return `Updated task status → ${safeParams.status || 'changed'}`;
    default:
      return `Copilot action: ${actionName}`;
  }
}

async function dispatchAction(actionName, params, user, workspaceId, req) {
  const spec = ACTION_REGISTRY[actionName];
  if (!spec) {
    return { ok: false, error: `Unknown action: ${actionName}`, available_actions: Object.keys(ACTION_REGISTRY) };
  }

  // Validate inputs against schema (if defined)
  const validation = validateActionInput(actionName, params || {}, ACTION_SCHEMAS);
  if (!validation.valid) {
    return {
      ok: false,
      error: 'Invalid action inputs',
      validation_errors: validation.errors,
      action: actionName,
      expected_schema: ACTION_SCHEMAS[actionName]?.inputs || null
    };
  }

  // Enforce confirmation for write/draft actions
  // Implicit confirmation: when a draft_* action is invoked with
  // create_draft=true and a non-empty 'to' recipient, that IS the explicit
  // confirmation — the user (via the Copilot agent) has already said "create a
  // draft in my Outlook," so we don't make them resend with _confirmed:true.
  // Without this, the Tier-1 gate fires and handleDraftOutreachEmail never
  // runs — so _maybeCreateOutlookDraft never POSTs to PA_OUTLOOK_DRAFT_URL and
  // no real Outlook draft is created.
  const implicitlyConfirmed = (
    /^draft_/.test(actionName)
    && params?.create_draft === true
    && (
      (typeof params?.to === 'string' && params.to.length > 0)
      || (actionName === 'draft_reply_from_inbox'
          && typeof params?.inbox_item_id === 'string'
          && params.inbox_item_id.length > 0)
    )
  );
  if (spec.tier >= 1 && spec.confirm && !params?._confirmed && !implicitlyConfirmed) {
    return {
      ok: false,
      requires_confirmation: true,
      action: actionName,
      confirmation_level: spec.confirm || 'explicit',
      message: `Action "${actionName}" requires ${spec.confirm || 'explicit'} confirmation. Resend with _confirmed: true to execute.`,
      tier: spec.tier
    };
  }

  // Dispatch the handler, then log a memory interaction if the action
  // succeeded and touched an entity. Failures do NOT log (keeps the
  // timeline clean — only successful state changes are remembered).
  let result;

  // AI-powered actions have dedicated handlers
  if (spec.handler) {
    switch (spec.handler) {
      case 'daily_briefing':          result = await handleDailyBriefing(params, user, workspaceId, req); break;
      case 'search_deals':            result = await handleSearchDeals(params); break;
      case 'prospecting_brief':       result = await handleProspectingBrief(params, user, workspaceId); break;
      case 'draft_outreach':          result = await handleDraftOutreachEmail(params, user, workspaceId); break;
      case 'draft_seller_update':     result = await handleDraftSellerUpdate(params, user, workspaceId); break;
      case 'draft_reply_from_inbox': result = await handleDraftReplyFromInbox(params, user, workspaceId); break;
      case 'create_todo_task':        result = await createTodoTask(params, user, workspaceId); break;
      case 'listing_pursuit_dossier': result = await handleListingPursuitDossier(params, user, workspaceId); break;
      case 'teams_card':              result = await generateTeamsCard(params); break;
      case 'relationship_context':    result = await handleRelationshipContext(params, user, workspaceId); break;
      case 'pipeline_intelligence':   result = await handlePipelineIntelligence(params, user, workspaceId); break;
      case 'guided_entity_merge':     result = await handleGuidedEntityMerge(params, user, workspaceId); break;
      case 'document_assembly':       result = await handleDocumentAssembly(params, user, workspaceId); break;
      case 'ingest_pdf':              result = await ingestPdfWorker(params, user, workspaceId); break;
      default: return { ok: false, error: `Unknown handler: ${spec.handler}` };
    }

    // Fire-and-forget memory write for successful TIER ≥ 1 actions that
    // touched an entity. Does not block the response. Always wrapped in
    // try/catch inside the helper so a log failure never affects the action.
    if (result?.ok && spec.tier >= 1) {
      try {
        const { logCopilotInteraction } = await import('./_shared/memory.js');
        const entityId =
          params?.entity_id
          ?? result?.data?.entity_id
          ?? result?.entity_id
          ?? result?.data?.matched_entity_id
          ?? null;
        await logCopilotInteraction({
          workspaceId,
          actorId:     user.id,
          entityId,
          channel:     params?._channel || 'copilot_chat',
          actionId:    actionName,
          summary:     deriveActionSummary(actionName, params, result),
          metadata: {
            dispatch_tier: spec.tier,
            handler:       spec.handler,
            params_keys:   Object.keys(params || {}).filter((k) => !k.startsWith('_')),
          },
        });
      } catch (err) {
        console.error('[dispatchAction] memory log failed:', actionName, err?.message);
      }
    }

    return result;
  }

  // Build internal fetch URL using internal API calls for GET reads
  if (spec.method === 'GET') {
    return await executeReadAction(spec, params, user, workspaceId, req);
  }

  // Write actions return metadata about what to call — the frontend or
  // Copilot should invoke the real endpoint directly with proper auth.
  // This avoids double-proxying and keeps audit trails clean.
  return {
    ok: true,
    action: actionName,
    method: spec.method,
    endpoint: `/api/${spec.path}`,
    params_to_send: params || {},
    note: 'Execute this endpoint directly with your auth credentials to complete the action.'
  };
}

async function executeReadAction(spec, params, user, workspaceId, req) {
  // Build the internal API URL — these are LCC API routes, not PostgREST tables
  let path = spec.path;
  if (params) {
    const queryParts = [];
    for (const [key, val] of Object.entries(params)) {
      if (key.startsWith('_')) continue; // skip internal flags
      queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }
    if (queryParts.length) {
      path += (path.includes('?') ? '&' : '?') + queryParts.join('&');
    }
  }

  // Determine the base URL for internal API calls
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  const host = req?.headers?.host || 'localhost:3000';
  const baseUrl = `${proto}://${host}`;

  // Build headers to forward auth context
  const headers = { 'Content-Type': 'application/json' };
  // Copilot plugin requests: always use the server's own API key for internal
  // sub-calls. The connector may send a key via the connection, but the copilot
  // passthrough in auth.js skips key validation — so the forwarded key may not
  // match LCC_API_KEY. Using the server key guarantees internal calls pass auth.
  if (user?._copilot_plugin && process.env.LCC_API_KEY) {
    headers['x-lcc-key'] = process.env.LCC_API_KEY;
  } else {
    if (req?.headers?.['authorization']) headers['authorization'] = req.headers['authorization'];
    if (req?.headers?.['x-lcc-key']) headers['x-lcc-key'] = req.headers['x-lcc-key'];
  }
  if (workspaceId) headers['x-lcc-workspace'] = workspaceId;

  try {
    const res = await fetch(`${baseUrl}/api/${path}`, { method: 'GET', headers });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      action: spec.path.split('?')[0],
      data: res.ok ? data : undefined,
      error: res.ok ? undefined : (data.error || `API returned ${res.status}`),
      count: data.count || undefined
    };
  } catch (e) {
    return { ok: false, action: spec.path.split('?')[0], error: `Internal API call failed: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// MICROSOFT TO DO — create tasks via Graph API (Wave 2)
// ---------------------------------------------------------------------------

const GRAPH_API_URL = 'https://graph.microsoft.com/v1.0';

// Convert plain-text draft body into HTML suitable for Graph message/body (contentType=HTML).
// Preserves paragraph breaks and escapes HTML. Outlook will append the user's default
// signature automatically when the draft is opened in New Outlook or Outlook Web.
function _htmlizeDraftBody(text) {
  if (!text) return '';
  const esc = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Convert double-newlines to paragraph breaks, single newlines to <br>
  const paragraphs = esc.split(/\n\n+/).map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>');
  return paragraphs.join('');
}

async function createTodoTask(params, user, workspaceId) {
  const graphToken = process.env.MS_GRAPH_TOKEN;
  if (!graphToken) {
    return { ok: false, error: 'MS_GRAPH_TOKEN not configured. Required for Microsoft To Do integration.' };
  }

  const { title, body, due_date, importance, list_name, lcc_action_id } = params || {};
  if (!title) return { ok: false, error: 'title is required' };

  // Resolve list ID — default to "Work" list, or find by name
  let listId = null;
  const targetList = list_name || 'Work';

  try {
    const listsRes = await fetch(`${GRAPH_API_URL}/me/todo/lists`, {
      headers: { 'Authorization': `Bearer ${graphToken}` }
    });
    if (!listsRes.ok) {
      return { ok: false, error: `Graph API error fetching lists: ${listsRes.status}` };
    }
    const listsData = await listsRes.json();
    const lists = listsData.value || [];
    const match = lists.find(l => l.displayName.toLowerCase() === targetList.toLowerCase());
    listId = match?.id || lists[0]?.id;
    if (!listId) {
      return { ok: false, error: 'No To Do lists found. Create a list in Microsoft To Do first.' };
    }
  } catch (e) {
    return { ok: false, error: `Failed to fetch To Do lists: ${e.message}` };
  }

  // Build the task payload
  const taskBody = {
    title,
    importance: importance === 'urgent' ? 'high' : importance === 'low' ? 'low' : 'normal',
  };

  if (body || lcc_action_id) {
    const bodyParts = [];
    if (body) bodyParts.push(body);
    if (lcc_action_id) bodyParts.push(`[LCC Action: ${lcc_action_id}]`);
    taskBody.body = { content: bodyParts.join('\n\n'), contentType: 'text' };
  }

  if (due_date) {
    taskBody.dueDateTime = {
      dateTime: new Date(due_date).toISOString(),
      timeZone: 'America/Chicago'
    };
  }

  try {
    const createRes = await fetch(`${GRAPH_API_URL}/me/todo/lists/${listId}/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${graphToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(taskBody)
    });

    if (!createRes.ok) {
      const errBody = await createRes.text().catch(() => '');
      return { ok: false, error: `Failed to create To Do task: ${createRes.status}`, detail: errBody };
    }

    const task = await createRes.json();

    // Log activity if we have a linked LCC action
    if (lcc_action_id && workspaceId) {
      await opsQuery('POST', 'activity_events', {
        workspace_id: workspaceId,
        user_id: user?.id,
        event_type: 'todo_task_created',
        source: 'copilot',
        title: `To Do task created: ${title}`,
        metadata: { todo_task_id: task.id, list_name: targetList, lcc_action_id }
      });
    }

    return {
      ok: true,
      action: 'create_todo_task',
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        importance: task.importance,
        list: targetList,
        due: task.dueDateTime?.dateTime || null,
        web_url: task.webUrl || null
      },
      note: 'Task created in Microsoft To Do.'
    };
  } catch (e) {
    return { ok: false, error: `Failed to create To Do task: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// AI-POWERED ACTIONS — fetch context, compose prompt, call AI provider
// ---------------------------------------------------------------------------

const GOV_URL = process.env.GOV_SUPABASE_URL;
const GOV_KEY = govSupabaseKey();

async function govContactQuery(path) {
  if (!GOV_URL || !GOV_KEY) return { ok: false, data: [] };
  const res = await fetch(`${GOV_URL}/rest/v1/${path}`, {
    headers: { 'apikey': GOV_KEY, 'Authorization': `Bearer ${GOV_KEY}`, 'Prefer': 'count=exact' }
  });
  const data = await res.json().catch(() => []);
  return { ok: res.ok, data: Array.isArray(data) ? data : [] };
}

// PostgREST GET that captures the exact total count from the Content-Range
// header (Prefer: count=exact) while returning only a small sample of rows.
async function govCountQuery(path) {
  if (!GOV_URL || !GOV_KEY) return { ok: false, count: 0, data: [], status: 0 };
  const res = await fetch(`${GOV_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': GOV_KEY,
      'Authorization': `Bearer ${GOV_KEY}`,
      'Prefer': 'count=exact',
      'Range-Unit': 'items',
      'Range': '0-24',
    },
  });
  const data = await res.json().catch(() => []);
  const cr = res.headers.get('content-range') || '';            // e.g. "0-9/142"
  const total = cr.includes('/') ? parseInt(cr.split('/')[1], 10) : (Array.isArray(data) ? data.length : 0);
  return { ok: res.ok, count: Number.isFinite(total) ? total : 0, data: Array.isArray(data) ? data : [], status: res.status };
}

// US state name → 2-letter abbreviation, so callers can pass "Texas" or "TX".
const US_STATE_ABBR = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

function normalizeState(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (s.length === 2) return s.toUpperCase();
  return US_STATE_ABBR[s.toLowerCase()] || s.toUpperCase();
}

// Tier 0 — search LIVE government deals by state: currently-available listings
// (from v_available_listings, already filtered to active/metric-eligible) and
// sales closed within the past N months (sales_transactions). Returns exact
// counts + a small sample. This grounds quantitative/geographic deal questions
// in the live gov DB instead of static knowledge files.
async function handleSearchDeals(params) {
  const p = params || {};
  const state = normalizeState(p.state);
  if (!state) return { ok: false, error: 'state is required (e.g. "TX" or "Texas").' };

  const status = String(p.status || 'both').toLowerCase();          // available | sold | both
  const months = (Number.isFinite(+p.months) && +p.months > 0) ? Math.min(+p.months, 120) : 12;
  const agency = p.agency ? String(p.agency).trim() : '';
  const sampleLimit = (Number.isFinite(+p.limit) && +p.limit > 0) ? Math.min(+p.limit, 25) : 10;

  const out = { ok: true, action: 'search_deals', state, source: 'live gov database (v_available_listings + sales_transactions)' };

  if (status === 'available' || status === 'both') {
    // Default select (all columns) — avoids PostgREST 400s from view-specific
    // column naming on v_available_listings (an explicit select with a column
    // the view doesn't expose breaks the whole request, incl. the count).
    // Agency filter is applied only when the column is known to exist.
    let path = `v_available_listings?state=eq.${encodeURIComponent(state)}`;
    if (agency) path += `&or=(tenant_agency.ilike.*${encodeURIComponent(agency)}*,agency.ilike.*${encodeURIComponent(agency)}*)`;
    const r = await govCountQuery(path);
    out.available_count = r.ok ? r.count : null;
    out.available_sample = (r.data || []).slice(0, sampleLimit);
    if (!r.ok) out.available_note = `Available-listings query failed (status ${r.status}); count unavailable. Verify v_available_listings columns.`;
  }

  if (status === 'sold' || status === 'both') {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    let path = `sales_transactions?state=eq.${encodeURIComponent(state)}` +
      `&sale_date=gte.${cutoffIso}` +
      `&select=address,city,state,agency,sold_price,sold_cap_rate,sale_date` +
      `&order=sale_date.desc`;
    if (agency) path += `&agency=ilike.*${encodeURIComponent(agency)}*`;
    const r = await govCountQuery(path);
    out.sold_window_months = months;
    out.sold_since = cutoffIso;
    out.sold_count = r.ok ? r.count : null;
    out.sold_sample = (r.data || []).slice(0, sampleLimit);
    if (!r.ok) out.sold_note = `Sales query failed (status ${r.status}); count unavailable.`;
  }

  return out;
}

async function handleDailyBriefing(params, user, workspaceId, req) {
  // Fetch the structured snapshot from the daily-briefing endpoint
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  const host = req?.headers?.host || 'localhost:3000';
  const roleView = params?.role_view || 'broker';
  const headers = { 'Content-Type': 'application/json' };
  if (req?.headers?.['authorization']) headers['authorization'] = req.headers['authorization'];
  if (req?.headers?.['x-lcc-key']) headers['x-lcc-key'] = req.headers['x-lcc-key'];
  if (workspaceId) headers['x-lcc-workspace'] = workspaceId;

  let snapshot = null;
  try {
    const res = await fetch(`${proto}://${host}/api/daily-briefing?action=snapshot&role_view=${roleView}`, { headers });
    if (res.ok) snapshot = await res.json();
  } catch { /* non-fatal */ }

  if (!snapshot) {
    return { ok: false, error: 'Could not fetch daily briefing snapshot' };
  }

  // Build a data-rich prompt from the actual snapshot
  const priorities = snapshot.user_specific_priorities;
  const counts = snapshot.team_level_production_signals?.work_counts || {};
  const inbox = snapshot.team_level_production_signals?.inbox_summary || {};
  const syncHealth = snapshot.team_level_production_signals?.sync_health || {};
  const domainSignals = snapshot.domain_specific_alerts_highlights || {};

  let dataContext = `TODAY'S DATA (${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}):\n`;

  // Strategic priorities from the scoring engine
  if (priorities?.today_priorities?.length) {
    dataContext += '\nTOP PRIORITIES (ranked by strategic value):\n';
    priorities.today_priorities.forEach((p, i) => {
      dataContext += `${i + 1}. [${(p.tier || 'urgent').toUpperCase()}] ${p.title} (score: ${p.score}, source: ${p.source || p.type})\n`;
    });
    dataContext += `Strategic items: ${priorities.strategic_count || 0} | Important: ${priorities.important_count || 0} | Urgent: ${priorities.urgent_count || 0}\n`;
  }

  // Inbox items with actual subjects
  if (inbox.items?.length) {
    dataContext += `\nINBOX (${inbox.total_new || 0} new, ${inbox.total_triaged || 0} triaged):\n`;
    inbox.items.slice(0, 5).forEach(item => {
      const sender = item.metadata?.sender_email || item.metadata?.sf_who || 'unknown';
      dataContext += `- "${item.title}" from ${sender} (${item.source_type})\n`;
    });
  }

  // Pipeline deals
  if (priorities?.pipeline_deals?.length) {
    dataContext += '\nACTIVE PIPELINE DEALS:\n';
    priorities.pipeline_deals.forEach(d => {
      dataContext += `- ${d.title} | Contact: ${d.contact || 'unknown'} | Status: ${d.status || 'open'}\n`;
    });
  }

  // Recommended calls (stale touchpoints)
  if (priorities?.recommended_calls?.length) {
    dataContext += '\nCONTACTS OVERDUE FOR TOUCHPOINT:\n';
    priorities.recommended_calls.forEach(c => {
      dataContext += `- ${c.name} (${c.company || 'unknown'}) — score: ${c.score}, ${c.days_since_touch} days since last touch\n`;
    });
  }

  // SF activity summary
  if (priorities?.sf_activity_summary) {
    const sf = priorities.sf_activity_summary;
    dataContext += `\nSALESFORCE ACTIVITY (7 days): ${sf.total_7d} total (${sf.calls} calls, ${sf.emails} emails, ${sf.tasks} tasks)\n`;
  }

  // Work counts
  dataContext += `\nWORK QUEUE: ${counts.open_actions || 0} open | ${counts.overdue || 0} overdue | ${counts.due_this_week || 0} due this week | ${counts.inbox_new || 0} inbox | ${counts.sync_errors || 0} sync errors\n`;

  // Domain highlights
  if (domainSignals.government?.highlights?.length) {
    dataContext += '\nGOVERNMENT DOMAIN: ' + domainSignals.government.highlights.join('; ') + '\n';
  }
  if (domainSignals.dialysis?.highlights?.length) {
    dataContext += 'DIALYSIS DOMAIN: ' + domainSignals.dialysis.highlights.join('; ') + '\n';
  }

  // Sync health
  if (syncHealth.summary) {
    const s = syncHealth.summary;
    dataContext += `\nSYSTEM HEALTH: ${s.total_connectors} connectors (${s.healthy} healthy, ${s.error} error) | ${syncHealth.unresolved_errors?.length || 0} unresolved sync errors\n`;
  }

  const prompt = `You are briefing Scott Briggs, a net lease investment sales broker at NorthMarq specializing in government-leased and dialysis/kidney care assets. Using ONLY the data below, deliver a concise morning briefing.\n\n${dataContext}\n\nStructure your briefing as:\n\n**STRATEGIC (do first — revenue and deal actions):**\nList the strategic-tier items. For each, explain WHY it's strategic and WHAT to do.\n\n**IMPORTANT (do second — pipeline and relationships):**\nList important-tier items. Reference specific contacts by name.\n\n**URGENT (do third — operational items):**\nBriefly note any operational items that need attention.\n\n**CALL LIST:**\nIf there are contacts overdue for touchpoints, list them with suggested talking points.\n\nRules:\n- Reference ONLY the data provided. Do not invent market commentary, cap rates, or generic advice.\n- Use specific names, deal names, and numbers from the data.\n- If the data is sparse, say what data sources need to be connected — don't fill with generic CRE advice.\n- Keep it under 400 words.`;

  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'get_daily_briefing_snapshot' },
    history: [], attachments: [], user, workspaceId
  });

  return {
    ok: true,
    action: 'get_daily_briefing_snapshot',
    response: result.data?.response || '',
    snapshot: {
      as_of: snapshot.as_of,
      role_view: snapshot.role_view,
      status: snapshot.status,
      strategic_count: priorities?.strategic_count || 0,
      important_count: priorities?.important_count || 0,
      urgent_count: priorities?.urgent_count || 0,
      work_counts: counts,
      inbox_total: (inbox.total_new || 0) + (inbox.total_triaged || 0)
    },
    provider: result.provider
  };
}

async function handleProspectingBrief(params, user, workspaceId) {
  const limit = Math.min(parseInt(params?.limit) || 10, 25);

  // Fetch hot leads
  const hotResult = await govContactQuery(
    `unified_contacts?contact_class=eq.business&engagement_score=gt.0&order=engagement_score.desc&limit=${limit}&select=unified_id,full_name,email,phone,company_name,title,engagement_score,last_call_date,last_email_date,last_meeting_date,total_calls,total_emails_sent`
  );

  const contacts = (hotResult.data || []).map(c => ({
    name: c.full_name,
    company: c.company_name || '',
    title: c.title || '',
    email: c.email || '',
    phone: c.phone || '',
    score: c.engagement_score,
    heat: c.engagement_score >= 60 ? 'hot' : c.engagement_score >= 30 ? 'warm' : 'cool',
    last_call: c.last_call_date || 'never',
    last_email: c.last_email_date || 'never',
    last_meeting: c.last_meeting_date || 'never',
    total_calls: c.total_calls || 0,
    total_emails: c.total_emails_sent || 0
  }));

  if (!contacts.length) {
    return { ok: true, action: 'generate_prospecting_brief', response: 'No business contacts with engagement scores found. Start by ingesting contacts from Outlook or Salesforce.', contacts: [] };
  }

  const contactList = contacts.map((c, i) =>
    `${i + 1}. ${c.name} (${c.company}) — ${c.heat} (score: ${c.score})\n   Title: ${c.title}\n   Last call: ${c.last_call} | Last email: ${c.last_email}\n   Calls: ${c.total_calls} | Emails: ${c.total_emails}\n   Phone: ${c.phone} | Email: ${c.email}`
  ).join('\n\n');

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const prompt = `Generate a concise daily prospecting call sheet for ${today}.\n\nHere are the top contacts ranked by engagement:\n\n${contactList}\n\nFor each contact, provide:\n1. A one-line call prep note (why to call based on engagement pattern)\n2. A suggested talking point or reason to reach out\n3. Priority level (call today / this week / nurture)\n\nFocus on contacts who haven't been called recently but have high engagement. Flag any that are overdue for a touchpoint.`;

  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'generate_prospecting_brief' },
    history: [],
    attachments: [],
    user,
    workspaceId
  });

  return {
    ok: true,
    action: 'generate_prospecting_brief',
    response: result.data?.response || '',
    contacts,
    provider: result.provider
  };
}

// ---------------------------------------------------------------------------
// Outlook draft helpers (Phase 2) — turn an AI draft into a real Outlook draft
// via the org-sanctioned "LCC Create Outlook Draft" Power Automate flow.
// Only engaged when params.create_draft is true AND a recipient is resolvable.
// Degrades silently to the text-only path otherwise (e.g. flow URL not set).
// ---------------------------------------------------------------------------

// Split an AI-generated email ("Subject: ...\n\n body...") into {subject, body}.
function _parseDraftSubjectBody(text) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/);
  let subject = '';
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = line.match(/^\**\s*subject\s*\**\s*:\s*(.+)$/i);
    if (m) {
      subject = m[1].replace(/\**/g, '').trim();
      bodyStart = i + 1;
    } else {
      // No explicit "Subject:" — use the first non-empty line as subject.
      subject = line.replace(/^\**|\**$/g, '').trim();
      bodyStart = i + 1;
    }
    break;
  }
  const body = lines.slice(bodyStart).join('\n').replace(/^\s+/, '');
  return { subject, body };
}

// Convert plain-text body to minimal HTML (paragraphs + line breaks).
function _draftBodyToHtml(text) {
  const esc = String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = esc.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`);
  return paras.join('\n');
}

// Best-effort: create a real Outlook draft from an AI draft response.
// Returns a partial result object to merge into the action response, or null.
async function _maybeCreateOutlookDraft({ params, responseText, fallbackTo }) {
  if (!params?.create_draft) return null;
  const to = params.to || fallbackTo;
  if (!to) {
    return { draft_created: false, draft_note: 'No recipient email available — returned text only. Pass "to" to create an Outlook draft.' };
  }
  const { subject, body } = _parseDraftSubjectBody(responseText);
  const res = await createOutlookDraftViaPA({
    to,
    cc: params.cc,
    subject: subject || (params.subject || 'Draft'),
    body_html: _draftBodyToHtml(body || responseText),
  });
  if (res.ok) {
    return { draft_created: true, draft_web_link: res.web_link || null, draft_id: res.draft_id || null, draft_recipient: to };
  }
  return { draft_created: false, draft_note: `Outlook draft not created (${res.error || 'unknown'}); returned text only.` };
}

async function handleDraftOutreachEmail(params, user, workspaceId) {
  const { contact_id, contact_name, intent, tone } = params || {};

  // Fetch contact context if ID provided
  let contactContext = '';
  let recipientEmail = null;
  if (contact_id) {
    const result = await govContactQuery(
      `unified_contacts?unified_id=eq.${encodeURIComponent(contact_id)}&limit=1&select=full_name,email,phone,company_name,title,engagement_score,last_call_date,last_email_date,last_meeting_date,total_calls,total_emails_sent,city,state`
    );
    const c = result.data?.[0];
    if (c) {
      recipientEmail = c.email || null;
      contactContext = `\nRecipient Profile:\n- Name: ${c.full_name}\n- Company: ${c.company_name || 'unknown'}\n- Title: ${c.title || 'unknown'}\n- Location: ${[c.city, c.state].filter(Boolean).join(', ') || 'unknown'}\n- Engagement: score ${c.engagement_score || 0}, ${c.total_calls || 0} calls, ${c.total_emails_sent || 0} emails sent\n- Last call: ${c.last_call_date || 'never'} | Last email: ${c.last_email_date || 'never'} | Last meeting: ${c.last_meeting_date || 'never'}`;
    }
  } else if (contact_name) {
    contactContext = `\nRecipient: ${contact_name}`;
  }

  const toneGuide = tone || 'professional, warm, and concise';
  const intentGuide = intent || 'reconnect and explore potential listing opportunities';

  const prompt = `Draft a personalized outreach email for a commercial real estate broker.\n${contactContext}\n\nIntent: ${intentGuide}\nTone: ${toneGuide}\n\nRequirements:\n- Subject line + email body\n- Reference any relevant engagement history to make it personal\n- Keep it under 150 words\n- Include a clear but soft call-to-action\n- Do NOT use generic filler — make it specific to the recipient\n- This is a DRAFT for the broker to review before sending`;

  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'draft_outreach_email' },
    history: Array.isArray(params?.history) ? params.history : [],
    attachments: [],
    user,
    workspaceId
  });

  const responseText = result.data?.response || '';
  const draftInfo = await _maybeCreateOutlookDraft({ params, responseText, fallbackTo: recipientEmail });

  return {
    ok: true,
    action: 'draft_outreach_email',
    response: responseText,
    requires_review: true,
    note: draftInfo?.draft_created
      ? 'Draft created in your Outlook — open it to review and send.'
      : 'This is a draft. Review and edit before sending from Outlook.',
    provider: result.provider,
    ...(draftInfo || {})
  };
}

async function handleDraftSellerUpdate(params, user, workspaceId) {
  const { entity_id, entity_name, listing_context } = params || {};

  // Fetch activity timeline if entity_id provided
  let activityContext = '';
  if (entity_id) {
    const timelineResult = await opsQuery('GET',
      `v_entity_timeline?entity_id=eq.${encodeURIComponent(entity_id)}&limit=20&order=created_at.desc`
    );
    const events = timelineResult.data || [];
    if (events.length) {
      activityContext = '\nRecent Activity Timeline:\n' + events.map(e =>
        `- ${e.created_at?.split('T')[0] || 'unknown'}: ${e.event_type || e.action_type || 'activity'} — ${e.title || e.subject || e.description || '(no description)'}`
      ).join('\n');
    }

    // Also try to get entity details from ops
    const entityResult = await opsQuery('GET',
      `entities?id=eq.${encodeURIComponent(entity_id)}&limit=1`
    );
    const entity = entityResult.data?.[0];
    if (entity) {
      activityContext = `\nProperty/Entity: ${entity.name || entity_name || 'Unknown'}\nType: ${entity.entity_type || 'unknown'}\nDomain: ${entity.domain || 'unknown'}` + activityContext;
    }
  }

  const extraContext = listing_context ? `\nAdditional Context: ${listing_context}` : '';

  const prompt = `Draft a weekly seller update email for a commercial real estate listing.\n${activityContext}${extraContext}\n\nRequirements:\n- Professional but approachable tone\n- Summarize this week's marketing activity and buyer engagement\n- Highlight key metrics (inquiries, showings, OM downloads if available)\n- Note any buyer follow-up actions taken\n- Brief market conditions commentary if relevant\n- End with next steps and timeline\n- Keep it under 250 words\n- This is a DRAFT for the broker to review before sending to the seller`;

  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'draft_seller_update_email' },
    history: Array.isArray(params?.history) ? params.history : [],
    attachments: [],
    user,
    workspaceId
  });

  const responseText = result.data?.response || '';
  const draftInfo = await _maybeCreateOutlookDraft({ params, responseText, fallbackTo: null });

  return {
    ok: true,
    action: 'draft_seller_update_email',
    response: responseText,
    requires_review: true,
    note: draftInfo?.draft_created
      ? 'Draft created in your Outlook — open it to review and send to the seller.'
      : 'This is a draft. Review and personalize before sending to the seller.',
    provider: result.provider,
    ...(draftInfo || {})
  };
}

// ---------------------------------------------------------------------------
// Phase 3 reply loop — context-aware reply to a flagged inbox email.
// Reads the original message from inbox_items (the flagged-email intake row),
// derives the recipient from the original sender, and drafts a reply via
// invokeChatProvider. If create_draft=true, posts to PA_OUTLOOK_DRAFT_URL via
// the same _maybeCreateOutlookDraft helper used by draft_outreach_email.
// ---------------------------------------------------------------------------
async function handleDraftReplyFromInbox(params, user, workspaceId) {
  const { inbox_item_id, intent, tone, guidance } = params || {};

  if (!inbox_item_id) {
    return { ok: false, error: 'inbox_item_id is required', action: 'draft_reply_from_inbox' };
  }

  // Fetch the flagged-email inbox row.
  const lookup = await opsQuery(
    'GET',
    `inbox_items?id=eq.${encodeURIComponent(inbox_item_id)}&limit=1&select=id,title,body,external_url,external_id,source_type,metadata,received_at,assigned_to,workspace_id`
  );
  const item = lookup.data?.[0];
  if (!item) {
    return {
      ok: false,
      action: 'draft_reply_from_inbox',
      error: `Inbox item not found: ${inbox_item_id}`
    };
  }

  const meta = item.metadata || {};
  const senderName  = meta.sender_name  || 'the sender';
  const senderEmail = meta.sender_email || null;
  const receivedAt  = item.received_at || meta.received_at || null;
  const originalSubject = item.title || '(no subject)';
  const originalBody    = item.body  || '(no body preview was captured)';

  if (!senderEmail) {
    return {
      ok: false,
      action: 'draft_reply_from_inbox',
      error: 'Original sender email is missing from this inbox item — cannot derive a reply recipient. Use draft_outreach_email with an explicit "to" instead.',
      inbox_item_id
    };
  }

  const replySubject = /^re:\s/i.test(originalSubject)
    ? originalSubject
    : `Re: ${originalSubject}`;

  const toneGuide   = tone   || 'professional, warm, and responsive';
  const intentGuide = intent || 'address the sender\'s message directly and propose a clear next step';
  const guidanceBlock = guidance ? `\n\nAdditional guidance from the user:\n${guidance}` : '';
  const receivedBlock = receivedAt ? `\nReceived: ${receivedAt}` : '';

  const prompt = [
    'Draft a personalized REPLY to a flagged business email for a commercial real estate broker (SVP, Investment Sales at Northmarq).',
    '',
    'Original email context:',
    `- From: ${senderName} <${senderEmail}>${receivedBlock}`,
    `- Subject: ${originalSubject}`,
    '- Body / preview:',
    '----- BEGIN ORIGINAL -----',
    String(originalBody).slice(0, 6000),
    '----- END ORIGINAL -----',
    '',
    `Reply intent: ${intentGuide}`,
    `Tone: ${toneGuide}`,
    guidanceBlock,
    '',
    'Requirements:',
    '- Start the email body with a brief acknowledgement of what the sender said.',
    '- Match the sender\'s register — concise if they were terse, fuller if they were detailed.',
    '- Address every direct question or ask in the original.',
    '- End with a clear but soft call-to-action (a specific next step, a question, or a time proposal).',
    '- Keep the body under 180 words unless the original required substantive answers.',
    '- Do NOT fabricate facts (specific dollar amounts, dates, addresses, names) — if a detail would be required, leave a clearly-marked placeholder like [confirm price] for the user to fill in.',
    `- Produce a Subject line ("${replySubject}" or an improved variant) and a body. This is a DRAFT for the broker to review before sending.`
  ].filter(Boolean).join('\n');

  const aiResult = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'draft_reply_from_inbox', inbox_item_id },
    history: Array.isArray(params?.history) ? params.history : [],
    attachments: [],
    user,
    workspaceId
  });

  const responseText = aiResult.data?.response || '';

  // _maybeCreateOutlookDraft pulls recipient from params.to OR fallbackTo.
  // We pass the sender as fallback; user can still override by setting
  // params.to explicitly (e.g., to route to a delegate).
  const draftInfo = await _maybeCreateOutlookDraft({
    params: { ...params, subject: replySubject },
    responseText,
    fallbackTo: senderEmail
  });

  return {
    ok: true,
    action: 'draft_reply_from_inbox',
    response: responseText,
    inbox_item_id,
    original_sender: senderEmail,
    original_sender_name: senderName,
    original_subject: originalSubject,
    received_at: receivedAt,
    suggested_subject: replySubject,
    requires_review: true,
    note: draftInfo?.draft_created
      ? `Reply draft created in your Outlook to ${senderEmail} — open it to review and send.`
      : `Reply drafted (text only). Pass create_draft=true to also create the draft in Outlook.`,
    provider: aiResult.provider,
    inbox_item_url: item.external_url || null,
    ...(draftInfo || {})
  };
}


// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// LISTING PURSUIT DOSSIER — assemble context for pursuit strategy (Wave 2)
// ---------------------------------------------------------------------------

async function handleListingPursuitDossier(params, user, workspaceId) {
  const { entity_id, entity_name, q } = params || {};

  // Try to find entity context
  let entityContext = '';
  let entityData = null;
  let govData = [];
  let diaData = [];

  if (entity_id) {
    const entityResult = await opsQuery('GET', `entities?id=eq.${encodeURIComponent(entity_id)}&limit=1`);
    entityData = entityResult.data?.[0];
  } else if (q || entity_name) {
    const searchTerm = q || entity_name;
    const entityResult = await opsQuery('GET', `entities?name=ilike.*${encodeURIComponent(searchTerm)}*&limit=5`);
    entityData = entityResult.data?.[0]; // take best match
  }

  if (entityData) {
    entityContext += `\nTarget Entity: ${entityData.name}\nType: ${entityData.entity_type || 'unknown'}\nDomain: ${entityData.domain || 'unknown'}`;

    // Fetch activity timeline
    const timeline = await opsQuery('GET',
      `v_entity_timeline?entity_id=eq.${encodeURIComponent(entityData.id)}&limit=15&order=created_at.desc`
    );
    if (timeline.data?.length) {
      entityContext += '\n\nInteraction History:\n' + timeline.data.map(e =>
        `- ${e.created_at?.split('T')[0] || '?'}: ${e.event_type || 'activity'} — ${e.title || e.description || '(no details)'}`
      ).join('\n');
    }
  }

  // Fetch domain-specific context if available
  const diaUrl = process.env.DIA_SUPABASE_URL;
  const diaKey = diaSupabaseKey();
  if (diaUrl && diaKey && entityData?.domain === 'dialysis') {
    try {
      const r = await fetch(`${diaUrl}/rest/v1/v_clinic_overview?property_name=ilike.*${encodeURIComponent(entityData.name)}*&limit=3`, {
        headers: { 'apikey': diaKey, 'Authorization': `Bearer ${diaKey}` }
      });
      if (r.ok) diaData = await r.json();
    } catch { /* non-fatal */ }
  }

  if (GOV_URL && GOV_KEY && entityData?.domain === 'government') {
    try {
      const r = await fetch(`${GOV_URL}/rest/v1/mv_gov_overview_stats?select=*&limit=1`, {
        headers: { 'apikey': GOV_KEY, 'Authorization': `Bearer ${GOV_KEY}` }
      });
      if (r.ok) govData = await r.json();
    } catch { /* non-fatal */ }
  }

  const domainContext = diaData.length
    ? '\n\nDomain Intelligence (Dialysis):\n' + JSON.stringify(diaData[0], null, 2)
    : govData.length
    ? '\n\nDomain Intelligence (Government):\n' + JSON.stringify(govData[0], null, 2)
    : '';

  const prompt = `Generate a listing pursuit dossier for a commercial real estate broker preparing to pursue an exclusive sell-side assignment.\n${entityContext}${domainContext}\n\nInclude these sections:\n1. **Target Summary** — property/entity overview, key facts\n2. **Ownership & Decision-Maker Context** — what we know about the owner/principals\n3. **Market Position** — comparable sales, market conditions, estimated value range\n4. **Pursuit Strategy** — recommended approach, timing, key differentiators\n5. **Call Prep Notes** — 3-5 talking points for the initial outreach\n6. **Next Steps** — specific actions to take this week\n\nBe concise but substantive. Use actual data from the context provided. Where data is missing, note the gap and suggest how to fill it.`;

  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'generate_listing_pursuit_dossier' },
    history: [],
    attachments: [],
    user,
    workspaceId
  });

  return {
    ok: true,
    action: 'generate_listing_pursuit_dossier',
    response: result.data?.response || '',
    entity: entityData ? { id: entityData.id, name: entityData.name, domain: entityData.domain } : null,
    provider: result.provider
  };
}

// ---------------------------------------------------------------------------
// TEAMS CARD GENERATOR — produce adaptive card JSON for any action (Wave 2)
// ---------------------------------------------------------------------------

function generateTeamsCard(params) {
  const { card_type, data, lcc_host } = params || {};
  const baseUrl = lcc_host || process.env.LCC_APP_URL || process.env.LCC_BASE_URL || 'https://tranquil-delight-production-633f.up.railway.app';

  if (card_type === 'inbox_triage') {
    const item = data || {};
    return {
      ok: true,
      action: 'generate_teams_card',
      card_type: 'inbox_triage',
      card: {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
          { type: 'TextBlock', text: 'Inbox Item Needs Triage', weight: 'Bolder', size: 'Medium' },
          { type: 'FactSet', facts: [
            { title: 'From', value: item.sender || item.from || 'Unknown' },
            { title: 'Subject', value: item.title || item.subject || '(no subject)' },
            { title: 'Received', value: item.received_at || item.created_at || '' },
            { title: 'Domain', value: item.domain || 'unclassified' },
            { title: 'Priority', value: item.priority || 'normal' }
          ]},
          { type: 'TextBlock', text: item.summary || item.body_preview || '', wrap: true, spacing: 'Small', size: 'Small' }
        ],
        actions: [
          { type: 'Action.OpenUrl', title: 'View in LCC', url: `${baseUrl}/?tab=inbox&id=${item.id || ''}` },
          { type: 'Action.OpenUrl', title: 'Triage', url: `${baseUrl}/?tab=inbox&action=triage&id=${item.id || ''}` },
          { type: 'Action.OpenUrl', title: 'Promote to Action', url: `${baseUrl}/?tab=inbox&action=promote&id=${item.id || ''}` }
        ]
      }
    };
  }

  if (card_type === 'action_review') {
    const item = data || {};
    return {
      ok: true,
      action: 'generate_teams_card',
      card_type: 'action_review',
      card: {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
          { type: 'TextBlock', text: 'Action Needs Review', weight: 'Bolder', size: 'Medium' },
          { type: 'FactSet', facts: [
            { title: 'Title', value: item.title || '(untitled)' },
            { title: 'Status', value: item.status || 'open' },
            { title: 'Priority', value: item.priority || 'normal' },
            { title: 'Assigned To', value: item.assigned_to_name || item.assigned_to || 'Unassigned' },
            { title: 'Due', value: item.due_date || 'No due date' },
            { title: 'Domain', value: item.domain || '' }
          ]}
        ],
        actions: [
          { type: 'Action.OpenUrl', title: 'Open in LCC', url: `${baseUrl}/?tab=queue&id=${item.id || ''}` },
          { type: 'Action.OpenUrl', title: 'Reassign', url: `${baseUrl}/?tab=queue&action=reassign&id=${item.id || ''}` },
          { type: 'Action.OpenUrl', title: 'Escalate', url: `${baseUrl}/?tab=queue&action=escalate&id=${item.id || ''}` }
        ]
      }
    };
  }

  if (card_type === 'escalation') {
    const item = data || {};
    return {
      ok: true,
      action: 'generate_teams_card',
      card_type: 'escalation',
      card: {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
          { type: 'TextBlock', text: 'Escalation', weight: 'Bolder', size: 'Medium', color: 'Attention' },
          { type: 'FactSet', facts: [
            { title: 'Action', value: item.title || '(untitled)' },
            { title: 'Escalated By', value: item.escalated_by_name || '' },
            { title: 'Reason', value: item.reason || '' },
            { title: 'Priority', value: item.priority || 'high' }
          ]},
          { type: 'TextBlock', text: item.description || '', wrap: true, spacing: 'Small', size: 'Small' }
        ],
        actions: [
          { type: 'Action.OpenUrl', title: 'Review in LCC', url: `${baseUrl}/?tab=queue&id=${item.action_item_id || ''}` },
          { type: 'Action.OpenUrl', title: 'Reassign', url: `${baseUrl}/?tab=queue&action=reassign&id=${item.action_item_id || ''}` }
        ]
      }
    };
  }

  return { ok: false, error: `Unknown card_type: ${card_type}. Supported: inbox_triage, action_review, escalation` };
}

// ---------------------------------------------------------------------------
// DOCUMENT ASSEMBLY — generate BOVs, proposals, reports via Graph API (Wave 3)
// ---------------------------------------------------------------------------

async function handleDocumentAssembly(params, user, workspaceId) {
  const { doc_type, document_type, entity_id, entity_name, title, additional_context, domain } = params || {};
  const resolvedDocType = doc_type || document_type;
  if (!resolvedDocType) return { ok: false, error: 'doc_type is required. Options: bov, proposal, seller_report, comp_analysis, pursuit_summary' };

  const graphToken = process.env.MS_GRAPH_TOKEN;

  // Gather entity context
  let entityContext = '';
  let entityData = null;
  if (entity_id) {
    const r = await opsQuery('GET', `entities?id=eq.${encodeURIComponent(entity_id)}&limit=1`);
    entityData = r.data?.[0];
  } else if (entity_name) {
    const r = await opsQuery('GET', `entities?name=ilike.*${encodeURIComponent(entity_name)}*&limit=3`);
    entityData = r.data?.[0];
  }

  if (entityData) {
    entityContext = `Property/Entity: ${entityData.name}\nType: ${entityData.entity_type || 'unknown'}\nDomain: ${entityData.domain || 'unknown'}`;
    const timeline = await opsQuery('GET',
      `v_entity_timeline?entity_id=eq.${encodeURIComponent(entityData.id)}&limit=10&order=created_at.desc`
    );
    if (timeline.data?.length) {
      entityContext += '\n\nRecent Activity:\n' + timeline.data.map(e =>
        `- ${e.created_at?.split('T')[0] || '?'}: ${e.title || e.description || '(activity)'}`
      ).join('\n');
    }
  }

  // Domain data enrichment
  let domainContext = '';
  if (entityData?.domain === 'government' && GOV_URL && GOV_KEY) {
    try {
      const r = await fetch(`${GOV_URL}/rest/v1/mv_gov_overview_stats?select=*&limit=1`, {
        headers: { 'apikey': GOV_KEY, 'Authorization': `Bearer ${GOV_KEY}` }
      });
      if (r.ok) {
        const stats = await r.json();
        if (stats?.[0]) domainContext = '\n\nGovernment Portfolio Context:\n' + JSON.stringify(stats[0], null, 2);
      }
    } catch { /* non-fatal */ }
  }

  // Document type prompts
  const docPrompts = {
    bov: `Generate a Broker's Opinion of Value (BOV) document for this commercial real estate property.\n\n${entityContext}${domainContext}\n${additional_context ? '\nAdditional Context: ' + additional_context : ''}\n\nStructure the BOV with these sections:\n1. **Executive Summary** — property overview and value conclusion\n2. **Property Description** — location, size, tenancy, lease terms\n3. **Market Analysis** — comparable sales, market conditions, cap rate environment\n4. **Valuation Approach** — methodology (income, sales comparison, or both)\n5. **Value Estimate** — estimated value range with supporting rationale\n6. **Assumptions & Limiting Conditions**\n\nUse professional valuation language. Where data is missing, note "[DATA NEEDED: description]" placeholders.`,

    proposal: `Generate a listing proposal / pitch document for this commercial real estate property.\n\n${entityContext}${domainContext}\n${additional_context ? '\nAdditional Context: ' + additional_context : ''}\n\nStructure the proposal with these sections:\n1. **Cover Letter** — personalized to the owner\n2. **Team Qualifications** — Briggs CRE team overview and relevant experience\n3. **Market Overview** — current conditions for this property type/market\n4. **Marketing Strategy** — how the property will be positioned and marketed\n5. **Pricing Recommendation** — suggested list price with rationale\n6. **Timeline** — proposed marketing and closing timeline\n7. **Fee Structure** — standard commission terms\n\nMake it compelling and specific to this property.`,

    seller_report: `Generate a weekly seller report for this active listing.\n\n${entityContext}${domainContext}\n${additional_context ? '\nAdditional Context: ' + additional_context : ''}\n\nStructure the report with:\n1. **Executive Summary** — one paragraph overview of the week\n2. **Marketing Activity** — inquiries, showings, OM downloads\n3. **Buyer Feedback** — summary of buyer responses and interest levels\n4. **Market Update** — any relevant market changes\n5. **Next Steps** — planned activities for the coming week\n6. **Key Metrics Table** — days on market, total inquiries, showings, offers\n\nKeep it concise and factual.`,

    comp_analysis: `Generate a comparable sales analysis for this property.\n\n${entityContext}${domainContext}\n${additional_context ? '\nAdditional Context: ' + additional_context : ''}\n\nStructure the analysis with:\n1. **Subject Property Summary**\n2. **Comparable Sales** — list 3-5 comparable transactions with price, cap rate, date, SF, price/SF\n3. **Adjustment Grid** — adjustments for location, condition, lease terms, age\n4. **Indicated Value Range** — derived from adjusted comps\n5. **Market Observations** — trends in cap rates, pricing, demand\n\nWhere comp data is unavailable, note "[COMP NEEDED: criteria]" placeholders.`,

    pursuit_summary: `Generate a one-page pursuit summary brief for this property/opportunity.\n\n${entityContext}${domainContext}\n${additional_context ? '\nAdditional Context: ' + additional_context : ''}\n\nStructure as a single concise page:\n1. **Opportunity** — what's the play?\n2. **Property** — key facts\n3. **Owner/Decision-Maker** — who to approach\n4. **Our Advantage** — why us\n5. **Risks** — what could go wrong\n6. **Next Action** — what to do this week\n\nKeep it tight — this is a quick-reference brief, not a full report.`
  };

  const prompt = docPrompts[resolvedDocType];
  if (!prompt) {
    return { ok: false, error: `Unknown doc_type: ${resolvedDocType}. Options: ${Object.keys(docPrompts).join(', ')}` };
  }

  // Generate document content via AI
  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'generate_document', doc_type: resolvedDocType },
    history: [], attachments: [], user, workspaceId
  });

  const content = result.data?.response || '';
  if (!content) {
    return { ok: false, error: 'AI failed to generate document content' };
  }

  // Build HTML wrapper for Word-compatible document
  const entityLabel = entityData?.name || entity_name || 'Property';
  const docTitle = title || `${resolvedDocType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} — ${entityLabel}`;
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const htmlDoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${docTitle}</title>
<style>body{font-family:Calibri,Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#333;line-height:1.6}h1{color:#1a237e;border-bottom:2px solid #1a237e;padding-bottom:8px}h2{color:#283593;margin-top:24px}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ccc;padding:8px 12px;text-align:left}th{background:#f5f5f5;font-weight:600}.header{text-align:center;margin-bottom:32px}.header h1{border:none;margin-bottom:4px}.header .sub{color:#666;font-size:14px}.footer{margin-top:48px;padding-top:16px;border-top:1px solid #ccc;font-size:12px;color:#999;text-align:center}</style></head>
<body>
<div class="header"><h1>${docTitle}</h1><div class="sub">Prepared by Briggs CRE | ${dateStr}</div></div>
${content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/^- (.+)$/gm, '<li>$1</li>').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}
<div class="footer">Generated by Life Command Center | ${dateStr} | CONFIDENTIAL</div>
</body></html>`;

  // Try to save to OneDrive if Graph token is available
  let savedFile = null;
  if (graphToken) {
    const fileName = `${resolvedDocType}_${entityLabel.replace(/[^a-zA-Z0-9]/g, '_')}_${dateStr.replace(/[^a-zA-Z0-9]/g, '_')}.html`;
    const folderPath = 'LCC Documents';

    try {
      const uploadRes = await fetch(
        `${GRAPH_API_URL}/me/drive/root:/${folderPath}/${fileName}:/content`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${graphToken}`,
            'Content-Type': 'text/html'
          },
          body: htmlDoc
        }
      );
      if (uploadRes.ok) {
        const fileData = await uploadRes.json();
        savedFile = {
          id: fileData.id,
          name: fileData.name,
          web_url: fileData.webUrl,
          size: fileData.size,
          folder: folderPath
        };
      }
    } catch (e) {
      // Non-fatal — document was still generated
      console.warn('[doc-assembly] OneDrive upload failed:', e.message);
    }
  }

  // Log activity. Awaited because Vercel Node freezes pending I/O after
  // the response returns; the previous fire-and-forget pattern silently
  // dropped a fraction of audit rows. Cost is one extra round-trip
  // (~5-15ms) on a handler that already did an LLM call — negligible.
  if (workspaceId) {
    await opsQuery('POST', 'activity_events', {
      workspace_id: workspaceId,
      user_id: user?.id,
      event_type: 'document_generated',
      source: 'copilot',
      title: `Generated ${resolvedDocType}: ${entityLabel}`,
      entity_id: entityData?.id || null,
      metadata: { doc_type: resolvedDocType, saved_to_onedrive: !!savedFile, file_name: savedFile?.name }
    }).catch(err => console.warn('[doc-assembly] activity_events write failed:', err?.message || err));
  }

  return {
    ok: true,
    action: 'generate_document',
    doc_type: resolvedDocType,
    title: docTitle,
    entity: entityData ? { id: entityData.id, name: entityData.name } : null,
    response: content,
    saved_file: savedFile,
    html_available: true,
    note: savedFile
      ? `Document saved to OneDrive: ${savedFile.folder}/${savedFile.name}`
      : 'Document generated. Set MS_GRAPH_TOKEN with Files.ReadWrite scope to auto-save to OneDrive.',
    provider: result.provider
  };
}

// ---------------------------------------------------------------------------
// RELATIONSHIP MEMORY — pre-call/pre-meeting context synthesis (Wave 3)
// ---------------------------------------------------------------------------

async function handleRelationshipContext(params, user, workspaceId) {
  const { contact_id, contact_name } = params || {};
  if (!contact_id && !contact_name) {
    return { ok: false, error: 'contact_id or contact_name is required' };
  }

  // Fetch contact profile
  let contact = null;
  if (contact_id) {
    const r = await govContactQuery(
      `unified_contacts?unified_id=eq.${encodeURIComponent(contact_id)}&limit=1&select=unified_id,full_name,email,phone,company_name,title,engagement_score,last_call_date,last_email_date,last_meeting_date,total_calls,total_emails_sent,city,state,contact_class,contact_type,industry,notes`
    );
    contact = r.data?.[0];
  } else {
    const r = await govContactQuery(
      `unified_contacts?full_name=ilike.*${encodeURIComponent(contact_name)}*&limit=1&select=unified_id,full_name,email,phone,company_name,title,engagement_score,last_call_date,last_email_date,last_meeting_date,total_calls,total_emails_sent,city,state,contact_class,contact_type,industry,notes`
    );
    contact = r.data?.[0];
  }

  if (!contact) {
    return { ok: true, action: 'get_relationship_context', response: 'Contact not found.', contact: null };
  }

  // Fetch change log (interaction history)
  const historyResult = await govContactQuery(
    `contact_change_log?unified_id=eq.${encodeURIComponent(contact.unified_id)}&order=changed_at.desc&limit=20`
  );

  // Fetch linked entity activity if we can find one
  let entityActivity = [];
  if (workspaceId) {
    const linkedEntities = await opsQuery('GET',
      `external_identities?workspace_id=eq.${encodeURIComponent(workspaceId)}&source_id=eq.${encodeURIComponent(contact.unified_id)}&limit=3`
    );
    if (linkedEntities.data?.length) {
      const entityId = linkedEntities.data[0].entity_id;
      const timeline = await opsQuery('GET',
        `v_entity_timeline?entity_id=eq.${encodeURIComponent(entityId)}&limit=10&order=created_at.desc`
      );
      entityActivity = timeline.data || [];
    }
  }

  // Compute relationship health
  const now = Date.now();
  const daysSinceCall = contact.last_call_date ? Math.floor((now - new Date(contact.last_call_date).getTime()) / 86400000) : null;
  const daysSinceEmail = contact.last_email_date ? Math.floor((now - new Date(contact.last_email_date).getTime()) / 86400000) : null;
  const daysSinceMeeting = contact.last_meeting_date ? Math.floor((now - new Date(contact.last_meeting_date).getTime()) / 86400000) : null;
  const mostRecent = Math.min(...[daysSinceCall, daysSinceEmail, daysSinceMeeting].filter(d => d !== null));
  const healthScore = mostRecent === Infinity ? 0 : mostRecent <= 7 ? 100 : mostRecent <= 14 ? 80 : mostRecent <= 30 ? 60 : mostRecent <= 60 ? 40 : mostRecent <= 90 ? 20 : 10;
  const healthLabel = healthScore >= 80 ? 'strong' : healthScore >= 50 ? 'active' : healthScore >= 20 ? 'cooling' : 'cold';

  const contactContext = {
    name: contact.full_name,
    company: contact.company_name,
    title: contact.title,
    location: [contact.city, contact.state].filter(Boolean).join(', '),
    engagement_score: contact.engagement_score,
    total_calls: contact.total_calls || 0,
    total_emails: contact.total_emails_sent || 0,
    last_call: contact.last_call_date || 'never',
    last_email: contact.last_email_date || 'never',
    last_meeting: contact.last_meeting_date || 'never',
    days_since_last_touch: mostRecent === Infinity ? null : mostRecent,
    relationship_health: { score: healthScore, label: healthLabel },
    notes: contact.notes || null,
    recent_changes: (historyResult.data || []).slice(0, 5).map(h => ({
      date: h.changed_at,
      field: h.field_changed,
      action: h.change_type
    })),
    recent_entity_activity: entityActivity.slice(0, 5).map(e => ({
      date: e.created_at?.split('T')[0],
      type: e.event_type,
      title: e.title
    }))
  };

  // Generate AI summary
  const prompt = `Provide a concise relationship briefing for a commercial real estate broker about to interact with this contact.\n\nContact: ${contact.full_name}\nCompany: ${contact.company_name || 'unknown'}\nTitle: ${contact.title || 'unknown'}\nLocation: ${contactContext.location || 'unknown'}\nEngagement Score: ${contact.engagement_score || 0}\nRelationship Health: ${healthLabel} (${healthScore}/100)\nTotal Calls: ${contactContext.total_calls} | Emails: ${contactContext.total_emails}\nLast Call: ${contactContext.last_call} | Last Email: ${contactContext.last_email} | Last Meeting: ${contactContext.last_meeting}\n${contact.notes ? 'Notes: ' + contact.notes : ''}\n\nProvide:\n1. **Relationship Status** — one sentence on where this relationship stands\n2. **Key Context** — what to remember before reaching out\n3. **Suggested Approach** — how to re-engage based on the pattern\n4. **Talking Points** — 2-3 specific conversation starters\n\nBe specific and actionable. If data is sparse, say so and suggest what to learn on the next interaction.`;

  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'get_relationship_context' },
    history: [], attachments: [], user, workspaceId
  });

  return {
    ok: true,
    action: 'get_relationship_context',
    response: result.data?.response || '',
    contact: contactContext,
    provider: result.provider
  };
}

// ---------------------------------------------------------------------------
// PIPELINE INTELLIGENCE — stage velocity, bottlenecks, health (Wave 3)
// ---------------------------------------------------------------------------

async function handlePipelineIntelligence(params, user, workspaceId) {
  if (!workspaceId) return { ok: false, error: 'Workspace context required' };

  const domain = params?.domain;
  const domainFilter = domain ? `&domain=eq.${encodeURIComponent(domain)}` : '';

  // Parallel fetch: status distribution, overdue, velocity, type breakdown
  const [statusDist, overduItems, recentCompleted, typeBreakdown, escalations] = await Promise.all([
    opsQuery('GET', `action_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=neq.cancelled${domainFilter}&select=status,priority,action_type,domain&limit=500`),
    opsQuery('GET', `action_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=in.(open,in_progress)&due_date=lt.${new Date().toISOString().split('T')[0]}${domainFilter}&select=id,title,status,priority,due_date,assigned_to,domain,action_type&order=due_date.asc&limit=25`),
    opsQuery('GET', `action_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.completed&completed_at=gte.${new Date(Date.now() - 30 * 86400000).toISOString()}${domainFilter}&select=id,title,created_at,completed_at,action_type,domain&order=completed_at.desc&limit=50`),
    opsQuery('GET', `action_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=neq.cancelled${domainFilter}&select=action_type,status&limit=500`),
    opsQuery('GET', `escalations?workspace_id=eq.${encodeURIComponent(workspaceId)}&resolved_at=is.null&select=id,action_item_id,reason,escalated_by,created_at&order=created_at.desc&limit=10`)
  ]);

  // Status distribution
  const statusCounts = {};
  (statusDist.data || []).forEach(item => {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  });

  // Priority distribution
  const priorityCounts = {};
  (statusDist.data || []).forEach(item => {
    priorityCounts[item.priority || 'normal'] = (priorityCounts[item.priority || 'normal'] || 0) + 1;
  });

  // Action type distribution
  const typeCounts = {};
  (typeBreakdown.data || []).forEach(item => {
    typeCounts[item.action_type || 'other'] = (typeCounts[item.action_type || 'other'] || 0) + 1;
  });

  // Domain distribution
  const domainCounts = {};
  (statusDist.data || []).forEach(item => {
    domainCounts[item.domain || 'unclassified'] = (domainCounts[item.domain || 'unclassified'] || 0) + 1;
  });

  // Velocity: average days to complete (last 30 days)
  const completedItems = recentCompleted.data || [];
  let avgDaysToComplete = null;
  if (completedItems.length >= 3) {
    const durations = completedItems
      .filter(i => i.created_at && i.completed_at)
      .map(i => (new Date(i.completed_at) - new Date(i.created_at)) / 86400000);
    if (durations.length) {
      avgDaysToComplete = Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1));
    }
  }

  // Stale items: open/in_progress with no update in 14+ days
  const staleThreshold = new Date(Date.now() - 14 * 86400000).toISOString();
  const staleResult = await opsQuery('GET',
    `action_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=in.(open,in_progress)&updated_at=lt.${encodeURIComponent(staleThreshold)}${domainFilter}&select=id,title,status,assigned_to,domain,updated_at&order=updated_at.asc&limit=15`
  );

  const pipeline = {
    status_distribution: statusCounts,
    priority_distribution: priorityCounts,
    type_distribution: typeCounts,
    domain_distribution: domainCounts,
    total_active: (statusCounts.open || 0) + (statusCounts.in_progress || 0) + (statusCounts.waiting || 0),
    total_completed_30d: completedItems.length,
    avg_days_to_complete: avgDaysToComplete,
    overdue: {
      count: (overduItems.data || []).length,
      items: (overduItems.data || []).slice(0, 10).map(i => ({
        id: i.id, title: i.title, status: i.status, priority: i.priority,
        due_date: i.due_date, domain: i.domain, type: i.action_type
      }))
    },
    stale: {
      count: (staleResult.data || []).length,
      items: (staleResult.data || []).slice(0, 10).map(i => ({
        id: i.id, title: i.title, status: i.status, domain: i.domain,
        last_updated: i.updated_at
      }))
    },
    escalations: {
      open_count: (escalations.data || []).length,
      items: (escalations.data || []).slice(0, 5)
    }
  };

  // Generate AI summary
  const prompt = `Analyze this pipeline data for a commercial real estate brokerage team and provide a concise intelligence brief.\n\nPipeline Status:\n${JSON.stringify(pipeline.status_distribution)}\n\nPriority Distribution:\n${JSON.stringify(pipeline.priority_distribution)}\n\nType Breakdown:\n${JSON.stringify(pipeline.type_distribution)}\n\nDomain Breakdown:\n${JSON.stringify(pipeline.domain_distribution)}\n\nKey Metrics:\n- Active items: ${pipeline.total_active}\n- Completed (30d): ${pipeline.total_completed_30d}\n- Avg days to complete: ${avgDaysToComplete || 'insufficient data'}\n- Overdue: ${pipeline.overdue.count}\n- Stale (14+ days no update): ${pipeline.stale.count}\n- Open escalations: ${pipeline.escalations.open_count}\n\nProvide:\n1. **Pipeline Health** — one-sentence assessment\n2. **Bottlenecks** — where work is stuck and why it matters\n3. **Velocity Trend** — is the team clearing work fast enough?\n4. **Top Risks** — what could cause deals or tasks to fall through\n5. **Recommended Actions** — 2-3 specific things to do this week\n\nBe direct and specific. Reference actual numbers.`;

  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'get_pipeline_intelligence' },
    history: [], attachments: [], user, workspaceId
  });

  return {
    ok: true,
    action: 'get_pipeline_intelligence',
    response: result.data?.response || '',
    pipeline,
    provider: result.provider
  };
}

// ---------------------------------------------------------------------------
// GUIDED ENTITY MERGE — surface duplicates and guide merge decision (Wave 2)
// ---------------------------------------------------------------------------

async function handleGuidedEntityMerge(params, user, workspaceId) {
  if (!workspaceId) return { ok: false, error: 'Workspace context required' };

  const { entity_id, source } = params || {};

  // If entity_id provided, find its duplicates specifically
  if (entity_id) {
    const entityResult = await opsQuery('GET', `entities?id=eq.${encodeURIComponent(entity_id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`);
    const entity = entityResult.data?.[0];
    if (!entity) return { ok: false, error: 'Entity not found' };

    // Find entities with matching canonical name
    const canonical = entity.canonical_name || entity.name?.toLowerCase().trim();
    const matches = await opsQuery('GET',
      `entities?workspace_id=eq.${encodeURIComponent(workspaceId)}&canonical_name=eq.${encodeURIComponent(canonical)}&id=neq.${encodeURIComponent(entity_id)}&select=id,name,entity_type,domain,city,state,created_at&limit=10`
    );

    if (!matches.data?.length) {
      return { ok: true, action: 'guided_entity_merge', duplicates_found: 0, message: `No duplicates found for "${entity.name}".`, entity };
    }

    return {
      ok: true,
      action: 'guided_entity_merge',
      duplicates_found: matches.data.length,
      target: { id: entity.id, name: entity.name, type: entity.entity_type, domain: entity.domain },
      candidates: matches.data,
      message: `Found ${matches.data.length} potential duplicate(s) for "${entity.name}". Review and use the entity merge action to consolidate.`,
      merge_endpoint: 'POST /api/entities?action=merge',
      merge_params: { target_id: entity.id, source_id: '<candidate_id>' }
    };
  }

  // Otherwise, surface top duplicate groups and contact merge queue
  const [entityDups, contactQueue] = await Promise.all([
    opsQuery('GET', `v_duplicate_candidates?workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=15`),
    source !== 'entities_only' ? govContactQuery(`contact_merge_queue?status=eq.pending&order=match_score.desc&limit=15`) : Promise.resolve({ data: [] })
  ]);

  return {
    ok: true,
    action: 'guided_entity_merge',
    entity_duplicates: {
      groups: (entityDups.data || []).length,
      items: entityDups.data || []
    },
    contact_merge_queue: {
      pending: (contactQueue.data || []).length,
      items: (contactQueue.data || []).slice(0, 10)
    },
    message: `Found ${(entityDups.data || []).length} entity duplicate group(s) and ${(contactQueue.data || []).length} pending contact merge(s).`
  };
}

// ---------------------------------------------------------------------------
// Fetch operational context for Copilot enrichment
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

async function fetchOpsContext(workspaceId, userId) {
  if (!workspaceId) return {};
  try {
    const [countResult, syncResult, recentInbox, recentSf, researchBacklog] = await Promise.all([
      opsQuery('GET', `mv_work_counts?workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`),
      opsQuery('GET', `sync_errors?workspace_id=eq.${encodeURIComponent(workspaceId)}&resolved_at=is.null&select=id&limit=0`),
      opsQuery('GET', `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=in.(new,triaged)&order=received_at.desc&limit=8&select=id,title,status,priority,source_type,metadata,received_at`),
      opsQuery('GET', `activity_events?workspace_id=eq.${encodeURIComponent(workspaceId)}&source_type=eq.salesforce&order=occurred_at.desc&limit=10&select=title,category,metadata,occurred_at`),
      opsQuery('GET', `research_tasks?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=in.(queued,in_progress)&order=priority.desc,created_at.asc&limit=5&select=id,title,research_type,domain,status,priority,created_at`)
    ]);
    const counts = countResult.data?.[0] || {};
    const inboxItems = (recentInbox.data || []).map(i => ({
      title: i.title,
      from: i.metadata?.sender_email || i.metadata?.sf_who || null,
      type: i.source_type,
      priority: i.priority,
      received: i.received_at
    }));
    const sfItems = (recentSf.data || []).map(a => ({
      title: a.title,
      type: a.category,
      contact: a.metadata?.sf_who || null,
      deal: a.metadata?.sf_what || null,
      date: a.occurred_at
    }));
    const research = (researchBacklog.data || []).map(r => ({
      title: r.title,
      type: r.research_type,
      domain: r.domain,
      status: r.status,
      age_days: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
    }));

    // Fetch hot contacts from Gov DB for chat context
    let topContacts = [];
    const govUrl = process.env.GOV_SUPABASE_URL;
    const govKey = govSupabaseKey();
    if (govUrl && govKey) {
      try {
        const cRes = await fetch(
          `${govUrl}/rest/v1/unified_contacts?contact_class=eq.business&engagement_score=gt.20&order=engagement_score.desc&limit=5&select=full_name,company_name,engagement_score,last_call_date,last_email_date,contact_type`,
          { headers: { 'apikey': govKey, 'Authorization': `Bearer ${govKey}` } }
        );
        if (cRes.ok) {
          const contacts = await cRes.json();
          topContacts = (contacts || []).map(c => ({
            name: c.full_name,
            company: c.company_name,
            score: c.engagement_score,
            type: c.contact_type,
            last_call: c.last_call_date || 'never',
            last_email: c.last_email_date || 'never'
          }));
        }
      } catch { /* non-fatal */ }
    }

    return {
      ops_work_counts: {
        open_actions: counts.open_actions || 0,
        overdue: counts.overdue_actions || 0,
        inbox_new: counts.inbox_new || 0,
        research_active: counts.research_active || 0,
        sync_errors: syncResult.count || 0,
        open_escalations: counts.open_escalations || 0,
        due_this_week: counts.due_this_week || 0,
        completed_week: counts.completed_week || 0
      },
      recent_inbox_items: inboxItems,
      recent_sf_activity: sfItems,
      research_backlog: research,
      top_engaged_contacts: topContacts
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// CHAT HANDLER
// ---------------------------------------------------------------------------

// ============================================================================
// COPILOT SIGNAL + SURFACE FORMATTERS
// ============================================================================

/**
 * Write a copilot invocation signal for the learning loop.
 * Tracks which actions are called, from which surface, latency, and result quality.
 */
function writeCopilotSignal(data, user) {
  writeSignal({
    signal_type: 'copilot_invocation',
    signal_category: 'intelligence',
    user_id: user?.id || null,
    payload: {
      action: data.action,
      tier: data.tier,
      surface: data.surface,
      duration_ms: data.duration_ms,
      ok: data.ok,
      requires_confirmation: data.requires_confirmation,
      result_count: data.result_count,
      session_id: data.session_id
    },
    outcome: data.ok ? 'positive' : (data.requires_confirmation ? 'pending' : 'negative')
  });
}

/**
 * Format a copilot action result as a Teams adaptive card snippet.
 * The full card rendering happens in generate_teams_card — this adds
 * lightweight card metadata so Teams can render inline.
 */
function formatForTeams(actionId, result) {
  const itemCount = result.data?.count
    || result.data?.items?.length
    || result.data?.templates?.length
    || null;

  return {
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: actionId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        weight: 'Bolder',
        size: 'Medium'
      },
      ...(itemCount != null ? [{
        type: 'TextBlock',
        text: `${itemCount} item${itemCount !== 1 ? 's' : ''} returned`,
        isSubtle: true
      }] : []),
      {
        type: 'TextBlock',
        text: result.ok ? 'View details in Life Command Center' : 'Action requires confirmation',
        wrap: true
      }
    ],
    actions: [
      {
        type: 'Action.OpenUrl',
        title: 'Open in LCC',
        url: process.env.LCC_BASE_URL || 'https://tranquil-delight-production-633f.up.railway.app'
      }
    ]
  };
}

/**
 * Format a copilot action result as a compact Outlook digest block.
 * Used when Copilot surfaces LCC data in Outlook context.
 */
function formatForOutlookDigest(actionId, result) {
  const itemCount = result.data?.count
    || result.data?.items?.length
    || null;

  const title = actionId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return {
    title,
    summary: itemCount != null ? `${itemCount} item${itemCount !== 1 ? 's' : ''}` : 'Completed',
    link: process.env.LCC_BASE_URL || 'https://tranquil-delight-production-633f.up.railway.app',
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// TEMPLATE DRAFT ENGINE — /api/draft → operations?_route=draft
// ============================================================================

/**
 * Auto-enrich a draft context object with server-side variables that
 * the caller shouldn't need to build manually:
 *
 *  - team.credentials_summary  — domain-specific track record paragraph
 *  - team.signature            — Scott's signature block
 *  - comp_highlights           — formatted recent sales table from domain DB
 *  - quarter_year              — current quarter label (e.g., "Q2 2026")
 *
 * Variables already present in the context are NOT overwritten, so the
 * caller can always override any auto-enriched value.
 */
async function enrichDraftContext(context) {
  const enriched = { ...context };

  // Resolve domain from property or top-level
  const domain = enriched.property?.domain || enriched.domain || null;

  // --- Resolve missing property.city_state from domain databases ---
  if (enriched.property && !enriched.property.city_state && domain) {
    try {
      // Try to look up city/state from property_id or tenant name
      const propId = enriched.property.property_id;
      const tenant = enriched.property.tenant;

      if (propId || tenant) {
        const DIA_URL = process.env.DIA_SUPABASE_URL;
        const DIA_KEY = diaSupabaseKey();
        const GOV_URL = process.env.GOV_SUPABASE_URL;
        const GOV_KEY = govSupabaseKey();

        let lookupUrl, lookupKey;
        if (domain === 'dialysis' && DIA_URL && DIA_KEY) {
          lookupUrl = DIA_URL; lookupKey = DIA_KEY;
        } else if (domain === 'government' && GOV_URL && GOV_KEY) {
          lookupUrl = GOV_URL; lookupKey = GOV_KEY;
        }

        if (lookupUrl && lookupKey) {
          const table = domain === 'dialysis' ? 'properties' : 'properties';
          let filter = propId ? `id=eq.${pgFilterVal(propId)}` : `tenant_name=ilike.*${pgFilterVal(tenant)}*`;
          const propResult = await fetch(
            `${lookupUrl}/rest/v1/${table}?${filter}&select=city,state,address&limit=1`,
            { headers: { 'apikey': lookupKey, 'Authorization': `Bearer ${lookupKey}` } }
          );
          if (propResult.ok) {
            const rows = await propResult.json();
            if (rows?.[0]) {
              const p = rows[0];
              enriched.property.city_state = [p.city, p.state].filter(Boolean).join(', ');
              if (!enriched.property.address && p.address) enriched.property.address = p.address;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[enrichDraftContext] Property city_state lookup failed:', err.message);
    }
  }

  // --- team.credentials_summary ---
  if (!enriched.team?.credentials_summary && domain) {
    enriched.team = enriched.team || {};
    enriched.team.credentials_summary = getTrackRecordSummary(domain);
  }

  // --- team.signature ---
  // Intentionally left empty — Outlook appends the user's configured signature
  // automatically when opening a new email via mailto:. Injecting a signature
  // here would create a duplicate. Set to empty string so the {{team.signature}}
  // variable resolves but renders nothing.
  if (!enriched.team?.signature) {
    enriched.team = enriched.team || {};
    enriched.team.signature = '';
  }

  // --- comp_highlights (recent sales from domain DB) ---
  if (!enriched.comp_highlights && domain) {
    try {
      const state = enriched.property?.state ||
        (enriched.property?.city_state ? enriched.property.city_state.split(', ').pop() : null);
      const teamCtx = await buildTeamContextWithSales(domain, {
        limit: 5,
        state // prefer comps in same state as property
      });
      if (teamCtx.recent_sales_table) {
        enriched.comp_highlights = teamCtx.recent_sales_table;
      } else if (state) {
        // Retry without state filter if no same-state comps found
        const fallback = await buildTeamContextWithSales(domain, { limit: 5 });
        if (fallback.recent_sales_table) {
          enriched.comp_highlights = fallback.recent_sales_table;
        }
      }
    } catch (err) {
      console.warn('[enrichDraftContext] comp_highlights fetch failed:', err.message);
    }
  }

  // --- property.domain_label (display-friendly domain name) ---
  if (enriched.property && !enriched.property.domain_label) {
    if (domain) {
      const labels = { government: 'Government-Leased', dialysis: 'Net Lease Medical/Dialysis' };
      enriched.property.domain_label = labels[domain] || domain;
    } else {
      enriched.property.domain_label = 'Net Lease';
    }
  }

  // --- quarter_year ---
  if (!enriched.quarter_year) {
    const now = new Date();
    const q = Math.ceil((now.getMonth() + 1) / 3);
    enriched.quarter_year = `Q${q} ${now.getFullYear()}`;
  }

  // --- is_standard_touch (inverse of is_final_touch for T-002 rendering) ---
  // The template engine can't nest if/else blocks, so T-002 uses two separate
  // {{#if}} blocks: is_final_touch for Touch 7, is_standard_touch for Touches 2-6.
  if (!enriched.is_standard_touch && !enriched.is_final_touch) {
    enriched.is_standard_touch = 'true';
  }

  // --- T-003 mode flags (mutually exclusive) ---
  // is_inbound_request: someone asked for the report
  // is_outbound_anchored: proactive send to a known owner (has property.tenant)
  // is_mass_broadcast: quarterly blast with no specific property anchor
  if (!enriched.is_inbound_request && !enriched.is_outbound_anchored && !enriched.is_mass_broadcast) {
    if (enriched.property?.tenant) {
      enriched.is_outbound_anchored = 'true';
    } else {
      enriched.is_mass_broadcast = 'true';
    }
  }

  // --- report_info (from capital_markets_reports registry) ---
  // Injects report_title, report_quarter, report_url for template use
  if (!enriched.report_info && domain) {
    try {
      const reportResult = await opsQuery('GET',
        `capital_markets_reports?domain=eq.${pgFilterVal(domain)}&is_active=eq.true&limit=1`
      );
      if (reportResult.ok && reportResult.data?.[0]) {
        const rpt = reportResult.data[0];
        enriched.report_info = {
          title: rpt.report_title,
          quarter: rpt.report_quarter,
          filename: rpt.report_filename,
          local_path: rpt.local_path || null,
          url: rpt.public_url || rpt.sharepoint_url || null,
          key_stats: rpt.key_stats || {}
        };
        // Inject pricing advantage for dialysis (killer differentiator)
        if (domain === 'dialysis' && rpt.key_stats?.pricing_advantage) {
          enriched.pricing_advantage = `Over the trailing twelve months, marketed dialysis assets placed by Northmarq have achieved an average cap rate of ${rpt.key_stats.northmarq_cap_rate} versus ${rpt.key_stats.market_cap_rate} for non-Northmarq transactions — translating to approximately ${rpt.key_stats.pricing_advantage} in additional proceeds per sale (${rpt.key_stats.pricing_uplift_pct} uplift).`;
        }
      }
    } catch (err) {
      console.warn('[enrichDraftContext] Report lookup failed:', err.message);
    }
  }

  return enriched;
}

async function handleDraftRoute(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships?.[0]?.workspace_id || '';

  // GET — list available templates or get a specific template
  if (req.method === 'GET') {
    const { template_id } = req.query;

    if (template_id) {
      const template = await loadTemplate(template_id);
      if (!template) return res.status(404).json({ error: `Template "${template_id}" not found` });
      return res.status(200).json({ template });
    }

    const templates = await listActiveTemplates();
    return res.status(200).json({ templates, count: templates.length });
  }

  // POST — generate a draft from template + context
  if (req.method === 'POST') {
    const { action } = req.query;

    // POST ?action=generate — generate a single draft
    if (!action || action === 'generate') {
      const { template_id, context, strict, cadence_ids } = req.body || {};
      if (!template_id) return res.status(400).json({ error: 'template_id is required' });
      if (!context || typeof context !== 'object') {
        return res.status(400).json({ error: 'context object is required (merged packet payload)' });
      }

      // R24 Unit 4 — performance-aware template selection. Gated on
      // CADENCE_TEMPLATE_AUTOSELECT (default OFF) so it ships dark and Scott
      // flips it on only AFTER Unit 1's sends have accrued real performance data
      // (selecting on an empty high_performing_templates view is a no-op anyway —
      // chooseBestTemplate is cold-start safe and returns the default). Same-
      // category only, so it tunes voice without changing the sequence intent.
      let effectiveTemplateId = template_id;
      if (String(process.env.CADENCE_TEMPLATE_AUTOSELECT || '').toLowerCase() === 'true') {
        try {
          effectiveTemplateId = await chooseBestTemplate(template_id, {});
        } catch (err) {
          console.warn('[handleDraftRoute] chooseBestTemplate failed (using default):', err.message);
          effectiveTemplateId = template_id;
        }
      }

      // Auto-enrich context with team variables if not already provided
      const enrichedContext = await enrichDraftContext(context);

      // If cadence IDs provided, fetch cadence state and merge context flags
      let cadenceInfo = null;
      if (cadence_ids && (cadence_ids.entity_id || cadence_ids.sf_contact_id || cadence_ids.contact_id)) {
        try {
          cadenceInfo = await getCadenceForDraft(
            cadence_ids,
            { property_id: context.property?.property_id, domain: context.domain || context.property?.domain }
          );
          if (cadenceInfo.ok && cadenceInfo.context_flags) {
            Object.assign(enrichedContext, cadenceInfo.context_flags);
          }
        } catch (err) {
          console.warn('[handleDraftRoute] Cadence lookup failed (non-blocking):', err.message);
        }
      }

      const result = await generateDraft(effectiveTemplateId, enrichedContext, { strict: !!strict });
      if (!result.ok) {
        return res.status(422).json(result);
      }
      if (effectiveTemplateId !== template_id) {
        result.template_autoselected_from = template_id;
      }

      // Attach cadence info to response if available
      if (cadenceInfo?.ok) {
        result.cadence = {
          id: cadenceInfo.cadence.id,
          phase: cadenceInfo.cadence.phase,
          current_touch: cadenceInfo.cadence.current_touch,
          priority_tier: cadenceInfo.cadence.priority_tier,
          recommendation: cadenceInfo.recommendation,
          summary: cadenceInfo.summary
        };
      }

      // Attach report info for frontend attachment reminder
      if (enrichedContext.report_info) {
        result.report_attachment = enrichedContext.report_info;
      }

      return res.status(200).json(result);
    }

    // POST ?action=create_outlook_draft — create a real Outlook draft via Graph API
    // with the capital markets PDF already attached. Returns a webLink that opens
    // the draft in the user's default Outlook client (New Outlook, Outlook Web,
    // or whatever is configured). Outlook auto-applies the user's default signature.
    if (action === 'create_outlook_draft') {
      const { template_id, context, cadence_ids, to, cc } = req.body || {};
      if (!template_id) return res.status(400).json({ error: 'template_id is required' });
      if (!context || typeof context !== 'object') {
        return res.status(400).json({ error: 'context object is required' });
      }
      if (!to) return res.status(400).json({ error: 'to (recipient email) is required' });

      // Enrich + render (same path as generate)
      const enrichedContext = await enrichDraftContext(context);
      if (cadence_ids && (cadence_ids.entity_id || cadence_ids.sf_contact_id || cadence_ids.contact_id)) {
        try {
          const cadenceInfo = await getCadenceForDraft(
            cadence_ids,
            { property_id: context.property?.property_id, domain: context.domain || context.property?.domain }
          );
          if (cadenceInfo?.ok && cadenceInfo.context_flags) {
            Object.assign(enrichedContext, cadenceInfo.context_flags);
          }
        } catch (err) { /* non-blocking */ }
      }

      const rendered = await generateDraft(template_id, enrichedContext, { strict: false });
      if (!rendered.ok) return res.status(422).json(rendered);

      const subject = rendered.draft?.subject || '';
      const bodyText = rendered.draft?.body || '';
      const report = enrichedContext.report_info;

      // Build absolute URL for PDF fetch. Vercel serverless runtime's fetch
      // requires an absolute URL, so we reconstruct from the request headers.
      // public_url in the DB is stored as '/reports/filename.pdf' (site-relative).
      function _absolutePdfUrl(pub) {
        if (!pub) return null;
        if (/^https?:\/\//i.test(pub)) return pub;
        const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
        const host  = req.headers['x-forwarded-host'] || req.headers.host;
        if (!host) return null;
        return `${proto}://${host}${pub.startsWith('/') ? '' : '/'}${pub}`;
      }

      // ---- Fetch attachment from public URL (if configured) ----
      let pdfBuffer = null;
      let attachmentName = null;
      let attachmentError = null;
      if (report?.public_url) {
        const absUrl = _absolutePdfUrl(report.public_url);
        try {
          const pdfRes = await fetch(absUrl);
          if (pdfRes.ok) {
            pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
            attachmentName = report.filename || 'capital-markets-update.pdf';
          } else {
            attachmentError = `Could not fetch PDF from ${absUrl} (${pdfRes.status})`;
          }
        } catch (e) {
          attachmentError = 'PDF fetch error: ' + e.message;
        }
      } else if (report) {
        attachmentError = 'No public_url configured for this report.';
      }

      // ---- Build Graph message payload (no attachments yet) ----
      const graphToken = process.env.MS_GRAPH_TOKEN;
      if (!graphToken) {
        return res.status(503).json({
          ok: false,
          error: 'MS_GRAPH_TOKEN not configured on Vercel — falling back to mailto',
          subject, body: bodyText, report_attachment: report,
          fallback: 'mailto'
        });
      }

      const recipients = Array.isArray(to) ? to : [to];
      const ccList = Array.isArray(cc) ? cc : (cc ? [cc] : []);

      const messagePayload = {
        subject,
        body: { contentType: 'HTML', content: _htmlizeDraftBody(bodyText) },
        toRecipients: recipients.map(addr => ({ emailAddress: { address: addr } })),
        ccRecipients: ccList.map(addr => ({ emailAddress: { address: addr } }))
      };

      // Inline attachments are capped by Graph at ~3MB. For larger files we
      // create the draft first, then attach via createUploadSession.
      const INLINE_LIMIT = 3 * 1024 * 1024;
      const canInline = pdfBuffer && pdfBuffer.length <= INLINE_LIMIT;
      if (canInline) {
        messagePayload.attachments = [{
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: attachmentName,
          contentType: 'application/pdf',
          contentBytes: pdfBuffer.toString('base64')
        }];
      }

      let draft;
      try {
        const graphRes = await fetch(`${GRAPH_API_URL}/me/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${graphToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(messagePayload)
        });

        if (!graphRes.ok) {
          const errText = await graphRes.text().catch(() => '');
          return res.status(502).json({
            ok: false,
            error: `Graph API error ${graphRes.status}`,
            detail: errText.slice(0, 500),
            subject, body: bodyText, report_attachment: report,
            fallback: 'mailto'
          });
        }

        draft = await graphRes.json();
      } catch (e) {
        return res.status(502).json({
          ok: false,
          error: 'Graph API fetch failed: ' + e.message,
          subject, body: bodyText, report_attachment: report,
          fallback: 'mailto'
        });
      }

      // ---- Upload-session attachment flow for files > 3MB ----
      let hasAttachment = canInline;
      if (pdfBuffer && !canInline) {
        try {
          const sessionRes = await fetch(
            `${GRAPH_API_URL}/me/messages/${draft.id}/attachments/createUploadSession`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${graphToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                AttachmentItem: {
                  attachmentType: 'file',
                  name: attachmentName,
                  size: pdfBuffer.length,
                  contentType: 'application/pdf'
                }
              })
            }
          );
          if (!sessionRes.ok) {
            const errText = await sessionRes.text().catch(() => '');
            attachmentError = `createUploadSession failed (${sessionRes.status}): ${errText.slice(0, 200)}`;
          } else {
            const { uploadUrl } = await sessionRes.json();
            // Upload in chunks (4 MB aligned to match Graph's requirements).
            const CHUNK = 4 * 1024 * 1024 - 1;
            let start = 0;
            const total = pdfBuffer.length;
            while (start < total) {
              const end = Math.min(start + CHUNK, total) - 1;
              const chunk = pdfBuffer.slice(start, end + 1);
              const putRes = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                  'Content-Length': String(chunk.length),
                  'Content-Range': `bytes ${start}-${end}/${total}`
                },
                body: chunk
              });
              if (!putRes.ok) {
                const errText = await putRes.text().catch(() => '');
                attachmentError = `upload chunk failed (${putRes.status}): ${errText.slice(0, 200)}`;
                break;
              }
              start = end + 1;
            }
            if (!attachmentError) hasAttachment = true;
          }
        } catch (e) {
          attachmentError = 'upload-session error: ' + e.message;
        }
      }

      return res.status(200).json({
        ok: true,
        draft_id: draft.id,
        web_link: draft.webLink,
        subject: draft.subject,
        body: bodyText,
        has_attachment: hasAttachment,
        attachment_error: attachmentError,
        report_attachment: report
      });
    }

    // POST ?action=batch — generate drafts for multiple contacts
    if (action === 'batch') {
      const { template_id, contacts, shared_context, strict } = req.body || {};
      if (!template_id) return res.status(400).json({ error: 'template_id is required' });
      if (!Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ error: 'contacts array is required and must not be empty' });
      }

      // Auto-enrich shared context with team variables
      const enrichedShared = await enrichDraftContext(shared_context || {});

      const result = await generateBatchDrafts(template_id, contacts, enrichedShared, { strict: !!strict });
      return res.status(200).json(result);
    }

    // POST ?action=record_send — record that a draft was sent
    if (action === 'record_send') {
      const { template_id, template_version, entity_id, domain,
              context_packet_id, rendered_subject, rendered_body,
              final_subject, final_body,
              original_draft, sent_text, duration_ms,
              cadence_id } = req.body || {};

      if (!template_id) return res.status(400).json({ error: 'template_id is required' });

      // Compute edit distance if both rendered and final versions provided
      let edit_distance_pct = null;
      if (rendered_body && final_body) {
        edit_distance_pct = computeEditDistance(rendered_body, final_body);
      }

      const result = await recordTemplateSend({
        template_id,
        template_version: template_version || 1,
        user_id: user.id,
        entity_id: entity_id || null,
        domain: domain || null,
        context_packet_id: context_packet_id || null,
        rendered_subject,
        rendered_body,
        final_subject: final_subject || rendered_subject,
        final_body: final_body || rendered_body,
        edit_distance_pct
      });

      // -------------------------------------------------------------------
      // Template voice diff capture — NEVER blocks the send response
      // Only runs when frontend sends both original_draft AND sent_text
      // -------------------------------------------------------------------
      try {
        const diffOriginal = original_draft || rendered_body;
        const diffSent = sent_text || final_body;

        if (diffOriginal && diffSent) {
          const charDelta = diffSent.length - diffOriginal.length;
          const wasEdited = diffSent !== diffOriginal && Math.abs(charDelta) > 10;

          // Paragraph-level diff: find first changed paragraph
          let firstChangedLine = -1;
          if (wasEdited) {
            const origParas = diffOriginal.split('\n\n');
            const sentParas = diffSent.split('\n\n');
            const minParas = Math.min(origParas.length, sentParas.length);
            for (let i = 0; i < minParas; i++) {
              if (origParas[i] !== sentParas[i]) { firstChangedLine = i; break; }
            }
            if (firstChangedLine === -1 && origParas.length !== sentParas.length) {
              firstChangedLine = minParas;
            }
          }

          const editSummary = wasEdited ? {
            original_length: diffOriginal.length,
            sent_length: diffSent.length,
            char_delta: charDelta,
            first_changed_line: firstChangedLine
          } : null;

          // Fire-and-forget: write to template_refinements (no await, no error propagation)
          opsQuery('POST', 'template_refinements', {
            workspace_id: workspaceId,
            template_id,
            original_draft: diffOriginal,
            sent_text: diffSent,
            was_edited: wasEdited,
            edit_summary: editSummary,
            entity_id: entity_id || null,
            domain: domain || null,
            created_at: new Date().toISOString()
          }).catch(err => console.error('[Template refinement write failed]', err?.message || err));

          // Fire-and-forget: write template_edited signal with diff data
          writeSignal({
            signal_type: 'template_edited',
            signal_category: 'communication',
            entity_type: 'contact',
            entity_id: entity_id || null,
            domain: domain || null,
            user_id: user.id,
            payload: {
              template_id,
              template_name: template_id,
              was_edited: wasEdited,
              edit_summary: editSummary,
              duration_ms: duration_ms || null
            }
          });
        }
      } catch (err) {
        // Voice diff capture must NEVER block the send response
        console.error('[Voice diff capture failed]', err?.message || err);
      }

      if (!result.ok) return res.status(500).json(result);

      // Advance cadence if cadence_id provided (non-blocking)
      let cadenceResult = null;
      if (cadence_id) {
        try {
          cadenceResult = await advanceCadence(cadence_id, {
            type: 'email',
            template_id,
            outcome: 'sent',
            // R24 Unit 1 — record_send already wrote a rich template_sends row
            // above (recordTemplateSend); tell the advance NOT to write a second
            // one. The two writers never both fire for one send.
            skip_template_send: true
          });
        } catch (err) {
          console.warn('[record_send] Cadence advance failed (non-blocking):', err.message);
        }
      }

      return res.status(201).json({
        ...result,
        cadence_advanced: cadenceResult?.ok || false,
        next_recommendation: cadenceResult?.recommendation || null
      });
    }

    // POST ?action=listing_bd — run listing-as-BD pipeline
    if (action === 'listing_bd') {
      const { listing_entity_id, exclude_entity_ids, limit: bdLimit } = req.body || {};
      if (!listing_entity_id) {
        return res.status(400).json({ error: 'listing_entity_id is required' });
      }

      // Fetch the listing entity
      const listingResult = await opsQuery('GET',
        `entities?id=eq.${pgFilterVal(listing_entity_id)}&workspace_id=eq.${workspaceId}&select=*`
      );
      if (!listingResult.ok || !listingResult.data?.length) {
        return res.status(404).json({ error: 'Listing entity not found' });
      }
      const listing = listingResult.data[0];

      if (!listing.state) {
        return res.status(422).json({ error: 'Listing entity must have a state to run BD matching' });
      }

      const pipelineResult = await runListingBdPipeline(listing, workspaceId, user.id, {
        excludeEntityIds: exclude_entity_ids || [],
        limit: bdLimit || 50
      });

      return res.status(200).json({
        ok: true,
        ...pipelineResult,
        message: `Queued ${pipelineResult.total_queued} listing-BD drafts for review`
      });
    }

    // POST ?action=performance — template performance analytics
    if (action === 'performance') {
      const { template_id, days, domain } = req.body || {};
      const lookbackDays = days || 90;
      const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

      // Build filter
      let filter = `sent_at=gte.${since}`;
      if (template_id) filter += `&template_id=eq.${pgFilterVal(template_id)}`;
      if (domain) filter += `&domain=eq.${pgFilterVal(domain)}`;

      const result = await opsQuery('GET',
        `template_sends?${filter}&select=template_id,template_version,edit_distance_pct,opened,replied,deal_advanced,sent_at,domain&order=sent_at.desc&limit=500`
      );

      if (!result.ok) {
        return res.status(500).json({ error: 'Failed to query template_sends', detail: result.data });
      }

      const sends = result.data || [];

      // Aggregate by template_id
      const byTemplate = {};
      for (const s of sends) {
        const tid = s.template_id;
        if (!byTemplate[tid]) {
          byTemplate[tid] = {
            template_id: tid,
            total_sends: 0,
            opened: 0,
            replied: 0,
            deal_advanced: 0,
            avg_edit_distance_pct: 0,
            edit_distances: [],
            first_send: s.sent_at,
            last_send: s.sent_at,
            domains: new Set()
          };
        }
        const t = byTemplate[tid];
        t.total_sends++;
        if (s.opened) t.opened++;
        if (s.replied) t.replied++;
        if (s.deal_advanced) t.deal_advanced++;
        if (s.edit_distance_pct != null) t.edit_distances.push(s.edit_distance_pct);
        if (s.sent_at < t.first_send) t.first_send = s.sent_at;
        if (s.sent_at > t.last_send) t.last_send = s.sent_at;
        if (s.domain) t.domains.add(s.domain);
      }

      // Compute final metrics
      const templates = Object.values(byTemplate).map(t => {
        const avgEdit = t.edit_distances.length > 0
          ? Math.round(t.edit_distances.reduce((a, b) => a + b, 0) / t.edit_distances.length * 10) / 10
          : null;
        return {
          template_id: t.template_id,
          total_sends: t.total_sends,
          opened: t.opened,
          replied: t.replied,
          deal_advanced: t.deal_advanced,
          open_rate_pct: t.total_sends > 0 ? Math.round(t.opened / t.total_sends * 1000) / 10 : 0,
          reply_rate_pct: t.total_sends > 0 ? Math.round(t.replied / t.total_sends * 1000) / 10 : 0,
          deal_advance_rate_pct: t.total_sends > 0 ? Math.round(t.deal_advanced / t.total_sends * 1000) / 10 : 0,
          avg_edit_distance_pct: avgEdit,
          edit_sample_size: t.edit_distances.length,
          first_send: t.first_send,
          last_send: t.last_send,
          domains: [...t.domains]
        };
      }).sort((a, b) => b.total_sends - a.total_sends);

      return res.status(200).json({
        ok: true,
        lookback_days: lookbackDays,
        total_sends: sends.length,
        templates,
        _insight: templates.length > 0
          ? `${templates[0].template_id} is the most-used template (${templates[0].total_sends} sends). ${templates.filter(t => t.avg_edit_distance_pct != null && t.avg_edit_distance_pct > 40).map(t => t.template_id).join(', ') || 'No templates'} have high edit rates (>40%), suggesting the template may need revision.`
          : 'No sends recorded in this period.'
      });
    }

    // POST ?action=health — template voice refinement health check
    if (action === 'health') {
      const { template_id, lookback_days } = req.body || {};
      const healthReport = await evaluateTemplateHealth({
        template_id,
        lookback_days: lookback_days || 120
      });

      // Auto-flag templates that need revision
      const needsRevision = healthReport.evaluations?.filter(e => e.status === 'needs_revision') || [];
      for (const t of needsRevision) {
        await flagTemplateForRevision(
          t.template_id,
          t.issues.join('; '),
          user.id
        );
      }

      // For each flagged template, generate a revision suggestion
      const revisionSuggestions = [];
      for (const t of needsRevision) {
        const suggestion = await generateRevisionSuggestion(t.template_id);
        if (suggestion.ok && suggestion.analysis) {
          revisionSuggestions.push(suggestion);
        }
      }

      return res.status(200).json({
        ...healthReport,
        revisions_flagged: needsRevision.length,
        revision_suggestions: revisionSuggestions
      });
    }

    // POST ?action=health-rollup — R2-L-1 (2026-05-19): weekly cron entry point.
    // Same evaluateTemplateHealth() + flag-and-suggest pass as ?action=health,
    // PLUS persists a row to template_health_history so trend analysis has a
    // time-series. Idempotent at the row level (each call inserts one row;
    // the weekly cron cadence is naturally non-duplicate).
    if (action === 'health-rollup') {
      const startedAt = Date.now();
      const { template_id, lookback_days } = req.body || {};
      const persistFlag = req.body?.persist !== false;  // default true

      const healthReport = await evaluateTemplateHealth({
        template_id,
        lookback_days: lookback_days || 120
      });

      // Same auto-flag side effect as ?action=health
      const needsRevision = healthReport.evaluations?.filter(e => e.status === 'needs_revision') || [];
      for (const t of needsRevision) {
        await flagTemplateForRevision(
          t.template_id,
          t.issues.join('; '),
          user.id
        );
      }

      const revisionSuggestions = [];
      for (const t of needsRevision) {
        const suggestion = await generateRevisionSuggestion(t.template_id);
        if (suggestion.ok && suggestion.analysis) {
          revisionSuggestions.push(suggestion);
        }
      }

      // Persist the rollup if requested (cron always sets persist=true).
      let historyId = null;
      if (persistFlag) {
        try {
          const totalSends = (healthReport.evaluations || [])
            .reduce((sum, e) => sum + (e.total_sends || 0), 0);
          const staleCount = (healthReport.evaluations || [])
            .filter(e => e.status === 'stale').length;
          const ins = await opsQuery('POST', 'template_health_history', {
            lookback_days: lookback_days || 120,
            template_count: (healthReport.evaluations || []).length,
            evaluated_count: (healthReport.evaluations || []).filter(e => e.total_sends > 0).length,
            needs_revision_count: needsRevision.length,
            stale_count: staleCount,
            total_sends: totalSends,
            evaluations: healthReport.evaluations || [],
            revisions_flagged: needsRevision.length,
            revision_suggestions: revisionSuggestions.length,
            run_source: 'lcc-template-health-rollup',
            run_duration_ms: Date.now() - startedAt,
            notes: needsRevision.length > 0
              ? `Auto-flagged ${needsRevision.length} templates for revision (avg-edit-distance > 40%).`
              : null
          });
          if (ins.ok && ins.data?.length) historyId = ins.data[0].id;
        } catch (err) {
          // Non-fatal — the cron may have observed-but-not-persisted; the
          // report still gets returned. Log so the cron health-check sees it.
          console.warn('[operations] template_health_history insert failed (non-fatal):', err?.message);
        }
      }

      return res.status(200).json({
        ...healthReport,
        revisions_flagged: needsRevision.length,
        revision_suggestions: revisionSuggestions,
        persisted: persistFlag,
        history_id: historyId
      });
    }

    // POST ?action=cadence — get cadence state + recommendation for a contact
    if (action === 'cadence') {
      const { entity_id, sf_contact_id, contact_id, property_id, property_address, domain } = req.body || {};
      if (!entity_id && !sf_contact_id && !contact_id) {
        return res.status(400).json({ error: 'At least one contact identifier required (entity_id, sf_contact_id, or contact_id)' });
      }

      const result = await getCadenceForDraft(
        { entity_id, sf_contact_id, contact_id },
        { property_id, property_address, domain }
      );

      if (!result.ok) {
        return res.status(500).json(result);
      }

      return res.status(200).json(result);
    }

    // POST ?action=advance_cadence — manually advance cadence (e.g., after phone call)
    if (action === 'advance_cadence') {
      const { cadence_id, sf_contact_id, entity_id, contact_id,
              type, template_id, outcome, opened } = req.body || {};

      // Resolve cadence_id from contact identifiers if not provided
      let resolvedCadenceId = cadence_id;
      if (!resolvedCadenceId && (sf_contact_id || entity_id || contact_id)) {
        try {
          const ids = {};
          if (sf_contact_id) ids.sf_contact_id = sf_contact_id;
          if (entity_id) ids.entity_id = entity_id;
          if (contact_id) ids.contact_id = contact_id;
          const stateResult = await getCadenceState(ids);
          if (stateResult.ok && stateResult.cadence?.id) {
            resolvedCadenceId = stateResult.cadence.id;
          }
        } catch (err) {
          console.warn('[advance_cadence] Cadence lookup by contact failed:', err.message);
        }
      }

      if (!resolvedCadenceId) {
        return res.status(400).json({ error: 'cadence_id is required (or provide sf_contact_id/entity_id to auto-resolve)' });
      }

      const result = await advanceCadence(resolvedCadenceId, { type, template_id, outcome, opened });
      if (!result.ok) {
        return res.status(500).json(result);
      }
      return res.status(200).json(result);
    }

    // POST ?action=smart_reschedule — compute optimal next date for task rescheduling
    // Default: 90 days out (quarterly cadence), overridden by:
    //   - Lease expiration within 12 months → 30-60 days before expiry
    //   - Debt maturity approaching → 60-90 days before maturity
    //   - New award/event detected → 7-14 days
    //   - Active prospecting sequence → next touch due date from cadence engine
    if (action === 'smart_reschedule') {
      const { sf_contact_id, entity_id, contact_id, property_id, domain } = req.body || {};

      const now = new Date();
      const DEFAULT_DAYS = 90; // quarterly default
      let nextDate = new Date(now.getTime() + DEFAULT_DAYS * 24 * 60 * 60 * 1000);
      let reason = 'Quarterly cadence (90 days)';
      const overrides = [];

      // 1. Check cadence state — if in prospecting, use cadence engine timing
      try {
        const ids = {};
        if (entity_id) ids.entity_id = entity_id;
        if (sf_contact_id) ids.sf_contact_id = sf_contact_id;
        if (contact_id) ids.contact_id = contact_id;

        if (Object.keys(ids).length > 0) {
          const cadenceResult = await getCadenceForDraft(ids, { property_id, domain });
          if (cadenceResult.ok && cadenceResult.recommendation) {
            const rec = cadenceResult.recommendation;

            // If in prospecting sequence, use the cadence-computed due date
            if (rec.due_at && cadenceResult.cadence?.phase === 'prospecting') {
              const cadenceDue = new Date(rec.due_at);
              if (cadenceDue > now) {
                nextDate = cadenceDue;
                reason = `Cadence: ${rec.label} (touch ${rec.touch_number}/7)`;
                overrides.push({ source: 'cadence_engine', date: cadenceDue.toISOString().split('T')[0], reason });
              }
            }

            // Escalation overrides from cadence flags
            if (cadenceResult.cadence?.new_award_flag) {
              const awardDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
              nextDate = awardDate;
              reason = 'New lease award detected — follow up in 7 days';
              overrides.push({ source: 'new_award', date: awardDate.toISOString().split('T')[0], reason });
            }
          }
        }
      } catch (err) {
        console.warn('[smart_reschedule] Cadence lookup failed (non-blocking):', err.message);
      }

      // 2. Check property-level signals (lease expiration, debt maturity)
      try {
        if (sf_contact_id || entity_id) {
          // Look for property context with lease/debt dates
          const contactFilter = sf_contact_id
            ? `sf_contact_id=eq.${pgFilterVal(sf_contact_id)}`
            : `entity_id=eq.${pgFilterVal(entity_id)}`;

          // Check cadence record for lease_expiry_date
          const cadenceCheck = await opsQuery('GET',
            `touchpoint_cadence?${contactFilter}&select=lease_expiry_flag,lease_expiry_date,market_shift_flag&limit=1`
          );

          if (cadenceCheck.ok && cadenceCheck.data?.[0]) {
            const tc = cadenceCheck.data[0];

            // Lease expiration: reschedule to 60 days before expiry
            if (tc.lease_expiry_flag && tc.lease_expiry_date) {
              const expiryDate = new Date(tc.lease_expiry_date);
              const preExpiryDate = new Date(expiryDate.getTime() - 60 * 24 * 60 * 60 * 1000);
              if (preExpiryDate > now && preExpiryDate < nextDate) {
                nextDate = preExpiryDate;
                reason = `Lease expiration ${tc.lease_expiry_date} — follow up 60 days prior`;
                overrides.push({ source: 'lease_expiry', date: preExpiryDate.toISOString().split('T')[0], reason, lease_expiry_date: tc.lease_expiry_date });
              }
            }

            // Market shift: accelerate to 30 days
            if (tc.market_shift_flag) {
              const shiftDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
              if (shiftDate < nextDate) {
                nextDate = shiftDate;
                reason = 'Market shift detected — accelerated follow-up (30 days)';
                overrides.push({ source: 'market_shift', date: shiftDate.toISOString().split('T')[0], reason });
              }
            }
          }
        }
      } catch (err) {
        console.warn('[smart_reschedule] Property signal check failed (non-blocking):', err.message);
      }

      return res.status(200).json({
        ok: true,
        next_date: nextDate.toISOString().split('T')[0],
        reason,
        overrides,
        default_days: DEFAULT_DAYS
      });
    }

    return res.status(400).json({
      error: 'Invalid draft action. Use: generate, batch, record_send, cadence, advance_cadence, smart_reschedule, listing_bd, performance, health'
    });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

// ============================================================================
// AI COPILOT CHAT — /api/chat → operations?_route=chat
// ============================================================================

async function handleChatRoute(req, res) {
  // --- OpenAPI spec / plugin manifest (GET, no auth required) ---
  if (req.query?.copilot_spec) {
    const proto = req.headers?.['x-forwarded-proto'] || 'https';
    // Prefer the actual incoming host header (always correct for the real
    // request path); only fall back to env var when host is missing (rare).
    // Strip any leading scheme from LCC_BASE_URL since we concatenate proto below.
    const fallbackHost = (process.env.LCC_BASE_URL || 'tranquil-delight-production-633f.up.railway.app')
      .replace(/^https?:\/\//, '');
    const host = req.headers?.host || fallbackHost;
    const baseUrl = `${proto}://${host}`;

    if (req.query.copilot_spec === 'manifest') {
      return res.status(200).json(generatePluginManifest(baseUrl));
    }
    // Swagger 2.0 variant — required for Power Platform custom-connector
    // "Update from OpenAPI URL/file" (the 3.0 doc fails to parse there).
    if (req.query.copilot_spec === 'swagger2' || req.query.format === 'swagger2') {
      return res.status(200).json(generateSwagger2Spec(ACTION_REGISTRY, baseUrl));
    }
    const spec = generateOpenApiSpec(ACTION_REGISTRY, baseUrl);
    return res.status(200).json(spec);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships?.[0]?.workspace_id || '';

  const { message, context, history, attachments } = req.body || {};

  // --- Follow-up signal ---
  // Copilot/frontend reports back which results the user acted on after
  // receiving a copilot_action response. This feeds the learning loop.
  if (req.body?.copilot_followup) {
    const { original_action, entity_ids_acted_on, items_ignored_count,
            session_id: fSessionId, surface: fSurface } = req.body.copilot_followup;

    writeSignal({
      signal_type: 'copilot_result_acted_on',
      signal_category: 'intelligence',
      user_id: user.id,
      payload: {
        original_action: original_action || null,
        entity_ids_acted_on: entity_ids_acted_on || [],
        acted_on_count: (entity_ids_acted_on || []).length,
        items_ignored_count: items_ignored_count ?? null,
        session_id: fSessionId || null,
        surface: fSurface || 'copilot_chat'
      },
      outcome: (entity_ids_acted_on || []).length > 0 ? 'positive' : 'neutral'
    });

    return res.status(200).json({ ok: true, signal: 'copilot_result_acted_on' });
  }

  // --- Copilot path-based action injection ---
  // When Copilot calls /api/copilot/portfolio/get-daily-briefing-snapshot,
  // vercel.json rewrites it to ?_route=chat&_copilot_path=get-daily-briefing-snapshot.
  // Inject the action into the body so the dispatch logic picks it up.
  if (req.query._copilot_path && !req.body?.copilot_action) {
    const actionId = req.query._copilot_path.replace(/-/g, '_');
    req.body = req.body || {};
    req.body.copilot_action = actionId;
    req.body.params = req.body.params || req.body || {};
    req.body.surface = 'copilot_plugin';
  }

  // --- Structured action dispatch ---
  // If the request includes an action field, dispatch it directly instead of
  // routing through the LLM. This is the programmatic entry point for Copilot
  // agents, Teams cards, and Power Automate flows.
  if (req.body?.copilot_action) {
    const { copilot_action, params, surface, session_id: copilotSessionId } = req.body;
    const startMs = Date.now();
    const result = await dispatchAction(copilot_action, params || {}, user, workspaceId, req);
    const durationMs = Date.now() - startMs;

    // Resolve surface (which Microsoft entry point is calling)
    const resolvedSurface = surface || 'copilot_chat';

    // Log activity for all non-confirmation dispatches. Awaited — see
    // doc-assembly note above. Same Vercel-freeze concern.
    if (workspaceId && !result.requires_confirmation) {
      await opsQuery('POST', 'activity_events', {
        workspace_id: workspaceId,
        user_id: user?.id,
        event_type: 'copilot_action',
        category: 'system',
        source: 'copilot',
        title: `Copilot action: ${copilot_action}`,
        metadata: {
          action: copilot_action,
          ok: result.ok !== false,
          duration_ms: durationMs,
          tier: ACTION_REGISTRY[copilot_action]?.tier,
          provider: result.provider || null,
          surface: resolvedSurface,
          session_id: copilotSessionId || null
        }
      }).catch(err => console.warn('[copilot-action] activity_events write failed:', err?.message || err));
    }

    // Write copilot invocation signal for the learning loop
    writeCopilotSignal({
      action: copilot_action,
      tier: ACTION_REGISTRY[copilot_action]?.tier,
      surface: resolvedSurface,
      duration_ms: durationMs,
      ok: result.ok !== false,
      requires_confirmation: !!result.requires_confirmation,
      result_count: result.data?.count || result.data?.items?.length || null,
      session_id: copilotSessionId || null
    }, user);

    // Format response based on surface
    const response = {
      ...result,
      source: 'copilot_action_dispatch',
      _surface: resolvedSurface
    };

    // Surface-specific formatting
    if (resolvedSurface === 'teams' && result.ok && !result.requires_confirmation) {
      response._teams_card = formatForTeams(copilot_action, result);
    }
    if (resolvedSurface === 'outlook' && result.ok) {
      response._digest = formatForOutlookDigest(copilot_action, result);
    }

    return res.status(result.ok === false && result.requires_confirmation ? 200 : (result.ok ? 200 : 400)).json(response);
  }

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  // --- Enrich context with portfolio stats + operational signals ---
  let portfolioStats = {};
  let opsContext = {};
  try {
    [portfolioStats, opsContext] = await Promise.all([
      fetchPortfolioStats(),
      fetchOpsContext(workspaceId, user.id)
    ]);
  } catch {
    // Non-fatal
  }

  const enrichedContext = {
    ...(context || {}),
    ...portfolioStats,
    ...opsContext,
  };

  const result = await invokeChatProvider({
    message,
    context: enrichedContext,
    history: Array.isArray(history) ? history : [],
    attachments: Array.isArray(attachments) ? attachments : [],
    user,
    workspaceId
  });

  if (!result.ok) {
    return res.status(result.status || 502).json({
      error: result.data?.error || 'AI provider request failed',
      provider: result.provider,
      details: result.data?.details
    });
  }

  return res.status(200).json({
    response: result.data?.response || result.data?.content?.[0]?.text || '',
    usage: result.data?.usage || null,
    provider: result.provider
  });
}

// ============================================================================
// WORKFLOW: PROMOTE TO SHARED — private inbox → shared team action
// ============================================================================

async function promoteToShared(req, res, user, workspaceId) {
  const { inbox_item_id, title, action_type, priority, assigned_to, due_date, entity_id, description } = req.body || {};

  if (!inbox_item_id) return res.status(400).json({ error: 'inbox_item_id is required' });

  const inbox = await fetchOne('inbox_items', inbox_item_id, workspaceId);
  if (!inbox) return res.status(404).json({ error: 'Inbox item not found' });

  if (inbox.status === 'promoted') {
    return res.status(400).json({ error: 'Already promoted' });
  }
  if (!canTransitionInbox(inbox.status, 'promoted') && inbox.status !== 'new') {
    if (!canTransitionInbox(inbox.status, 'triaged')) {
      return res.status(400).json({ error: `Cannot promote from status "${inbox.status}"` });
    }
  }

  const action = await opsQuery('POST', 'action_items', {
    workspace_id: workspaceId, created_by: user.id, owner_id: user.id,
    assigned_to: assigned_to || user.id,
    title: title || inbox.title, description: description || inbox.body,
    action_type: isValidEnum(action_type, ACTION_TYPES) ? action_type : 'follow_up',
    status: 'open',
    priority: isValidEnum(priority, PRIORITIES) ? priority : inbox.priority || 'normal',
    due_date: due_date || null, visibility: 'shared',
    entity_id: entity_id || inbox.entity_id, inbox_item_id: inbox_item_id,
    domain: inbox.domain, source_type: 'inbox_promotion',
    source_connector_id: inbox.source_connector_id,
    external_id: inbox.external_id, external_url: inbox.external_url
  });

  if (!action.ok) return res.status(500).json({ error: 'Failed to create action' });
  const createdAction = unwrap(action);

  if (inbox.status === 'new') {
    await opsQuery('PATCH', `inbox_items?id=eq.${pgFilterVal(inbox_item_id)}`, {
      status: 'promoted', triaged_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
  } else {
    await opsQuery('PATCH', `inbox_items?id=eq.${pgFilterVal(inbox_item_id)}`, {
      status: 'promoted', updated_at: new Date().toISOString()
    });
  }

  await opsQuery('POST', 'watchers', {
    workspace_id: workspaceId, user_id: user.id,
    action_item_id: createdAction.id, reason: 'creator'
  }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

  if (assigned_to && assigned_to !== user.id) {
    await opsQuery('POST', 'watchers', {
      workspace_id: workspaceId, user_id: assigned_to,
      action_item_id: createdAction.id, reason: 'assigned'
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  await logWorkflowActivity(user, workspaceId, {
    category: 'status_change',
    title: `Promoted "${inbox.title}" from private inbox to shared action`,
    entity_id: entity_id || inbox.entity_id,
    action_item_id: createdAction.id,
    inbox_item_id: inbox_item_id, domain: inbox.domain
  });

  return res.status(201).json({ action: createdAction, inbox_status: 'promoted', workflow: 'promote_to_shared' });
}

// ============================================================================
// WORKFLOW: SF TASK → SHARED ACTION
// ============================================================================

async function sfTaskToAction(req, res, user, workspaceId) {
  const { inbox_item_id, entity_id, action_type, priority, assigned_to, due_date } = req.body || {};

  if (!inbox_item_id) return res.status(400).json({ error: 'inbox_item_id is required' });
  if (!entity_id) return res.status(400).json({ error: 'entity_id is required — link SF task to a canonical entity' });

  const inbox = await fetchOne('inbox_items', inbox_item_id, workspaceId);
  if (!inbox) return res.status(404).json({ error: 'Inbox item not found' });
  if (inbox.source_type !== 'sf_task') {
    return res.status(400).json({ error: 'This workflow is for SF task inbox items only' });
  }

  const entity = await fetchOne('entities', entity_id, workspaceId);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  const action = await opsQuery('POST', 'action_items', {
    workspace_id: workspaceId, created_by: user.id, owner_id: user.id,
    assigned_to: assigned_to || user.id,
    title: inbox.title, description: inbox.body,
    action_type: isValidEnum(action_type, ACTION_TYPES) ? action_type : 'follow_up',
    status: 'open',
    priority: isValidEnum(priority, PRIORITIES) ? priority : inbox.priority || 'normal',
    due_date: due_date || inbox.metadata?.activity_date || null,
    visibility: 'shared', entity_id, inbox_item_id,
    domain: inbox.domain, source_type: 'sf_sync',
    source_connector_id: inbox.source_connector_id,
    external_id: inbox.external_id, external_url: inbox.external_url
  });

  if (!action.ok) return res.status(500).json({ error: 'Failed to create action' });
  const createdAction = unwrap(action);

  if (inbox.external_id) {
    await opsQuery('POST', 'external_identities', {
      workspace_id: workspaceId, entity_id,
      source_system: 'salesforce', source_type: 'task',
      external_id: inbox.external_id, external_url: inbox.external_url,
      last_synced_at: new Date().toISOString()
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  await opsQuery('PATCH', `inbox_items?id=eq.${pgFilterVal(inbox_item_id)}`, {
    status: 'promoted', entity_id, updated_at: new Date().toISOString()
  });

  await opsQuery('POST', 'watchers', {
    workspace_id: workspaceId, user_id: user.id,
    action_item_id: createdAction.id, reason: 'creator'
  }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

  await logWorkflowActivity(user, workspaceId, {
    category: 'status_change',
    title: `Linked SF task "${inbox.title}" to ${entity.name} and created action`,
    entity_id, action_item_id: createdAction.id, inbox_item_id,
    domain: inbox.domain
  });

  return res.status(201).json({ action: createdAction, entity: entity.name, workflow: 'sf_task_to_action' });
}

// ============================================================================
// WORKFLOW: RESEARCH → FOLLOW-UP
// ============================================================================

async function researchFollowup(req, res, user, workspaceId) {
  const { research_task_id, outcome, followup_title, followup_description, followup_type, followup_priority,
          assigned_to, due_date, entity_id } = req.body || {};

  if (!research_task_id) return res.status(400).json({ error: 'research_task_id is required' });

  const research = await fetchOne('research_tasks', research_task_id, workspaceId);
  if (!research) return res.status(404).json({ error: 'Research task not found' });

  const closure = await closeResearchLoop({
    workspaceId, user, researchTaskId: research_task_id,
    sourceRecordId: research.source_record_id || null,
    sourceTable: research.source_table || null,
    researchType: research.research_type, domain: research.domain,
    entityId: entity_id || research.entity_id,
    title: research.title, instructions: research.instructions,
    outcome: outcome || { status: 'completed' },
    followupTitle: followup_title, followupDescription: followup_description,
    followupType: isValidEnum(followup_type, ACTION_TYPES) ? followup_type : 'follow_up',
    followupPriority: isValidEnum(followup_priority, PRIORITIES) ? followup_priority : 'normal',
    followupAssignee: assigned_to || user.id,
    followupDue: due_date || null,
    activityMetadata: { workflow: 'research_followup' },
    researchMetadata: { workflow: 'research_followup' }
  });
  if (!closure.ok) {
    return res.status(closure.status || 500).json({ error: closure.error, detail: closure.detail });
  }

  if (closure.followupAction) {
    await opsQuery('POST', 'watchers', {
      workspace_id: workspaceId, user_id: user.id,
      action_item_id: closure.followupAction.id, reason: 'creator'
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  return res.status(200).json({
    research_status: closure.researchTask?.status || 'completed',
    action: closure.followupAction, research_task: closure.researchTask,
    workflow: 'research_followup'
  });
}

// ============================================================================
// WORKFLOW: REASSIGN
// ============================================================================

async function reassignItem(req, res, user, workspaceId) {
  const { item_type, item_id, assigned_to, reason } = req.body || {};

  if (!item_type || !item_id || !assigned_to) {
    return res.status(400).json({ error: 'item_type, item_id, and assigned_to are required' });
  }

  const targetMember = await opsQuery('GET',
    `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${pgFilterVal(assigned_to)}&select=user_id,role`
  );
  if (!targetMember.ok || !targetMember.data?.length) {
    return res.status(400).json({ error: 'Target user is not a workspace member' });
  }

  const table = item_type === 'action' ? 'action_items'
    : item_type === 'inbox' ? 'inbox_items'
    : item_type === 'research' ? 'research_tasks'
    : null;

  if (!table) return res.status(400).json({ error: 'item_type must be: action, inbox, or research' });

  const existing = await fetchOne(table, item_id, workspaceId);
  if (!existing) return res.status(404).json({ error: 'Item not found' });

  const previousAssignee = existing.assigned_to;

  await opsQuery('PATCH', `${table}?id=eq.${pgFilterVal(item_id)}&workspace_id=eq.${workspaceId}`, {
    assigned_to, updated_at: new Date().toISOString()
  });

  if (item_type === 'action') {
    await opsQuery('POST', 'watchers', {
      workspace_id: workspaceId, user_id: assigned_to,
      action_item_id: item_id, reason: 'assigned'
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  const [fromUser, toUser] = await Promise.all([
    previousAssignee ? fetchUserName(previousAssignee) : Promise.resolve('unassigned'),
    fetchUserName(assigned_to)
  ]);

  await logWorkflowActivity(user, workspaceId, {
    category: 'assignment',
    title: `Reassigned "${existing.title}" from ${fromUser} to ${toUser}${reason ? ': ' + reason : ''}`,
    entity_id: existing.entity_id,
    action_item_id: item_type === 'action' ? item_id : null,
    inbox_item_id: item_type === 'inbox' ? item_id : null,
    domain: existing.domain
  });

  return res.status(200).json({ item_id, assigned_to, previous: previousAssignee, workflow: 'reassign' });
}

// ============================================================================
// WORKFLOW: ESCALATE
// ============================================================================

async function escalateItem(req, res, user, workspaceId) {
  const { action_item_id, escalate_to, reason } = req.body || {};

  if (!action_item_id || !escalate_to || !reason) {
    return res.status(400).json({ error: 'action_item_id, escalate_to, and reason are required' });
  }

  const action = await fetchOne('action_items', action_item_id, workspaceId);
  if (!action) return res.status(404).json({ error: 'Action item not found' });

  const targetRole = requireRole({ memberships: [{ workspace_id: workspaceId }] }, 'viewer', workspaceId);
  const targetMember = await opsQuery('GET',
    `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${pgFilterVal(escalate_to)}&select=role`
  );
  if (!targetMember.ok || !targetMember.data?.length) {
    return res.status(400).json({ error: 'Escalation target is not a workspace member' });
  }

  await opsQuery('POST', 'escalations', {
    workspace_id: workspaceId, action_item_id,
    escalated_by: user.id, escalated_to: escalate_to,
    previous_assignee: action.assigned_to, reason
  });

  await opsQuery('PATCH', `action_items?id=eq.${pgFilterVal(action_item_id)}`, {
    assigned_to: escalate_to,
    priority: action.priority === 'normal' ? 'high' : action.priority,
    updated_at: new Date().toISOString()
  });

  for (const uid of [user.id, escalate_to]) {
    await opsQuery('POST', 'watchers', {
      workspace_id: workspaceId, user_id: uid,
      action_item_id, reason: uid === user.id ? 'escalation' : 'assigned'
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  const toName = await fetchUserName(escalate_to);
  await logWorkflowActivity(user, workspaceId, {
    category: 'assignment',
    title: `Escalated "${action.title}" to ${toName}: ${reason}`,
    entity_id: action.entity_id, action_item_id, domain: action.domain
  });

  return res.status(200).json({ action_item_id, escalated_to: escalate_to, reason, workflow: 'escalate' });
}

// ============================================================================
// WORKFLOW: WATCH / UNWATCH
// ============================================================================

async function addWatch(req, res, user, workspaceId) {
  const { item_type, item_id, target_user_id } = req.body || {};
  if (!item_type || !item_id) return res.status(400).json({ error: 'item_type and item_id required' });

  const userId = target_user_id || user.id;
  const column = item_type === 'action' ? 'action_item_id'
    : item_type === 'entity' ? 'entity_id'
    : item_type === 'inbox' ? 'inbox_item_id'
    : null;
  if (!column) return res.status(400).json({ error: 'item_type must be: action, entity, or inbox' });

  const result = await opsQuery('POST', 'watchers', {
    workspace_id: workspaceId, user_id: userId, [column]: item_id, reason: 'manual'
  }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

  if (!result.ok) return res.status(result.status).json({ error: 'Failed to add watch' });
  return res.status(201).json({ watching: true, item_type, item_id });
}

async function removeWatch(req, res, user, workspaceId) {
  const { item_type, item_id } = req.body || {};
  if (!item_type || !item_id) return res.status(400).json({ error: 'item_type and item_id required' });

  const column = item_type === 'action' ? 'action_item_id'
    : item_type === 'entity' ? 'entity_id'
    : item_type === 'inbox' ? 'inbox_item_id'
    : null;
  if (!column) return res.status(400).json({ error: 'item_type must be: action, entity, or inbox' });

  await opsQuery('DELETE',
    `watchers?workspace_id=eq.${workspaceId}&user_id=eq.${user.id}&${column}=eq.${pgFilterVal(item_id)}`
  );
  return res.status(200).json({ watching: false, item_type, item_id });
}

// ============================================================================
// WORKFLOW: BULK ASSIGN
// ============================================================================

async function bulkAssign(req, res, user, workspaceId) {
  const { items, assigned_to } = req.body || {};
  if (!items?.length || !assigned_to) return res.status(400).json({ error: 'items array and assigned_to required' });

  if (!requireRole(user, 'manager', workspaceId)) {
    return res.status(403).json({ error: 'Manager role required for bulk assignment' });
  }

  const results = [];
  for (const { item_type, item_id } of items) {
    const table = item_type === 'action' ? 'action_items'
      : item_type === 'inbox' ? 'inbox_items'
      : item_type === 'research' ? 'research_tasks'
      : null;
    if (!table) { results.push({ item_id, error: 'invalid type' }); continue; }

    const r = await opsQuery('PATCH', `${table}?id=eq.${pgFilterVal(item_id)}&workspace_id=eq.${workspaceId}`, {
      assigned_to, updated_at: new Date().toISOString()
    });
    results.push({ item_id, item_type, success: r.ok });
  }

  const assigneeName = await fetchUserName(assigned_to);
  await logWorkflowActivity(user, workspaceId, {
    category: 'assignment',
    title: `Bulk assigned ${items.length} items to ${assigneeName}`
  });

  return res.status(200).json({ assigned_to, count: items.length, results, workflow: 'bulk_assign' });
}

// ============================================================================
// WORKFLOW: BULK TRIAGE
// ============================================================================

async function bulkTriage(req, res, user, workspaceId) {
  const { item_ids, status, priority, assigned_to } = req.body || {};
  if (!item_ids?.length) return res.status(400).json({ error: 'item_ids array required' });

  const targetStatus = status || 'triaged';
  const results = [];

  for (const id of item_ids) {
    const updates = { updated_at: new Date().toISOString() };
    if (targetStatus) updates.status = targetStatus;
    if (targetStatus === 'triaged') updates.triaged_at = new Date().toISOString();
    if (priority) updates.priority = priority;
    if (assigned_to) updates.assigned_to = assigned_to;

    const r = await opsQuery('PATCH', `inbox_items?id=eq.${pgFilterVal(id)}&workspace_id=eq.${workspaceId}`, updates);
    results.push({ id, success: r.ok });
  }

  await logWorkflowActivity(user, workspaceId, {
    category: 'status_change',
    title: `Bulk triaged ${item_ids.length} inbox items → ${targetStatus}`
  });

  return res.status(200).json({ count: item_ids.length, status: targetStatus, results, workflow: 'bulk_triage' });
}

// ============================================================================
// GET: MANAGER OVERSIGHT
// ============================================================================

async function getOversight(req, res, user, workspaceId) {
  if (!requireRole(user, 'manager', workspaceId)) {
    return res.status(403).json({ error: 'Manager role required for team oversight' });
  }

  const overview = await opsQuery('GET', `v_manager_overview?workspace_id=eq.${workspaceId}&order=display_name`);
  const unassigned = await opsQuery('GET', `v_unassigned_work?workspace_id=eq.${workspaceId}&limit=50&order=created_at.desc`);
  const escalations = await opsQuery('GET',
    `escalations?workspace_id=eq.${workspaceId}&resolved_at=is.null&select=*,action_items(title,status,priority),users!escalations_escalated_by_fkey(display_name),users!escalations_escalated_to_fkey(display_name)&order=created_at.desc&limit=25`
  );

  return res.status(200).json({
    team: overview.data || [],
    unassigned_work: unassigned.data || [],
    open_escalations: escalations.data || [],
    workspace_id: workspaceId, view: 'oversight'
  });
}

// ============================================================================
// GET: UNASSIGNED WORK
// ============================================================================

async function getUnassigned(req, res, user, workspaceId) {
  const { domain } = req.query;
  let path = `v_unassigned_work?workspace_id=eq.${workspaceId}&order=created_at.desc&limit=100`;
  if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;

  const result = await opsQuery('GET', path);
  return res.status(200).json({ items: result.data || [], count: result.count, view: 'unassigned' });
}

// ============================================================================
// GET: WATCHERS for an item
// ============================================================================

async function getWatchers(req, res, user, workspaceId) {
  const { item_type, item_id } = req.query;
  if (!item_type || !item_id) return res.status(400).json({ error: 'item_type and item_id required' });

  const column = item_type === 'action' ? 'action_item_id'
    : item_type === 'entity' ? 'entity_id'
    : item_type === 'inbox' ? 'inbox_item_id'
    : null;
  if (!column) return res.status(400).json({ error: 'item_type must be: action, entity, or inbox' });

  const result = await opsQuery('GET',
    `watchers?workspace_id=eq.${workspaceId}&${column}=eq.${pgFilterVal(item_id)}&select=*,users(display_name,email,avatar_url)&order=created_at`
  );
  return res.status(200).json({ watchers: result.data || [] });
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

async function fetchOne(table, id, workspaceId) {
  const result = await opsQuery('GET', `${table}?id=eq.${pgFilterVal(id)}&workspace_id=eq.${workspaceId}&select=*&limit=1`);
  return result.ok && result.data?.length > 0 ? result.data[0] : null;
}

function unwrap(result) {
  return Array.isArray(result.data) ? result.data[0] : result.data;
}

async function fetchUserName(userId) {
  const result = await opsQuery('GET', `users?id=eq.${pgFilterVal(userId)}&select=display_name&limit=1`);
  return result.ok && result.data?.length > 0 ? result.data[0].display_name : 'Unknown';
}

async function logWorkflowActivity(user, workspaceId, { category, title, entity_id, action_item_id, inbox_item_id, domain }) {
  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: category || 'status_change', title,
    entity_id: entity_id || null,
    action_item_id: action_item_id || null,
    inbox_item_id: inbox_item_id || null,
    source_type: 'system', domain: domain || null,
    visibility: 'shared',
    occurred_at: new Date().toISOString()
  });
}

// ============================================================================
// CONTEXT BROKER — Assemble, cache, serve, and invalidate context packets
//
// Route: /api/context → /api/operations?_route=context
//   POST ?action=assemble       — assemble or retrieve a single context packet
//   POST ?action=assemble-multi — assemble multiple packets in one request
//   POST ?action=invalidate     — invalidate cached packets for an entity
// ============================================================================

const VALID_PACKET_TYPES = new Set([
  'contact', 'property', 'pursuit', 'deal',
  'daily_briefing', 'listing_marketing', 'comp_analysis'
]);

const PACKET_TTL_HOURS = {
  contact: 24,
  property: 4,
  pursuit: 12,
  deal: 4,
  daily_briefing: 1,
  listing_marketing: 6,
  comp_analysis: 72
};

async function handleContextRoute(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed. Context broker accepts POST only.` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships?.[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const action = req.query.action || req.body?.action;

  switch (action) {
    case 'assemble':              return handleAssemble(req, res, workspaceId, user.id);
    case 'assemble-multi':        return handleAssembleMulti(req, res, workspaceId, user.id);
    case 'invalidate':            return handleInvalidate(req, res, workspaceId, user.id);
    case 'preassemble-nightly':   return handlePreassembleNightly(req, res, workspaceId, user.id);
    case 'weekly-intelligence-report': return handleWeeklyReport(req, res, workspaceId);
    default:
      return res.status(400).json({
        error: 'Invalid context action. Use: assemble, assemble-multi, invalidate, preassemble-nightly, weekly-intelligence-report'
      });
  }
}

// ---------------------------------------------------------------------------
// Weekly Intelligence Report — queries schema/027 feedback views
// ---------------------------------------------------------------------------

async function handleWeeklyReport(req, res, workspaceId) {
  const [ignoredResult, templatesResult, slowResult] = await Promise.all([
    opsQuery('GET', 'ignored_recommendation_contacts?order=ignored_count.desc&limit=25'),
    opsQuery('GET', 'high_performing_templates?order=response_rate_pct.desc&limit=10'),
    opsQuery('GET', 'slow_action_report?order=avg_duration_ms.desc&limit=20')
  ]);

  const ignoredContacts = Array.isArray(ignoredResult.data) ? ignoredResult.data : [];
  const topTemplates = Array.isArray(templatesResult.data) ? templatesResult.data : [];
  const slowActions = Array.isArray(slowResult.data) ? slowResult.data : [];

  // Enrich ignored contacts with names from entities table
  const enrichedIgnored = await Promise.all(
    ignoredContacts.slice(0, 15).map(async (row) => {
      let name = null;
      if (row.entity_id) {
        try {
          const entityResult = await opsQuery('GET',
            `entities?id=eq.${pgFilterVal(row.entity_id)}&select=name&limit=1`
          );
          name = entityResult.data?.[0]?.name || null;
        } catch { /* best-effort name lookup */ }
      }
      return {
        entity_id: row.entity_id,
        name: name || '(unknown)',
        ignored_count: row.ignored_count
      };
    })
  );

  const weekEnding = new Date().toISOString().split('T')[0];
  const bestRate = topTemplates.length > 0 ? `${topTemplates[0].response_rate_pct}%` : 'N/A';
  const slowestAvg = slowActions.length > 0 ? Number(slowActions[0].avg_duration_ms) : 0;

  return res.status(200).json({
    week_ending: weekEnding,
    ignored_recommendations: enrichedIgnored,
    top_performing_templates: topTemplates.map(t => ({
      template_name: t.template_name || t.template_id,
      response_rate_pct: t.response_rate_pct,
      sent_count: t.sent_count
    })),
    slowest_actions: slowActions.map(s => ({
      signal_type: s.signal_type,
      avg_duration_ms: Number(s.avg_duration_ms),
      occurrence_count: s.occurrence_count
    })),
    summary: {
      contacts_consistently_ignored: ignoredContacts.length,
      best_template_response_rate: bestRate,
      slowest_avg_action_ms: slowestAvg
    }
  });
}

// ---------------------------------------------------------------------------
// Assemble a single context packet
// ---------------------------------------------------------------------------

async function handleAssemble(req, res, workspaceId, userId) {
  const {
    packet_type, entity_id, entity_type,
    surface_hint, force_refresh, max_tokens
  } = req.body || {};

  if (!packet_type || !VALID_PACKET_TYPES.has(packet_type)) {
    return res.status(400).json({
      error: `Invalid or missing packet_type. Use: ${[...VALID_PACKET_TYPES].join(', ')}`
    });
  }
  if (packet_type !== 'daily_briefing' && !entity_id) {
    return res.status(400).json({ error: 'entity_id is required for non-briefing packet types' });
  }

  const startMs = Date.now();

  try {
    const result = await assembleSinglePacket({
      packet_type, entity_id, entity_type,
      surface_hint, force_refresh, max_tokens,
      workspaceId, userId
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error(`[context-broker] Assembly failed for ${packet_type}/${entity_id}:`, err.message);
    return res.status(503).json({
      error: 'Context packet assembly failed',
      detail: process.env.LCC_ENV === 'development' ? err.message : undefined,
      missing_fields: err.missingFields || []
    });
  }
}

// ---------------------------------------------------------------------------
// Assemble multiple context packets in one request
// ---------------------------------------------------------------------------

async function handleAssembleMulti(req, res, workspaceId, userId) {
  const { requests, max_total_tokens } = req.body || {};

  if (!Array.isArray(requests) || requests.length === 0) {
    return res.status(400).json({ error: 'requests array is required and must not be empty' });
  }
  if (requests.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 packets per multi-assemble request' });
  }

  const startMs = Date.now();
  let cacheHits = 0;
  let assemblies = 0;

  const results = await Promise.allSettled(
    requests.map(r => assembleSinglePacket({
      packet_type: r.packet_type,
      entity_id: r.entity_id,
      entity_type: r.entity_type,
      surface_hint: r.surface_hint,
      force_refresh: r.force_refresh,
      max_tokens: r.max_tokens,
      workspaceId,
      userId
    }))
  );

  const packets = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      packets.push(result.value);
      if (result.value.cache_hit) cacheHits++;
      else assemblies++;
    } else {
      packets.push({
        error: 'Assembly failed',
        detail: process.env.LCC_ENV === 'development' ? result.reason?.message : undefined
      });
    }
  }

  let totalTokens = packets.reduce((sum, p) => sum + (p.token_count || 0), 0);

  return res.status(200).json({
    packets,
    total_token_count: totalTokens,
    assembly_meta: {
      total_duration_ms: Date.now() - startMs,
      cache_hits: cacheHits,
      assemblies
    }
  });
}

// ---------------------------------------------------------------------------
// Invalidate cached packets
// ---------------------------------------------------------------------------

async function handleInvalidate(req, res, workspaceId, userId) {
  const { packet_type, entity_id, reason, force_rebuild } = req.body || {};

  if (!entity_id) {
    return res.status(400).json({ error: 'entity_id is required' });
  }
  if (!packet_type) {
    return res.status(400).json({ error: 'packet_type is required (or "all")' });
  }

  let filter = `context_packets?entity_id=eq.${pgFilterVal(entity_id)}&invalidated=eq.false`;
  if (packet_type !== 'all') {
    filter += `&packet_type=eq.${pgFilterVal(packet_type)}`;
  }

  const patchResult = await opsQuery('PATCH', filter, {
    invalidated: true,
    invalidation_reason: reason || 'manual_invalidation'
  });

  const invalidatedCount = Array.isArray(patchResult.data) ? patchResult.data.length : 0;

  writeSignal({
    signal_type: 'packet_invalidated',
    signal_category: 'intelligence',
    entity_id,
    user_id: userId,
    payload: { packet_type, reason, invalidated_count: invalidatedCount }
  });

  let rebuildQueued = false;
  if (force_rebuild && packet_type !== 'all') {
    rebuildQueued = true;
    // Fire-and-forget rebuild
    assembleSinglePacket({
      packet_type, entity_id, entity_type: null,
      surface_hint: null, force_refresh: true,
      workspaceId, userId
    }).catch(err => console.error('[context-broker] Rebuild after invalidation failed:', err.message));
  }

  return res.status(200).json({
    invalidated_count: invalidatedCount,
    rebuild_queued: rebuildQueued
  });
}

// ---------------------------------------------------------------------------
// Nightly pre-assembly — warm context packet cache for high-priority entities
// POST /api/preassemble → /api/operations?_route=context&action=preassemble-nightly
// ---------------------------------------------------------------------------

async function handlePreassembleNightly(req, res, workspaceId, userId) {
  const startMs = Date.now();

  // Step 1 — Identify high-priority entities (candidates for pre-assembly)
  const [propsRes, contactsRes, crossDomainRes, activeAssetsRes] = await Promise.all([
    // Query 1: Properties with high investment scores
    opsQuery('GET',
      `entities?entity_type=eq.asset` +
      `&metadata->>investment_score=gt.60` +
      `&workspace_id=eq.${pgFilterVal(workspaceId)}` +
      `&select=id,entity_type,domain` +
      `&limit=100`
    ),
    // Query 2: Contacts active in last 90 days (two-step via fetchActiveContacts)
    fetchActiveContacts(workspaceId),
    // Query 3: Cross-domain owner entities
    opsQuery('GET',
      `entities?tags=cs.{cross_domain_owner}` +
      `&workspace_id=eq.${pgFilterVal(workspaceId)}` +
      `&select=id,entity_type,domain`
    ),
    // Query 4 (Slice 3a): most-active property/asset entities, so property
    // packets are warm without waiting for the first read. Bounded to keep the
    // nightly run inside budget — same "recent activity" ranking as contacts.
    fetchActiveAssets(workspaceId)
  ]);

  // Merge and deduplicate all four lists
  const entityMap = new Map();
  for (const list of [propsRes, contactsRes, crossDomainRes, activeAssetsRes]) {
    const rows = Array.isArray(list.data) ? list.data : (list.data ? [list.data] : []);
    for (const row of rows) {
      if (row.id && !entityMap.has(row.id)) {
        entityMap.set(row.id, row);
      }
    }
  }
  const candidates = [...entityMap.values()];

  // Step 2 — For each entity, check if a fresh packet already exists
  const assemblyQueue = [];
  let alreadyFresh = 0;
  const fourHoursFromNow = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

  for (const entity of candidates) {
    const packetType = entity.entity_type === 'asset' ? 'property' : 'contact';
    const freshCheck = await opsQuery('GET',
      `context_packets?entity_id=eq.${pgFilterVal(entity.id)}` +
      `&packet_type=eq.${pgFilterVal(packetType)}` +
      `&invalidated=eq.false` +
      `&expires_at=gt.${pgFilterVal(fourHoursFromNow)}` +
      `&limit=1`
    );
    if (freshCheck.ok && freshCheck.data?.length > 0) {
      alreadyFresh++;
    } else {
      assemblyQueue.push({ ...entity, packet_type: packetType });
    }
  }

  // Step 3 — Assemble packets in batches of 10 with 500ms delay between batches
  let assembled = 0;
  let failed = 0;
  const BATCH_SIZE = 10;

  for (let i = 0; i < assemblyQueue.length; i += BATCH_SIZE) {
    const batch = assemblyQueue.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(entity =>
        assembleSinglePacket({
          packet_type: entity.packet_type,
          entity_id: entity.id,
          entity_type: entity.entity_type,
          surface_hint: 'preassembly',
          force_refresh: true,
          max_tokens: null,
          workspaceId,
          userId
        })
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled') assembled++;
      else {
        failed++;
        console.error('[preassemble-nightly] Entity assembly failed:', result.reason?.message);
      }
    }

    // 500ms delay between batches (skip after last batch)
    if (i + BATCH_SIZE < assemblyQueue.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Step 4 — Also assemble daily_briefing packet (no entity_id)
  try {
    await assembleSinglePacket({
      packet_type: 'daily_briefing',
      entity_id: null,
      entity_type: null,
      surface_hint: 'preassembly',
      force_refresh: true,
      max_tokens: null,
      workspaceId,
      userId
    });
    assembled++;
  } catch (err) {
    failed++;
    console.error('[preassemble-nightly] daily_briefing assembly failed:', err.message);
  }

  const durationMs = Date.now() - startMs;

  // Step 5 — Return summary
  return res.status(200).json({
    total_candidates: candidates.length,
    already_fresh: alreadyFresh,
    assembled,
    failed,
    duration_ms: durationMs
  });
}

/**
 * Fetch contacts (entity_type=person) that have activity events in the last 90 days.
 * PostgREST doesn't support JOINs directly, so we query activity_events first,
 * then fetch matching entities.
 */
async function fetchActiveContacts(workspaceId) {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Get distinct entity_ids from recent activity events
  const activityRes = await opsQuery('GET',
    `activity_events?occurred_at=gt.${pgFilterVal(ninetyDaysAgo)}` +
    `&select=entity_id` +
    `&limit=500`
  );

  const entityIds = [...new Set(
    (Array.isArray(activityRes.data) ? activityRes.data : [])
      .map(r => r.entity_id)
      .filter(Boolean)
  )];

  if (entityIds.length === 0) {
    return { ok: true, data: [] };
  }

  // Fetch person entities matching those IDs
  const entitiesRes = await opsQuery('GET',
    `entities?entity_type=eq.person` +
    `&workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&id=in.(${entityIds.map(id => pgFilterVal(id)).join(',')})` +
    `&select=id,entity_type,domain` +
    `&limit=200`
  );

  return entitiesRes;
}

/**
 * Fetch property/asset entities (entity_type=asset) with activity in the last
 * 90 days — the "most-active properties first" candidates for nightly
 * property-packet pre-warming (Slice 3a). Mirrors fetchActiveContacts; bounded.
 */
async function fetchActiveAssets(workspaceId) {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const activityRes = await opsQuery('GET',
    `activity_events?occurred_at=gt.${pgFilterVal(ninetyDaysAgo)}` +
    `&select=entity_id` +
    `&limit=500`
  );

  const entityIds = [...new Set(
    (Array.isArray(activityRes.data) ? activityRes.data : [])
      .map(r => r.entity_id)
      .filter(Boolean)
  )];

  if (entityIds.length === 0) {
    return { ok: true, data: [] };
  }

  const entitiesRes = await opsQuery('GET',
    `entities?entity_type=eq.asset` +
    `&workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&id=in.(${entityIds.map(id => pgFilterVal(id)).join(',')})` +
    `&select=id,entity_type,domain` +
    `&limit=200`
  );

  return entitiesRes;
}

// ---------------------------------------------------------------------------
// Core assembly engine — used by both assemble and assemble-multi
// ---------------------------------------------------------------------------

export async function assembleSinglePacket({ packet_type, entity_id, entity_type, surface_hint, force_refresh, max_tokens, workspaceId, userId }) {
  const startMs = Date.now();

  // Step 1 — Cache check (unless force_refresh)
  if (!force_refresh && entity_id) {
    const cacheFilter =
      `context_packets?packet_type=eq.${pgFilterVal(packet_type)}` +
      `&entity_id=eq.${pgFilterVal(entity_id)}` +
      `&invalidated=eq.false` +
      `&expires_at=gt.${pgFilterVal(new Date().toISOString())}` +
      `&order=assembled_at.desc&limit=1`;

    const cached = await opsQuery('GET', cacheFilter);
    if (cached.ok && cached.data?.length > 0) {
      const pkt = cached.data[0];
      // Fire-and-forget cache hit signal
      writeSignal({
        signal_type: 'packet_cache_hit',
        signal_category: 'intelligence',
        entity_id, entity_type: entity_type || pkt.entity_type,
        user_id: userId,
        payload: { packet_type, surface_hint, token_count: pkt.token_count }
      });

      return {
        packet_id: pkt.id,
        packet_type: pkt.packet_type,
        entity_id: pkt.entity_id,
        assembled_at: pkt.assembled_at,
        expires_at: pkt.expires_at,
        cache_hit: true,
        token_count: pkt.token_count,
        payload: pkt.payload,
        assembly_meta: {
          sources_queried: [],
          fields_missing: [],
          compression_applied: false,
          duration_ms: Date.now() - startMs
        }
      };
    }
  }

  // For daily_briefing with no entity_id, also check by user
  if (!force_refresh && packet_type === 'daily_briefing' && !entity_id) {
    const briefingFilter =
      `context_packets?packet_type=eq.daily_briefing` +
      `&requesting_user=eq.${pgFilterVal(userId)}` +
      `&invalidated=eq.false` +
      `&expires_at=gt.${pgFilterVal(new Date().toISOString())}` +
      `&order=assembled_at.desc&limit=1`;

    const cached = await opsQuery('GET', briefingFilter);
    if (cached.ok && cached.data?.length > 0) {
      const pkt = cached.data[0];
      writeSignal({
        signal_type: 'packet_cache_hit',
        signal_category: 'intelligence',
        user_id: userId,
        payload: { packet_type: 'daily_briefing', surface_hint }
      });
      return {
        packet_id: pkt.id,
        packet_type: pkt.packet_type,
        entity_id: pkt.entity_id,
        assembled_at: pkt.assembled_at,
        expires_at: pkt.expires_at,
        cache_hit: true,
        token_count: pkt.token_count,
        payload: pkt.payload,
        assembly_meta: {
          sources_queried: [],
          fields_missing: [],
          compression_applied: false,
          duration_ms: Date.now() - startMs
        }
      };
    }
  }

  // Step 2 — Assemble fresh packet
  let payload;
  let sourcesQueried = [];
  let fieldsMissing = [];

  switch (packet_type) {
    case 'property':
      ({ payload, sourcesQueried, fieldsMissing } = await assemblePropertyPacket(entity_id, workspaceId));
      break;
    case 'contact':
      ({ payload, sourcesQueried, fieldsMissing } = await assembleContactPacket(entity_id, workspaceId));
      break;
    case 'daily_briefing':
      ({ payload, sourcesQueried, fieldsMissing } = await assembleDailyBriefingPacket(workspaceId, userId));
      break;
    case 'pursuit':
    case 'deal':
    case 'listing_marketing':
    case 'comp_analysis':
      ({ payload, sourcesQueried, fieldsMissing } = await assembleGenericPacket(packet_type, entity_id, workspaceId));
      break;
    default: {
      const err = new Error(`Unsupported packet_type: ${packet_type}`);
      err.missingFields = [];
      throw err;
    }
  }

  const assembledAt = new Date().toISOString();
  const ttlHours = PACKET_TTL_HOURS[packet_type] || 4;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const tokenCount = Math.ceil(JSON.stringify(payload).length / 4);
  const durationMs = Date.now() - startMs;

  // Step 3 — Write to cache (fire-and-forget — never blocks response)
  opsQuery('POST', 'context_packets', {
    packet_type,
    entity_id: entity_id || null,
    entity_type: entity_type || null,
    requesting_user: userId,
    surface_hint: surface_hint || null,
    payload,
    token_count: tokenCount,
    assembled_at: assembledAt,
    expires_at: expiresAt,
    assembly_duration_ms: durationMs,
    model_version: '1.0'
  }).catch(err => console.error('[context-broker] Cache write failed:', err.message));

  // Step 4 — Write signal (fire-and-forget)
  writeSignal({
    signal_type: 'packet_assembled',
    signal_category: 'intelligence',
    entity_id: entity_id || null,
    entity_type: entity_type || null,
    user_id: userId,
    payload: {
      packet_type,
      token_count: tokenCount,
      surface_hint: surface_hint || null,
      sources_queried: sourcesQueried,
      duration_ms: durationMs
    }
  });

  // Step 5 — Return packet
  return {
    packet_id: null, // assigned by DB on cache write
    packet_type,
    entity_id: entity_id || null,
    assembled_at: assembledAt,
    expires_at: expiresAt,
    cache_hit: false,
    token_count: tokenCount,
    payload,
    assembly_meta: {
      sources_queried: sourcesQueried,
      fields_missing: fieldsMissing,
      compression_applied: false,
      duration_ms: durationMs
    }
  };
}

// ---------------------------------------------------------------------------
// Property packet assembly
//
// Phase 2 Slice 3a — the property context packet is the Layer 4 keystone. The
// assembler pulls the full breadth+depth of what's known about a property so a
// single packet fully informs LCC, Copilot, Claude, and external agents:
//   entity · lease_data · documents (the Phase-2 doc connections) · ownership ·
//   transactions · comps · investment · activity_timeline · external_identities
//
// Every domain sub-query is bounded + defensive: a section that can't be
// fetched pushes a fields_missing entry rather than throwing the whole packet.
// `deps` is injectable for unit testing (opsQuery / domainGet).
// ---------------------------------------------------------------------------

// Default domain reader: GET against the gov/dia PostgREST surface. Returns
// { ok, data } and NEVER throws so a single failing section degrades cleanly.
async function ctxDomainGet(domain, path) {
  const url = domain === 'gov' ? process.env.GOV_SUPABASE_URL : process.env.DIA_SUPABASE_URL;
  const key = domain === 'gov' ? govSupabaseKey() : diaSupabaseKey();
  if (!url || !key) return { ok: false, data: null, reason: 'not_configured' };
  try {
    const r = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!r.ok) return { ok: false, data: null, status: r.status };
    const data = await r.json();
    return { ok: true, data: Array.isArray(data) ? data : (data ? [data] : []) };
  } catch (err) {
    return { ok: false, data: null, error: err.message };
  }
}

// Map a raw domain sales_transactions row to a compact, domain-agnostic shape.
function mapTransaction(r) {
  return {
    sale_id: r.sale_id ?? r.id ?? null,
    sale_date: r.sale_date ?? null,
    price: r.sold_price ?? r.sale_price ?? r.price ?? null,
    price_psf: r.sold_price_psf ?? r.price_psf ?? null,
    cap_rate: r.sold_cap_rate ?? r.cap_rate ?? null,
    buyer: r.buyer ?? r.buyer_name ?? null,
    seller: r.seller ?? r.seller_name ?? null
  };
}

// Map a raw domain property_documents row. The `source` provenance lets a
// consumer tell an lcc_generated BOV from an om_extraction OM from a
// folder_feed_* attach. PK column varies by domain (document_id / id).
function mapDocument(r) {
  return {
    document_id: r.document_id ?? r.id ?? null,
    file_name: r.file_name ?? null,
    document_type: r.document_type ?? null,
    source_url: r.source_url ?? null,
    source: r.source ?? r.ingestion_status ?? null,
    created_at: r.created_at ?? null
  };
}

export async function assemblePropertyPacket(entityId, workspaceId, deps = {}) {
  const _ops = deps.opsQuery || opsQuery;
  const _domainGet = deps.domainGet || ctxDomainGet;

  const sourcesQueried = ['lcc_db'];
  const fieldsMissing = [];

  // LCC-side parallel queries: entity, external identities, activity, research,
  // and the ownership/relationship graph (owns / associated_with edges).
  const [entityRes, identitiesRes, activityRes, researchRes, relationshipsRes] = await Promise.all([
    _ops('GET',
      `entities?id=eq.${pgFilterVal(entityId)}&select=*&limit=1`
    ),
    _ops('GET',
      `external_identities?entity_id=eq.${pgFilterVal(entityId)}&select=*`
    ),
    _ops('GET',
      `activity_events?entity_id=eq.${pgFilterVal(entityId)}&order=occurred_at.desc&limit=10&select=id,category,title,source_type,occurred_at,metadata`
    ),
    _ops('GET',
      `action_items?entity_id=eq.${pgFilterVal(entityId)}&status=in.(open,in_progress)&select=id,title,status,priority,due_date,action_type&order=created_at.desc&limit=5`
    ),
    _ops('GET',
      `entity_relationships?or=(from_entity_id.eq.${pgFilterVal(entityId)},to_entity_id.eq.${pgFilterVal(entityId)})` +
      `&relationship_type=in.(owns,associated_with)&select=relationship_type,from_entity_id,to_entity_id&limit=25`
    )
  ]);

  const entity = entityRes.data?.[0] || null;
  if (!entity) {
    const err = new Error(`Entity ${entityId} not found`);
    err.missingFields = ['entity'];
    throw err;
  }

  const identities = Array.isArray(identitiesRes.data) ? identitiesRes.data : [];
  const activityTimeline = Array.isArray(activityRes.data) ? activityRes.data : [];
  const activeResearch = Array.isArray(researchRes.data) ? researchRes.data : [];
  const relationships = Array.isArray(relationshipsRes.data) ? relationshipsRes.data : [];

  // Resolve the linked domain + external property id.
  // R4-A: canonical 'gov'/'dia'; accept deprecated spellings during transition.
  const govIdentity = identities.find(i => ['gov','gov_db','gov_supabase','government'].includes(i.source_system));
  const diaIdentity = identities.find(i => ['dia','dia_db','dia_supabase','dialysis'].includes(i.source_system));
  let domain = null, externalId = null;
  if (govIdentity?.external_id) { domain = 'gov'; externalId = govIdentity.external_id; }
  else if (diaIdentity?.external_id) { domain = 'dia'; externalId = diaIdentity.external_id; }

  let leaseData = null;
  let documents = [];
  let transactions = [];
  let listings = [];
  let ownership = null;
  let investment = null;

  if (domain && externalId) {
    sourcesQueried.push(domain === 'gov' ? 'gov_db' : 'dia_db');
    const pid = encodeURIComponent(externalId);

    // First domain batch — all parallel, each degrades to {ok:false} independently.
    const [propRes, docRes, txnRes, listRes, invRes] = await Promise.all([
      _domainGet(domain, `properties?property_id=eq.${pid}&select=*&limit=1`),
      _domainGet(domain, `property_documents?property_id=eq.${pid}&order=created_at.desc&limit=15`),
      _domainGet(domain, `sales_transactions?property_id=eq.${pid}&order=sale_date.desc&limit=8`),
      _domainGet(domain, `available_listings?property_id=eq.${pid}&select=*&limit=3`),
      _domainGet(domain, `investment_scores?property_id=eq.${pid}&limit=1`)
    ]);

    if (propRes.ok) leaseData = propRes.data?.[0] || null;
    else fieldsMissing.push('lease_data');

    // documents — the keystone: surfaces the Phase-2 doc connections.
    if (docRes.ok) documents = (docRes.data || []).map(mapDocument);
    else fieldsMissing.push('documents');

    if (txnRes.ok) transactions = (txnRes.data || []).map(mapTransaction);
    else fieldsMissing.push('transactions');

    if (listRes.ok) listings = listRes.data || [];

    // ownership — recorded/true owner names (domain) + related people/orgs (LCC graph).
    ownership = { recorded_owner_name: null, true_owner_name: null, related_entities: [] };
    if (leaseData && (leaseData.recorded_owner_id != null || leaseData.true_owner_id != null)) {
      const ownerCalls = [];
      if (leaseData.recorded_owner_id != null) {
        ownerCalls.push(_domainGet(domain,
          `recorded_owners?recorded_owner_id=eq.${encodeURIComponent(leaseData.recorded_owner_id)}&select=recorded_owner_id,name&limit=1`)
          .then(r => ({ kind: 'recorded', r })));
      }
      if (leaseData.true_owner_id != null) {
        ownerCalls.push(_domainGet(domain,
          `true_owners?true_owner_id=eq.${encodeURIComponent(leaseData.true_owner_id)}&select=true_owner_id,name&limit=1`)
          .then(r => ({ kind: 'true', r })));
      }
      for (const { kind, r } of await Promise.all(ownerCalls)) {
        if (r.ok && r.data?.[0]?.name) {
          if (kind === 'recorded') ownership.recorded_owner_name = r.data[0].name;
          else ownership.true_owner_name = r.data[0].name;
        }
      }
    }

    // investment — prefer the REAL investment_scores / deal_grade, then the
    // property-level score, then the naive recompute.
    if (invRes.ok && invRes.data?.[0]) {
      const s = invRes.data[0];
      investment = {
        score: s.investment_score ?? s.score ?? null,
        grade: s.deal_grade ?? s.grade ?? null,
        source: 'investment_scores'
      };
    } else if (leaseData && (leaseData.investment_score != null || leaseData.deal_grade != null)) {
      investment = {
        score: leaseData.investment_score ?? null,
        grade: leaseData.deal_grade ?? null,
        source: 'properties'
      };
    } else if (leaseData) {
      let score = 50; // base — naive fallback only
      if (leaseData.remaining_lease_term_years > 10) score += 20;
      else if (leaseData.remaining_lease_term_years > 5) score += 10;
      if (leaseData.occupancy_status === 'occupied') score += 15;
      if (leaseData.lease_type === 'NNN') score += 15;
      investment = { score, grade: null, source: 'computed' };
    } else {
      fieldsMissing.push('investment');
    }
  } else {
    // No domain linkage — these sections are unavailable, not errors.
    fieldsMissing.push('lease_data', 'documents', 'transactions', 'ownership', 'investment');
    ownership = { recorded_owner_name: null, true_owner_name: null, related_entities: [] };
  }

  // Related people/orgs from the LCC graph — resolve the "other" entity's name.
  const relatedIds = new Set();
  const relTypeById = new Map();
  for (const rel of relationships) {
    const other = rel.from_entity_id === entityId ? rel.to_entity_id : rel.from_entity_id;
    if (other && other !== entityId) {
      relatedIds.add(other);
      if (!relTypeById.has(other)) relTypeById.set(other, rel.relationship_type);
    }
  }
  if (relatedIds.size > 0) {
    const idList = [...relatedIds].map(id => pgFilterVal(id)).join(',');
    const relEntRes = await _ops('GET',
      `entities?id=in.(${idList})&select=id,name,entity_type&limit=25`
    );
    if (relEntRes.ok && Array.isArray(relEntRes.data)) {
      ownership.related_entities = relEntRes.data.map(e => ({
        entity_id: e.id,
        name: e.name,
        entity_type: e.entity_type,
        relationship: relTypeById.get(e.id) || null
      }));
    }
  }

  // comps — deferred placeholder (no cheap nearby-comps source on the hot path);
  // recorded in fields_missing rather than running a heavy geospatial query here.
  const comps = [];
  fieldsMissing.push('comps');

  const payload = {
    entity,
    lease_data: leaseData,
    documents,
    ownership,
    transactions,
    listings,
    comps,
    investment,
    // investment_score kept for backward compatibility with existing consumers.
    investment_score: investment?.score ?? null,
    research_status: activeResearch,
    activity_timeline: activityTimeline,
    external_identities: identities.map(i => ({
      source_system: i.source_system,
      source_type: i.source_type,
      external_id: i.external_id
    }))
  };

  return { payload, sourcesQueried, fieldsMissing };
}

// ---------------------------------------------------------------------------
// Contact packet assembly
// ---------------------------------------------------------------------------

async function assembleContactPacket(entityId, workspaceId) {
  const sourcesQueried = ['lcc_db'];
  const fieldsMissing = [];

  // Parallel queries: entity, activity events, touchpoint signals, active pursuits
  const [entityRes, activityRes, touchpointRes, pursuitsRes] = await Promise.all([
    opsQuery('GET',
      `entities?id=eq.${pgFilterVal(entityId)}&select=*&limit=1`
    ),
    opsQuery('GET',
      `activity_events?entity_id=eq.${pgFilterVal(entityId)}&order=occurred_at.desc&limit=20&select=id,category,title,source_type,occurred_at,metadata`
    ),
    opsQuery('GET',
      `signals?entity_id=eq.${pgFilterVal(entityId)}&signal_type=eq.touchpoint_logged&order=created_at.desc&limit=20&select=id,signal_type,payload,created_at`
    ),
    opsQuery('GET',
      `action_items?entity_id=eq.${pgFilterVal(entityId)}&status=in.(open,in_progress)&select=id,title,status,priority,due_date,action_type&order=created_at.desc&limit=10`
    )
  ]);

  const entity = entityRes.data?.[0] || null;
  if (!entity) {
    const err = new Error(`Entity ${entityId} not found`);
    err.missingFields = ['entity'];
    throw err;
  }

  const activityTimeline = Array.isArray(activityRes.data) ? activityRes.data : [];
  const touchpoints = Array.isArray(touchpointRes.data) ? touchpointRes.data : [];
  const activePursuits = Array.isArray(pursuitsRes.data) ? pursuitsRes.data : [];

  // Derive touchpoint metrics
  const touchpointCount = touchpoints.length;
  const lastTouch = touchpoints[0]?.created_at || null;
  const lastTouchDate = lastTouch ? lastTouch.split('T')[0] : null;
  const daysSinceLastTouch = lastTouch
    ? Math.floor((Date.now() - new Date(lastTouch).getTime()) / 86400000)
    : null;

  // Simple relationship score based on touchpoint recency and frequency
  let relationshipScore = null;
  if (touchpointCount > 0) {
    relationshipScore = Math.min(100, Math.max(0,
      Math.round(50 + (touchpointCount * 3) - (daysSinceLastTouch || 0))
    ));
  }

  // Derive recommended action
  let recommendedAction = null;
  if (daysSinceLastTouch === null || daysSinceLastTouch > 30) {
    recommendedAction = 'Reconnect — no recent touchpoints';
  } else if (daysSinceLastTouch > 14) {
    recommendedAction = 'Follow up — approaching cadence gap';
  } else if (activePursuits.length > 0) {
    recommendedAction = `Active pursuit: ${activePursuits[0].title}`;
  }

  const payload = {
    entity,
    touchpoint_history: touchpoints.map(t => ({
      date: t.created_at,
      type: t.payload?.activity_category || 'touchpoint',
      title: t.payload?.title || null
    })),
    active_pursuits: activePursuits,
    relationship_score: relationshipScore,
    recommended_action: recommendedAction,
    last_touch_date: lastTouchDate,
    touchpoint_count: touchpointCount,
    days_since_last_touch: daysSinceLastTouch,
    activity_timeline: activityTimeline
  };

  return { payload, sourcesQueried, fieldsMissing };
}

// ---------------------------------------------------------------------------
// Daily briefing packet assembly — delegates to existing daily-briefing logic
// ---------------------------------------------------------------------------

async function assembleDailyBriefingPacket(workspaceId, userId) {
  const sourcesQueried = ['lcc_db'];
  const fieldsMissing = [];

  // Query the same data sources the daily-briefing.js uses
  const [workCountsRes, myWorkRes, inboxRes, sfActivityRes] = await Promise.all([
    opsQuery('GET', `mv_work_counts?workspace_id=eq.${pgFilterVal(workspaceId)}&limit=1`),
    opsQuery('GET',
      `v_my_work?workspace_id=eq.${pgFilterVal(workspaceId)}` +
      `&or=(user_id.eq.${pgFilterVal(userId)},assigned_to.eq.${pgFilterVal(userId)})` +
      `&limit=15&order=due_date.asc.nullslast,created_at.desc`
    ),
    opsQuery('GET',
      `v_inbox_triage?workspace_id=eq.${pgFilterVal(workspaceId)}&limit=10&order=received_at.desc`
    ),
    opsQuery('GET',
      `activity_events?workspace_id=eq.${pgFilterVal(workspaceId)}&source_type=eq.salesforce&order=occurred_at.desc&limit=30&select=id,category,title,body,source_type,metadata,occurred_at`
    )
  ]);

  const workCounts = workCountsRes.data?.[0] || {};
  const myWork = Array.isArray(myWorkRes.data) ? myWorkRes.data : [];
  const inboxItems = Array.isArray(inboxRes.data) ? inboxRes.data : [];
  const sfActivity = Array.isArray(sfActivityRes.data) ? sfActivityRes.data : [];

  // Classify items into tiers using keyword heuristics
  const DEAL_RE = /offer|under contract|loi|closing|escrow|due diligence|psa|purchase|disposition/i;
  const PURSUIT_RE = /bov|proposal|valuation|pitch|pursuit|prospect|owner|seller/i;

  const strategic = [];
  const important = [];
  const urgent = [];

  const allItems = [...myWork, ...inboxItems];
  for (const item of allItems) {
    const text = ((item.title || '') + ' ' + (item.body || '')).toLowerCase();
    if (DEAL_RE.test(text) || PURSUIT_RE.test(text)) {
      strategic.push(item);
    } else if (item.priority === 'high' || item.priority === 'urgent') {
      important.push(item);
    } else {
      urgent.push(item);
    }
  }

  const mapItem = (item, rank) => ({
    priority_rank: rank,
    category: item.source_type || item.item_type || 'general',
    title: item.title || '(Untitled)',
    entity_name: item.title || null,
    entity_id: item.entity_id || item.id || null,
    context: item.body || null,
    suggested_actions: []
  });

  const calls = sfActivity.filter(a => a.category === 'call').length;
  const emails = sfActivity.filter(a => a.category === 'email').length;

  const payload = {
    packet_type: 'daily_briefing',
    generated_at: new Date().toISOString(),
    date: new Date().toISOString().split('T')[0],
    user_id: userId,
    strategic_items: strategic.slice(0, 5).map((item, i) => mapItem(item, i + 1)),
    important_items: important.slice(0, 5).map((item, i) => mapItem(item, i + 1)),
    urgent_items: urgent.slice(0, 5).map((item, i) => mapItem(item, i + 1)),
    production_score: {
      bd_touchpoints: { planned: 10, completed_yesterday: 0, weekly_target: 10, weekly_completed: calls + emails },
      calls_logged: { weekly_completed: calls, weekly_target: 15 },
      om_follow_ups_completed: { open: 0, overdue_48h: 0 }
    },
    team_metrics: {
      open_actions: workCounts.open_actions || 0,
      inbox_new: workCounts.inbox_new || 0,
      overdue: workCounts.overdue_actions || 0,
      completed_week: workCounts.completed_week || 0
    },
    assembled_at: new Date().toISOString()
  };

  return { payload, sourcesQueried, fieldsMissing };
}

// ---------------------------------------------------------------------------
// Generic packet assembly — for types not yet fully specialized
// ---------------------------------------------------------------------------

async function assembleGenericPacket(packetType, entityId, workspaceId) {
  const sourcesQueried = ['lcc_db'];
  const fieldsMissing = [];

  const [entityRes, activityRes, relatedActionsRes] = await Promise.all([
    opsQuery('GET',
      `entities?id=eq.${pgFilterVal(entityId)}&select=*&limit=1`
    ),
    opsQuery('GET',
      `activity_events?entity_id=eq.${pgFilterVal(entityId)}&order=occurred_at.desc&limit=15&select=id,category,title,source_type,occurred_at,metadata`
    ),
    opsQuery('GET',
      `action_items?entity_id=eq.${pgFilterVal(entityId)}&status=in.(open,in_progress)&select=id,title,status,priority,due_date,action_type&order=created_at.desc&limit=10`
    )
  ]);

  const entity = entityRes.data?.[0] || null;
  if (!entity) {
    const err = new Error(`Entity ${entityId} not found`);
    err.missingFields = ['entity'];
    throw err;
  }

  const payload = {
    packet_type: packetType,
    entity,
    activity_timeline: Array.isArray(activityRes.data) ? activityRes.data : [],
    active_items: Array.isArray(relatedActionsRes.data) ? relatedActionsRes.data : []
  };

  return { payload, sourcesQueried, fieldsMissing };
}
