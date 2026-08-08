// ============================================================================
// W8 U5 (Prompt 79, 2026-08-08): naming-hygiene campaign — pure planner.
//
// The rename/normalize counterpart to U1's junk pre-screen. U1 (junk-prescreen.js)
// already CLASSIFIES the two naming-hygiene classes and COUNTS them as a
// deferred backlog (naming_hygiene_backlog: lcc 5,091 = 1,113 known_abbreviation
// + 3,978 address_as_name, gov 973, dia 395). This module turns that backlog
// into two proposal types, DETERMINISTIC-FIRST:
//
//   known_abbreviation  -> RENAME proposal. Where the abbreviation dictionary is
//                          unambiguous (Prtnrs->Partners, Mgmt->Management, …)
//                          the expansion needs NO LLM — just the mapping + the
//                          verbatim abbreviated token as evidence. The LLM is
//                          consulted ONLY for ambiguous tokens (Cos->Companies?
//                          Cos as a surname?; Assoc->Associates vs Association),
//                          with a judge-don't-parrot rubric.
//   address_as_name     -> LINK-DON'T-RENAME. An address mis-entered as a name
//                          ("3710 Fm 1889") is a property ANCHOR; the fix is the
//                          missing property link (+ a display-name fill from the
//                          property record where derivable), never a rename.
//
// DOCTRINE (W8): Ollama PROPOSES; a deterministic rule or a human lane DECIDES.
// Every proposal is evidence-grounded (the verbatim abbreviated token / the
// address string). NEVER fabricate. Proposal-only — no write without a human
// verdict. All reversible.
//
// This module is PURE (no I/O) and unit-testable. It reuses U1's classifier +
// target catalogue + bounded/resumable scoring helpers wholesale.
// ============================================================================

import { createHash } from 'node:crypto';
import {
  JUNK_TARGETS, classifyName, namingHygieneReason,
  knownAbbrevEvidence, isAddressAsName,
  junkNameHash, scoreWithBudget, selectUnscoredCandidates,
} from './junk-prescreen.js';

// Re-export the shared bounded-scoring helpers so the tick imports one module.
export { scoreWithBudget, selectUnscoredCandidates };

// ---------------------------------------------------------------------------
// Target catalogue (reused wholesale from U1) + per-target hygiene config.
// The rename writer needs the display-name column + whether a canonical_name
// column exists, plus the provenance (target_database, namespaced target_table)
// so a rename write records field_provenance whose (target_table, field_name,
// source) matches an in-migration field_source_priority row (unranked view = 0).
//
// canonicalCol is set ONLY where a rename should ALSO recompute canonical_name.
// We limit that to LCC-native `entities` (via the SQL house normalizer
// lcc_normalize_entity_name), catching a unique collision -> conflict. The gov
// canonical_name is left to the gov resolver's own normalizer (writing it here
// risks the uq_recorded_owners_canonical collision) — the display name is the
// hygiene target.
// ---------------------------------------------------------------------------
export const NAMING_HYGIENE_TARGETS = JUNK_TARGETS.map((t) => {
  const cfg = { ...t };
  if (t.domain === 'lcc' && t.table === 'entities') {
    cfg.canonicalCol = 'canonical_name';
    cfg.provDatabase = 'ops';
    cfg.provTable = 'entities';
    cfg.propertyLink = true;   // address_as_name -> ensureEntityLink asset link
  } else {
    cfg.canonicalCol = null;
    cfg.provDatabase = t.domain === 'dia' ? 'dia_db' : t.domain === 'gov' ? 'gov_db' : t.domain;
    cfg.provTable = `${t.domain}.${t.table}`;
    cfg.propertyLink = false;  // domain owner/contact rows already carry FK links
  }
  return cfg;
});

export function findHygieneTarget(domain, table) {
  const d = String(domain || '').toLowerCase();
  const dom = d === 'dialysis' ? 'dia' : d === 'government' ? 'gov' : d;
  return NAMING_HYGIENE_TARGETS.find((t) => t.domain === dom && t.table === table) || null;
}

// The subject_ref namespace for the naming_hygiene_review federated lane. Stable
// + unique per (domain, table, pk); distinct from U1's `junk:` namespace so the
// two lanes never collide on a subject.
export function hygieneSubjectRef(domain, table, pk) {
  const d = String(domain || '').toLowerCase();
  const dom = d === 'dialysis' ? 'dia' : d === 'government' ? 'gov' : d;
  return `hyg:${dom}:${table}:${pk}`;
}

export function parseHygieneSubjectRef(ref) {
  const m = /^hyg:([^:]+):([^:]+):(.+)$/.exec(String(ref || ''));
  if (!m) return null;
  return { domain: m[1], table: m[2], pk: m[3] };
}

// name_hash reuse (resume-cursor key). A rename changes the name -> new hash ->
// re-scored, exactly like U1.
export const hygieneNameHash = junkNameHash;
export function hygieneScoredKeyFor(candidate) {
  const c = candidate || {};
  return `${String(c.subject_ref || '')}:${String(c.name_hash != null ? c.name_hash : junkNameHash(c.entity_name))}`;
}

// ---------------------------------------------------------------------------
// Abbreviation expansion dictionary (DETERMINISTIC — no LLM). Keys are the
// lowercased abbreviated forms from U1's KNOWN_ABBREV_LIST; values are the
// unambiguous expansion. Anything genuinely ambiguous is NOT here — it goes to
// AMBIGUOUS_ABBREV and is judged by the model in context.
//
// Excluded on purpose (kept, never auto-expanded):
//   * Corp — a valid legal-form token; expanding "Corp"->"Corporation" is noise.
//   * Cos, Assoc/Assocs, Comm, Cap, Fin, Dev, Prop — ambiguous (see below).
// ---------------------------------------------------------------------------
export const ABBREV_EXPANSION = {
  prtnrs: 'Partners', ptnrs: 'Partners',
  prtnr: 'Partner', ptnr: 'Partner',
  ptnrshp: 'Partnership', prtnrshp: 'Partnership', prtshp: 'Partnership',
  mgmt: 'Management', mgt: 'Management', mngmt: 'Management',
  hldgs: 'Holdings', holdngs: 'Holdings', hldg: 'Holding',
  devlpmnt: 'Development',
  grp: 'Group', grps: 'Groups',
  svcs: 'Services', srvcs: 'Services', svc: 'Service',
  props: 'Properties', prprts: 'Properties', prtys: 'Properties',
  cmnty: 'Community', cmmnty: 'Community',
  natl: 'National', natnl: 'National',
  intl: 'International',
  capitl: 'Capital',
  invmt: 'Investment', invmts: 'Investments',
  invstmnt: 'Investment', invstmnts: 'Investments',
  realestate: 'Real Estate', rlty: 'Realty',
  enterprs: 'Enterprises', entrprs: 'Enterprises',
  bldg: 'Building',
  cmrcl: 'Commercial',
  fincl: 'Financial',
};

// Genuinely ambiguous abbreviations — the model expands these in context (or
// keeps them). NEVER auto-expanded.
export const AMBIGUOUS_ABBREV = new Set([
  'cos',    // Companies? or the surname "Cos"
  'assoc', 'assocs', // Associates vs Association
  'comm',   // Commercial vs Community vs Communications
  'cap',    // Capital vs a literal "cap"
  'fin',    // Financial vs "fin" / a name
  'dev',    // Development vs the name "Dev"
  'prop',   // Property vs "proper" / a surname
  'realt',  // Realty vs Realtors vs Realties
  'corp',   // valid legal form — leave as-is (never rename)
]);

// Match the leading/trailing punctuation around a token so "Prtnrs," keeps its
// comma and "Prtnrs." keeps its period after expansion.
function splitToken(tok) {
  const m = /^([^A-Za-z0-9]*)([A-Za-z0-9'&.-]*?)([^A-Za-z0-9]*)$/.exec(tok);
  if (!m) return { pre: '', core: tok, post: '' };
  return { pre: m[1] || '', core: m[2] || '', post: m[3] || '' };
}

// Re-case an expansion to match the abbreviation's original casing.
function matchCase(expansion, original) {
  if (original === original.toUpperCase() && /[A-Z]/.test(original)) return expansion.toUpperCase();
  if (original[0] && original[0] === original[0].toLowerCase()) return expansion.toLowerCase();
  return expansion; // already Title Case
}

// DETERMINISTIC expansion pass. Returns:
//   { original, expanded, changes:[{from,to}], ambiguous:[token…],
//     deterministic:bool, hasAny:bool }
// deterministic = at least one unambiguous change AND no ambiguous token left
// (i.e. the whole name can be expanded with NO model call). hasAny = there is
// something to expand (deterministic changes and/or ambiguous tokens present).
export function expandAbbreviations(name) {
  const original = name == null ? '' : String(name);
  const tokens = original.split(/(\s+)/); // keep whitespace runs as tokens
  const changes = [];
  const ambiguous = [];
  const out = tokens.map((tok) => {
    if (/^\s+$/.test(tok) || tok === '') return tok;
    const { pre, core, post } = splitToken(tok);
    if (!core) return tok;
    const key = core.toLowerCase();
    if (AMBIGUOUS_ABBREV.has(key)) {
      if (key !== 'corp') ambiguous.push(core); // corp: valid form, not actionable
      return tok;
    }
    const exp = ABBREV_EXPANSION[key];
    if (!exp) return tok;
    const cased = matchCase(exp, core);
    if (cased === core) return tok;
    changes.push({ from: core, to: cased });
    return pre + cased + post;
  });
  const expanded = out.join('');
  return {
    original,
    expanded,
    changes,
    ambiguous,
    deterministic: changes.length > 0 && ambiguous.length === 0,
    hasAny: changes.length > 0 || ambiguous.length > 0,
  };
}

// The naming-hygiene class of a name (via U1's classifier), or null.
export function hygieneClass(name) {
  const c = classifyName(name);
  return c && c.category === 'naming_hygiene' ? c.heuristic : null;
}

// Build a candidate proposal for a known_abbreviation row (NO I/O). Returns:
//   { actionable, deterministic, proposed_action, proposed_name, evidence,
//     ambiguous, reason }
// actionable=false means nothing to do (e.g. the only abbrev token is "Corp").
export function planAbbreviationProposal(name) {
  const abbrevTok = knownAbbrevEvidence(name);
  const exp = expandAbbreviations(name);
  if (exp.deterministic) {
    return {
      actionable: true, deterministic: true,
      proposed_action: 'rename', proposed_name: exp.expanded,
      evidence: exp.changes.map((c) => c.from).join(', ') || (abbrevTok || ''),
      ambiguous: [],
      reason: 'Deterministic dictionary expansion: '
        + exp.changes.map((c) => `${c.from}→${c.to}`).join(', ') + '.',
    };
  }
  if (exp.ambiguous.length) {
    return {
      actionable: true, deterministic: false,
      proposed_action: 'rename', proposed_name: null, // model fills in
      evidence: exp.ambiguous.join(', '),
      ambiguous: exp.ambiguous.slice(),
      // if there are ALSO deterministic changes, carry the partially-expanded
      // form so the model only judges the ambiguous remainder.
      partial_expansion: exp.changes.length ? exp.expanded : null,
      reason: 'Ambiguous abbreviation(s) — model judges in context: ' + exp.ambiguous.join(', ') + '.',
    };
  }
  // known_abbreviation classifier fired but nothing is expandable (only "Corp",
  // or a form we deliberately keep) -> not actionable.
  return { actionable: false, deterministic: false, proposed_action: 'keep',
    proposed_name: null, evidence: abbrevTok || '', ambiguous: [],
    reason: 'No unambiguous expansion available (valid form kept as-is).' };
}

// ---------------------------------------------------------------------------
// address_as_name — link-don't-rename planning.
// The tick resolves a candidate property by normalized address (I/O lives in the
// tick); this module supplies the normalizer + the proposal shape.
// ---------------------------------------------------------------------------
export function normalizeAddressForMatch(s) {
  return String(s == null ? '' : s)
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\b(STREET|STR)\b/g, 'ST')
    .replace(/\b(AVENUE|AVEN)\b/g, 'AVE')
    .replace(/\b(BOULEVARD)\b/g, 'BLVD')
    .replace(/\b(ROAD)\b/g, 'RD')
    .replace(/\b(DRIVE)\b/g, 'DR')
    .replace(/\b(HIGHWAY)\b/g, 'HWY')
    .replace(/\b(LANE)\b/g, 'LN')
    .replace(/\b(PARKWAY)\b/g, 'PKWY')
    .replace(/\b(SUITE|STE|UNIT)\b.*$/, '') // drop suite/unit trailing detail
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The disposition of an address_as_name row given the property-resolution result.
//   resolved: null | { domain, property_id, address, owner_name }
//   ambiguousCount: number of properties that matched the normalized address
// Returns { proposed_action, proposed_property, proposed_name, actionable,
//           reason }.
export function planAddressLinkProposal(entityName, resolution) {
  const r = resolution || {};
  if (r.ambiguousCount && r.ambiguousCount > 1) {
    return { proposed_action: 'uncertain', actionable: false, proposed_property: null,
      proposed_name: null,
      reason: `Address matches ${r.ambiguousCount} properties — ambiguous, human picks.` };
  }
  if (!r.resolved) {
    return { proposed_action: 'uncertain', actionable: false, proposed_property: null,
      proposed_name: null,
      reason: 'No property resolved for this address — human review (never guess).' };
  }
  const prop = r.resolved;
  // display-name fill is FILL-BLANKS: only propose replacing the raw-address name
  // with the property's recorded owner name when that owner name exists and is a
  // real (non-address) name. Otherwise link only, keep the address name.
  const ownerName = prop.owner_name && !isAddressAsName(prop.owner_name) ? prop.owner_name : null;
  return {
    proposed_action: 'link_property', actionable: true,
    proposed_property: { domain: prop.domain, property_id: prop.property_id, address: prop.address },
    proposed_name: ownerName,   // may be null -> link only, no rename
    reason: 'Address mis-entered as a name — attach the entity to property '
      + `${prop.domain}:${prop.property_id}`
      + (ownerName ? ` and fill the display name from the property owner.` : ' (link only; no derivable owner name).'),
  };
}

// ---------------------------------------------------------------------------
// Prompt 83 (W8 U5 tick bounding) — BATCHED address resolution helpers (PURE).
// The per-candidate resolveHygieneProperty (one property query per address) was
// the request-killer: 4,145 address candidates ⇒ thousands of PostgREST round
// trips inside one HTTP invocation. These pure helpers let the tick resolve a
// whole BATCH of address candidates with ONE properties prefilter query per
// domain (an `or=(address.ilike.NUM*,…)` over the batch's leading numbers), then
// match in memory — mirroring U1's batched FK-child probe.
// ---------------------------------------------------------------------------

// The leading street number of an address-as-name (the cheap prefilter key), or
// null when the value has no leading number (then it is not link-resolvable).
export function addressLeadingNumber(name) {
  const norm = normalizeAddressForMatch(name);
  const m = norm.match(/^\d+/);
  return m ? m[0] : null;
}

// The deduped set of leading street numbers across a batch of address candidates
// — feeds ONE bounded `or=(address.ilike.NUM*,…)` properties prefilter per domain.
export function collectAddressNumbers(candidates) {
  const numbers = new Set();
  for (const c of (candidates || [])) {
    const n = addressLeadingNumber(c && c.entity_name);
    if (n) numbers.add(n);
  }
  return [...numbers];
}

// PURE matcher: given a candidate address name + the property rows fetched by the
// batched prefilter (each {property_id, address, recorded_owner_id}) + an owner-
// name map (recorded_owner_id → name, string-keyed), return the SAME resolution
// shape resolveHygieneProperty produced. Conservative: exactly-one normalized-
// address match resolves; >1 is ambiguous; 0 is unresolved. Never guesses.
export function matchCandidateToProperties(domain, entityName, propertyRows, ownerNameById) {
  const normTarget = normalizeAddressForMatch(entityName);
  if (!normTarget || !/^\d/.test(normTarget)) return { resolved: null, ambiguousCount: 0 };
  const matches = (propertyRows || []).filter((p) => normalizeAddressForMatch(p && p.address) === normTarget);
  if (matches.length === 0) return { resolved: null, ambiguousCount: 0 };
  if (matches.length > 1) return { resolved: null, ambiguousCount: matches.length };
  const p = matches[0];
  let ownerName = null;
  if (p.recorded_owner_id != null && ownerNameById) {
    const raw = ownerNameById.get(String(p.recorded_owner_id));
    ownerName = raw && !isAddressAsName(raw) ? raw : null;
  }
  return { resolved: { domain, property_id: p.property_id, address: p.address, owner_name: ownerName }, ambiguousCount: 1 };
}

// ---------------------------------------------------------------------------
// LLM prompt for the AMBIGUOUS-abbreviation case (judge-don't-parrot). The model
// expands the ambiguous token IN CONTEXT or keeps it; it MUST NOT invent tokens.
// ---------------------------------------------------------------------------
export function buildAbbrevExpansionPrompt(candidate) {
  const c = candidate || {};
  const partial = c.partial_expansion ? `\nAfter unambiguous expansions: "${c.partial_expansion}"` : '';
  return [
    'You normalize a commercial-real-estate ENTITY name that contains an ABBREVIATED token.',
    'Expand ONLY genuine abbreviations to their full word IN THIS CONTEXT. Do NOT invent,',
    'add, reorder, or drop words. If the token is a real word / surname / valid legal form',
    '(e.g. "Cos" as a family name, "Corp"), KEEP the name unchanged.',
    '',
    `Entity name: "${c.entity_name}"`,
    `Domain: ${c.domain} · table: ${c.table}`,
    `Ambiguous token(s): ${(c.ambiguous || []).join(', ')}`,
    partial,
    '',
    'Common expansions: Cos->Companies, Assoc->Associates OR Association (pick by context),',
    'Comm->Commercial OR Community, Cap->Capital, Fin->Financial, Dev->Development, Prop->Property.',
    '',
    'Return STRICT JSON, no prose:',
    '{"expanded_name": "<the full corrected name, or the original unchanged>",',
    ' "changed": <true|false>, "confidence": <0..1>, "keep": <true|false>,',
    ' "reasoning": "<one short sentence>"}',
    'Set keep=true (changed=false) when the abbreviation is actually a real word/surname/valid form.',
  ].join('\n');
}

export function parseExpansionJson(text) {
  const raw = String(text == null ? '' : text);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_e) { return null; }
}

// Normalize the model's expansion into a proposal (or a keep). Guards:
//   * keep / changed=false / expanded == original  -> keep (non-event)
//   * the expansion must be a superset-of-tokens-ish safe edit: it may not
//     shrink the name to junk, and must still contain the original leading words
//     (a cheap anti-hallucination floor — the model can lengthen abbreviations,
//     not rewrite the name). If it fails, downgrade to uncertain.
export function normalizeExpansionProposal(parsed, candidate) {
  const c = candidate || {};
  const original = String(c.entity_name || '');
  if (!parsed || parsed.keep === true || parsed.changed === false) {
    return { action: 'keep', proposed_name: null, confidence: Number(parsed?.confidence) || 0,
      reason: parsed?.reasoning || 'Model kept the name (ambiguous token is a real word/form).' };
  }
  const expanded = String(parsed.expanded_name || '').trim();
  if (!expanded || expanded === original) {
    return { action: 'keep', proposed_name: null, confidence: Number(parsed.confidence) || 0,
      reason: 'Model returned no change.' };
  }
  // Anti-hallucination floor: the expanded name must not be shorter than the
  // original (expansions lengthen) and must share the original's first word.
  const firstOrig = original.trim().split(/\s+/)[0] || '';
  const firstNew = expanded.split(/\s+/)[0] || '';
  const safe = expanded.length >= original.length
    && firstNew.toLowerCase().startsWith(firstOrig.slice(0, Math.min(3, firstOrig.length)).toLowerCase());
  if (!safe) {
    return { action: 'uncertain', proposed_name: expanded, confidence: 0,
      reason: 'Model expansion failed the anti-hallucination floor — routed to human.' };
  }
  const conf = Number(parsed.confidence);
  return {
    action: 'rename',
    proposed_name: expanded,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.6,
    reason: parsed.reasoning || 'Model-judged ambiguous-abbreviation expansion.',
  };
}

// The apply plan for a human verdict on a naming_hygiene_review proposal (pure).
//   humanVerdict: 'confirm' | 'reject'
//   proposedAction: 'rename' | 'link_property' | 'keep' | 'uncertain'
// -> { action } where action is one of:
//   'apply_rename' | 'apply_link' | 'dismiss_proposal'
export function planHygieneApply({ humanVerdict, proposedAction }) {
  if (humanVerdict !== 'confirm') return { action: 'dismiss_proposal' };
  if (proposedAction === 'rename') return { action: 'apply_rename' };
  if (proposedAction === 'link_property') return { action: 'apply_link' };
  return { action: 'dismiss_proposal' }; // keep/uncertain confirmed = non-event close
}

// Convenience: is a proposal actionable enough to ENQUEUE as a lane card?
// keep/uncertain-without-a-property are non-events (honest counts — never flood
// the lane with nothing-to-do rows, mirroring U1's kept_not_enqueued rule).
export function isEnqueueableHygieneProposal(p) {
  if (!p) return false;
  if (p.proposed_action === 'rename') return !!p.proposed_name || p.deterministic === true || (p.ambiguous && p.ambiguous.length > 0);
  if (p.proposed_action === 'link_property') return !!(p.proposed_property && p.proposed_property.property_id != null);
  return false;
}

// Stable digest helper for tests / ledger metadata parity with U1.
export function hygieneDigest(s) {
  return createHash('sha1').update(String(s == null ? '' : s)).digest('hex').slice(0, 16);
}
