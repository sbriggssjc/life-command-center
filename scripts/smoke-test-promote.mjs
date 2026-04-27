#!/usr/bin/env node
// ============================================================================
// smoke-test-promote.mjs - verify the promote endpoint is healthy before
//   running the bulk backlog recovery.
//
// Three checks, in order:
//   1. /api/intake?_route=queue  - proves auth + workspace + the column fix
//   2. /api/intake?_route=promote with a known stalled intake_id
//   3. Print a green/red summary
//
// Reads from env: LCC_API_KEY + LCC_BASE_URL + LCC_WORKSPACE_ID.
// Run via .\scripts\Run-IntakeRecovery.ps1 -Mode SmokeSafe (or -Mode Smoke).
// ============================================================================

// 209 Highland Ave / DaVita Waterbury / $2.79M / 6.65% cap rate.
// LCC entity d99d8080... -> dia_db property_id 24526.
const TEST_INTAKE_ID = 'aa2403e9-4d06-4a7f-ac1c-6560777a0143';

// Config from env
const API_KEY     = process.env.LCC_API_KEY;
let   BASE_URL    = (process.env.LCC_BASE_URL || '').replace(/\/+$/, '');
if (BASE_URL && !/^https?:\/\//.test(BASE_URL)) BASE_URL = 'https://' + BASE_URL;
const WORKSPACE_ID = process.env.LCC_WORKSPACE_ID
                  || process.env.LCC_DEFAULT_WORKSPACE_ID
                  || 'a0000000-0000-0000-0000-000000000001';
const SAFE = process.env.SAFE === '1' || process.env.SAFE === 'true';

if (!API_KEY)  { console.error('Missing LCC_API_KEY env var.');  process.exit(1); }
if (!BASE_URL) { console.error('Missing LCC_BASE_URL env var.'); process.exit(1); }

const HDRS = {
  'Content-Type':    'application/json',
  'X-LCC-Key':       API_KEY,
  'X-LCC-Workspace': WORKSPACE_ID,
};

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED   = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM   = (s) => `\x1b[2m${s}\x1b[0m`;

let pass = 0, fail = 0;
const fails = [];

function check(name, ok, detail = '') {
  if (ok) { console.log(`  ${GREEN('PASS')} ${name}${detail ? DIM(' - ' + detail) : ''}`); pass++; }
  else    { console.log(`  ${RED('FAIL')} ${name}${detail ? ' - ' + detail : ''}`);       fail++; fails.push({ name, detail }); }
}

console.log(`Smoke test -> ${BASE_URL}`);
console.log(`Workspace : ${WORKSPACE_ID}`);
console.log(`Mode      : ${SAFE ? 'SAFE (read-only)' : 'LIVE (will re-promote 1 intake)'}`);
console.log('');

// Test 1: /api/intake?_route=queue
console.log('Test 1: /api/intake?_route=queue (validates auth + workspace + column-fix deploy)');
try {
  const r = await fetch(`${BASE_URL}/api/intake?_route=queue&limit=3`, { headers: HDRS });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  check('HTTP 200',         r.status === 200,                     `got HTTP ${r.status}`);
  check('Returns array',    Array.isArray(body?.items || body),   `body keys: ${Object.keys(body || {}).join(',')}`);
  const items = body?.items || (Array.isArray(body) ? body : []);
  check('At least 1 row',   items.length > 0,                     `got ${items.length} rows`);
  if (items[0]) {
    check('Has subject field', 'source_email_subject' in items[0],
      `subject="${String(items[0].source_email_subject || '').slice(0, 40)}"`);
  }
  // Always dump response body when test fails so we see PostgREST detail
  if (r.status !== 200 || items.length === 0) {
    console.log('  --- response body ---');
    console.log('  ' + JSON.stringify(body, null, 2).split('\n').join('\n  '));
    console.log('  --- end response body ---');
  }
} catch (err) {
  check('queue endpoint reachable', false, err.message);
}

// Test 2: /api/intake?_route=promote
console.log('\nTest 2: /api/intake?_route=promote (validates the column fix on the promote handler)');
if (SAFE) {
  console.log('  ' + DIM('SAFE mode - skipping the actual POST. Only the queue test ran.'));
} else {
  try {
    const r = await fetch(`${BASE_URL}/api/intake?_route=promote`, {
      method:  'POST',
      headers: HDRS,
      body:    JSON.stringify({ intake_id: TEST_INTAKE_ID }),
    });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
    check('HTTP 200',                          r.status === 200,                                                     `got HTTP ${r.status}`);
    check('No "Intake item not found" error',  body?.error !== 'Intake item not found',                              body?.error || 'no error');
    check('Returned ok=true',                  body?.ok === true,                                                    `body.ok=${body?.ok}`);
    check('Has domain match',                  body?.domain === 'dialysis' || body?.domain === 'government',         `domain=${body?.domain || '?'} property_id=${body?.domain_property_id || '?'}`);
    check('Propagated to domain',              body?.propagated === true,                                            `propagated=${body?.propagated}`);
    if (r.status !== 200 || body?.propagated === false) {
      console.log('  --- response body ---');
      console.log('  ' + JSON.stringify(body, null, 2).split('\n').join('\n  '));
      console.log('  --- end response body ---');
    }
  } catch (err) {
    check('promote endpoint reachable', false, err.message);
  }
}

// Summary
console.log('\n--- Summary ---');
console.log(`Passed: ${GREEN(pass)}`);
console.log(`Failed: ${fail > 0 ? RED(fail) : fail}`);
if (fail > 0) {
  console.log('\nFailures:');
  fails.forEach(f => console.log('  ' + JSON.stringify(f)));
  console.log('\nDeploy not ready. Do NOT run the bulk recovery script yet.');
  process.exit(1);
} else {
  console.log('\n' + GREEN('Deploy is healthy.') + ' Safe to run:');
  console.log('  .\\scripts\\Run-IntakeRecovery.ps1 -Mode Recover');
  process.exit(0);
}
