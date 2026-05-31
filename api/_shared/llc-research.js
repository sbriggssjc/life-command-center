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

import { opsQuery } from './ops-db.js';

// Name normalizer mirroring scripts/ingest-sunbiz-fl.mjs::normName so the FL
// adapter's lookup key matches sos_fl_entities.name_norm exactly.
function _normLlcName(s) {
  return String(s || '').toLowerCase()
    .replace(/[.,'"]/g, '')
    .replace(/\b(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|lp|llp|ltd|limited|trust|holdings|partners|partnership)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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

  // ── SOS-direct adapters (free, per-state) — preferred over OpenCorporates
  //    where we have a verified handler. The registry below maps a 2-letter
  //    state code → adapter; each adapter returns the SAME uniform shape as
  //    this orchestrator (source:'sos_<state>'). The queue/writer code that
  //    calls lookupLlc is source-agnostic, so adding a state is just adding a
  //    registry entry. Registry starts empty → behavior unchanged until an
  //    adapter is built AND verified against the live source.
  const st = (state || '').trim().toUpperCase();
  const adapter = /^[A-Z]{2}$/.test(st) ? SOS_DIRECT_ADAPTERS[st] : null;
  if (adapter) {
    try {
      const res = await adapter({ name, state: st });
      if (res && res.found) return res;                       // got it from the SOS
      if (res && res.reason === 'no_match') return res;       // authoritative miss for that state
      // adapter_pending / unreachable / rate_limited → fall through to OC
    } catch (err) {
      console.warn(`[llc-research] SOS-direct adapter ${st} threw:`, err?.message);
    }
  }

  const apiKey = process.env.OPENCORPORATES_API_KEY || null;
  if (!apiKey) {
    return { found: false, source: null, reason: 'no_handler_configured' };
  }

  return lookupViaOpenCorporates({ name, state, apiKey });
}

// ── SOS-direct adapter registry ──────────────────────────────────────────────
// Each adapter: async ({name, state}) => uniform lookupLlc shape, source
// 'sos_<state>'. Build strategy by state (compliance-first):
//   1. BULK-DOWNLOAD states — e.g. Florida Sunbiz publishes downloadable
//      corporate data files; ingest to a local mirror and match against it.
//      Compliant, complete, no anti-bot, no per-request cost. Preferred.
//   2. FREE search/API states — per-entity query of an official open endpoint.
//   3. Everything else — leave to OpenCorporates, or sidebar-assisted manual
//      capture (broker opens the SOS page; the existing sidebar ingests it).
// Adapters MUST be verified against the live/source format before enabling
// (return {found:false, reason:'adapter_pending'} until then).
const SOS_DIRECT_ADAPTERS = {
  FL: lookupViaFloridaSunbiz,   // Sunbiz Corporate Data File mirror (sos_fl_entities on LCC Opps)
};

// FL adapter — queries the Sunbiz mirror (sos_fl_entities) on LCC Opps. Returns
// the same uniform shape as lookupViaOpenCorporates. source:'sos_fl'. When the
// mirror is empty/unreachable, returns adapter_pending so the orchestrator
// falls through to OpenCorporates rather than reporting a false no_match.
async function lookupViaFloridaSunbiz({ name }) {
  const norm = _normLlcName(name);
  if (!norm || norm.length < 3) return { found: false, source: 'sos_fl', reason: 'invalid_input' };
  // Prefer an exact normalized match on an ACTIVE filing; the trigram index
  // also supports the ilike fallback. Limit small — we only need the best hit.
  let rows = null;
  try {
    const enc = encodeURIComponent(norm);
    const r = await opsQuery('GET',
      `sos_fl_entities?name_norm=eq.${enc}&order=status.asc&limit=5` +
      `&select=corp_number,corp_name,status,filing_type,file_date,ra_name,ra_address,ra_city,ra_state,ra_zip,officer1_title,officer1_name`);
    if (!r.ok) return { found: false, source: 'sos_fl', reason: 'adapter_pending' };
    rows = Array.isArray(r.data) ? r.data : [];
  } catch (_e) {
    return { found: false, source: 'sos_fl', reason: 'adapter_pending' };
  }
  if (rows.length === 0) {
    // Mirror is reachable but no exact hit. Treat as an authoritative FL miss
    // ONLY if the mirror is actually populated; otherwise let OC try.
    try {
      const probe = await opsQuery('GET', 'sos_fl_entities?select=corp_number&limit=1', undefined, { countMode: 'estimated' });
      const populated = probe.ok && (probe.count || (Array.isArray(probe.data) && probe.data.length));
      return { found: false, source: 'sos_fl', reason: populated ? 'no_match' : 'adapter_pending' };
    } catch (_e) {
      return { found: false, source: 'sos_fl', reason: 'adapter_pending' };
    }
  }
  // Prefer an Active ('A') row; rows are ordered status.asc so 'A' sorts first.
  const best = rows.find(x => (x.status || '').toUpperCase() === 'A') || rows[0];
  const officerName = best.officer1_name || null;
  return {
    found:                    true,
    source:                   'sos_fl',
    filing_state:             'FL',
    filing_id:                best.corp_number || null,
    filing_date:              best.file_date || null,
    filing_status:            best.status === 'A' ? 'Active' : (best.status === 'I' ? 'Inactive' : (best.status || null)),
    registered_agent_name:    best.ra_name || null,
    registered_agent_address: [best.ra_address, best.ra_city, best.ra_state, best.ra_zip].filter(Boolean).join(', ') || null,
    manager_name:             officerName,
    manager_role:             best.officer1_title || null,
    payload:                  best,
  };
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
