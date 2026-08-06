// api/_shared/deal-role-issues.js
// ============================================================================
// W7.4 — party ROLE evolution + OPEN-ISSUES extraction from a deal's attributed
// comm corpus. See docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md §W7.4.
//
// The LLM PROPOSES only; nothing here writes. Every proposed role and every
// issue MUST carry evidence (source comm ids + a short quoted span). The
// evidence VALIDATOR (validateEvidence) DROPS any proposal whose quote does not
// appear verbatim — normalized whitespace — in the CITED comm (right text but the
// wrong comm id is also dropped). Dropped proposals are logged by the caller,
// never surfaced. This is the no-fabrication contract (the dossier standard),
// mechanically enforced, mirroring how the summary pass is grounded.
//
// Pure + testable — this module never touches the DB:
//   buildRoleIssuesPrompt(deal, comms, priorOpenIssues) -> string
//   parseRoleIssuesResponse(raw) -> { roles, issues, closures } | null
//   validateEvidence(evidence[], commsById) -> { evidence: kept[], dropped[] }
//   validateProposal(proposal, commsById) -> { proposal|null, dropped[] }
//   applyIssueLifecycle(priorOpenIssues, parsed, commsById) -> { issues, dropped }
//   commsIndex(comms) -> Map<activity_id, { subject, body }>
//   roleIssuesWatermark(comms) -> string   (source_hash-style, for idempotency)
// ============================================================================

import { createHash } from 'node:crypto';

// Canonical role vocabulary the model may emerge parties INTO (proposals only —
// never a fact write). Anything off-list is dropped by the parser.
export const ROLE_KEYS = [
  'decision_maker',
  'transaction_manager',
  'attorney',
  'lender',
  'broker',
  'analyst',
  'principal',
  'other',
];

// Canonical open-issue kinds.
export const ISSUE_KINDS = ['ask', 'question', 'commitment', 'deadline'];

const MIN_QUOTE_CHARS = 8;   // a quote shorter than this can't ground anything
const KEEP_DETAIL = 12;
const BODY_CAP = 1400;

// ── whitespace-normalized verbatim matching ─────────────────────────────────
export function normalizeForMatch(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

// The searchable text for one comm = subject + body (both are first-class).
function commText(c) {
  return `${c?.subject || ''}\n${c?.body || ''}`;
}

/** Index a comm corpus by activity_id → { subject, body } for evidence lookup. */
export function commsIndex(comms) {
  const m = new Map();
  for (const c of (Array.isArray(comms) ? comms : [])) {
    if (c && c.activity_id) m.set(String(c.activity_id), { subject: c.subject || '', body: c.body || '' });
  }
  return m;
}

/**
 * Does a quote appear VERBATIM (whitespace-normalized) in the CITED comm?
 * @param {string} quote
 * @param {string} commId
 * @param {Map} commsById  activity_id → { subject, body }
 */
export function quoteVerbatimInComm(quote, commId, commsById) {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;         // too short to be evidence
  const comm = commsById.get(String(commId));
  if (!comm) return false;                               // wrong / unknown comm id → drop
  return normalizeForMatch(commText(comm)).includes(q);
}

/**
 * Validate an evidence[] array. Keeps only entries whose quote appears verbatim
 * in the cited comm; returns the survivors and the dropped ones (with a reason).
 * @returns {{ evidence: Array, dropped: Array }}
 */
export function validateEvidence(evidence, commsById) {
  const kept = [];
  const dropped = [];
  for (const e of (Array.isArray(evidence) ? evidence : [])) {
    const commId = e && (e.comm_id ?? e.activity_id);
    const quote = e && e.quote;
    if (!commId || !quote) { dropped.push({ comm_id: commId || null, quote: quote || null, reason: 'incomplete' }); continue; }
    if (quoteVerbatimInComm(quote, commId, commsById)) {
      kept.push({ comm_id: String(commId), quote: String(quote).slice(0, 400) });
    } else {
      const known = commsById.has(String(commId));
      dropped.push({ comm_id: String(commId), quote: String(quote).slice(0, 200), reason: known ? 'quote_not_verbatim' : 'unknown_comm' });
    }
  }
  return { evidence: kept, dropped };
}

/**
 * Validate one proposal (role or issue). A proposal survives ONLY if ≥1 of its
 * evidence entries is verbatim. Returns the proposal with filtered evidence, or
 * null if it was dropped entirely.
 * @returns {{ proposal: object|null, dropped: Array }}
 */
export function validateProposal(proposal, commsById) {
  if (!proposal || typeof proposal !== 'object') return { proposal: null, dropped: [] };
  const { evidence, dropped } = validateEvidence(proposal.evidence, commsById);
  if (!evidence.length) {
    return { proposal: null, dropped: dropped.length ? dropped : [{ reason: 'no_evidence' }] };
  }
  return { proposal: { ...proposal, evidence }, dropped };
}

// ── prompt builder ──────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toISOString().slice(0, 10); } catch { return String(d).slice(0, 10); }
}

function detailBlock(c) {
  const dir = c.direction === 'outbound' ? 'SENT by Team Briggs'
    : c.direction === 'inbound' ? 'RECEIVED' : 'direction unknown';
  const who = c.sender ? ` — ${String(c.sender).slice(0, 80)}` : '';
  const body = String(c.body || '').replace(/\s+/g, ' ').trim().slice(0, BODY_CAP);
  return [
    `### comm_id=${c.activity_id} [${fmtDate(c.occurred_at)}] ${dir}${who}`,
    `Subject: ${String(c.subject || '(no subject)').slice(0, 200)}`,
    body ? `Message: ${body}` : 'Message: (no body captured)',
  ].join('\n');
}

/**
 * Build ONE Ollama prompt that asks for (a) party role evolution and (b) open
 * issues, and re-presents prior OPEN issues asking which the NEW messages have
 * addressed. JSON-constrained; every proposal must cite comm_id + a verbatim quote.
 *
 * @param {object} deal              { entity_id, deal_name }
 * @param {Array}  comms            the deal's comm corpus (any order)
 * @param {Array}  priorOpenIssues  [{ id?, title, kind }] still-open from last pass
 * @returns {string}
 */
export function buildRoleIssuesPrompt(deal, comms, priorOpenIssues = []) {
  const rows = (Array.isArray(comms) ? comms : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0)); // newest first
  const recent = rows.slice(0, KEEP_DETAIL);

  const priorList = (Array.isArray(priorOpenIssues) ? priorOpenIssues : [])
    .filter((i) => i && i.title)
    .slice(0, 20)
    .map((i, ix) => `- issue_ref=${i.id || `p${ix}`} [${i.kind || 'ask'}] ${String(i.title).slice(0, 160)}`);

  const parts = [
    'You are the deal desk analyst for Team Briggs, a commercial real estate brokerage.',
    'From the correspondence on ONE deal, produce TWO proposal sets for a living dossier: (1) party ROLE evolution and (2) OPEN ISSUES / what is coming. Team Briggs is the BROKER; both inbound mail and mail SENT by Team Briggs are first-class signal.',
    deal?.deal_name ? `Deal: ${deal.deal_name}` : null,
    '',
    'STRICT no-fabrication + EVIDENCE contract (enforced by a validator that will DELETE any item failing it):',
    '- Use ONLY the messages below. Do not invent parties, prices, dates, roles, or outcomes.',
    '- EVERY role and EVERY issue MUST carry evidence: the comm_id it came from AND a short quote copied VERBATIM from that exact message (subject or body). No paraphrasing — copy the words.',
    '- If you cannot cite a verbatim quote, OMIT the item. Never write "presumably", "likely", "probably", or guess.',
    `- role MUST be one of: ${ROLE_KEYS.join(', ')}. issue kind MUST be one of: ${ISSUE_KINDS.join(', ')}.`,
    '',
    `MESSAGES (newest first, up to ${KEEP_DETAIL} with detail):`,
    recent.map(detailBlock).join('\n\n') || '(none)',
  ];
  if (priorList.length) {
    parts.push(
      '',
      'PREVIOUSLY-OPEN ISSUES (decide which the messages above now ADDRESS — closing an issue ALSO requires a verbatim quote as evidence):',
      priorList.join('\n'),
    );
  }
  parts.push(
    '',
    'Respond with ONLY a compact JSON object, no prose, no code fence:',
    '{',
    '  "roles": [',
    `     {"party":"<name as written>","proposed_role":"<${ROLE_KEYS.join('|')}>","confidence":<0..1>,`,
    '      "evidence":[{"comm_id":"<id>","quote":"<verbatim span>"}]}',
    '  ],',
    '  "issues": [',
    `     {"title":"<short outstanding item>","kind":"<${ISSUE_KINDS.join('|')}>","due_hint":"<YYYY-MM-DD or free text or empty>",`,
    '      "evidence":[{"comm_id":"<id>","quote":"<verbatim span>"}]}',
    '  ],',
    '  "closures": [',
    '     {"issue_ref":"<issue_ref from the list above>","evidence":[{"comm_id":"<id>","quote":"<verbatim span>"}]}',
    '  ]',
    '}',
    'roles/issues/closures are PROPOSALS for the dossier Analysis panel, never facts. Empty arrays are fine.',
  );
  return parts.filter((p) => p !== null).join('\n');
}

// ── response parser (defensive; string or already-parsed object) ────────────
function clampConfidence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

export function parseRoleIssuesResponse(raw) {
  if (raw == null) return null;
  let obj = null;
  if (typeof raw === 'object') obj = raw;
  else {
    const s = String(raw);
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { obj = JSON.parse(m[0]); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;

  const evArr = (e) => (Array.isArray(e) ? e : [])
    .filter((x) => x && typeof x === 'object' && (x.comm_id || x.activity_id) && x.quote)
    .map((x) => ({ comm_id: String(x.comm_id ?? x.activity_id), quote: String(x.quote).slice(0, 400) }))
    .slice(0, 12);

  const roles = (Array.isArray(obj.roles) ? obj.roles : [])
    .filter((r) => r && typeof r === 'object' && r.party && r.proposed_role)
    .map((r) => ({
      party: String(r.party).trim().slice(0, 160),
      proposed_role: String(r.proposed_role).trim().toLowerCase().replace(/[\s-]+/g, '_'),
      confidence: clampConfidence(r.confidence),
      evidence: evArr(r.evidence),
    }))
    .filter((r) => ROLE_KEYS.includes(r.proposed_role))
    .slice(0, 24);

  const issues = (Array.isArray(obj.issues) ? obj.issues : [])
    .filter((i) => i && typeof i === 'object' && i.title)
    .map((i) => {
      let kind = String(i.kind || 'ask').trim().toLowerCase();
      if (!ISSUE_KINDS.includes(kind)) kind = 'ask';
      return {
        title: String(i.title).trim().slice(0, 240),
        kind,
        due_hint: i.due_hint ? String(i.due_hint).trim().slice(0, 80) : null,
        status: 'open',
        evidence: evArr(i.evidence),
      };
    })
    .slice(0, 30);

  const closures = (Array.isArray(obj.closures) ? obj.closures : [])
    .filter((c) => c && typeof c === 'object' && c.issue_ref)
    .map((c) => ({ issue_ref: String(c.issue_ref).trim(), evidence: evArr(c.evidence) }))
    .slice(0, 30);

  return { roles, issues, closures };
}

// ── issue-key + set merge / lifecycle ───────────────────────────────────────
// A stable key for an issue so the same outstanding item across passes lines up.
export function issueKey(issue) {
  return normalizeForMatch(issue?.title).slice(0, 80);
}

/**
 * Apply the issue lifecycle for one pass. Validates evidence on every new issue
 * and every closure, carries forward still-open prior issues, folds newly-opened
 * issues, and flips issues the model closed (with verbatim closing evidence) to
 * status 'resolved' — keeping the row (the panel shows open + recently-resolved).
 *
 * @param {Array}  priorOpenIssues [{ id?, title, kind, status, evidence }]
 * @param {object} parsed          parseRoleIssuesResponse() output
 * @param {Map}    commsById       commsIndex()
 * @returns {{ issues: Array, dropped: Array, opened:number, closed:number, carried:number }}
 */
export function applyIssueLifecycle(priorOpenIssues, parsed, commsById) {
  const dropped = [];
  const byKey = new Map();

  // 1. carry forward prior open issues (still open unless a valid closure lands).
  let carried = 0;
  for (const p of (Array.isArray(priorOpenIssues) ? priorOpenIssues : [])) {
    if (!p || !p.title) continue;
    const k = issueKey(p);
    byKey.set(k, {
      id: p.id || null,
      title: String(p.title).slice(0, 240),
      kind: ISSUE_KINDS.includes(p.kind) ? p.kind : 'ask',
      due_hint: p.due_hint || null,
      status: 'open',
      evidence: Array.isArray(p.evidence) ? p.evidence : [],
      _prior: true,
    });
    carried += 1;
  }

  // 2. fold newly-proposed issues (evidence-validated). A new issue that keys to
  //    an already-tracked one refreshes its evidence but doesn't duplicate.
  let opened = 0;
  for (const iss of (parsed?.issues || [])) {
    const { proposal, dropped: d } = validateProposal(iss, commsById);
    if (d.length) dropped.push({ type: 'issue', title: iss.title, dropped: d });
    if (!proposal) continue;
    const k = issueKey(proposal);
    if (byKey.has(k)) {
      const cur = byKey.get(k);
      if (!cur.evidence.length) cur.evidence = proposal.evidence;
      if (!cur.due_hint && proposal.due_hint) cur.due_hint = proposal.due_hint;
    } else {
      byKey.set(k, { id: null, title: proposal.title, kind: proposal.kind, due_hint: proposal.due_hint || null, status: 'open', evidence: proposal.evidence });
      opened += 1;
    }
  }

  // 3. apply closures — match issue_ref back to a tracked issue by id or key,
  //    require verbatim closing evidence, flip to resolved (keep the row).
  let closed = 0;
  const priorByRef = new Map();
  (Array.isArray(priorOpenIssues) ? priorOpenIssues : []).forEach((p, ix) => {
    if (p && p.id) priorByRef.set(String(p.id), p);
    priorByRef.set(`p${ix}`, p);
  });
  for (const cl of (parsed?.closures || [])) {
    const { evidence, dropped: d } = validateEvidence(cl.evidence, commsById);
    if (d.length) dropped.push({ type: 'closure', issue_ref: cl.issue_ref, dropped: d });
    if (!evidence.length) continue;                        // no verbatim close evidence → stays open
    const target = priorByRef.get(String(cl.issue_ref));
    if (!target || !target.title) continue;
    const k = issueKey(target);
    const cur = byKey.get(k);
    if (cur && cur.status !== 'resolved') {
      cur.status = 'resolved';
      cur.closing_evidence = evidence;
      cur.resolved_at = new Date().toISOString();
      closed += 1;
    }
  }

  const issues = Array.from(byKey.values()).map((i) => { const { _prior, ...rest } = i; return rest; });
  return { issues, dropped, opened, closed, carried };
}

/**
 * Validate the role set (drop fabricated-quote roles); return survivors + dropped.
 * @returns {{ roles: Array, dropped: Array }}
 */
export function validateRoles(parsedRoles, commsById) {
  const roles = [];
  const dropped = [];
  for (const r of (Array.isArray(parsedRoles) ? parsedRoles : [])) {
    const { proposal, dropped: d } = validateProposal(r, commsById);
    if (d.length) dropped.push({ type: 'role', party: r.party, role: r.proposed_role, dropped: d });
    if (proposal) {
      // thread_count = distinct comms cited (drives the "per N threads" note).
      const threadCount = new Set(proposal.evidence.map((e) => e.comm_id)).size;
      roles.push({ ...proposal, thread_count: threadCount });
    }
  }
  return { roles, dropped };
}

// ── watermark (idempotency short-circuit) ───────────────────────────────────
// A source_hash-style digest over the comm SET considered — the same corpus
// yields the same watermark, so an unchanged corpus short-circuits to 0 writes.
export function roleIssuesWatermark(comms) {
  const ids = (Array.isArray(comms) ? comms : [])
    .filter(Boolean)
    .map((c) => `${c.activity_id || ''}:${c.occurred_at || ''}`)
    .sort();
  return createHash('sha256').update(JSON.stringify(ids)).digest('hex');
}

export const __test__ = { MIN_QUOTE_CHARS, commText, detailBlock, KEEP_DETAIL };
