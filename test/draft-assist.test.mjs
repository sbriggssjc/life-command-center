// Prompt 107 — W10 Stage 2 — /api/draft-assist structural + logic tests.
//
// The acceptance doctrine is enforced STRUCTURALLY, not just by prompt:
//  - never-send guard (no send call on the path)
//  - fact-validator strips a planted fabricated figure
//  - Ollama-unreachable fails CLOSED (no cloud egress)
//  - retrieval loads only Scott-authored OUTBOUND
//  - flag-off ⇒ POST is dry-run only
//  - voice-profile injection present
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  validateDraftFacts, extractDealFacts, rankExemplarsDeterministic, rankExemplarsByEmbedding,
  cosineSim, bucketForPurpose, buildGenerationPrompt, voiceConfidenceNote, anonymizeExemplar,
  exemplarBodyCoverage, FULL_BODY_MIN_CHARS,
  selectExemplars, isFullBodyExemplar, recipientMatchLevel, exemplarTier,
  parseDraftJson, SCOTT_FROM, PURPOSE_TO_BUCKET, VALID_PURPOSES, NOT_ON_FILE,
} from '../api/_shared/draft-assist-core.js';
import { classifyDraftType } from '../api/_shared/voice-corpus-clean.js';

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), 'utf8');
// Strip comments so the never-send / no-cloud guards test the CODE, not prose
// that legitimately names the forbidden calls to explain why they're absent.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

describe('never-send guard (doctrine 1)', () => {
  it('the handler path has NO send call — only the save-not-send draft seam', () => {
    const src = read('api/draft-assist.js');
    // The ONLY outbound composition call is createOutlookDraftViaPA (a DRAFT).
    assert.match(src, /createOutlookDraftViaPA/);
    const code = stripComments(src);
    for (const forbidden of ['sendMail', '/sendMail', 'sendEmail', "'send'", 'graph.*send']) {
      assert.equal(new RegExp(forbidden).test(code), false, `draft path must not contain ${forbidden}`);
    }
  });

  it('the outlook-draft seam creates a draft and never sends', () => {
    const seam = read('api/_shared/outlook-draft.js');
    assert.match(seam, /Create Outlook Draft/i);
    assert.equal(/sendMail|\/send\b/.test(seam), false);
  });
});

describe('fact validator strips a planted fabricated figure (doctrine 2)', () => {
  it('removes a number/date not grounded in facts or exemplars', () => {
    const facts = { cap_rate: '6.00%', property_label: 'Woodland Hills MOB' };
    const exemplars = [{ id: 'a', cleaned: 'Got it. I will walk him through the lease.' }];
    const draft = 'The cap rate is 6.00% and the price is $99,000,000. Closing 01/05/2027.';
    const r = validateDraftFacts(draft, { facts, exemplars });
    assert.equal(r.clean, false);
    assert.ok(r.flagged.some((f) => f.token.includes('99,000,000')), 'planted price must be flagged');
    assert.equal(r.text.includes('99,000,000'), false, 'fabricated price must be stripped');
    assert.match(r.text, /\[Not on file\]/);
  });

  it('keeps a figure that IS grounded in the supplied facts', () => {
    const facts = { cap_rate: '6.00%' };
    const r = validateDraftFacts('We have it at a 6.00% cap.', { facts, exemplars: [] });
    assert.equal(r.clean, true);
    assert.match(r.text, /6\.00%/);
  });

  it('a figure grounded in a retrieved exemplar is allowed', () => {
    const exemplars = [{ id: 'x', cleaned: 'Closed at $15,729,896 last week.' }];
    const r = validateDraftFacts('Comparable closed at $15,729,896.', { facts: {}, exemplars });
    assert.equal(r.clean, true);
  });
});

describe('proper-name validator: benign Title-Case boilerplate is NOT flagged (Prompt 109 B)', () => {
  it('the "Quick Check-In" relationship_touch subject validates clean', () => {
    const r = validateDraftFacts('Quick Check-In', { facts: {}, exemplars: [], extra: 'check in with a past client relationship_touch' });
    assert.equal(r.clean, true, 'no false proper-name flag on benign Title-Case subject');
    assert.equal(r.flagged.some((f) => f.type === 'proper_name'), false);
  });

  it('the "Following Up on BOV" follow_up subject validates clean', () => {
    const r = validateDraftFacts('Following Up on BOV', { facts: {}, exemplars: [], extra: 'follow up on the BOV we sent' });
    assert.equal(r.clean, true);
    assert.equal(r.flagged.some((f) => f.type === 'proper_name'), false);
  });

  it('"Touch Base" and "Follow Up" openings are not flagged', () => {
    const r = validateDraftFacts('Wanted to Touch Base and Follow Up soon.', { facts: {}, exemplars: [] });
    assert.equal(r.flagged.some((f) => f.type === 'proper_name'), false);
  });

  it('a genuinely ungrounded company name is STILL flagged', () => {
    const r = validateDraftFacts('I connected with Kingsbarn Capital about the deal.', { facts: {}, exemplars: [], extra: 'follow up' });
    assert.ok(r.flagged.some((f) => f.type === 'proper_name' && /Kingsbarn/.test(f.token)), 'ungrounded company name must be flagged');
  });

  it('a genuinely ungrounded person name is STILL flagged', () => {
    const r = validateDraftFacts('Spoke with Boyd Watterson yesterday.', { facts: {}, exemplars: [] });
    assert.ok(r.flagged.some((f) => f.type === 'proper_name' && /Boyd Watterson/.test(f.token)));
  });

  it('a grounded name (in facts) is not flagged even though it is a real name', () => {
    const r = validateDraftFacts('Following up for Acme Realty.', { facts: { parties: 'seller: Acme Realty' }, exemplars: [] });
    assert.equal(r.flagged.some((f) => f.type === 'proper_name'), false);
  });

  it('still STRIPS a fabricated figure alongside the name tightening (cardinal-sin guard intact)', () => {
    const r = validateDraftFacts('Quick Check-In — the price is $99,000,000.', { facts: {}, exemplars: [], extra: 'relationship_touch' });
    assert.equal(r.text.includes('99,000,000'), false, 'fabricated figure still stripped');
    assert.match(r.text, /\[Not on file\]/);
    assert.equal(r.flagged.some((f) => f.type === 'proper_name'), false, 'no false name flag');
  });
});

describe('never fabricate facts — extractDealFacts (doctrine 2)', () => {
  it('renders "Not on file" for every absent fact and never invents', () => {
    const f = extractDealFacts(null);
    assert.equal(f.cap_rate, NOT_ON_FILE);
    assert.equal(f.property_label, NOT_ON_FILE);
    assert.equal(f.parties, NOT_ON_FILE);
  });

  it('surfaces real facts from a deal packet, cap rate as a percent', () => {
    const packet = {
      meta: { property_label: 'Test MOB' },
      deal: { stage: { v: 'Under Contract' }, deal_name: 'Test Deal', parties: [{ role: 'seller', name: 'Acme LLC' }], cadence: {} },
      facts: { cap_rate: 0.06 },
    };
    const f = extractDealFacts(packet);
    assert.equal(f.property_label, 'Test MOB');
    assert.equal(f.cap_rate, '6.00%');
    assert.match(f.parties, /seller: Acme LLC/);
  });
});

describe('on-prem generation fails CLOSED — no cloud fallback (doctrine 4)', () => {
  it('invokeOnPremGeneration returns an honest error when OLLAMA_URL is unset', async () => {
    const before = process.env.OLLAMA_URL;
    delete process.env.OLLAMA_URL;
    const { invokeOnPremGeneration } = await import('../api/_shared/ai.js');
    const g = await invokeOnPremGeneration({ prompt: 'x' });
    assert.equal(g.ok, false);
    assert.equal(g.provider, 'ollama');
    assert.match(g.error, /OLLAMA_URL|unavailable|fail-closed/i);
    if (before !== undefined) process.env.OLLAMA_URL = before;
  });

  it('the handler generate step uses the on-prem seam and 502s on !ok, never a cloud provider', () => {
    const src = read('api/draft-assist.js');
    assert.match(src, /invokeOnPremGeneration/);
    assert.match(src, /failing closed/i);
    // Must NOT fall back to the cloud extraction/chat chain on this surface.
    assert.equal(/invokeExtractionAI|invokeChatProvider|invokeOpenAI/.test(stripComments(src)), false);
  });
});

describe('retrieval loads only Scott-authored OUTBOUND (doctrine 5 / Stage-1 corpus)', () => {
  it('the corpus loader gates on the SCOTT_FROM from-address set', () => {
    const src = read('api/draft-assist.js');
    assert.match(src, /SCOTT_FROM\.has/);
    assert.match(src, /outbound-only gate/i);
    assert.ok(SCOTT_FROM.has('sabriggs@northmarq.com'));
    assert.equal(SCOTT_FROM.has('someinbound@buyer.com'), false);
  });

  it('deterministic ranker prefers same bucket, then recipient, then recency', () => {
    const cands = [
      { id: 'wrong-bucket', cleaned: 'a', bucket: 'internal_coordination', toEmails: ['x@a.com'], ts: '2026-08-01' },
      { id: 'same-bucket-old', cleaned: 'b', bucket: 'external_follow_up', toEmails: ['y@b.com'], ts: '2020-01-01' },
      { id: 'same-bucket-recip', cleaned: 'c', bucket: 'external_follow_up', toEmails: ['me@deal.com'], ts: '2019-01-01' },
    ];
    const ranked = rankExemplarsDeterministic(cands, { bucket: 'external_follow_up', recipientEmail: 'me@deal.com' }, 3);
    assert.equal(ranked[0].id, 'same-bucket-recip', 'exact recipient + bucket wins');
    assert.equal(ranked[ranked.length - 1].id, 'wrong-bucket');
  });

  it('embedding-KNN ranks by cosine similarity', () => {
    const cands = [
      { id: 'near', cleaned: 'a', bucket: 'external_follow_up', vec: [1, 0, 0] },
      { id: 'far', cleaned: 'b', bucket: 'external_follow_up', vec: [0, 1, 0] },
    ];
    const ranked = rankExemplarsByEmbedding(cands, [0.9, 0.1, 0], { bucket: 'external_follow_up' }, 2);
    assert.equal(ranked[0].id, 'near');
    assert.ok(cosineSim([1, 0], [1, 0]) > 0.99);
  });
});

describe('flag-off ⇒ POST is dry-run only (mechanics)', () => {
  it('the handler gates the Outlook save on the SHARED env-or-registry resolver, not process.env alone', () => {
    const src = read('api/draft-assist.js');
    const code = stripComments(src);
    // Must use the shared env-OR-registry resolver (so a registry flip enables saves).
    assert.match(src, /from '\.\/_shared\/feature-flag\.js'/);
    assert.match(code, /fetchFeatureFlag\('DRAFT_ASSIST'\)/);
    assert.match(code, /flagEnabled\('DRAFT_ASSIST'/);
    assert.match(src, /DRAFT_ASSIST flag is OFF/);
    // The POST-save gate must NOT be the old process.env-only check.
    assert.equal(/flagOn\(process\.env\.DRAFT_ASSIST\)/.test(code), false, 'gate must not read process.env alone');
    // GET is always a dry-run that writes nothing.
    assert.match(src, /GET is always a dry-run/);
  });

  it('the shared resolver honors env OR registry, with an explicit env var as the ops override', async () => {
    const { flagEnabled } = await import('../api/_shared/feature-flag.js');
    const KEY = 'DRAFT_ASSIST_TEST_FLAG';
    const before = process.env[KEY];
    delete process.env[KEY];
    // No env var: the registry state decides.
    assert.equal(flagEnabled(KEY, { state: 'on' }), true, 'registry on ⇒ enabled');
    assert.equal(flagEnabled(KEY, { state: 'off' }), false, 'registry off ⇒ disabled');
    assert.equal(flagEnabled(KEY, null), false, 'missing registry row ⇒ disabled');
    // Explicit env var wins over the registry, in BOTH directions.
    process.env[KEY] = 'on';
    assert.equal(flagEnabled(KEY, { state: 'off' }), true, 'env on overrides registry off');
    process.env[KEY] = 'off';
    assert.equal(flagEnabled(KEY, { state: 'on' }), false, 'env off overrides registry on (ops override)');
    if (before === undefined) delete process.env[KEY]; else process.env[KEY] = before;
  });

  it('the flag is registered in a migration (visible in Dormant Capabilities)', () => {
    const mig = read('supabase/migrations/20260901120000_lcc_w10_2_draft_assist_flag.sql');
    assert.match(mig, /INSERT INTO public\.feature_flags_registry[\s\S]*'DRAFT_ASSIST'/);
    assert.match(mig, /ON CONFLICT \(flag\) DO UPDATE/);
    assert.match(mig, /'off'/);
  });

  it('is mounted in server.js', () => {
    const server = read('server.js');
    assert.match(server, /\/api\/draft-assist/);
    assert.match(server, /draftAssistHandler/);
  });
});

describe('voice-profile injection present (doctrine 3 + honest corpus cap)', () => {
  it('the generation prompt injects the voice profile and forbids strategy + fabrication', () => {
    const prompt = buildGenerationPrompt({
      voiceProfile: '# Briggs Writing Voice', exemplars: [{ id: 'a', cleaned: 'On it.' }],
      facts: { cap_rate: NOT_ON_FILE }, purpose: 'follow_up', intent: 'confirm receipt',
    });
    assert.match(prompt, /SCOTT'S WRITING VOICE/);
    assert.match(prompt, /Briggs Writing Voice/);
    assert.match(prompt, /Never fabricate/i);
    assert.match(prompt, /strategy or recommendations/i);
    assert.match(prompt, /Not on file/);
  });

  it('the handler reads BRIGGS-WRITING-VOICE.md', () => {
    const src = read('api/draft-assist.js');
    assert.match(src, /BRIGGS-WRITING-VOICE\.md/);
  });

  it('voice_confidence honestly surfaces the opening-only cap and thin buckets', () => {
    // Count-only callers keep the pre-P117 behaviour: no body lengths to read, so
    // the conservative preview-cap caveat stands.
    const thin = voiceConfidenceNote('cold_bd_outreach', 1);
    assert.match(thin, /THIN|LOW-confidence/);
    assert.match(thin, /255-char|preview cap/);
    const none = voiceConfidenceNote('external_follow_up', 0);
    assert.match(none, /No matching past exemplars/);
  });

  // P117 — the note is now derived from the RETRIEVED exemplars' real lengths.
  it('voice_confidence claims full-body grounding only when the exemplars are full bodies', () => {
    const full = Array.from({ length: 4 }, () => ({ cleaned: 'x'.repeat(900) }));
    const note = voiceConfidenceNote('external_follow_up', full);
    assert.match(note, /FULL past email bod/);
    assert.match(note, /sign-off, paragraph shape and long-form structure are corpus-evidenced/);
    assert.doesNotMatch(note, /255-char/, 'must not repeat the retired opening-only caveat');
  });

  it('voice_confidence keeps the preview caveat when the exemplars are still openings', () => {
    const previews = Array.from({ length: 4 }, () => ({ cleaned: 'Got it. On it.' }));
    const note = voiceConfidenceNote('external_follow_up', previews);
    assert.match(note, /preview-era OPENINGS only/);
    assert.match(note, /255-char/);
  });

  it('voice_confidence reports a MIXED retrieval honestly', () => {
    const mixed = [{ cleaned: 'x'.repeat(900) }, { cleaned: 'Short one.' }, { cleaned: 'Another short.' }];
    const note = voiceConfidenceNote('external_follow_up', mixed);
    assert.match(note, /1 of them FULL bodies/);
    assert.match(note, /2 still preview-era openings/);
  });

  it('exemplarBodyCoverage counts against the full-body threshold', () => {
    const cov = exemplarBodyCoverage([{ cleaned: 'x'.repeat(FULL_BODY_MIN_CHARS) }, { cleaned: 'x'.repeat(FULL_BODY_MIN_CHARS - 1) }]);
    assert.deepEqual({ total: cov.total, full_body: cov.full_body, preview_only: cov.preview_only }, { total: 2, full_body: 1, preview_only: 1 });
  });
});

describe('purpose vocabulary + helpers', () => {
  it('maps every public purpose to an internal bucket', () => {
    for (const p of VALID_PURPOSES) assert.ok(PURPOSE_TO_BUCKET[p], `${p} maps to a bucket`);
    assert.equal(bucketForPurpose('loi_ack'), 'loi_offer');
  });

  it('anonymizes third-party email/phone in exemplars', () => {
    const a = anonymizeExemplar('Reach me at john@buyer.com or 918-555-1234.');
    assert.match(a, /\[email\]/);
    assert.match(a, /\[phone\]/);
    assert.equal(/john@buyer\.com/.test(a), false);
  });

  it('parses the model JSON draft tolerantly', () => {
    assert.deepEqual(parseDraftJson('{"subject":"Hi","body":"On it."}'), { subject: 'Hi', body: 'On it.', parsed: true });
    const loose = parseDraftJson('here you go: {"subject":"S","body":"B"} thanks');
    assert.equal(loose.subject, 'S');
  });
});

// ============================================================================
// Prompt 124 — activation gates: bucket integrity, reply threading, and a
// send-guard that reads the PA flow's real operations rather than its prose.
// ============================================================================

describe('P124 — cold_bd bucket integrity (the personal-mail sump)', () => {
  it('an external non-reply to a CONSUMER address is NOT cold BD', () => {
    // Live 2026-08-21: 28 of 29 rows in this bucket were family/personal mail.
    for (const [subject, to] of [
      ['Claire - Bunk Note', ['camp@outlook.com']],
      ['Meal Plan: Week of June 16', ['spouse@outlook.com', 'kid@yahoo.com']],
      ['Prompt', ['scott.personal@outlook.com']],
      ['Scrimmage', ['coach@gmail.com']],
    ]) {
      const r = classifyDraftType({ subject, toEmails: to, cleaned: 'x'.repeat(60) });
      assert.equal(r.bucket, 'personal_or_unclassified', `${subject} must not be cold_bd`);
      assert.equal(r.excludeFromCorpus, true, `${subject} must be dropped from the corpus`);
    }
  });

  it('a real cold-BD email to an ORGANISATION address still classifies as cold_bd', () => {
    const r = classifyDraftType({
      subject: 'New-construction DaVita opportunity',
      toEmails: ['acquisitions@somerealtyco.com'], cleaned: 'x'.repeat(60),
    });
    assert.equal(r.bucket, 'cold_bd_outreach');
    assert.notEqual(r.excludeFromCorpus, true);
  });

  it('⚠️ the guard NEVER excludes business mail merely for a consumer domain', () => {
    // These are the corpus's best BD exemplars and all go to gmail. A blanket
    // consumer-domain exclusion would have deleted them (cf. P158a).
    for (const subject of [
      'RE: Following up on the DaVita in Banning, CA',
      'RE: Following up on the DaVita in Succasunna, NJ',
      'Re: Needs List - 1050 Old Camp Road BLD 130',
    ]) {
      const r = classifyDraftType({ subject, toEmails: ['owner@gmail.com'], cleaned: 'x'.repeat(60) });
      assert.equal(r.bucket, 'external_follow_up', `${subject} must stay a usable exemplar`);
      assert.notEqual(r.excludeFromCorpus, true);
    }
  });

  it('the loader drops the residue BEFORE ranking, and reports an honest count', () => {
    const src = read('api/draft-assist.js');
    // Must be dropped at load: retrieveExemplars falls back to the WHOLE corpus
    // when a bucket is thin, so a rank-time filter would leak personal mail in.
    assert.match(src, /excludeFromCorpus/);
    assert.match(src, /if \(excludeFromCorpus\)[\s\S]{0,60}return;/);
    assert.match(src, /excluded_personal_or_unclassified/);
    const loader = src.slice(src.indexOf('async function loadCorpus'), src.indexOf('async function retrieveExemplars'));
    assert.ok(loader.indexOf('excludeFromCorpus') < loader.indexOf('rows.push'),
      'the exclusion must precede the push into the exemplar pool');
  });
});

describe('P124 — the saved draft threads into the live conversation', () => {
  it('draft-assist resolves a reply target and passes it to the seam', () => {
    const src = read('api/draft-assist.js');
    assert.match(src, /async function findReplyTarget/);
    // P126 hoisted this into ONE `inReplyTo` const, because the signature variant
    // (compact reply vs full new-email block) is chosen from the same value — two
    // copies of the expression could drift and put the reply block on a standalone
    // draft. The guarded property is unchanged: the resolved target reaches the seam.
    assert.match(src, /const inReplyTo\s*=\s*replyTarget \? replyTarget\.internet_message_id : ''/);
    assert.match(src, /in_reply_to:\s*inReplyTo/, 'the resolved target must reach the seam');
    assert.match(src, /reply_to:\s*replyTarget \?/, 'the dry-run must report what it would thread into');
  });

  it('no prior correspondence ⇒ no reply target (a cold email is a NEW thread)', () => {
    const src = read('api/draft-assist.js');
    const fn = src.slice(src.indexOf('async function findReplyTarget'), src.indexOf('async function retrieveExemplars'));
    assert.match(fn, /if \(!addr \|\| !addr\.includes\('@'\)\) return null;/);
    assert.match(fn, /catch \{\s*return null;/, 'threading must fail soft — an unthreaded draft is still usable');
  });

  it('the seam forwards in_reply_to to the flow', () => {
    const seam = read('api/_shared/outlook-draft.js');
    assert.match(seam, /in_reply_to:\s*draft\.in_reply_to \|\| ''/);
  });
});

describe('P124 — the PA flow creates a draft reply and never transmits', () => {
  const flow = JSON.parse(read('flow-lcc-create-outlook-draft.json'));
  const collect = (node, key, out = []) => {
    if (Array.isArray(node)) node.forEach((n) => collect(n, key, out));
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === key && typeof v === 'string') out.push(v);
        collect(v, key, out);
      }
    }
    return out;
  };

  it('every operationId is a create/read op — none transmits', () => {
    const ops = collect(flow, 'operationId');
    assert.ok(ops.length > 0, 'flow must declare operations');
    for (const op of ops) {
      assert.equal(/send|^Reply/i.test(op), false, `operationId ${op} transmits — forbidden on this path`);
    }
    // P125: `CreateDraftMessageV3` is NOT available in this tenant (found during the
    // 2026-08-21 hand-package), so every action is now the Graph passthrough — the
    // same shape that actually imported. POST /me/messages creates a DRAFT.
    assert.deepEqual([...new Set(ops)].sort(), ['HttpRequest']);
  });

  it('every Graph URI targets createReply/messages — never /send or /reply', () => {
    const uris = collect(flow, 'Uri');
    assert.ok(uris.some((u) => /createReply/.test(u)), 'the reply path must use createReply (creates a DRAFT)');
    for (const u of uris) {
      assert.equal(/\/send|\/reply(?!\w)/i.test(u), false, `URI transmits: ${u}`);
    }
  });

  it('it branches on in_reply_to: threaded reply when present, standalone when not', () => {
    const branch = flow.actions.Check_Shared_Secret.actions.Is_Reply;
    assert.ok(branch, 'flow must branch on in_reply_to');
    // P125: each branch now carries its OWN responder (see the double-response fix).
    assert.deepEqual(Object.keys(branch.else.actions), ['Create_draft', 'Respond_Success']);
    assert.ok(Object.keys(branch.actions.Thread_Message_Found.actions).includes('Create_draft_reply'));
  });

  it('the trigger accepts every field the seam sends', () => {
    const props = flow.triggers.manual.inputs.schema.properties;
    for (const f of ['to', 'cc', 'bcc', 'subject', 'body_html', 'in_reply_to']) {
      assert.ok(props[f], `flow trigger must accept ${f} — the seam sends it`);
    }
  });
});

describe('P124 — the voice profile is v3 and carries the contamination warning', () => {
  const profile = read('BRIGGS-WRITING-VOICE.md');
  it('is version 3.x', () => assert.match(profile, /\*\*Version:\*\* 3\.\d+\.\d+/));
  it('withdraws the contaminated cold-BD guidance instead of carrying it forward', () => {
    assert.match(profile, /BUCKET INTEGRITY/);
    assert.match(profile, /NO USABLE EVIDENCE/);
    assert.equal(/Claire Bear|Kanakuk/.test(profile.split('## Per-context variants')[1] || ''), false,
      'contaminated phrasing must never appear as guidance');
  });
  it('carries the corrected LOI sign-off rate (v2 had it backwards)', () => {
    assert.match(profile, /69\.8%/);
  });
});

// ============================================================================
// P125 — retrieval must prefer FULL-BODY and RECIPIENT-matched exemplars
//
// Grounded live on LCC Opps 2026-08-21 during the P124 acceptance dry-run: after
// backfilling 55 full-body emails Scott had written to susan.holdsworth@davita.com,
// a draft to Susan retrieved the SAME five preview-only exemplars as before the
// pull, none of them to her, and voice_confidence still claimed "preview-era
// OPENINGS only". Four independent defects, each measured, each pinned below.
// ============================================================================
describe('P125 — full-body exemplars are preferred, preview is a last resort', () => {
  const full = (id, extra = {}) => ({ id, cleaned: 'Real body.', bucket: 'external_follow_up', full_body: true, ts: '2026-01-01', ...extra });
  const prev = (id, extra = {}) => ({ id, cleaned: 'Preview opening.', bucket: 'external_follow_up', full_body: false, ts: '2026-08-01', ...extra });

  it('full-body wins even when a preview row is newer and same-bucket', () => {
    const picked = selectExemplars([prev('p1'), prev('p2'), full('f1')],
      { bucket: 'external_follow_up' }, 2, rankExemplarsDeterministic);
    assert.equal(picked[0].id, 'f1', 'a real body must never rank below a preview');
  });

  it('preview rows still fill the remaining slots — last resort, never absent', () => {
    const picked = selectExemplars([prev('p1'), prev('p2'), full('f1')],
      { bucket: 'external_follow_up' }, 3, rankExemplarsDeterministic);
    assert.equal(picked.length, 3, 'a thin full-body pool must still return k exemplars');
    assert.equal(picked[0].id, 'f1');
    assert.deepEqual(picked.slice(1).map((x) => x.id).sort(), ['p1', 'p2']);
  });

  it('an all-preview corpus is not starved to zero', () => {
    const picked = selectExemplars([prev('p1'), prev('p2')], { bucket: 'external_follow_up' }, 2, rankExemplarsDeterministic);
    assert.deepEqual(picked.map((x) => x.id).sort(), ['p1', 'p2']);
  });

  it('the guarantee holds on the EMBEDDING path too, not just the deterministic one', () => {
    // The old code applied bucket/recipient logic in one ranker and not the other,
    // so behaviour depended on whether Ollama answered. The partition wraps both.
    const cands = [
      { ...prev('p-near'), vec: [1, 0, 0] },
      { ...full('f-far'), vec: [0, 1, 0] },
    ];
    const rank = (c, t, n) => rankExemplarsByEmbedding(c, [1, 0, 0], t, n);
    const picked = selectExemplars(cands, { bucket: 'external_follow_up' }, 1, rank);
    assert.equal(picked[0].id, 'f-far', 'a perfect cosine match must not outvote real-body provenance');
  });

  it('⚠️ full-body is decided by PROVENANCE, not length — Scott writes short', () => {
    // Measured live: 438 of Scott's 777 real full bodies clean to 12–299 chars
    // (median 160), so the length heuristic misfiled 62% of them as "previews".
    const shortReal = { cleaned: 'Susan, I was sent the attached in response.', full_body: true };
    const longPrev = { cleaned: 'x'.repeat(FULL_BODY_MIN_CHARS + 50), full_body: false };
    assert.equal(isFullBodyExemplar(shortReal), true, 'a 43-char body Scott actually wrote IS a full body');
    assert.equal(isFullBodyExemplar(longPrev), false, 'provenance beats length in BOTH directions');
    const cov = exemplarBodyCoverage([shortReal, longPrev]);
    assert.equal(cov.full_body, 1);
    assert.equal(cov.basis, 'provenance');
    assert.equal(cov.short_full_bodies, 1, 'the misfiled population must be reported, not silently absorbed');
  });

  it('falls back to the length heuristic ONLY when no provenance is supplied', () => {
    const cov = exemplarBodyCoverage([{ cleaned: 'x'.repeat(FULL_BODY_MIN_CHARS) }, { cleaned: 'short' }]);
    assert.equal(cov.basis, 'length_heuristic');
    assert.equal(cov.full_body, 1);
  });

  it('voice_confidence stops crying "preview-era" over genuinely short full bodies', () => {
    const note = voiceConfidenceNote('external_follow_up', [
      { cleaned: 'Just did!  Sending the amendment now.', full_body: true },
      { cleaned: 'Susan, I was sent the attached in response.', full_body: true },
      { cleaned: 'x'.repeat(700), full_body: true },
    ]);
    assert.match(note, /FULL past email bod/);
    assert.doesNotMatch(note, /255-char/, 'a full-body corpus must not carry the preview caveat');
    assert.match(note, /SHORT by choice, not truncated/);
  });
});

describe('P125 — recipient-matched exemplars dominate, on BOTH rankers', () => {
  const row = (id, to, extra = {}) => ({ id, cleaned: 'body', bucket: 'external_follow_up', full_body: true, toEmails: to, ts: '2026-01-01', ...extra });

  it('recipient now OUTRANKS bucket — the Susan case, inverted', () => {
    const cands = [
      row('same-bucket-stranger', ['someone@else.com']),
      { ...row('other-bucket-recipient', ['susan.holdsworth@davita.com']), bucket: 'loi_offer' },
    ];
    const ranked = rankExemplarsDeterministic(cands, { bucket: 'external_follow_up', recipientEmail: 'susan.holdsworth@davita.com' }, 2);
    assert.equal(ranked[0].id, 'other-bucket-recipient',
      "Scott's own mail to THIS party beats a same-bucket note to a stranger");
  });

  it('the embedding ranker is no longer recipient-blind (it scored recipient at ZERO)', () => {
    // Two candidates of comparable semantic similarity: before P125 nothing in this
    // ranker could tell them apart, so `recipientEmail` was accepted and discarded.
    const cands = [
      { ...row('stranger', ['stranger@x.com']), vec: [1, 0, 0] },
      { ...row('recipient-match', ['susan.holdsworth@davita.com']), vec: [0.96, 0.28, 0] },
    ];
    const blind = rankExemplarsByEmbedding(cands, [1, 0, 0], { bucket: 'external_follow_up' }, 2);
    assert.equal(blind[0].id, 'stranger', 'with no recipient given, cosine alone still decides');
    const aware = rankExemplarsByEmbedding(cands, [1, 0, 0], { bucket: 'external_follow_up', recipientEmail: 'susan.holdsworth@davita.com' }, 2);
    assert.equal(aware[0].id, 'recipient-match', 'a named recipient MUST move the embedding ranking');
  });

  it('⚠️ the GUARANTEE is the tier, not the weight — a perfect cosine cannot outvote it', () => {
    // The weight above is a preference and can lose to a large enough similarity
    // gap; that is precisely the "score term that can silently lose" failure this
    // round is about. selectExemplars is where the promise is kept, on both rankers.
    const cands = [
      { ...row('cosine-perfect-stranger', ['stranger@x.com']), vec: [1, 0, 0] },
      { ...row('recipient-match', ['susan.holdsworth@davita.com']), vec: [0, 1, 0] },
    ];
    const rank = (c, t, n) => rankExemplarsByEmbedding(c, [1, 0, 0], t, n);
    const picked = selectExemplars(cands, { bucket: 'external_follow_up', recipientEmail: 'susan.holdsworth@davita.com' }, 1, rank);
    assert.equal(picked[0].id, 'recipient-match');
  });

  it('a DOMAIN match is not a tier — a colleague is a different person', () => {
    const colleague = row('colleague', ['someone.else@davita.com']);
    const stranger = { ...row('stranger-full', ['nobody@elsewhere.com']) };
    const picked = selectExemplars([colleague, stranger],
      { bucket: 'external_follow_up', recipientEmail: 'susan.holdsworth@davita.com' }, 2, rankExemplarsDeterministic);
    // Both sit in tier 2 (full body, no exact match); the domain weight only orders
    // them WITHIN it — it never promotes a colleague over a real body to someone else.
    assert.deepEqual(picked.map((p) => exemplarTier(p, 'susan.holdsworth@davita.com')), [1, 1]);
    assert.equal(picked[0].id, 'colleague', 'domain still helps as a tiebreak inside the tier');
  });

  it('tiering degrades gracefully — a preview to the recipient beats a preview to nobody', () => {
    const pr = (id, to) => ({ id, cleaned: 'opening', bucket: 'external_follow_up', full_body: false, toEmails: to, ts: '2026-01-01' });
    const picked = selectExemplars([pr('p-none', ['x@y.com']), pr('p-recip', ['susan.holdsworth@davita.com'])],
      { bucket: 'external_follow_up', recipientEmail: 'susan.holdsworth@davita.com' }, 2, rankExemplarsDeterministic);
    assert.deepEqual(picked.map((p) => p.id), ['p-recip', 'p-none']);
  });

  it('cc counts (weaker than to, never zero) — 3 of Susan\'s 55 live rows are cc-only', () => {
    const toRow = row('to', ['susan.holdsworth@davita.com']);
    const ccRow = { ...row('cc', ['other@davita.com']), ccEmails: ['susan.holdsworth@davita.com'] };
    const domRow = row('domain', ['someone.else@davita.com']);
    const none = row('none', ['nobody@elsewhere.com']);
    assert.equal(recipientMatchLevel(toRow, 'susan.holdsworth@davita.com'), 2);
    assert.equal(recipientMatchLevel(ccRow, 'susan.holdsworth@davita.com'), 1.5);
    assert.equal(recipientMatchLevel(domRow, 'susan.holdsworth@davita.com'), 1);
    assert.equal(recipientMatchLevel(none, 'susan.holdsworth@davita.com'), 0);
    const ranked = rankExemplarsDeterministic([none, domRow, ccRow, toRow], { bucket: 'external_follow_up', recipientEmail: 'susan.holdsworth@davita.com' }, 4);
    assert.deepEqual(ranked.map((r) => r.id), ['to', 'cc', 'domain', 'none']);
  });

  it('no recipient supplied ⇒ recipient contributes nothing (bucket + recency decide)', () => {
    const ranked = rankExemplarsDeterministic(
      [row('a', ['x@y.com'], { ts: '2020-01-01' }), row('b', ['z@y.com'], { ts: '2026-08-01' })],
      { bucket: 'external_follow_up' }, 2);
    assert.equal(ranked[0].id, 'b', 'recency breaks the tie when nothing else differs');
  });
});

describe('P125 — the corpus loader buys only usable rows, and counts honestly', () => {
  const src = read('api/draft-assist.js');

  it('⚠️ the author filter is pushed to the DATABASE, not applied after paging', () => {
    // Live: email_bodies holds 28,090 body-bearing rows, 1,188 of them Scott's — so
    // a newest-N page spent on the whole mailbox contained just 565 of his.
    assert.match(src, /from_email=in\.\(\$\{SCOTT_FROM_FILTER\}\)/,
      'email_bodies must be author-filtered server-side');
    assert.match(src, /metadata->>from_email=in\.\(\$\{SCOTT_FROM_FILTER\}\)/,
      'activity_events stores the author in metadata — filter there too');
  });

  it('the JS outbound-only gate is KEPT as the authority (the DB filter is an optimisation)', () => {
    assert.match(src, /SCOTT_FROM\.has\(String\(from \|\| ''\)\.toLowerCase\(\)\)/);
  });

  it('a capped scan reports itself — a clipped corpus can never read as complete', () => {
    assert.match(src, /out\.truncated = truncated/);
    assert.match(src, /corpus_truncated/);
  });

  it('provenance + cc are carried onto every corpus row', () => {
    const loader = src.slice(src.indexOf('async function loadCorpus'), src.indexOf('/**\n * P124 — find the message'));
    assert.match(loader, /full_body: !!fullBody/);
    assert.match(loader, /ccEmails: ccEmails \|\| \[\]/);
    assert.match(loader, /const hasFullBody = /);
  });

  it('the payload reports full bodies, not just a row count (the P124 dedup lesson)', () => {
    assert.match(src, /corpus_full_bodies/);
    assert.match(src, /full_body_exemplars/);
    assert.match(src, /preview_only_exemplars/);
    assert.match(src, /recipient_matched_exemplars/);
  });
});

describe('P125 — deal facts are resolved from the thread, not left unattempted', () => {
  const src = read('api/draft-assist.js');

  it('the reply target is resolved BEFORE facts (it is how the deal is found)', () => {
    const body = src.slice(src.indexOf('export default async function draftAssistHandler'));
    assert.ok(body.indexOf('findReplyTarget(recipient)') < body.indexOf('resolveDealEntity'),
      'the thread must be known before the deal can be derived from it');
    assert.ok(body.indexOf('resolveDealEntity') < body.indexOf('buildDealPacket'),
      'resolution must precede the packet fetch');
  });

  it('resolution reuses the deal-matcher VERDICT — it invents no matching of its own', () => {
    const fn = src.slice(src.indexOf('async function resolveDealEntity'), src.indexOf('export default async function'));
    assert.match(fn, /lcc:deal_match/, "must read the matcher's own attribution rows");
    assert.match(fn, /external_id=in\./, 'joined by internetMessageId equality — no fuzzy step');
    assert.match(fn, /conversation_id=eq\./, 'thread-scoped: the matcher skips already-attributed siblings');
    assert.equal(/similarity|fuzzy|ilike/i.test(fn), false, 'no new name-matching heuristic on this path');
  });

  it('an unresolved deal names the rung that came up empty', () => {
    const fn = src.slice(src.indexOf('async function resolveDealEntity'), src.indexOf('export default async function'));
    for (const reason of ['no_thread', 'no_deal_match_and_no_conversation', 'thread_not_attributed_to_a_deal', 'deal_resolution_error']) {
      assert.ok(fn.includes(reason), `must distinguish ${reason} from a bare "no deal"`);
    }
    assert.match(src, /deal_resolution:/, 'the payload must expose which rung answered');
  });
});

describe('P125 — the threading OUTCOME is observable end to end', () => {
  const flow = JSON.parse(read('flow-lcc-create-outlook-draft.json'));
  const reply = flow.actions.Check_Shared_Secret.actions.Is_Reply;

  it('⚠️ exactly ONE Response runs per path — the reply path used to answer twice', () => {
    // Respond_Success ran after Is_Reply on BOTH branches; on the reply path it
    // fired after Respond_Reply_Created and read body('Create_draft'), which is
    // null there.
    assert.equal(Object.keys(flow.actions.Check_Shared_Secret.actions).includes('Respond_Success'), false,
      'Respond_Success must live inside the standalone branch, not after the If');
    const paths = [
      Object.keys(reply.actions.Thread_Message_Found.actions),
      Object.keys(reply.actions.Thread_Message_Found.else.actions),
      Object.keys(reply.else.actions),
    ];
    for (const p of paths) {
      const responders = p.filter((k) => /^Respond_/.test(k));
      assert.equal(responders.length, 1, `each path needs exactly one responder, got ${responders.join(',')}`);
    }
  });

  it('every response echoes `threaded` so a standalone draft cannot masquerade', () => {
    const bodies = [
      reply.actions.Thread_Message_Found.actions.Respond_Reply_Created.inputs.body,
      reply.actions.Thread_Message_Found.else.actions.Respond_Unthreaded_Fallback.inputs.body,
      reply.else.actions.Respond_Success.inputs.body,
    ];
    for (const b of bodies) assert.equal(typeof b.threaded, 'boolean', 'threading outcome must be stated');
    assert.equal(bodies[0].threaded, true);
    assert.equal(bodies[1].threaded, false);
    assert.match(bodies[0].conversation_id, /conversationId/, 'the reply path must return the conversation id to verify against');
  });

  it('an unresolvable in_reply_to degrades to a standalone draft and SAYS SO', () => {
    const guard = reply.actions.Thread_Message_Found;
    assert.equal(guard.type, 'If');
    assert.match(JSON.stringify(guard.expression), /Find_thread_message/);
    assert.ok(guard.else.actions.Respond_Unthreaded_Fallback.inputs.body.thread_note,
      'the fallback must explain itself, not silently start a new conversation');
  });

  it('Set_reply_body PATCHes the BODY ONLY — never toRecipients on a reply draft', () => {
    const patch = reply.actions.Thread_Message_Found.actions.Set_reply_body.inputs.parameters.Body;
    assert.deepEqual(Object.keys(patch), ['body']);
  });

  it('the seam and the handler carry the outcome through to the caller', () => {
    const seam = read('api/_shared/outlook-draft.js');
    assert.match(seam, /threaded: typeof parsed\.threaded === 'boolean' \? parsed\.threaded : null/,
      '"the flow did not say" must stay distinct from "the flow said no"');
    const src = read('api/draft-assist.js');
    assert.match(src, /conversation_matches_thread/, 'the acceptance check must be in the response');
    assert.match(src, /threading_warning/, 'a requested-but-unthreaded save must warn, not pass silently');
  });

  it('reconciles with the live tenant: Graph passthrough, $authentication, ContentType', () => {
    // These three were import blockers hit for real on 2026-08-21. A repo definition
    // that only describes a flow nobody can import cannot be reasoned about.
    assert.ok(flow.parameters.$authentication, 'must declare $authentication');
    const walk = (n, out = []) => {
      if (Array.isArray(n)) n.forEach((x) => walk(x, out));
      else if (n && typeof n === 'object') {
        if (n.host && n.parameters) out.push(n);
        Object.values(n).forEach((v) => walk(v, out));
      }
      return out;
    };
    const conns = walk(flow.actions);
    assert.ok(conns.length >= 4);
    for (const c of conns) {
      assert.equal(c.authentication, "@parameters('$authentication')", 'every connection action needs the auth ref');
      if (c.parameters.Body !== undefined) {
        assert.equal(c.parameters.ContentType, 'application/json',
          "Graph 400s 'Empty Content-Type provided' on a Body without it");
      }
    }
  });

  it('the fallback still never transmits', () => {
    const collect = (n, key, out = []) => {
      if (Array.isArray(n)) n.forEach((x) => collect(x, key, out));
      else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) { if (k === key && typeof v === 'string') out.push(v); collect(v, key, out); }
      return out;
    };
    for (const op of collect(flow, 'operationId')) assert.equal(/send|^Reply/i.test(op), false, `${op} transmits`);
    for (const u of collect(flow, 'Uri')) assert.equal(/\/send|\/reply(?!\w)/i.test(u), false, `URI transmits: ${u}`);
  });
});
