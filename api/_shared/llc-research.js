// api/_shared/llc-research.js
//
// Round 76ek.j Phase 2 — LLC research enrichment via Secretary-of-State
// records. Called by the admin handler `?_route=llc-research-tick` which
// drains the per-domain `llc_research_queue` table populated by the
// upsertDomainOwners writer hook (Phase 1b).
//
// Design:
//   - lookupLlc() is the orchestrator. Today it routes everything to
//     OpenCorporates because that's the only source we have a reliable
//     API for. Future per-state handlers (Michigan LARA direct, etc.)
//     can hook in by extending the if-ladder; the queue/writer code
//     above this module is source-agnostic.
//   - OpenCorporates is feature-flagged on OPENCORPORATES_API_KEY env.
//     Without the key, lookupLlc returns {found:false, reason:
//     'no_handler_configured'} and the queue row stays queued so a
//     later run can pick it up after the key lands.
//   - Two-step lookup: search → company detail. Search returns basic
//     identity (name, jurisdiction, status); company detail page has
//     the officers list + registered_agent that we actually want for
//     enrichment. Each is one billable lookup.

const OPENCORPORATES_BASE = 'https://api.opencorporates.com/v0.4';

// Map US state code → OpenCorporates jurisdiction code.
function stateToJurisdiction(state) {
  if (!state || typeof state !== 'string') return null;
  const code = state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return `us_${code.toLowerCase()}`;
}

/**
 * Orchestrator. Returns a uniform shape regardless of source.
 *
 * @param {object} args
 * @param {string} args.name         — LLC name to search for
 * @param {string} [args.state]      — 2-letter US state guess (e.g. 'MI')
 * @returns {Promise<{
 *   found: boolean,
 *   source: 'opencorporates' | null,
 *   reason?: 'no_handler_configured' | 'no_match' | 'unsupported_state'
 *           | 'auth_failed' | 'quota_exceeded' | 'search_error' | 'detail_error',
 *   filing_state?: string, filing_id?: string, filing_date?: string,
 *   filing_status?: string, registered_agent_name?: string,
 *   registered_agent_address?: string, manager_name?: string,
 *   manager_role?: string, payload?: object,
 * }>}
 */
export async function lookupLlc({ name, state }) {
  if (!name || typeof name !== 'string' || name.trim().length < 3) {
    return { found: false, source: null, reason: 'invalid_input' };
  }

  const apiKey = process.env.OPENCORPORATES_API_KEY || null;
  if (!apiKey) {
    return { found: false, source: null, reason: 'no_handler_configured' };
  }

  return lookupViaOpenCorporates({ name, state, apiKey });
}

async function lookupViaOpenCorporates({ name, state, apiKey }) {
  const jurisdiction = stateToJurisdiction(state);
  // jurisdiction is optional — search-without-jurisdiction returns hits
  // across the whole DB, which is useful when the property's state is
  // different from the LLC's filing state (very common — Delaware filings
  // for properties owned anywhere). Don't make state mandatory.

  // ── Step 1: search by name (+ optional jurisdiction)
  const searchParams = new URLSearchParams({
    q:         name.trim(),
    api_token: apiKey,
    per_page:  '10',
  });
  if (jurisdiction) searchParams.set('jurisdiction_code', jurisdiction);

  const searchUrl = `${OPENCORPORATES_BASE}/companies/search?${searchParams.toString()}`;

  let searchBody;
  try {
    const r = await fetch(searchUrl);
    if (r.status === 401) return { found: false, source: 'opencorporates', reason: 'auth_failed' };
    if (r.status === 402) return { found: false, source: 'opencorporates', reason: 'quota_exceeded' };
    if (r.status === 429) return { found: false, source: 'opencorporates', reason: 'rate_limited' };
    if (!r.ok)            return { found: false, source: 'opencorporates', reason: `search_${r.status}` };
    searchBody = await r.json();
  } catch (err) {
    return { found: false, source: 'opencorporates', reason: 'search_error', error: err?.message };
  }

  const companies = searchBody?.results?.companies || [];
  if (companies.length === 0) {
    return { found: false, source: 'opencorporates', reason: 'no_match' };
  }

  // Best-match selection: fuzzy compare against the search name and pick
  // the highest-similarity active entity. Falls back to the first hit when
  // all candidates are equally close. Inactive (dissolved) entities are
  // de-prioritized — we want the live filing.
  const best = pickBestMatch(name, companies);
  if (!best) return { found: false, source: 'opencorporates', reason: 'no_match' };

  // ── Step 2: fetch company detail to get officers + registered_agent
  const detailUrl =
    `${OPENCORPORATES_BASE}/companies/${best.jurisdiction_code}/` +
    `${encodeURIComponent(best.company_number)}?api_token=${apiKey}`;

  let company = best;
  try {
    const r = await fetch(detailUrl);
    if (r.ok) {
      const body = await r.json();
      company = body?.results?.company || best;
    }
    // If detail fetch fails we still return the partial enrichment from
    // the search hit — degraded but useful.
  } catch (err) {
    console.warn('[llc-research] detail fetch threw:', err?.message);
  }

  // ── Step 3: extract enrichment fields
  const officers = Array.isArray(company.officers) ? company.officers : [];
  const agent = officers.find(o => o && /agent/i.test(o.position || ''));
  const manager =
    officers.find(o => o && /^(manager|managing\s+member|principal|member|president|ceo)\b/i.test(o.position || '')) ||
    officers.find(o => o && o.position) ||
    officers[0] ||
    null;

  return {
    found:                    true,
    source:                   'opencorporates',
    filing_state:             company.jurisdiction_code?.replace(/^us_/, '').toUpperCase() || null,
    filing_id:                company.company_number || null,
    filing_date:              company.incorporation_date || null,
    filing_status:            company.current_status || null,
    registered_agent_name:    company.agent_name || agent?.name || null,
    registered_agent_address: company.agent_address || agent?.address || null,
    manager_name:             manager?.name || null,
    manager_role:             manager?.position || null,
    payload:                  company,
  };
}

// ── Match scoring ───────────────────────────────────────────────────────────
//
// OpenCorporates returns multiple companies for a name search; pick the
// best one by:
//   1. Active filings outrank dissolved ones.
//   2. Higher Jaccard token-set similarity to the input name wins.
//   3. Tiebreak: earliest incorporation_date (oldest entity is usually
//      the parent / longest-lived).

function pickBestMatch(searchName, hits) {
  const target = tokenizeForMatch(searchName);
  if (target.size === 0) return null;

  let bestScore = -1;
  let best = null;

  for (const hit of hits) {
    const c = hit?.company;
    if (!c || !c.name) continue;
    const cand = tokenizeForMatch(c.name);
    const intersection = [...target].filter(t => cand.has(t)).length;
    const union = new Set([...target, ...cand]).size;
    const jaccard = union > 0 ? intersection / union : 0;

    const isActive = !/dissolv|inactive|cancel|forfeit/i.test(c.current_status || '');
    let score = jaccard * 100;
    if (isActive) score += 10;

    // Tiebreak: prefer older filings (lower year)
    const yr = parseInt((c.incorporation_date || '').slice(0, 4), 10);
    if (Number.isFinite(yr)) score += (2100 - yr) * 0.001;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  // Reject the match if the best score is too low — random false positives
  // dragging high-trust fields would be worse than just leaving the row
  // un-enriched.
  if (bestScore < 40) return null;
  return best;
}

function tokenizeForMatch(name) {
  return new Set(
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t && !/^(llc|lp|llp|inc|corp|co|the|of|and)$/.test(t))
  );
}
