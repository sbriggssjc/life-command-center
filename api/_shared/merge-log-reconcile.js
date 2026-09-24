// ============================================================================
// merge-log-reconcile.js — keep LCC asset entities pointed at domain properties
// that still exist (Round 76ee → CONSOLIDATE-REVERSIBLE → MERGELOG-GAP)
//
// A domain property merge deletes the drop row; every LCC asset entity whose
// metadata.domain_property_id names it must move to the survivor. This module
// owns which ledgers are read, in which direction, and the evidence rule for
// links no ledger explains.
//
// Ledgers (MERGELOG-GAP, measured 2026-09-24):
//   property_merge_log           Round 76ee. No writer since 2026-05-17 (dia),
//                                0 rows ever (gov).
//   <dom>_property_merge_backup  written by <dom>_merge_property_reversible.
//   dia_property_redirects       written by dia_merge_property on EVERY merge,
//                                incl. the geospatial cron (jobid 16) that
//                                writes neither of the other two. Read through
//                                v_dia_property_redirect_resolved so a chain
//                                (A→B, B→C) lands on C. gov has no redirect table.
//
// Unmerge follow-through: <dom>_unmerge_property restores the row and sets
// backup.unmerged_at. Entities the forward pass moved still point at the kept
// id, so the unmerge pass calls lcc_unrepoint_entity_property_id, which moves
// back ONLY entities whose _round_76ee_prev_property_id names the restored id.
// ============================================================================

const pgv = (v) => encodeURIComponent(String(v));

/** The forward ledgers for a domain ('dia' | 'gov'). */
export function forwardSources(target) {
  const out = [
    { key: 'merge_log', table: 'property_merge_log', stampTable: 'property_merge_log', idCol: 'id',
      select: 'id,keep_id,drop_id,merged_at', filter: '',
      keep: (r) => r.keep_id, drop: (r) => r.drop_id },
    { key: 'merge_backup', table: `${target}_property_merge_backup`, stampTable: `${target}_property_merge_backup`,
      idCol: 'backup_id',
      select: 'backup_id,kept_property_id,dropped_property_id,merged_at', filter: '&unmerged_at=is.null',
      keep: (r) => r.kept_property_id, drop: (r) => r.dropped_property_id },
  ];
  if (target === 'dia') {
    out.push({
      key: 'redirects', table: 'v_dia_property_redirect_resolved', stampTable: 'dia_property_redirects',
      idCol: 'redirect_id',
      select: 'redirect_id,dropped_property_id,final_survivor_id,merged_at',
      // A reversed redirect is an unmerge; a NULL final survivor is a broken
      // chain (the kept row is itself gone with no redirect) — neither is a
      // repoint target. They stay unstamped and are counted by the guard.
      filter: '&reversed_at=is.null&final_survivor_id=not.is.null',
      keep: (r) => r.final_survivor_id, drop: (r) => r.dropped_property_id,
    });
  }
  return out;
}

/** The unmerge ledger for a domain: backups restored but not yet followed through. */
export function unmergeSource(target) {
  return {
    key: 'unmerge', table: `${target}_property_merge_backup`, idCol: 'backup_id',
    select: 'backup_id,kept_property_id,dropped_property_id,unmerged_at',
    // Only backups whose forward repoint ran (reconciled_lcc_at): if it never
    // ran, no entity was moved and there is nothing to move back.
    filter: '&unmerged_at=not.is.null&reconciled_lcc_at=not.is.null&unmerge_reconciled_lcc_at=is.null',
    order: 'unmerged_at.asc',
    restore: (r) => r.dropped_property_id, from: (r) => r.kept_property_id,
  };
}

function rpcCount(res) {
  if (typeof res.data === 'number') return res.data;
  if (Array.isArray(res.data)) return Number(res.data[0] || 0);
  return Number(res.data || 0);
}

/**
 * Run the reconcile. Dependencies are injected so the loop is testable offline.
 *   domainQuery(dom, method, path, body) and opsQuery(method, path, body, headers)
 * return { ok, status, data, count }.
 */
export async function runMergeLogReconcile({ targets, limit, dryRun, domainQuery, opsQuery, now = () => new Date() }) {
  const result = { mode: dryRun ? 'dry_run' : 'apply', scanned: 0, patched: 0, unmerged_back: 0, by_domain: {} };

  for (const target of targets) {
    const dom = target === 'dia' ? 'dialysis' : 'government';
    const summary = { scanned: 0, patched: 0, unmerged_back: 0, log_rows_stamped: 0, by_source: {}, errors: [] };

    for (const src of forwardSources(target)) {
      const srcSum = { scanned: 0, patched: 0, stamped: 0 };
      summary.by_source[src.key] = srcSum;
      const listRes = await domainQuery(dom, 'GET',
        `${src.table}?reconciled_lcc_at=is.null${src.filter}&select=${src.select}&order=merged_at.asc&limit=${limit}`);
      if (!listRes.ok) {
        summary.errors.push({ stage: 'list', source: src.key, status: listRes.status, detail: listRes.data });
        continue;
      }
      const rows = Array.isArray(listRes.data) ? listRes.data : [];
      srcSum.scanned = rows.length; summary.scanned += rows.length; result.scanned += rows.length;

      for (const row of rows) {
        const rowId = row[src.idCol];
        const keepId = String(src.keep(row));
        const dropId = String(src.drop(row));
        let patched = 0;
        // entities.domain is canonical short-form (dia/gov); the long form is
        // kept for transition-era rows. Filtering on the long form alone
        // matched 0 of 1,972 dia assets.
        const countRes = await opsQuery('GET',
          `entities?entity_type=eq.asset&domain=in.(${target},${dom})` +
          `&or=(metadata->>domain_property_id.eq.${pgv(dropId)},` +
              `metadata->_pipeline_summary->>domain_property_id.eq.${pgv(dropId)})` +
          `&select=id&limit=1000`, null, { Prefer: 'count=exact' });
        if (!countRes.ok) {
          summary.errors.push({ stage: 'count', source: src.key, row_id: rowId, drop_id: dropId,
            status: countRes.status, detail: countRes.data });
          continue;
        }
        const expected = countRes.count ?? (Array.isArray(countRes.data) ? countRes.data.length : 0);
        if (dryRun || expected === 0) {
          patched = dryRun ? expected : 0;
        } else {
          const rpcRes = await opsQuery('POST', 'rpc/lcc_repoint_entity_property_id',
            { p_domain: dom, p_keep_id: keepId, p_drop_id: dropId });
          if (!rpcRes.ok) {
            summary.errors.push({ stage: 'repoint', source: src.key, row_id: rowId, drop_id: dropId,
              status: rpcRes.status, detail: rpcRes.data });
            continue;
          }
          patched = rpcCount(rpcRes);
        }
        srcSum.patched += patched; summary.patched += patched; result.patched += patched;

        if (!dryRun) {
          const stampRes = await domainQuery(dom, 'PATCH',
            `${src.stampTable}?${src.idCol}=eq.${pgv(rowId)}`,
            { reconciled_lcc_at: now().toISOString(), reconciled_lcc_count: patched });
          if (!stampRes.ok) {
            summary.errors.push({ stage: 'stamp', source: src.key, row_id: rowId, status: stampRes.status, detail: stampRes.data });
            continue;
          }
          srcSum.stamped += 1; summary.log_rows_stamped += 1;
        }
      }
    }

    // Unmerge follow-through.
    const un = unmergeSource(target);
    const unSum = { scanned: 0, moved_back: 0, stamped: 0 };
    summary.by_source[un.key] = unSum;
    const unRes = await domainQuery(dom, 'GET',
      `${un.table}?select=${un.select}${un.filter}&order=${un.order}&limit=${limit}`);
    if (!unRes.ok) {
      summary.errors.push({ stage: 'list', source: un.key, status: unRes.status, detail: unRes.data });
    } else {
      const rows = Array.isArray(unRes.data) ? unRes.data : [];
      unSum.scanned = rows.length; summary.scanned += rows.length; result.scanned += rows.length;
      for (const row of rows) {
        const rowId = row[un.idCol];
        const restoreId = String(un.restore(row));
        const fromId = String(un.from(row));
        let moved = 0;
        if (!dryRun) {
          const rpcRes = await opsQuery('POST', 'rpc/lcc_unrepoint_entity_property_id',
            { p_domain: dom, p_restore_id: restoreId, p_from_id: fromId });
          if (!rpcRes.ok) {
            summary.errors.push({ stage: 'unrepoint', source: un.key, row_id: rowId, restore_id: restoreId,
              status: rpcRes.status, detail: rpcRes.data });
            continue;
          }
          moved = rpcCount(rpcRes);
          const stampRes = await domainQuery(dom, 'PATCH', `${un.table}?${un.idCol}=eq.${pgv(rowId)}`,
            { unmerge_reconciled_lcc_at: now().toISOString(), unmerge_reconciled_lcc_count: moved });
          if (!stampRes.ok) {
            summary.errors.push({ stage: 'stamp', source: un.key, row_id: rowId, status: stampRes.status, detail: stampRes.data });
            continue;
          }
          unSum.stamped += 1; summary.log_rows_stamped += 1;
        }
        unSum.moved_back += moved; summary.unmerged_back += moved; result.unmerged_back += moved;
      }
    }

    result.by_domain[dom] = summary;
  }
  return result;
}

// ── Evidence rule for a link no ledger explains (the one-shot MERGELOG-GAP map)
//
// ev = {
//   redirectSurvivor: id | null   live survivor from the domain redirect ledger
//   ownLive:     [{ id, addressMatch }]  the entity's OWN other dia/gov asset
//                identities / domain_property_ids that still exist, and whether
//                that row's normalized address equals the entity's
//   addressHits: [id]  properties with the same normalized street + state
//   parcelHits:  [id]  properties whose parcel APN equals the entity's own
// }
// Returns { verdict: 'mapped'|'candidate'|'unknowable', kept_property_id, rule, candidates }.
// Two independent signals are required to map without a ledger; one signal is
// a candidate for a human. Co-located clinics make an address alone a guess.
export function classifyDanglingLink(ev) {
  const uniq = (a) => [...new Set((a || []).map(String))];
  const ownLive = (ev.ownLive || []).map((o) => ({ id: String(o.id), addressMatch: !!o.addressMatch }));
  const addressHits = uniq(ev.addressHits);
  const parcelHits = uniq(ev.parcelHits);
  const candidates = uniq([...ownLive.map((o) => o.id), ...addressHits, ...parcelHits]);

  if (ev.redirectSurvivor != null) {
    return { verdict: 'mapped', kept_property_id: String(ev.redirectSurvivor), rule: 'redirect_ledger', candidates };
  }
  const ownAddr = ownLive.filter((o) => o.addressMatch).map((o) => o.id);
  if (ownAddr.length === 1 && addressHits.every((h) => h === ownAddr[0])) {
    return { verdict: 'mapped', kept_property_id: ownAddr[0], rule: 'own_identity_and_address', candidates };
  }
  if (addressHits.length === 1 && parcelHits.includes(addressHits[0])
      && ownLive.every((o) => o.id === addressHits[0])) {
    return { verdict: 'mapped', kept_property_id: addressHits[0], rule: 'address_and_parcel', candidates };
  }
  if (candidates.length) return { verdict: 'candidate', kept_property_id: null, rule: 'single_signal_or_conflict', candidates };
  return { verdict: 'unknowable', kept_property_id: null, rule: 'no_evidence', candidates };
}
