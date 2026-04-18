// ============================================================================
// LCC Assistant — Content Script: CoStar
// Extracts property data from sale comp / property detail pages.
// Uses page-text scanning (innerText) because CoStar's React DOM is too
// deeply nested for reliable sibling/parent traversal.
// ============================================================================

(function () {
  'use strict';

  let lastDetectedId = null;
  let lastContentLen = 0;
  let extractionTimer = null;

  // Accumulated data: merges across CoStar tab switches and popups
  let accumulated = { contacts: [], sales_history: [], tenants: [] };

  // Auto-pagination state for Public Record sale/loan history
  let paginationInProgress = false;
  let lastPaginatedPage = 0;

  const observer = new MutationObserver(() => {
    clearTimeout(extractionTimer);
    extractionTimer = setTimeout(extract, 500);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(extract, 1500);
  setTimeout(extract, 4000);

  // ── Main extraction ───────────────────────────────────────────────────

  function extract() {
    try {
    const url = window.location.href;

    let address = null;
    let headingEl = null;

    for (const sel of ['h1', 'h2', 'h3']) {
      const el = document.querySelector(sel);
      if (el) {
        const parsed = parseAddress(el.textContent?.trim());
        if (parsed) {
          address = parsed;
          headingEl = el;
          break;
        }
      }
    }

    let lines = null;
    if (!address) {
      lines = getPageLines();
      address = findAddressInLines(lines);
    }

    if (!address) {
      address = parseAddress(document.title);
    }

    const identifier = address || document.title || url;

    // Detect if page content actually changed (tab switch, popup, etc.)
    const contentLen = document.body.textContent.length;
    const contentChanged = Math.abs(contentLen - lastContentLen) > 50;
    const pageId = identifier + '|' + url;

    // Skip if same page and content hasn't changed
    if (pageId === lastDetectedId && !contentChanged) return;
    lastDetectedId = pageId;
    lastContentLen = contentLen;

    // Extract stable CoStar Comp ID from URL (e.g. /Comp/7588072/)
    const compMatch = url.match(/\/Comp\/(\d+)\//i);
    if (compMatch) accumulated.costar_comp_id = compMatch[1];

    // If address changed (navigated to different property), reset accumulation
    if (accumulated._address && accumulated._address !== identifier) {
      accumulated = { contacts: [], sales_history: [], tenants: [] };
      lastPaginatedPage = 0;
      paginationInProgress = false;
    }
    accumulated._address = identifier;

    if (!lines) lines = getPageLines();
    const data = extractFields(lines);
    // Try DOM-based contact extraction first (captures mailto:/tel: icon links);
    // fall back to text-based parsing for older layouts or when DOM yields nothing
    let contacts = extractContactsFromDOM();
    if (contacts.length === 0) {
      contacts = extractContacts(lines);
    }
    enrichContactsFromDOM(contacts);
    const salesHistory = extractSalesHistory(lines);
    const tenants = extractTenants(lines);

    // ── Extract "Sale Notes" narrative section ──────────────────────────
    const saleNotesIdx = lines.findIndex(l => /^sale\s+notes$/i.test(l.trim()));
    if (saleNotesIdx > -1) {
      const noteLines = [];
      for (let i = saleNotesIdx + 1; i < lines.length; i++) {
        if (/^(documents|my\s+notes|sources|income\s+&\s+expenses|buyer\s+broker|listing\s+broker|verification|©\s*\d{4}|by\s+using\s+this)/i.test(lines[i].trim())) break;
        if (lines[i].trim()) noteLines.push(lines[i].trim());
      }
      if (noteLines.length) data.sale_notes_raw = noteLines.join(' ');
    }

    // ── Extract "Documents" section links (deeds, OMs, brochures) ─────
    data.document_links = extractDocumentLinks();

    // Derive tenant_name from tenants array if not already captured
    if (!data.tenant_name && tenants.length > 0 && tenants[0].name) {
      data.tenant_name = tenants[0].name;
    }

    const location = findLocationInLines(lines);

    // Merge new data into accumulated (preserves data from prior tab views)
    for (const [key, val] of Object.entries(data)) {
      if (val) accumulated[key] = val;
    }
    mergeContacts(accumulated.contacts, contacts);
    // Sanitize: remove contacts with garbage names (addresses, dates, titles, etc.)
    accumulated.contacts = (accumulated.contacts || []).filter(c => {
      if (!c.name) return false;
      if (isContactNameGarbage(c.name)) return false;
      // Reject concatenated address strings (contain ZIP + city run-on)
      if (/\d{5}[A-Z]/.test(c.name)) return false;
      // Reject very short non-names
      if (c.name.length <= 2) return false;
      return true;
    });
    mergeSales(accumulated.sales_history, salesHistory);
    mergeTenants(accumulated.tenants, tenants);
    if (location.city) accumulated.city = location.city;
    if (location.state) accumulated.state = location.state;
    if (location.zip) accumulated.zip = location.zip;

    // ── Derive top-level sale_date / sale_price from most recent in history ──
    // The page-level extraction may capture data from whichever comp page the
    // user is viewing. Override with the most recent transaction from history.
    if (accumulated.sales_history && accumulated.sales_history.length > 0) {
      let mostRecent = null;
      let mostRecentDate = null;
      for (const s of accumulated.sales_history) {
        const d = new Date(s.sale_date);
        if (!isNaN(d.getTime()) && (!mostRecentDate || d > mostRecentDate)) {
          mostRecentDate = d;
          mostRecent = s;
        }
      }
      if (mostRecent) {
        accumulated.sale_date = mostRecent.sale_date;
        if (mostRecent.sale_price) accumulated.sale_price = mostRecent.sale_price;
        if (mostRecent.cap_rate && !accumulated.cap_rate) accumulated.cap_rate = mostRecent.cap_rate;
      }
    }

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'costar',
        entity_type: 'property',
        _version: 17,
        address: address || document.title,
        page_url: url,
        city: accumulated.city,
        state: accumulated.state,
        zip: accumulated.zip,
        ...accumulated,
        contacts: accumulated.contacts,
        sales_history: accumulated.sales_history,
        tenants: accumulated.tenants,
      },
    });

    if (headingEl) injectLccButton(headingEl);

    // Auto-paginate through Public Record sale/loan history records
    autoPageSaleLoanHistory();
    } catch (err) {
      // Log error but don't crash — still send whatever we have
      console.error('[LCC CoStar] extraction error:', err);
    }
  }

  // ── Auto-pagination for Public Record sale/loan history ───────────────
  // CoStar shows "1 of 5 Historic Sale Loan Records" with next/prev arrows.
  // This clicks through all pages so the MutationObserver re-extracts each.

  function autoPageSaleLoanHistory() {
    if (paginationInProgress) return;

    // Find the pagination indicator text: "X of Y Historic Sale Loan Records"
    // or "X of Y Records" inside the Public Record panel
    const allText = document.body.innerText;
    const paginationMatch = allText.match(/(\d+)\s+of\s+(\d+)\s+(?:historic\s+)?sale\s*\/?loan\s+records/i)
      || allText.match(/(\d+)\s+of\s+(\d+)\s+records/i);

    if (!paginationMatch) return;

    const currentPage = parseInt(paginationMatch[1], 10);
    const totalPages = parseInt(paginationMatch[2], 10);

    if (isNaN(currentPage) || isNaN(totalPages) || totalPages <= 1) return;
    if (currentPage >= totalPages) {
      // All pages viewed — reset for next property
      lastPaginatedPage = 0;
      return;
    }

    // Avoid re-clicking the same page (MutationObserver fires multiple times)
    if (currentPage === lastPaginatedPage) return;
    lastPaginatedPage = currentPage;

    console.log(`[LCC CoStar] Auto-paging sale/loan history: ${currentPage} of ${totalPages}`);
    paginationInProgress = true;

    // Find the "next" arrow button — CoStar uses various patterns:
    //  - An aria-label with "next" or "forward"
    //  - A button/icon near the "X of Y" text with a right-arrow class
    //  - A sibling element after the pagination text
    const nextBtn = findNextPageButton();
    if (!nextBtn) {
      console.log('[LCC CoStar] Could not find next-page button');
      paginationInProgress = false;
      return;
    }

    // Small delay to avoid rapid-fire clicks, then click next
    setTimeout(() => {
      try {
        nextBtn.click();
        console.log(`[LCC CoStar] Clicked next → page ${currentPage + 1} of ${totalPages}`);
      } catch (err) {
        console.error('[LCC CoStar] pagination click error:', err);
      }
      // Reset flag after a delay to allow MutationObserver to pick up the change
      setTimeout(() => { paginationInProgress = false; }, 1200);
    }, 600);
  }

  function findNextPageButton() {
    // Strategy 1: aria-label containing "next" near pagination context
    const ariaNext = document.querySelector(
      '[aria-label*="next" i], [aria-label*="forward" i], [aria-label*="Next" i]'
    );
    if (ariaNext && isVisibleElement(ariaNext)) return ariaNext;

    // Strategy 2: Look for right-arrow / chevron-right icons/buttons near
    // the "of X Records" text node
    const allButtons = document.querySelectorAll('button, [role="button"], .pagination-next, .next-btn');
    for (const btn of allButtons) {
      if (!isVisibleElement(btn)) continue;
      // Check for right-arrow icon classes or SVG
      const hasArrow = btn.querySelector(
        '[class*="right"], [class*="next"], [class*="forward"], [class*="chevron-right"]'
      ) || /[▶►→❯]/.test(btn.textContent);
      if (hasArrow) return btn;
    }

    // Strategy 3: Find the pagination text node and look for the next
    // clickable sibling after it
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        /\d+\s+of\s+\d+\s+.*records/i.test(node.textContent)
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const textNode = walker.nextNode();
    if (textNode) {
      const container = textNode.parentElement?.closest('[class*="pagination"], [class*="pager"], [class*="nav"]')
        || textNode.parentElement?.parentElement;
      if (container) {
        // Find clickable elements after the text
        const clickables = container.querySelectorAll('button, [role="button"], a, [tabindex="0"]');
        for (const el of clickables) {
          if (!isVisibleElement(el)) continue;
          const rect = el.getBoundingClientRect();
          const textRect = textNode.parentElement?.getBoundingClientRect();
          // Pick the clickable element to the right of the pagination text
          if (textRect && rect.left > textRect.right - 10) return el;
        }
      }
    }

    return null;
  }

  function isVisibleElement(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function mergeContacts(existing, newContacts) {
    for (const c of newContacts) {
      const dup = existing.some((e) =>
        e.name === c.name && e.role === c.role
      );
      if (!dup) existing.push(c);
    }
  }

  // Normalize a price string to a number for comparison: "$2.7M" → 2700000
  function normalizePrice(s) {
    if (!s) return 0;
    const cleaned = s.replace(/[^0-9.kmb]/gi, '');
    let num = parseFloat(cleaned) || 0;
    if (/[Mm]/.test(s)) num *= 1000000;
    else if (/[Kk]/.test(s)) num *= 1000;
    else if (/[Bb]/.test(s)) num *= 1000000000;
    return num;
  }

  // Normalize a date string for comparison: various formats → "YYYY-MM-DD"-ish
  function normalizeSaleDate(s) {
    if (!s) return '';
    // "Sep 30, 2022" → Date → toISOString prefix
    // "9/30/2022" → Date → toISOString prefix
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return s.toLowerCase().trim();
  }

  // Count non-null, non-empty fields on a sale object
  function saleFieldCount(s) {
    return Object.keys(s).filter(k => s[k] != null && s[k] !== '').length;
  }

  function mergeSales(existing, newSales) {
    for (const s of newSales) {
      const sDate = normalizeSaleDate(s.sale_date);
      const sPrice = normalizePrice(s.sale_price);

      // Look for an existing entry with the same date and similar price
      const matchIdx = existing.findIndex((e) => {
        const eDate = normalizeSaleDate(e.sale_date);
        if (eDate !== sDate) return false;
        const ePrice = normalizePrice(e.sale_price);
        // Prices match if both are 0, or within 5% of each other
        if (ePrice === 0 && sPrice === 0) return true;
        if (ePrice === 0 || sPrice === 0) return false;
        return Math.abs(ePrice - sPrice) / Math.max(ePrice, sPrice) < 0.05;
      });

      if (matchIdx === -1) {
        // No match — add it
        existing.push(s);
      } else {
        // Match found — keep the version with more detail
        if (saleFieldCount(s) > saleFieldCount(existing[matchIdx])) {
          existing[matchIdx] = s;
        }
      }
    }
  }

  function mergeTenants(existing, newTenants) {
    for (const t of newTenants) {
      const dup = existing.some((e) => e.name === t.name);
      if (!dup) existing.push(t);
    }
  }

  // ── Page text helpers ─────────────────────────────────────────────────

  function getPageLines() {
    try {
      return document.body.innerText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }

  function parseAddress(raw) {
    if (!raw || raw.length < 3) return null;
    let addr = raw.split(/\s+[-–—|]\s+/)[0].trim();
    // Reject pagination patterns like "1 of 2,000 Records"
    if (/^\d+\s+of\s+[\d,]+/i.test(addr)) return null;
    // Must start with a number AND contain a street-type word
    if (/^\d+\s/.test(addr) &&
      /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|pl|place|way|hwy|highway|pkwy|parkway|pike|cir|circle|loop|terr|trail)\b/i.test(addr)) {
      return addr;
    }
    return null;
  }

  function findAddressInLines(lines) {
    for (const line of lines) {
      if (line.length > 120 || line.length < 5) continue;
      const parsed = parseAddress(line);
      if (parsed) return parsed;
    }
    return null;
  }

  function findLocationInLines(lines) {
    for (const line of lines) {
      const m = line.match(/^([A-Za-z][A-Za-z\s.]{1,35}),\s*([A-Z]{2})\s*(\d{5})?/);
      if (m) return { city: m[1].trim(), state: m[2], zip: m[3] || null };
    }
    return { city: null, state: null, zip: null };
  }

  // ── Property field extraction ─────────────────────────────────────────

  function extractFields(lines) {
    const data = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = i > 0 ? lines[i - 1] : '';
      const next = i < lines.length - 1 ? lines[i + 1] : '';

      if (!data.cap_rate && /^(actual\s+)?cap\s+rate$/i.test(line)) {
        if (/[\d.]+%/.test(prev)) data.cap_rate = prev;
        else if (/[\d.]+%/.test(next)) data.cap_rate = next;
        else if (i < lines.length - 2 && /[\d.]+%/.test(lines[i + 2])) data.cap_rate = lines[i + 2];
      }

      // Sale date: capture the MOST RECENT date seen (not first — oldest may appear first)
      if (/^sale\s+date$/i.test(line)) {
        let candidate = null;
        if (/[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}/.test(prev)) candidate = prev;
        else if (/[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}/.test(next)) candidate = next;
        if (candidate) {
          if (!data.sale_date) {
            data.sale_date = candidate;
          } else {
            // Keep whichever is more recent
            const existing = new Date(data.sale_date);
            const incoming = new Date(candidate);
            if (!isNaN(incoming.getTime()) && incoming > existing) {
              data.sale_date = candidate;
            }
          }
        }
      }

      if (!data.asking_price && /^asking\s+price$/i.test(line)) {
        if (/^\$[\d,]+/.test(next)) data.asking_price = next;
        else if (/^\$[\d,]+/.test(prev)) data.asking_price = prev;
      }

      // Sale price: prefer stat card value (appears first, is most recent sale)
      // but skip "Not Disclosed" — grab actual dollar amounts.
      // Guard: a real sale price is at least $1,000 (reject price/SF values like $198.63)
      if (/^sale\s+price$/i.test(line)) {
        if (next && /^\$[\d,]+/.test(next)) {
          const numericVal = parseFloat(next.replace(/[$,]/g, '')) || 0;
          if (numericVal >= 1000) {
            if (!data.sale_price || !/^\$/.test(data.sale_price)) data.sale_price = next;
          }
        } else if (!data.sale_price && next && next.length < 60) {
          data.sale_price = next; // "Not Disclosed" as fallback
        }
      }

      if (!data.square_footage) {
        if (/^sf\s+rba$/i.test(line) && /^[\d,]+$/.test(prev)) data.square_footage = prev + ' SF';
        if (/^rba$/i.test(line) && /^[\d,]+\s*sf/i.test(next)) data.square_footage = next;
      }

      if (!data.year_built && /^(year\s+)?built$/i.test(line)) {
        if (/^\d{4}$/.test(prev)) data.year_built = prev;
        else if (/^\d{4}$/.test(next)) data.year_built = next;
      }

      if (!data.stories && /^stories$/i.test(line)) {
        if (/^\d+$/.test(next)) data.stories = next;
        else if (/^\d+$/.test(prev)) data.stories = prev;
      }

      if (!data.building_class && /^class$/i.test(line)) {
        const headerRe = /^(size|type|class|use|status|source|subtype|sf|rba|year|stories|floors|land|lot|parking|zoning|occupancy|tenancy|market|submarket|building|property)$/i;
        if (/^[A-C]$/i.test(next) && !headerRe.test(next)) data.building_class = next;
        else if (/^[A-C]$/i.test(prev) && !headerRe.test(prev)) data.building_class = prev;
      }

      if (!data.occupancy && (/^leased(\s+at\s+sale)?$/i.test(line) || /^occupancy$/i.test(line))) {
        if (/^\d+%$/.test(prev)) data.occupancy = prev;
        else if (/^\d+%$/.test(next)) data.occupancy = next;
      }

      if (!data.zoning && /^zoning$/i.test(line)) {
        if (next && next.length < 20 && !/^(market|land|parking)/i.test(next)) data.zoning = next;
      }

      if (!data.lot_size) {
        if (/^land\s+acres$/i.test(line) && /[\d.]+\s*ac/i.test(next)) data.lot_size = next;
        else if (/^land\s+sf$/i.test(line) && /[\d,]+\s*sf/i.test(next)) data.lot_size = next;
      }

      if (!data.parking && /^parking\s+ratio$/i.test(line) && next) data.parking = next;

      if (!data.property_type && /^type$/i.test(line)) {
        if (next && next.length < 50 && !/^\d/.test(next) && !/^(investment|sale)/i.test(next) && !/^(size|type|class|use|status|source|subtype|sf|rba|year|stories|floors|land|lot|parking|zoning|occupancy|tenancy|market|submarket|building|property)$/i.test(next)) data.property_type = next;
      }

      if (!data.noi && /^noi$/i.test(line)) {
        if (/^\$?[\d,]+/.test(next)) data.noi = next;
        else if (/^\$?[\d,]+/.test(prev)) data.noi = prev;
      }

      if (!data.price_per_sf && (/^price\/?sf$/i.test(line) || /^price\s+per\s+sf$/i.test(line))) {
        // Must look like a dollar amount (not a percentage — that's cap rate)
        if (/^\$[\d,.]+/.test(next) && !/%/.test(next)) data.price_per_sf = next;
        else if (/^\$[\d,.]+/.test(prev) && !/%/.test(prev)) data.price_per_sf = prev;
      }

      // ── Public Record tab: Assessment table (multi-year rows) ────────
      // CoStar renders assessment data as tab-separated rows:
      //   "Year\tLand\tImprovements\tTotal Value"
      //   "2025\t$1,200,000\t$3,126,000\t$4,326,000"
      if (line.includes('\t')) {
        const parts = line.split('\t').map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const label = parts[0].toLowerCase();
          const value = parts[1];
          // Single-value assessment rows (older CoStar layout)
          if (!data.improvement_value && label === 'improvements') data.improvement_value = value;
          if (!data.assessed_value && label === 'total value') data.assessed_value = value;
          if (!data.land_value && label === 'land') data.land_value = value;
          // Tax amount row
          if (!data.tax_amount && (label === 'tax amount' || label === 'total tax' || label === 'taxes')) data.tax_amount = value;
        }
        // Multi-column assessment rows: Year | Land | Improvements | Total
        if (parts.length >= 3 && /^\d{4}$/.test(parts[0])) {
          if (!data.assessment_years) data.assessment_years = [];
          const row = { year: parseInt(parts[0]) };
          for (let p = 1; p < parts.length; p++) {
            if (/^\$?[\d,]+/.test(parts[p])) {
              if (!row.land) row.land = parts[p];
              else if (!row.improvements) row.improvements = parts[p];
              else if (!row.total) row.total = parts[p];
            }
          }
          data.assessment_years.push(row);
          // Use most recent year as primary values
          if (!data.land_value && row.land) data.land_value = row.land;
          if (!data.improvement_value && row.improvements) data.improvement_value = row.improvements;
          if (!data.assessed_value && row.total) data.assessed_value = row.total;
        }
      }

      // ── Public Record tab: Parcel number ──────────────────────────
      if (!data.parcel_number && /^parcels?\t?$/i.test(line)) {
        if (next && /[\d-]{5,}/.test(next)) data.parcel_number = next;
      }
      // Also match "APN" or "Parcel Number" labels (some CoStar layouts)
      if (!data.parcel_number && /^(apn|parcel\s*(number|no\.?|id|#)?)\s*$/i.test(line)) {
        if (next && /[\d-]{5,}/.test(next)) data.parcel_number = next;
      }

      // ── Public Record tab: Census / FIPS / Legal description ──────
      if (!data.census_tract && /^census\s+tract$/i.test(line) && next && /[\d.]+/.test(next)) {
        data.census_tract = next;
      }
      if (!data.fips_code && /^fips\s*(code)?$/i.test(line) && next && /^\d{4,}/.test(next)) {
        data.fips_code = next;
      }
      if (!data.legal_description && /^legal\s+desc(ription)?$/i.test(line) && next && next.length > 5) {
        data.legal_description = next.length <= 300 ? next : next.substring(0, 300);
      }

      // ── Public Record tab: Building improvements ──────────────────
      if (!data.construction_type && /^construction\s+(type|class)$/i.test(line) && next && next.length < 60) {
        data.construction_type = next;
      }
      if (!data.far && /^far$/i.test(line) && next && /[\d.]+/.test(next)) {
        data.far = next;
      }

      // ── Public Record tab: Latitude / Longitude ───────────────────
      if (!data.latitude && /^lat(itude)?$/i.test(line) && next && /^-?\d+\.\d+/.test(next)) {
        data.latitude = next;
      }
      if (!data.longitude && /^lon(g(itude)?)?$/i.test(line) && next && /^-?\d+\.\d+/.test(next)) {
        data.longitude = next;
      }
      // Combined "Lat/Long" or "Coordinates" line: "34.0522, -118.2437"
      if (!data.latitude && /^(lat\s*\/\s*lon|coordinates?)$/i.test(line)) {
        const coordMatch = (next || '').match(/(-?\d+\.\d+)\s*[,/]\s*(-?\d+\.\d+)/);
        if (coordMatch) {
          data.latitude = coordMatch[1];
          data.longitude = coordMatch[2];
        }
      }

      // Ownership type from Owner tab
      if (!data.ownership_type && /^ownership\s+type$/i.test(line) && next) {
        data.ownership_type = next;
      }

      // ── Tenant / Lease fields ─────────────────────────────────
      if (!data.tenancy_type && /^tenancy$/i.test(line)) {
        if (next && next.length < 30) data.tenancy_type = next;
      }

      if (!data.owner_occupied && /^owner\s+occup(ied)?$/i.test(line)) {
        if (next && /^(yes|no)$/i.test(next)) data.owner_occupied = next;
      }

      if (!data.est_rent && /^costar\s+est\.?\s+rent$/i.test(line)) {
        if (next && next.length < 40) data.est_rent = next;
      }

      if (!data.lease_type && /^lease\s+type$/i.test(line)) {
        if (next && next.length < 40 &&
            /^(nnn|nn|n|triple\s+net|double\s+net|net|full\s+service|gross|modified\s+gross|ground|absolute\s+net|bondable|fs|mg)/i.test(next)) {
          data.lease_type = next;
        }
      }

      if (!data.lease_term && /^lease\s+term$/i.test(line)) {
        if (next && next.length < 40) data.lease_term = next;
      }

      if (!data.lease_expiration && /^lease\s+expir(ation|es)$/i.test(line)) {
        if (next && next.length < 30) data.lease_expiration = next;
      }

      if (!data.rent_per_sf && /^rent\/?sf$/i.test(line)) {
        if (next && /^\$?[\d,.]+/.test(next)) data.rent_per_sf = next;
      }

      if (!data.annual_rent && /^annual\s+rent$/i.test(line)) {
        if (next && /^\$?[\d,.]+/.test(next)) data.annual_rent = next;
      }

      // Tenant name — appears as a label/value pair on property detail pages
      // e.g. "Tenant" label followed by "VA Madison East Clinic" or "DaVita..."
      // Reject CoStar section header labels that follow a "Tenant" label in page text.
      const TENANT_REJECT = /^(public\s+record|building|building\s+info|land|market|market\s+data|submarket|sources|my\s+notes|contacts|sale|transaction|assessment|investment|research|verified|confirmed|not\s+disclosed|no\s+tenant|owner.occupied|vacant|available|none|name|sf\s+occupied|sf|source|floor|move\s+date|exp\s+date|lease\s+type|lease\s+term|lease\s+start|lease\s+expir.*|rent\/?sf|analytics|reports|data|directory|stacking\s+plan|leasing|for\s+lease|for\s+sale|property\s+info|demographics|transit|walk\s+score|industry|sector|property\s+type|property\s+subtype|secondary\s+type|building\s+class|construction|year\s+built|year\s+renovated|lot\s+size|zoning|parking|stories|floors|typical\s+floor|ceiling\s+height|tenancy|single\s+tenant|multi.tenant|net\s+lease|gross\s+lease|nnn|modified\s+gross|buyer|seller|broker|listing\s+broker|buyer\s+broker|lender|owner|recorded\s+buyer|recorded\s+seller|true\s+buyer|true\s+seller|current\s+owner)$/i;

      if (!data.tenant_name && /^tenant\s*name?$/i.test(line) && next
          && next.length > 2 && next.length < 80
          && !TENANT_REJECT.test(next)
          && !/^(tenancy|type|sf|detail|info)/i.test(next)) {
        data.tenant_name = next;
      }

      // Also capture from "Tenants" header when only one tenant is shown
      // (property detail shows a single tenant inline, not a full table)
      if (!data.tenant_name && /^tenants?$/i.test(line) && next
          && next.length > 2 && next.length < 80
          && /^[A-Z]/.test(next)
          && !TENANT_REJECT.test(next)
          && !/^(at\s+sale|detail|directory|stacking)/i.test(next)) {
        data.tenant_name = next;
      }

      // ── Additional property fields ────────────────────────────

      // County (from public records or property details)
      if (!data.county && /^county$/i.test(line) && next && next.length < 40) {
        data.county = next;
      }

      // Year renovated
      if (!data.year_renovated && /^(year\s+)?renovated$/i.test(line)) {
        if (/^\d{4}$/.test(next)) data.year_renovated = next;
        else if (/^\d{4}$/.test(prev)) data.year_renovated = prev;
      }

      // Construction start date
      if (!data.construction_start && /^construction\s+start$/i.test(line) && next) {
        data.construction_start = next;
      }

      // Location type (Urban, Suburban, etc.)
      if (!data.location_type && /^location$/i.test(line)) {
        if (next && /^(urban|suburban|rural|cbd)/i.test(next)) data.location_type = next;
      }

      // Typical floor size
      if (!data.typical_floor_sf && /^typical\s+floor$/i.test(line)) {
        if (next && /[\d,]+\s*sf/i.test(next)) data.typical_floor_sf = next;
      }

      // Floor Area Ratio
      if (!data.far && /^bldg\s+far$/i.test(line) && next) {
        data.far = next;
      }

      // Land SF (separate from acres)
      if (!data.land_sf && /^land\s+sf$/i.test(line) && next && /[\d,]+\s*sf/i.test(next)) {
        data.land_sf = next;
      }

      // Days on market (stat card: "102 days" above "On Market")
      if (!data.days_on_market && /^on\s+market$/i.test(line)) {
        if (/^\d+\s*days?$/i.test(prev)) data.days_on_market = prev;
        else if (/^\d+\s*days?$/i.test(next)) data.days_on_market = next;
      }

      // Building name / marketing name
      if (!data.building_name && /^building\s+name$/i.test(line) && next && next.length < 80) {
        data.building_name = next;
      }

      // Property subtype (e.g., "Medical Office" from submarket line)
      if (!data.property_subtype && /submarket$/i.test(line) && line.length < 60) {
        // "Medical Office - Midway Submarket" → "Medical Office"
        const sub = line.split(/\s*[-–]\s*/)[0].trim();
        const headerRe = /^(size|type|class|use|status|source|subtype|sf|rba|year|stories|floors|land|lot|parking|zoning|occupancy|tenancy|market|submarket|building|property)$/i;
        if (sub && sub.length < 40 && !headerRe.test(sub)) data.property_subtype = sub;
      }

      // Comp status
      if (!data.comp_status && /^comp\s+status$/i.test(line) && next) {
        data.comp_status = next;
      }

      // Price status
      if (!data.price_status && /^price\s+status$/i.test(line) && next) {
        data.price_status = next;
      }

      // ── Lease detail fields ───────────────────────────────────

      // Expense structure (NNN, Full Service, Modified Gross)
      if (!data.expense_structure && /^expense\s+(structure|type)$/i.test(line) && next) {
        data.expense_structure = next;
      }

      // Renewal options
      if (!data.renewal_options && /^renewal\s+option/i.test(line) && next) {
        data.renewal_options = next;
      }

      // Lease guarantor
      if (!data.guarantor && /^guarantor$/i.test(line) && next && next.length < 80) {
        data.guarantor = next;
      }

      // Rent escalations
      if (!data.rent_escalations && /^(rent\s+)?escalation/i.test(line) && next) {
        data.rent_escalations = next;
      }

      // Lease commencement
      if (!data.lease_commencement && /^(lease\s+)?(commencement|start)\s*(date)?$/i.test(line) && next) {
        data.lease_commencement = next;
      }

      // SF leased (government or multi-tenant)
      if (!data.sf_leased && /^(sf\s+)?leased$/i.test(line)) {
        if (/^[\d,]+(\s*sf)?$/i.test(next)) data.sf_leased = next;
      }

      // ── Market data (from "Market at Sale" section) ───────────

      if (/^submarket\s+\d/i.test(line) || /^market\s+overall$/i.test(line)) {
        // These appear as headers; the vacancy/rent data follows
        // Handled by the market section parser below
      }

      // Submarket vacancy
      if (!data.submarket_vacancy && /^submarket\s+\d.*star$/i.test(line) && next) {
        if (/[\d.]+%/.test(next)) data.submarket_vacancy = next;
      }

      // Market vacancy
      if (!data.market_vacancy && /^market\s+overall$/i.test(line) && next) {
        if (/[\d.]+%/.test(next)) data.market_vacancy = next;
      }
    }

    // Fallback: derive tenant_name from building_name when it contains a known tenant indicator
    if (!data.tenant_name && data.building_name) {
      const bn = data.building_name.toLowerCase();
      if (/davita|fresenius|dialysis|va\s|veterans|kidney|renal/.test(bn)) {
        data.tenant_name = data.building_name;
      }
    }

    // ── Parse market data sections separately ───────────────────
    parseMarketData(lines, data);

    return data;
  }

  function parseMarketData(lines, data) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const next = i + 1 < lines.length ? lines[i + 1] : '';

      // Market Asking Rent section
      if (/^market\s+asking\s+rent/i.test(line)) {
        // Look for "Subject Property" and "Market Overall" rows
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          if (/^subject\s+property$/i.test(lines[j]) && lines[j + 1]) {
            if (!data.subject_rent_psf) data.subject_rent_psf = lines[j + 1];
          }
          if (/^market\s+overall$/i.test(lines[j]) && lines[j + 1]) {
            if (!data.market_rent_psf) data.market_rent_psf = lines[j + 1];
          }
        }
        continue;
      }

      // Submarket Leasing Activity
      if (/^submarket\s+leasing\s+activity/i.test(line)) {
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          if (/^12\s*mo\.?\s+leased$/i.test(lines[j]) && lines[j + 1]) {
            if (!data.submarket_12mo_leased) data.submarket_12mo_leased = lines[j + 1];
          }
          if (/^months\s+on\s+market$/i.test(lines[j]) && lines[j + 1]) {
            if (!data.submarket_avg_months_on_market) data.submarket_avg_months_on_market = lines[j + 1];
          }
        }
        continue;
      }

      // Submarket Sales Activity
      if (/^submarket\s+sales\s+activity/i.test(line)) {
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          if (/^12\s*mo\.?\s+sales\s+volume$/i.test(lines[j]) && lines[j + 1]) {
            if (!data.submarket_12mo_sales_volume) data.submarket_12mo_sales_volume = lines[j + 1];
          }
          if (/^market\s+sale\s+price/i.test(lines[j]) && lines[j + 1]) {
            if (!data.market_sale_price_psf) data.market_sale_price_psf = lines[j + 1];
          }
        }
        continue;
      }

      // Vacancy Rates section
      if (/^vacancy\s+rates$/i.test(line)) {
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          if (/^subject\s+property$/i.test(lines[j]) && lines[j + 1]) {
            if (!data.subject_vacancy && /[\d.]+%/.test(lines[j + 1])) data.subject_vacancy = lines[j + 1];
          }
          if (/^submarket\s+\d/i.test(lines[j]) && lines[j + 1]) {
            if (!data.submarket_vacancy && /[\d.]+%/.test(lines[j + 1])) data.submarket_vacancy = lines[j + 1];
          }
          if (/^market\s+overall$/i.test(lines[j]) && lines[j + 1]) {
            if (!data.market_vacancy && /[\d.]+%/.test(lines[j + 1])) data.market_vacancy = lines[j + 1];
          }
        }
        continue;
      }
    }
  }

  // ── Tenant extraction ──────────────────────────────────────────────────
  //
  // Parses tenant data from:
  //   "Tenants at Sale" section: Name, SF, lease dates
  //   "Tenants" / "Tenant Detail" tabs: more detailed lease info
  //   "Stacking Plan" tabs: floor-by-floor tenant breakdown

  // CoStar UI elements that appear in tenant sections but are NOT tenant names
  const COSTAR_UI_REJECT = /^(name|source:.*|costar.*research|directory|stacking\s+plan|available|moving\s+(out|in)|show|both|tenant|industry|floor|sf\s+occupied|move\s+date|exp\s+date|lease\s+(start|type|term)|rent\/?sf|my\s+data|shared\s+data|direct|office|retail|industrial|sublease|status|vacant|occupied|renewal|expiring|current|historical|all|none|sort|filter|search|export|print|map|list|grid|table|view|collapse|expand|details|summary|overview|edit|add|remove|save|cancel|close|back|next|prev|more|less|total|subtotal|avg|min|max|moved\s+out|confirmed)$/i;

  function extractTenants(lines) {
    const tenants = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // "Tenants at Sale" section
      if (/^tenants?\s+at\s+sale$/i.test(line)) {
        parseTenantSection(lines, i + 1, tenants);
        continue;
      }

      // "Tenant Detail" section on lease tab
      if (/^tenant\s+detail$/i.test(line)) {
        parseTenantSection(lines, i + 1, tenants);
        continue;
      }
    }

    return tenants;
  }

  function parseTenantSection(lines, startIdx, tenants) {
    let current = null;

    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];

      // Stop at next major section
      if (/^(seller|buyer|listing|building|land\b|market|public\s+record|my\s+notes|sources|sale\s+comp|©|contacts)/i.test(line)) break;

      // Skip CoStar UI elements
      if (COSTAR_UI_REJECT.test(line)) continue;

      // Skip lines that are just dates (month/year) — these are column values, not names
      if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}$/i.test(line)) continue;

      // SF value (often follows tenant name): "8,750" or "8,750 SF"
      if (/^[\d,]+(\s*sf)?$/i.test(line)) {
        if (current) current.sf = line.replace(/\s*sf\s*$/i, '').trim() + ' SF';
        continue;
      }

      // Lease dates
      if (/^lease\s+(start|commenced?)$/i.test(line) && lines[j + 1]) {
        if (current) current.lease_start = lines[j + 1];
        j++; continue;
      }
      if (/^lease\s+expir(ation|es)$/i.test(line) && lines[j + 1]) {
        if (current) current.lease_expiration = lines[j + 1];
        j++; continue;
      }
      if (/^lease\s+(type|term)$/i.test(line) && lines[j + 1]) {
        if (current) current.lease_type = lines[j + 1];
        j++; continue;
      }
      if (/^rent\/?sf$/i.test(line) && lines[j + 1]) {
        if (current) current.rent_per_sf = lines[j + 1];
        j++; continue;
      }

      // Tenant name: anything else that's a reasonable-length text line
      // Reject CoStar field labels that appear in Lease/Sale tabs
      const TENANT_SECTION_REJECT = /^(industry|sector|property\s+type|property\s+subtype|secondary\s+type|building\s+class|construction|year\s+built|year\s+renovated|lot\s+size|zoning|parking|stories|floors|typical\s+floor|ceiling\s+height|tenancy|single\s+tenant|multi.tenant|net\s+lease|gross\s+lease|nnn|modified\s+gross|submarket|market|market\s+data|analytics|reports|demographics|transit|walk\s+score|name|source|available|vacant|none|sf|sf\s+occupied|directory|stacking\s+plan|leasing|for\s+lease|for\s+sale|lease\s+type|lease\s+term|rent\/?sf|move\s+date|exp\s+date|floor|assessment|investment|research|my\s+notes|contacts|data|verified|confirmed)$/i;
      if (line.length > 2 && line.length < 80 && /^[A-Z]/.test(line) &&
          !/^\d/.test(line) && !/@/.test(line) && !/^https?:/i.test(line) &&
          !TENANT_SECTION_REJECT.test(line)) {
        // Push previous tenant
        if (current && current.name) {
          if (!tenants.some((t) => t.name === current.name)) tenants.push(current);
        }
        current = { name: line };
        continue;
      }
    }

    if (current && current.name) {
      if (!tenants.some((t) => t.name === current.name)) tenants.push(current);
    }
  }

  // ── Contact extraction ────────────────────────────────────────────────
  //
  // CoStar page structure:
  //   Seller section:      "Seller" → "Recorded Seller" → "Entity Name"
  //   Buyer section:       "Buyer" → info or "Buyer information not available"
  //   Listing Broker:      "Listing Broker" → [logo, Name, Title, phones, email] × N
  //   Buyer Broker:        "Buyer Broker" → people or "No Buyer Broker on Deal"
  //   After brokers:       "My Notes" / "Sources & Research" (STOP here)

  // Shared reject pattern for strings that should never be treated as a contact name.
  // Covers: city/state/zip lines, date strings ("Since ..."), role labels,
  // job titles when standalone, CoStar UI chrome, and address fragments.
  const CONTACT_NAME_REJECT = /^(since\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|since\s+\d|seller\s*$|buyer\s*$|buyer\s+contacts?|seller\s+contacts?|investment\s+manager|research\s+consultant|other\s*[-–—]\s*private|president|vice\s+president|officer|director|manager|analyst|consultant|partner|principal|agent|broker|owner|lender|not\s+disclosed|not\s+available|no\s+buyer|no\s+seller|confirmed|verified|research\s+complete|comp\s+status|united\s+states|[a-z].*,\s*[a-z]{2}\s+\d{5}|logo|source|add\s+notes|name$)/i;

  // Reject city/state/zip patterns like "Saint Louis, MO 63125"
  function isContactNameGarbage(s) {
    if (!s || s.length < 2) return true;
    if (CONTACT_NAME_REJECT.test(s.trim())) return true;
    // City, ST ZIP pattern (e.g. "Los Angeles, CA 90048")
    if (/^[A-Z][a-z]+.*,\s*[A-Z]{2}\s+\d{4,5}/.test(s)) return true;
    // Concatenated multi-line address (contains ZIP mid-string with no break)
    if (/\b\d{5}\b.*\b(united\s+states|us)\b/i.test(s)) return true;
    // "One Financial CenterBoston" — address concatenation artifact
    if (/\d{5}[A-Z]/.test(s)) return true;
    // Standalone date patterns
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d/i.test(s)) return true;
    return false;
  }

  function extractContacts(lines) {
    const contacts = [];
    let currentGroupBuyer  = null;
    let currentGroupSeller = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // ── STOP at end-of-content sections ───────────────────────
      if (/^(my\s+notes|sources|verification|sale\s+comp\s+id|©\s*\d{4}|by\s+using\s+this|costar\s+comp|last\s+updated|report\s+an\s+error|publication\s+date)/i.test(line)) break;

      // ── Current Owner marks a new transaction group ──────────
      if (/^current\s+owner$/i.test(line)) {
        currentGroupBuyer  = null;
        currentGroupSeller = null;
      }

      // ── Recorded Owner → entity with mailing address ────────
      if (/^recorded\s+owner$/i.test(line)) {
        const next = lines[i + 1];
        if (next && next.length > 2 && next.length < 80) {
          const owner = { role: 'owner', name: next, type: 'entity' };
          // Look ahead for ownership type and mailing address
          for (let k = i + 2; k < Math.min(i + 8, lines.length); k++) {
            const ol = lines[k];
            if (/^ownership\s+type$/i.test(ol) && lines[k + 1]) { owner.ownership_type = lines[k + 1]; }
            if (/^mailing\s+address$/i.test(ol)) {
              owner.address = findEntityAddress(lines, k + 1);
            }
          }
          contacts.push(owner);
        }
        continue;
      }

      // ── Recorded Seller → entity name ─────────────────────────
      if (/^recorded\s+seller$/i.test(line)) {
        const next = lines[i + 1];
        if (next && next.length > 2 && next.length < 80 && !/^buyer/i.test(next)) {
          currentGroupSeller = next;
          contacts.push({ role: 'seller', name: next, type: 'entity' });
        }
        continue;
      }

      // ── Recorded Buyer → entity name ──────────────────────────
      if (/^recorded\s+buyer$/i.test(line)) {
        const next = lines[i + 1];
        if (next && next.length > 2 && next.length < 80 && !/^(buyer|no\s+|not\s+)/i.test(next)) {
          currentGroupBuyer = next;
          contacts.push({ role: 'buyer', name: next, type: 'entity' });
        }
        continue;
      }

      // ── True Buyer ─────────────────────────────────────────────
      if (/^true\s+buyer$/i.test(line)) {
        const { entity, individuals } = parseEntityBlock(lines, i + 1);
        if (entity.name) {
          contacts.push({
            role: 'true_buyer',
            name: entity.name,
            type: 'organization',
            address: entity.address || null,
            city: entity.city || null,
            state: entity.state || null,
            zip: entity.zip || null,
            phone: entity.phone || null,
            email: entity.email || null,
            website: entity.website || null,
            sale_buyer:  currentGroupBuyer,
            sale_seller: currentGroupSeller,
          });
          // Individual contacts within the true buyer org
          for (const ind of individuals) {
            contacts.push({
              ...ind,
              role: 'true_buyer_contact',
              company: entity.name,
              sale_buyer:  currentGroupBuyer,
              sale_seller: currentGroupSeller,
            });
          }
        }
        continue;
      }

      // ── True Seller ────────────────────────────────────────────
      if (/^true\s+seller$/i.test(line)) {
        const { entity, individuals } = parseEntityBlock(lines, i + 1);
        if (entity.name) {
          contacts.push({
            role: 'true_seller',
            name: entity.name,
            type: 'organization',
            address: entity.address || null,
            city: entity.city || null,
            state: entity.state || null,
            phone: entity.phone || null,
            email: entity.email || null,
            website: entity.website || null,
            sale_buyer:  currentGroupBuyer,
            sale_seller: currentGroupSeller,
          });
          for (const ind of individuals) {
            contacts.push({
              ...ind,
              role: 'true_seller_contact',
              company: entity.name,
              sale_buyer:  currentGroupBuyer,
              sale_seller: currentGroupSeller,
            });
          }
        }
        continue;
      }

      // ── Listing Broker section → parse person blocks ──────────
      if (/^listing\s+broker$/i.test(line)) {
        const peek = lines[i + 1];
        if (peek && /^(no\s+|not\s+available)/i.test(peek)) continue;
        const people = parsePersonBlocks(lines, i + 1);
        for (const p of people) {
          p.role = 'listing_broker';
          p.sale_buyer  = currentGroupBuyer;
          p.sale_seller = currentGroupSeller;
          contacts.push(p);
        }
        continue;
      }

      // ── Buyer Broker section → parse person blocks ────────────
      if (/^buyer\s+broker$/i.test(line)) {
        const peek = lines[i + 1];
        if (peek && /^(no\s+|not\s+available)/i.test(peek)) continue;
        const people = parsePersonBlocks(lines, i + 1);
        for (const p of people) {
          p.role = 'buyer_broker';
          p.sale_buyer  = currentGroupBuyer;
          p.sale_seller = currentGroupSeller;
          contacts.push(p);
        }
        continue;
      }

      // ── Lender section ────────────────────────────────────────
      if (/^lender$/i.test(line)) {
        const peek = lines[i + 1];
        if (peek && /^(no\s+|not\s+available)/i.test(peek)) continue;
        const people = parsePersonBlocks(lines, i + 1);
        for (const p of people) { p.role = 'lender'; contacts.push(p); }
        continue;
      }
    }

    return contacts;
  }

  // Parse a True Buyer / True Seller entity block: a company line followed
  // by address, phones, website, and optional individual contacts.
  function parseEntityBlock(lines, startIdx) {
    const entity = {};
    const individuals = [];
    let current = null;

    function isPhone(s) { return /^\(?\d{3}\)?\s*[-.]?\s*\d{3}[-.]?\d{4}/.test(s); }
    function isEmail(s) { return /@/.test(s) && /\.\w{2,}$/.test(s); }
    function isURL(s)   { return /^(https?:\/\/|www\.)/i.test(s); }
    function isAddress(s) { return /^\d+\s+\w+/.test(s); }
    function isCityState(s) { return /^[A-Za-z].*,\s*[A-Z]{2}\s+\d{5}/.test(s); }

    // Stop at the next contact group OR any CoStar comp detail section
    const STOP_PATTERN = /^(true\s+(buyer|seller)|recorded\s+(buyer|seller|owner)|listing\s+broker|buyer\s+broker|current\s+owner|lender|transaction\s+details|market\s+at\s+sale|building$|land$|vacancy\s+rates|market\s+asking\s+rent|submarket\s+(leasing|sales)|public\s+record|assessment\s+at\s+sale|documents|my\s+notes|sources|verification|©\s*\d{4}|by\s+using\s+this|comp\s+status|research\s+complete|last\s+updated|report\s+an\s+error|comparable|building\s+summary|building\s+information|market\s+at\s+sale|lease\s+information|investment\s+highlights)/i;

    // Reject lines that are CoStar UI labels/data values, not entity info
    const COSTAR_UI_LABELS = /^(country\s+of\s+origin|buyer\s+origin|seller\s+origin|buyer\s+type|seller\s+type|secondary\s+type|activity\s+\(last|sale\s+date|sale\s+price|price\/sf|price\s+status|hold\s+period|recording\s+date|sale\s+type|document\s+#|comp\s+status|seller\s+contacts|[\d]\s+star|star\s+office|national|institutional|private|individual|other\/unknown)/i;

    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];
      // Stop at next major section
      if (STOP_PATTERN.test(line)) break;
      // Safety limit: don't consume more than 25 lines
      if (j - startIdx > 25) break;
      if (/^United States$/i.test(line)) continue;
      if (COSTAR_UI_LABELS.test(line)) continue;

      if (!entity.name) {
        // First real line = company name
        if (line.length > 1 && line.length < 80 && /^[A-Z]/.test(line)
            && !isPhone(line) && !isEmail(line) && !isURL(line)) {
          entity.name = line;
        }
        continue;
      }

      if (isPhone(line)) {
        // Strip (p)/(f) suffix — keep first phone on entity, rest on current person
        const phone = line.replace(/\s*\([pPfFmMwW]\)\s*$/, '').trim();
        if (!entity.phone) entity.phone = phone;
        else if (current) {
          if (!current.phones) current.phones = [];
          current.phones.push(phone);
        }
        continue;
      }
      if (isEmail(line)) {
        if (current) current.email = line.trim();
        else entity.email = line.trim();
        continue;
      }
      if (isURL(line)) { entity.website = line.trim(); continue; }
      if (isAddress(line)) { entity.address = line.trim(); continue; }
      if (isCityState(line)) {
        // Parse "Chicago, IL 60606"
        const m = line.match(/^(.+),\s*([A-Z]{2})\s+(\d{5})/);
        if (m) { entity.city = m[1].trim(); entity.state = m[2]; entity.zip = m[3]; }
        continue;
      }

      // A name-like line after entity is established = individual contact
      if (/^[A-Z][a-z]/.test(line) && line.length < 60
          && !isPhone(line) && !isEmail(line) && !isURL(line)
          && !isCityState(line) && !isAddress(line)
          && !isContactNameGarbage(line)) {
        if (current) individuals.push(current);
        current = { name: line, type: 'person' };
        continue;
      }
    }
    if (current) individuals.push(current);

    return { entity, individuals };
  }

  // Parse person/company blocks. Does NOT rely on "logo" separators (they
  // get concatenated in innerText). Instead detects a new person when a
  // name-like line appears after the current person already has contact info.
  function parsePersonBlocks(lines, startIdx) {
    const people = [];
    let current = null;

    function pushCurrent() {
      if (current && current.name) people.push(current);
      current = null;
    }

    function isPhone(s) { return /^\(?\d{3}\)?\s*[-.]?\s*\d{3}[-.]?\d{4}/.test(s); }
    function isEmail(s) { return /@/.test(s) && /\.\w{2,}$/.test(s) && !s.startsWith('http'); }
    function isURL(s) { return /^https?:\/\//i.test(s) || /^www\./i.test(s); }
    function isAddress(s) { return /^[A-Z][a-z]+.*,\s*[A-Z]{2}\s+\d{5}/.test(s); }
    function isStreet(s) { return /^\d+\s+\w+.*\b(st|street|ave|blvd|rd|dr|suite|ste|pkwy)\b/i.test(s); }
    function hasContactInfo(p) { return p && (p.email || (p.phones && p.phones.length)); }

    function isNameLine(s) {
      if (s.length < 3 || s.length > 60) return false;
      if (/^\(/.test(s) || /@/.test(s) || /^\d/.test(s)) return false;
      if (isURL(s) || isPhone(s) || isEmail(s)) return false;
      if (/^(no\s+|source:|add\s+notes|name$|united states)/i.test(s)) return false;
      if (/^[a-z]/.test(s)) return false; // must start with capital
      // Reject page footer / CoStar chrome
      if (/^(©|by\s+using|costar\s+(comp|group|est)|last\s+updated|report\s+an|publication|verification|all\s+rights|terms\s+of)/i.test(s)) return false;
      // Reject garbage contact names (addresses, dates, role labels, titles)
      if (isContactNameGarbage(s)) return false;
      if (isAddress(s)) return false;
      return true;
    }

    function isTitleLine(s) {
      return /director|manager|analyst|advisor|associate|vp\b|president|officer|agent|broker|partner|principal|senior|managing|consultant/i.test(s);
    }

    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];

      // Stop at section boundaries and page footer content
      if (/^(transaction\s+details|building|land\b|market|tenants?\s+at|public\s+record|my\s+notes|sources|verification|sale\s+comp|comparable|recorded\s+(seller|buyer)|lender|©\s*\d{4}|by\s+using\s+this|costar\s+comp|last\s+updated|report\s+an\s+error|publication\s+date)/i.test(line)) break;
      // Stop at other contact section headers (but not sub-labels within)
      if (/^(seller|buyer\s+broker|listing\s+(broker|agent))$/i.test(line) && j > startIdx) break;

      // Handle "logo" as separator — both standalone and concatenated
      if (/^logo$/i.test(line)) { pushCurrent(); continue; }
      if (/^logo[A-Z]/i.test(line)) {
        pushCurrent();
        const afterLogo = line.replace(/^logo\s*/i, '').trim();
        if (afterLogo.length > 2) current = { name: afterLogo, type: 'person' };
        continue;
      }

      // Skip non-content lines
      if (isURL(line)) { if (current) current.website = line.trim(); continue; }
      if (/^United States$/i.test(line)) continue;
      if (isAddress(line)) continue;
      if (isStreet(line)) continue;

      // Email — assign to current person
      if (isEmail(line)) {
        if (current && !current.email) current.email = line.trim();
        continue;
      }

      // Phone — assign to current person
      if (isPhone(line)) {
        if (current) {
          if (!current.phones) current.phones = [];
          current.phones.push(line.replace(/\s*\([pmwf]\)\s*$/i, '').trim());
        }
        continue;
      }

      // Name-like line
      if (isNameLine(line)) {
        // Current person already has contact info → they're complete, start new
        if (hasContactInfo(current)) {
          pushCurrent();
          current = { name: line, type: 'person' };
          continue;
        }

        // No current person → start new
        if (!current) {
          current = { name: line, type: 'person' };
          continue;
        }

        // Current person has name but no contact info yet → title or new person?
        if (!current.title && isTitleLine(line)) {
          current.title = line;
          continue;
        }

        // Has name + title already → probably a new person (or company)
        if (current.title) {
          pushCurrent();
          current = { name: line, type: 'person' };
          continue;
        }

        // Name but no title, and this line doesn't look like a title → new person
        pushCurrent();
        current = { name: line, type: 'person' };
        continue;
      }
    }

    pushCurrent();
    return people;
  }

  // ── DOM-based contact extraction ──────────────────────────────────────
  // CoStar renders some emails/phones only as mailto:/tel: icon links with
  // no visible text, which innerText scanning misses. This function queries
  // the DOM for contact section headers and their associated contact blocks,
  // extracting emails from mailto: hrefs and phones from tel: hrefs.
  // Returns an array of contacts with roles, or empty array if DOM querying
  // finds nothing (caller falls back to text-based parsing).

  // Map section header text → contact role
  const SECTION_ROLE_MAP = [
    [/^true\s+buyer$/i,       'true_buyer_contact'],
    [/^true\s+seller$/i,      'true_seller_contact'],
    [/^recorded\s+buyer$/i,   'buyer'],
    [/^recorded\s+seller$/i,  'seller'],
    [/^listing\s+broker$/i,   'listing_broker'],
    [/^buyer\s+broker$/i,     'buyer_broker'],
    [/^lender$/i,             'lender'],
    [/^recorded\s+owner$/i,   'owner'],
    [/^current\s+owner$/i,    'owner'],
  ];

  function roleFromHeader(headerText) {
    const t = (headerText || '').trim();
    for (const [re, role] of SECTION_ROLE_MAP) {
      if (re.test(t)) return role;
    }
    return null;
  }

  function extractContactsFromDOM() {
    const contacts = [];

    // Find all mailto: links on the page — if none, DOM extraction won't help
    const allMailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
    const allTelLinks    = document.querySelectorAll('a[href^="tel:"]');
    if (allMailtoLinks.length === 0 && allTelLinks.length === 0) return contacts;

    // Find contact section headers in the page. CoStar uses text labels like
    // "True Buyer", "Listing Broker", etc. as section dividers.
    const sectionHeaders = [];
    const allElements = document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p,td,th,label');
    for (const el of allElements) {
      // Only consider elements whose own direct text matches a role header
      // (skip containers whose children happen to contain the text)
      const ownText = getOwnText(el).trim();
      const role = roleFromHeader(ownText);
      if (role) {
        sectionHeaders.push({ element: el, role, text: ownText });
      }
    }
    if (sectionHeaders.length === 0) return contacts;

    // For each section header, find the containing block and extract contacts
    for (const header of sectionHeaders) {
      // Walk up to find the section container (the card/panel holding this group)
      const container = findContactContainer(header.element);
      if (!container) continue;

      // Find individual contact blocks within this container
      // CoStar often uses divs with "logo" images as separators between people
      const contactBlocks = findContactBlocks(container, header.element);

      for (const block of contactBlocks) {
        const person = extractPersonFromBlock(block);
        if (person && person.name) {
          person.role = header.role;
          contacts.push(person);
        }
      }
    }

    return contacts;
  }

  // Get an element's own text (excluding children's text)
  function getOwnText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    }
    return text;
  }

  // Walk up from a section header to find its containing block
  function findContactContainer(headerEl) {
    let el = headerEl;
    for (let i = 0; i < 5; i++) {
      el = el.parentElement;
      if (!el || el === document.body) return null;
      // A good container has mailto or tel links inside it
      if (el.querySelector('a[href^="mailto:"],a[href^="tel:"]')) return el;
    }
    return null;
  }

  // Within a container, find blocks that each represent a single contact.
  // Try common DOM patterns: list items, cards, then fall back to grouping
  // around mailto/tel links.
  function findContactBlocks(container, headerEl) {
    // Strategy 1: look for structured list items or card-like elements
    const cards = container.querySelectorAll(
      'li, [class*="contact"], [class*="person"], [class*="broker"], [class*="card"]'
    );
    // Filter out cards that are ancestors of headerEl or the header itself
    const validCards = Array.from(cards).filter(c =>
      !c.contains(headerEl) && c !== headerEl &&
      (c.querySelector('a[href^="mailto:"],a[href^="tel:"]') ||
       c.textContent.length > 5)
    );
    if (validCards.length > 0) return validCards;

    // Strategy 2: group by mailto/tel link ancestry — each link's nearest
    // common container with a name-like text is a contact block
    const linkEls = container.querySelectorAll('a[href^="mailto:"],a[href^="tel:"]');
    const blocks = [];
    const seen = new Set();
    for (const link of linkEls) {
      // Walk up to a reasonable parent that contains name + contact info
      let block = link.parentElement;
      for (let i = 0; i < 4; i++) {
        if (!block || block === container) break;
        const text = block.textContent || '';
        // Stop when we find a block with enough text to contain a name
        if (text.length > 10 && text.length < 500) break;
        block = block.parentElement;
      }
      if (block && block !== container && !seen.has(block)) {
        seen.add(block);
        blocks.push(block);
      }
    }
    return blocks;
  }

  // Extract a person's name, email, phone from a DOM block
  function extractPersonFromBlock(block) {
    const person = { type: 'person' };

    // Email from mailto: link (primary goal of DOM extraction)
    const emailEl = block.querySelector('a[href^="mailto:"]');
    if (emailEl) {
      const raw = emailEl.href.replace(/^mailto:/i, '').split('?')[0].trim();
      if (raw && /@/.test(raw) && /\.\w{2,}$/.test(raw)) {
        person.email = raw;
      }
    }

    // Phone from tel: link
    const telEl = block.querySelector('a[href^="tel:"]');
    if (telEl) {
      const raw = telEl.href.replace(/^tel:/i, '').replace(/\s+/g, '').trim();
      if (raw && /\d{7,}/.test(raw.replace(/\D/g, ''))) {
        person.phones = [raw];
      }
    }
    // Also check for phone text patterns not in tel: links
    if (!person.phones) {
      const phonePattern = /\(?\d{3}\)?\s*[-.]?\s*\d{3}[-.]?\d{4}/;
      const text = block.textContent || '';
      const phoneMatch = text.match(phonePattern);
      if (phoneMatch) person.phones = [phoneMatch[0].trim()];
    }

    // Name: look for prominent text elements (strong, heading, first link)
    const nameEl = block.querySelector(
      'strong, b, h3, h4, h5, [class*="name"], [class*="Name"]'
    );
    if (nameEl) {
      const candidate = nameEl.textContent.replace(/\s+/g, ' ').trim();
      if (candidate.length >= 3 && candidate.length <= 60 &&
          /^[A-Z]/.test(candidate) && !/@/.test(candidate) &&
          !/^\d/.test(candidate) && !/^(logo|http)/i.test(candidate) &&
          !isContactNameGarbage(candidate)) {
        person.name = candidate;
      }
    }

    // Fallback name: use block's own text, take first name-like line
    if (!person.name) {
      const lines = (block.textContent || '').split('\n')
        .map(l => l.replace(/\s+/g, ' ').trim())
        .filter(l => l.length >= 3 && l.length <= 60);
      for (const line of lines) {
        if (/^[A-Z][a-z]/.test(line) && !/@/.test(line) &&
            !/^\d/.test(line) && !/^(logo|http|www\.)/i.test(line) &&
            !/^(no\s+|source:|united states)/i.test(line) &&
            !isContactNameGarbage(line)) {
          person.name = line;
          break;
        }
      }
    }

    // Title: look for job title patterns
    const text = block.textContent || '';
    const titleMatch = text.match(/\b((?:Senior|Managing|Executive|Vice|Chief)\s+)?(?:Director|Manager|Analyst|Advisor|Associate|VP|President|Officer|Agent|Broker|Partner|Principal|Consultant)\b/i);
    if (titleMatch) {
      // Get the full line containing the title
      const titleLines = text.split('\n').map(l => l.trim()).filter(l =>
        new RegExp(titleMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(l)
      );
      if (titleLines.length > 0 && titleLines[0].length < 80) {
        person.title = titleLines[0];
      }
    }

    return person;
  }

  // Enrich text-parsed contacts with DOM-based email/phone data.
  // For each contact missing an email or phone, find the closest mailto:/tel:
  // link by walking up from the link to check if the contact's name appears
  // in a nearby ancestor container.
  function enrichContactsFromDOM(contacts) {
    if (!contacts || contacts.length === 0) return;

    const mailtoEls = document.querySelectorAll('a[href^="mailto:"]');
    const telEls    = document.querySelectorAll('a[href^="tel:"]');
    if (mailtoEls.length === 0 && telEls.length === 0) return;

    // Build { email/phone, element } entries
    const mailtoEntries = [];
    for (const el of mailtoEls) {
      const email = el.href.replace(/^mailto:/i, '').split('?')[0].trim();
      if (email && /@/.test(email) && /\.\w{2,}$/.test(email)) {
        mailtoEntries.push({ value: email, element: el });
      }
    }
    const telEntries = [];
    for (const el of telEls) {
      const phone = el.href.replace(/^tel:/i, '').replace(/\s+/g, '').trim();
      if (phone && /\d{7,}/.test(phone.replace(/\D/g, ''))) {
        telEntries.push({ value: phone, element: el });
      }
    }

    for (const contact of contacts) {
      if (!contact.name) continue;

      // Enrich missing email
      if (!contact.email && contact.type === 'person') {
        for (const entry of mailtoEntries) {
          if (nameInAncestor(contact.name, entry.element)) {
            contact.email = entry.value;
            break;
          }
        }
      }

      // Enrich missing phone
      if ((!contact.phones || contact.phones.length === 0) && contact.type === 'person') {
        for (const entry of telEntries) {
          if (nameInAncestor(contact.name, entry.element)) {
            if (!contact.phones) contact.phones = [];
            contact.phones.push(entry.value);
            break;
          }
        }
      }
    }
  }

  // Check if a contact name appears in an ancestor of the given element
  function nameInAncestor(name, el) {
    let ancestor = el.parentElement;
    for (let depth = 0; ancestor && depth < 6; depth++) {
      if ((ancestor.textContent || '').includes(name)) return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  }

  // ── Document links extraction (deeds, OMs, brochures) ────────────────

  function inferDocType(label) {
    const lower = (label || '').toLowerCase();
    if (lower.includes('deed')) return 'deed';
    if (lower.includes('om') || lower.includes('offering')
        || lower.includes('memorandum')) return 'om';
    if (lower.includes('brochure')) return 'brochure';
    if (lower.includes('lease')) return 'lease';
    if (lower.includes('survey') || lower.includes('plat')) return 'survey';
    return 'other';
  }

  function extractDocumentLinks() {
    const docLinks = [];
    try {
      // Strategy 1: Find by DOM selectors (CoStar uses various class patterns)
      let docContainer = document.querySelector(
        '[class*="document"], [data-testid*="document"]'
      );

      // Strategy 2: Walk headings to find "Documents" and grab next sibling
      if (!docContainer) {
        const headings = document.querySelectorAll(
          'h1, h2, h3, h4, h5, h6, [class*="heading"], [class*="title"]'
        );
        for (const h of headings) {
          if (/^\s*documents\s*$/i.test(h.textContent)) {
            docContainer = h.nextElementSibling
              || h.closest('section')
              || h.parentElement;
            break;
          }
        }
      }

      if (docContainer) {
        docContainer.querySelectorAll('a[href]').forEach(a => {
          const label = a.textContent?.trim() || a.getAttribute('title') || '';
          const href = a.href;
          if (href && !href.startsWith('javascript:') && label) {
            docLinks.push({
              label,
              url: href,
              type: inferDocType(label),
            });
          }
        });
      }
    } catch (err) {
      console.warn('[LCC CoStar] document link extraction error:', err);
    }
    return docLinks;
  }

  // ── Sales history extraction ──────────────────────────────────────────

  function extractSalesHistory(lines) {
    const sales = [];

    // Parse Transaction Details block (current sale)
    for (let i = 0; i < lines.length; i++) {
      if (/^transaction\s+details$/i.test(lines[i])) {
        const sale = parseTransactionBlock(lines, i + 1);
        if (sale && (sale.sale_date || sale.sale_price)) {
          sale.is_current = true;
          sales.push(sale);
        }
        break;
      }
    }

    // Parse Sale/Loan History from Public Records popup
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/^sale\/?loan\s+history/i.test(line) || /historic\s+sale\s+loan\s+records/i.test(line)) {
        const deedSales = parseDeedHistory(lines, i + 1);
        sales.push(...deedSales);
        break;
      }
    }

    // Also check for Prior Sales / Sales History section
    for (let i = 0; i < lines.length; i++) {
      if (/^(sales?\s+history|prior\s+sales?|transaction\s+history)$/i.test(lines[i])) {
        // Skip if we already captured deed history
        if (sales.some((s) => !s.is_current)) break;
        const historicSales = parseHistoricSalesSection(lines, i + 1);
        sales.push(...historicSales);
        break;
      }
    }

    return sales;
  }

  function parseTransactionBlock(lines, startIdx) {
    const sale = {};
    for (let j = startIdx; j < Math.min(startIdx + 40, lines.length); j++) {
      const line = lines[j];
      const next = j + 1 < lines.length ? lines[j + 1] : '';

      if (/^(public\s+record|building|land\b|market|tenants?|seller|buyer\s*$|listing)/i.test(line)) break;

      if (/^sale\s+date$/i.test(line) && next) sale.sale_date = next;
      if (/^sale\s+price$/i.test(line) && next) sale.sale_price = next;
      if (/^asking\s+price$/i.test(line) && /^\$/.test(next)) sale.asking_price = next;
      if (/^(actual\s+)?cap\s+rate$/i.test(line) && /[\d.]+%/.test(next)) sale.cap_rate = next;
      if (/^sale\s+type$/i.test(line) && next) sale.sale_type = next;
      if (/^sale\s+condition$/i.test(line) && next) sale.sale_condition = next;
      if (/^hold\s+period$/i.test(line) && next) sale.hold_period = next;
      if (/^time\s+on\s+market$/i.test(line) && next) sale.time_on_market = next;
      if (/^leased\s+at\s+sale$/i.test(line) && next && /\d+%/.test(next)) sale.leased_at_sale = next;
      if (/^price\s+status$/i.test(line) && next) sale.price_status = next;
      if (/^comp\s+status$/i.test(line) && next) sale.comp_status = next;
      if (/^buyer\s+type$/i.test(line) && next) sale.buyer_type = next;
      if (/^financing\s+type$/i.test(line) && next) sale.financing_type = next;

      // Inline cap rate on summary lines like "Cap: 7.15% · Investment"
      if (!sale.cap_rate && /\bCap:\s*[\d.]+%/i.test(line)) {
        const m = line.match(/\bCap:\s*([\d.]+%)/i);
        if (m) sale.cap_rate = m[1];
      }
    }
    return sale;
  }

  // Parse deed/loan history from CoStar's Public Records popup/tab.
  // Structure per record:
  //   Transaction → Transaction Date, Sale Price, Transaction Type, Deed Type, ...
  //   Sale Contact Details → Buyer (+ Address), Seller (+ Address), Title Company
  //   Loan Details → Origination Date, Loan Amount, Loan Type, Originator, ...
  function parseDeedHistory(lines, startIdx) {
    const sales = [];
    let current = null;

    function pushCurrent() {
      if (current && (current.sale_date || current.sale_price || current.loan_amount)) {
        sales.push(current);
      }
      current = null;
    }

    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];
      const next = j + 1 < lines.length ? lines[j + 1] : '';

      // "Transaction" or truncated "ransaction" marks new record
      if (/^r?transaction$/i.test(line) && !/date|type|details/i.test(next || '____')) {
        pushCurrent();
        current = {};
        continue;
      }

      if (!current) current = {};

      // ── Core transaction fields ───────────────────────────────
      if (/^transaction\s+date$/i.test(line) && next) { current.sale_date = next; continue; }
      if (/^recordation\s+date$/i.test(line) && next) { current.recordation_date = next; continue; }
      if (/^sale\s+price$/i.test(line) && next) { current.sale_price = next; continue; }
      if (/^transaction\s+type$/i.test(line) && next) { current.transaction_type = next; continue; }
      if (/^deed\s+type$/i.test(line) && next) { current.deed_type = next; continue; }
      if (/^sale\s+type$/i.test(line) && next) { current.sale_type = next; continue; }
      if (/^document\s+#$/i.test(line) && next) { current.document_number = next; continue; }

      // ── Sale Contact Details sub-section ──────────────────────
      if (/^sale\s+contact\s+details$/i.test(line)) continue; // just a header

      if (/^buyer$/i.test(line)) {
        // Next line could be the buyer name or "Address"
        if (next && next.length < 80 && !/^(address|seller|title|loan|originator)/i.test(next)) {
          current.buyer = next;
          current.buyer_address = findEntityAddress(lines, j + 2);
        }
        continue;
      }
      if (/^borrower$/i.test(line)) {
        if (next && next.length < 80) {
          if (!current.buyer) current.buyer = next;
        }
        continue;
      }
      if (/^seller$/i.test(line)) {
        if (next && next.length < 80 && !/^(title|buyer|address|lender|loan|originator)/i.test(next)) {
          current.seller = next;
          current.seller_address = findEntityAddress(lines, j + 2);
        }
        continue;
      }
      if (/^title\s+company$/i.test(line) && next && next.length < 80) {
        current.title_company = next;
        continue;
      }

      // ── Loan Details sub-section ──────────────────────────────
      if (/^loan\s+details$/i.test(line)) continue; // just a header
      if (/^(last\s+loan)$/i.test(line)) continue; // section label on owner tab

      if (/^origination\s+date$/i.test(line) && next) { current.loan_origination_date = next; continue; }
      if (/^loan\s+amount$/i.test(line) && next) { current.loan_amount = next; continue; }
      if (/^loan\s+type$/i.test(line) && next) { current.loan_type = next; continue; }
      if (/^(originator|lender)$/i.test(line) && next && next.length < 80) { current.lender = next; continue; }
      if (/^interest\s+rate$/i.test(line) && next) { current.interest_rate = next; continue; }
      if (/^loan\s+term$/i.test(line) && next) { current.loan_term = next; continue; }
      if (/^maturity\s+date$/i.test(line) && next) { current.maturity_date = next; continue; }

      // After the line "Cap: X% · ..." pattern — parse inline cap rate
      if (!current.cap_rate) {
        const capMatch = line.match(/\bCap:\s*([\d.]+%)/i);
        if (capMatch) current.cap_rate = capMatch[1];
      }
    }

    pushCurrent();
    return sales;
  }

  // Look ahead from a position for an address block (street + city/state)
  function findEntityAddress(lines, startIdx) {
    const parts = [];
    for (let k = startIdx; k < Math.min(startIdx + 5, lines.length); k++) {
      const l = lines[k];
      // Skip "Address" label if present
      if (/^address$/i.test(l)) continue;
      // Stop at next section label
      if (/^(seller|buyer|title\s+company|lender|loan|transaction|sale\s+contact|originator|borrower|document)/i.test(l)) break;
      // Collect address lines (street, city/state/zip)
      if (/^\d+\s+\w+/.test(l) || /^[A-Z][a-z]+.*,\s*[A-Z]{2}\s+\d{4,5}/.test(l) ||
          /^(po\s+box|p\.?o\.?\s+box)/i.test(l)) {
        parts.push(l);
      }
    }
    return parts.length ? parts.join(', ') : null;
  }

  function parseHistoricSalesSection(lines, startIdx) {
    const sales = [];
    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];
      if (/^(building|land\b|market|tenants?|public\s+record|my\s+notes)/i.test(line)) break;

      // Date pattern starts a new sale entry
      if (/[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}/.test(line) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) {
        const sale = { sale_date: line };
        for (let k = j + 1; k < Math.min(j + 8, lines.length); k++) {
          const sl = lines[k];
          if (/^\$[\d,]+/.test(sl) && !sale.sale_price) sale.sale_price = sl;
          if (/[\d.]+%/.test(sl) && !sale.cap_rate) sale.cap_rate = sl;
          if (/^(investment|owner.?user|1031|build.?to.?suit)/i.test(sl)) sale.sale_type = sl;

          // After the line "Cap: X% · ..." pattern — parse inline cap rate
          if (!sale.cap_rate) {
            const capMatch = sl.match(/\bCap:\s*([\d.]+%)/i);
            if (capMatch) sale.cap_rate = capMatch[1];
          }
        }
        sales.push(sale);
      }
    }
    return sales;
  }

  // ── LCC Button injection ──────────────────────────────────────────────

  function injectLccButton(headingEl) {
    if (!headingEl) return;
    if (headingEl.parentElement?.querySelector('.lcc-inject-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'lcc-inject-btn';
    btn.textContent = 'LCC Context \u25B8';
    btn.title = 'Open LCC context for this property';
    Object.assign(btn.style, {
      marginLeft: '12px',
      padding: '4px 12px',
      fontSize: '12px',
      fontWeight: '600',
      color: '#1F3864',
      background: '#EBF0FA',
      border: '1px solid #B8C9E8',
      borderRadius: '4px',
      cursor: 'pointer',
      verticalAlign: 'middle',
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    });

    headingEl.parentElement?.appendChild(btn);
  }
})();
