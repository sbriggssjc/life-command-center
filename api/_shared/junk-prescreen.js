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
// null for a plausibly-real name, or { heuristic, evidence, ... } for a junk
// candidate. `evidence` is the VERBATIM offending substring (doctrine: every
// proposal is evidence-grounded). Order matters: cheapest/hardest signals first.
//
// W8 U1 precision fix (Prompt 64): the first live scored batch dismissed real
// entities — net-lease SPE shells (ARC/ARHC + property-code + LLC), bank/operator
// acronyms (SMBC, FCMC), abbreviated firm names (Prtnrs), and address-as-name
// rows — because the raw consonant-run / no-vowel / too-short heuristics fire on
// exactly those legitimate naming conventions. These deterministic guards run
// BEFORE the LLM: an SPE-coded name is NOT a candidate at all; a known-abbrev or
// address name is a candidate but carries a `preVerdict` that can never be
// dismissed (rename/parse, not retire); a bare all-caps acronym is flagged
// `acronymOnly` so the tick refuses to dismiss it without a second junk signal.
// ---------------------------------------------------------------------------
const TOKEN_JUNK_RE = /^\s*(tests?|asdf+[a-z]*|qwerty[a-z]*|xxx+|zzz+|foo|bar|baz|sample|dummy|delete\s*me|delete|do\s*not\s*use|donotuse|do\s*not\s*delete|n\/?a|none|null|unknown|tbd|placeholder|example|temp|temporary|xxxx+|aaaa+)\b/i;
const ALL_NONALPHA_RE = /^[^A-Za-z]+$/;            // all digits/punct/symbols, no letters
const GIBBERISH_RUN_RE = /[bcdfghjklmnpqrstvwxz]{6,}/i;  // 6+ consonants in a row
const NO_VOWEL_RE = /^[^aeiouy\W\d]{4,}$/i;        // 4+ letters, zero vowels

// Legal-entity form words that mark a name as a real registered vehicle.
const ENTITY_FORM_RE = /\b(LLC|L\.L\.C\.|LP|L\.P\.|LLP|TRUST|REIT|DST)\b/;
// A property/SPE code token: a run of letters immediately followed by digits
// (e.g. GSCRGCO001, MCNWDNY01, DDBLVTN001, DBUBS2011). Matched on the uppercased
// name so mixed-case captures ("Ddblvtn001") are caught too.
const SPE_CODE_TOKEN_RE = /[A-Z]{3,}\d{2,}|[A-Z]+\d+[A-Z]*\d*/;
// Known abbreviated firm-name tokens — a real company whose name was truncated,
// NOT junk. Match => propose a rename (clean the abbreviation), never dismiss.
const KNOWN_ABBREV_LIST = [
  'Prtnrs', 'Prtnr', 'Ptnrs', 'Ptnr', 'Ptnrshp', 'Prtnrshp', 'Prtshp',
  'Assoc', 'Assocs', 'Mgmt', 'Mgt', 'Mngmt', 'Hldgs', 'Hldg', 'Holdngs',
  'Dev', 'Devlpmnt', 'Grp', 'Grps', 'Svcs', 'Svc', 'Srvcs', 'Prop', 'Props',
  'Prprts', 'Prtys', 'Cmnty', 'Cmmnty', 'Natl', 'Natnl', 'Intl', 'Cap', 'Capitl',
  'Invmt', 'Invmts', 'Invstmnt', 'Invstmnts', 'Realestate', 'Rlty', 'Realt',
  'Enterprs', 'Entrprs', 'Bldg', 'Cmrcl', 'Comm', 'Fin', 'Fincl', 'Corp', 'Cos',
];
const KNOWN_ABBREV_RE = new RegExp('\\b(' + KNOWN_ABBREV_LIST.join('|') + ')\\b', 'i');
// Address-as-name: begins with a street number and contains a street-type token.
// Only fires when the value carries NO entity-form word — "20931 Burbank Blvd LLC"
// is a real SPE named after its asset, whereas "3710 Fm 1889" / "654 SR 75" are
// raw addresses mis-entered as a name (right fix = parse/link, never dismiss).
const ADDRESS_SUFFIX_RE = /\b(St|Str|Street|Rd|Road|Ave|Aven|Avenue|Blvd|Boulevard|Hwy|Highway|SR|FM|Ln|Lane|Dr|Drive|Ct|Court|Way|Pkwy|Parkway|Pl|Place|Ter|Terrace|Cir|Circle|Trl|Trail|Loop|Sq|Square)\b/i;
const ADDRESS_AS_NAME_RE = /^\s*\d+\s+.*/;
// A bare all-caps acronym (2–5 letters, nothing else). Often a real lender or
// operator (SMBC, FCMC, LFLP, PVLLC) — never junk on the acronym shape alone.
const ACRONYM_ONLY_RE = /^[A-Z]{2,5}$/;

export function isSpeCodedName(name) {
  const s = String(name == null ? '' : name).trim().toUpperCase();
  if (!s) return false;
  return ENTITY_FORM_RE.test(s) && SPE_CODE_TOKEN_RE.test(s);
}

export function knownAbbrevEvidence(name) {
  const m = String(name == null ? '' : name).match(KNOWN_ABBREV_RE);
  return m ? m[1] : null;
}

export function isAddressAsName(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s || ENTITY_FORM_RE.test(s.toUpperCase())) return false;
  return ADDRESS_AS_NAME_RE.test(s) && ADDRESS_SUFFIX_RE.test(s);
}

export function isAcronymOnly(name) {
  return ACRONYM_ONLY_RE.test(String(name == null ? '' : name).trim());
}

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
  // SPE / property-coded registered vehicle (e.g. "ARC GSDVRDE001, LLC") — a
  // core real entity class in this net-lease business, almost always FK-linked
  // to a property. NOT a candidate; the code token's consonant run never fires.
  if (isSpeCodedName(trimmed)) {
    return null;
  }
  // Known abbreviated firm name ("Brookfield Prop Prtnrs …") — real, just
  // truncated. Candidate, but the proposal can only ever be a rename.
  const abbrev = knownAbbrevEvidence(trimmed);
  if (abbrev) {
    return { heuristic: 'known_abbreviation', evidence: abbrev, preVerdict: 'rename' };
  }
  // Address-as-name ("3710 Fm 1889") — parse/link to a property, never dismiss.
  if (isAddressAsName(trimmed)) {
    return { heuristic: 'address_as_name', evidence: trimmed.slice(0, 60), preVerdict: 'parse_contact' };
  }
  if (ALL_NONALPHA_RE.test(trimmed)) {
    return { heuristic: 'all_non_alpha', evidence: trimmed.slice(0, 60) };
  }
  if (trimmed.replace(/[^A-Za-z]/g, '').length <= 2) {
    const out = { heuristic: 'too_short', evidence: trimmed.slice(0, 60) };
    if (isAcronymOnly(trimmed)) out.acronymOnly = true;
    return out;
  }
  const gib = trimmed.match(GIBBERISH_RUN_RE);
  if (gib) {
    const out = { heuristic: 'consonant_run', evidence: gib[0] };
    if (isAcronymOnly(trimmed)) out.acronymOnly = true;
    return out;
  }
  if (NO_VOWEL_RE.test(trimmed)) {
    const out = { heuristic: 'no_vowel', evidence: trimmed.slice(0, 60) };
    if (isAcronymOnly(trimmed)) out.acronymOnly = true;
    return out;
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
  const ctx = candidate.context && typeof candidate.context === 'object' ? candidate.context : {};
  const payload = {
    domain: candidate.domain,
    table: candidate.table,
    entity_name: candidate.entity_name,
    heuristic_hint: candidate.heuristic,
    offending_value: candidate.evidence,
    relationship_count: ctx.relationship_count != null ? ctx.relationship_count : null,
    identity_count: ctx.identity_count != null ? ctx.identity_count : null,
    is_fk_referenced: ctx.connected != null ? !!ctx.connected : null,
    context: ctx,
  };
  const lines = [
    'You are the LCC Ollama data-hygiene pre-screen agent.',
    'You ONLY propose. You never delete, never merge, never write data, and never invent facts.',
    '',
    'IMPORTANT — the `heuristic_hint` below is a WEAK, cheap regex hint, NOT a verdict. It has well-known FALSE-POSITIVE classes that are REAL entities in this net-lease business:',
    '  • Net-lease SPE shells — an operator/sponsor code + a property code + a legal form, e.g. "ARC GSDVRDE001, LLC", "ARHC MCNWDNY01, LLC". The consonant run is a PROPERTY CODE, not gibberish. These are core real entities → keep.',
    '  • Bank / lender / operator ACRONYMS — SMBC (Sumitomo Mitsui), FCMC, LFLP, PVLLC. An all-caps acronym is not junk on its shape alone → keep unless there is a second, independent junk signal.',
    '  • Abbreviated firm names — "Prtnrs" (Partners), "Ptnrshp", "Hldgs", "Mgmt", "Assoc". Real company, just truncated → rename, never dismiss.',
    '  • CMBS / loan / securitization tags — "Brookfield Prop Prtnrs DBUBS 2011-LC1" is Brookfield with a loan pool tag; at worst a rename → keep or rename.',
    '  • Address-as-name — "3710 Fm 1889", "654 SR 75" are addresses mis-entered as a name; the fix is to parse/link them to a property → parse_contact, never dismiss.',
    '',
    'Return ONLY strict JSON with keys: verdict, confidence, evidence_quote, reason.',
    '- verdict: one of "dismiss" (genuinely junk / test / a non-entity — soft-retire), "rename" (real entity, name malformed/abbreviated), "parse_contact" (value is really a phone/email/address to split out), "keep" (real entity, do not touch).',
    '- Propose "dismiss" ONLY if there is NO plausible reading of this value as a real company or person. Test strings ("Test Test", "asdf"), pure punctuation ("--"), and empty/placeholder values are dismiss. A code, an acronym, or an abbreviation is NOT.',
    '- confidence: 0.0 to 1.0.',
    '- evidence_quote: the VERBATIM offending substring copied from entity_name (never paraphrase).',
    '- reason: one short sentence. It MUST cite evidence BEYOND the heuristic hint (e.g. "no relationships or identities and matches the Test-data pattern"). Do NOT simply restate that the hint fired — that is not a reason.',
    '- The `is_fk_referenced`, `relationship_count`, and `identity_count` context tell you if the row is connected to real data. A CONNECTED row is by definition not junk → never dismiss it.',
    'If unsure, use verdict "keep" with low confidence — false retirement of a real owner is far worse than a missed junk row.',
    '',
    'Calibration examples:',
    '- "ARC GSDVRDE001, LLC" -> keep (operator + property code + LLC; a real SPE, not gibberish)',
    '- "SMBC" -> keep (a bank acronym, not junk on shape alone)',
    '- "Brookfield Prop Prtnrs DBUBS 2011-LC1" -> keep (Brookfield with a CMBS tag)',
    '- "Cushman Wakefield Prtnrs" -> rename (real firm, abbreviated "Partners")',
    '- "3710 Fm 1889" -> parse_contact (an address mis-entered as a name)',
    '- "--" -> dismiss (pure punctuation, no entity reading)',
    '- "Test Test" -> dismiss (test data)',
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

// ---------------------------------------------------------------------------
// Post-LLM deterministic guards (Prompt 64). The model PROPOSES; these guards
// VETO an unsafe dismiss. They only ever soften a verdict (dismiss → keep/rename/
// parse_contact) — never harden one — so a real entity can never be retired on a
// name-shape hint. ctx: { connected, hasProvenance, relationshipCount,
// connectionDetail }. Returns the adjusted proposal + a `guards` audit trail.
// ---------------------------------------------------------------------------
export function applyPrescreenGuards(proposal, candidate, ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const guards = [];
  let verdict = String(proposal?.verdict || 'keep');
  let reason = String(proposal?.reason || '');
  const connected = !!c.connected;
  const hasProvenance = !!c.hasProvenance;
  const fullyUnconnected = !connected && !hasProvenance;

  // Guard 1 — relationship/portfolio gate: a connected entity is not junk,
  // whatever its name looks like. Cap at keep, never dismiss.
  if (verdict === 'dismiss' && connected) {
    verdict = 'keep';
    guards.push('connection_gate');
    reason = 'Connected entity (' + (c.connectionDetail || 'FK-referenced') + ') — a referenced record is not junk regardless of name shape.';
  }
  // Guard 2 — acronym rule: a bare 2–5 all-caps acronym needs a SECOND junk
  // signal (fully unconnected: no relationships AND no identities AND no
  // provenance) before it can be dismissed. Otherwise cap at keep.
  if (verdict === 'dismiss' && candidate?.acronymOnly && !fullyUnconnected) {
    verdict = 'keep';
    guards.push('acronym_gate');
    reason = 'All-caps acronym with existing relationships/identities — not dismissable on the acronym shape alone.';
  }
  // Guard 3 — heuristic downgrade: a known-abbreviation or address-as-name row
  // can never be dismissed; it downgrades to its non-destructive preVerdict.
  if (verdict === 'dismiss' && candidate?.preVerdict) {
    verdict = candidate.preVerdict;
    guards.push('heuristic_downgrade');
    reason = 'Heuristic ' + (candidate.heuristic || 'unknown') + ' indicates a real-but-malformed name (' + (candidate.evidence || '') + '); routed to ' + verdict + ', never dismiss.';
  }
  if (!guards.length) return { ...proposal, verdict, guards: [] };
  return { ...proposal, verdict, reason: reason.slice(0, 400), guards };
}

// Verdict-distribution guard on a scored batch. A junk pre-screen over CURATED
// tables should find a small MINORITY of true junk; a batch that proposes >50%
// dismiss is anchoring on the heuristic, not judging — flag it suspect and (on
// the tick) refuse to persist that batch. `byVerdict` is a { verdict: count } map.
export function dismissDistributionGuard(byVerdict, threshold = 0.5) {
  const counts = byVerdict && typeof byVerdict === 'object' ? byVerdict : {};
  let total = 0;
  for (const v of Object.values(counts)) total += Number(v) || 0;
  const dismiss = Number(counts.dismiss) || 0;
  const dismiss_share = total > 0 ? dismiss / total : 0;
  return { total, dismiss, dismiss_share, threshold, suspect_distribution: total > 0 && dismiss_share > threshold };
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
