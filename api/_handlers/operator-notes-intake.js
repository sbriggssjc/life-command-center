// ============================================================================
// OC1 — operator-note intake: one endpoint, every channel.
//
// POST /api/operator-notes
// Contract: docs/architecture/operator_note_contract.md. Accepts the payload
// shape for `in_app_note`, `mcp`, `cowork`, `teams`, `other` (Outlook's two
// channels route through intake-tagged-comm.js — see below). Inserts one
// operator_notes row and returns { id, disposition }. NEVER triages inline —
// triage is a separate tick (OC2) so intake can never fail because a model
// is down.
//
// Auth: a signed-in operator (X-LCC-Key / JWT via authenticate()), OR the PA
// webhook secret (X-PA-Webhook-Secret) for Teams — mirrors
// intake-tagged-comm.js's authenticateWebhook() exactly, so both operator
// intake surfaces share one secret and one auth shape.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import {
  findExistingByIdempotencyKey,
  insertOperatorNote,
  validateOperatorNotePayload,
} from '../_shared/operator-notes.js';

const PA_WEBHOOK_SECRET = process.env.PA_WEBHOOK_SECRET;

function authenticateWebhook(req) {
  if (!PA_WEBHOOK_SECRET) return true; // transitional: allow when unconfigured (matches intake-tagged-comm.js)
  const provided = req.headers['x-pa-webhook-secret'] || '';
  if (!provided || provided.length !== PA_WEBHOOK_SECRET.length) return false;
  let mismatch = 0;
  for (let i = 0; i < PA_WEBHOOK_SECRET.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ PA_WEBHOOK_SECRET.charCodeAt(i);
  }
  return mismatch === 0;
}

// Channels that MAY authenticate via the webhook secret instead of a signed-in
// operator (Teams/PA). Every other channel requires a real operator identity —
// an in-app Note, MCP tool call, or Cowork post always carries a session.
const WEBHOOK_ELIGIBLE_CHANNELS = new Set(['teams', 'other']);

export async function handleOperatorNoteIntake(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body || {};
  const channel = String(body.channel || '').trim();

  let user = null;
  if (!(WEBHOOK_ELIGIBLE_CHANNELS.has(channel) && authenticateWebhook(req))) {
    user = await authenticate(req, res);
    if (!user) return; // authenticate() already responded (401)
  }

  const validated = validateOperatorNotePayload(body);
  if (!validated.ok) return res.status(400).json({ error: validated.error });

  // Idempotency on a channel-native id, when supplied (e.g. a Teams message
  // id, an MCP session+ordinal). A channel with no natural id (a plain
  // in-app text box) simply omits it and always inserts.
  if (validated.idempotencyKey) {
    const existing = await findExistingByIdempotencyKey(validated.row.channel, validated.idempotencyKey).catch(() => null);
    if (existing) {
      return res.status(200).json({ id: existing.id, disposition: existing.disposition, duplicate: true });
    }
  }

  // received_from defaults to the signed-in operator's email when the
  // caller didn't supply one and we have a session (in-app Note button).
  const row = { ...validated.row };
  if (!row.received_from && user?.email) row.received_from = user.email;

  const result = await insertOperatorNote(row, { idempotencyKey: validated.idempotencyKey });
  if (!result.ok) return res.status(502).json({ error: result.error || 'failed to log the note' });

  return res.status(200).json({ id: result.id, disposition: result.disposition });
}

export default handleOperatorNoteIntake;
