// api/_handlers/memory-log-turn.js
// Handler for Copilot action: memory.log.turn.v1
//
// Explicit write: the agent can record a turn it considers worth remembering,
// keyed to an entity. Use cases:
//   - "Scott prefers to see dialysis properties before government ones."
//   - "Greg at Davita said they're only buying in Texas for Q3."
//   - "Don't pitch the Tulsa MOB to this investor — they passed in March."
//
// Different from automatic logging (which happens for every write action) —
// this lets the agent deliberately capture insight/preference/context that
// would otherwise be lost.

import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { logCopilotInteraction } from '../_shared/memory.js';

/**
 * @param {object} args
 * @param {object} args.inputs
 * @param {string} args.inputs.summary         — one-line human summary (required)
 * @param {string} [args.inputs.turn_text]     — verbatim text (optional)
 * @param {string} [args.inputs.entity_id]     — UUID of entity this turn relates to
 * @param {string} [args.inputs.entity_name]   — alt: fuzzy name lookup
 * @param {('copilot_chat'|'outlook'|'teams'|'sidebar')} args.inputs.channel
 * @param {('preference'|'insight'|'commitment'|'objection'|'note')} [args.inputs.kind]
 * @param {object} [args.inputs.metadata]
 * @param {object} args.authContext
 * @param {string} [args.workspaceId]
 */
export async function handleMemoryLogTurn({ inputs, authContext, workspaceId }) {
  if (!inputs?.summary || typeof inputs.summary !== 'string') {
    return { status: 400, body: { error: 'missing_summary', detail: 'summary (string) is required' } };
  }
  if (!inputs.channel) {
    return { status: 400, body: { error: 'missing_channel' } };
  }
  if (!authContext?.email) {
    return { status: 401, body: { error: 'missing_caller_identity' } };
  }
  const wsId = workspaceId;
  if (!wsId) return { status: 400, body: { error: 'missing_workspace_context' } };

  // Resolve entity if provided
  let entityId = null;
  if (inputs.entity_id) {
    if (!/^[0-9a-fA-F-]{36}$/.test(inputs.entity_id)) {
      return { status: 400, body: { error: 'invalid_entity_id' } };
    }
    const sel = await opsQuery('GET',
      `entities?id=eq.${pgFilterVal(inputs.entity_id)}&workspace_id=eq.${pgFilterVal(wsId)}&select=id&limit=1`
    );
    if (sel.ok && sel.data?.length) entityId = sel.data[0].id;
  } else if (inputs.entity_name) {
    const sel = await opsQuery('GET',
      `entities?workspace_id=eq.${pgFilterVal(wsId)}` +
      `&display_name=ilike.${pgFilterVal('%' + inputs.entity_name + '%')}` +
      `&select=id,display_name&order=updated_at.desc&limit=1`
    );
    if (sel.ok && sel.data?.length) entityId = sel.data[0].id;
  }

  // Resolve caller
  const callerEmail = authContext.email.toLowerCase();
  const userSel = await opsQuery('GET',
    `users?email=eq.${pgFilterVal(callerEmail)}&select=id&limit=1`
  );
  if (!userSel.ok || !userSel.data?.length) {
    return { status: 401, body: { error: 'user_not_resolved', detail: 'Caller email does not map to an LCC user.' } };
  }
  const userId = userSel.data[0].id;

  const result = await logCopilotInteraction({
    workspaceId: wsId,
    actorId:     userId,
    entityId,
    channel:     inputs.channel,
    actionId:    'memory.log.turn.v1',
    summary:     inputs.summary,
    turnText:    inputs.turn_text || null,
    metadata: {
      ...(inputs.metadata || {}),
      kind: inputs.kind || 'note',
      explicit: true,
    },
  });

  if (!result.ok) {
    return {
      status: 500,
      body: { error: 'log_failed', detail: result.detail || result.error },
    };
  }

  return {
    status: 200,
    body: {
      ok:                 true,
      activity_event_id:  result.id,
      entity_id:          entityId,
      fallback_category:  result.fallback || false,
      message:            `Logged ${inputs.kind || 'note'} for future recall.`,
    },
  };
}
