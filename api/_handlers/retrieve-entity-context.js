// api/_handlers/retrieve-entity-context.js
// Handler for Copilot action: context.retrieve.entity.v1
//
// This is THE memory-retrieval action for the Copilot agent. Call it at the
// start of any conversation that mentions a specific contact, property, or
// organization. Returns:
//   - canonical entity record (name, type, domain, address if property)
//   - recent_interactions: last N activity_events within window
//   - open_action_items: currently-open tasks linked to the entity
//   - recent_inbox_items: latest 10 inbox items (emails, OMs, etc.)
//   - last_touchpoint_at: most recent interaction timestamp
//   - active_listings: count + first few rows if entity is a property
//   - pipeline_stage: derived from metadata when applicable
//
// Resolves entity by either entity_id (UUID) or entity_name (fuzzy, top-1).
// Returns a 404 with candidates when name is ambiguous.

import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { getRecentInteractions } from '../_shared/memory.js';

const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_LIMIT       = 20;

/**
 * @param {object} args
 * @param {object} args.inputs
 * @param {string} [args.inputs.entity_id]
 * @param {string} [args.inputs.entity_name]
 * @param {('contact'|'property'|'organization')} [args.inputs.entity_type]
 * @param {number} [args.inputs.window_days=90]
 * @param {number} [args.inputs.interaction_limit=20]
 * @param {object} args.authContext
 * @param {string} [args.workspaceId]
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleRetrieveEntityContext({ inputs, authContext, workspaceId }) {
  if (!inputs) return { status: 400, body: { error: 'missing_inputs' } };
  if (!inputs.entity_id && !inputs.entity_name) {
    return {
      status: 400,
      body: {
        error: 'missing_entity_identifier',
        detail: 'Provide entity_id (UUID) or entity_name (string).',
      },
    };
  }
  if (!authContext?.email) {
    return { status: 401, body: { error: 'missing_caller_identity' } };
  }
  const wsId = workspaceId;
  if (!wsId) {
    return { status: 400, body: { error: 'missing_workspace_context' } };
  }

  // ---- 1. Resolve entity -------------------------------------------------
  let entity = null;
  let resolveNotes = null;

  if (inputs.entity_id) {
    if (!/^[0-9a-fA-F-]{36}$/.test(inputs.entity_id)) {
      return { status: 400, body: { error: 'invalid_entity_id' } };
    }
    const sel = await opsQuery('GET',
      `entities?id=eq.${pgFilterVal(inputs.entity_id)}` +
      `&workspace_id=eq.${pgFilterVal(wsId)}` +
      `&select=id,entity_type,display_name,domain,metadata,created_at&limit=1`
    );
    if (!sel.ok || !sel.data?.length) {
      return { status: 404, body: { error: 'entity_not_found', entity_id: inputs.entity_id } };
    }
    entity = sel.data[0];
  } else {
    // Fuzzy name match
    const nameEncoded = pgFilterVal(`%${inputs.entity_name}%`);
    let typeFilter = '';
    if (inputs.entity_type) {
      typeFilter = `&entity_type=eq.${pgFilterVal(inputs.entity_type)}`;
    }
    const sel = await opsQuery('GET',
      `entities?workspace_id=eq.${pgFilterVal(wsId)}` +
      `&display_name=ilike.${nameEncoded}` +
      typeFilter +
      `&select=id,entity_type,display_name,domain,metadata,created_at` +
      `&order=updated_at.desc&limit=5`
    );
    if (!sel.ok || !sel.data?.length) {
      return {
        status: 404,
        body: {
          error: 'entity_not_found',
          detail: `No entity matching "${inputs.entity_name}" in this workspace.`,
          entity_name: inputs.entity_name,
        },
      };
    }
    entity = sel.data[0];
    if (sel.data.length > 1) {
      resolveNotes = {
        ambiguous: true,
        candidate_count: sel.data.length,
        also_matched: sel.data.slice(1).map((e) => ({
          id:           e.id,
          display_name: e.display_name,
          entity_type:  e.entity_type,
        })),
      };
    }
  }

  // ---- 2. Parallel fetch of timeline + linked rows -----------------------
  const windowDays  = Number(inputs.window_days)       || DEFAULT_WINDOW_DAYS;
  const interactionLimit = Number(inputs.interaction_limit) || DEFAULT_LIMIT;

  const [
    interactionsRes,
    openActionsRes,
    recentInboxRes,
  ] = await Promise.all([
    getRecentInteractions({
      workspaceId: wsId,
      entityId:    entity.id,
      limit:       interactionLimit,
      windowDays,
    }),
    opsQuery('GET',
      `action_items?workspace_id=eq.${pgFilterVal(wsId)}` +
      `&entity_id=eq.${pgFilterVal(entity.id)}` +
      `&status=in.(open,in_progress,waiting)` +
      `&select=id,title,status,priority,due_date,action_type,owner_id,assigned_to,created_at` +
      `&order=due_date.asc.nullslast,priority.desc&limit=25`
    ),
    opsQuery('GET',
      `inbox_items?workspace_id=eq.${pgFilterVal(wsId)}` +
      `&entity_id=eq.${pgFilterVal(entity.id)}` +
      `&select=id,title,source_type,status,priority,received_at,metadata` +
      `&order=received_at.desc&limit=10`
    ),
  ]);

  // ---- 3. Optional property-specific enrichment --------------------------
  let propertyEnrichment = null;
  if (entity.entity_type === 'property') {
    // Count active listings keyed to this property in metadata (best-effort)
    const listingsRes = await opsQuery('GET',
      `listing_bd_runs?workspace_id=eq.${pgFilterVal(wsId)}` +
      `&metadata->>property_entity_id=eq.${pgFilterVal(entity.id)}` +
      `&select=id,created_at,status&order=created_at.desc&limit=5`
    );
    if (listingsRes.ok) {
      propertyEnrichment = {
        listing_run_count: listingsRes.data?.length || 0,
        recent_listing_runs: listingsRes.data || [],
      };
    }
  }

  const rows = interactionsRes.rows || [];
  const lastTouchpointAt = rows.length ? rows[0].occurred_at : null;

  return {
    status: 200,
    body: {
      ok: true,
      entity: {
        id:           entity.id,
        entity_type:  entity.entity_type,
        display_name: entity.display_name,
        domain:       entity.domain || null,
        metadata:     entity.metadata || {},
      },
      resolve_notes:       resolveNotes,
      last_touchpoint_at:  lastTouchpointAt,
      recent_interactions: rows,
      open_action_items:   openActionsRes.ok ? (openActionsRes.data || []) : [],
      recent_inbox_items:  recentInboxRes.ok ? (recentInboxRes.data || []) : [],
      property_enrichment: propertyEnrichment,
      window_days:         windowDays,
      message: buildMessage({
        entity,
        interactionCount: rows.length,
        openActionCount:  openActionsRes.ok ? (openActionsRes.data?.length || 0) : 0,
        recentInboxCount: recentInboxRes.ok ? (recentInboxRes.data?.length || 0) : 0,
        lastTouchpointAt,
      }),
    },
  };
}

function buildMessage({ entity, interactionCount, openActionCount, recentInboxCount, lastTouchpointAt }) {
  const bits = [
    `${entity.entity_type}: ${entity.display_name}`,
    `${interactionCount} recent interaction${interactionCount === 1 ? '' : 's'}`,
  ];
  if (openActionCount)  bits.push(`${openActionCount} open task${openActionCount === 1 ? '' : 's'}`);
  if (recentInboxCount) bits.push(`${recentInboxCount} recent inbox item${recentInboxCount === 1 ? '' : 's'}`);
  if (lastTouchpointAt) bits.push(`last touched ${lastTouchpointAt.slice(0, 10)}`);
  return bits.join(' — ');
}
