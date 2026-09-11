// ============================================================================
// OC1/OC2 — the operator-note funnel: one shared row shape, every channel.
//
// Spec: docs/architecture/EXEC-BRIEFS-SPEC.md §6. Contract:
// docs/architecture/operator_note_contract.md. Storage: operator_notes
// (EB1 migration 20260911165100).
//
// This module carries ONLY pure/testable logic (payload validation,
// deterministic triage rules, dedupe matching, routing) plus the DB helpers
// that call opsQuery. Channel-specific HTTP handlers (OC1) and the triage
// tick (OC2) both import from here so there is exactly one classifier, one
// router, one dedupe rule — never a JS copy per caller (the normaliser-drift
// footgun CLAUDE.md warns about a dozen times).
// ============================================================================

import { createRequire } from 'module';
import { opsQuery } from './ops-db.js';

const require = createRequire(import.meta.url);

export const OPERATOR_NOTE_CHANNELS = [
  'outlook_reply', 'outlook_tagged', 'in_app_note', 'teams', 'mcp', 'cowork', 'other',
];

export const OPERATOR_NOTE_TYPES = [
  'bug', 'data-gap', 'not-connecting', 'idea', 'ux', 'question',
];

export const OPERATOR_NOTE_DISPOSITIONS = [
  'open', 'routed', 'in_progress', 'closed', 'superseded', 'refuted',
];

// Default routing table — read from disk (docs/os/operator-note-routing.json)
// when present; this literal is the fallback so the module still works if
// that file is missing (never crash intake because a JSON file didn't ship).
export const DEFAULT_ROUTING_TABLE = {
  threads: [
    { thread: 'app/briefing', keywords: ['brief', 'briefing', 'daily email', 'digest', 'analyst take'] },
    { thread: 'automation', keywords: ['cron', 'tick', 'pipeline', 'sync', 'ingest', 'ingestion', 'flow', 'power automate'] },
    { thread: 'data-coherence', keywords: ['wrong data', 'incorrect', 'conflicting', 'duplicate', 'mismatch', 'stale', 'missing data', 'data gap'] },
    { thread: 'surfaces/canon', keywords: ['canon', 'copilot', 'chatgpt', 'northmarq claude', 'surface sync'] },
    { thread: 'comps', keywords: ['comp', 'comps', 'cap rate', 'bov', 'capital markets'] },
    { thread: 'buyer-engagement', keywords: ['buyer', 'tier 0', 'owner contact', 'call sheet', 'prospecting'] },
    { thread: 'exec-briefs', keywords: ['market brief', 'exec brief', 'build brief', 'operator inbox', 'operator note'] },
  ],
  // A note that matches none of the above is left unrouted rather than
  // guessed at (the standing never-guess doctrine) — the triage tick records
  // WHY in metadata.triage_reason.
};

// ----------------------------------------------------------------------------
// OC1 — intake payload validation (one shape per channel, per the contract).
// ----------------------------------------------------------------------------

/**
 * Pure. Validates + normalizes an incoming intake payload into the exact
 * shape operator_notes expects. Returns { ok:true, row } or { ok:false, error }.
 * Never throws. Intake must never fail because a model is down — this
 * function does no network I/O and no triage; it only checks the contract.
 */
export function validateOperatorNotePayload(body, { defaultChannel } = {}) {
  const p = body && typeof body === 'object' ? body : {};
  const channel = String(p.channel || defaultChannel || '').trim();
  if (!channel) return { ok: false, error: 'channel is required' };
  if (!OPERATOR_NOTE_CHANNELS.includes(channel)) {
    return { ok: false, error: `channel must be one of: ${OPERATOR_NOTE_CHANNELS.join(', ')}` };
  }

  const rawText = typeof p.raw_text === 'string' ? p.raw_text.trim() : '';
  if (!rawText) return { ok: false, error: 'raw_text is required' };

  const context = p.context && typeof p.context === 'object' && !Array.isArray(p.context) ? p.context : {};
  const attachments = Array.isArray(p.attachments) ? p.attachments : [];
  const receivedFrom = p.received_from != null ? String(p.received_from).slice(0, 500) : null;

  // A channel-native id (idempotency key), when the caller supplies one —
  // e.g. the Outlook internet_message_id, a Teams message id, an MCP
  // session+ordinal. Optional; carried in context/metadata, never a top-level
  // column (the migration has none), so idempotency is enforced by the
  // caller checking first (see findExistingByIdempotencyKey below).
  const idempotencyKey = p.idempotency_key != null ? String(p.idempotency_key).slice(0, 500) : null;

  return {
    ok: true,
    row: {
      channel,
      raw_text: rawText.slice(0, 20000),
      attachments,
      context,
      received_from: receivedFrom,
    },
    idempotencyKey,
  };
}

/**
 * Idempotency: given a channel-native id (e.g. Outlook internet_message_id),
 * find an existing operator_notes row that already carries it in
 * context/metadata, so a retried webhook never mints a duplicate row.
 * Returns the existing row's {id, disposition} or null.
 */
export async function findExistingByIdempotencyKey(channel, idempotencyKey, deps = {}) {
  if (!idempotencyKey) return null;
  const q = deps.opsQuery || opsQuery;
  const path = `operator_notes?channel=eq.${encodeURIComponent(channel)}`
    + `&context->>idempotency_key=eq.${encodeURIComponent(idempotencyKey)}`
    + `&select=id,disposition&limit=1`;
  const r = await q('GET', path).catch(() => null);
  const row = Array.isArray(r?.data) ? r.data[0] : null;
  return row ? { id: row.id, disposition: row.disposition } : null;
}

/**
 * Inserts one operator_notes row. Returns {ok, id, disposition, error}.
 */
export async function insertOperatorNote(row, { idempotencyKey } = {}, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const context = idempotencyKey
    ? { ...(row.context || {}), idempotency_key: idempotencyKey }
    : (row.context || {});
  const payload = { ...row, context, disposition: 'open' };
  const r = await q('POST', 'operator_notes', payload, { headers: { Prefer: 'return=representation' } });
  if (!r || r.ok === false) {
    return { ok: false, error: r?.data?.message || r?.data?.error || 'insert failed' };
  }
  const inserted = Array.isArray(r.data) ? r.data[0] : r.data;
  return { ok: true, id: inserted?.id, disposition: inserted?.disposition || 'open' };
}

// ----------------------------------------------------------------------------
// OC2 — deterministic triage rules (checked BEFORE any model call).
// ----------------------------------------------------------------------------

const ERROR_SIGNATURES = [
  /typeerror/i, /referenceerror/i, /undefined is not a function/i, /cannot read propert/i,
  /\b5\d{2}\b.*error/i, /err_/i, /failed to fetch/i, /network error/i, /unhandled/i,
  /stack trace/i, /exception/i,
];
const NOT_CONNECTING_SIGNATURES = [
  /stuck loading/i, /shows? 0\b/i, /blank (page|screen|panel)/i, /never loads?/i,
  /spinner/i, /\[\]\s*$/i, /nothing (shows|renders|loads)/i, /won'?t load/i,
];
const DATA_GAP_SIGNATURES = [
  /missing data/i, /no data/i, /data gap/i, /doesn'?t have (a|any)/i, /not on file/i,
  /empty (for|on)/i, /gap in/i,
];
const IDEA_SIGNATURES = [
  /\bidea\b/i, /would be (nice|great|useful)/i, /feature request/i, /(you|we) should (add|build)/i,
  /it would help if/i, /suggestion/i,
];
const UX_SIGNATURES = [
  /confusing/i, /hard to (find|use|tell)/i, /\bux\b/i, /\blayout\b/i, /\bbutton\b/i,
  /hidden away/i, /can'?t find/i,
];

/** Pure. Returns a {note_type, severity, matched_rule} verdict or null when
 * no deterministic rule fires (the caller then falls to on-box Ollama). */
export function classifyDeterministic(rawText, context = {}) {
  const text = String(rawText || '');
  const recentErrors = Array.isArray(context?.recent_errors) ? context.recent_errors.join(' ') : '';
  const combined = `${text} ${recentErrors}`;

  const hit = (patterns) => patterns.find((re) => re.test(combined));

  let m = hit(ERROR_SIGNATURES);
  if (m || recentErrors) {
    const severe = /\bfatal\b|\bcrash/i.test(combined) || /\b5\d{2}\b/.test(combined);
    return { note_type: 'bug', severity: severe ? 'high' : 'medium', matched_rule: m ? String(m) : 'recent_errors_present' };
  }

  m = hit(NOT_CONNECTING_SIGNATURES);
  if (m) return { note_type: 'not-connecting', severity: 'medium', matched_rule: String(m) };

  m = hit(DATA_GAP_SIGNATURES);
  if (m) return { note_type: 'data-gap', severity: 'medium', matched_rule: String(m) };

  m = hit(IDEA_SIGNATURES);
  if (m) return { note_type: 'idea', severity: 'low', matched_rule: String(m) };

  m = hit(UX_SIGNATURES);
  if (m) return { note_type: 'ux', severity: 'low', matched_rule: String(m) };

  if (/\?\s*$/.test(text.trim())) {
    return { note_type: 'question', severity: 'low', matched_rule: 'trailing_question_mark' };
  }

  return null;
}

// ----------------------------------------------------------------------------
// Routing (spec §6: "a routing table kept in canon").
// ----------------------------------------------------------------------------

let _routingTableCache = null;
/** Loads docs/os/operator-note-routing.json once per process; falls back to
 * DEFAULT_ROUTING_TABLE if the file is absent or malformed. */
export function loadRoutingTable({ fs: fsModule, path: pathModule } = {}) {
  if (_routingTableCache) return _routingTableCache;
  try {
    // eslint-disable-next-line global-require
    const fsm = fsModule || require('node:fs');
    const pm = pathModule || require('node:path');
    const p = pm.resolve(process.cwd(), 'docs/os/operator-note-routing.json');
    if (fsm.existsSync(p)) {
      const parsed = JSON.parse(fsm.readFileSync(p, 'utf8'));
      if (parsed && Array.isArray(parsed.threads)) {
        _routingTableCache = parsed;
        return parsed;
      }
    }
  } catch (_e) { /* fall through to default */ }
  _routingTableCache = DEFAULT_ROUTING_TABLE;
  return DEFAULT_ROUTING_TABLE;
}

/** Pure given a table. Returns {routed_to, reason} — routed_to is null when
 * nothing matches (never guess; the note stays open with a reason). */
export function routeNote({ rawText, noteType, lane }, routingTable = DEFAULT_ROUTING_TABLE) {
  const text = `${rawText || ''} ${noteType || ''} ${lane || ''}`.toLowerCase();
  const threads = Array.isArray(routingTable?.threads) ? routingTable.threads : [];
  for (const t of threads) {
    const kws = Array.isArray(t.keywords) ? t.keywords : [];
    if (kws.some((kw) => text.includes(String(kw).toLowerCase()))) {
      return { routed_to: t.thread, reason: `matched keyword set for ${t.thread}` };
    }
  }
  return { routed_to: null, reason: 'no_routing_keyword_matched' };
}

// ----------------------------------------------------------------------------
// Dedupe (spec §6: "dedupe against open PLANNED-BACKLOG rows and prior notes").
// ----------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'and', 'or',
  'it', 'this', 'that', 'for', 'with', 'be', 'as', 'at', 'by', 'not', 'no', 'has',
  'have', 'had', 'i', 'we', 'you', 'they', 'them', 'my', 'our',
]);

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/** Pure. Jaccard token-overlap similarity, 0..1. */
export function textSimilarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export const DEDUPE_THRESHOLD = 0.5;

/**
 * Pure. candidates: array of {id, raw_text} (prior notes) or
 * {row_id, title} (backlog index rows). Returns the best match at/above
 * DEDUPE_THRESHOLD, or null.
 */
export function findBestTextMatch(rawText, candidates, { textKey = 'raw_text', idKey = 'id' } = {}) {
  let best = null;
  for (const c of candidates || []) {
    const score = textSimilarity(rawText, c[textKey]);
    if (score >= DEDUPE_THRESHOLD && (!best || score > best.score)) {
      best = { id: c[idKey], score };
    }
  }
  return best;
}

/** Loads the generated backlog index (docs/os/operator-note-backlog-index.json),
 * an array of {row_id, title, section}. Returns [] if absent. */
export function loadBacklogIndex({ fs: fsModule, path: pathModule } = {}) {
  try {
    // eslint-disable-next-line global-require
    const fsm = fsModule || require('node:fs');
    const pm = pathModule || require('node:path');
    const p = pm.resolve(process.cwd(), 'docs/os/operator-note-backlog-index.json');
    if (fsm.existsSync(p)) {
      const parsed = JSON.parse(fsm.readFileSync(p, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_e) { /* absent/malformed -> empty index, never crash triage */ }
  return [];
}

// ----------------------------------------------------------------------------
// Shared DB reads for the triage tick + inbox renderer.
// ----------------------------------------------------------------------------

/** Fetches open, untriaged notes (disposition='open' AND triaged_at IS NULL). */
export async function fetchOpenUntriagedNotes(limit = 50, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const path = `operator_notes?disposition=eq.open&triaged_at=is.null`
    + `&select=id,channel,raw_text,context,received_from,received_at,note_type,lane,severity`
    + `&order=received_at.asc&limit=${Math.min(Math.max(Number(limit) || 50, 1), 200)}`;
  const r = await q('GET', path);
  return Array.isArray(r?.data) ? r.data : [];
}

/** Fetches prior notes to dedupe against (any disposition other than
 * closed/superseded/refuted — an actively-open or in-flight note can still
 * be the original of a duplicate). */
export async function fetchPriorNotesForDedupe(excludeId, limit = 300, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const path = `operator_notes?id=neq.${excludeId}`
    + `&disposition=in.(open,routed,in_progress)`
    + `&select=id,raw_text&order=received_at.desc&limit=${Math.min(Math.max(Number(limit) || 300, 1), 1000)}`;
  const r = await q('GET', path);
  return Array.isArray(r?.data) ? r.data : [];
}

/** Writes the triage verdict onto one note. */
export async function applyTriageVerdict(id, verdict, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const patch = {
    note_type: verdict.note_type || null,
    lane: verdict.lane || null,
    severity: verdict.severity || null,
    dedupe_of: verdict.dedupe_of || null,
    routed_to: verdict.routed_to || null,
    triaged_at: new Date().toISOString(),
    metadata: verdict.metadata || {},
  };
  if (verdict.routed_to) patch.disposition = 'routed';
  const r = await q('PATCH', `operator_notes?id=eq.${id}`, patch);
  return r?.ok !== false;
}
