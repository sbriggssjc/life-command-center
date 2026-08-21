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
import { flagEnabled, fetchFeatureFlag } from './_shared/feature-flag.js';
import {
  SCOTT_FROM, VALID_PURPOSES,
  bucketForPurpose, extractDealFacts, rankExemplarsDeterministic, rankExemplarsByEmbedding,
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

// PostgREST caps at 1000 rows/page (CLAUDE.md footgun) — stride 1000.
async function pageAll(build, cap = 3000) {
  const out = [];
  for (let offset = 0; out.length < cap; offset += 1000) {
    const res = await opsQuery('GET', build(offset, 1000), null, { countMode: 'none', timeoutMs: 12000 });
    const rows = res && res.ok && Array.isArray(res.data) ? res.data : [];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

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
      `&body=not.is.null&order=occurred_at.desc&offset=${o}&limit=${l}`),
    pageAll((o, l) =>
      `email_bodies?select=id,body_preview,body_text,body_html,subject,from_email,to_emails,cc_emails,sent_at,received_at,internet_message_id` +
      // P117: gate on ANY body column, not `body_preview` alone — a body-only row
      // (full html, no preview) is exactly the exemplar we most want and the old
      // filter would have made it invisible. Harmless today (0 such rows live),
      // latent tomorrow.
      `&or=(body_preview.not.is.null,body_text.not.is.null,body_html.not.is.null)` +
      `&order=received_at.desc&offset=${o}&limit=${l}`),
  ]);

  const seen = new Set();
  const rows = [];
  let excludedPersonal = 0;
  const push = (id, imid, raw, subject, from, toEmails, ccEmails, ts) => {
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
    rows.push({ id: imid || String(id), cleaned, subject: subject || '', bucket, toEmails: toEmails || [], ts });
  };
  // P117 ORDER MATTERS: dedup is first-wins on internet_message_id and the stores
  // OVERLAP, so `email_bodies` (which holds the real bodies) must be drained FIRST
  // or a message's ~255-char activity_events preview claims the key and its own
  // full body is dropped as a duplicate — silently starving retrieval of exactly
  // the full-body exemplars voice_confidence now reports on.
  for (const r of eb) {
    // Prompt 110: full body_text → tag-stripped body_html → capped body_preview.
    const raw = pickBestBody({ body_text: r.body_text, body_html: r.body_html, body_preview: r.body_preview });
    push(r.id, r.internet_message_id, raw, r.subject, r.from_email, r.to_emails || [], r.cc_emails || [], r.sent_at || r.received_at);
  }
  for (const r of ae) {
    const m = r.metadata || {};
    // Prompt 110: prefer a full body when the flow forwarded one into metadata
    // (body_text / body_html); fall back to the ~255-char body snippet.
    const raw = pickBestBody({ body_text: m.body_text, body_html: m.body_html, body: r.body });
    push(r.id, m.internet_message_id, raw, r.title, m.from_email, m.to_emails || [], m.cc_emails || [], r.occurred_at);
  }
  rows.excludedPersonal = excludedPersonal;   // honest count — reported, never silent
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
  try {
    const queryText = `${target.bucket} :: ${intent}`;
    const embeds = await invokeOnPremEmbeddings([queryText, ...candidates.map((c) => c.cleaned)]);
    if (Array.isArray(embeds) && embeds.length === candidates.length + 1) {
      const queryVec = embeds[0];
      candidates.forEach((c, i) => { c.vec = embeds[i + 1]; });
      method = 'embedding_knn';
      return { exemplars: rankExemplarsByEmbedding(candidates, queryVec, target, k), method };
    }
  } catch { /* fall through to deterministic */ }

  return { exemplars: rankExemplarsDeterministic(candidates, target, k), method };
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

  // 1. Facts — from the deal spine, never invented.
  let facts;
  let factsSource = 'none';
  if (entityId) {
    try {
      const packet = await buildDealPacket(entityId, workspaceId);
      facts = extractDealFacts(packet);
      factsSource = 'deal_spine';
    } catch (e) {
      facts = extractDealFacts(null);
      factsSource = `deal_spine_error:${(e && e.message) || 'unknown'}`;
    }
  } else {
    facts = {};   // no deal id ⇒ relational voice, ZERO specific facts asserted
    factsSource = 'no_entity_relational';
  }

  // 2. Retrieve — Scott-authored outbound exemplars, bucketed + ranked.
  const corpus = await loadCorpus();
  const target = { bucket, recipientEmail: recipient };
  const { exemplars, method: retrievalMethod } = await retrieveExemplars(corpus, target, intent, 5);
  // P124: resolve the thread to reply into (null ⇒ legitimately a new thread).
  const replyTarget = await findReplyTarget(recipient);
  const exemplarIds = exemplars.map((e) => e.id);

  // 3. Generate — ON-PREM ONLY, fail closed (no cloud fallback for this surface).
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

  // 4. Validate — strip any fabricated number/date; flag ungrounded names.
  const parsed = parseDraftJson(gen.text);
  const bodyCheck = validateDraftFacts(parsed.body, { facts, exemplars, extra: `${intent} ${recipient}` });
  const subjCheck = validateDraftFacts(parsed.subject, { facts, exemplars, extra: `${intent} ${recipient}` });
  const flagged = [...subjCheck.flagged, ...bodyCheck.flagged];

  const draft = {
    subject: subjCheck.text || `${purpose.replace(/_/g, ' ')} — draft`,
    body: bodyCheck.text,
  };

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
    draft,
    retrieval: {
      method: retrievalMethod,
      exemplar_ids: exemplarIds,
      exemplar_count: exemplars.length,
      corpus_size: corpus.length,
      // P124 honest count: personal/unclassified mail removed from the pool.
      excluded_personal_or_unclassified: corpus.excludedPersonal || 0,
      exemplars: exemplars.map((e) => ({ id: e.id, bucket: e.bucket, opening: e.cleaned.slice(0, 220) })),
    },
    facts: { source: factsSource, used: factsUsed, not_on_file: notOnFile },
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
  const bodyHtml = `<div>${String(draft.body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`;
  const saveRes = await createOutlookDraftViaPA({
    to: recipient,
    subject: draft.subject,
    body_html: bodyHtml,
    // P124: thread the draft into the live conversation. The PA flow replies to
    // this message id when present and creates a standalone draft when it is ''.
    in_reply_to: replyTarget ? replyTarget.internet_message_id : '',
  });

  res.status(saveRes.ok ? 200 : 502).json({
    ...payload,
    saved: !!saveRes.ok,
    outlook_draft: saveRes.ok ? { draft_id: saveRes.draft_id, web_link: saveRes.web_link } : null,
    save_error: saveRes.ok ? null : (saveRes.error || 'Outlook draft save failed'),
  });
}
