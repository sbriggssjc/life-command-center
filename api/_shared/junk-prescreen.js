// W8 U1 — Ollama junk-entity pre-screen (Prompt 62).
//
// Pure, dependency-free helpers for the hygiene campaign's first unit. The
// doctrine (playbook §7): Ollama PROPOSES; a deterministic gate or a human lane
// DECIDES. Nothing here writes canonical data or decides truth — it (1) finds
// junk CANDIDATES cheaply with regex/heuristics (no LLM), (2) shapes the prompt
// the local model scores that candidate pool with, (3) normalizes the model's
// proposal, and (4) plans the human-gated apply (soft-retire / conflict / keep)
// with the FK guard baked in. Every function is unit-testable in isolation.
//
// The live query + write side lives in api/admin.js (handleJunkPrescreenTick +
// the junk_entity_review verdict branch); this module is the brain it calls.

// ---------------------------------------------------------------------------
// Target catalogue — the entity-class tables we pre-screen across the 3 DBs.
// Each target is fully self-describing so the tick + apply path stay generic:
//   domain     : 'lcc' (ops) | 'dia' | 'gov'  — routes the query helper
//   table      : PostgREST resource name
//   pkCol      : primary key column
//   nameCol    : the display-name column we heuristic-screen
//   mergedCol  : self-merge pointer (skip already-merged rows) | null
//   markerCol  : writable field the soft-retire marker lands in
//   markerKind : 'jsonb' (merge a {junk_retired} key) | 'text' (append a tag)
//   fkChildren : inbound references — if ANY is non-empty the row is FK-referenced
//                and the apply path routes to a conflict card, never retires it.
// ---------------------------------------------------------------------------
export const JUNK_TARGETS = [
  {
    domain: 'lcc', table: 'entities', pkCol: 'id', nameCol: 'name',
    mergedCol: 'merged_into_entity_id', markerCol: 'metadata', markerKind: 'jsonb',
    fkChildren: [
      { table: 'entity_relationships', col: 'from_entity_id' },
      { table: 'entity_relationships', col: 'to_entity_id' },
      { table: 'external_identities', col: 'entity_id' },
      { table: 'lcc_entity_portfolio_facts', col: 'entity_id' },
      { table: 'touchpoint_cadence', col: 'entity_id' },
      { table: 'bd_opportunities', col: 'entity_id' },
    ],
  },
  {
    domain: 'dia', table: 'recorded_owners', pkCol: 'recorded_owner_id', nameCol: 'name',
    mergedCol: 'merged_into_recorded_owner_id', markerCol: 'notes', markerKind: 'text',
    fkChildren: [
      { table: 'properties', col: 'recorded_owner_id' },
      { table: 'contacts', col: 'recorded_owner_id' },
    ],
  },
  {
    domain: 'dia', table: 'true_owners', pkCol: 'true_owner_id', nameCol: 'name',
    mergedCol: 'merged_into_true_owner_id', markerCol: 'notes', markerKind: 'text',
    fkChildren: [
      { table: 'properties', col: 'true_owner_id' },
      { table: 'recorded_owners', col: 'true_owner_id' },
      { table: 'contacts', col: 'true_owner_id' },
    ],
  },
  {
    domain: 'dia', table: 'contacts', pkCol: 'contact_id', nameCol: 'contact_name',
    mergedCol: null, markerCol: 'notes', markerKind: 'text',
    fkChildren: [],
  },
  {
    domain: 'gov', table: 'recorded_owners', pkCol: 'recorded_owner_id', nameCol: 'name',
    mergedCol: 'merged_into_recorded_owner_id', markerCol: 'contact_info', markerKind: 'jsonb',
    fkChildren: [
      { table: 'properties', col: 'recorded_owner_id' },
      { table: 'contacts', col: 'recorded_owner_id' },
    ],
  },
  {
    domain: 'gov', table: 'true_owners', pkCol: 'true_owner_id', nameCol: 'name',
    mergedCol: 'merged_into_true_owner_id', markerCol: 'contact_info', markerKind: 'jsonb',
    // gov.recorded_owners has NO true_owner_id column (dia does) — do not probe it.
    fkChildren: [
      { table: 'properties', col: 'true_owner_id' },
      { table: 'contacts', col: 'true_owner_id' },
    ],
  },
  {
    domain: 'gov', table: 'contacts', pkCol: 'contact_id', nameCol: 'name',
    mergedCol: null, markerCol: 'notes', markerKind: 'text',
    fkChildren: [],
  },
];

export function junkTargetKey(t) {
  return `${t.domain}:${t.table}`;
}

export function findJunkTarget(domain, table) {
  const d = String(domain || '').toLowerCase();
  const dom = d === 'dialysis' ? 'dia' : d === 'government' ? 'gov' : d;
  return JUNK_TARGETS.find((t) => t.domain === dom && t.table === table) || null;
}

// The subject_ref namespace for the junk_entity_review federated lane. Stable +
// unique per (domain, table, pk) so a verdict routes back to exactly one row and
// the exclusion set (decided subjects) drains the lane.
export function junkSubjectRef(domain, table, pk) {
  const d = String(domain || '').toLowerCase();
  const dom = d === 'dialysis' ? 'dia' : d === 'government' ? 'gov' : d;
  return `junk:${dom}:${table}:${pk}`;
}

export function parseJunkSubjectRef(ref) {
  const m = /^junk:([^:]+):([^:]+):(.+)$/.exec(String(ref || ''));
  if (!m) return null;
  return { domain: m[1], table: m[2], pk: m[3] };
}

// ---------------------------------------------------------------------------
// Deterministic candidate filter (NO LLM — this is an auditable gate). Returns
// null for a plausibly-real name, or { heuristic, evidence } for a junk
// candidate. `evidence` is the VERBATIM offending substring (doctrine: every
// proposal is evidence-grounded). Order matters: cheapest/hardest signals first.
// ---------------------------------------------------------------------------
const TOKEN_JUNK_RE = /^\s*(tests?|asdf+[a-z]*|qwerty[a-z]*|xxx+|zzz+|foo|bar|baz|sample|dummy|delete\s*me|delete|do\s*not\s*use|donotuse|do\s*not\s*delete|n\/?a|none|null|unknown|tbd|placeholder|example|temp|temporary|xxxx+|aaaa+)\b/i;
const ALL_NONALPHA_RE = /^[^A-Za-z]+$/;            // all digits/punct/symbols, no letters
const GIBBERISH_RUN_RE = /[bcdfghjklmnpqrstvwxz]{6,}/i;  // 6+ consonants in a row
const NO_VOWEL_RE = /^[^aeiouy\W\d]{4,}$/i;        // 4+ letters, zero vowels

export function junkCandidateReason(name) {
  const raw = name == null ? '' : String(name);
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { heuristic: 'blank_name', evidence: raw };
  }
  const tok = trimmed.match(TOKEN_JUNK_RE);
  if (tok) {
    return { heuristic: 'token_junk', evidence: tok[0].trim() };
  }
  if (ALL_NONALPHA_RE.test(trimmed)) {
    return { heuristic: 'all_non_alpha', evidence: trimmed.slice(0, 60) };
  }
  if (trimmed.replace(/[^A-Za-z]/g, '').length <= 2) {
    return { heuristic: 'too_short', evidence: trimmed.slice(0, 60) };
  }
  const gib = trimmed.match(GIBBERISH_RUN_RE);
  if (gib) {
    return { heuristic: 'consonant_run', evidence: gib[0] };
  }
  if (NO_VOWEL_RE.test(trimmed)) {
    return { heuristic: 'no_vowel', evidence: trimmed.slice(0, 60) };
  }
  return null;
}

export function isJunkCandidate(name) {
  return junkCandidateReason(name) !== null;
}

// A conservative PostgREST `or=(...)` predicate that mirrors junkCandidateReason
// enough to cheaply narrow the server-side pull. The JS filter is authoritative
// (this only reduces rows over the wire); a broad server predicate + exact JS
// gate keeps the two in sync without duplicating every rule in SQL.
export function junkCandidateOrFilter(nameCol) {
  const col = nameCol;
  const tokenLike = 'test%,asdf%,xxx%,zzz%,foo,bar,sample,dummy,delete,do not use,donotuse,n/a,none,null,unknown,tbd,placeholder,example,temp';
  const ilikes = tokenLike.split(',').map((v) => `${col}.ilike.${v}`);
  // all-non-alpha (no letters) + very short handled by the JS gate after pull;
  // the server predicate is the token set + a length<=2 proxy.
  ilikes.push(`${col}.is.null`);
  return `or=(${ilikes.join(',')})`;
}

// ---------------------------------------------------------------------------
// Prompt the local model scores a single candidate with. Few-shot grounding is
// drawn from real accrued human junk_entity_name verdicts (passed in), so the
// model learns the operator's rubric, not a generic one.
// ---------------------------------------------------------------------------
export function buildJunkPrescreenPrompt(candidate, fewShot) {
  const shots = Array.isArray(fewShot) ? fewShot.slice(0, 8) : [];
  const payload = {
    domain: candidate.domain,
    table: candidate.table,
    entity_name: candidate.entity_name,
    heuristic: candidate.heuristic,
    offending_value: candidate.evidence,
    context: candidate.context || {},
  };
  const lines = [
    'You are the LCC Ollama data-hygiene pre-screen agent.',
    'You ONLY propose. You never delete, never merge, never write data, and never invent facts.',
    'A deterministic filter already flagged the record below as a possible junk / test / gibberish / bookkeeping-stub entity. Judge whether it is genuinely NOT a real company or person.',
    'Return ONLY strict JSON with keys: verdict, confidence, evidence_quote, reason.',
    '- verdict: one of "dismiss" (junk — should be soft-retired), "rename" (real but the name is malformed/needs cleanup), "parse_contact" (the value is actually a phone/email/address to split out), "keep" (this IS a real entity, do not touch).',
    '- confidence: 0.0 to 1.0.',
    '- evidence_quote: the VERBATIM offending substring copied from entity_name (never paraphrase).',
    '- reason: one short sentence grounded only in the evidence.',
    'If unsure, use verdict "keep" with low confidence — false retirement is worse than a missed one.',
  ];
  if (shots.length) {
    lines.push('Operator rubric — real past human verdicts on similar names:');
    for (const s of shots) {
      lines.push(`- "${String(s.name || '').slice(0, 80)}" -> ${s.verdict}`);
    }
  }
  lines.push(JSON.stringify({ candidate: payload }, null, 2));
  return lines.join('\n');
}

const JUNK_VERDICTS = new Set(['dismiss', 'rename', 'parse_contact', 'keep']);

export function normalizeJunkProposal(raw, candidate) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  let verdict = String(obj.verdict || '').toLowerCase().trim();
  if (!JUNK_VERDICTS.has(verdict)) verdict = 'keep';
  const n = Number(obj.confidence);
  const confidence = Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  // Evidence quote must be verbatim-from-the-name; if the model paraphrased or
  // omitted it, fall back to the deterministic evidence the filter captured.
  let quote = obj.evidence_quote != null ? String(obj.evidence_quote) : '';
  const name = String(candidate?.entity_name || '');
  if (!quote || (name && !name.toLowerCase().includes(quote.toLowerCase()))) {
    quote = candidate?.evidence != null ? String(candidate.evidence) : quote;
  }
  quote = quote.slice(0, 200);
  const reason = String(obj.reason || '').replace(/\s+/g, ' ').trim().slice(0, 400)
    || `Deterministic heuristic ${candidate?.heuristic || 'unknown'} flagged this value.`;
  return { verdict, confidence, evidence_quote: quote, reason };
}

// Reuse the tolerant JSON extraction shape used by the prompt-32 clean-assist
// layer (fenced ```json, then first-brace/last-brace fallback).
export function parseJunkVerdictJson(text) {
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

// ---------------------------------------------------------------------------
// Apply planner (human-gated). Given the human verdict on a proposal + whether
// the row is FK-referenced, decide the deterministic action. This is the
// auditable gate — no LLM. The FK guard is the hazard-class rule (never retire a
// referenced row); a referenced row always routes to a conflict card.
//   humanVerdict: 'confirm' (accept the model's dismiss) | 'reject' (keep it)
//   proposedVerdict: the model's proposed verdict on the proposal row
//   fkReferenced: boolean
// ---------------------------------------------------------------------------
export function planJunkApply({ humanVerdict, proposedVerdict, fkReferenced }) {
  const hv = String(humanVerdict || '').toLowerCase();
  const pv = String(proposedVerdict || '').toLowerCase();
  if (hv === 'reject' || hv === 'keep') {
    return { action: 'dismiss_proposal', status: 'dismissed', retire: false };
  }
  if (hv !== 'confirm' && hv !== 'accept') {
    return { action: 'invalid', status: null, retire: false, error: `unknown human verdict: ${humanVerdict}` };
  }
  // Human confirmed the model's proposal.
  if (pv === 'dismiss') {
    if (fkReferenced) {
      return { action: 'conflict_fk', status: 'conflict', retire: false,
        reason: 'Row is referenced by one or more child rows; retiring it would strand those references. Routed to conflict.' };
    }
    return { action: 'soft_retire', status: 'applied', retire: true };
  }
  // rename / parse_contact are non-destructive edit lanes — confirming records
  // the accepted verdict but the edit itself stays a human/worker action (never
  // an automatic canonical write from the pre-screen).
  if (pv === 'rename' || pv === 'parse_contact') {
    return { action: 'accept_edit_lane', status: 'accepted_edit', retire: false, edit_kind: pv };
  }
  // pv === 'keep' confirmed = leave the row, close the proposal.
  return { action: 'dismiss_proposal', status: 'dismissed', retire: false };
}

// Build the reversible soft-retire marker + the mutation body for a target.
// Returns { body } to PATCH onto the row, given the existing marker value so the
// old value can be captured in the ledger for reversal. Never clobbers — merges.
export function buildRetireMarker(target, existingMarker, batchId, sourceRunId, nowIso) {
  const stamp = { junk_retired: { batch_id: batchId, source_run_id: sourceRunId, retired_at: nowIso, unit: 'W8_U1' } };
  if (target.markerKind === 'jsonb') {
    const base = existingMarker && typeof existingMarker === 'object' ? existingMarker : {};
    return { [target.markerCol]: Object.assign({}, base, stamp) };
  }
  // text: append a reversible tag; keep the original text intact ahead of it.
  const tag = `[JUNK-RETIRED batch=${batchId} run=${sourceRunId} at=${nowIso}]`;
  const prev = existingMarker != null ? String(existingMarker) : '';
  const next = prev.includes('[JUNK-RETIRED') ? prev : (prev ? `${prev}\n${tag}` : tag);
  return { [target.markerCol]: next };
}
