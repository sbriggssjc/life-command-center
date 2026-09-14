// api/_shared/bench-role-inference-planner.js
// ============================================================================
// ACI-phase2-unitC — AC3, Ollama infers the §3a four-bucket function
// (acquisitions / disposition / transaction_dd / broker) per bench candidate.
// ----------------------------------------------------------------------------
// Reuses the repo's existing extraction-AI seam (`invokeExtractionAI` from
// `ai.js`, the same call `ownership-chain-draft-planner.js`'s role-label layer
// and `property-twin-assist-planner.js`'s Layer 2 use) rather than inventing a
// new Ollama integration. The deterministic/no-LLM half runs first, exactly as
// those two modules do — here that is `titleFunctionHint()`, which decides the
// function from a TITLE alone when one exists and maps cleanly. The model is
// only called when title evidence is absent or ambiguous.
//
// ⚠️ THE CORE OF THIS MODULE IS THE CONFIDENCE CAP, PER P181 (CLAUDE.md):
// "a genuine judgement call and a worthless one must not wear the same label."
// Title coverage is 5.2% (`unified_contacts.title`, re-measured live
// 2026-09-10). A title-present, title-mapped candidate is a HIGH-confidence
// read — it says so in the record ("EVP — Acquisitions"). A candidate with no
// title, scored purely from correspondence subject lines by a model, can be
// RIGHT, but it is a different KIND of fact and must never report 'high' —
// `resolveCandidateFunction()` caps a correspondence-only verdict at 'medium'
// even when the model itself claims 'high', and reports the BASIS
// ('title' vs 'correspondence_inferred') alongside the confidence so a
// consumer can never mistake one for the other. This is the exact guard this
// prompt's test suite is built to catch a regression of.
//
// ⚠️ VERBATIM-QUOTE GUARD (the W8-U3 / EXT1 pattern, CLAUDE.md's "a model's
// quote and its label are not the same evidence"). The model is asked for an
// `evidence_quote`; `parseRoleInferenceResponse()` DROPS the whole verdict
// (function -> null) if that quote is not a literal substring of one of the
// subject lines it was given — a hallucinated citation must not stand, ever.
// ============================================================================

import { invokeExtractionAI } from './ai.js';
import { BENCH_FUNCTION_TAXONOMY } from './bench-ranking-planner.js';

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

const TITLE_FUNCTION_PATTERNS = [
  // Order matters: a title like "EVP - Acquisitions & Portfolio Manager"
  // (Pulliam's real title, per the doc's worked example) must classify as
  // acquisitions, not "portfolio manager" -> transaction_dd; acquisitions is
  // checked first.
  { fn: 'acquisitions', re: /\b(acquisitions?|investments?)\b/i },
  { fn: 'disposition', re: /\b(dispositions?)\b/i },
  { fn: 'broker', re: /\b(broker|brokerage)\b/i },
  { fn: 'transaction_dd', re: /\b(due\s*diligence|transaction(s)?(\s+manager|\s+management)?|closing|escrow|asset\s+management|portfolio\s+manager)\b/i },
];

/**
 * Deterministic, no-LLM: does the TITLE alone establish the function?
 * @param {string|null|undefined} title
 * @returns {{function:string, confidence:'high', basis:'title'}|null}
 */
export function titleFunctionHint(title) {
  const t = String(title || '').trim();
  if (!t) return null;
  for (const p of TITLE_FUNCTION_PATTERNS) {
    if (p.re.test(t)) return { function: p.fn, confidence: 'high', basis: 'title' };
  }
  return null; // title present but does not map to the taxonomy -> falls to correspondence
}

/**
 * Build the extraction prompt. Pure string builder — no I/O.
 * @param {{personName:string, title?:string|null, subjectLines?:string[], sfContext?:string|null}} input
 * @returns {string}
 */
export function buildRoleInferencePrompt({ personName, title, subjectLines, sfContext } = {}) {
  const subjects = Array.isArray(subjectLines) ? subjectLines.filter(Boolean) : [];
  const lines = [
    'You are classifying which of FOUR functional roles a real-estate deal contact',
    'plays at their firm, from correspondence subject lines only. Do NOT guess a',
    'name, employer, or fact not present in the evidence below.',
    '',
    'TAXONOMY (pick exactly one, or null if the evidence does not support any):',
    '- acquisitions: sources/underwrites/closes NEW purchases for their firm (the buy-side target)',
    '- disposition: sells assets FOR their firm (institutional seller BD contact)',
    '- transaction_dd: deal execution / due diligence / closing mechanics / asset management for ONE deal (not a pursuit target)',
    '- broker: represents a DIFFERENT party as an intermediary (never a principal-buyer target)',
    '',
    `PERSON: ${personName || '(unknown)'}`,
    `TITLE ON FILE: ${title ? title : '(none on file)'}`,
    sfContext ? `SALESFORCE CONTEXT: ${sfContext}` : null,
    '',
    'EMAIL SUBJECT LINES (their correspondence with us):',
    ...(subjects.length ? subjects.map((s) => `- ${s}`) : ['(none available)']),
    '',
    'Respond with ONLY a JSON object, no prose:',
    '{"function": "acquisitions"|"disposition"|"transaction_dd"|"broker"|null,',
    ' "confidence": "high"|"medium"|"low",',
    ' "evidence_quote": "<a VERBATIM substring of one subject line above, or null if none supports it>"}',
    '',
    'If the subject lines do not clearly support any bucket, return function: null and',
    'confidence: "low" rather than guessing. evidence_quote must be copied EXACTLY from',
    'a subject line above — never paraphrased, never invented.',
  ].filter((l) => l !== null);
  return lines.join('\n');
}

function extractJsonObject(raw) {
  const s = String(raw || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Parse + guard the model's response. Drops the whole verdict (returns null
 * function) if the taxonomy value is unrecognised, the confidence value is
 * unrecognised, or the evidence_quote is not a verbatim substring of a
 * provided subject line — never let a hallucinated citation stand.
 *
 * @param {string} raw
 * @param {{subjectLines?: string[]}} [ctx]
 * @returns {{function:string|null, confidence:string|null, evidence_quote:string|null}|null}
 *   null when the response could not be parsed at all (a call/parse failure,
 *   distinct from a genuine abstention, which returns function:null).
 */
export function parseRoleInferenceResponse(raw, ctx = {}) {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  const subjectLines = Array.isArray(ctx.subjectLines) ? ctx.subjectLines : [];
  let fn = parsed.function == null ? null : String(parsed.function).trim();
  if (fn && !BENCH_FUNCTION_TAXONOMY.includes(fn)) fn = null; // unrecognised value -> abstain, never guess a bucket
  let confidence = parsed.confidence == null ? null : String(parsed.confidence).trim().toLowerCase();
  if (confidence && !CONFIDENCE_LEVELS.includes(confidence)) confidence = 'low';

  let quote = parsed.evidence_quote == null ? null : String(parsed.evidence_quote).trim();
  if (quote) {
    const verbatim = subjectLines.some((s) => String(s || '').includes(quote));
    if (!verbatim) {
      // Hallucinated citation -> the whole verdict is untrustworthy, not just
      // the quote. Drop the function too, per the W8-U3/EXT1 doctrine.
      return { function: null, confidence: null, evidence_quote: null };
    }
  }

  if (!fn) return { function: null, confidence: null, evidence_quote: null };
  return { function: fn, confidence: confidence || 'low', evidence_quote: quote };
}

/**
 * THE P181 CONFIDENCE GATE. Combines a title hint (when present and mapped)
 * with a correspondence-only AI result, and CAPS the AI result's confidence so
 * a titleless candidate can never report 'high' — regardless of what the model
 * itself claimed.
 *
 * @param {{title?:string|null, aiResult?:{function:string|null, confidence:string|null, evidence_quote:string|null}|null}} a
 * @returns {{function:string|null, confidence:'high'|'medium'|'low'|null, basis:string, evidence_quote:string|null}}
 */
export function resolveCandidateFunction({ title, aiResult } = {}) {
  const hint = titleFunctionHint(title);
  if (hint) {
    return { function: hint.function, confidence: 'high', basis: 'title', evidence_quote: null };
  }

  const hasTitle = !!String(title || '').trim();
  if (!aiResult || !aiResult.function) {
    return {
      function: null,
      confidence: null,
      basis: hasTitle ? 'title_unmapped_no_evidence' : 'no_title_no_evidence',
      evidence_quote: null,
    };
  }

  // ⚠️ THE CAP. A correspondence-only read is a DIFFERENT KIND of fact than a
  // title on file — it must never wear 'high', the label a title earns.
  const cappedConfidence = aiResult.confidence === 'high' ? 'medium'
    : (CONFIDENCE_LEVELS.includes(aiResult.confidence) ? aiResult.confidence : 'low');

  return {
    function: aiResult.function,
    confidence: cappedConfidence,
    basis: hasTitle ? 'title_unmapped_correspondence_inferred' : 'correspondence_inferred',
    evidence_quote: aiResult.evidence_quote || null,
  };
}

/**
 * Orchestrate AC3 over a list of bench candidates. The AI call is injectable
 * (`invoke`) so callers/tests never need real network access; defaults to the
 * repo's shared `invokeExtractionAI`.
 *
 * @param {Array<{name:string, title?:string|null, subject_lines?:string[], sf_context?:string|null}>} candidates
 * @param {{invoke?: Function, surface?: string}} [opts]
 * @returns {Promise<Array<object>>} each candidate + inferred_function/_confidence/_basis/_evidence
 */
export async function inferBenchRoles(candidates, opts = {}) {
  const invoke = typeof opts.invoke === 'function' ? opts.invoke : invokeExtractionAI;
  const surface = opts.surface || 'bench_role_inference';
  const list = Array.isArray(candidates) ? candidates : [];
  const out = [];
  for (const c of list) {
    const hint = titleFunctionHint(c && c.title);
    if (hint) {
      out.push({
        ...c,
        inferred_function: hint.function,
        inferred_function_confidence: hint.confidence,
        inferred_function_basis: hint.basis,
        inferred_function_evidence: null,
      });
      continue;
    }

    const subjectLines = Array.isArray(c && c.subject_lines) ? c.subject_lines : [];
    let aiResult = null;
    if (subjectLines.length) {
      try {
        const prompt = buildRoleInferencePrompt({
          personName: c && c.name, title: c && c.title, subjectLines, sfContext: c && c.sf_context,
        });
        const ai = await invoke({ prompt, surface });
        const raw = (ai && ai.data && ai.data.response) || (ai && ai.text) || '';
        aiResult = parseRoleInferenceResponse(raw, { subjectLines });
      } catch (_e) {
        aiResult = null; // a call failure abstains — never fabricates a function
      }
    }
    const resolved = resolveCandidateFunction({ title: c && c.title, aiResult });
    out.push({
      ...c,
      inferred_function: resolved.function,
      inferred_function_confidence: resolved.confidence,
      inferred_function_basis: resolved.basis,
      inferred_function_evidence: resolved.evidence_quote,
    });
  }
  return out;
}

export default inferBenchRoles;
