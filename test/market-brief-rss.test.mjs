// MB-a — P-RSS pure helper tests: extraction parsing, verbatim-number filter,
// Ollama-down fail-closed skip. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRssExtractionPrompt,
  parseRssExtractionResponse,
  filterVerbatimFacts,
  extractRssFactsWithOllama,
  buildRssFactRows,
  MAX_FACTS_PER_ARTICLE,
} from '../api/_shared/market-brief-rss.js';

const ARTICLE = {
  title: 'CMS proposes 4.2% cut to ESRD PPS rate for 2027',
  summary: 'The agency proposed a 4.2% reduction, citing 312 comment letters received during the prior cycle.',
  url: 'https://example.com/cms-esrd-2027',
  published_at: '2026-09-10T12:00:00Z',
  source: 'KFF Health News',
};

test('buildRssExtractionPrompt embeds the lane, title, and summary', () => {
  const prompt = buildRssExtractionPrompt('dialysis', ARTICLE);
  assert.match(prompt, /dialysis/);
  assert.match(prompt, /CMS proposes 4\.2% cut/);
  assert.match(prompt, new RegExp(`up to ${MAX_FACTS_PER_ARTICLE}`));
});

test('parseRssExtractionResponse fails closed on unparsable JSON', () => {
  assert.equal(parseRssExtractionResponse('not json'), null);
});

test('parseRssExtractionResponse fails closed on a missing relevant field', () => {
  assert.equal(parseRssExtractionResponse(JSON.stringify({ facts: [] })), null);
});

test('parseRssExtractionResponse returns no facts for relevant=false regardless of what facts[] holds', () => {
  const out = parseRssExtractionResponse(JSON.stringify({ relevant: false, facts: [{ claim_text: 'ignored' }] }));
  assert.equal(out.relevant, false);
  assert.deepEqual(out.facts, []);
});

test('parseRssExtractionResponse parses and caps facts at MAX_FACTS_PER_ARTICLE', () => {
  const facts = new Array(MAX_FACTS_PER_ARTICLE + 5).fill(0).map((_, i) => ({ claim_text: `claim ${i}`, value: i, unit: 'count' }));
  const out = parseRssExtractionResponse(JSON.stringify({ relevant: true, facts }));
  assert.equal(out.relevant, true);
  assert.equal(out.facts.length, MAX_FACTS_PER_ARTICLE);
});

test('parseRssExtractionResponse drops a fact with no claim_text', () => {
  const out = parseRssExtractionResponse(JSON.stringify({ relevant: true, facts: [{ value: 1 }, { claim_text: 'ok', value: 2 }] }));
  assert.equal(out.facts.length, 1);
  assert.equal(out.facts[0].claim_text, 'ok');
});

test('filterVerbatimFacts keeps a claim whose number is verbatim in the article', () => {
  const facts = [{ claim_text: 'CMS proposed a 4.2% cut.', value: 4.2, unit: 'percent' }];
  const kept = filterVerbatimFacts(facts, ARTICLE);
  assert.equal(kept.length, 1);
});

test('filterVerbatimFacts drops a claim with a fabricated number not on the page', () => {
  const facts = [
    { claim_text: 'CMS proposed a 4.2% cut.', value: 4.2, unit: 'percent' },
    { claim_text: 'This will cost the industry $850 million.', value: 850, unit: 'usd_millions' },
  ];
  const kept = filterVerbatimFacts(facts, ARTICLE);
  assert.equal(kept.length, 1);
  assert.match(kept[0].claim_text, /4\.2%/);
});

// ---------------------------------------------------------------------------
// extractRssFactsWithOllama — fails closed, no cloud fallback
// ---------------------------------------------------------------------------

test('extractRssFactsWithOllama returns null when the model is unreachable (Ollama down)', async () => {
  const generate = async () => ({ ok: false, error: 'OLLAMA_URL unset', text: '' });
  const out = await extractRssFactsWithOllama('dialysis', ARTICLE, generate);
  assert.equal(out, null);
});

test('extractRssFactsWithOllama returns null on an unparsable model response', async () => {
  const generate = async () => ({ ok: true, text: 'not json at all' });
  const out = await extractRssFactsWithOllama('dialysis', ARTICLE, generate);
  assert.equal(out, null);
});

test('extractRssFactsWithOllama returns null if the generate function throws', async () => {
  const generate = async () => { throw new Error('timeout'); };
  const out = await extractRssFactsWithOllama('dialysis', ARTICLE, generate);
  assert.equal(out, null);
});

test('extractRssFactsWithOllama applies the verbatim-number filter to a relevant result', async () => {
  const generate = async () => ({
    ok: true,
    text: JSON.stringify({
      relevant: true,
      facts: [
        { claim_text: 'CMS proposed a 4.2% cut.', value: 4.2, unit: 'percent' },
        { claim_text: 'Industry impact estimated at $999 million.', value: 999, unit: 'usd_millions' },
      ],
    }),
  });
  const out = await extractRssFactsWithOllama('dialysis', ARTICLE, generate);
  assert.equal(out.relevant, true);
  assert.equal(out.facts.length, 1);
  assert.match(out.facts[0].claim_text, /4\.2%/);
});

test('extractRssFactsWithOllama returns relevant:false with no facts when the model says not relevant', async () => {
  const generate = async () => ({ ok: true, text: JSON.stringify({ relevant: false, facts: [] }) });
  const out = await extractRssFactsWithOllama('dialysis', ARTICLE, generate);
  assert.deepEqual(out, { relevant: false, facts: [] });
});

// ---------------------------------------------------------------------------
// buildRssFactRows
// ---------------------------------------------------------------------------

test('buildRssFactRows carries the article citation and rss origin/fact_kind', () => {
  const rows = buildRssFactRows({
    lane: 'dialysis', section: 'policy', article: ARTICLE,
    facts: [{ claim_text: 'CMS proposed a 4.2% cut.', value: 4.2, unit: 'percent' }],
    staleAfterIso: '2026-09-18T00:00:00Z', fetchedAtIso: '2026-09-11T00:00:00Z',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].origin, 'rss');
  assert.equal(rows[0].fact_kind, 'reported');
  assert.equal(rows[0].source_url, ARTICLE.url);
  assert.equal(rows[0].source_title, ARTICLE.title);
  assert.equal(rows[0].source_date, '2026-09-10');
  assert.equal(rows[0].fact_key, null);
});

test('buildRssFactRows falls back to fetched_at date when published_at is missing', () => {
  const rows = buildRssFactRows({
    lane: 'dialysis', section: 'policy', article: { ...ARTICLE, published_at: null },
    facts: [{ claim_text: 'x', value: null, unit: null }],
    staleAfterIso: '2026-09-18T00:00:00Z', fetchedAtIso: '2026-09-11T00:00:00Z',
  });
  assert.equal(rows[0].source_date, '2026-09-11');
});
