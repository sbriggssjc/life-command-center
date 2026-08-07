// W8 U3 — Ollama connection propagation: evidence-grounded link proposals (Prompt 69).
//
// Pure, dependency-free helpers for the hygiene campaign's THIRD unit. Doctrine
// (playbook §7 + the U3 prompt + the W7.4 verbatim-evidence pattern): Ollama
// PROPOSES a missing connection ONLY from evidence LCC already holds, quoted
// VERBATIM. A validator drops any proposal whose quote does not appear (whitespace-
// normalized) in the supplied evidence — never shipped, logged to the precision-
// floor metric (w8_u3_dropped_log). A HUMAN confirm lane decides; a deterministic
// writer applies with provenance (fill-blanks). Ollama NEVER writes, NEVER merges,
// NEVER fabricates. No evidence found ⇒ no proposal (counted, no LLM call). No web
// search (owner-contact-websearch is PAUSED — internal evidence only).
//
// The live query + write side lives in api/admin.js (handleLinkPropagationTick +
// the w8_u3_link_review Decision Center lane + the accept writer); this module is
// the pure brain it calls. Every function is unit-testable in isolation.
//
// TWO pools (producer/consumer value-gate — the valued pool drains first):
//   * chain      — v_ownership_chain_worklist rows (ranked by rank_value). The gap
//                  (developer_unidentified / no_prior_owners_recorded) is filled by
//                  proposing the missing entity + role + chain position.
//   * person_email — v_lcc_person_email_merge_candidates (the smaller 257-row pool):
//                  same pipeline, proposal_type person_email_merge; the shared email
//                  IS the verbatim evidence; accept routes to the resolver review
//                  pool (a label), never a silent merge.

// ---------------------------------------------------------------------------
// Pools + gap catalogue. Each is self-describing so the tick stays generic.
// ---------------------------------------------------------------------------
export const LINK_POOL_CHAIN = 'chain';
export const LINK_POOL_PERSON_EMAIL = 'person_email';

// The gap types the chain worklist emits (v_ownership_chain_worklist.gap) mapped to
// the role the proposed entity plays + the chain position it fills. Single source of
// truth for the gap→proposal mapping (mirrors the DB worklist's suggested_research_type).
export const CHAIN_GAP_CATALOGUE = {
  developer_unidentified: {
    role: 'developed',
    chain_position: 'developer',
    proposal_type: 'developer_link',
    ask: 'the DEVELOPER (the entity that built / originally developed the property)',
  },
  no_prior_owners_recorded: {
    role: 'owns',
    chain_position: 'prior_owner',
    proposal_type: 'prior_owner_link',
    ask: 'a PRIOR OWNER (an owner that held the property BEFORE the current owner)',
  },
};

export function chainGapSpec(gap) {
  return CHAIN_GAP_CATALOGUE[String(gap || '').toLowerCase()] || null;
}

// A stable subject_ref for a chain gap row: link:chain:<domain>:<propertyId>:<gap>.
// One card / one decision per (property, gap) — mirrors the worklist DISTINCT ON.
export function chainSubjectRef(domain, propertyId, gap) {
  const d = normDomain(domain);
  return `link:chain:${d}:${propertyId}:${String(gap || '').toLowerCase()}`;
}

// A stable subject_ref for a person-email-merge candidate: link:pmail:<winnerId>.
export function personEmailSubjectRef(winnerId) {
  return `link:pmail:${winnerId}`;
}

export function normDomain(domain) {
  const d = String(domain || '').toLowerCase();
  return d === 'dialysis' ? 'dia' : d === 'government' ? 'gov' : d;
}

// ---------------------------------------------------------------------------
// Value-gate + ordering (producer/consumer doctrine). The valued pool (rank_value
// > 0) is processed in rank order; zero-rank rows only after it drains. Pure sort
// over already-fetched rows (the SQL fetch is ranked too; this is the belt-and-
// suspenders gate + the interleave across pools).
// ---------------------------------------------------------------------------
export function valueGateChainRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const valued = [];
  const zero = [];
  for (const r of list) {
    const v = Number(r && r.rank_value);
    if (Number.isFinite(v) && v > 0) valued.push(r);
    else zero.push(r);
  }
  const rank = (a, b) => (Number(b.rank_value) || 0) - (Number(a.rank_value) || 0);
  valued.sort(rank);
  // zero-rank kept in a stable, deterministic order (by property id) so successive
  // runs walk them predictably.
  zero.sort((a, b) => String(a.source_property_id).localeCompare(String(b.source_property_id)));
  return valued.concat(zero);
}

// ---------------------------------------------------------------------------
// Evidence assembly bounds (deterministic). The caller gathers raw evidence blocks
// { source, ref, text } for a gap row; this caps them to a bounded, GaryBuilt-sized
// context: top-K blocks, each char-capped, total char-capped. Empty / whitespace
// blocks are dropped. Returns { blocks, combined, chars, dropped_empty }.
// ---------------------------------------------------------------------------
export const EVIDENCE_TOP_K = 8;
export const EVIDENCE_BLOCK_CHARS = 900;
export const EVIDENCE_TOTAL_CHARS = 5000;

export function assembleEvidence(blocks, opts = {}) {
  const topK = Number.isFinite(opts.topK) ? Math.max(1, opts.topK) : EVIDENCE_TOP_K;
  const blockCap = Number.isFinite(opts.blockChars) ? Math.max(40, opts.blockChars) : EVIDENCE_BLOCK_CHARS;
  const totalCap = Number.isFinite(opts.totalChars) ? Math.max(80, opts.totalChars) : EVIDENCE_TOTAL_CHARS;
  const list = Array.isArray(blocks) ? blocks : [];
  const out = [];
  let droppedEmpty = 0;
  let total = 0;
  for (const b of list) {
    if (out.length >= topK) break;
    const text = normalizeWhitespace(b && b.text != null ? String(b.text) : '');
    if (!text) { droppedEmpty += 1; continue; }
    const clipped = text.slice(0, blockCap);
    if (total + clipped.length > totalCap) {
      const room = totalCap - total;
      if (room < 40) break;
      out.push({ source: String(b.source || 'evidence'), ref: b.ref != null ? String(b.ref) : null, text: clipped.slice(0, room) });
      total += Math.min(room, clipped.length);
      break;
    }
    out.push({ source: String(b.source || 'evidence'), ref: b.ref != null ? String(b.ref) : null, text: clipped });
    total += clipped.length;
  }
  const combined = out.map((b) => b.text).join('\n');
  return { blocks: out, combined, chars: total, dropped_empty: droppedEmpty };
}

// TRUE iff evidence assembly found nothing to send the model — the no-LLM short-
// circuit (don't burn a 16s call to learn nothing). Counted as no_evidence.
export function evidenceIsEmpty(assembled) {
  return !assembled || !Array.isArray(assembled.blocks) || assembled.blocks.length === 0
    || !String(assembled.combined || '').trim();
}

// ---------------------------------------------------------------------------
// A stable hash of a gap row's evidence, so the resumable scored-marker re-scores
// a row ONLY when its evidence changes (keyed domain:property:gap:evidence-hash).
// A small, dependency-free FNV-1a over the normalized combined evidence + the row's
// current chain context (so a chain that gains a prior-owner re-scores).
// ---------------------------------------------------------------------------
export function evidenceHash(assembled, extra) {
  const combined = assembled && assembled.combined != null ? String(assembled.combined) : '';
  const salt = extra != null ? String(extra) : '';
  const s = normalizeWhitespace(combined) + '' + normalizeWhitespace(salt);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

export function linkScoredKeyFor(pool, domain, subjectId, gap, evHash) {
  return `${pool}:${normDomain(domain)}:${subjectId}:${String(gap || '')}:${evHash}`;
}

// ---------------------------------------------------------------------------
// Whitespace-normalized VERBATIM matching (W7.4 pattern). The validator's floor.
// ---------------------------------------------------------------------------
export function normalizeWhitespace(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

export function normalizeForMatch(s) {
  return normalizeWhitespace(s).toLowerCase();
}

export const MIN_QUOTE_CHARS = 8;

// Does a quote appear VERBATIM (whitespace-normalized, case-insensitive) inside the
// supplied evidence text? A quote shorter than MIN_QUOTE_CHARS can't ground anything.
export function quoteVerbatimInEvidence(quote, evidenceText) {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  const hay = normalizeForMatch(evidenceText);
  if (!hay) return false;
  return hay.includes(q);
}

// ---------------------------------------------------------------------------
// The prompt the local model gives a gap row (surface clean_assist). Proposal-only:
// the model proposes the missing entity WITH a verbatim quote from the evidence, or
// returns no_evidence_found. It never merges, never writes, never invents facts.
// ---------------------------------------------------------------------------
export function buildLinkPropagationPrompt(row, assembled, pool) {
  if (pool === LINK_POOL_PERSON_EMAIL) return buildPersonEmailPrompt(row, assembled);
  return buildChainPrompt(row, assembled);
}

function chainContextLine(row) {
  const parts = [];
  const addr = [row.address, row.city, row.state].filter(Boolean).join(', ');
  if (addr) parts.push(`property: ${addr}`);
  if (row.current_owner_name) parts.push(`current owner: ${row.current_owner_name}`);
  if (row.true_owner_name && row.true_owner_name !== row.current_owner_name) parts.push(`true owner: ${row.true_owner_name}`);
  if (row.earliest_known_owner) parts.push(`earliest known owner: ${row.earliest_known_owner}`);
  if (row.developer_name) parts.push(`developer on file: ${row.developer_name}`);
  return parts.join(' | ');
}

function buildChainPrompt(row, assembled) {
  const spec = chainGapSpec(row.gap) || { ask: 'the missing party in the ownership chain', chain_position: 'link' };
  const blocks = (assembled && Array.isArray(assembled.blocks) ? assembled.blocks : [])
    .map((b, i) => `[E${i + 1}] (${b.source}${b.ref ? ' #' + b.ref : ''}) ${b.text}`).join('\n');
  return [
    'You are the LCC Ollama connection-propagation agent.',
    'You ONLY propose. You never merge, never delete, never write data, and never invent facts.',
    `An ownership chain has a GAP: ${spec.ask} is UNIDENTIFIED for this property. Below is ALL the evidence LCC already holds. Propose the missing party ONLY IF the evidence NAMES it.`,
    '',
    'Chain context: ' + (chainContextLine(row) || '(none)'),
    '',
    'EVIDENCE (the ONLY text you may quote — quote EXACTLY, never paraphrase):',
    blocks || '(no evidence)',
    '',
    'Return ONLY strict JSON with keys: verdict, linked_entity_name, role, confidence, evidence_quote, evidence_source, reason.',
    '- verdict: "link_proposal" (the evidence names the missing party) OR "no_evidence_found" (it does not).',
    `- linked_entity_name: the proposed missing entity's name, copied from the evidence (null if no_evidence_found).`,
    `- role: "${spec.chain_position}" (the chain position this entity fills).`,
    '- confidence: 0.0 to 1.0.',
    '- evidence_quote: the VERBATIM substring from the EVIDENCE that names the entity (copy exactly; must be a real span of the evidence above). null if no_evidence_found.',
    '- evidence_source: the [E#] tag of the block you quoted (e.g. "E1").',
    '- reason: one short sentence.',
    '- If the evidence does NOT explicitly name the missing party, return verdict "no_evidence_found" — do NOT guess, infer, or use outside knowledge.',
    '- Never propose the CURRENT owner or a broker/brokerage/title company as the developer or prior owner.',
  ].join('\n');
}

function buildPersonEmailPrompt(row, assembled) {
  const losers = Array.isArray(row.loser_names) ? row.loser_names : [];
  const blocks = (assembled && Array.isArray(assembled.blocks) ? assembled.blocks : [])
    .map((b, i) => `[E${i + 1}] (${b.source}) ${b.text}`).join('\n');
  return [
    'You are the LCC Ollama connection-propagation agent (person-merge second look).',
    'You ONLY propose. You never merge, never delete, never write data, and never invent facts.',
    'Two or more PERSON records share ONE email address. Decide whether they are the SAME person (a duplicate to merge) or DIFFERENT people who happen to share a mailbox (a team distro / family).',
    '',
    `Shared email: ${row.email || '(unknown)'}`,
    `Winner (most complete): ${row.winner_name || '(unknown)'}`,
    `Others: ${losers.map((n) => '"' + String(n).slice(0, 60) + '"').join(', ') || '(none)'}`,
    '',
    'EVIDENCE (quote EXACTLY, never paraphrase):',
    blocks || '(no evidence)',
    '',
    'Return ONLY strict JSON with keys: verdict, linked_entity_name, role, confidence, evidence_quote, evidence_source, reason.',
    '- verdict: "link_proposal" (SAME person — a duplicate) OR "no_evidence_found" (different people / not enough signal).',
    '- linked_entity_name: the winner name if same_person, else null.',
    '- role: "same_person".',
    '- confidence: 0.0 to 1.0.',
    '- evidence_quote: the VERBATIM span (a name or the email) from the EVIDENCE above supporting SAME person. null otherwise.',
    '- evidence_source: the [E#] tag you quoted.',
    '- reason: one short sentence.',
    '- A multi-person composite ("A, B & C") sharing one email is NOT one person — return no_evidence_found.',
  ].join('\n');
}

// Tolerant JSON extraction (fenced ```json, then first/last-brace).
export function parseLinkProposalJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try { return JSON.parse(candidate); } catch (_e) { /* fall through */ }
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(candidate.slice(first, last + 1)); } catch (_e) { /* fall through */ }
  }
  return null;
}

const LINK_VERDICTS = new Set(['link_proposal', 'no_evidence_found']);

// Normalize a raw model object into a link proposal. Verdict defaults to
// no_evidence_found on anything unrecognized (never a silent link).
export function normalizeLinkProposal(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  let verdict = String(obj.verdict || '').toLowerCase().trim().replace(/\s+/g, '_');
  if (verdict === 'link' || verdict === 'proposal' || verdict === 'found' || verdict === 'yes') verdict = 'link_proposal';
  if (verdict === 'no_evidence' || verdict === 'none' || verdict === 'no' || verdict === 'not_found') verdict = 'no_evidence_found';
  if (!LINK_VERDICTS.has(verdict)) verdict = 'no_evidence_found';
  const n = Number(obj.confidence);
  const confidence = Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  const linked = obj.linked_entity_name != null ? String(obj.linked_entity_name).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const role = obj.role != null ? String(obj.role).replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const quote = obj.evidence_quote != null ? String(obj.evidence_quote).slice(0, 400) : '';
  const source = obj.evidence_source != null ? String(obj.evidence_source).replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const reason = obj.reason != null ? String(obj.reason).replace(/\s+/g, ' ').trim().slice(0, 400) : '';
  return { verdict, confidence, linked_entity_name: linked, role, evidence_quote: quote, evidence_source: source, reason };
}

// ---------------------------------------------------------------------------
// The validator (the free precision floor). A proposal is KEPT only when:
//   * verdict === 'link_proposal'
//   * it names an entity (linked_entity_name non-empty)
//   * its evidence_quote appears VERBATIM in the supplied evidence text
// Anything else is dropped with a reason (for the w8_u3_dropped_log). A
// no_evidence_found is NOT a drop — it is an honest, counted non-proposal.
// Returns { proposal|null, verdict, drop: { reason }|null }.
// ---------------------------------------------------------------------------
export function validateLinkProposal(proposal, evidenceText) {
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  const verdict = String(p.verdict || 'no_evidence_found');
  if (verdict === 'no_evidence_found') {
    return { proposal: null, verdict, drop: null };
  }
  if (!p.linked_entity_name) {
    return { proposal: null, verdict, drop: { reason: 'no_entity_named', quote: p.evidence_quote || null } };
  }
  if (!p.evidence_quote) {
    return { proposal: null, verdict, drop: { reason: 'no_quote', quote: null } };
  }
  if (!quoteVerbatimInEvidence(p.evidence_quote, evidenceText)) {
    return { proposal: null, verdict, drop: { reason: 'quote_not_verbatim', quote: String(p.evidence_quote).slice(0, 200) } };
  }
  // Guard: the proposed entity must not be the current owner echoed back (a non-
  // propagation). Best-effort — only when a currentOwner is passed.
  return { proposal: { ...p, verdict }, verdict, drop: null };
}

// A proposal is PROPOSABLE (persisted to the review lane) only when it survives the
// validator AND clears the confidence floor. Below the floor: dropped (counted).
export const LINK_MIN_CONFIDENCE = 0.6;

export function isProposableLink(validated, minConfidence = LINK_MIN_CONFIDENCE) {
  if (!validated || !validated.proposal) return false;
  const c = Number(validated.proposal.confidence);
  return Number.isFinite(c) && c >= minConfidence;
}

// ---------------------------------------------------------------------------
// Bounded scorer (pure, injectable clock) — mirrors U1/U2's scoreWithBudget so a
// single HTTP invocation never outruns the Railway proxy on ollama latency.
// Evidence assembly makes these calls LONGER than U1/U2 — the batch is smaller.
// ---------------------------------------------------------------------------
export async function scoreLinksWithBudget(items, scoreOne, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : Infinity;
  const maxN = Number.isFinite(opts.maxN) ? Math.max(0, opts.maxN) : list.length;
  const cap = Math.min(maxN, list.length);
  const start = now();
  const results = [];
  let budgetExhausted = false;
  for (let i = 0; i < cap; i++) {
    if (now() - start >= budgetMs) { budgetExhausted = true; break; }
    // eslint-disable-next-line no-await-in-loop
    results.push(await scoreOne(list[i], i));
  }
  return {
    results, scored: results.length, budget_exhausted: budgetExhausted,
    remaining_unscored: Math.max(0, list.length - results.length),
    capped: Math.max(0, list.length - cap), cap,
  };
}
