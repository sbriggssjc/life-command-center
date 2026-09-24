// MERGELOG-GAP (2026-09-24) — LCC asset entities pointing at dia/gov
// properties that no longer exist.
//
// Three guarantees, each positive-controlled by a mutation (see STATUS entry):
//   1. mapping only on evidence — classifyDanglingLink maps on a merge ledger or
//      on TWO independent signals, never on an address alone; replayed here on
//      the exact evidence behind supabase/migrations/20261102340000_*.sql, and
//      the migration's verdict list must equal the classifier's output.
//   2. unmerge moves entities back — runMergeLogReconcile calls
//      lcc_unrepoint_entity_property_id(restore = dropped, from = kept) for every
//      restored backup and stamps unmerge_reconciled_lcc_at; the SQL helper only
//      moves entities whose _round_76ee_prev_property_id names the restored id.
//   3. the guard fires — lcc_dangling_asset_links_should_alert is true only on a
//      complete census whose count rose; the check alerts through it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyDanglingLink, forwardSources, unmergeSource, runMergeLogReconcile,
} from '../api/_shared/merge-log-reconcile.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlNoComments = (f) => readFileSync(join(ROOT, 'supabase', 'migrations', f), 'utf8').replace(/--[^\n]*/g, '');

// ── 1. Mapping only on evidence ─────────────────────────────────────────────
// Evidence measured live 2026-09-24. own = the entity's other asset ids that
// still exist, with whether that row's normalized address equals the entity's.
const EVIDENCE = [
  // domain, dropped, redirect, own, addressHits, parcelHits, expected verdict, expected kept
  ['dia', '51217', 25383, [], [25383], [], 'mapped', '25383'],
  ['dia', '51227', 23405, [], [23405], [], 'mapped', '23405'],
  ['dia', '51230', 33706, [], [33706], [], 'mapped', '33706'],
  ['dia', '51232', 31514, [], [31514], [], 'mapped', '31514'],
  ['dia', '51239', 51238, [{ id: 51238, addressMatch: true }], [51238], [], 'mapped', '51238'],
  ['dia', '51250', 25336, [], [25336], [], 'mapped', '25336'],
  ['dia', '37597', null, [{ id: 28953, addressMatch: true }], [28953], [], 'mapped', '28953'],
  ['dia', '46080', null, [{ id: 37106, addressMatch: true }], [37106], [], 'mapped', '37106'],
  ['dia', '51192', null, [{ id: 51191, addressMatch: true }], [51191], [], 'mapped', '51191'],
  ['dia', '45395', null, [], [25203], [25203], 'mapped', '25203'],
  ['dia', '51180', null, [], [22331], [22331], 'mapped', '22331'],
  ['dia', '2776955', null, [], [26656], [26656], 'mapped', '26656'],
  ['dia', '3005557', null, [], [27006], [27006], 'mapped', '27006'],
  ['gov', '16572', null, [], [1945], [1945], 'mapped', '1945'],
  ['gov', '23324', null, [], [1203], [1203], 'mapped', '1203'],
  ['gov', '23431', null, [], [5592], [5592], 'mapped', '5592'],
  ['gov', '23447', null, [], [7578], [7578], 'mapped', '7578'],
  ['gov', '32026', null, [{ id: 8074, addressMatch: true }], [8074], [8074], 'mapped', '8074'],
  ['dia', '27725', null, [], [45194], [], 'candidate', null],
  ['dia', '28020', null, [], [37622], [], 'candidate', null],
  ['dia', '31513', null, [], [37744], [], 'candidate', null],
  ['dia', '35430', null, [], [26729], [], 'candidate', null],
  ['dia', '35557', null, [], [37636], [], 'candidate', null],
  ['dia', '35593', null, [], [27815], [], 'candidate', null],
  ['dia', '37613', null, [], [23551], [], 'candidate', null],
  ['dia', '37643', null, [], [23872], [], 'candidate', null],
  ['dia', '37724', null, [], [23007], [], 'candidate', null],
  ['dia', '45536', null, [], [37732], [], 'candidate', null],
  ['dia', '45555', null, [], [27288], [], 'candidate', null],
  ['dia', '36851', null, [{ id: 37545, addressMatch: false }], [29507], [], 'candidate', null],
  ['dia', '36922', null, [{ id: 37519, addressMatch: true }], [35599], [], 'candidate', null],
  ['dia', '37618', null, [{ id: 37558, addressMatch: true }], [26495], [], 'candidate', null],
  ...['15243', '24622', '26734', '28360', '28427', '29092', '29100', '30300', '30444', '30828', '33738',
    '37480', '37482', '37734', '39924', '39931', '39958', '2051464', '2140657', '3230009']
    .map((id) => ['dia', id, null, [], [], [], 'unknowable', null]),
];

const classify = ([, , redirectSurvivor, ownLive, addressHits, parcelHits]) =>
  classifyDanglingLink({ redirectSurvivor, ownLive, addressHits, parcelHits });

test('the measured evidence classifies to 18 mapped / 14 candidate / 20 unknowable', () => {
  const counts = { mapped: 0, candidate: 0, unknowable: 0 };
  for (const row of EVIDENCE) {
    const got = classify(row);
    assert.equal(got.verdict, row[6], `${row[0]} ${row[1]}: ${got.rule}`);
    assert.equal(got.kept_property_id, row[7], `${row[0]} ${row[1]} kept`);
    counts[got.verdict] += 1;
  }
  assert.deepEqual(counts, { mapped: 18, candidate: 14, unknowable: 20 });
});

test('an address alone never maps — co-located clinics make it a guess', () => {
  const r = classifyDanglingLink({ redirectSurvivor: null, ownLive: [], addressHits: [45194], parcelHits: [] });
  assert.equal(r.verdict, 'candidate');
  assert.equal(r.kept_property_id, null);
});

test('two signals naming different rows is a candidate, not a pick', () => {
  const r = classifyDanglingLink({ redirectSurvivor: null,
    ownLive: [{ id: 37519, addressMatch: true }], addressHits: [35599], parcelHits: [] });
  assert.equal(r.verdict, 'candidate');
  assert.deepEqual(r.candidates.sort(), ['35599', '37519']);
});

test('a parcel match on a DIFFERENT row than the address hit does not map', () => {
  const r = classifyDanglingLink({ redirectSurvivor: null, ownLive: [], addressHits: [100], parcelHits: [200] });
  assert.equal(r.verdict, 'candidate');
});

test('the migration applies exactly the classifier verdicts', () => {
  const sql = sqlNoComments('20261102340000_lcc_mergelog_gap_resolve_dangling_asset_links.sql');
  const rows = [...sql.matchAll(/\('(dia|gov)','(\d+)','(mapped|candidate|unknowable)',(?:'(\d+)'|null),'([a-z_]+)'/g)]
    .map((m) => ({ domain: m[1], dropped: m[2], verdict: m[3], kept: m[4] || null, rule: m[5] }));
  assert.equal(rows.length, EVIDENCE.length, 'population control: every evidence row is in the migration');
  for (const row of EVIDENCE) {
    const got = classify(row);
    const m = rows.find((r) => r.domain === row[0] && r.dropped === row[1]);
    assert.ok(m, `${row[0]} ${row[1]} missing from migration`);
    assert.equal(m.verdict, got.verdict, `${row[1]} verdict`);
    assert.equal(m.kept, got.kept_property_id, `${row[1]} kept`);
    assert.equal(m.rule, got.rule, `${row[1]} rule`);
  }
});

// ── 2. The reconcile reads every ledger and follows unmerges ────────────────
test('dia reads dia_property_redirects through the chain-resolving view; gov has no redirect ledger', () => {
  const dia = forwardSources('dia').find((s) => s.key === 'redirects');
  assert.ok(dia, 'dia must read the redirect ledger (the geospatial cron writes nothing else)');
  assert.equal(dia.table, 'v_dia_property_redirect_resolved');
  assert.equal(dia.stampTable, 'dia_property_redirects');
  assert.match(dia.filter, /reversed_at=is\.null/);
  assert.match(dia.filter, /final_survivor_id=not\.is\.null/);
  assert.equal(dia.keep({ final_survivor_id: 9, recorded_survivor_id: 8 }), 9);
  assert.equal(forwardSources('gov').find((s) => s.key === 'redirects'), undefined);
});

function fakeDeps({ backups = [], redirects = [] } = {}) {
  const calls = { rpc: [], patches: [] };
  const domainQuery = async (dom, method, path, body) => {
    if (method === 'PATCH') { calls.patches.push({ dom, path, body }); return { ok: true, data: [] }; }
    if (path.includes('unmerged_at=not.is.null')) return { ok: true, data: backups };
    if (path.startsWith('v_dia_property_redirect_resolved')) return { ok: true, data: redirects };
    return { ok: true, data: [] };
  };
  const opsQuery = async (method, path, body) => {
    if (method === 'POST') { calls.rpc.push({ path, body }); return { ok: true, data: 1 }; }
    return { ok: true, data: [{ id: 'e1' }], count: 1 };
  };
  return { calls, domainQuery, opsQuery };
}

test('an unmerged backup moves entities back to the restored id and is stamped', async () => {
  const { calls, domainQuery, opsQuery } = fakeDeps({
    backups: [{ backup_id: 42, kept_property_id: 100, dropped_property_id: 200, unmerged_at: '2026-09-24T00:00:00Z' }],
  });
  const res = await runMergeLogReconcile({ targets: ['gov'], limit: 10, dryRun: false, domainQuery, opsQuery,
    now: () => new Date('2026-09-24T12:00:00Z') });
  const un = calls.rpc.find((c) => c.path === 'rpc/lcc_unrepoint_entity_property_id');
  assert.ok(un, 'the unrepoint rpc must be called');
  assert.deepEqual(un.body, { p_domain: 'government', p_restore_id: '200', p_from_id: '100' });
  const stamp = calls.patches.find((p) => p.path === 'gov_property_merge_backup?backup_id=eq.42');
  assert.ok(stamp);
  assert.equal(stamp.body.unmerge_reconciled_lcc_at, '2026-09-24T12:00:00.000Z');
  assert.equal(stamp.body.unmerge_reconciled_lcc_count, 1);
  assert.equal(res.unmerged_back, 1);
});

test('the unmerge pass only reads restored backups whose forward repoint ran', () => {
  const u = unmergeSource('dia');
  assert.match(u.filter, /unmerged_at=not\.is\.null/);
  assert.match(u.filter, /reconciled_lcc_at=not\.is\.null/);
  assert.match(u.filter, /unmerge_reconciled_lcc_at=is\.null/);
});

test('a dry run moves nothing back and stamps nothing', async () => {
  const { calls, domainQuery, opsQuery } = fakeDeps({
    backups: [{ backup_id: 42, kept_property_id: 100, dropped_property_id: 200 }],
  });
  await runMergeLogReconcile({ targets: ['dia'], limit: 10, dryRun: true, domainQuery, opsQuery });
  assert.equal(calls.rpc.length, 0);
  assert.equal(calls.patches.length, 0);
});

test('a redirect repoints to the chain-resolved survivor and stamps the base table', async () => {
  const { calls, domainQuery, opsQuery } = fakeDeps({
    redirects: [{ redirect_id: 7, dropped_property_id: 51217, final_survivor_id: 25383 }],
  });
  await runMergeLogReconcile({ targets: ['dia'], limit: 10, dryRun: false, domainQuery, opsQuery });
  const rp = calls.rpc.find((c) => c.path === 'rpc/lcc_repoint_entity_property_id');
  assert.deepEqual(rp.body, { p_domain: 'dialysis', p_keep_id: '25383', p_drop_id: '51217' });
  assert.ok(calls.patches.some((p) => p.path === 'dia_property_redirects?redirect_id=eq.7'));
});

test('the unrepoint SQL moves back only entities the forward repoint moved off the restored id', () => {
  const sql = sqlNoComments('20261102330000_lcc_mergelog_gap_dangling_asset_links.sql');
  const i = sql.indexOf('FUNCTION public.lcc_unrepoint_entity_property_id');
  const j = sql.indexOf('$function$;', i);
  const body = sql.slice(i, j);
  assert.match(body, /e\.metadata->>'_round_76ee_prev_property_id'\s*=\s*p_restore_id/);
  assert.match(body, /e\.domain\s+IN\s*\(\s*v_short\s*,\s*v_long\s*\)/);
});

// ── 3. The guard fires on a rise, only on a complete census ─────────────────
function shouldAlertExpr() {
  const sql = sqlNoComments('20261102330000_lcc_mergelog_gap_dangling_asset_links.sql');
  const m = sql.match(/FUNCTION public\.lcc_dangling_asset_links_should_alert\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/);
  assert.ok(m, 'should_alert must exist');
  return m[1];
}
// Evaluate the SQL predicate by translating its four clauses; any drift in the
// shape fails the translation rather than silently passing.
function evalShouldAlert(expr, complete, dangling, prev) {
  const norm = expr.replace(/\s+/g, ' ').trim();
  const expected = "SELECT coalesce(p_complete, false) AND p_dangling IS NOT NULL AND p_prev IS NOT NULL AND p_dangling > p_prev;";
  assert.equal(norm, expected, 'should_alert predicate changed shape — re-grade the guard');
  return !!complete && dangling != null && prev != null && dangling > prev;
}

test('the guard fires when the dangling count rises on a complete census', () => {
  const e = shouldAlertExpr();
  assert.equal(evalShouldAlert(e, true, 49, 48), true);
  assert.equal(evalShouldAlert(e, true, 48, 48), false, 'flat is not a rise');
  assert.equal(evalShouldAlert(e, true, 47, 48), false);
  assert.equal(evalShouldAlert(e, false, 900, 48), false, 'a partial census never alerts');
  assert.equal(evalShouldAlert(e, true, 48, null), false, 'the first measurement is a baseline');
});

test('the check alerts through should_alert and refuses a partial census', () => {
  const sql = sqlNoComments('20261102330000_lcc_mergelog_gap_dangling_asset_links.sql');
  const i = sql.indexOf('FUNCTION public.lcc_check_dangling_asset_links');
  const body = sql.slice(i, sql.indexOf('$function$;', i));
  assert.match(body, /IF public\.lcc_dangling_asset_links_should_alert\(v_complete, v_dang, v_prev\) THEN/);
  assert.match(body, /INSERT INTO public\.lcc_health_alerts[\s\S]*'dangling_asset_property_links'/);
  // completeness: all pages 200, paged past the end, and a live-id floor (the
  // dia census answered 200 [] to anon — only the floor caught it).
  assert.match(body, /v_ok = v_fired AND coalesce\(v_last_empty, false\) AND v_live >= 1000/);
  // prev is read from COMPLETE rows only, or one bad night resets the baseline.
  assert.match(body, /WHERE g\.domain = v_dom AND g\.complete/);
});

test('both guard crons are scheduled', () => {
  const sql = sqlNoComments('20261102330000_lcc_mergelog_gap_dangling_asset_links.sql');
  assert.match(sql, /cron\.schedule\('lcc-asset-link-census-fetch'/);
  assert.match(sql, /cron\.schedule\('lcc-dangling-asset-links-check'/);
});
