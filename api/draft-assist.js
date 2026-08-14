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
//  5. Honest about the opening-only corpus cap via voice_confidence.
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
import { cleanEmailBody, isMostlyBoilerplate, classifyDraftType } from './_shared/voice-corpus-clean.js';
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
      `email_bodies?select=id,body_preview,subject,from_email,to_emails,sent_at,received_at,internet_message_id` +
      `&body_preview=not.is.null&order=received_at.desc&offset=${o}&limit=${l}`),
  ]);

  const seen = new Set();
  const rows = [];
  const push = (id, imid, raw, subject, from, toEmails, ts) => {
    if (!SCOTT_FROM.has(String(from || '').toLowerCase())) return;   // outbound-only gate
    const key = imid || `body:${String(raw).slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const cleaned = cleanEmailBody(raw);
    if (isMostlyBoilerplate(cleaned)) return;
    const { bucket } = classifyDraftType({ cleaned, subject, toEmails, fromEmail: from });
    rows.push({ id: imid || String(id), cleaned, subject: subject || '', bucket, toEmails: toEmails || [], ts });
  };
  for (const r of ae) {
    const m = r.metadata || {};
    push(r.id, m.internet_message_id, r.body, r.title, m.from_email, m.to_emails || [], r.occurred_at);
  }
  for (const r of eb) {
    push(r.id, r.internet_message_id, r.body_preview, r.subject, r.from_email, r.to_emails || [], r.sent_at || r.received_at);
  }
  return rows;
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

  const voice_confidence = voiceConfidenceNote(bucket, exemplars.length);
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
      exemplars: exemplars.map((e) => ({ id: e.id, bucket: e.bucket, opening: e.cleaned.slice(0, 220) })),
    },
    facts: { source: factsSource, used: factsUsed, not_on_file: notOnFile },
    fact_validation: {
      clean: flagged.length === 0,
      flagged,   // fabricated numbers/dates were stripped from `draft`; names reported
      note: flagged.length ? 'Ungrounded numbers/dates were STRIPPED (→ "[Not on file]"); proper names flagged for review.' : 'No fabricated facts detected.',
    },
    voice_confidence,
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
  const saveRes = await createOutlookDraftViaPA({ to: recipient, subject: draft.subject, body_html: bodyHtml });

  res.status(saveRes.ok ? 200 : 502).json({
    ...payload,
    saved: !!saveRes.ok,
    outlook_draft: saveRes.ok ? { draft_id: saveRes.draft_id, web_link: saveRes.web_link } : null,
    save_error: saveRes.ok ? null : (saveRes.error || 'Outlook draft save failed'),
  });
}
