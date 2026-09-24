// ============================================================================
// SIDEBAR-AGENCY-OVERWRITE (2026-09-24) — a sidebar Save must not downgrade an
// existing gov property's agency, address or dates.
//
// Measured live (Cowork round 75) on Saginaw gov 16297, forced re-run of LCC
// entity 6c85fe57…:
//   1. agency / agency_full_name went "Saginaw County Community Mental Health
//      Authority" → "Max System Of Care" (the CoStar tenant line, a program of
//      the Authority). ⚠️ NEITHER string resolves in gov_resolve_agency, and the
//      row carries no agency_id / agency_canonical — a registry-only guard would
//      not have protected this row. The rule is fill-blanks + registry upgrade.
//   2. address went "1040 N Towerline Rd" → "1040 n towerline rd" (the lookup key).
//   3. The capture's sales_history carried a bare `{ sale_date: "Sep 21, 2026" }`
//      (CoStar's "updated on" line). It became ownership_history.transfer_date
//      and properties.latest_deed_date = 2026-09-21. 13 live rows had this shape.
//   4. _pipeline_last_error = no_domain survived a successful run.
// Each test below is mutation-verified RED against the fix it names.
// ============================================================================

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import {
  upsertDomainProperty,
  decideGovAgencyWrite,
  shouldKeepExistingAddress,
  saleHistoryRowIsTransfer,
  clearStalePipelineErrorOnSuccess,
} from '../api/_handlers/sidebar-pipeline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api/_handlers/sidebar-pipeline.js'), 'utf8');
const originalFetch = global.fetch;
const ENV_KEYS = ['GOV_SUPABASE_URL', 'GOV_SUPABASE_KEY', 'OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  global.fetch = originalFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok, status,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

// The Saginaw capture, as stored on LCC entity 6c85fe57 (sales_history trimmed).
const SAGINAW_SALES = [
  { sale_date: 'Sep 21, 2026' },
  { buyer: 'JTS MANAGEMENT LLC', seller: 'STEVENSON SAGINAW LLC', deed_type: 'Warranty Deed',
    sale_date: '6/16/2016', sale_price: '$965,000', document_number: '2016.18278' },
  { deed_type: 'Deed', sale_date: '3/29/2002', sale_price: '$625,000' },
];

// Stub gov DB holding 16297's PRE-run row. `resolvable` = strings the stub
// registry resolves (default: none, which is the live truth for both strings).
function stubGov({ existing, resolvable = [] }) {
  process.env.GOV_SUPABASE_URL = 'https://gov.example.com';
  process.env.GOV_SUPABASE_KEY = 'k';
  process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
  process.env.OPS_SUPABASE_KEY = 'k';
  const log = { patches: [], rpc: [] };
  global.fetch = async (url, opts = {}) => {
    const u = decodeURIComponent(String(url));
    const m = opts.method || 'GET';
    if (!u.startsWith('https://gov.example.com')) return jsonResponse([]);
    if (m === 'POST' && u.includes('/rpc/gov_resolve_agency')) {
      const { p_text } = JSON.parse(opts.body || '{}');
      log.rpc.push(p_text);
      const hit = resolvable.includes(p_text);
      return jsonResponse([{ agency_id: hit ? 'a-1' : null, code: hit ? 'X' : null, status: hit ? 'matched' : 'unresolved' }]);
    }
    if (m === 'GET' && u.includes('/properties?property_id=eq.16297') && u.includes('select=address')) {
      return jsonResponse([existing]);
    }
    if (m === 'GET' && u.includes('/properties?address=ilike.')) {
      return jsonResponse([{ property_id: 16297, rba: 1800 }]);
    }
    if (m === 'PATCH' && u.includes('/properties?property_id=eq.16297')) {
      log.patches.push(JSON.parse(opts.body || '{}'));
      return jsonResponse([]);
    }
    return jsonResponse([]);
  };
  return log;
}

const SAGINAW_ENTITY = () => ({ address: '1040 N Towerline Rd', city: 'Saginaw', state: 'MI' });
const SAGINAW_META = () => ({
  tenant_name: 'Max System Of Care',
  tenants: [{ name: 'Max System Of Care', sf: '1,800 SF' }, { name: 'Crisis Intervention Service' }],
  sales_history: SAGINAW_SALES.map((s) => ({ ...s })),
});
const AUTHORITY = 'Saginaw County Community Mental Health Authority';
const EXISTING_16297 = {
  address: '1040 N Towerline Rd',
  agency: AUTHORITY, agency_full_name: AUTHORITY, agency_id: null, agency_canonical: null,
};

async function quiet(fn) {
  const w = console.warn; const l = console.log; const e = console.error;
  console.warn = () => {}; console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.log = l; console.error = e; }
}

describe('SIDEBAR-AGENCY-OVERWRITE: the Saginaw re-save, end to end through upsertDomainProperty', () => {
  it('keeps the Authority, keeps the stored address casing, and never mirrors the capture date as the deed date', async () => {
    const log = stubGov({ existing: EXISTING_16297 });
    const pid = await quiet(() => upsertDomainProperty('government', SAGINAW_ENTITY(), SAGINAW_META()));
    assert.equal(pid, 16297);
    assert.equal(log.patches.length, 1, 'one property PATCH');
    const patch = log.patches[0];
    assert.ok(!('agency' in patch), `agency must not be written (got ${patch.agency})`);
    assert.ok(!('agency_full_name' in patch), 'agency_full_name must not be written');
    assert.ok(!('government_type' in patch), 'government_type derived from the rejected tenant must not be written');
    assert.ok(!('address' in patch), `stored address must be kept (got ${patch.address})`);
    assert.equal(patch.latest_deed_date, '2016-06-16', 'the latest REAL transfer, not the 2026-09-21 capture date');
  });

  it('drops the government_type derived from a rejected tenant string', async () => {
    const meta = { ...SAGINAW_META(), tenant_name: 'State of Michigan Department of Corrections', tenants: [{ name: 'State of Michigan Department of Corrections' }] };
    const log = stubGov({ existing: EXISTING_16297 });
    await quiet(() => upsertDomainProperty('government', SAGINAW_ENTITY(), meta));
    assert.ok(!('agency' in log.patches[0]));
    assert.ok(!('government_type' in log.patches[0]), `government_type=${log.patches[0].government_type} came from the rejected tenant`);
  });

  it('still fills a BLANK agency from the capture', async () => {
    const log = stubGov({ existing: { ...EXISTING_16297, agency: null, agency_full_name: null } });
    await quiet(() => upsertDomainProperty('government', SAGINAW_ENTITY(), SAGINAW_META()));
    assert.equal(log.patches[0].agency, 'Max System Of Care');
  });

  it('upgrades an unresolved agency when the capture resolves in the registry', async () => {
    const meta = { ...SAGINAW_META(), tenant_name: 'Social Security Administration', tenants: [{ name: 'Social Security Administration' }] };
    const log = stubGov({ existing: EXISTING_16297, resolvable: ['Social Security Administration'] });
    await quiet(() => upsertDomainProperty('government', SAGINAW_ENTITY(), meta));
    assert.equal(log.patches[0].agency, 'Social Security Administration');
  });

  it('never replaces a registry-resolved agency (agency_id set) from a tenant line', async () => {
    const meta = { ...SAGINAW_META(), tenant_name: 'Social Security Administration', tenants: [{ name: 'Social Security Administration' }] };
    const log = stubGov({
      existing: { ...EXISTING_16297, agency: 'Department of Veterans Affairs', agency_full_name: 'Department of Veterans Affairs', agency_id: 'va' },
      resolvable: ['Social Security Administration', 'Department of Veterans Affairs'],
    });
    await quiet(() => upsertDomainProperty('government', SAGINAW_ENTITY(), meta));
    assert.ok(!('agency' in log.patches[0]));
  });

  it('does not write the agency over a row it could not read', async () => {
    const log = stubGov({ existing: undefined });
    global.fetch = ((inner) => async (url, opts = {}) => {
      if (decodeURIComponent(String(url)).includes('select=address')) return jsonResponse({ message: 'boom' }, false, 500);
      return inner(url, opts);
    })(global.fetch);
    await quiet(() => upsertDomainProperty('government', SAGINAW_ENTITY(), SAGINAW_META()));
    assert.ok(!('agency' in log.patches[0]));
  });
});

describe('SIDEBAR-AGENCY-OVERWRITE: pure rules', () => {
  it('decideGovAgencyWrite', () => {
    assert.equal(decideGovAgencyWrite({ existingAgency: AUTHORITY, existingResolved: false, incomingAgency: 'Max System Of Care', incomingResolved: false }).write, false);
    assert.equal(decideGovAgencyWrite({ existingAgency: null, incomingAgency: 'Max System Of Care' }).write, true);
    assert.equal(decideGovAgencyWrite({ existingAgency: 'ssa', incomingAgency: 'SSA ' }).write, true);
    assert.equal(decideGovAgencyWrite({ existingAgency: 'X', existingResolved: false, incomingAgency: 'SSA', incomingResolved: true }).write, true);
    assert.equal(decideGovAgencyWrite({ existingAgency: 'VA', existingResolved: true, incomingAgency: 'SSA', incomingResolved: true }).write, false);
    assert.equal(decideGovAgencyWrite({ existingAgency: 'X', existingResolved: null, incomingAgency: 'Y', incomingResolved: null }).write, false,
      'could-not-check is not a resolution');
  });

  it('shouldKeepExistingAddress keeps same-place display text, not a different street', () => {
    assert.equal(shouldKeepExistingAddress('1040 N Towerline Rd', '1040 n towerline rd'), true);
    assert.equal(shouldKeepExistingAddress('1050 N Towerline Rd', '1040 n towerline rd'), false);
    assert.equal(shouldKeepExistingAddress(null, '1040 n towerline rd'), false);
  });

  it('saleHistoryRowIsTransfer: a bare date is not a transfer; any sale/deed fact is', () => {
    assert.equal(saleHistoryRowIsTransfer({ sale_date: 'Sep 21, 2026' }), false);
    assert.equal(saleHistoryRowIsTransfer({ sale_date: 'Sep 21, 2026', sale_price: '' }), false);
    assert.equal(saleHistoryRowIsTransfer({ sale_date: 'Sep 17, 2026', sale_type: '1031 Exchange, Build to Suit' }), false,
      'a stat-card sale_type beside the capture date is not a transfer (live: gov 1302)');
    assert.equal(saleHistoryRowIsTransfer({ sale_date: 'Sep 21, 2026', sale_type: 'Investment Triple Net', cap_rate: '6.5%' }), false);
    assert.equal(saleHistoryRowIsTransfer({ sale_date: '6/16/2016', buyer: 'JTS' }), true);
    assert.equal(saleHistoryRowIsTransfer({ sale_date: '3/29/2002', sale_price: '$625,000' }), true);
    assert.equal(saleHistoryRowIsTransfer({ sale_date: '3/29/2002', deed_type: 'Deed' }), true);
    assert.equal(saleHistoryRowIsTransfer({ buyer: 'JTS' }), false, 'no date, no transfer date');
    assert.equal(saleHistoryRowIsTransfer({ sale_date: 'Aug 13, 2026', sale_type: 'Investment', sale_price: 'Not Disclosed',
      comp_status: 'In Progress', hold_period: '117 Months' }), true, 'an undisclosed-price CoStar comp is a real sale (live: gov 6905)');
  });
});

describe('SIDEBAR-AGENCY-OVERWRITE: date-only rows are filtered at every "most recent sale" pick', () => {
  // Every `.filter(...)` whose callback returns `s.sale_date` alone would pick
  // the capture-date stub. The buyer-gated chain filter is allowed.
  it('no most-recent-sale pick filters on sale_date alone', () => {
    const offenders = [];
    for (const m of SRC.matchAll(/\.filter\(\s*s\s*=>\s*(?:s\s*&&\s*)?s\.sale_date\s*(\)|&&)/g)) {
      const tail = SRC.slice(m.index, m.index + 160);
      if (/s\.sale_date\s*&&\s*s\.buyer/.test(tail)) continue;
      offenders.push(SRC.slice(0, m.index).split('\n').length);
    }
    assert.deepEqual(offenders, [], `date-only sale filters at lines ${offenders.join(', ')}`);
  });
});

describe('SIDEBAR-AGENCY-OVERWRITE: a successful run clears the last failed run\'s error', () => {
  it('clearStalePipelineErrorOnSuccess clears only on success', () => {
    const m1 = { _pipeline_status: 'success', _pipeline_last_error: 'no_domain', _pipeline_last_error_detail: 'x', _pipeline_last_error_stack: 'y', keep: 1 };
    clearStalePipelineErrorOnSuccess(m1, true);
    assert.deepEqual(m1, { _pipeline_status: 'success', keep: 1 });
    const m2 = { _pipeline_last_error: 'no_domain' };
    clearStalePipelineErrorOnSuccess(m2, false);
    assert.equal(m2._pipeline_last_error, 'no_domain');
  });

  it('the run-finalize PATCH is preceded by the clear, on the same updatedMeta', () => {
    const ast = acorn.parse(SRC, { ecmaVersion: 'latest', sourceType: 'module' });
    let found = false;
    (function walk(node) {
      if (!node || typeof node !== 'object' || found) return;
      if (Array.isArray(node.body)) {
        const body = node.body;
        const iDecl = body.findIndex((s) => s.type === 'VariableDeclaration'
          && s.declarations.some((d) => d.id?.name === 'updatedMeta'));
        if (iDecl >= 0) {
          const later = body.slice(iDecl + 1).map((s) => SRC.slice(s.start, s.end));
          const iClear = later.findIndex((t) => /clearStalePipelineErrorOnSuccess\(\s*updatedMeta\s*,\s*propagation\.propagated\s*\)/.test(t));
          const iPatch = later.findIndex((t) => /metadata:\s*updatedMeta/.test(t));
          if (iClear >= 0 && iPatch > iClear) found = true;
        }
      }
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (v && typeof v === 'object') Array.isArray(v) ? v.forEach(walk) : walk(v);
      }
    })(ast);
    assert.ok(found, 'clearStalePipelineErrorOnSuccess(updatedMeta, propagation.propagated) must run before the metadata PATCH');
  });
});
