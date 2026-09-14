// api/_shared/next-step-ai.js
// Phase 1 — content-aware next-step engine (ESM).
//
// Reads an inbound message (subject + body) on a live deal and derives the SPECIFIC
// next action Scott should take, so the self-updating to-do created by
// lcc_advance_todos is titled/typed/dated from what the correspondent actually said
// rather than the generic "Review seller response & set next step".
//
// Design contract (all doctrine-compliant):
//   * Deterministic-first: a keyword pre-classifier resolves the common intents with
//     zero AI spend; AI is only consulted when the deterministic pass is unsure.
//   * Best-effort / never-block: any error, low confidence, or missing config returns
//     null and the caller falls back to the generic review_response to-do. The engine
//     can NEVER throw into the correspondence-logging path.
//   * Feature-gated: OFF unless process.env.NEXT_STEP_AI is truthy. Unset => returns null.
//   * Honest provenance: returns {intent, next_action, action_type, due_offset,
//     confidence, source} so the caller can stamp metadata.ai_* on the to-do.
//   * Never fabricate: if the model doesn't state an intent, we do not invent a task —
//     we return null (generic fallback), we don't guess a due date out of thin air.
//
// The action_type values below are the canonical set lcc_advance_todos writes; the
// existence-guard in that function keys on action_type, so keep this map in sync with
// the DB. Adding a new intent here is safe (unknown types still insert), but prefer the
// canonical set so the queue and auto-resolve sweeps recognize the row.

const TRUTHY = { '1': 1, 'true': 1, 'on': 1, 'yes': 1 };
export const NEXT_STEP_AI_ENABLED = () =>
  String(process.env.NEXT_STEP_AI || '').trim().toLowerCase() in TRUTHY;

// Role-aware intent maps. Intents (from the classifier) are premise-neutral; only the
// FRAMING (action_type + verb) changes by who we're corresponding with. Since our deals are
// listings, inbound mail is usually a BUYER or cooperating BROKER, not the seller — so a
// buyer's "we'll get back" must become buyer_follow_up, not seller_follow_up.
export const PREMISES = ['seller', 'buyer', 'broker', 'other'];

// Build the intent→{action_type,verb,due} map for a given premise.
export function intentMapFor(premise = 'seller') {
  const p = PREMISES.includes(premise) ? premise : 'other';
  const who = p === 'buyer' ? 'buyer' : p === 'broker' ? 'cooperating broker' : p === 'seller' ? 'seller' : 'counterparty';
  const follow = p === 'buyer' ? 'buyer_follow_up' : p === 'broker' ? 'broker_follow_up' : 'seller_follow_up';
  const docWord = p === 'buyer' ? 'diligence' : 'documents';
  const counterType = p === 'seller' ? 'review_counter' : 'review_offer';
  const counterWord = p === 'seller' ? 'counter' : 'offer';
  const acceptVerb = p === 'buyer' ? 'Confirm terms & open escrow with buyer' : 'Move to PSA / open escrow';
  return {
    needs_time:    { action_type: follow, verb: `Follow up with ${who}`, due: 1 },
    will_get_back: { action_type: follow, verb: `Follow up with ${who}`, due: 1 },
    requests_info: { action_type: 'send_info', verb: `Send requested info to ${who}`, due: 0 },
    requests_docs: { action_type: 'send_info', verb: `Send requested ${docWord} to ${who}`, due: 0 },
    wants_call:    { action_type: 'schedule_call', verb: `Schedule a call with ${who}`, due: 0 },
    counter_offer: { action_type: counterType, verb: `Review ${who} ${counterWord} & respond`, due: 0 },
    accepted:      { action_type: 'advance_to_contract', verb: acceptVerb, due: 0 },
    verbal_yes:    { action_type: 'advance_to_contract', verb: 'Confirm terms & send PSA', due: 0 },
    declined:      { action_type: 'log_pass', verb: `Log ${who} pass & set nurture cadence`, due: 0 },
    unclear:       null,
  };
}

// Default (seller) map — retained for back-compat and as the fallback premise.
export const INTENT_MAP = intentMapFor('seller');

// Fast deterministic classifier. Returns an intent key or null (=> escalate to AI).
// Ordered most-specific first; the first hit wins.
export function classifyDeterministic(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  const has = (...ws) => ws.some((w) => t.includes(w));

  // Acceptance / verbal yes (check before "counter"/"terms" generic hits)
  if (has('we accept', 'i accept', 'accept your offer', 'accept the offer', 'we have a deal', 'you have a deal', "let's move forward", 'lets move forward', 'move forward with the deal'))
    return 'accepted';
  if (has('sounds good, send', 'send over the psa', 'send the psa', 'send the contract', 'draw up the contract', 'ready to sign'))
    return 'verbal_yes';
  // Decline / pass
  if (has('we will pass', 'going to pass', 'decided to pass', 'not going to sell', 'no longer selling', 'not interested', 'going a different direction', 'went with another'))
    return 'declined';
  // Counter
  if (has('counter', 'we can do', 'we could do', 'our number is', 'looking for', 'need to be at', 'closer to', 'if you can get to', 'come up to'))
    return 'counter_offer';
  // Wants a call / meeting
  if (has('give me a call', 'call me', 'jump on a call', 'hop on a call', 'schedule a call', 'let’s talk', "let's talk", 'can we talk', 'set up a time', 'get on the phone'))
    return 'wants_call';
  // Requests docs specifically
  if (has('rent roll', 'operating statement', 'financials', 'estoppel', 'lease copy', 'copy of the lease', 'proof of funds', 't-12', 't12', 'p&l', 'send me the', 'can you send', 'please send'))
    return has('proof of funds', 'financing', 'lender') ? 'requests_info' : 'requests_docs';
  // Requests generic info / question
  if (has('what is the', "what's the", 'can you confirm', 'question about', 'clarify', 'how did you', 'where did you get'))
    return 'requests_info';
  // Needs time / will get back
  if (has('discuss with my partner', 'talk to my partner', 'run it by', 'get back to you', 'circle back', 'need a few days', 'need some time', 'let me think', 'give me until', 'by end of week', 'by friday', 'by monday'))
    return 'will_get_back';

  return null; // ambiguous -> AI (if enabled) or generic fallback
}

// Build the shaped result from an intent key + optional explicit due override, framed for
// the given premise (seller/buyer/broker/other).
export function shapeFromIntent(intent, { confidence = 0.7, source = 'deterministic', dueOverride = null, premise = 'seller' } = {}) {
  const map = intentMapFor(premise);
  if (!intent || !(intent in map)) return null;
  const spec = map[intent];
  if (!spec) return null; // 'unclear' -> generic fallback
  const due = dueOverride == null ? spec.due : Math.max(0, Number(dueOverride) || 0);
  return {
    intent,
    premise,
    next_action: spec.verb,               // human verb; lcc_advance_todos appends " — <deal>"
    action_type: spec.action_type,        // canonical type the queue understands
    due_offset: due,                      // integer days from today
    confidence: Number(confidence.toFixed(2)),
    source,
  };
}

// The AI escalation prompt — strict JSON, single intent from a closed set.
export function buildPrompt(subject, body, dealName, premise = 'seller') {
  const intents = Object.keys(INTENT_MAP).join(', ');
  return [
    'You are triaging one inbound message on a commercial real estate deal to decide the broker’s single next action.',
    premise && premise !== 'seller' ? `The sender is the ${premise === 'broker' ? 'cooperating broker' : premise} on this deal.` : null,
    dealName ? `Deal: ${dealName}` : null,
    `Subject: ${subject || '(none)'}`,
    `Message:\n${String(body || '').slice(0, 4000)}`,
    '',
    `Classify the sender’s message into exactly ONE intent from this closed set: ${intents}.`,
    'Use "unclear" if the message does not clearly imply one of the others. Do NOT invent an intent.',
    'Also estimate how many days from today the broker should act (0 = today, 1 = tomorrow, up to 7).',
    'Respond with ONLY a compact JSON object, no prose, no code fence:',
    '{"intent":"<one of the set>","due_offset":<int 0-7>,"confidence":<0..1>}',
  ].filter(Boolean).join('\n');
}

// Defensive JSON extraction from a model response (string or object).
export function parseModelJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  const s = String(raw);
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * deriveNextStep — the Phase 1 entry point.
 *
 * @param {string} subject
 * @param {string} body
 * @param {string|null} dealName
 * @param {object} deps  { invokeExtractionAI }  (injected for testability)
 * @returns {Promise<null | {intent,next_action,action_type,due_offset,confidence,source}>}
 *
 * Returns null whenever the caller should fall back to the generic review_response
 * to-do: feature off, empty text, low confidence, AI error, or 'unclear' intent.
 */
export async function deriveNextStep(subject, body, dealName = null, deps = {}) {
  try {
    if (!NEXT_STEP_AI_ENABLED()) return null;
    const text = `${subject || ''}\n${body || ''}`;
    if (!text.trim()) return null;

    // Premise = who the sender is relative to the deal (seller/buyer/broker/other). Defaults
    // to seller. The caller resolves it (e.g. via lcc_party_role) and passes deps.premise.
    const premise = PREMISES.includes(deps.premise) ? deps.premise : 'seller';
    const map = intentMapFor(premise);

    // 1) Deterministic pass — free, and the common cases resolve here.
    const detIntent = classifyDeterministic(text);
    if (detIntent) {
      // High confidence for the deterministic hits; they're keyword-anchored.
      return shapeFromIntent(detIntent, { confidence: 0.85, source: 'deterministic', premise });
    }

    // 2) AI escalation — only for the genuinely ambiguous tail.
    const invoke = deps.invokeExtractionAI;
    if (typeof invoke !== 'function') return null;

    let resp;
    try {
      resp = await invoke({ prompt: buildPrompt(subject, body, dealName, premise), surface: 'next_step' });
    } catch (_e) {
      return null; // never block the correspondence path on an AI failure
    }
    // invokeExtractionAI returns { data:{ response } }; also tolerate other shapes.
    const raw = (resp && (resp.data?.response ?? resp.text ?? resp.content ?? resp.output ?? resp.message)) ?? resp;
    const j = parseModelJson(raw);
    if (!j || typeof j.intent !== 'string') return null;

    const intent = j.intent.trim().toLowerCase();
    const conf = Number(j.confidence);
    // Confidence gate: below floor OR unclear -> generic fallback.
    if (!(intent in map) || map[intent] == null) return null;
    if (!Number.isFinite(conf) || conf < 0.6) return null;

    const dueOverride = Number.isFinite(Number(j.due_offset))
      ? Math.min(7, Math.max(0, Math.round(Number(j.due_offset))))
      : null;
    return shapeFromIntent(intent, { confidence: conf, source: 'ai', dueOverride, premise });
  } catch (_e) {
    return null; // total guard — the engine is invisible when it fails
  }
}
