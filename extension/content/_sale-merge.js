// ============================================================================
// LCC Assistant — Sale Merge Helpers
// Pure, DOM-free helpers for deduping and merging sale records across CoStar
// tabs and Public Records deed history. Loaded as a content script before
// costar.js (manifest order); also importable from Node for unit tests.
//
// Publishes `globalThis.__lccSaleMerge = { mergeSales, ... }`.
// ============================================================================

(function () {
  'use strict';

  // "$2.7M" → 2700000
  function normalizePrice(s) {
    if (!s) return 0;
    const str = String(s);
    const cleaned = str.replace(/[^0-9.kmb]/gi, '');
    let num = parseFloat(cleaned) || 0;
    if (/[Mm]/.test(str)) num *= 1000000;
    else if (/[Kk]/.test(str)) num *= 1000;
    else if (/[Bb]/.test(str)) num *= 1000000000;
    return num;
  }

  // "Sep 30, 2022" or "9/30/2022" → "YYYY-MM-DD"
  function normalizeSaleDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return String(s).toLowerCase().trim();
  }

  // Normalize an entity name for cross-source matching: strips common
  // corporate suffixes (LLC, Inc, Corp, Trust, …), punctuation, and
  // collapses whitespace. "ATAPCO Acquisitions, LLC" → "atapco acquisitions".
  function normalizeEntityName(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .replace(/\b(l\.?l\.?c|inc|corp|co|company|lp|llp|ltd|n\.?a|holdings?|group|partners|trust)\b\.?/gi, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function saleFieldCount(s) {
    return Object.keys(s).filter((k) => s[k] != null && s[k] !== '').length;
  }

  // Days between two normalized date strings. Returns Infinity when
  // either side is empty or unparseable so callers can safely compare
  // the result against a window size.
  function daysBetween(a, b) {
    if (!a || !b) return Infinity;
    const ta = new Date(a).getTime();
    const tb = new Date(b).getTime();
    if (isNaN(ta) || isNaN(tb)) return Infinity;
    return Math.abs(ta - tb) / 86400000;
  }

  function pricesMatch(a, b, tolerance) {
    // Missing price on either side — same CoStar transaction captured
    // from a different tab (deed vs summary). Treat as same sale.
    if (a === 0 || b === 0) return true;
    return Math.abs(a - b) / Math.max(a, b) < tolerance;
  }

  // Merge a new batch of sales into `existing` in place. Collapses the
  // two rows CoStar emits for the same transaction — the Transaction
  // Details stat card reports the signing/close date, the Public
  // Records deed history reports the county recordation date, which
  // can slip 1–14 days behind.
  //
  // Match predicate, in priority order:
  //   1. document_number equal on both sides  → same deed, same transaction
  //   2. sale_price within 5% AND (sale_date within 14 days OR
  //      buyer names normalize-equal OR seller names normalize-equal)
  //
  // On match, the record with more populated fields becomes the base
  // and missing scalars are filled from the other. Both `sale_date`
  // and `recordation_date` are preserved as separate fields so
  // downstream consumers (sales_transactions.recorded_date vs
  // sale_date) can keep the distinction.
  function mergeSales(existing, newSales) {
    for (const s of newSales) {
      const sDate   = normalizeSaleDate(s.sale_date || s.recordation_date);
      const sPrice  = normalizePrice(s.sale_price);
      const sDoc    = s.document_number ? String(s.document_number).trim() : '';
      const sBuyer  = normalizeEntityName(s.buyer || s.buyer_name);
      const sSeller = normalizeEntityName(s.seller || s.seller_name);

      const matchIdx = existing.findIndex((e) => {
        const eDoc = e.document_number ? String(e.document_number).trim() : '';
        if (sDoc && eDoc && sDoc === eDoc) return true;

        const ePrice = normalizePrice(e.sale_price);
        if (!pricesMatch(ePrice, sPrice, 0.05)) return false;

        const eDate = normalizeSaleDate(e.sale_date || e.recordation_date);
        const dateClose = daysBetween(sDate, eDate) <= 14;

        const eBuyer  = normalizeEntityName(e.buyer || e.buyer_name);
        const eSeller = normalizeEntityName(e.seller || e.seller_name);
        const buyerMatch  = !!sBuyer  && !!eBuyer  && sBuyer  === eBuyer;
        const sellerMatch = !!sSeller && !!eSeller && sSeller === eSeller;

        return dateClose || buyerMatch || sellerMatch;
      });

      if (matchIdx === -1) {
        existing.push(s);
        continue;
      }

      const current = existing[matchIdx];
      const [base, other] = saleFieldCount(s) > saleFieldCount(current)
        ? [s, current]
        : [current, s];
      for (const [k, v] of Object.entries(other)) {
        if (v != null && v !== '' && (base[k] == null || base[k] === '')) {
          base[k] = v;
        }
      }
      existing[matchIdx] = base;
    }
  }

  const api = {
    mergeSales,
    normalizePrice,
    normalizeSaleDate,
    normalizeEntityName,
    saleFieldCount,
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.__lccSaleMerge = api;
  }
})();
