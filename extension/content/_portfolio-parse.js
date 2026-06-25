// ============================================================================
// LCC Assistant — Portfolio "Properties" table parser
// Pure, DOM-free helper that turns the constituent Properties table on a CoStar
// Bulk/Portfolio Sale Comp page into a structured portfolio_properties[] array.
// Loaded as a content script before costar.js (manifest order); also importable
// from Node for unit tests. Publishes `globalThis.__lccPortfolioParse`.
//
// INPUT CONTRACT
//   `lines` is document.body.innerText split on '\n', trimmed, non-empty — the
//   exact output of costar.js getPageLines(). A real HTML <table> renders each
//   ROW as ONE innerText line with cells separated by a TAB ('\t'); the header
//   row is likewise a tab-joined line. This parser keys on that contract and
//   maps cells to fields by the header's column positions (so column-order
//   drift doesn't silently mis-map).
//
//   ⚠️ NEEDS LIVE VERIFICATION: if CoStar renders the Properties grid as DIVs
//   (one cell per line) rather than a <table>, splitCells() yields 1-cell lines
//   and parsePortfolioProperties() returns [] (fails closed — never fabricates).
//   In that case adapt _readGrid() to the cell-per-line block shape. The parser
//   is intentionally conservative: a row is only emitted when it carries a
//   plausible street address AND a 2-letter state, so a stray section never
//   becomes a junk constituent.
// ============================================================================

(function () {
  'use strict';

  const STATE_RE = /^[A-Z]{2}$/;
  const PRICE_RE = /^\$[\d,]+(?:\.\d+)?$/;
  const SIZE_RE  = /^([\d,]+)\s*SF$/i;
  // A minimal "looks like a US street address" gate: leading number + a word.
  const ADDRESS_RE = /^\d+\s+\S/;

  function splitCells(line) {
    return String(line == null ? '' : line)
      .split('\t')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }

  // Header line for the Properties table: Address + City + State + a price col.
  function isPropertiesHeader(cells) {
    const lc = cells.map((c) => c.toLowerCase());
    return lc.includes('address') && lc.includes('city') && lc.includes('state')
      && lc.some((c) => /sale price|^price$|price\/area|price\/sf/.test(c));
  }

  // Map header cells → field column indexes.
  function headerIndex(cells) {
    const lc = cells.map((c) => c.toLowerCase());
    const find = (...names) => {
      for (const n of names) { const i = lc.indexOf(n); if (i > -1) return i; }
      return null;
    };
    return {
      address: find('address'),
      city:    find('city'),
      state:   find('state'),
      type:    find('property type', 'type'),
      size:    find('size', 'sf', 'rba'),
      price:   find('sale price', 'price'),
    };
  }

  function parsePrice(s) {
    return PRICE_RE.test(s || '') ? Number(String(s).replace(/[$,]/g, '')) : null;
  }
  function parseSize(s) {
    const m = SIZE_RE.exec(s || '');
    return m ? Number(m[1].replace(/,/g, '')) : null;
  }

  function rowFromCells(cells, idx) {
    const at = (i) => (i != null && i < cells.length ? cells[i] : null);
    return {
      address:       at(idx.address) || null,
      city:          at(idx.city) || null,
      state:         at(idx.state) || null,
      property_type: at(idx.type) || null,
      size_sf:       parseSize(at(idx.size)),
      sale_price:    parsePrice(at(idx.price)),
    };
  }

  // A parsed row is a plausible constituent only if it has a street-shaped
  // address AND a 2-letter state somewhere in the line (defends against a
  // section header / footer accidentally splitting into the right cell count).
  function isPlausibleConstituent(row, cells) {
    if (!row.address || !ADDRESS_RE.test(row.address)) return false;
    if (row.state && STATE_RE.test(row.state)) return true;
    return cells.some((c) => STATE_RE.test(c));
  }

  // FORM A — a real <table>: each row is one tab-separated innerText line.
  function parseTabTable(lines) {
    let headerAt = -1;
    let idx = null;
    for (let i = 0; i < lines.length; i++) {
      const cells = splitCells(lines[i]);
      if (cells.length >= 4 && isPropertiesHeader(cells)) {
        headerAt = i;
        idx = headerIndex(cells);
        break;
      }
    }
    if (headerAt === -1 || idx.address == null) return [];

    const out = [];
    const seen = new Set();
    for (let i = headerAt + 1; i < lines.length; i++) {
      const cells = splitCells(lines[i]);
      if (cells.length < 3) {
        if (out.length > 0) break; // table ended
        continue;
      }
      const row = rowFromCells(cells, idx);
      if (!isPlausibleConstituent(row, cells)) {
        if (out.length > 0) break;
        continue;
      }
      pushUnique(out, seen, row);
    }
    return out;
  }

  function pushUnique(out, seen, row) {
    const key = `${(row.address || '').toLowerCase()}|${(row.state || '').toUpperCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  }

  // Header column labels (single-cell lines) for the div-grid form.
  const HEADER_LABEL = new Set([
    'address', 'city', 'state', 'property type', 'type', 'rating', 'size', 'sf',
    'rba', 'sale price', 'price', 'price/area', 'price/sf', 'price status',
  ]);
  // Lines that end the constituent table (next page section).
  const SECTION_END_RE = /^(transaction details|portfolio|buyer|seller|map|contacts|documents|sources|my notes|photos?|loan|financ|©|by using this)/i;
  const PTYPE_RE = /^(office|retail|industrial|flex|medical|mob|land|mixed[\s-]?use|multifamily|hospitality|self[\s-]?storage|special purpose)\b/i;
  // City: alpha/space/.'- only, not a 2-letter state, not a property type.
  const CITY_RE = /^[A-Za-z][A-Za-z .'’-]+$/;

  // FORM B — a div grid: innerText puts each CELL on its own line (no tabs).
  // Anchor on address-shaped lines and read each constituent's fields from the
  // lines up to the next address. Tolerant of a collapsed/odd cell (e.g. the
  // star Rating column) because it matches by VALUE shape, not fixed offset.
  function parseDivGrid(lines) {
    // Require the Address/City/State header labels to start (fails closed).
    let start = -1;
    for (let i = 0; i + 2 < lines.length; i++) {
      if (lines[i].toLowerCase() === 'address') {
        const look = lines.slice(i + 1, i + 6).map((x) => x.toLowerCase());
        if (look.includes('city') && look.includes('state')) { start = i; break; }
      }
    }
    if (start === -1) return [];
    let j = start;
    while (j < lines.length && HEADER_LABEL.has(lines[j].toLowerCase())) j++;

    const out = [];
    const seen = new Set();
    let cur = null;
    const flush = () => {
      if (cur && cur.address && cur.state && cur.sale_price != null) pushUnique(out, seen, cur);
      cur = null;
    };
    for (; j < lines.length; j++) {
      const ln = lines[j];
      if (SECTION_END_RE.test(ln)) break;
      if (ADDRESS_RE.test(ln)) { flush(); cur = blankRow(ln); continue; }
      if (!cur) continue;
      if (cur.state == null && STATE_RE.test(ln)) { cur.state = ln; continue; }
      const sz = parseSize(ln);
      if (cur.size_sf == null && sz != null) { cur.size_sf = sz; continue; }
      const pr = parsePrice(ln);
      if (cur.sale_price == null && pr != null) { cur.sale_price = pr; continue; }
      if (cur.property_type == null && PTYPE_RE.test(ln)) { cur.property_type = ln; continue; }
      // City is the first plain-alpha line after the address (before state).
      if (cur.city == null && cur.state == null && CITY_RE.test(ln) && !PTYPE_RE.test(ln)) { cur.city = ln; continue; }
    }
    flush();
    return out;
  }

  function blankRow(address) {
    return { address, city: null, state: null, property_type: null, size_sf: null, sale_price: null };
  }

  function parsePortfolioProperties(lines) {
    if (!Array.isArray(lines)) return [];
    const tab = parseTabTable(lines);
    if (tab.length > 0) return tab;
    return parseDivGrid(lines); // div-grid fallback
  }

  const api = {
    parsePortfolioProperties,
    splitCells,
    isPropertiesHeader,
    headerIndex,
    parsePrice,
    parseSize,
  };

  if (typeof globalThis !== 'undefined') globalThis.__lccPortfolioParse = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
