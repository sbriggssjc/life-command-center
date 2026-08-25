// ============================================================================
// api/draft-assist.js — W10 Stage 2 (Prompt 107): retrieval-grounded drafting.
//
// GET  /api/draft-assist?...   DRY-RUN — assembles + returns the draft, the
//                              retrieval (exemplar ids), the facts (+ "Not on
//                              file" gaps), and a voice_confidence note. Writes
//                              NOTHING. Always available (does not need the flag).
// POST /api/draft-assist       Saves the assembled draft to Scott's Outlook
//                              Drafts (via the Power-Automate save-not-send
//                              seam). Flag-gated on DRAFT_ASSIST. NEVER SENDS.
//
// DOCTRINE (enforced structurally — see the tests):
//  1. Never auto-send. The ONLY outbound call on this path is
//     createOutlookDraftViaPA (creates a DRAFT). There is no Graph /sendMail,
//     no invokeChatProvider send, nothing that transmits to a recipient.
//  2. Never fabricate facts. Facts come from buildDealPacket → extractDealFacts
//     ("Not on file" for gaps); the generated draft is run through
//     validateDraftFacts, which strips any number/date not grounded in the
//     supplied facts or the retrieved exemplars.
//  3. Strategy stays verbal — the prompt forbids negotiation/recommendations.
//  4. On-prem generation ONLY. invokeOnPremGeneration talks to the local Ollama
//     and FAILS CLOSED (no cloud fallback) — Scott's corpus never egresses.
//  5. Honest about what the voice is grounded in, per draft, via voice_confidence:
//     the note is derived from the RETRIEVED exemplars' actual body lengths, so a
//     draft built on real full bodies says so and one that fell back to preview-era
//     openings keeps the ~255-char caveat (P117).
//
// Input (GET query or POST body):
//   purpose      cold_bd | follow_up | broker_to_broker | client_update |
//                loi_ack | listing_announcement | relationship_touch   (required)
//   intent       one-line description of what the email should do        (required)
//   recipient    an email address (used to bias retrieval + as the draft To)
//   entity_id    optional LCC entity/deal id — pulls facts from the spine
//   save         (POST) true to actually create the Outlook draft
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { handleCors, authenticate } from './_shared/auth.js';
import { opsQuery, isOpsConfigured } from './_shared/ops-db.js';
import { cleanEmailBody, classifyDraftType, pickBestBody, voiceCorpusExclusion } from './_shared/voice-corpus-clean.js';
import { invokeOnPremGeneration, invokeOnPremEmbeddings } from './_shared/ai.js';
import { buildDealPacket } from './_handlers/entities-handler.js';
import { createOutlookDraftViaPA } from './_shared/outlook-draft.js';
import { appendSignature } from './_shared/email-signature.js';
import { flagEnabled, fetchFeatureFlag } from './_shared/feature-flag.js';
import {
  SCOTT_FROM, VALID_PURPOSES,
  bucketForPurpose, extractDealFacts, rankExemplarsDeterministic, rankExemplarsByEmbedding,
  selectExemplars, exemplarBodyCoverage, recipientMatchLevel,
  buildGenerationPrompt, parseDraftJson, validateDraftFacts, voiceConfidenceNote,
} from './_shared/draft-assist-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOICE_PROFILE_PATH = path.resolve(__dirname, '..', 'BRIGGS-WRITING-VOICE.md');

function flagOn(v) {
  return /^(1|true|on|yes)$/i.test(String(v == null ? '' : v).trim());
}

let _voiceCache = null;
function loadVoiceProfile() {
  if (_voiceCache != null) return _voiceCache;
  try { _voiceCache = readFileSync(VOICE_PROFILE_PATH, 'utf8'); }
  catch { _voiceCache = ''; }
  return _voiceCache;
}

// Page budget. Scott's whole outbound corpus is ~2,139 rows live (2026-08-21), so
// this leaves years of headroom; `truncated` reports it honestly if it ever binds.
const CORPUS_PAGE_CAP = 6000;

// PostgREST caps at 1000 rows/page (CLAUDE.md footgun) — stride 1000.
// P125: `truncated` is set when the cap stopped a still-producing scan, so a
// silently-clipped corpus can never read as a complete one.
async function pageAll(build, cap = CORPUS_PAGE_CAP) {
  const out = [];
  let truncated = false;
  for (let offset = 0; out.length < cap; offset += 1000) {
    const res = await opsQuery('GET', build(offset, 1000), null, { countMode: 'none', timeoutMs: 12000 });
    const rows = res && res.ok && Array.isArray(res.data) ? res.data : [];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < 1000) break;
    if (out.length >= cap) { truncated = true; break; }
  }
  out.truncated = truncated;
  return out;
}

// ⚠️ P125 — FILTER THE AUTHOR AT THE DATABASE, NOT IN JS.
//
// Both queries used to page the newest `CORPUS_PAGE_CAP` rows of the WHOLE store
// and only then drop everything not authored by Scott. Since the stores hold every
// message in the mailbox, that spent the entire page budget on inbound mail:
// measured live on LCC Opps 2026-08-21, `email_bodies` holds 28,090 body-bearing
// rows of which 1,188 are Scott's — so the newest-3,000 window contained just
// **565 of them**, and `retrieval.corpus_size` reported a number far below the
// corpus that exists. Worse, the shortfall is invisible: a smaller corpus still
// returns five exemplars and every field reads healthy.
//
// Pushing SCOTT_FROM into the PostgREST filter makes the page budget buy only
// usable rows — Scott's whole outbound corpus (1,188 + 951 = 2,139 live) now fits
// inside one cap with headroom, so `corpus_size` reconciles with the DB.
const SCOTT_FROM_FILTER = [...SCOTT_FROM].join(',');   // verified all-lowercase live

/**
 * Load + clean Scott's authored SENT corpus (outbound only) from both stores,
 * bucketed by draft-type. Only rows whose from-address is in SCOTT_FROM survive
 * — retrieval never quotes inbound. Returns cleaned exemplar candidates.
 */
async function loadCorpus() {
  const [ae, eb] = await Promise.all([
    pageAll((o, l) =>
      `activity_events?select=id,body,title,metadata,occurred_at` +
      `&source_type=in.(outlook,outlook_sent,outlook_tagged)` +
      `&body=not.is.null` +
      // P125: author-filter at the DB (see the SCOTT_FROM_FILTER note). The JS
      // SCOTT_FROM.has() gate below is KEPT as the authority — this only stops the
      // page budget being spent on mail we are about to discard.
      `&metadata->>from_email=in.(${SCOTT_FROM_FILTER})` +
      `&order=occurred_at.desc&offset=${o}&limit=${l}`),
    pageAll((o, l) =>
      `email_bodies?select=id,body_preview,body_text,body_html,subject,from_email,to_emails,cc_emails,sent_at,received_at,internet_message_id` +
      // P117: gate on ANY body column, not `body_preview` alone — a body-only row
      // (full html, no preview) is exactly the exemplar we most want and the old
      // filter would have made it invisible. Harmless today (0 such rows live),
      // latent tomorrow.
      `&or=(body_preview.not.is.null,body_text.not.is.null,body_html.not.is.null)` +
      `&from_email=in.(${SCOTT_FROM_FILTER})` +
      `&order=received_at.desc&offset=${o}&limit=${l}`),
  ]);

  const seen = new Set();
  const rows = [];
  let excludedPersonal = 0;
  let fullBodyRows = 0;
  const push = (id, imid, raw, subject, from, toEmails, ccEmails, ts, fullBody) => {
    if (!SCOTT_FROM.has(String(from || '').toLowerCase())) return;   // outbound-only gate
    const key = imid || `body:${String(raw).slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const cleaned = cleanEmailBody(raw);
    // P117: `from_email` alone is NOT authorship on this store. Without this gate
    // retrieval could quote the app's OWN generated briefing, or inbound mail filed
    // under Scott's address, back at him as an exemplar of his voice.
    if (voiceCorpusExclusion({ cleaned, subject, toEmails, ccEmails, fromEmail: from })) return;
    const { bucket, excludeFromCorpus } = classifyDraftType({ cleaned, subject, toEmails, fromEmail: from });
    // P124: drop the personal/unclassified residue BEFORE it reaches the pool.
    // Doing it here (not at rank time) is load-bearing: retrieveExemplars falls
    // back to the WHOLE corpus whenever the target bucket is thin, and the thin
    // buckets are exactly the ones that trigger that fallback — so a rank-time
    // filter would still have let a bunk note become a cold-BD exemplar.
    if (excludeFromCorpus) { excludedPersonal += 1; return; }
    if (fullBody) fullBodyRows += 1;
    rows.push({
      id: imid || String(id), cleaned, subject: subject || '', bucket,
      toEmails: toEmails || [],
      // P125: cc was never carried, so a thread where the counterparty sits on cc
      // scored as if they were not on the message at all.
      ccEmails: ccEmails || [],
      // P125: PROVENANCE, not a length guess — true iff the text came from a real
      // body column. See FULL_BODY_MIN_CHARS in draft-assist-core.js for why the
      // length heuristic it replaces was wrong on 62% of Scott's real full bodies.
      full_body: !!fullBody,
      ts,
    });
  };
  // P117 ORDER MATTERS: dedup is first-wins on internet_message_id and the stores
  // OVERLAP, so `email_bodies` (which holds the real bodies) must be drained FIRST
  // or a message's ~255-char activity_events preview claims the key and its own
  // full body is dropped as a duplicate — silently starving retrieval of exactly
  // the full-body exemplars voice_confidence now reports on.
  const hasFullBody = (o) => !!(String(o.body_text || '').trim() || String(o.body_html || '').trim());
  for (const r of eb) {
    // Prompt 110: full body_text → tag-stripped body_html → capped body_preview.
    const raw = pickBestBody({ body_text: r.body_text, body_html: r.body_html, body_preview: r.body_preview });
    push(r.id, r.internet_message_id, raw, r.subject, r.from_email, r.to_emails || [], r.cc_emails || [],
      r.sent_at || r.received_at, hasFullBody(r));
  }
  for (const r of ae) {
    const m = r.metadata || {};
    // Prompt 110: prefer a full body when the flow forwarded one into metadata
    // (body_text / body_html); fall back to the ~255-char body snippet.
    const raw = pickBestBody({ body_text: m.body_text, body_html: m.body_html, body: r.body });
    // Live 2026-08-21: 0 of 951 Scott-authored activity_events rows carry a body in
    // metadata, so this store contributes preview-only exemplars — which is exactly
    // why the full-body partition must be provenance-driven and not a length guess.
    push(r.id, m.internet_message_id, raw, r.title, m.from_email, m.to_emails || [], m.cc_emails || [],
      r.occurred_at, hasFullBody(m));
  }
  rows.excludedPersonal = excludedPersonal;   // honest count — reported, never silent
  rows.fullBodyRows = fullBodyRows;           // P125: assert on this, never on rows.length
  rows.truncated = !!(eb.truncated || ae.truncated);
  return rows;
}

/**
 * P124 — find the message this draft should REPLY to, so the Outlook draft lands
 * INSIDE the live thread rather than as a new standalone message.
 *
 * Prefers the most recent message the RECIPIENT sent us (replying to their note is
 * what threads correctly in Outlook); falls back to the newest message on any
 * thread with them. Returns null when there is no prior correspondence — a genuine
 * cold email SHOULD be a fresh thread, so "no target" is a valid answer, not a
 * failure. Never guesses across parties: the address must match exactly.
 */
async function findReplyTarget(recipient) {
  const addr = String(recipient || '').toLowerCase().trim();
  if (!addr || !addr.includes('@')) return null;
  const enc = encodeURIComponent(addr);
  const sel = 'select=internet_message_id,conversation_id,subject,from_email,received_at,sent_at';
  const pick = (rows) => {
    const r = Array.isArray(rows) ? rows.find((x) => x && x.internet_message_id) : null;
    return r ? {
      internet_message_id: r.internet_message_id,
      conversation_id: r.conversation_id || null,
      subject: r.subject || null,
      matched_on: r.from_email && String(r.from_email).toLowerCase() === addr ? 'inbound_from_recipient' : 'thread_with_recipient',
    } : null;
  };
  try {
    // 1. Their most recent message to us — the correct thing to reply to.
    const inbound = await opsQuery('GET',
      `email_bodies?${sel}&from_email=eq.${enc}&internet_message_id=not.is.null` +
      `&order=received_at.desc.nullslast&limit=5`, null, { countMode: 'none', timeoutMs: 8000 });
    const hit = pick(inbound && inbound.ok ? inbound.data : null);
    if (hit) return hit;

    // 2. Otherwise the newest message on any thread that includes them.
    const any = await opsQuery('GET',
      `email_bodies?${sel}&to_emails=cs.{"${addr}"}&internet_message_id=not.is.null` +
      `&order=received_at.desc.nullslast&limit=5`, null, { countMode: 'none', timeoutMs: 8000 });
    return pick(any && any.ok ? any.data : null);
  } catch {
    return null;   // fail-soft: an un-threaded draft is still a usable draft
  }
}

/**
 * Retrieve the 3–5 nearest exemplars. Tries on-prem embedding-KNN first (if the
 * local model answers for BOTH the query and the candidate openings); otherwise
 * falls back to the deterministic bucket+recipient+recency ranker. Never
 * egresses — invokeOnPremEmbeddings returns null when Ollama is unreachable.
 */
async function retrieveExemplars(corpus, target, intent, k = 5) {
  const pool = corpus.filter((c) => c.bucket === target.bucket);
  const candidates = pool.length >= 2 ? pool : corpus;   // fall back to full corpus if bucket is thin

  let method = 'deterministic';
  let rank = rankExemplarsDeterministic;
  try {
    const queryText = `${target.bucket} :: ${intent}`;
    const embeds = await invokeOnPremEmbeddings([queryText, ...candidates.map((c) => c.cleaned)]);
    if (Array.isArray(embeds) && embeds.length === candidates.length + 1) {
      const queryVec = embeds[0];
      candidates.forEach((c, i) => { c.vec = embeds[i + 1]; });
      method = 'embedding_knn';
      rank = (cands, tgt, n) => rankExemplarsByEmbedding(cands, queryVec, tgt, n);
    }
  } catch { /* fall through to deterministic */ }

  // P125: selectExemplars applies the full-body-first PARTITION around whichever
  // ranker won, so the "preview only as a last resort" guarantee cannot depend on
  // whether Ollama happened to answer.
  return { exemplars: selectExemplars(candidates, target, k, rank), method, pool_size: candidates.length };
}

/**
 * P125 — resolve the DEAL behind this draft when the caller did not name one.
 *
 * ⚠️ Be precise about what was wrong before: deal resolution did not FAIL, it did
 * not EXIST. `facts` were loaded only `if (entityId)`, so a dry-run that supplied
 * just a recipient reported `facts.source: 'no_entity_relational'` and attached no
 * deal context — for a live, named, in-progress deal. That reads as "no deal on
 * file" when the truth was "nobody asked".
 *
 * The ladder below invents NO matching heuristic of its own. It reads the verdict
 * the hourly deal-email matcher already recorded: that worker writes an
 * `activity_events` row with `source_type='lcc:deal_match'`, `entity_id` = the deal
 * and `external_id` = the source message's RFC internetMessageId. So the thread we
 * are replying into names its own deal, by exact id equality.
 *
 * Thread-scoped, not message-scoped, deliberately: the matcher is budget-bounded and
 * skips already-attributed mail, so the specific message we reply to often carries no
 * row while its siblings on the same `conversation_id` do (verified live 2026-08-21 —
 * the exact reply target draft-assist picked for susan.holdsworth@davita.com had no
 * row of its own, and the conversation resolved to "DaVita Dialysis - The Villages -
 * FL"). A conversation is one deal; that is what the matcher's own unit of work means.
 *
 * Returns { entityId, source } — `entityId` null when nothing resolves, with a
 * `source` naming WHICH rung came up empty. Fails soft: a draft with no deal facts
 * is still a valid relational note, and asserting a WRONG deal would be worse.
 */
async function resolveDealEntity(replyTarget) {
  if (!replyTarget || !replyTarget.internet_message_id) return { entityId: null, source: 'no_thread' };
  const enc = (v) => encodeURIComponent(String(v));
  const attributedDeal = async (imids) => {
    if (!imids.length) return null;
    // PostgREST `in.(...)`: each value double-quoted (message ids carry `<`, `@`
    // and `.`), then percent-encoded individually so the commas stay separators.
    const inList = imids.slice(0, 100)
      .map((m) => enc(`"${String(m).replace(/"/g, '')}"`)).join(',');
    const r = await opsQuery('GET',
      `activity_events?select=entity_id,occurred_at&source_type=eq.${enc('lcc:deal_match')}` +
      `&external_id=in.(${inList})&entity_id=not.is.null` +
      `&order=occurred_at.desc&limit=25`, null, { countMode: 'none', timeoutMs: 8000 });
    const rows = r && r.ok && Array.isArray(r.data) ? r.data : [];
    return rows.length ? rows[0].entity_id : null;
  };
  try {
    // Rung 1 — the exact message we are replying to.
    const direct = await attributedDeal([replyTarget.internet_message_id]);
    if (direct) return { entityId: direct, source: 'deal_match_message' };

    // Rung 2 — any message on the same conversation.
    if (!replyTarget.conversation_id) return { entityId: null, source: 'no_deal_match_and_no_conversation' };
    const thread = await opsQuery('GET',
      `email_bodies?select=internet_message_id&conversation_id=eq.${enc(replyTarget.conversation_id)}` +
      `&internet_message_id=not.is.null&order=received_at.desc&limit=100`,
      null, { countMode: 'none', timeoutMs: 8000 });
    const imids = (thread && thread.ok && Array.isArray(thread.data) ? thread.data : [])
      .map((x) => x.internet_message_id).filter(Boolean);
    const viaThread = await attributedDeal(imids);
    if (viaThread) return { entityId: viaThread, source: 'deal_match_thread' };
    return { entityId: null, source: 'thread_not_attributed_to_a_deal' };
  } catch (e) {
    // Fail soft AND fail LOUD in the payload — never silently "no deal".
    return { entityId: null, source: `deal_resolution_error:${(e && e.message) || 'unknown'}` };
  }
}

export default async function draftAssistHandler(req, res) {
  if (handleCors(req, res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  if (!isOpsConfigured()) {
    res.status(503).json({ ok: false, error: 'Ops database not configured (OPS_SUPABASE_URL/OPS_SUPABASE_KEY).' });
    return;
  }

  const isPost = req.method === 'POST';
  const src = isPost ? { ...(req.query || {}), ...(req.body || {}) } : (req.query || {});
  const purpose = String(src.purpose || '').toLowerCase().trim();
  const intent = String(src.intent || '').trim();
  const recipient = String(src.recipient || '').trim();
  const entityId = String(src.entity_id || src.entityId || src.deal_id || '').trim();

  if (!VALID_PURPOSES.includes(purpose)) {
    res.status(400).json({ ok: false, error: `purpose must be one of: ${VALID_PURPOSES.join(', ')}` });
    return;
  }
  if (!intent) {
    res.status(400).json({ ok: false, error: 'intent (a one-line description of the email) is required.' });
    return;
  }

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships?.[0]?.workspace_id;
  const bucket = bucketForPurpose(purpose, { toEmails: recipient ? [recipient] : [] });

  // 1. Thread — resolve what we are replying into FIRST. P125: the thread is also
  //    how the deal is resolved when the caller did not name one, so it can no
  //    longer be looked up after the facts are already decided.
  // P124: null ⇒ no prior correspondence ⇒ legitimately a NEW thread.
  const replyTarget = await findReplyTarget(recipient);

  // 2. Facts — from the deal spine, never invented.
  let facts;
  let factsSource = 'none';
  let resolvedEntityId = entityId;
  let dealResolution = entityId ? { entityId, source: 'caller_supplied' } : null;
  if (!resolvedEntityId) {
    // P125: derive the deal from the thread's own deal-match attribution rather
    // than reporting "no deal" for a live deal nobody thought to name.
    dealResolution = await resolveDealEntity(replyTarget);
    resolvedEntityId = dealResolution.entityId || '';
  }
  if (resolvedEntityId) {
    try {
      const packet = await buildDealPacket(resolvedEntityId, workspaceId);
      facts = extractDealFacts(packet);
      factsSource = dealResolution && dealResolution.source !== 'caller_supplied'
        ? `deal_spine_via_${dealResolution.source}` : 'deal_spine';
    } catch (e) {
      facts = extractDealFacts(null);
      factsSource = `deal_spine_error:${(e && e.message) || 'unknown'}`;
    }
  } else {
    facts = {};   // no deal id ⇒ relational voice, ZERO specific facts asserted
    // P125: name the rung that came up empty. "no_entity_relational" alone hid the
    // fact that no resolution had even been attempted.
    factsSource = `no_entity_relational:${(dealResolution && dealResolution.source) || 'not_attempted'}`;
  }

  // 3. Retrieve — Scott-authored outbound exemplars, bucketed + ranked.
  const corpus = await loadCorpus();
  const target = { bucket, recipientEmail: recipient };
  const { exemplars, method: retrievalMethod, pool_size: poolSize } = await retrieveExemplars(corpus, target, intent, 5);
  const exemplarIds = exemplars.map((e) => e.id);
  const coverage = exemplarBodyCoverage(exemplars);

  // 4. Generate — ON-PREM ONLY, fail closed (no cloud fallback for this surface).
  const voiceProfile = loadVoiceProfile();
  const prompt = buildGenerationPrompt({
    voiceProfile, exemplars, facts, purpose, intent, recipientLabel: recipient,
  });
  const gen = await invokeOnPremGeneration({ prompt, temperature: 0.4, json: true });
  if (!gen.ok) {
    res.status(502).json({
      ok: false,
      error: 'On-prem generation unavailable — failing closed (no cloud fallback for the drafting surface).',
      detail: gen.error || `ollama status ${gen.status}`,
      corpus_size: corpus.length,
    });
    return;
  }

  // 5. Validate — strip any fabricated number/date; flag ungrounded names.
  const parsed = parseDraftJson(gen.text);
  const bodyCheck = validateDraftFacts(parsed.body, { facts, exemplars, extra: `${intent} ${recipient}` });
  const subjCheck = validateDraftFacts(parsed.subject, { facts, exemplars, extra: `${intent} ${recipient}` });
  const flagged = [...subjCheck.flagged, ...bodyCheck.flagged];

  const draft = {
    subject: subjCheck.text || `${purpose.replace(/_/g, ' ')} — draft`,
    body: bodyCheck.text,
  };

  // P126 — SIGN THE DRAFT so it is send-ready.
  //
  // The body html is built HERE, not in the save branch, for two reasons. (a) The
  // dry run must show exactly what a save would write — the GET response used to
  // describe a body that no code had rendered yet, so the signature could only be
  // verified by actually saving. (b) One construction means one owner: a rendering
  // that exists in the save path only is a rendering nobody can test.
  //
  // ORDER IS LOAD-BEARING: escape the model's prose FIRST, then append the
  // signature, because the block is trusted HTML from our own asset and escaping
  // it would render tags as literal text. The already-signed probe runs on the
  // PLAIN body (`draft.body`) — the anchors are text regexes and would not match
  // through the escaping.
  const escapedBody = `<div>${String(draft.body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`;
  // VARIANT: reply ⇒ the compact block, new thread ⇒ the full block (service line,
  // address, tagline) — how Scott actually signs. `inReplyTo` is the SAME value
  // handed to the flow below, so the block can never disagree with the shape of
  // the draft that is actually created.
  const inReplyTo = replyTarget ? replyTarget.internet_message_id : '';
  const signed = appendSignature(escapedBody, { plainBody: draft.body, inReplyTo });
  const bodyHtml = signed.html;

  // P117: pass the exemplars themselves so the note can report FULL-BODY coverage
  // from their real lengths instead of asserting the old corpus-wide preview cap.
  const voice_confidence = voiceConfidenceNote(bucket, exemplars);
  const factsUsed = facts;
  const notOnFile = Object.entries(facts).filter(([, v]) => v === 'Not on file').map(([k]) => k);

  const payload = {
    ok: true,
    mode: isPost ? 'save' : 'dry_run',
    purpose,
    bucket,
    // P126: `body_html` is what a save actually writes (prose + signature),
    // exposed on the dry run so the block is verifiable WITHOUT saving.
    draft: { ...draft, body_html: bodyHtml },
    // P126: honest status — 'appended' | 'already_present' | 'not_configured'.
    // `not_configured` means nothing was invented, NOT that signing succeeded.
    signature: {
      status: signed.status,
      source: signed.source,
      // 'reply' = the compact self-contained block; 'full' = the new-email block.
      variant: signed.variant,
      note: signed.note,
      // The block sits at the END of body_html, and the flow's reply branch
      // composes `concat(body_html, <quoted thread>)` — so it is above the quote.
      above_quote: signed.status === 'appended' ? true : null,
      // P127: what the sanitizer took out of the STORED block. `[]` is the only
      // healthy value — anything else means the committed/env bytes are dirty and
      // the draft is only clean because the loader caught it. `rejected` names the
      // fault when the block could not be made safe at all (⇒ not_configured).
      // Surfaced on the DRY RUN so a dirty asset is visible without saving; that
      // is the whole reason P126's over-captured LinkedIn email went unnoticed.
      sanitized_removed: signed.sanitized ? [...new Set(signed.sanitized.removed)] : [],
      sanitize_rejected: signed.sanitized ? signed.sanitized.rejected : null,
    },
    retrieval: {
      method: retrievalMethod,
      exemplar_ids: exemplarIds,
      exemplar_count: exemplars.length,
      corpus_size: corpus.length,
      // P125: assert on THIS, not corpus_size. The P124 lesson ("a preview row and
      // a full-body row both count as 1") applies to the corpus exactly as it did
      // to the dedup — a corpus that halved in full bodies still looks healthy by
      // row count alone.
      corpus_full_bodies: corpus.fullBodyRows || 0,
      corpus_truncated: !!corpus.truncated,
      bucket_pool_size: poolSize,
      // P124 honest count: personal/unclassified mail removed from the pool.
      excluded_personal_or_unclassified: corpus.excludedPersonal || 0,
      // P125: what the returned exemplars actually are, so "it retrieved 5" can
      // never stand in for "it retrieved 5 usable ones".
      full_body_exemplars: coverage.full_body,
      preview_only_exemplars: coverage.preview_only,
      recipient_matched_exemplars: recipient
        ? exemplars.filter((e) => recipientMatchLevel(e, recipient) >= 1.5).length : null,
      exemplars: exemplars.map((e) => ({
        id: e.id,
        bucket: e.bucket,
        full_body: !!e.full_body,
        cleaned_chars: String(e.cleaned || '').length,
        to_recipient: recipient ? recipientMatchLevel(e, recipient) >= 1.5 : null,
        opening: e.cleaned.slice(0, 220),
      })),
    },
    facts: {
      source: factsSource,
      // P125: how the deal was resolved (or which rung came up empty) — an empty
      // `used` must never be ambiguous between "no deal" and "never looked".
      deal_resolution: dealResolution || { entityId: entityId || null, source: 'caller_supplied' },
      entity_id: resolvedEntityId || null,
      used: factsUsed,
      not_on_file: notOnFile,
    },
    fact_validation: {
      clean: flagged.length === 0,
      flagged,   // fabricated numbers/dates were stripped from `draft`; names reported
      note: flagged.length ? 'Ungrounded numbers/dates were STRIPPED (→ "[Not on file]"); proper names flagged for review.' : 'No fabricated facts detected.',
    },
    voice_confidence,
    // P124: what the saved draft will thread into. `null` means no prior
    // correspondence with this address ⇒ the draft is correctly a NEW thread.
    reply_to: replyTarget ? {
      internet_message_id: replyTarget.internet_message_id,
      conversation_id: replyTarget.conversation_id,
      in_reply_to_subject: replyTarget.subject,
      matched_on: replyTarget.matched_on,
    } : null,
    model: gen.model || null,
    // U4 self-measurement hook — the caller records draft-vs-sent edit distance
    // when Scott later sends an edited version. Send-side capture is a separate
    // seam (TODO: wire a Graph/PA "sent" webhook → lcc_draft_edit_distance);
    // this echoes the baseline the accept/edit signal is measured against.
    self_measure: { u4_hook: 'draft_vs_sent_edit_distance', baseline_subject: draft.subject, baseline_body: draft.body },
  };

  // GET is always a dry-run (writes nothing). POST saves the Outlook draft only
  // when the DRAFT_ASSIST flag is ON and the caller opted in with save=true.
  if (!isPost) {
    res.status(200).json(payload);
    return;
  }

  // Flag gate: env var OR feature_flags_registry.state — the same env-or-registry
  // resolver every other flag-gated LCC surface uses, so flipping the registry
  // row (from Cowork) enables POST-save with no Railway env var required. An
  // explicitly-set DRAFT_ASSIST env var (on OR off) still wins as an ops override.
  const draftAssistFlagRow = await fetchFeatureFlag('DRAFT_ASSIST');
  if (!flagEnabled('DRAFT_ASSIST', draftAssistFlagRow)) {
    res.status(200).json({ ...payload, mode: 'dry_run', saved: false, save_skipped: `DRAFT_ASSIST flag is OFF (env unset/off and registry state=${draftAssistFlagRow?.state || 'missing'}) — dry-run only. Enable the flag (env var or registry) to save drafts to Outlook.` });
    return;
  }
  if (!flagOn(src.save)) {
    res.status(200).json({ ...payload, saved: false, save_skipped: 'Pass save=true to create the Outlook draft.' });
    return;
  }
  if (!recipient) {
    res.status(400).json({ ...payload, saved: false, error: 'recipient (an email address) is required to save an Outlook draft.' });
    return;
  }

  // SAVE-NOT-SEND: createOutlookDraftViaPA creates a DRAFT. There is no send.
  // `bodyHtml` (prose + signature) was rendered above and is the SAME string the
  // dry run reported — the two can never drift because there is only one.
  const saveRes = await createOutlookDraftViaPA({
    to: recipient,
    subject: draft.subject,
    body_html: bodyHtml,
    // P124: thread the draft into the live conversation. The PA flow replies to
    // this message id when present and creates a standalone draft when it is ''.
    // P126: the SAME value the signature variant was chosen from — one
    // expression, so the block and the draft shape cannot drift apart.
    in_reply_to: inReplyTo,
  });

  // P125: report whether the draft actually landed in the thread, and say so
  // loudly when we asked for a reply and did not get one. A standalone draft is
  // still a usable draft, so this is a WARNING on a successful save — never a
  // failure — but it must never again be silent.
  const wantedThread = !!(replyTarget && replyTarget.internet_message_id);
  const threadingWarning = saveRes.ok && wantedThread && saveRes.threaded === false
    ? 'Asked for a reply on the resolved thread and the flow created a STANDALONE draft — '
      + 'the draft is fine to send but will start a new conversation. Check the flow import '
      + '(docs/architecture/flows/outlook-draft-reply-executor.md).'
    : (saveRes.ok && wantedThread && saveRes.threaded == null
      ? 'The flow did not report a threading outcome — it is likely an older import that predates '
        + 'the P125 response fields. Re-import flow-lcc-create-outlook-draft.json to make threading verifiable.'
      : null);

  res.status(saveRes.ok ? 200 : 502).json({
    ...payload,
    saved: !!saveRes.ok,
    outlook_draft: saveRes.ok ? {
      draft_id: saveRes.draft_id,
      web_link: saveRes.web_link,
      // Verify by comparing this to reply_to.conversation_id — that comparison is
      // the acceptance test for a threaded save.
      threaded: saveRes.threaded,
      conversation_id: saveRes.conversation_id,
      conversation_matches_thread: (saveRes.conversation_id && replyTarget && replyTarget.conversation_id)
        ? saveRes.conversation_id === replyTarget.conversation_id : null,
      thread_note: saveRes.thread_note || null,
    } : null,
    threading_warning: threadingWarning,
    save_error: saveRes.ok ? null : (saveRes.error || 'Outlook draft save failed'),
  });
}
