// GOV-AVAIL2 (2026-09-23): the gov Available, Sales Comps and Leases tables read one display
// mapping. Casing, street-type abbreviation and agency resolution happen in SQL
// (government-lease sql/20260923_gov_avail2_display_normalization.sql); gov.js only picks the
// columns. Behavioural where possible: the two helpers are compiled out of gov.js and run.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../gov.js', import.meta.url), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Brace-matched body of a top-level function (anchored on the declaration, never a char window).
function fnSource(name) {
  const start = code.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} not found in gov.js`);
  let i = code.indexOf('{', start), depth = 0;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) break;
  }
  return code.slice(start, i + 1);
}

function esc(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
// eslint-disable-next-line no-new-func
const { govDisplayFields, govAgencyCellHTML } = new Function('esc',
  fnSource('govDisplayFields') + '\n' + fnSource('govAgencyCellHTML') +
  '\nreturn { govDisplayFields, govAgencyCellHTML };')(esc);

describe('govDisplayFields — one mapping for three tables', () => {
  it('a resolved agency shows the canonical code; full name + source spelling on hover', () => {
    const d = govDisplayFields({ agency: 'SOCIAL SECURITY ADMINISTRATION', agency_display: 'SSA', agency_code: 'SSA',
      agency_canonical_full: 'Social Security Administration', agency_resolution: 'matched',
      address: '2502 SOUTH 2ND STREET', address_display: '2502 South 2nd St', city: 'MANSFIELD', city_display: 'Mansfield' });
    assert.equal(d.agency_display, 'SSA');
    assert.equal(d.agency_resolved, true);
    assert.equal(d.agency_title, 'Social Security Administration — listed as “SOCIAL SECURITY ADMINISTRATION”');
    assert.equal(d.address_display, '2502 South 2nd St');
    assert.equal(d.address_title, '2502 SOUTH 2ND STREET');
    assert.equal(d.city_display, 'Mansfield');
  });
  it('an unresolved agency shows the title-cased source string and is flagged unresolved', () => {
    const d = govDisplayFields({ agency: 'NAVY FEDERAL CREDIT UNION', agency_display: 'Navy Federal Credit Union',
      agency_resolution: 'unresolved', agency_raw_display: 'Navy Federal Credit Union' });
    assert.equal(d.agency_display, 'Navy Federal Credit Union');
    assert.equal(d.agency_resolved, false);
    assert.match(d.agency_title, /not matched to a canonical agency/);
  });
  it('the display label wins over the raw agency_full fallback (the screenshot\'s capitals)', () => {
    const d = govDisplayFields({ agency: null, agency_full: 'GENERAL SERVICES ADMINISTRATION', agency_display: 'GSA',
      agency_code: 'GSA', agency_resolution: 'matched' });
    assert.equal(d.agency_display, 'GSA');
  });
  it('Leases rows read the gov_display computed column on properties', () => {
    const d = govDisplayFields({ agency: 'VETERANS AFFAIRS', address: '1 MAIN STREET', city: 'ERIE',
      gov_display: { agency: 'VA', agency_code: 'VA', agency_full: 'Department of Veterans Affairs',
        agency_resolution: 'matched', address: '1 Main St', city: 'Erie' } });
    assert.equal(d.agency_display, 'VA');
    assert.equal(d.agency_resolved, true);
    assert.equal(d.address_display, '1 Main St');
    assert.equal(d.city_display, 'Erie');
  });
  it('with no display columns yet it falls back to the raw values (never blank)', () => {
    const d = govDisplayFields({ agency: 'USPS', address: '5 Elm St', city: 'Tulsa' });
    assert.equal(d.agency_display, 'USPS');
    assert.equal(d.address_display, '5 Elm St');
    assert.equal(d.city_display, 'Tulsa');
  });
});

describe('govAgencyCellHTML — unresolved reads as a known gap', () => {
  it('marks an unresolved agency and not a resolved one', () => {
    const un = govAgencyCellHTML({ agency_display: 'Navy Federal Credit Union', agency_resolved: false, agency_title: 'x' });
    assert.match(un, /class="gov-agency-unresolved"/);
    const ok = govAgencyCellHTML({ agency_display: 'SSA', agency_resolved: true, agency_title: 'Social Security Administration' });
    assert.doesNotMatch(ok, /gov-agency-unresolved/);
    assert.match(ok, /title="Social Security Administration"/);
  });
  it('escapes the label and the hover text', () => {
    const h = govAgencyCellHTML({ agency_display: '<b>', agency_resolved: true, agency_title: '"x"' });
    assert.doesNotMatch(h, /<b>/);
    assert.match(h, /&quot;x&quot;/);
  });
});

describe('wiring', () => {
  it('Available and Sales Comps both map through govDisplayFields and render the shared cells', () => {
    assert.equal((code.match(/\.\.\.govDisplayFields\(r\)/g) || []).length, 2);
    const render = fnSource('renderGovSales');
    assert.match(render, /html \+= govAgencyCellHTML\(r\);/);
    assert.match(render, /td\(r\.city_display \|\| r\.city\)/);
    assert.doesNotMatch(render, /td\(r\.agency, true\)/);
  });
  it('both Leases tables map through govDisplayFields and fetch gov_display for the shown rows only', () => {
    const body = fnSource('buildGovLeasesHTML');
    assert.equal((body.match(/govDisplayFields\(p\)/g) || []).length, 2);
    assert.equal((body.match(/govEnsureDisplay\(/g) || []).length, 2);
    assert.equal((body.match(/govAgencyCellHTML\(_[pr]d, ' '\)/g) || []).length, 2);
    assert.doesNotMatch(body, /esc\(p\.agency\b/, 'a Leases cell rendering the raw agency');
    assert.doesNotMatch(body, /esc\(p\.address \|\|/, 'a Leases cell rendering the raw address');
    assert.match(fnSource('govEnsureDisplay'), /'property_id,gov_display'/);
  });
  it('Leases pages properties at PostgREST\'s 1,000-row cap (a 2,000 stride stopped at page one)', () => {
    const body = fnSource('renderGovLeases');
    assert.match(body, /limit: 1000, offset: pg \* 1000/);
    assert.match(body, /batch\.data\.length < 1000/);
    assert.doesNotMatch(body, /gov_display/, 'gov_display over ~20k rows costs ~11 s; fetch it for the shown rows');
  });
});
