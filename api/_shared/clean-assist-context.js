// ============================================================================
// P134 — OLLAMA CLEAN-ASSIST evidence gate + prompt builder (pure brain).
//
// P32 shipped the clean-assist tick with a thin `context: item.context || {}`
// payload. A 12-item inert dry-run (2026-08-26) graded it: 6 of 12 proposals
// came back `uncertain @ 0.00` whose reason was a variant of "the context lacks
// detail" — the model was abstaining because it had been handed identifiers, not
// EVIDENCE. Shipping that would flood the Decision Center with content-free
// cards, which is the Consumption-Layer noise failure (a badge that is mostly
// noise trains the operator to ignore the surface).
//
// Two fixes live here, both pure so they are testable without IO:
//
//   1. AN EVIDENCE GATE. Each lane declares the comparative facts a human would
//      actually look at. An item that cannot supply them is NOT sent to the
//      model at all — it is skipped and counted (`skipped_no_evidence`), rather
//      than paying an Ollama call to hear "insufficient evidence". Never
//      fabricate the missing half of a comparison.
//
//   2. A COHERENCE GUARD. A decisive verdict (merge / link / keep_current /
//      accept_attempted) carried at ~0 confidence is incoherent — it is the
//      model saying "yes" and "I have no idea" in one breath, and the lane sorts
//      on confidence. Such a proposal is downgraded to `uncertain` and the
//      downgrade is recorded in the reason, so it reads as what it is instead of
//      ranking as a decisive call.
//
// Doctrine unchanged: this layer PROPOSES. It never merges, links, or writes
// canonical data. The batched IO that fills `context.evidence` lives in
// ./clean-assist-enrich.js; api/admin.js owns the tick.
// ============================================================================

import { nameSimilarity, ownerCore } from './dup-pair-planner.js';
import { strictOwnerCore, strictCoreIsSubstantial } from './owner-contact-propagate-planner.js';

export const CLEAN_ASSIST_TYPES = [
  'property_merge',
  'owner_reconcile',
  'sf_link_candidate',
  'provenance_conflict',
  'intake_disposition',
];

export function cleanAssistKind(type) {
  if (type === 'provenance_conflict') return 'conflict_narration';
  if (type === 'intake_disposition') return 'unstructured_reconciliation';
  return 'review_triage';
}

export function cleanAssistAllowedVerdicts(kind) {
  if (kind === 'conflict_narration') return new Set(['keep_current', 'accept_attempted', 'research', 'uncertain']);
  if (kind === 'unstructured_reconciliation') return new Set(['link', 'no_link', 'research', 'uncertain']);
  return new Set(['merge', 'not', 'research', 'uncertain']);
}

// A verdict that ASSERTS something (as opposed to declining to). These are the
// ones the coherence guard polices — 'research'/'uncertain' are already honest
// non-answers, so a 0 confidence on them is not a contradiction.
const DECISIVE_VERDICTS = new Set(['merge', 'not', 'link', 'no_link', 'keep_current', 'accept_attempted']);

// Below this, a decisive verdict is treated as incoherent. Deliberately a floor
// just above zero rather than a "reasonable confidence" bar: the guard exists to
// catch the model that forgot to fill the field, not to second-guess a genuine
// low-confidence call.
export const DECISIVE_MIN_CONFIDENCE = 0.05;

const s = (v) => (v == null ? '' : String(v)).trim();
const has = (v) => s(v).length > 0;

// ---------------------------------------------------------------------------
// Name comparison — the shared sub-evidence every same-party lane needs.
//
// STRICT core (legal forms only) is the identity signal; dup-pair `ownerCore`
// (which also strips the generic-CRE stoplist) is reported ONLY as the fuzzy
// pairing signal it is. CLAUDE.md: "Realty Income Corporation" reduces to the
// EMPTY string under ownerCore, and "Agree Realty Corp"/"Agree Holdings LLC"
// both reduce to "agree" — so ownerCore must never be presented as an identity
// claim. Both are labelled here so the model cannot confuse them.
// ---------------------------------------------------------------------------
export function compareNames(aName, bName) {
  const a = s(aName);
  const b = s(bName);
  if (!a || !b) return null;
  const aStrict = strictOwnerCore(a);
  const bStrict = strictOwnerCore(b);
  const aFuzzy = ownerCore(a);
  const bFuzzy = ownerCore(b);
  return {
    name_a: a,
    name_b: b,
    strict_core_a: aStrict,
    strict_core_b: bStrict,
    // Only an equality between two SUBSTANTIAL cores is worth calling a match;
    // two empty cores are equal and mean nothing.
    strict_core_equal: !!(aStrict && aStrict === bStrict && strictCoreIsSubstantial(aStrict)),
    strict_core_substantial: strictCoreIsSubstantial(aStrict) && strictCoreIsSubstantial(bStrict),
    // Fuzzy pairing signal only — see the note above.
    fuzzy_core_a: aFuzzy,
    fuzzy_core_b: bFuzzy,
    name_similarity: Number(nameSimilarity(a, b).toFixed(3)),
  };
}

// ---------------------------------------------------------------------------
// Evidence gate.
//
// Returns { sufficient, reason, evidence }. `evidence` is the object handed to
// the model — the comparative facts, nothing else. `reason` names the missing
// half when sufficient=false so the skip count is diagnosable instead of a bare
// number.
// ---------------------------------------------------------------------------
export function assessCleanAssistEvidence(item) {
  const type = s(item && item.decision_type);
  const c = (item && item.context) || {};
  switch (type) {
    case 'property_merge': return assessPropertyMerge(c);
    case 'provenance_conflict': return assessProvenanceConflict(c);
    case 'owner_reconcile': return assessOwnerReconcile(c);
    case 'sf_link_candidate': return assessSfLink(c);
    case 'intake_disposition': return assessIntake(c);
    default: return { sufficient: false, reason: 'unsupported_decision_type', evidence: null };
  }
}

function insufficient(reason) { return { sufficient: false, reason, evidence: null }; }

// --- property_merge --------------------------------------------------------
// The lane row is a GROUP representative; judging same-property-vs-co-located
// needs the group MEMBERS side by side. Without them there is nothing to
// compare, which is precisely what the dry-run's "context lacks detail about the
// properties" was reporting.
function assessPropertyMerge(c) {
  const members = Array.isArray(c.members) ? c.members.filter(Boolean) : [];
  if (members.length < 2) return insufficient('property_merge_members_unresolved');
  return {
    sufficient: true,
    reason: null,
    evidence: {
      domain: c.domain || null,
      shared_address: c.address || null,
      state: c.state || null,
      cluster_size: c.cluster_size != null ? c.cluster_size : members.length,
      members,
      differing_fields: Array.isArray(c.differing_fields) ? c.differing_fields : [],
      identical_fields: Array.isArray(c.identical_fields) ? c.identical_fields : [],
    },
  };
}

// --- provenance_conflict ---------------------------------------------------
// Narrating "which source should win" is impossible without BOTH values and
// BOTH sources' places on the priority ladder. `field_source_priority` is the
// repo's authority ranking (LOWER priority number = HIGHER trust).
function assessProvenanceConflict(c) {
  if (c.kind === 'sales_price_xref') {
    // The dia cross-reference issue carries three UNLABELLED detail columns; the
    // view's own suggested_action is the only thing that says which number is
    // which, so it is required rather than us re-deriving the mapping.
    if (!has(c.issue_narration)) return insufficient('xref_narration_missing');
    return {
      sufficient: true,
      reason: null,
      evidence: {
        conflict_kind: 'sales_price_cross_reference',
        domain: 'dia',
        issue_narration: c.issue_narration,
        detail_1: c.detail_1, detail_2: c.detail_2, detail_3: c.detail_3,
      },
    };
  }
  const bothValues = c.attempted_value != null && c.current_value != null;
  if (!bothValues) return insufficient('conflict_values_missing');
  if (!has(c.attempted_source) || !has(c.current_source)) return insufficient('conflict_sources_missing');
  const ap = numOrNull(c.attempted_priority);
  const cp = numOrNull(c.current_priority);
  return {
    sufficient: true,
    reason: null,
    evidence: {
      conflict_kind: 'field_provenance',
      target: [c.target_database, c.target_table, c.field_name].filter(Boolean).join(' / '),
      record_pk_value: c.record_pk_value || null,
      field_name: c.field_name || null,
      current: { value: c.current_value, source: c.current_source, priority: cp, recorded_at: c.current_recorded_at || null },
      attempted: { value: c.attempted_value, source: c.attempted_source, priority: ap, confidence: c.attempted_confidence != null ? c.attempted_confidence : null },
      // Precomputed so the model narrates the ladder rather than inventing one.
      priority_rule: 'LOWER priority number = HIGHER trust',
      ladder_says: laddersSay(ap, cp),
      enforce_mode: c.enforce_mode || null,
      writer_decision: c.decision || null,
      writer_decision_reason: c.decision_reason || null,
      field_priority_ladder: Array.isArray(c.priority_ladder) ? c.priority_ladder : [],
    },
  };
}

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// What the registered ladder implies, stated as a fact rather than a verdict.
// `null` when either side is unregistered — an unranked writer is real drift
// (v_field_provenance_unranked), not something to guess around.
export function laddersSay(attemptedPriority, currentPriority) {
  if (attemptedPriority == null || currentPriority == null) return 'unregistered_source_no_ladder_answer';
  if (attemptedPriority < currentPriority) return 'attempted_source_outranks_current';
  if (attemptedPriority > currentPriority) return 'current_source_outranks_attempted';
  return 'equal_priority_ladder_cannot_decide';
}

// --- owner_reconcile -------------------------------------------------------
// Four seeders fold into this lane and each already ships DIFFERENT comparison
// facts inline. Rather than flatten them to two bare names (which is what the
// pre-P134 payload did), each is shaped into the same side_a / side_b /
// shared_evidence / engine frame so the model always sees the same structure and
// never has to guess which seeder it is reading.
//
// Both party names are the irreducible minimum; without them there is nothing to
// compare and the item is skipped.
function assessOwnerReconcile(c) {
  const a = s(c.owner_name || c.name_a || c.source_name);
  const b = s(c.candidate_name || c.candidate_company || c.name_b || c.target_name);
  if (!a || !b) return insufficient('owner_reconcile_name_missing');
  const shaped = shapeOwnerReconcileSides(c, a, b);
  return {
    sufficient: true,
    reason: null,
    evidence: {
      seeder: c.kind || null,
      domain: c.domain || null,
      comparison: compareNames(a, b),
      side_a: shaped.side_a,
      side_b: shaped.side_b,
      // Facts the two sides genuinely share, each carrying the value that makes
      // it checkable. Empty means "none on file", never "not looked for".
      shared_evidence: (Array.isArray(c.shared_evidence) && c.shared_evidence.length)
        ? c.shared_evidence : shaped.shared_evidence,
      agreeing_signals: Array.isArray(c.agreeing_signals) ? c.agreeing_signals : [],
      engine: shaped.engine,
    },
  };
}

function shapeOwnerReconcileSides(c, a, b) {
  const engine = {
    // An upstream proposal is NOT ground truth — the w8_u2 generator's own
    // verdicts include "the abbreviation 'tk' matches the initials of 'Terry
    // Kessler'", which is exactly the initials-only reasoning this lane must
    // reject. Labelled so it reads as a claim to check, not a fact to inherit.
    unverified_upstream_proposal: c.engine_verdict || c.proposed_verdict || null,
    upstream_reason: c.reason || null,
    weighted_score: c.weighted_score != null ? c.weighted_score : null,
    threshold: c.threshold != null ? c.threshold : null,
    match_method: c.match_method || c.generator_method || null,
    match_tier: c.match_tier || null,
    similarity: firstNumber(c.similarity, c.name_similarity, c.match_score),
    high_authority_conflict: c.high_authority_conflict === true,
    generator_evidence: c.gen_evidence || c.evidence_quote || null,
  };

  // Seeder B — gov recorded_owner ↔ unified_contact. Its comparison facts are
  // the owner's representative property vs the contact's own geography/email.
  if (c.kind === 'owner_unification') {
    const ev = [];
    if (c.shared_state && c.owner_property_state) ev.push({ signal: 'shared_state', value: c.owner_property_state });
    return {
      side_a: { role: 'gov recorded_owner', name: a, id: c.recorded_owner_id || null,
        property_address: c.owner_property_address || null, city: c.owner_property_city || null, state: c.owner_property_state || null },
      side_b: { role: 'gov unified_contact', name: c.candidate_name || null, company: c.candidate_company || null,
        id: c.candidate_unified_id || null, email: c.candidate_email || null, city: c.candidate_city || null, state: c.candidate_state || null },
      shared_evidence: ev,
      engine: { ...engine, upstream_reason: c.match_reason_label || c.reason || null },
    };
  }

  // Seeder C — a domain entity_match_candidate. Only the two labelled rows and
  // the matcher's similarity are on file; nothing else is invented.
  if (c.kind === 'entity_match_candidate') {
    return {
      side_a: { role: c.source_table || null, name: a, id: c.source_id || null },
      side_b: { role: c.target_table || null, name: b, id: c.target_id || null },
      shared_evidence: [],
      engine,
    };
  }

  // Seeders A (ORE) and D (w8_u2 near-miss pairs) are both LCC entity pairs, so
  // their sides come from the batched entity read in clean-assist-enrich.js.
  return {
    side_a: c.side_a || { name: a, id: c.entity_id || c.entity_a || null },
    side_b: c.side_b || { name: b, id: c.candidate_entity_id || c.entity_b || null },
    shared_evidence: [],
    engine,
  };
}

function firstNumber(...vals) {
  for (const v of vals) { const n = Number(v); if (v != null && Number.isFinite(n)) return n; }
  return null;
}

// --- sf_link_candidate -----------------------------------------------------
// A resolved SF ACCOUNT NAME is required: comparing an owner name to an opaque
// 18-char Salesforce id is not a judgement anyone can make.
function assessSfLink(c) {
  const owner = s(c.owner_name) || s(c.canonical_name);
  const sf = s(c.sf_account_name_resolved);
  if (!owner) return insufficient('sf_link_owner_name_missing');
  if (!sf) return insufficient('sf_link_account_name_unresolved');
  return {
    sufficient: true,
    reason: null,
    evidence: {
      domain: c.domain || null,
      comparison: compareNames(owner, sf),
      owner: {
        name: c.owner_name || null,
        canonical_name: c.canonical_name || null,
        state: c.state || null,
        property_count: c.property_count != null ? c.property_count : null,
        source_table: c.source_table || null,
      },
      salesforce_account: {
        name: c.sf_account_name_resolved,
        id: c.sf_account_id_resolved || null,
        state: c.sf_account_state || null,
        already_linked_to_a_different_owner: !!c.conflict_existing_id,
        conflicting_existing_sf_id: c.conflict_existing_id || null,
      },
      matcher_score: c.score_resolved != null ? c.score_resolved : null,
      matcher_basis: c.match_basis || null,
    },
  };
}

// --- intake_disposition ----------------------------------------------------
// The staged item must at least name a place or a party; a doctype with no
// address, tenant or price is not a linkable mention, it is an empty document.
function assessIntake(c) {
  const hasSubject = has(c.address) || has(c.tenant);
  if (!hasSubject) return insufficient('intake_no_address_or_tenant');
  return {
    sufficient: true,
    reason: null,
    evidence: {
      extracted: {
        doctype: c.doctype || null,
        address: c.address || null,
        city: c.city || null,
        state: c.state || null,
        tenant: c.tenant || null,
        asking_price: c.asking_price_suspect ? null : (c.asking_price != null ? c.asking_price : null),
        asking_price_suspect: !!c.asking_price_suspect,
        cap_rate: c.cap_rate_display || c.cap_rate || null,
        multi_property: !!c.multi_property,
      },
      pipeline_match_status: c.match_status || null,
      // The record the pipeline already thinks this is, resolved to real fields
      // so "does it link?" is an address-vs-address comparison, not a bare id.
      matched_record: c.matched_property || null,
      address_comparison: c.matched_property
        ? compareNames(c.address, c.matched_property.address)
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
const LANE_TASK = {
  property_merge:
    'Decide whether the properties listed under `members` are ONE building recorded more than once, or DISTINCT '
    + 'co-located records (e.g. two tenants in one plaza, or two suites). Cite the specific field that decides it.',
  owner_reconcile:
    'Decide whether the two parties are the SAME real-world party. Weigh shared evidence (mailing address, portfolio, '
    + 'the engine signals) above name resemblance; initials or a shared surname alone are NOT identity.',
  sf_link_candidate:
    'Decide whether the property owner and the Salesforce account are the SAME real-world party. Cite the specific '
    + 'name/state/portfolio evidence that decides it.',
  provenance_conflict:
    'Narrate this field conflict and recommend which source should win. `ladder_says` is the registered '
    + 'field_source_priority answer — follow it unless the values themselves contradict it, and say so when you do.',
  intake_disposition:
    'Decide whether this staged intake item refers to the already-matched record (link) or to a different / '
    + 'not-yet-known property (no_link). Compare the extracted address and party to the matched record.',
};

const VERDICT_LEGEND = {
  review_triage: '- merge = same thing; not = distinct; research = needs a human lookup; uncertain = the evidence genuinely ties.',
  unstructured_reconciliation: '- link = refers to the matched record; no_link = does not; research; uncertain.',
  conflict_narration: '- keep_current = the current value should stand; accept_attempted = the attempted value should win; research; uncertain.',
};

export function buildCleanAssistPrompt(item, kind, evidence) {
  const payload = {
    decision_type: item.decision_type,
    subject_ref: item.subject_ref,
    subject_domain: item.subject_domain,
    rank_value: item.rank_value,
    evidence: evidence || {},
  };
  return [
    'You are the LCC Ollama cleaning-assist agent.',
    'You only propose. You never decide truth, never merge, never write canonical data, and never fabricate missing facts.',
    'Every fact you may use is in the JSON below. Do not assume anything that is not stated there.',
    LANE_TASK[item.decision_type] || 'Triage this ambiguous review item.',
    'Your `reason` MUST quote or name the specific field/value from the evidence that decides it. A reason that only '
      + 'says the evidence is thin is not acceptable — return "uncertain" with the reason naming WHICH fact is missing.',
    'Set `confidence` to your real certainty (0..1). Never return a decisive verdict with confidence 0.',
    'Return ONLY strict JSON with keys: verdict, reason, confidence, proposed_link, conflict_summary.',
    'Allowed verdicts for this task:',
    VERDICT_LEGEND[kind] || VERDICT_LEGEND.review_triage,
    JSON.stringify({ proposal_kind: kind, item: payload }, null, 2),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Normalizer + coherence guard
// ---------------------------------------------------------------------------
export function normalizeCleanAssistProposal(raw, kind) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const allowed = cleanAssistAllowedVerdicts(kind);
  let verdict = String(obj.verdict || '').toLowerCase().trim();
  if (!allowed.has(verdict)) verdict = 'uncertain';
  const n = Number(obj.confidence);
  let confidence = Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  let reason = String(obj.reason || obj.conflict_summary || 'No grounded reason supplied.')
    .replace(/\s+/g, ' ').trim().slice(0, 500);
  let downgraded = false;

  // A decisive verdict at ~0 confidence asserts and disclaims at once, and the
  // lane sorts on confidence — so it would rank as a decisive call while
  // carrying none. Downgrade to the honest reading and SAY SO in the reason, so
  // a graded sample shows the guard firing instead of hiding it.
  if (DECISIVE_VERDICTS.has(verdict) && confidence < DECISIVE_MIN_CONFIDENCE) {
    verdict = 'uncertain';
    confidence = 0;
    downgraded = true;
    reason = ('Downgraded to uncertain: model returned a decisive verdict with no confidence. ' + reason).slice(0, 500);
  }

  return {
    verdict,
    confidence,
    reason: reason || 'No grounded reason supplied.',
    proposed_link: obj.proposed_link && typeof obj.proposed_link === 'object' ? obj.proposed_link : {},
    conflict_summary: obj.conflict_summary ? String(obj.conflict_summary).replace(/\s+/g, ' ').trim().slice(0, 1000) : null,
    coherence_downgraded: downgraded,
  };
}

export function parseCleanAssistJson(text) {
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
