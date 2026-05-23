// scripts/audit/verify-foundations.mjs
//
// Post-apply smoke test for Week 0 foundations (F1, F2, F4) of the
// OWNERSHIP_AND_SALES_REMEDIATION_PLAN. Run AFTER applying the
// 20260523120000_* migrations. Verifies:
//
//   LCC Opps:  audit_run_log table exists; audit_run_begin /
//              audit_run_finish / record_cleanup_provenance callable.
//   dia:       sales_transactions has transaction_state / dedup_group_id /
//              dedup_natural_key; ownership_history has ownership_state;
//              cap_rate_bands has 7 seeded rows; v_data_health_* readable.
//   gov:       same as dia.
//
// Exits non-zero on any check failure so it can gate the rollout in CI.
//
// Usage:
//   node scripts/audit/verify-foundations.mjs
//   node scripts/audit/verify-foundations.mjs --domain dia    (single domain)

import { getClients, makeRunId } from './run-helper.mjs';

const args = new Set(process.argv.slice(2));
const onlyDomain = (() => {
  const idx = process.argv.indexOf('--domain');
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

let failures = 0;
function check(label, cond, detail = '') {
  const ok = !!cond;
  console.log(`${ok ? 'OK ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures += 1;
}

async function verifyDomain(client, label) {
  console.log(`\n=== ${label} ===`);

  // Sales-side columns
  const sales = await client.rest(
    'GET',
    'sales_transactions?select=transaction_state,dedup_group_id,dedup_natural_key&limit=1',
  );
  check(`${label}: sales_transactions.transaction_state exists`, Array.isArray(sales));
  if (Array.isArray(sales) && sales.length) {
    const row = sales[0];
    check(`${label}: transaction_state populated`, row.transaction_state != null,
      `got ${JSON.stringify(row.transaction_state)}`);
  }

  // Ownership-side column
  const oh = await client.rest(
    'GET',
    'ownership_history?select=ownership_state&limit=1',
  );
  check(`${label}: ownership_history.ownership_state exists`, Array.isArray(oh));

  // cap_rate_bands seed
  const bands = await client.rest(
    'GET',
    'cap_rate_bands?select=asset_class,min_pct,max_pct&order=asset_class.asc',
  );
  check(`${label}: cap_rate_bands has 7 seed rows`,
    Array.isArray(bands) && bands.length >= 7,
    `count=${Array.isArray(bands) ? bands.length : 'n/a'}`);

  const defaultBand = (bands || []).find((r) => r.asset_class === 'default');
  check(`${label}: cap_rate_bands has default band`, !!defaultBand,
    defaultBand ? `${defaultBand.min_pct}-${defaultBand.max_pct}` : 'missing');

  // v_data_health views
  for (const view of ['v_data_health_sales', 'v_data_health_ownership', 'v_data_health_entities']) {
    const rows = await client.rest('GET', `${view}?select=*`);
    check(`${label}: ${view} readable`, Array.isArray(rows) && rows.length === 1,
      Array.isArray(rows) ? `rows=${rows.length}` : 'unreadable');
  }

  // cap_rate_band_for() RPC
  const bandFor = await client.rpc('cap_rate_band_for', { p_asset_class: 'medical_office' });
  check(`${label}: cap_rate_band_for('medical_office') returns a band`,
    Array.isArray(bandFor) && bandFor.length === 1
      && Number(bandFor[0].min_pct) === 0.05 && Number(bandFor[0].max_pct) === 0.08);
}

async function verifyOps(client) {
  console.log('\n=== lcc_opps ===');

  // Open a tiny dry-run row to exercise the helper functions.
  const runId = makeRunId('FOUNDATION_VERIFY');
  const [openRow] = await client.rpc('audit_run_begin', {
    p_run_id: runId,
    p_step: 'foundation_smoke_test',
    p_target_database: 'lcc_opps',
    p_dry_run: true,
    p_notes: 'verify-foundations.mjs',
    p_metadata: { smoke: true },
  });
  const logId = openRow && typeof openRow === 'object'
    ? (openRow.log_id ?? openRow.audit_run_begin)
    : openRow;
  check('lcc_opps: audit_run_begin returned log_id', logId != null);

  await client.rpc('audit_run_finish', {
    p_log_id: logId,
    p_status: 'succeeded',
    p_rows_affected: 0,
    p_rows_after: 0,
    p_error: null,
  });
  check('lcc_opps: audit_run_finish callable', true);

  // record_cleanup_provenance smoke (writes a single field_provenance row).
  await client.rpc('record_cleanup_provenance', {
    p_run_id: runId,
    p_target_database: 'lcc_opps',
    p_target_table: 'audit_run_log',
    p_record_pk: String(logId),
    p_field_name: '__smoke__',
    p_new_value: { hello: 'world' },
    p_decision_reason: 'foundation_verify',
    p_confidence: 0.99,
  });
  check('lcc_opps: record_cleanup_provenance callable', true);

  // Spot-check the row landed.
  const provRow = await client.rest(
    'GET',
    `field_provenance?source_run_id=eq.${encodeURIComponent(runId)}&select=field_name,source`,
  );
  check('lcc_opps: provenance row visible',
    Array.isArray(provRow) && provRow.length >= 1
      && provRow[0].source === `cleanup_run_${runId}`);
}

async function main() {
  const wantDia = !onlyDomain || onlyDomain === 'dia';
  const wantGov = !onlyDomain || onlyDomain === 'gov';
  const wantOps = !onlyDomain || onlyDomain === 'ops';

  const { ops, dia, gov } = getClients({ requireDia: wantDia, requireGov: wantGov });

  if (wantOps) await verifyOps(ops);
  if (wantDia && dia) await verifyDomain(dia, 'dia');
  if (wantGov && gov) await verifyDomain(gov, 'gov');

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verify-foundations.mjs failed:', err);
  process.exit(2);
});
