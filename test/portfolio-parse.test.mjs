// Portfolio "Properties" table parser (2026-06-25)
//
// Turns the constituent table on a CoStar Bulk/Portfolio Sale Comp page (the
// 40-row table that was dropped, collapsing the whole deal to one address) into
// a structured portfolio_properties[]. Lines are modeled on getPageLines()
// output: innerText split on '\n', trimmed — a real <table> row is one line
// with TAB-separated cells.
//
// ⚠️ The live CoStar DOM has not been verified from the build sandbox; these
// cases encode the tab-separated <table> INPUT CONTRACT the parser targets.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/content/_portfolio-parse.js');
const { parsePortfolioProperties, isPropertiesHeader, splitCells } =
  globalThis.__lccPortfolioParse;

// SVEA New Mexico portfolio — first rows of the Properties table (screenshot).
const HEADER = 'Address\tCity\tState\tProperty Type\tRating\tSize\tSale Price\tPrice/Area\tPrice Status';
const SVEA_LINES = [
  'Summary', 'Contacts', 'Map', 'Buyer', 'Seller',         // surrounding noise
  'Properties',
  HEADER,
  '445 Camino Del Rey Dr\tLos Lunas\tNM\tOffice\t★★★☆☆\t46,635 SF\t$8,022,379\t$172.02/SF\tA',
  '39 Plaza La Prensa\tSanta Fe\tNM\tOffice\t★★★☆☆\t43,084 SF\t$7,565,784\t$175.61/SF\tA',
  '912 N Railroad Ave\tEspanola\tNM\tOffice\t★★★☆☆\t27,692 SF\t$5,920,601\t$213.80/SF\tA',
  '3280 Bridge Blvd SW\tAlbuquerque\tNM\tOffice\t★★☆☆☆\t35,535 SF\t$5,631,229\t$158.47/SF\tA',
  '2540 Camino Ortiz\tSanta Fe\tNM\tOffice\t★★★☆☆\t22,730 SF\t$5,557,347\t$244.49/SF\tA',
  'Transaction Details',                                    // next section ends the table
  'Sale Date\tJan 5, 2022',
];

describe('parsePortfolioProperties — SVEA NM portfolio table', () => {
  const rows = parsePortfolioProperties(SVEA_LINES);

  it('extracts every constituent row (and stops at the next section)', () => {
    assert.equal(rows.length, 5);
  });

  it('maps address / city / state by header column', () => {
    assert.deepEqual(
      { address: rows[0].address, city: rows[0].city, state: rows[0].state },
      { address: '445 Camino Del Rey Dr', city: 'Los Lunas', state: 'NM' });
  });

  it('parses the PER-PROPERTY price (not the deal aggregate)', () => {
    assert.equal(rows[0].sale_price, 8022379);
    assert.equal(rows[2].sale_price, 5920601);
    // none of these is the $119,082,570 aggregate
    assert.ok(rows.every((r) => r.sale_price !== 119082570));
  });

  it('parses size SF as a number', () => {
    assert.equal(rows[0].size_sf, 46635);
    assert.equal(rows[1].size_sf, 43084);
  });

  it('carries property_type', () => {
    assert.equal(rows[0].property_type, 'Office');
  });
});

describe('parsePortfolioProperties — robustness', () => {
  it('returns [] when there is no Properties table (fails closed)', () => {
    assert.deepEqual(parsePortfolioProperties(['Summary', 'Buyer', 'Seller']), []);
  });

  it('returns [] for a div-grid (one cell per line) — needs-verification path', () => {
    // No tabs -> 1-cell lines -> no header match -> [] (never fabricates).
    assert.deepEqual(parsePortfolioProperties(
      ['Properties', 'Address', 'City', 'State', '445 Camino Del Rey Dr', 'Los Lunas', 'NM']), []);
  });

  it('dedupes identical address|state rows within one capture', () => {
    const dupLines = [HEADER,
      '100 Main St\tReno\tNV\tOffice\t-\t1,000 SF\t$1,000,000\t$1,000/SF\tA',
      '100 Main St\tReno\tNV\tOffice\t-\t1,000 SF\t$1,000,000\t$1,000/SF\tA'];
    assert.equal(parsePortfolioProperties(dupLines).length, 1);
  });

  it('rejects a non-address row (no street number) as junk', () => {
    const lines = [HEADER, 'Subtotal\t\tNM\t\t\t652,850 SF\t$119,082,570\t$191.66/SF\t'];
    assert.equal(parsePortfolioProperties(lines).length, 0);
  });

  it('is null/garbage tolerant', () => {
    assert.deepEqual(parsePortfolioProperties(null), []);
    assert.deepEqual(parsePortfolioProperties([]), []);
  });

  it('isPropertiesHeader / splitCells behave', () => {
    assert.equal(isPropertiesHeader(splitCells(HEADER)), true);
    assert.equal(isPropertiesHeader(['Buyer', 'Seller']), false);
  });
});
