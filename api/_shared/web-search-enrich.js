// api/_shared/web-search-enrich.js
// ============================================================================
// CONTACT-SELECTION Slice 4 — Phase D: free web-search enrichment (FRAMEWORK)
// ----------------------------------------------------------------------------
// When SOS (Phase B) and reverse-address (Phase C) can't resolve a principal, a
// free web search of the owner name (+ inferred state + notice city) often
// surfaces the manager/principal in a SOS result page, county/business filing,
// press item, or professional-profile snippet. Scott's amendment (2026-06-20):
// stay FREE — web search + cross-referencing + manual research, no paid API.
//
// FRAMEWORK, not a live scraper (sandbox has no egress). Built + unit-tested
// here: the principal-candidate PARSER over a normalized result list, the person
// guards, confidence scoring, and the unconfigured/feature-flag behavior. The
// actual search HTTP is a deferred, deps-injected fetcher behind
// `OWNER_ENRICH_WEBSEARCH_URL`; it no-ops until a free provider is wired +
// validated post-deploy.
//
// DISCIPLINE (per the amendment): guarded (never attach a firm/junk/agent), a
// STRONG labeled-role cue required (we do NOT name-grab arbitrary snippet text),
// confidence-scored, and **no confident match ⇒ no attach** → the owner falls
// through to the manual-research worklist. Never guess-attach a wrong person.
// ============================================================================

import { looksLikePersonName, isImplausiblePersonName } from './entity-link.js';

// Strong, labeled role cues that precede a principal NAME in a result snippet.
// We ONLY accept a name that sits adjacent to one of these — never a bare
// capitalized phrase (which is how false names get grabbed). role = the
// contact_role we attach with.
const ROLE_CUES = [
  { re: /\b(?:managing\s+member)\s*[:\-]?\s*/i, role: 'managing_member' },
  { re: /\b(?:registered\s+agent|statutory\s+agent|resident\s+agent)\s*[:\-]?\s*/i, role: 'registered_agent' },
  { re: /\b(?:manager)\s*[:\-]?\s*/i, role: 'manager' },
  { re: /\b(?:authorized\s+(?:person|signatory|representative|officer)|officer|president|principal|owner)\s*[:\-]?\s*/i, role: 'principal' },
  { re: /\b(?:member)\s*[:\-]?\s*/i, role: 'member' },
];

// Capture a 2–4 token "First [M.] Last" run, OR a SOS-style "LAST, FIRST [M]".
// A token is a name WORD (no embedded period) or an INITIAL (single letter +
// period) — so a sentence-ending period ("… Smith. Active") STOPS the run
// instead of absorbing the next word.
const NAME_TOKEN = "(?:[A-Z]\\.|[A-Z][A-Za-z'\\-]+)";
const NAME_AFTER = new RegExp(`(${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){1,3})`);
const NAME_LASTFIRST = new RegExp(`([A-Z][A-Za-z'\\-]+)\\s*,\\s*(${NAME_TOKEN}(?:\\s+${NAME_TOKEN})?)`);

function normName(s) { return String(s || '').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '').trim(); }

function candidateFromText(text) {
  if (typeof text !== 'string' || !text) return null;
  for (const { re, role } of ROLE_CUES) {
    const m = text.match(re);
    if (!m) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    // "LAST, FIRST" → "FIRST LAST"
    const lf = after.match(NAME_LASTFIRST);
    if (lf) { const flipped = normName(`${lf[2]} ${lf[1]}`); if (isPlausible(flipped)) return { name: flipped, role }; }
    const nm = after.match(NAME_AFTER);
    if (nm) { const n = normName(nm[1]); if (isPlausible(n)) return { name: n, role }; }
  }
  return null;
}

function isPlausible(name) {
  return !!name && looksLikePersonName(name) && !isImplausiblePersonName(name);
}

/**
 * Extract the best principal candidate from a normalized web-search result list.
 * Each result: { title?, snippet?, url? }. A candidate is only taken from text
 * adjacent to a STRONG role cue (manager / registered agent / authorized person
 * / principal / member), guarded to a plausible human name. Confidence:
 *   high   — the same name surfaces from ≥2 results (corroborated)
 *   medium — a single labeled hit
 * No labeled candidate ⇒ null (→ manual worklist; never a snippet guess).
 *
 * @returns {{person_name, role, confidence:'high'|'medium', hits:number} | null}
 */
export function extractPrincipalCandidates(results, ownerName = '') {
  if (!Array.isArray(results) || !results.length) return null;
  const owner = String(ownerName || '').toLowerCase();
  const tally = new Map(); // name -> { name, role, hits }
  for (const r of results) {
    const text = `${r && r.title || ''} . ${r && r.snippet || ''}`;
    const c = candidateFromText(text);
    if (!c) continue;
    // never return the owner FIRM name itself mistyped as a person
    if (owner && (owner.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(owner))) continue;
    const key = c.name.toLowerCase();
    const prev = tally.get(key);
    if (prev) { prev.hits += 1; }
    else tally.set(key, { name: c.name, role: c.role, hits: 1 });
  }
  if (!tally.size) return null;
  const ranked = [...tally.values()].sort((a, b) => b.hits - a.hits);
  const best = ranked[0];
  return { person_name: best.name, role: best.role, confidence: best.hits >= 2 ? 'high' : 'medium', hits: best.hits };
}

export function isWebSearchAdapterConfigured() {
  return !!process.env.OWNER_ENRICH_WEBSEARCH_URL;
}

/**
 * Build the `webSearch(row)` the worker calls. Issues a free search (deferred,
 * deps-injected) for the owner name + inferred state + notice city, parses
 * principal candidates, guards, and returns the best above the confidence floor.
 *
 *   deps.search(query, row) -> [{title,snippet,url}, …]   (production; deferred)
 *   deps.cache { get, set }                               (optional)
 *
 * Unconfigured ⇒ `{ ok:false, reason:'unconfigured' }`. Below the confidence
 * floor (default 'medium' accepted; raise via OWNER_ENRICH_WEBSEARCH_MIN) ⇒
 * `{ ok:false, reason:'no_confident_match' }` → manual worklist.
 */
export function buildWebSearchAdapter(deps = {}) {
  const search = deps.search;
  const cache = deps.cache;
  return async function webSearch(row) {
    if (!isWebSearchAdapterConfigured() || typeof search !== 'function') return { ok: false, reason: 'unconfigured' };
    const name = String(row.owner_name || '').trim();
    if (!name) return { ok: false, reason: 'no_owner_name' };
    const query = [name, row.owner_state || '', row.notice_city || '', 'manager managing member registered agent']
      .filter(Boolean).join(' ');
    const key = `web|${query.toLowerCase()}`;
    let results;
    if (cache) { const hit = await cache.get(key); if (hit !== undefined && hit !== null) results = hit; }
    if (results === undefined) {
      try { results = await search(query, row); } catch (e) { return { ok: false, reason: 'search_error', detail: String(e && e.message || e) }; }
      if (cache) { try { await cache.set(key, results || []); } catch (_e) { /* soft */ } }
    }
    const cand = extractPrincipalCandidates(results, name);
    if (!cand) return { ok: false, reason: 'no_confident_match' };
    const minHigh = process.env.OWNER_ENRICH_WEBSEARCH_MIN === 'high';
    if (minHigh && cand.confidence !== 'high') return { ok: false, reason: 'below_confidence_floor', confidence: cand.confidence };
    return { ok: true, person_name: cand.person_name, role: cand.role, confidence: cand.confidence, hits: cand.hits };
  };
}
