// ============================================================================
// W7.3 — conservative free-text → OPEN-deal resolver
// ----------------------------------------------------------------------------
// Shared by the Copilot log_call_note / tag_comm_to_deal actions and the
// Outlook-category receiver. Deal resolution NEVER guesses: >1 candidate →
// ambiguous (return the list for a human pick / park in the unresolved lane);
// 0 → none. There is NO LLM in this gate — it is a deterministic name / city /
// address match, preferring entities that carry an OPEN bd_opportunity.
// ============================================================================

import { opsQuery as defaultOpsQuery } from './ops-db.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Resolve a free-text query (a deal name, tenant, or "tenant city" core) to a
 * single OPEN deal entity.
 *
 * @returns {Promise<{
 *   matched: 'exact'|'unique'|'ambiguous'|'none',
 *   ambiguous: boolean,
 *   deal_entity_id?: string,
 *   deal_name?: string,
 *   candidates: Array<{entity_id,name,city,state,address}>
 * }>}
 */
export async function resolveDealByQuery(query, deps = {}) {
  const opsQuery = deps.opsQuery || defaultOpsQuery;
  const q = String(query || '').trim();
  if (!q) return { matched: 'none', ambiguous: false, candidates: [] };

  const safe = encodeURIComponent(q.replace(/[*()]/g, ''));
  const r = await opsQuery('GET',
    `entities?select=id,name,city,state,address,entity_type,domain&limit=25&order=name.asc` +
    `&or=(name.ilike.*${safe}*,city.ilike.*${safe}*,address.ilike.*${safe}*)`);
  const ents = (r?.data || []);
  if (!ents.length) return { matched: 'none', ambiguous: false, candidates: [] };

  // Prefer entities that carry an OPEN deal — that is what "deal" means here.
  const ids = ents.map((e) => e.id);
  let openSet = new Set();
  try {
    const oppR = await opsQuery('GET',
      `bd_opportunities?entity_id=in.(${ids.join(',')})&is_open=eq.true&select=entity_id`);
    openSet = new Set((oppR?.data || []).map((o) => o.entity_id));
  } catch (_e) { /* best-effort — fall back to name pool below */ }

  const withOpen = ents.filter((e) => openSet.has(e.id));
  const pool = withOpen.length ? withOpen : ents;

  const cand = (e) => ({ entity_id: e.id, name: e.name, city: e.city, state: e.state, address: e.address });
  const pick = (e, matched) => ({ matched, ambiguous: false, deal_entity_id: e.id, deal_name: e.name, candidates: [cand(e)] });

  // Exact normalized-name match wins outright (even amid other partials).
  const nq = norm(q);
  const exact = pool.filter((e) => norm(e.name) === nq);
  if (exact.length === 1) return pick(exact[0], 'exact');

  if (pool.length === 1) return pick(pool[0], 'unique');

  return { matched: 'ambiguous', ambiguous: true, candidates: pool.slice(0, 8).map(cand) };
}

/**
 * Decide what tag_comm_to_deal should do given the message's CURRENT deal stamp
 * and the REQUESTED deal. Idempotent + cross-deal-conflict guard:
 *   - same deal already → 'already' (no-op)
 *   - stamped to a DIFFERENT deal → 'conflict' (refuse; surface it)
 *   - unstamped → 'stamp'
 */
export function decideCommTagOutcome(currentDealId, requestedDealId) {
  if (currentDealId && currentDealId === requestedDealId) return 'already';
  if (currentDealId && currentDealId !== requestedDealId) return 'conflict';
  return 'stamp';
}

/**
 * Extract the LCC deal hint from an Outlook category array.
 * Convention: bare `LCC` (auto-resolve via sender) or `LCC:<deal hint>`.
 * Returns { tagged:boolean, hint:string|null }.
 */
export function parseLccCategoryHint(categories) {
  const list = Array.isArray(categories)
    ? categories
    : String(categories || '').split(/[;,]/);
  for (const raw of list) {
    const c = String(raw || '').trim();
    if (/^lcc$/i.test(c)) return { tagged: true, hint: null };
    const m = c.match(/^lcc\s*[:=]\s*(.+)$/i);
    if (m) return { tagged: true, hint: m[1].trim() };
  }
  return { tagged: false, hint: null };
}
