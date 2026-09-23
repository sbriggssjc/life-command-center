// GOV-CU1 (2026-09-23) — "Federal Credit Union" is a private lender, not a government tenant.
//
// Live: 705 gov properties carried a credit-union agency, every one government_type='Federal';
// 17 sat on the gov Available list. Every gov classifier read the word "federal" (and the gov
// DB's rule also read "navy" and "national"). The fix is ONE strip rule —
// api/_shared/private-financial-names.js, its Deno mirror, and gov DB
// gov_strip_private_financial_names() — applied before each classifier's gov test.
//
// Each lender spelling must classify NON-gov through every router we run, while the real
// agencies that share its vocabulary stay gov. Every assertion here was seen RED against the
// pre-fix code (mutation notes inline).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.DIA_SUPABASE_URL = 'https://dia.test.local';
process.env.DIA_SUPABASE_KEY = 'dia-key';
process.env.GOV_SUPABASE_URL = 'https://gov.test.local';
process.env.GOV_SUPABASE_KEY = 'gov-key';

const js = await import('../api/_shared/private-financial-names.js');
const ts = await import('../supabase/functions/_shared/private-financial-names.ts');
const { classifyDomain } = await import('../api/_handlers/sidebar-pipeline.js');
const { governmentCreditBuckets } = await import('../api/_shared/gov-credit-tier.js');
const { classifyVertical } = await import('../api/_shared/sf-nm-classifier.js');
const { routeVertical } = await import('../supabase/functions/intake-salesforce/sf-config.ts');
const { pickDomainForTenant } = await import('../api/_handlers/intake-create-property.js');

// Every spelling seen live on the gov Available list / properties, plus the thrift and
// farm-credit shapes the rule covers.
const PRIVATE_LENDERS = [
  'Navy Federal Credit Union',
  'NAVY FEDERAL CREDIT UNION',
  'Chartway Federal Credit Union',
  'Digital Federal Credit Union',
  'First Technology Federal Credit Union',
  'Langley Federal Credit Union',
  'Mission Federal Credit Union',
  'Neches Federal Credit Union',
  'Truliant Federal Credit Union',
  'University Federal Credit Union',
  'Pentagon FCU',
  'First Federal Savings & Loan Association',
  'Third Federal Savings & Loan',
  'Third Federal Savings and Loan',
  'Home Federal Savings Bank',
  'Third Federal Bank',
  'Farm Credit Services of America',
  'AgFirst Farm Credit Bank',
];

// Real agencies whose names share the lenders' vocabulary.
const AGENCIES = [
  'Federal Bureau of Investigation',
  'Federal Aviation Administration',
  'AOC/Federal Bankruptcy Court', // live gov sale; "federal bank" must stay word-bounded
];

const sidebar = (tenant) => classifyDomain({ tenant_name: tenant }, {});
const creditHasFederal = (tenant) =>
  governmentCreditBuckets({ agency: tenant }).some((b) => b.bucket === 'federal');

describe('GOV-CU1 strip rule', () => {
  it('removes every private-lender spelling entirely', () => {
    for (const name of PRIVATE_LENDERS) {
      assert.equal(js.isOnlyPrivateFinancialName(name), true, name);
    }
  });

  it('leaves NCUA and the Farm Credit Administration verbatim (they are agencies)', () => {
    // Mutation: drop PROTECTED_RE → both are stripped → RED.
    for (const name of ['National Credit Union Administration', 'Farm Credit Administration']) {
      assert.equal(js.stripPrivateFinancialNames(name), name);
      assert.equal(js.hasPrivateFinancialName(name), false, name);
    }
  });

  it('leaves the federal agencies untouched', () => {
    // Mutation: `federal\s+bank` without the trailing \b → "Federal Bankruptcy" stripped → RED.
    for (const name of AGENCIES) assert.equal(js.stripPrivateFinancialNames(name), name);
  });

  it('strips only the lender in a mixed tenant list', () => {
    assert.match(js.stripPrivateFinancialNames('GSA | Navy Federal Credit Union'), /^GSA \|/);
    assert.equal(js.isOnlyPrivateFinancialName('GSA | Navy Federal Credit Union'), false);
  });

  it('the Deno mirror agrees with the JS rule on every fixture', () => {
    const fixtures = [...PRIVATE_LENDERS, ...AGENCIES,
      'National Credit Union Administration', 'Farm Credit Administration',
      'GSA | Navy Federal Credit Union', 'fully leased to navy federal credit union, a',
      'Truist Bank|American Partner Federal Credit Union'];
    for (const f of fixtures) {
      assert.equal(ts.stripPrivateFinancialNames(f), js.stripPrivateFinancialNames(f), f);
    }
    assert.equal(ts.PRIVATE_FINANCIAL_NAME_RE.source, js.PRIVATE_FINANCIAL_NAME_RE.source);
  });
});

describe('GOV-CU1 every gov router: lender → non-gov, agency → gov', () => {
  it('CoStar sidebar classifyDomain', () => {
    // Mutation: remove the strip in classifyDomain → every lender reads /\bfederal\b/ → RED.
    for (const name of PRIVATE_LENDERS) assert.notEqual(sidebar(name), 'government', name);
    for (const name of AGENCIES) assert.equal(sidebar(name), 'government', name);
    assert.equal(sidebar('GSA | Navy Federal Credit Union'), 'government');
  });

  it('gov credit-tier resolver (what stamps government_type)', () => {
    // Mutation: remove the strip in splitTenantText → lenders bucket 'federal' → RED.
    for (const name of PRIVATE_LENDERS) assert.equal(creditHasFederal(name), false, name);
    for (const name of AGENCIES) assert.equal(creditHasFederal(name), true, name);
  });

  it('Salesforce deal classifier classifyVertical', () => {
    // "Veterans" and "U.S. Navy" read gov here; strip keeps the lender out.
    // Mutation: remove the strip on govHay → 'Veterans Federal Credit Union' reads gov → RED.
    for (const name of [...PRIVATE_LENDERS, 'Veterans Federal Credit Union']) {
      assert.equal(classifyVertical({ tenant: name, deal_name: name }).gov, false, name);
    }
    assert.equal(classifyVertical({ tenant: 'Federal Bureau of Investigation' }).gov, true);
  });

  it('Salesforce intake router routeVertical (edge)', () => {
    // Mutation: remove the strip in sf-config.ts → "federal" substring → gov → RED.
    for (const name of PRIVATE_LENDERS) {
      assert.notEqual(routeVertical({ tenant: name }).vertical, 'gov', name);
    }
    for (const name of AGENCIES) assert.equal(routeVertical({ tenant: name }).vertical, 'gov', name);
  });

  it('Salesforce files router strips before its gov check (not importable: Deno.serve at load)', () => {
    const src = readFileSync(new URL('../supabase/functions/intake-salesforce-files/index.ts', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('function routeFileVertical('), src.indexOf('\n}\n', src.indexOf('function routeFileVertical(')));
    const code = fn.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    // Mutation: revert to `GOV_SIGNALS.some((s) => hay.includes(s))` → RED.
    assert.match(code, /const govHay = stripPrivateFinancialNames\(hay\);/);
    assert.match(code, /GOV_SIGNALS\.some\(\(s\) => govHay\.includes\(s\)\)/);
    assert.doesNotMatch(code, /GOV_SIGNALS\.some\(\(s\) => hay\.includes/);
  });

  it('OM create path never mints a dia/gov property for a lender tenant', () => {
    // Mutation: remove the isOnlyPrivateFinancialName check → 'government' → RED.
    for (const name of PRIVATE_LENDERS) assert.equal(pickDomainForTenant(name), null, name);
    // …even when the file was filed in a gov folder.
    assert.equal(pickDomainForTenant('Navy Federal Credit Union', { source_vertical: 'gov' }), null);
    assert.equal(pickDomainForTenant('Federal Bureau of Investigation'), 'government');
    assert.equal(pickDomainForTenant('National Credit Union Administration'), 'government');
  });
});
