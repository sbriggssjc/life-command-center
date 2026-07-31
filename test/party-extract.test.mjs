// W5.1 — Party extraction adjudication tests. The load-bearing logic is the two-channel
// adjudication: write ONLY on normalized-core agreement, A-only on LLM abstention, and log
// (never write) on conflict or span-less B-only claims. Pure functions + one injected-IO
// extractParties round-trip (no network).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  normalizeCore,
  coresAgree,
  parseChannelBResponse,
  buildExtractionPrompt,
  adjudicateField,
  adjudicate,
  extractParties,
  PARTY_FIELD_MAP,
  NOTE_COLUMNS,
  SOURCE_AGREE,
  SOURCE_GLINER,
  CONF_AGREE,
  CONF_GLINER,
} = await import('../api/_handlers/party-extract.js');

describe('normalizeCore', () => {
  it('strips pure legal forms, keeps semantic tokens', () => {
    assert.equal(normalizeCore('Ridgeline Capital Partners LLC'), 'ridgeline capital partners');
    assert.equal(normalizeCore('DaVita, Inc.'), 'davita');
    assert.equal(normalizeCore('Cedar Point Holdings, L.L.C.'), 'cedar point holdings');
    // "Company"/"Group" are semantic, retained (mirrors gov_owner_strict_core)
    assert.equal(normalizeCore('Cowperwood Company'), 'cowperwood company');
  });
  it('handles ampersand and empty', () => {
    assert.equal(normalizeCore('Marcus & Millichap'), 'marcus and millichap');
    assert.equal(normalizeCore(''), '');
    assert.equal(normalizeCore(null), '');
  });
});

describe('coresAgree', () => {
  it('equal cores agree', () => {
    assert.ok(coresAgree('davita', 'davita'));
  });
  it('prefix/suffix extension agrees (firm names extend)', () => {
    assert.ok(coresAgree(normalizeCore('Colliers'), normalizeCore('Colliers International')));
    assert.ok(coresAgree(normalizeCore('Medical Care'), normalizeCore('Fresenius Medical Care')));
  });
  it('a shared MIDDLE token does not force agreement', () => {
    assert.equal(coresAgree(normalizeCore('Capital'), normalizeCore('Ridgeline Capital Partners')), false);
  });
  it('distinct parties disagree', () => {
    assert.equal(coresAgree('davita', 'fresenius'), false);
    assert.equal(coresAgree('', 'davita'), false);
  });
});

describe('parseChannelBResponse', () => {
  it('parses a clean JSON object', () => {
    const r = parseChannelBResponse('{"buyer":"Blue Owl Capital","seller":null,"listing_broker":"CBRE","procuring_broker":null,"lender":null,"price":"10000000","cap_rate":"0.065"}');
    assert.equal(r.buyer, 'Blue Owl Capital');
    assert.equal(r.seller, null);
    assert.equal(r.listing_broker, 'CBRE');
    assert.equal(r.price, 10000000);
    assert.equal(r.cap_rate, 0.065);
  });
  it('strips markdown fences and surrounding prose', () => {
    const r = parseChannelBResponse('Here is the result:\n```json\n{"buyer":"Acme LLC"}\n```\nDone.');
    assert.equal(r.buyer, 'Acme LLC');
  });
  it('coerces junk sentinels to null and never throws', () => {
    const r = parseChannelBResponse('{"buyer":"N/A","seller":"","listing_broker":"Unknown"}');
    assert.equal(r.buyer, null);
    assert.equal(r.seller, null);
    assert.equal(r.listing_broker, null);
    assert.deepEqual(parseChannelBResponse('not json at all'), {
      buyer: null, seller: null, listing_broker: null, procuring_broker: null, lender: null, price: null, cap_rate: null,
    });
  });
});

describe('adjudicateField', () => {
  it('AGREE → party_extract_agree 0.60, writes the more complete surface', () => {
    const d = adjudicateField('listing_broker', 'Colliers', 'Colliers International');
    assert.equal(d.decision, 'write');
    assert.equal(d.source, SOURCE_AGREE);
    assert.equal(d.confidence, CONF_AGREE);
    assert.equal(d.value, 'Colliers International');
  });
  it('A-only (B abstained) → gliner_extract 0.55', () => {
    const d = adjudicateField('buyer', 'Ridgeline Capital Partners', null);
    assert.equal(d.decision, 'write');
    assert.equal(d.source, SOURCE_GLINER);
    assert.equal(d.confidence, CONF_GLINER);
    assert.equal(d.value, 'Ridgeline Capital Partners');
  });
  it('value CONFLICT → skip + value_conflict', () => {
    const d = adjudicateField('seller', 'DaVita Inc', 'Fresenius Medical Care');
    assert.equal(d.decision, 'skip');
    assert.equal(d.disagreementKind, 'value_conflict');
  });
  it('B-only (span-less LLM) → skip + b_only', () => {
    const d = adjudicateField('buyer', null, 'Some Hallucinated Buyer');
    assert.equal(d.decision, 'skip');
    assert.equal(d.disagreementKind, 'b_only');
  });
  it('both empty → plain skip', () => {
    const d = adjudicateField('lender', null, null);
    assert.equal(d.decision, 'skip');
    assert.equal(d.disagreementKind, undefined);
  });
});

describe('adjudicate', () => {
  it('threads spans and returns a decision per canonical field', () => {
    const channelA = {
      buyer: 'Ridgeline Capital Partners', seller: null, listing_broker: 'CBRE',
      procuring_broker: null, lender: null,
      spans: [
        { field: 'buyer', text: 'Ridgeline Capital Partners', start: 20, end: 46 },
        { field: 'listing_broker', text: 'CBRE', start: 0, end: 4 },
      ],
    };
    const channelB = { buyer: null, seller: null, listing_broker: 'CBRE Group', procuring_broker: null, lender: null };
    const dec = adjudicate(channelA, channelB);
    // buyer: A-only → gliner write, span attached
    assert.equal(dec.buyer.source, SOURCE_GLINER);
    assert.deepEqual(dec.buyer.span, { text: 'Ridgeline Capital Partners', start: 20, end: 46 });
    // listing_broker: agree (CBRE ⊂ CBRE Group) → agree write
    assert.equal(dec.listing_broker.source, SOURCE_AGREE);
    assert.equal(dec.listing_broker.value, 'CBRE Group');
  });
});

describe('extractParties (injected IO, no network)', () => {
  it('runs both channels and adjudicates; reports aiFinalProvider', async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({
        buyer: 'Blue Owl Capital', seller: null, listing_broker: 'CBRE',
        procuring_broker: null, lender: null, price: 1e7, cap_rate: 0.065,
        spans: [{ field: 'buyer', text: 'Blue Owl Capital', start: 0, end: 16 },
                { field: 'listing_broker', text: 'CBRE', start: 30, end: 34 }],
        backend: 'heuristic',
      }),
    });
    const fakeInvoke = async () => ({
      ok: true, provider: 'ollama',
      data: { response: '{"buyer":"Blue Owl Capital LLC","listing_broker":"CBRE"}' },
      tried: [{ stage: 'local', provider: 'ollama', status: 200 }],
    });
    const { aiFinalProvider, decisions } = await extractParties('some note', {
      resolverUrl: 'http://resolver.local', fetchImpl: fakeFetch, invokeExtractionAIImpl: fakeInvoke,
    });
    assert.equal(aiFinalProvider, 'ollama');
    // buyer: A "Blue Owl Capital" vs B "Blue Owl Capital LLC" → agree, more-complete surface
    assert.equal(decisions.buyer.source, SOURCE_AGREE);
    assert.equal(decisions.buyer.value, 'Blue Owl Capital LLC');
    // listing_broker: exact agree
    assert.equal(decisions.listing_broker.source, SOURCE_AGREE);
  });
});

describe('field maps', () => {
  it('dia has no lender column; gov maps procuring→purchasing_broker', () => {
    assert.equal(PARTY_FIELD_MAP.dia.lender, undefined);
    assert.equal(PARTY_FIELD_MAP.dia.procuring_broker, 'procuring_broker');
    assert.equal(PARTY_FIELD_MAP.gov.procuring_broker, 'purchasing_broker');
    assert.equal(PARTY_FIELD_MAP.gov.lender, 'lender_name');
    assert.deepEqual(NOTE_COLUMNS.dia, ['sale_notes_raw', 'notes']);
    assert.deepEqual(NOTE_COLUMNS.gov, ['sale_notes_raw']);
  });
});

// buildExtractionPrompt is a stable contract — keep the key list in the prompt.
describe('buildExtractionPrompt', () => {
  it('names every canonical field and forbids guessing', () => {
    const p = buildExtractionPrompt('note text');
    for (const k of ['buyer', 'seller', 'listing_broker', 'procuring_broker', 'lender', 'price', 'cap_rate']) {
      assert.ok(p.includes(`"${k}"`), `prompt missing ${k}`);
    }
    assert.match(p, /NEVER guess/i);
    assert.ok(p.includes('note text'));
  });
});
