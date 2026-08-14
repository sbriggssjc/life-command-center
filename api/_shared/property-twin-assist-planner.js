// Prompt 106 — property_twin lane deterministic pre-rank + Ollama assist.
//
// Pure, dependency-free brain for the assist that pre-ranks the dia property
// "address twin" review lane (dia_property_twin_review; ~1,245 pending). Doctrine
// (mirrors W9.3 sf-link-assist + W8 match-disambig): the assist ANNOTATES and
// SORTS the lane — it NEVER merges. The dia merge (dia_merge_property_reversible)
// stays human-gated + reversible. This module is the brain the nightly tick
// (api/admin.js::handlePropertyTwinAssistTick) calls to (1) deterministically
// pre-classify the bulk from the review row's OWN structured `detail` fields (NO
// LLM), and (2) for the genuine-judgment residue only, shape an Ollama prompt +
// parse/normalize its answer into a bounded annotation whose evidence quote MUST
// be a verbatim substring of the supplied evidence (else the annotation is
// dropped — the W7.4/U3 precision floor).
//
// The annotation is written to lcc_clean_assist_proposals (source
// 'property_twin_assist') keyed by subject_ref 'twin:dia:<review_id>'. That store
// is metadata-only and structurally CANNOT touch the dia review row's status or
// call the merge RPC — the verdict path (a HUMAN clicking merge/not_twin/research)
// stays exactly as it is today.
//
// Footgun this lane exists for: co-located ≠ twin. A DaVita and a Fresenius share
// one plaza (same coordinates) yet are DISTINCT clinics. Operator agreement alone
// is NOT a merge signal, and a same-address operator change (an operator swapping
// out at one facility) must NEVER be deterministically ruled "not a twin".

import { nameSimilarity } from './dup-pair-planner.js';
import { quoteVerbatimInEvidence, normalizeForMatch } from './link-propagation-planner.js';

// Store-collision-free namespacing for lcc_clean_assist_proposals. The `source`
// column keeps this stream from colliding with 'ollama_clean_assist' /
// 'w9_3_sf_assist' on the UNIQUE (decision_type, subject_ref, proposal_kind,
// source) key. 'review_triage' fits the proposal_kind CHECK; the verdicts
// merge/not/uncertain all pass the store's verdict CHECK.
export const PT_ASSIST_SOURCE = 'property_twin_assist';
export const PT_ASSIST_KIND = 'review_triage';
export const PT_ASSIST_DECISION_TYPE = 'property_twin';

// Tunable name-core similarity floor for a deterministic MERGE. Same operator +
// a name this close = the same building captured twice (a formatting variant),
// not two distinct clinics. Kept high so a same-operator/different-clinic pair
// (e.g. a "Home Training" unit vs an in-center) falls to the LLM residue.
export const MERGE_SIM_FLOOR = 0.88;

const PT_VERDICTS = new Set(['merge', 'not', 'uncertain']);

function clampConfidence(v) {
  const n = Number(v);
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

function cleanReason(s, max = 240) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

// The structured fields the classifier + prompt read off a dia_property_twin_review
// row's `detail` jsonb (plus the top-level classification/distance the lane carries
// in context). Tolerant to either the raw detail shape or the lane's context shape.
export function twinFieldsFrom(detail) {
  const d = detail && typeof detail === 'object' ? detail : {};
  const str = (v) => (v == null ? null : String(v));
  const nAnchorsRaw = d.n_anchors;
  const nAnchors = Number.isFinite(Number(nAnchorsRaw)) ? Number(nAnchorsRaw) : 1;
  return {
    anchor_tenant: str(d.anchor_tenant),
    shadow_tenant: str(d.shadow_tenant),
    anchor_operator: str(d.anchor_operator),
    shadow_operator: str(d.shadow_operator),
    same_norm_address: d.same_norm_address === true,
    n_anchors: nAnchors,
    classification: str(d.classification) || null,
    distance_miles: (d.distance_miles == null) ? null : Number(d.distance_miles),
  };
}

function opEq(a, b) {
  const na = String(a == null ? '' : a).trim().toLowerCase();
  const nb = String(b == null ? '' : b).trim().toLowerCase();
  return !!na && na === nb;
}

// ── Layer 1: deterministic pre-classifier (NO LLM) ─────────────────────────────
// Returns { suggest: 'merge'|'not'|'uncertain', confidence, reason, layer:
// 'deterministic', needs_llm: bool }. Only same-operator/near-identical-name pairs
// (MERGE) and different-operator/distinct-address single-anchor pairs (NOT_TWIN)
// are decided here; everything with a competing clinical identity, a same-address
// operator change, multiple anchors, or a blank shadow is left to the LLM residue.
// It NEVER deterministically rules a same-address (operator-change) pair "not a
// twin" — that is exactly the human/LLM call.
export function classifyTwinDeterministic(detail) {
  const f = twinFieldsFrom(detail);
  const aT = f.anchor_tenant;
  const sT = f.shadow_tenant;
  const aOp = f.anchor_operator;
  const sOp = f.shadow_operator;

  // Blank shadow identity — nothing to compare on. Never decide; hand to the LLM.
  if (!sT || !sOp) {
    return {
      suggest: 'uncertain', needs_llm: true, layer: 'deterministic', confidence: 0,
      reason: 'Shadow tenant/operator is blank — no competing identity to compare; needs judgment.',
    };
  }

  const sameOp = opEq(aOp, sOp);
  const sim = (aT && sT) ? nameSimilarity(aT, sT) : 0;

  // Decisive MERGE: same operator AND a near-identical name-core (same building,
  // captured twice as a formatting variant). Anchor count / address irrelevant —
  // an identical-name same-operator pair is a twin regardless.
  if (sameOp && sim >= MERGE_SIM_FLOOR) {
    return {
      suggest: 'merge', needs_llm: false, layer: 'deterministic',
      confidence: Math.min(0.95, 0.6 + sim * 0.35),
      reason: 'Same operator (' + aOp + ') and near-identical clinic name (similarity '
        + sim.toFixed(2) + ') — same building captured twice.',
    };
  }

  // Decisive NOT_TWIN: different operators at a DISTINCT normalized address, single
  // anchor — a co-located but separate facility (a DaVita and a Fresenius in one
  // plaza). Requires same_norm_address === false so a same-address operator change
  // is NEVER swept here.
  if (!sameOp && f.same_norm_address === false && f.n_anchors <= 1) {
    return {
      suggest: 'not', needs_llm: false, layer: 'deterministic', confidence: 0.9,
      reason: 'Different operators (' + aOp + ' vs ' + sOp
        + ') at a distinct normalized address — co-located distinct clinics, not a twin.',
    };
  }

  // Residue: same-address operator change, multiple anchors, or same-operator
  // name divergence (a "Home Training" unit vs an in-center). Genuine judgment.
  return {
    suggest: 'uncertain', needs_llm: true, layer: 'deterministic', confidence: 0,
    reason: f.same_norm_address
      ? 'Same normalized address with a competing/other identity — could be an operator change (merge) or two facilities (distinct); needs judgment.'
      : (f.n_anchors > 1
        ? 'Multiple nearby anchors — ambiguous which is the twin; needs judgment.'
        : 'Same operator but the clinic names diverge (e.g. a home-training unit vs an in-center) — needs judgment.'),
  };
}

// ── Layer 2: Ollama assist (annotation-only) for the uncertain residue ─────────
// The verbatim-evidence corpus. The model's evidence_quote MUST be a substring of
// this (whitespace-normalized) or the annotation is dropped. Only structured facts
// go in — the model has nothing else to ground on and cannot fabricate.
export function twinEvidenceText(detail) {
  const f = twinFieldsFrom(detail);
  const lines = [
    'anchor_tenant: ' + (f.anchor_tenant || '(blank)'),
    'shadow_tenant: ' + (f.shadow_tenant || '(blank)'),
    'anchor_operator: ' + (f.anchor_operator || '(blank)'),
    'shadow_operator: ' + (f.shadow_operator || '(blank)'),
    'same_normalized_address: ' + (f.same_norm_address ? 'true' : 'false'),
    'nearby_anchor_count: ' + f.n_anchors,
    'distance_miles: ' + (f.distance_miles == null ? 'unknown' : f.distance_miles),
  ];
  return lines.join('\n');
}

export function buildTwinAssistPrompt(detail) {
  const evidence = twinEvidenceText(detail);
  return [
    'You are the LCC Ollama property address-twin assist agent.',
    'You ONLY annotate. You never decide, never merge records, never write data, and never invent a fact.',
    '',
    'Two dia dialysis property records sit at nearly the same coordinates. One is the CMS-anchored',
    'clinic (the "anchor"); the other is a geocoded shadow. Decide whether they are the SAME facility',
    'captured twice, or DISTINCT clinics that merely share an address/plaza. Judge ONLY on the evidence',
    'fields below — do not use outside knowledge, do not fabricate a name.',
    '',
    'CRITICAL footgun: co-located is NOT the same as a twin. Two DIFFERENT operators at the same',
    'coordinates (e.g. anchor_operator: davita and shadow_operator: fresenius) are DISTINCT co-located',
    'clinics -> "distinct_colocated". Same operator with a near-identical name -> "same_facility".',
    'A same-address pair whose operators differ could be an operator change (same_facility) OR two',
    'facilities (distinct_colocated) — if the evidence does not clearly resolve it, return "uncertain".',
    '',
    'Return ONLY strict JSON with keys: verdict, confidence, evidence_quote, reason.',
    '- verdict: one of "same_facility", "distinct_colocated", "uncertain".',
    '- confidence: 0.0 to 1.0 that the verdict is correct.',
    '- evidence_quote: a SHORT string copied VERBATIM from the evidence block below (e.g. a tenant or',
    '  operator line). It MUST appear character-for-character in the evidence — never paraphrase or invent.',
    '- reason: one short sentence citing that evidence.',
    'If unsure, use "uncertain" — a human makes the merge call; you only sort the lane.',
    '',
    'EVIDENCE:',
    evidence,
  ].join('\n');
}

// Tolerant JSON extraction (fenced ```json, then first-brace/last-brace fallback) —
// same shape as the clean-assist / sf-link / match-disambig parsers.
export function parseTwinAssistJson(text) {
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

const VERDICT_MAP = { same_facility: 'merge', distinct_colocated: 'not', uncertain: 'uncertain' };

// Normalize the model's raw answer into the stored annotation. HARD INVARIANT:
// a DECISIVE verdict (merge/not) MUST carry an evidence_quote that is a verbatim
// substring of `evidenceText`; otherwise the annotation is DROPPED (returns
// { dropped: true, drop_reason }) — the precision floor. An 'uncertain' verdict is
// kept without a quote (it never sorts high). NEVER a verdict — annotation only.
export function normalizeTwinAssistProposal(raw, evidenceText) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  let mapped = VERDICT_MAP[String(obj.verdict || '').toLowerCase().trim()];
  if (!PT_VERDICTS.has(mapped || '')) mapped = 'uncertain';
  const confidence = clampConfidence(obj.confidence);
  const reason = cleanReason(obj.reason) || 'No grounded reason supplied.';
  const quoteRaw = cleanReason(obj.evidence_quote, 300);

  if (mapped === 'merge' || mapped === 'not') {
    if (!quoteRaw) {
      return { dropped: true, drop_reason: 'no_evidence', verdict: mapped, confidence, reason, layer: 'llm' };
    }
    if (!quoteVerbatimInEvidence(quoteRaw, evidenceText)) {
      return { dropped: true, drop_reason: 'quote_not_verbatim', verdict: mapped, confidence, reason,
        evidence_quote: quoteRaw, layer: 'llm' };
    }
  }
  // Keep. For an uncertain verdict, only surface a quote if it happens to be
  // verbatim (never fabricate one into the record).
  const keptQuote = (quoteRaw && quoteVerbatimInEvidence(quoteRaw, evidenceText)) ? quoteRaw : null;
  return {
    dropped: false, verdict: mapped, confidence, reason,
    evidence_quote: keptQuote, layer: 'llm',
  };
}

// The lane orders easy-first by an assist SORT KEY. A deterministic decisive call
// ranks above an LLM decisive call, which ranks above uncertain; higher confidence
// first within a band. No assist => 0 (falls to the rank_value / distance tiebreak).
export function twinAssistSortKey(assist) {
  if (!assist) return 0;
  const v = String(assist.verdict || '').toLowerCase();
  const conf = clampConfidence(assist.confidence);
  const decisive = (v === 'merge' || v === 'not');
  if (!decisive) return conf;                                   // uncertain: 0..1
  const deterministic = String(assist.layer || '') === 'deterministic';
  return (deterministic ? 3 : 2) + conf;                        // llm decisive 2..3, det 3..4
}

// Self-measure (U4): compare the assist verdict to the human's actual verdict.
// Human verdicts on this lane are 'merge' | 'not_twin' | 'research'. Only a
// decisive assist verdict (merge/not) against a decisive human verdict
// (merge/not_twin) is measured — an honest accuracy denominator; 'uncertain' /
// 'research' are not counted.
export function twinAssistAgreement(assistVerdict, humanVerdict) {
  const a = String(assistVerdict || '').toLowerCase();
  const h = String(humanVerdict || '').toLowerCase();
  if (a !== 'merge' && a !== 'not') return { measured: false, agreed: null, assist_verdict: a, human_verdict: h };
  if (h !== 'merge' && h !== 'not_twin') return { measured: false, agreed: null, assist_verdict: a, human_verdict: h };
  const assistSays = a === 'merge' ? 'merge' : 'not_twin';
  return { measured: true, agreed: assistSays === h, assist_verdict: a, human_verdict: h };
}

// Convenience: run the two layers and return the annotation-ready proposal for a
// row, given its detail + (optionally) a pre-fetched LLM raw answer. Pure — the
// caller supplies the model output (or null to force the deterministic result /
// an uncertain fallback). Used by the handler and directly unit-testable.
export function buildProposalFromLayers(detail, llmRaw) {
  const det = classifyTwinDeterministic(detail);
  if (!det.needs_llm) {
    return { verdict: det.suggest, confidence: det.confidence, reason: det.reason,
      layer: 'deterministic', evidence_quote: null, dropped: false };
  }
  if (llmRaw == null) {
    // No model answer available — keep the deterministic 'uncertain' so the row is
    // annotated (and drops out of the resumable cursor) rather than re-scored forever.
    return { verdict: 'uncertain', confidence: 0, reason: det.reason,
      layer: 'deterministic', evidence_quote: null, dropped: false };
  }
  const evidenceText = twinEvidenceText(detail);
  const norm = normalizeTwinAssistProposal(llmRaw, evidenceText);
  if (norm.dropped) {
    // Precision floor tripped — persist an honest 'uncertain' (layer llm) so the
    // card still shows the residue and the cursor advances; the drop is counted.
    return { verdict: 'uncertain', confidence: 0,
      reason: 'Assist uncertain (evidence quote not verbatim — dropped: ' + norm.drop_reason + ').',
      layer: 'llm', evidence_quote: null, dropped: true, drop_reason: norm.drop_reason };
  }
  return norm;
}

export { normalizeForMatch };
