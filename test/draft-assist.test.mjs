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
  parseDraftJson, SCOTT_FROM, PURPOSE_TO_BUCKET, VALID_PURPOSES, NOT_ON_FILE,
} from '../api/_shared/draft-assist-core.js';

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
  it('the handler gates the Outlook save on the DRAFT_ASSIST flag', () => {
    const src = read('api/draft-assist.js');
    assert.match(src, /flagOn\(process\.env\.DRAFT_ASSIST\)/);
    assert.match(src, /DRAFT_ASSIST flag is OFF/);
    // GET is always a dry-run that writes nothing.
    assert.match(src, /GET is always a dry-run/);
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
    const thin = voiceConfidenceNote('cold_bd_outreach', 1);
    assert.match(thin, /THIN|LOW-confidence/);
    assert.match(thin, /255-char|preview cap/);
    const none = voiceConfidenceNote('external_follow_up', 0);
    assert.match(none, /No matching past exemplars/);
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
