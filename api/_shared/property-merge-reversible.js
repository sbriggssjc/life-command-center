// ============================================================================
// property-merge-reversible.js — the ONE way LCC merges two domain properties
// (CONSOLIDATE-REVERSIBLE, 2026-09-24)
//
// Both domains carry a destructive merge and a reversible wrapper:
//   dia: dia_merge_property(keep, drop)   — hard-deletes the drop row, no snapshot
//        dia_merge_property_reversible(keep, drop, batch_tag) → backup_id
//        dia_unmerge_property(backup_id)
//   gov: gov_merge_property(keep, drop)   — a RAISE stub since the SEC1/ADDR1b
//        lockdown ("retired from direct use"), so calling it always fails
//        gov_merge_property_reversible(keep, drop, batch_tag) → backup_id
//        gov_unmerge_property(backup_id)
//
// Every LCC call site goes through mergePropertyReversible(). The wrapper
// snapshots the dropped row + child keys into <dom>_property_merge_backup
// BEFORE merging and returns that backup's id, which is all an unmerge needs.
// test/consolidate-reversible.test.mjs fails if any api/, scripts/, mcp/ or
// front-end file calls the bare rpc/<dom>_merge_property again.
// ============================================================================

export const REVERSIBLE_MERGE_RPC = Object.freeze({
  dia: 'rpc/dia_merge_property_reversible',
  gov: 'rpc/gov_merge_property_reversible',
});

export const UNMERGE_RPC = Object.freeze({
  dia: 'rpc/dia_unmerge_property',
  gov: 'rpc/gov_unmerge_property',
});

/** Accepts 'dia'/'dialysis'/'gov'/'government' → 'dia' | 'gov' | null. */
export function shortDomain(domain) {
  const d = String(domain || '').toLowerCase();
  if (d === 'dia' || d === 'dialysis') return 'dia';
  if (d === 'gov' || d === 'government') return 'gov';
  return null;
}

/** consolidate_<route>_<yyyymmdd> (UTC). `route` is slugged to [a-z0-9_]. */
export function consolidateBatchTag(route, now = new Date()) {
  const slug = String(route || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `consolidate_${slug}_${ymd}`;
}

/** The wrapper returns a scalar bigint; PostgREST may send it bare, as a string, or wrapped. */
export function parseBackupId(data) {
  let v = data;
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === 'object') {
    v = v.backup_id ?? v.dia_merge_property_reversible ?? v.gov_merge_property_reversible ?? null;
  }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Merge drop INTO keep through the domain's reversible wrapper.
 * @param {Function} domainQuery  (dom, method, path, body) → {ok, data, status}
 * @returns {Promise<{ok:boolean, backup_id:number|null, batch_tag:string, rpc:string, data:any, status?:number}>}
 */
export async function mergePropertyReversible(domainQuery, domain, keepId, dropId, route, now = new Date()) {
  const d = shortDomain(domain);
  if (!d) throw new Error('mergePropertyReversible: domain must be dia or gov, got ' + domain);
  const keep = parseInt(keepId, 10);
  const drop = parseInt(dropId, 10);
  if (!Number.isFinite(keep) || !Number.isFinite(drop) || keep === drop) {
    throw new Error('mergePropertyReversible: keep/drop must be distinct integers');
  }
  const rpc = REVERSIBLE_MERGE_RPC[d];
  const batchTag = consolidateBatchTag(route, now);
  const r = await domainQuery(d === 'dia' ? 'dialysis' : 'government', 'POST', rpc,
    { p_keep_id: keep, p_drop_id: drop, p_batch_tag: batchTag });
  if (!r || !r.ok) return { ok: false, backup_id: null, batch_tag: batchTag, rpc, data: r ? r.data : null, status: r ? r.status : null };
  return { ok: true, backup_id: parseBackupId(r.data), batch_tag: batchTag, rpc, data: r.data };
}
