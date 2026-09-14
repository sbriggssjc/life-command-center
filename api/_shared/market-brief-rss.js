// ============================================================================
// api/_shared/market-brief-rss.js — MB-a: P-RSS (daily healthcare-news ->
// dialysis-lane facts) pure helpers.
//
// The tick (market-brief-rss-tick.js) reads today's
// briefing_intel_snapshot.sector_news.healthcare (already fetched daily by the
// briefing-intel-snapshot edge function — spec §2 "reuses live machinery").
// For each article, an on-box Ollama call decides (1) dialysis relevance and
// (2) up to N candidate facts as short claims. Everything here is pure and
// DB-free so it is fixture-testable; the tick owns the DB reads/writes and the
// actual invokeOnPremGeneration call (injected here as `generate`, mirroring
// classifyWithOllama in operator-triage-tick.js).
//
// FAIL CLOSED, NO CLOUD FALLBACK. A private-corpus doctrine does not apply
// here (the articles are already public), but the house rule for this class
// of on-box generation (draft-assist, Analyst's Take, OC2 triage) is still
// "Ollama down -> skip, never guess, never fall back to a cloud model" — this
// producer follows the same shape so a reader of this file recognizes the
// pattern instead of learning a fourth variant.
//
// NEVER FABRICATES A NUMBER. `filterVerbatimFacts` drops any extracted claim
// carrying a number that does not appear verbatim (see
// market-brief-facts.js::claimNumbersAreVerbatim) in the article's own
// title+summary text. A model can paraphrase; it cannot invent a figure.
// ============================================================================

import { claimNumbersAreVerbatim } from './market-brief-facts.js';

export const MAX_FACTS_PER_ARTICLE = 3;

/**
 * Build the extraction prompt for one RSS article.
 * @param {string} lane  e.g. 'dialysis'
 * @param {{title:string, summary:string|null, url:string, published_at:string|null, source:string}} article
 */
export function buildRssExtractionPrompt(lane, article) {
  const title = String(article?.title || '').slice(0, 300);
  const summary = String(article?.summary || '').slice(0, 1500);
  const source = String(article?.source || '').slice(0, 100);
  return `You are screening a healthcare-industry news item for relevance to the ${lane} commercial real estate market.

Article source: ${source}
Title: ${title}
Summary: ${summary}

1. Is this article materially relevant to the ${lane} sector (operators, regulation, reimbursement policy, capital markets, real estate)? Ignore generic hospital/health-system news that has nothing to do with ${lane}.
2. If relevant, extract up to ${MAX_FACTS_PER_ARTICLE} short factual claims a broker could cite. Every number in a claim MUST be copied verbatim from the title or summary above — do not calculate, round, or infer a number that is not already written there.

Respond with ONLY a JSON object, no prose, no markdown fences:
{"relevant": true|false, "facts": [{"claim_text": "...", "value": number|null, "unit": "string or null"}]}
If not relevant, respond {"relevant": false, "facts": []}.`;
}

/**
 * Parse the model's raw text response. Fails closed (returns null) on any
 * unparsable or malformed shape — never guesses at a partial result.
 */
export function parseRssExtractionResponse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.relevant !== 'boolean') return null;
  const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
  const cleaned = facts
    .filter((f) => f && typeof f === 'object' && typeof f.claim_text === 'string' && f.claim_text.trim())
    .slice(0, MAX_FACTS_PER_ARTICLE)
    .map((f) => ({
      claim_text: String(f.claim_text).trim().slice(0, 500),
      value: Number.isFinite(Number(f.value)) ? Number(f.value) : null,
      unit: f.unit ? String(f.unit).slice(0, 40) : null,
    }));
  return { relevant: parsed.relevant, facts: parsed.relevant ? cleaned : [] };
}

/**
 * Drop any extracted fact whose claim contains a number not verbatim in the
 * article's own text (title + summary). This is the deterministic post-check
 * the spec requires independent of whatever the model asserted.
 */
export function filterVerbatimFacts(facts, article) {
  const sourceText = `${article?.title || ''} ${article?.summary || ''}`;
  return (facts || []).filter((f) => claimNumbersAreVerbatim(f.claim_text, sourceText));
}

/**
 * Injectable Ollama call for RSS fact extraction, mirroring
 * operator-triage-tick.js::classifyWithOllama. Fails closed on any error,
 * timeout, or unparsable response — returns null, never a guess.
 * @param {string} lane
 * @param {object} article
 * @param {Function} generate  invokeOnPremGeneration-shaped function, injected for tests
 */
export async function extractRssFactsWithOllama(lane, article, generate) {
  const prompt = buildRssExtractionPrompt(lane, article);
  const gen = await generate({ prompt, temperature: 0.1, json: true }).catch(() => null);
  if (!gen || !gen.ok || !gen.text) return null;
  const parsed = parseRssExtractionResponse(gen.text);
  if (!parsed) return null;
  if (!parsed.relevant || !parsed.facts.length) return { relevant: parsed.relevant, facts: [] };
  const verbatimOnly = filterVerbatimFacts(parsed.facts, article);
  return { relevant: true, facts: verbatimOnly };
}

/**
 * Build market_brief_facts rows for the facts extracted from one article.
 * origin='rss', fact_kind='reported', 7-day TTL (spec §3). No fact_key — RSS
 * facts dedupe on the EB1 uq_mbf_source_identity index
 * (lane, section, source_url, source_date, claim_text), since every RSS fact
 * has both a source_url and a source_date by construction.
 */
export function buildRssFactRows({ lane, section, article, facts, staleAfterIso, fetchedAtIso }) {
  const sourceDate = normalizeSourceDate(article?.published_at) || fetchedAtIso.slice(0, 10);
  // MB2a: a Google-News-sourced article's `url` is a news.google.com
  // redirect, never the publisher's own page — never present that as a
  // normal citation link. `source_publisher` (parsed by the edge fn from
  // the item title's " - Publisher" suffix) names the real outlet;
  // `source_url_is_redirect` marks the link itself so any renderer can
  // label it (e.g. "via Google News") instead of implying a direct link.
  return (facts || []).map((f) => ({
    lane,
    section,
    claim_text: f.claim_text,
    value: f.value,
    unit: f.unit,
    source_url: article?.url || null,
    source_title: article?.title || null,
    source_publisher: article?.publisher || null,
    source_url_is_redirect: !!article?.url_is_redirect,
    source_date: sourceDate,
    fetched_at: fetchedAtIso,
    origin: 'rss',
    fact_kind: 'reported',
    stale_after: staleAfterIso,
    fact_key: null,
  }));
}

function normalizeSourceDate(publishedAt) {
  if (!publishedAt) return null;
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
