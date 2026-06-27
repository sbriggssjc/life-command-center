// ============================================================================
// owner-contact-websearch / normalize.js — pure provider-response mapping
// Life Command Center — web-search enrichment proxy (2026-06-27)
//
// PURE ESM (no Deno / no Node APIs) so it is imported by BOTH the Deno edge
// function (index.ts) AND the node test suite (no drift on the mapping shape).
//
// The owner-contact-enrich worker's web-search adapter
// (api/_shared/web-search-enrich.js::buildWebSearchAdapter) calls
// search(query,row) and feeds the result straight into
// extractPrincipalCandidates, which consumes a list of:
//     { title, snippet, url }
// So this proxy's ONLY job is to map a free-tier search provider's JSON into
// exactly that shape (top ~N), and to degrade to [] on anything unexpected.
// It does NOT parse names / call an LLM — the LCC parser does the labeled-role
// extraction + guards.
// ============================================================================

export const DEFAULT_MAX_RESULTS = 10;

function clean(s) {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

function pushRow(out, title, snippet, url, max) {
  const t = clean(title), sn = clean(snippet), u = clean(url);
  // A result is only useful to the parser if it carries text to scan. Keep any
  // row with a title OR snippet; url is best-effort (provenance for spot-checks).
  if (!t && !sn) return;
  out.push({ title: t, snippet: sn, url: u });
  return out.length >= max;
}

// Brave Search API — GET /res/v1/web/search → { web: { results: [ {title,
// description, url} ] } } (also discussions/faq/news blocks carry the same shape).
export function normalizeBraveResults(json, max = DEFAULT_MAX_RESULTS) {
  const out = [];
  if (!json || typeof json !== 'object') return out;
  const blocks = [
    json.web && json.web.results,
    json.faq && json.faq.results,
    json.discussions && json.discussions.results,
    json.news && json.news.results,
  ];
  for (const results of blocks) {
    if (!Array.isArray(results)) continue;
    for (const r of results) {
      if (!r || typeof r !== 'object') continue;
      if (pushRow(out, r.title, r.description ?? r.snippet, r.url, max)) return out;
    }
  }
  return out;
}

// Serper.dev — POST /search → { organic: [ {title, snippet, link} ] }
// (knowledgeGraph / answerBox optionally carry a snippet too).
export function normalizeSerperResults(json, max = DEFAULT_MAX_RESULTS) {
  const out = [];
  if (!json || typeof json !== 'object') return out;
  const kg = json.knowledgeGraph;
  if (kg && (kg.title || kg.description)) {
    if (pushRow(out, kg.title, kg.description, kg.website || kg.descriptionLink, max)) return out;
  }
  const organic = Array.isArray(json.organic) ? json.organic : [];
  for (const r of organic) {
    if (!r || typeof r !== 'object') continue;
    if (pushRow(out, r.title, r.snippet, r.link, max)) return out;
  }
  return out;
}

// Provider switch. Unknown provider OR malformed JSON → [] (the adapter then
// returns no_confident_match → the owner falls to the manual worklist).
export function normalizeProviderResults(provider, json, max = DEFAULT_MAX_RESULTS) {
  try {
    switch (String(provider || '').toLowerCase()) {
      case 'serper': return normalizeSerperResults(json, max);
      case 'brave':
      default: return normalizeBraveResults(json, max);
    }
  } catch (_e) {
    return [];
  }
}
