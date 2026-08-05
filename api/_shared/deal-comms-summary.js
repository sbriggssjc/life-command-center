// api/_shared/deal-comms-summary.js
// W7.2 — correspondence-summary prompt builder + response parser for the
// deal-comms propagation tick. The LLM SUMMARIZES and PROPOSES only; nothing
// here writes. The no-fabrication contract (the dossier standard) is baked into
// the prompt: absent info is omitted, never guessed ("presumably"/"likely" are
// banned), and every claim must be grounded in the supplied comm rows.
//
// Pure + testable: buildSummaryPrompt(deal, comms) -> string;
// parseSummaryResponse(raw) -> { summary, topics[], milestone_candidates[] } | null.

// Compress the corpus for the prompt: the newest KEEP_DETAIL keep their body;
// older threads collapse to a subject/sender/date one-liner (older topics decay).
const KEEP_DETAIL = 10;
const BODY_CAP = 1200;

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toISOString().slice(0, 10); } catch { return String(d).slice(0, 10); }
}

function oneLiner(c) {
  const dir = c.direction === 'outbound' ? 'SENT' : c.direction === 'inbound' ? 'RECV' : '—';
  const who = c.sender ? ` ${String(c.sender).slice(0, 60)}` : '';
  return `- [${fmtDate(c.occurred_at)}] (${dir}${who}) ${String(c.subject || '(no subject)').slice(0, 140)}`;
}

function detailBlock(c) {
  const dir = c.direction === 'outbound' ? 'SENT by Team Briggs' : c.direction === 'inbound' ? 'RECEIVED' : 'direction unknown';
  const who = c.sender ? ` — ${String(c.sender).slice(0, 80)}` : '';
  const body = String(c.body || '').replace(/\s+/g, ' ').trim().slice(0, BODY_CAP);
  return [
    `### [${fmtDate(c.occurred_at)}] ${dir}${who}`,
    `Subject: ${String(c.subject || '(no subject)').slice(0, 200)}`,
    body ? `Message: ${body}` : 'Message: (no body captured)',
  ].join('\n');
}

/**
 * Build the summarization prompt from a deal's comm corpus.
 * @param {object} deal   { entity_id, deal_name }
 * @param {Array}  comms  the deal's stamped comm rows (any order; both inbound + sent)
 * @returns {string}
 */
export function buildSummaryPrompt(deal, comms) {
  const rows = (Array.isArray(comms) ? comms : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0)); // newest first

  const recent = rows.slice(0, KEEP_DETAIL);
  const older = rows.slice(KEEP_DETAIL);

  const parts = [
    'You are the deal desk analyst for Team Briggs, a commercial real estate brokerage.',
    'Summarize the correspondence on ONE deal for a living deal dossier. Team Briggs is the BROKER; both inbound mail and mail SENT by Team Briggs are first-class signal.',
    deal?.deal_name ? `Deal: ${deal.deal_name}` : null,
    '',
    'STRICT no-fabrication contract:',
    '- Use ONLY the messages below. Do not invent parties, prices, dates, or outcomes.',
    '- If something is not stated, OMIT it. Never write "presumably", "likely", "probably", or guess.',
    '- Prefer specifics that appear verbatim (who, what stage, what is owed next).',
    '',
    `MOST RECENT MESSAGES (keep detail — up to ${KEEP_DETAIL}):`,
    recent.map(detailBlock).join('\n\n') || '(none)',
  ];
  if (older.length) {
    parts.push('', `OLDER THREAD (compressed to one-liners — ${older.length} message(s)):`, older.map(oneLiner).join('\n'));
  }
  parts.push(
    '',
    'Respond with ONLY a compact JSON object, no prose, no code fence:',
    '{',
    '  "summary": "<2-5 sentence rolling summary; newest state first; older topics compressed>",',
    '  "topics": ["<short topic tag>", ...],',
    '  "milestone_candidates": [',
    '     {"key":"<loi|psa|escrow|diligence|financing|marketing|close>","label":"<what happened>","date":"<YYYY-MM-DD or empty>","confidence":<0..1>}',
    '  ]',
    '}',
    'milestone_candidates: include ONLY transaction milestones the messages clearly evidence; [] if none. These are PROPOSALS for human confirmation, never facts.',
  );
  return parts.filter((p) => p !== null).join('\n');
}

/**
 * Build an INCREMENTAL summarization prompt (W7.2c). Instead of re-summarizing
 * the full corpus every tick, we feed the persisted compressed-history block
 * (everything up to the last watermark) PLUS only the messages newer than the
 * watermark. The model returns the new rolling summary AND an updated
 * compressed_block that folds the new slice into the history.
 *
 * The no-fabrication contract extends to the compression: the compressed_block
 * may ONLY restate what the prior compressed_block + the new messages contain —
 * it never invents parties, prices, dates, or outcomes.
 *
 * @param {object} deal            { entity_id, deal_name }
 * @param {Array}  newComms        messages newer than the watermark (any order)
 * @param {string} compressedBlock the prior compressed-history text
 * @returns {string}
 */
export function buildIncrementalSummaryPrompt(deal, newComms, compressedBlock) {
  const rows = (Array.isArray(newComms) ? newComms : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0)); // newest first

  const parts = [
    'You are the deal desk analyst for Team Briggs, a commercial real estate brokerage.',
    'Update the living correspondence summary on ONE deal. Team Briggs is the BROKER; both inbound mail and mail SENT by Team Briggs are first-class signal.',
    deal?.deal_name ? `Deal: ${deal.deal_name}` : null,
    '',
    'STRICT no-fabrication contract (applies to BOTH the summary AND the compressed history):',
    '- Use ONLY the compressed history and the new messages below. Do not invent parties, prices, dates, or outcomes.',
    '- The compressed history is already-verified prior output — restate it faithfully; never add facts not present in it or the new messages.',
    '- If something is not stated, OMIT it. Never write "presumably", "likely", "probably", or guess.',
    '',
    'COMPRESSED HISTORY (everything up to the last update — treat as ground truth):',
    String(compressedBlock || '(none)').slice(0, 6000),
    '',
    `NEW MESSAGES SINCE THE LAST UPDATE (${rows.length}):`,
    rows.map(detailBlock).join('\n\n') || '(none)',
    '',
    'Respond with ONLY a compact JSON object, no prose, no code fence:',
    '{',
    '  "summary": "<2-5 sentence rolling summary; newest state first; older topics compressed>",',
    '  "topics": ["<short topic tag>", ...],',
    '  "compressed_block": "<the FULL compressed history restated to fold in the new messages; bounded, older detail decayed to one-liners>",',
    '  "milestone_candidates": [',
    '     {"key":"<loi|psa|escrow|diligence|financing|marketing|close>","label":"<what happened>","date":"<YYYY-MM-DD or empty>","confidence":<0..1>}',
    '  ]',
    '}',
    'milestone_candidates: include ONLY transaction milestones the NEW messages clearly evidence; [] if none. These are PROPOSALS for human confirmation, never facts.',
  ];
  return parts.filter((p) => p !== null).join('\n');
}

// Defensive JSON extraction (string or already-parsed object).
export function parseSummaryResponse(raw) {
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
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  if (!summary) return null; // an empty summary is a skip, not a write
  const topics = Array.isArray(obj.topics)
    ? obj.topics.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  const cands = Array.isArray(obj.milestone_candidates)
    ? obj.milestone_candidates
        .filter((c) => c && typeof c === 'object' && c.key)
        .map((c) => ({
          key: String(c.key).trim().toLowerCase(),
          label: String(c.label || '').trim().slice(0, 200),
          date: /^\d{4}-\d{2}-\d{2}$/.test(String(c.date || '')) ? String(c.date) : null,
          confidence: Number.isFinite(Number(c.confidence)) ? Number(c.confidence) : null,
        }))
        .slice(0, 12)
    : [];
  const compressedBlock = typeof obj.compressed_block === 'string'
    ? obj.compressed_block.trim().slice(0, 8000)
    : null;
  return { summary: summary.slice(0, 4000), topics, milestone_candidates: cands, compressed_block: compressedBlock || null };
}

export const __test__ = { KEEP_DETAIL, oneLiner, detailBlock };
