// ============================================================================
// DUP-RECORDS1 / SALE-PROMOTER1-sidebar-feed (2026-09-26) — CoStar sidebar sales reach the promoters.
//
//   GET  /api/sidebar-sale-feed   dry-run: how many rows each domain would receive
//   POST /api/sidebar-sale-feed   stage them into <dom>_sidebar_sale_candidate
//
// The domain DBs cannot read LCC Opps. lcc_sidebar_sale_feed_rows (LCC Opps) turns every asset entity's
// metadata.sales_history into staging rows (row_key = ord:md5(element), byte-identical to the
// SALE-PROMOTER1 in-session loader). This handler only moves them. The staging table's
// UNIQUE (entity_id, row_key) + resolution=ignore-duplicates makes a re-run write nothing, and the
// promoters (gov 05:50, dia 05:52 UTC) decide what is a sale through lcc_sale_candidate_verdict.
//
// Honest counts: `sent` is what we POSTed; `staged` is the staging table's count=exact delta.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';

export const FEED_DOMAINS = [
  { short: 'dia', db: 'dialysis', table: 'dia_sidebar_sale_candidate' },
  { short: 'gov', db: 'government', table: 'gov_sidebar_sale_candidate' },
];
const CHUNK = 500;
const STAGING_COLUMNS = ['entity_id', 'row_key', 'property_id', 'sale_date', 'sale_price', 'buyer', 'seller',
  'sale_type', 'deed_type', 'document_number', 'recordation_date', 'comp_status', 'price_status', 'raw'];

/**
 * Pure. RPC rows -> staging rows. Drops a row that cannot be staged honestly: no entity, no row_key,
 * a non-integer property id, or no date (the promoter refuses a dateless candidate anyway, and staging
 * it would only fill the promote log with refusals). Duplicate (entity_id, row_key) pairs collapse to one.
 */
export function buildStagingRows(rpcRows) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(rpcRows) ? rpcRows : []) {
    if (!r || !r.entity_id || !r.row_key || !r.sale_date) continue;
    const pid = Number(r.property_id);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const key = `${r.entity_id}|${r.row_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = {};
    for (const c of STAGING_COLUMNS) row[c] = r[c] === undefined ? null : r[c];
    row.property_id = pid;
    row.raw = (r.raw && typeof r.raw === 'object') ? r.raw : {};
    out.push(row);
  }
  return out;
}

async function stagedCount(q, dom) {
  const r = await q(dom.db, 'GET', `${dom.table}?select=candidate_id&limit=1`, undefined, { Prefer: 'count=exact' });
  return (r && r.ok && typeof r.count === 'number') ? r.count : null;
}

export async function runSidebarSaleFeed({ apply = false, since = null, limit = 5000, deps = {} } = {}) {
  const ops = deps.opsQuery || opsQuery;
  const q = deps.domainQuery || domainQuery;
  const out = { apply, domains: {}, errors: [] };
  for (const dom of FEED_DOMAINS) {
    const d = { rows: 0, sent: 0, staged: null };
    out.domains[dom.short] = d;
    const args = { p_domain: dom.short, p_limit: limit };
    if (since) args.p_since = since;
    const r = await ops('POST', 'rpc/lcc_sidebar_sale_feed_rows', args);
    if (!r || !r.ok) { out.errors.push({ domain: dom.short, step: 'rows', detail: r && r.data }); continue; }
    const rows = buildStagingRows(r.data);
    d.rows = rows.length;
    if (!apply || !rows.length) continue;

    const before = await stagedCount(q, dom);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const w = await q(dom.db, 'POST', `${dom.table}?on_conflict=entity_id,row_key`, chunk,
        { Prefer: 'resolution=ignore-duplicates,return=minimal' });
      if (!w || !w.ok) {
        out.errors.push({ domain: dom.short, step: 'stage', offset: i, detail: w && w.data });
        continue;
      }
      d.sent += chunk.length;
    }
    const after = await stagedCount(q, dom);
    d.staged = (before != null && after != null) ? after - before : null;
  }
  return out;
}

export async function handleSidebarSaleFeed(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  const user = await authenticate(req, res);
  if (!user) return;
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const out = await runSidebarSaleFeed({ apply: req.method === 'POST', since: body.since || req.query?.since || null });
  return res.status(out.errors.length ? 207 : 200).json({ ok: out.errors.length === 0, ...out });
}
