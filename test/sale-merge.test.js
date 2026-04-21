import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// _sale-merge.js is an IIFE that attaches its API to globalThis. Import it
// for its side effect, then read __lccSaleMerge off the global.
await import('../extension/content/_sale-merge.js');

const {
  mergeSales,
  normalizePrice,
  normalizeSaleDate,
  normalizeEntityName,
  saleFieldCount,
} = globalThis.__lccSaleMerge;

describe('mergeSales', () => {
  it('collapses a stat-card row and a deed-history row for the same transaction', () => {
    const existing = [
      // Stat-card "Transaction Date" row (signing/close).
      {
        sale_date: 'Nov 7, 2025',
        sale_price: '$45,750,000',
        transaction_type: 'Investment',
      },
    ];
    const incoming = [
      // Public Records deed-history row (recordation date, 6 days later).
      {
        sale_date: '11/13/2025',
        sale_price: '$45,750,000',
        document_number: '2025.22829',
        deed_type: 'Special Warranty Deed',
        buyer: 'GREENCASTLE PA I FGF LLC',
        seller: 'ATAPCO ACQUISITIONS LLC',
      },
    ];

    mergeSales(existing, incoming);

    assert.equal(existing.length, 1, 'the two rows must collapse into one');
    const merged = existing[0];
    // Richer row wins → the deed-history row became the base.
    assert.equal(merged.document_number, '2025.22829');
    assert.equal(merged.buyer, 'GREENCASTLE PA I FGF LLC');
    // Fields from the other row are preserved.
    assert.equal(merged.transaction_type, 'Investment');
    assert.equal(merged.sale_price, '$45,750,000');
  });

  it('matches on document_number even when dates are far apart', () => {
    const existing = [{
      sale_date: 'Jan 1, 2024',
      sale_price: '$10,000,000',
      document_number: 'DOC-42',
    }];
    const incoming = [{
      sale_date: 'Mar 15, 2024',   // 73 days later — would not match on date
      sale_price: '$10,000,000',
      document_number: 'DOC-42',
      buyer: 'Acme LLC',
    }];

    mergeSales(existing, incoming);

    assert.equal(existing.length, 1);
    assert.equal(existing[0].buyer, 'Acme LLC');
  });

  it('matches on buyer name when dates slip beyond 14 days', () => {
    const existing = [{
      sale_date: 'Nov 7, 2025',
      sale_price: '$45,750,000',
      buyer: 'Greencastle PA I FGF, LLC',
    }];
    const incoming = [{
      sale_date: 'Nov 28, 2025',  // 21 days — outside the date window
      sale_price: '$45,750,000',
      buyer: 'GREENCASTLE PA I FGF LLC',
      document_number: '2025.22829',
    }];

    mergeSales(existing, incoming);

    assert.equal(existing.length, 1);
    assert.equal(existing[0].document_number, '2025.22829');
  });

  it('keeps distinct transactions with different prices and buyers separate', () => {
    const existing = [{
      sale_date: 'Nov 7, 2025',
      sale_price: '$45,750,000',
      buyer: 'Greencastle PA I FGF LLC',
    }];
    const incoming = [{
      sale_date: 'Nov 10, 2025',
      sale_price: '$2,500,000',    // 95% lower — not same deal
      buyer: 'Totally Different Owner LLC',
    }];

    mergeSales(existing, incoming);

    assert.equal(existing.length, 2);
  });

  it('preserves both sale_date and recordation_date as separate fields', () => {
    const existing = [{
      sale_date: 'Nov 7, 2025',
      sale_price: '$45,750,000',
    }];
    const incoming = [{
      // Deed-history entry supplies the recordation_date but no sale_date
      recordation_date: '11/13/2025',
      sale_price: '$45,750,000',
      document_number: '2025.22829',
    }];

    mergeSales(existing, incoming);

    assert.equal(existing.length, 1);
    assert.equal(existing[0].sale_date, 'Nov 7, 2025');
    assert.equal(existing[0].recordation_date, '11/13/2025');
  });
});

describe('mergeSales helpers', () => {
  it('normalizePrice handles $M / $K / plain numbers', () => {
    assert.equal(normalizePrice('$2.7M'), 2700000);
    assert.equal(normalizePrice('$45,750,000'), 45750000);
    assert.equal(normalizePrice('$500K'), 500000);
    assert.equal(normalizePrice(''), 0);
    assert.equal(normalizePrice(null), 0);
  });

  it('normalizeSaleDate converts common CoStar formats to ISO', () => {
    assert.equal(normalizeSaleDate('Nov 7, 2025'), '2025-11-07');
    assert.equal(normalizeSaleDate('11/13/2025'), '2025-11-13');
    assert.equal(normalizeSaleDate(''), '');
  });

  it('normalizeEntityName strips suffixes and punctuation', () => {
    const a = normalizeEntityName('ATAPCO Acquisitions, LLC');
    const b = normalizeEntityName('atapco acquisitions llc');
    assert.equal(a, b);
    assert.equal(a, 'atapco acquisitions');
  });

  it('saleFieldCount counts only non-empty fields', () => {
    assert.equal(
      saleFieldCount({ a: 1, b: '', c: null, d: 'x', e: undefined }),
      2
    );
  });
});
