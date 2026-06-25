// ============================================================================
// LCC Assistant — Content Script: CoStar
// Extracts property data from sale comp / property detail pages.
// Uses page-text scanning (innerText) because CoStar's React DOM is too
// deeply nested for reliable sibling/parent traversal.
// ============================================================================

// Round 76dg diagnostic: log at module load. If this line never appears in
// the page console, the content script isn't being injected (manifest /
// permission / CSP issue). If it appears, the script loaded fine and any
// downstream issue is in extract().
console.log('[LCC CoStar] content script loaded at', new Date().toISOString(), 'on', window.location.href);

(function () {
  'use strict';

  // Round 76dg: idempotency guard. The background service worker injects
  // this script programmatically as a backstop when the manifest's static
  // content_scripts entry doesn't fire (an MV3 quirk on SPA routes — Edge
  // and Chrome both skip injection when the page navigates via History
  // API rather than full page load). If the manifest entry already loaded
  // us, this guard prevents a second IIFE from installing duplicate
  // MutationObservers and doubling all extraction work.
  if (window.__lccCoStarLoaded) return;
  window.__lccCoStarLoaded = true;

  let lastDetectedId = null;
  let lastContentLen = 0;
  let extractionTimer = null;

  // Accumulated data: merges across CoStar tab switches and popups
  let accumulated = { contacts: [], sales_history: [], tenants: [] };

  // Auto-pagination state for Public Record sale/loan history
  let paginationInProgress = false;
  let lastPaginatedPage = 0;

  // Round 76ek.d (2026-05-08): separate state for the CMBS Loan Detail
  // page's commentary pager. Scoped per-property: when the URL changes
  // (different property) we reset to 0.
  let commentaryPaginationInProgress = false;
  let lastCommentaryPage = 0;
  let commentaryPropertyKey = null;

  // Round 76de: minimal sendMessage wrapper. Just suppresses console noise
  // when the extension context is invalidated (extension reload mid-session).
  // No kill switch — let the content script keep trying; the page reload
  // is the user's fix path, and we don't want to disable extraction
  // pre-emptively based on Chrome's normal "message port closed" lastError.
  function safeSendMessage(payload) {
    try {
      chrome.runtime.sendMessage(payload, () => {
        // Drain lastError so Chrome doesn't surface
        // "Unchecked runtime.lastError" in the console.
        void (chrome.runtime && chrome.runtime.lastError);
      });
    } catch (err) {
      // Swallow "Extension context invalidated" silently; surface other errors.
      if (!/Extension context invalidated/i.test(err && err.message || '')) {
        console.error('[LCC CoStar] sendMessage failed:', err);
      }
    }
  }

  // ── UW#6 — fetch a document's bytes IN THE PAGE/TAB CONTEXT ─────────────────
  // The CoStar CDN (ahprd1cdn.csgpimgs.com) signed URLs are tied to the LIVE
  // browsing session, which lives in THIS tab — not the background service
  // worker. A SW-initiated cross-site fetch drops the SameSite session cookies,
  // so the SW fetch 401/403'd and byte-capture silently produced nothing. The
  // background worker now asks this content script to fetch first; we return the
  // bytes as base64 (chrome.runtime binary transfer is flaky, base64 is safe).
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (!msg || msg.type !== 'FETCH_DOC_BYTES') return undefined;
    (async () => {
      try {
        const url = msg.url;
        if (!url) { respond({ ok: false, error: 'missing_url' }); return; }
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) { respond({ ok: false, error: 'doc_fetch_failed', status: res.status }); return; }
        const buf = await res.arrayBuffer();
        if (!buf || !buf.byteLength) { respond({ ok: false, error: 'empty_doc' }); return; }
        // ArrayBuffer → base64 (chunked to avoid call-stack limits on big PDFs).
        const u8 = new Uint8Array(buf);
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < u8.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
        }
        respond({
          ok: true,
          base64: btoa(binary),
          mimeType: res.headers.get('content-type') || 'application/pdf',
          sizeBytes: u8.byteLength,
        });
      } catch (e) {
        respond({ ok: false, error: 'doc_fetch_threw', detail: String(e && e.message || e) });
      }
    })();
    return true; // async response
  });

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

    // Round 76dm: skip frames that aren't actually on a CoStar property
    // page. The manifest uses all_frames:true so this script injects into
    // every iframe — including about:blank tracking/ad iframes that CoStar
    // embeds. Without this gate, a frame with no body fires
    // CONTEXT_DETECTED with page_url='about:blank' and address=null, which
    // overwrites the legitimate property context set by the main frame
    // (last-write-wins in chrome.storage.session.pageContext).
    if (!url || url === 'about:blank' || url === 'about:srcdoc') return;
    if (!/^https?:\/\/[^/]*\.costar\.com\//i.test(url)) return;

    let address = null;
    let headingEl = null;
    let headingOccupant = null;

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
      // Round 76dj diagnostic: log when the address-finder runs and
      // what it returns, so we can see in the page console whether the
      // split-line fallback is firing at all on the live page.
      console.log('[LCC CoStar] findAddressInLines →', address, '(of', lines.length, 'lines)');
    }

    if (!address) {
      address = parseAddress(document.title);
      if (address) console.log('[LCC CoStar] parseAddress(title) →', address);
    }

    if (!address) {
      console.log('[LCC CoStar] address still null. title=', document.title, 'firstNumLines=',
        (lines || []).filter(l => /^\d/.test(l)).slice(0, 3));
    } else {
      console.log('[LCC CoStar] resolved address:', address);
    }

    // Round 76 (2026-06-25): capture the heading's OCCUPANT suffix, INDEPENDENT
    // of which path resolved the address. CoStar sale-comp headings are
    // "<address> - <property/occupant name>", e.g.
    // "13838 Buffalo Speedway - State of Texas". parseAddress keeps only the
    // street and drops the suffix — but that suffix is frequently the ONLY
    // government/operator tenant signal on the Summary page (the Tenant tab is
    // separate, and the Sale Notes may not name the tenant). We stash it into
    // building_name (read by the domain classifier) so "State of Texas" →
    // government instead of no_domain. NOTE: this scans ALL h1/h2/h3 rather
    // than relying on the single querySelector('h1') that resolved the address
    // — the property title is often a *second* heading, and the address itself
    // may have resolved via the page-lines / title fallback (headingEl null).
    if (address) {
      const addrFirst = String(address).split(/[,|]/)[0].trim().toLowerCase();
      for (const el of document.querySelectorAll('h1, h2, h3')) {
        const txt = (el.textContent || '').trim();
        if (!txt) continue;
        const segs = txt.split(/\s+[-–—|]\s+/).map((s) => s.trim()).filter(Boolean);
        if (segs.length < 2) continue;
        // The first segment must be the resolved address (the heading that
        // carries "<address> - <occupant>"), so we never grab an unrelated
        // heading's tail.
        const head = segs[0].toLowerCase();
        if (addrFirst && !(head.includes(addrFirst) || addrFirst.includes(head))) continue;
        const tail = segs.slice(1).join(' - ').trim();
        // Guard: a real occupant/property name, not a second address or junk.
        if (tail && tail.length >= 3 && tail.length <= 80 && !/^\d/.test(tail)) {
          headingOccupant = tail;
          console.log('[LCC CoStar] heading occupant →', headingOccupant);
          break;
        }
      }
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
      // Round 76ek.d: reset commentary pager too on property switch
      lastCommentaryPage = 0;
      commentaryPaginationInProgress = false;
      commentaryPropertyKey = null;
    }
    accumulated._address = identifier;

    if (!lines) lines = getPageLines();
    const data = extractFields(lines, url);
    // Fill building_name from the heading occupant suffix when the structured
    // field didn't capture one (the "13838 Buffalo Speedway - State of Texas"
    // gov signal). Fill-blanks only — never clobber a real building name.
    if (headingOccupant && !data.building_name) {
      data.building_name = headingOccupant;
    }
    // Run BOTH contact extractors (DOM-based captures mailto:/tel: icon
    // links; text-based catches older layouts and blocks that don't have
    // explicit contact links) and merge the results. Running only one
    // path leaves gaps — a title rejected by one extractor can still
    // slip through the other — so we merge first, then let the
    // title/garbage filter below run once on the unified set.
    const domContacts  = extractContactsFromDOM();
    const textContacts = extractContacts(lines);
    let contacts = [];
    mergeContacts(contacts, domContacts);
    mergeContacts(contacts, textContacts);
    enrichContactsFromDOM(contacts);
    const salesHistory = extractSalesHistory(lines);
    const tenants = extractTenants(lines);

    // Round 76ex (2026-04-29): historical-asking-price guard, hoisted from
    // extractFields() where it never fired (data.sales_history was always
    // undefined inside that scope). If data.asking_price matches the
    // sale_price of any salesHistory entry that's ≥2 years old (within 2%),
    // null the asking_price — it almost certainly leaked from a historical
    // sale row in /public-record, not a real current-listing price.
    //
    // 5 Route 45 Mannington (2026-04-29): page header showed $4.5M (correct
    // asking) but the parser captured $18,500 from the 1997 DOT easement
    // row. Round 76ew-B's guard was supposed to clear it but ran in the
    // wrong scope. This is the working version.
    try {
      const askingRaw = data && data.asking_price;
      const parsedAsking = (function () {
        if (!askingRaw) return null;
        const n = parseFloat(String(askingRaw).replace(/[$,]/g, ''));
        return Number.isFinite(n) && n >= 1000 ? n : null;
      })();
      if (parsedAsking && Array.isArray(salesHistory) && salesHistory.length > 0) {
        const twoYearsAgoMs = Date.now() - 2 * 365 * 86400 * 1000;
        const matchedOldSale = salesHistory.find(function (s) {
          if (!s) return false;
          const sp = parseFloat(String(s.sale_price || '').replace(/[$,]/g, ''));
          if (!Number.isFinite(sp) || sp <= 0) return false;
          if (Math.abs(sp - parsedAsking) / Math.max(sp, parsedAsking) > 0.02) return false;
          const sd = s.sale_date ? Date.parse(s.sale_date) : null;
          return Number.isFinite(sd) && sd <= twoYearsAgoMs;
        });
        if (matchedOldSale) {
          console.warn('[costar] Round 76ex: clearing asking_price — exact match (≤2%) to a sale ≥2 years old', {
            cleared_asking_price: data.asking_price,
            matched_sale_date:    matchedOldSale.sale_date,
            matched_sale_price:   matchedOldSale.sale_price,
            page_url:             url,
          });
          data.asking_price = null;
          // Also clear the implied price/SF since it derives from asking_price.
          if (data.price_per_sf && /^\$/.test(String(data.price_per_sf))) {
            data.price_per_sf = null;
          }
        }
      }
    } catch (e) {
      console.warn('[costar] Round 76ex historical-asking guard failed (non-fatal):', e && e.message);
    }

    // Round 76dt + 76dz: client-side mirror of the server RBA inference.
    // When the property is single-tenant + 100% leased + RBA known but the
    // tenant's SF wasn't captured, infer leased_area = RBA. Earlier version
    // re-scanned innerText for "Tenancy: Single" / "100% Leased" but
    // CoStar's stat-card layout produces innerText like "Tenancy\nSingle"
    // and "100%\nPercent Leased" (label and value as separate cells),
    // which the regex didn't match. Round 76dz: read from already-extracted
    // fields (data.tenancy_type, data.occupancy, data.square_footage) which
    // extractFields populated above by walking the same lines.
    if (Array.isArray(tenants) && tenants.length === 1 && !tenants[0].sf) {
      // Single-tenancy: extracted into data.tenancy_type or sniffed by line scan
      const tenancyText = String(data.tenancy_type || '').toLowerCase();
      const isSingle = /\bsingle\b/.test(tenancyText)
        || lines.some((l, i) => /^tenancy$/i.test(l.trim()) && /^single$/i.test((lines[i + 1] || '').trim()));
      // 100% leased: extracted into data.occupancy or sniffed
      const occText = String(data.occupancy || '').toLowerCase();
      const fullyLeased = /^100/.test(occText)
        || lines.some((l, i) => /^percent\s+leased$/i.test(l.trim()) && /^100%?$/.test((lines[i + 1] || '').trim()))
        || lines.some((l, i) => /^100%$/.test(l.trim()) && /^percent\s+leased$/i.test((lines[i + 1] || '').trim()));
      // RBA: extracted into data.square_footage by extractFields
      const rba = parseInt(String(data.square_footage || '').replace(/[^\d]/g, ''), 10);
      if (isSingle && fullyLeased && Number.isFinite(rba) && rba >= 100) {
        tenants[0].sf = `${rba.toLocaleString()} SF`;
        console.log(`[LCC CoStar] inferred leased_area=${rba} SF for ${tenants[0].name} (single-tenant + 100% leased + RBA)`);
      } else if (!tenants[0].sf) {
        console.log('[LCC CoStar] leased_area inference skipped:', {
          isSingle, fullyLeased, rba,
          tenancy_type: data.tenancy_type, occupancy: data.occupancy, square_footage: data.square_footage,
        });
      }
    }

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

    // Derive tenant_name from the tenants array. Prefer it over any
    // standalone-label-finder result, since the array goes through the
    // full reject filter chain (OM section headers, NAICS sectors,
    // compound metadata, low-SF plausibility guard) — Bug 76s 2026-04-27.
    // Without this, a 'Tenant\nShow' label/value pair earlier in the page
    // sets tenant_name='Show' and the cleaner array value never wins.
    if (tenants.length > 0 && tenants[0].name) {
      data.tenant_name = tenants[0].name;
    }

    const location = findLocationInLines(lines);

    // ── Merge data into accumulated (route to correct destination) ────────
    //
    // Sale comp pages (/Comp/NNN/) show per-sale values (asking_price, cap_rate,
    // sale_price, noi, etc.) that belong to THAT sale record, not the top-level
    // fields (which represent the current listing / property state).
    //
    // Strategy:
    //   - Sale-specific fields from comp pages → enriched into matching
    //     sales_history entry (keyed by sale_date or comp_id)
    //   - Property-level fields (square_footage, year_built, stories, etc.) →
    //     always merge into top-level accumulated
    //   - Summary/property pages → everything goes top-level as before

    // Fields that are sale-specific and should NOT overwrite top-level when
    // extracted from a historical comp page:
    const SALE_SPECIFIC_FIELDS = [
      'asking_price', 'sale_price', 'sale_date', 'cap_rate', 'noi',
      'price_per_sf', 'occupancy', 'sale_notes_raw',
    ];

    if (data._comp_id) {
      // ── Sale comp page: route sale-specific fields into the sale record ──
      // First merge sales history so we have the Transaction Details entry
      mergeSales(accumulated.sales_history, salesHistory);

      // Build enrichment object from stat card values
      const saleEnrich = {};
      for (const key of SALE_SPECIFIC_FIELDS) {
        if (data[key]) saleEnrich[key] = data[key];
      }
      saleEnrich._comp_id = data._comp_id;

      // Find matching sale record (by date from Transaction Details)
      // The Transaction Details block captures the primary sale for this comp.
      const txnSale = salesHistory.find(s => s.sale_date || s.sale_price);
      const normDate = (s) => {
        if (!s) return '';
        const d = new Date(s);
        return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : s.toLowerCase().trim();
      };
      if (txnSale) {
        const txnDateNorm = normDate(txnSale.sale_date);
        const match = accumulated.sales_history.find(s =>
          normDate(s.sale_date) === txnDateNorm
        );
        if (match) {
          // Enrich sale record with stat card + extracted data
          for (const [k, v] of Object.entries(saleEnrich)) {
            if (v && !match[k]) match[k] = v;
          }
          // Also attach sale_notes and document_links to the sale
          if (data.sale_notes_raw && !match.sale_notes_raw) {
            match.sale_notes_raw = data.sale_notes_raw;
          }
          if (data.document_links?.length) {
            // Tag each document with the sale date so OM ingestion can
            // match by URL even when on the summary page
            const saleDateTag = txnSale?.sale_date || data.sale_date || null;
            match.document_links = data.document_links.map(d => ({
              ...d,
              sale_date: saleDateTag,
            }));
          }
        }
      }

      // Publish the current comp's context so the sidebar can associate
      // OM ingestion with the correct sale record
      accumulated.viewing_comp_id = data._comp_id;
      accumulated.viewing_comp_sale_date = txnSale?.sale_date || data.sale_date || null;

      // Merge property-level fields into top-level (skip sale-specific)
      for (const [key, val] of Object.entries(data)) {
        if (SALE_SPECIFIC_FIELDS.includes(key)) continue;
        if (key.startsWith('_')) continue; // internal flags
        if (val) accumulated[key] = val;
      }
    } else {
      // ── Summary / property page: everything goes top-level ──
      // asking_price from Summary is authoritative for the current listing
      for (const [key, val] of Object.entries(data)) {
        if (key.startsWith('_')) continue;
        if (val) accumulated[key] = val;
      }
      mergeSales(accumulated.sales_history, salesHistory);
      // Clear comp viewing context when not on a comp page
      accumulated.viewing_comp_id = null;
      accumulated.viewing_comp_sale_date = null;
    }

    mergeContacts(accumulated.contacts, contacts);
    // Sanitize: remove contacts with garbage names (addresses, dates, titles, etc.).
    // This filter runs on the FULL merged set (DOM + text + anything
    // already accumulated from prior scans), so newly-added title patterns
    // retroactively purge stale garbage that was stored before the
    // pattern landed. The pass also flags single-token first-name-only
    // captures with name_quality='first_only' instead of letting them
    // through as usable contacts — downstream consumers (sidebar-pipeline
    // contact writer) should route flagged rows to research_queue rather
    // than accept them as resolved names.
    accumulated.contacts = (accumulated.contacts || []).filter(c => {
      if (!c.name) return false;
      if (isContactNameGarbage(c.name)) return false;
      // Reject concatenated address strings (contain ZIP + city run-on)
      if (/\d{5}[A-Z]/.test(c.name)) return false;
      // Reject very short non-names
      if (c.name.length <= 2) return false;
      // Single-token names ("John") — flag for research rather than
      // letting the enricher guess at a full name. Still drop outright
      // when the role is a broker slot we know should always carry a
      // "First Last" name on CoStar's Listing Broker / Buyer Broker
      // panels, since those are the ones that hit sale_brokers.
      if (!/\s/.test(c.name.trim())) {
        const brokerRole = /^(listing_broker|buyer_broker)$/.test(c.role || '')
          || (Array.isArray(c.roles) && c.roles.some(r => /^(listing_broker|buyer_broker)$/.test(r)));
        if (brokerRole) return false;
        c.name_quality = 'first_only';
      }
      return true;
    });
    mergeTenants(accumulated.tenants, tenants);
    if (location.city) accumulated.city = location.city;
    if (location.state) accumulated.state = location.state;
    if (location.zip) accumulated.zip = location.zip;

    // ── Bulk/Portfolio Sale: capture the constituent Properties table ─────────
    // A portfolio Sale Comp page (e.g. "SVEA New Mexico Portfolio: 40 Office &
    // Retail Properties Sold") lists every constituent in a Properties table.
    // Without this the whole 40-property deal collapsed to the one subject
    // address. Parser lives in content/_portfolio-parse.js (loaded before this
    // script; importable in Node tests). Fails closed → [] on a non-portfolio
    // page or an unexpected grid shape. 2026-06-25.
    if (globalThis.__lccPortfolioParse) {
      const portfolioProps = globalThis.__lccPortfolioParse.parsePortfolioProperties(lines);
      if (portfolioProps.length > 1) accumulated.portfolio_properties = portfolioProps;
    }

    // ── Derive top-level sale_date / sale_price from most recent in history ──
    // sales_history is authoritative: always prefer the most recent sale's
    // data over stat-card values, which can show a different (older) sale.
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
        // Always overwrite stat-card sale_date/sale_price with the most
        // recent sales_history entry — CoStar's "Sale Price" stat card
        // sometimes shows a different (older) sale than the most recent.
        if (mostRecent.sale_date) accumulated.sale_date = mostRecent.sale_date;
        // A Bulk/Portfolio sale's price+cap are the DEAL aggregate, not this
        // property's — promoting them stamps the whole-portfolio number onto the
        // single subject property (the $119M SVEA aggregate landing on one
        // $8M building). Keep them on the sales_history row (the deal record)
        // but never promote to the property's top-level fields. 2026-06-25.
        const condStr = String(mostRecent.sale_condition || '').toLowerCase();
        const isPortfolioAgg = /\b(bulk|portfolio)\b/.test(condStr)
          || (accumulated.portfolio_properties && accumulated.portfolio_properties.length > 1);
        if (mostRecent.sale_price && !isPortfolioAgg) accumulated.sale_price = mostRecent.sale_price;
        if (!accumulated.cap_rate && mostRecent.cap_rate && !isPortfolioAgg) accumulated.cap_rate = mostRecent.cap_rate;
      }
    }

    safeSendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'costar',
        entity_type: 'property',
        _version: 25,
        // Round 76cg: never let raw document.title leak through as the
        // address. parseAddress(title) will succeed when the title contains
        // a real address (after stripping 'Properties | ' style prefixes).
        // If both fail, emit null and let the matcher use other signals.
        address: address || parseAddress(document.title),
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

    // Round 76ek.d: Auto-paginate through CMBS Commentary Entries.
    // Each click triggers MutationObserver → re-fires extract() → captures
    // the next visible entry. Backend dedupes by (loan_id, entry_label) so
    // the per-page captures accumulate idempotently.
    autoPageCommentaryEntries();
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

    // Round 76dq: restrict auto-pagination to property-detail URLs.
    // On saved-search result pages (/detail/for-sale/..., /detail/for-lease/...)
    // CoStar shows "1 of 40 Records" in the page header — the prior
    // fallback regex matched that text and auto-clicked the next-record
    // arrow, cycling through the user's saved search without their
    // input. Only run pagination on the property summary detail URL,
    // and only when the matching text is the Sale/Loan history sub-panel
    // (anchored by "Historic Sale" / "Sale/Loan" keywords).
    const url = window.location.href;
    if (!/\/detail\/lookup\/\d+\/summary/i.test(url)) return;

    // Find the pagination indicator text. Only the explicit phrasing
    // "Historic Sale Loan Records" / "Sale/Loan Records" qualifies — the
    // bare "X of Y Records" fallback was too greedy.
    const allText = document.body.innerText;
    const paginationMatch = allText.match(/(\d+)\s+of\s+(\d+)\s+(?:historic\s+)?sale\s*\/?loan\s+records/i);

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

  // ── Round 76ek.d: CMBS Commentary auto-pager ────────────────────────────
  //
  // The CMBS Loan Detail page (/detail/lookup/{N}/loan) shows dated
  // narrative entries with their own paginator: "X of N Commentary Entries".
  // When N > 1 we walk all entries so each one gets captured on its own
  // extract() pass. Backend dedup (loan_commentary UNIQUE on
  // (loan_id, entry_label)) makes per-page sends idempotent.
  //
  // This runs in addition to autoPageSaleLoanHistory(), but the URL guards
  // mean only one of them ever fires per page (sale/loan history is on the
  // /summary tab; commentary is on the /loan tab).
  function autoPageCommentaryEntries() {
    if (commentaryPaginationInProgress) return;

    const url = window.location.href;
    if (!/\/detail\/lookup\/\d+\/loan(?:\/?$|\?|#)/i.test(url)) return;

    // Reset state when the property changes
    const propMatch = url.match(/\/detail\/lookup\/(\d+)\/loan/i);
    const propKey = propMatch ? propMatch[1] : null;
    if (propKey !== commentaryPropertyKey) {
      commentaryPropertyKey = propKey;
      lastCommentaryPage = 0;
    }

    const allText = document.body.innerText;
    const m = allText.match(/(\d+)\s+of\s+(\d+)\s+commentary\s+entries/i);
    if (!m) return;

    const cur = parseInt(m[1], 10);
    const tot = parseInt(m[2], 10);
    if (!Number.isFinite(cur) || !Number.isFinite(tot) || tot <= 1) return;
    if (cur >= tot) {
      // All entries viewed — reset for the next loan record / property
      lastCommentaryPage = 0;
      return;
    }
    if (cur === lastCommentaryPage) return;
    lastCommentaryPage = cur;

    console.log(`[LCC CoStar] Round 76ek.d: auto-paging commentary ${cur} of ${tot}`);
    commentaryPaginationInProgress = true;

    const nextBtn = findNextCommentaryButton();
    if (!nextBtn) {
      console.log('[LCC CoStar] Round 76ek.d: could not find commentary next-page button');
      commentaryPaginationInProgress = false;
      return;
    }

    setTimeout(() => {
      try {
        nextBtn.click();
        console.log(`[LCC CoStar] Round 76ek.d: clicked commentary next → ${cur + 1} of ${tot}`);
      } catch (err) {
        console.error('[LCC CoStar] Round 76ek.d: commentary click error:', err);
      }
      setTimeout(() => { commentaryPaginationInProgress = false; }, 1200);
    }, 600);
  }

  // Locate the next-button NEAR the "X of N Commentary Entries" text. The
  // page may also have other paginators (loan-record, sale/loan history),
  // so a global "next" selector isn't safe. We anchor on the Commentary
  // text node and walk up the DOM ancestor chain looking for a sibling
  // arrow button.
  function findNextCommentaryButton() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        /\d+\s+of\s+\d+\s+commentary\s+entries/i.test(node.textContent || '')
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const textNode = walker.nextNode();
    if (!textNode) return null;

    // Walk up to 6 levels looking for a parent that contains a Next button
    // alongside our pagination text.
    let parent = textNode.parentElement;
    let depth = 0;
    while (parent && depth < 6) {
      // Prefer aria-labelled next/forward
      const ariaNext = parent.querySelector(
        '[aria-label*="next" i], [aria-label*="forward" i]'
      );
      if (ariaNext && isVisibleElement(ariaNext)) return ariaNext;

      // Right-arrow / chevron buttons
      const buttons = parent.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        if (!isVisibleElement(btn)) continue;
        const hasArrow =
          btn.querySelector('[class*="right"], [class*="next"], [class*="forward"], [class*="chevron-right"]') ||
          /[▶►→❯]/.test(btn.textContent || '');
        if (hasArrow) {
          // Ensure the button is geometrically near our text (avoid
          // matching a far-away paginator on the same page)
          const tRect = textNode.parentElement?.getBoundingClientRect();
          const bRect = btn.getBoundingClientRect();
          if (!tRect || !bRect) continue;
          const distancePx = Math.abs(bRect.top - tRect.top) + Math.abs(bRect.left - tRect.left);
          if (distancePx < 400) return btn;       // 400 px proximity covers
                                                  // CoStar's tight inline pagers
        }
      }

      parent = parent.parentElement;
      depth++;
    }
    return null;
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

  // Role priority for collapsing a multi-role contact to a single
  // representative `.role` value that downstream code (sidebar, pipeline
  // filters) reads. Higher priority = more actionable for prospecting.
  const ROLE_PRIORITY = [
    'listing_broker',
    'buyer_broker',
    'lender',
    'true_buyer',
    'true_seller',
    'true_buyer_contact',
    'true_seller_contact',
    'buyer',
    'seller',
    'owner',
  ];

  function pickRepresentativeRole(roles) {
    if (!Array.isArray(roles) || roles.length === 0) return null;
    for (const r of ROLE_PRIORITY) {
      if (roles.includes(r)) return r;
    }
    return roles[0];
  }

  function normalizeContactName(s) {
    if (!s) return '';
    let n = String(s)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Strip middle initials so "Howard A Traul" and "Howard Traul" collapse
    // to the same dedup key. Handles single-letter tokens anywhere except
    // the first position (never drop the leading initial of names like
    // "T Boone Pickens"). Runs until stable because three-token middle
    // names ("John A B Smith") need multiple passes.
    let prev;
    do {
      prev = n;
      n = n.replace(/^(\S+(?:\s+\S+)*?)\s+[a-z](?=\s+\S+)/g, '$1');
    } while (n !== prev);
    // Also drop a trailing generational suffix (jr, sr, ii, iii, iv).
    n = n.replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').trim();
    return n;
  }

  // Merge a new batch of contacts into the accumulated array, deduping by
  // normalized name. When the same person/entity appears under multiple
  // roles (common on CoStar Sale Comp pages where one firm is listed as
  // Listing Broker, Lender, and True Buyer), we collapse them into a single
  // contact whose `roles[]` captures the full set and `role` holds the
  // highest-priority representative for downstream single-role consumers.
  function mergeContacts(existing, newContacts) {
    const rolesFor = (c) => {
      if (Array.isArray(c.roles) && c.roles.length > 0) return c.roles;
      if (c.role) return [c.role];
      return [];
    };

    for (const c of newContacts) {
      const key = normalizeContactName(c.name);
      if (!key) continue;
      const dup = existing.find((e) => normalizeContactName(e.name) === key);

      if (!dup) {
        const cc = { ...c };
        cc.roles = [...new Set(rolesFor(c))];
        cc.role = pickRepresentativeRole(cc.roles) || c.role || null;
        existing.push(cc);
        continue;
      }

      if (!Array.isArray(dup.roles)) dup.roles = dup.role ? [dup.role] : [];
      for (const r of rolesFor(c)) {
        if (r && !dup.roles.includes(r)) dup.roles.push(r);
      }
      dup.role = pickRepresentativeRole(dup.roles) || dup.role || null;

      // Merge scalar fields without clobbering existing non-empty values
      for (const k of Object.keys(c)) {
        if (k === 'role' || k === 'roles' || k === 'phones') continue;
        if (c[k] != null && c[k] !== '' &&
            (dup[k] == null || dup[k] === '')) {
          dup[k] = c[k];
        }
      }
      // Union phones
      if (Array.isArray(c.phones) && c.phones.length) {
        if (!Array.isArray(dup.phones)) dup.phones = [];
        for (const p of c.phones) {
          if (p && !dup.phones.includes(p)) dup.phones.push(p);
        }
      }
    }
  }

  // Sale merge helpers live in content/_sale-merge.js (loaded before this
  // script by manifest.json). That module attaches {mergeSales, ...} to
  // globalThis so the same logic can be imported from Node tests.
  const { mergeSales } = globalThis.__lccSaleMerge;

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

  // Strip CoStar listing-status prefixes ("For Sale | ", "For Lease | ",
  // "Reduced | ", "New Listing | ", …) off a candidate address. CoStar's
  // For Sale tab heading reads "For Sale | 1164 Route 130 North"; the
  // pipe-segment splitter below handles the simple form, but this strip
  // also catches "For Sale - 1164 …" / "Reduced: 1164 …" delimiter
  // variants and stacked prefixes like "For Sale | New Listing | 1164 …".
  //
  // Round 76ei: also strip CoStar Sale Comp / Lease Comp page headings
  // that use a "<property type> <disposition>:" form — e.g.
  //   "Condo Sold: 326 Del Prado Blvd, 1st Floor - 101"
  //   "Office Sold: 1234 Foo St"
  //   "Medical Office Sold: ..."  /  "Industrial Leased: ..."
  // These headings dominate /detail/sale-comps/.../Comp/<id>/ pages and
  // without the strip, parseAddress returns null (no segment starts with
  // a digit), the sidebar shows the empty "Browse a property…" state,
  // and the user can't capture the comp.
  function stripListingStatusPrefix(s) {
    if (!s) return s;
    const PROP_TYPE = '(?:condo|office|industrial|retail|land|hotel|multifamily|multi-family|specialty|flex|medical(?:\\s+office)?|health\\s*care|sports?(?:\\s*&\\s*\\w+)?|self\\s*storage|mobile\\s*home(?:\\s+park)?|mixed\\s*use|apartments?|warehouse|shopping\\s+center|strip\\s+center)';
    const DISPOSITION = '(?:for\\s+sale|for\\s+lease|for\\s+rent|sale|sold|lease|leased|rent|rented|new\\s+listing|reduced|price\\s+reduced|just\\s+listed|coming\\s+soon|under\\s+contract|off\\s+market|new\\s+price)';
    const PREFIX_RE = new RegExp(`^\\s*(?:${PROP_TYPE}\\s+)?${DISPOSITION}\\s*[|\\-–—:]\\s*`, 'i');
    let out = String(s);
    for (let i = 0; i < 3; i++) {
      const next = out.replace(PREFIX_RE, '');
      if (next === out) break;
      out = next;
    }
    return out;
  }

  function parseAddress(raw) {
    if (!raw || raw.length < 3) return null;
    raw = stripListingStatusPrefix(raw);
    // Round 76cg: try ALL segments after splitting on pipe/em-dash/en-dash/
    // hyphen-with-spaces - not just the first. CoStar tab titles are
    // formatted as 'Properties | 215-225 S Allison Ave' so the first
    // segment is the section name and the real address is in segment [1].
    // Also accept number-range addresses (215-225) which were previously
    // rejected because the regex required digit-then-whitespace.
    const segments = raw.split(/\s+[-–—|]\s+/).map(s => s.trim()).filter(Boolean);
    // Round 76dk: added Expy, Expressway, Trl, Sq, Square, Ter, Terrace, Cv, Cove,
    // Crk, Creek, Hill, Bnd, Bend, Run. Without Expy, addresses like
    // "2700 S Central Expy" failed validation, which broke findSplitAddressInLines'
    // post-combine validation step on a 2026-04 CoStar capture in McKinney TX.
    // Round 76: added pky (CoStar abbreviates Parkway as "Pky" in headings,
    // e.g. "5155 Flynn Pky" — without it the address parses to null and the
    // sidebar falls back to the empty "unsupported site" state), plus tpke/
    // turnpike, byp/bypass, xing/crossing. All require a leading street number
    // (enforced by the digit-prefix guard in parseAddress) so false positives
    // are unlikely.
    // Round 76 (2026-06-25): added speedway/spdwy. "Buffalo Speedway" (a major
    // Houston road) parsed to null because "Speedway" wasn't a known street type
    // (and \bway\b can't match inside "Speedway"), so the sidebar fell back to the
    // empty "unsupported site" state on 13838 Buffalo Speedway (Comp 5194120).
    const STREET_RE = /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|pl|place|way|hwy|highway|pkwy|parkway|pky|pike|tpke|turnpike|byp|bypass|xing|crossing|cir|circle|loop|terr|terrace|ter|trail|trl|expy|expressway|speedway|spdwy|sq|square|cv|cove|crk|creek|hill|bnd|bend|run|plaza|plz|route|rt|us\s+route|state\s+route|sr|fm|cr)\b/i;
    // Salt Lake City-style grid addresses have no street-type word.
    // Form: <building#> <dir> <grid#> <dir> — e.g. "3854 W 5400 S",
    // "3000 E 7800 S". Without this branch, Taylorsville/SLC properties
    // produce address=null and the sidebar falls back to the empty
    // "Browse a property…" state.
    const GRID_STREET_RE = /^\d+(?:-\d+)?\s+(?:N|S|E|W|NE|NW|SE|SW)\s+\d+\s+(?:N|S|E|W|NE|NW|SE|SW)\b/i;
    for (const seg of segments) {
      // Round 76ei: also strip the listing-status prefix off each
      // segment, not just the raw input. CoStar comp tab document.title
      // is "Sale Comps | Condo Sold: 326 Del Prado Blvd, 1st Floor - 101"
      // — the leading-strip can't reach the "Condo Sold:" because "Sale"
      // isn't followed by a delimiter, so the prefix survives into the
      // post-split segment and blocks the digit-prefix guard.
      const cleaned = stripListingStatusPrefix(seg).trim();
      // Reject pagination patterns like "1 of 2,000 Records"
      if (/^\d+\s+of\s+[\d,]+/i.test(cleaned)) continue;
      // Must start with a number (or number range like 215-225) AND
      // either contain a street-type word OR match a grid-style street
      // (e.g. "5400 S" in Salt Lake City's quadrant numbering).
      if (/^\d+(?:-\d+)?\s/.test(cleaned)
          && (STREET_RE.test(cleaned) || GRID_STREET_RE.test(cleaned))) {
        return cleaned;
      }
    }
    return null;
  }

  // Round 76ds + 76ff: section-context guard shared by both address finders.
  // CoStar comp / owner pages embed a FOREIGN party's mailing address (the
  // Buyer / Seller / Recorded Owner / Lender) in the body. On the Sale Comp
  // Summary page the True Buyer's HQ ("1 N Wacker Dr, Suite 4000" /
  // "Chicago, IL 60606") sits ~2 lines under the "True Buyer" label; the
  // address walkers would otherwise grab it and overwrite the real subject
  // property address (e.g. "312 Highway 11 E, International Falls, MN").
  // Reject any street line that falls just below one of these section
  // headers. Two label shapes are matched:
  //   - explicit address sub-labels, anchored ^…$ (Round 76ds set)
  //   - contact-block headers, start-anchored, because CoStar often renders
  //     the label concatenated with its value
  //     ("True Buyer Boyd Watterson Global").
  const FOREIGN_ADDRESS_LABEL_RE = /^(mailing\s+address|buyer\s+address|seller\s+address|owner(?:'s)?\s+address|borrower\s+address|originator\s+address|contact\s+details|recorded\s+owner\s+mailing)$/i;
  // No trailing \b: CoStar's two-column panels often render the label
  // concatenated with its value ("True BuyerBoyd Watterson Global"), so a
  // word-boundary after the header would miss the concatenated form.
  const FOREIGN_PARTY_HEADER_RE = /^(recorded\s+buyer|true\s+buyer|recorded\s+seller|true\s+seller|recorded\s+owner|true\s+owner|current\s+owner|listing\s+broker|buyer\s+broker|lender|borrower|originator)/i;
  function isInsideForeignAddressSection(lines, idx, lookback) {
    const back = Math.max(0, idx - (lookback || 6));
    for (let k = idx - 1; k >= back; k--) {
      const ln = lines[k] || '';
      if (FOREIGN_ADDRESS_LABEL_RE.test(ln) || FOREIGN_PARTY_HEADER_RE.test(ln)) return true;
    }
    return false;
  }

  function findAddressInLines(lines) {
    // Round 76ff.b: ONE top-to-bottom pass — the FIRST address-shaped line
    // that is not inside a foreign-party section wins. The subject property
    // address is always at the top of the page (heading / stat block);
    // broker, buyer, seller and lender addresses are always lower (Contacts /
    // party panels).
    //
    // Why this replaced the old "split-walker first, then single-line" order:
    // findSplitAddressInLines ran first and its STREET_RE requires a street
    // *name* token before the suffix, so it CANNOT match "Highway"/"Route"-
    // style subjects ("312 Highway 11 E"). It therefore skipped the subject
    // heading and walked down to the first STREET_RE-matchable line that
    // survived the guard — a broker's office ("1717 McKinney Ave, Suite 900,
    // Dallas, TX") — and returned that as the property address. parseAddress
    // DOES match the Highway/Route forms, so evaluating both the split-combine
    // (a) and the single-line parse (b) in document order makes the top-of-page
    // subject win regardless of suffix shape.
    const STREET_RE = /^\d+(?:-\d+)?\s+(?:[A-Za-z][\w&'.\- ]{0,80}\b(?:St|Ave|Avenue|Rd|Road|Hwy|Highway|Pkwy|Parkway|Pky|Blvd|Boulevard|Way|Dr|Drive|Ln|Lane|Pl|Place|Ct|Court|Cir|Circle|Trl|Trail|Expy|Expressway|Speedway|Spdwy|Sq|Square|Ter|Terrace|Loop|Tpke|Turnpike|Byp|Bypass|Xing|Crossing)|(?:Route|Rt|US\s+Route|State\s+Route|SR|FM|CR)\s+\d+|(?:N|S|E|W|NE|NW|SE|SW)\s+\d+\s+(?:N|S|E|W|NE|NW|SE|SW))\b\.?/i;
    const CITY_RE = /^[A-Z][A-Za-z.\- ]{1,40},\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length < 5 || line.length > 120) continue;
      // Foreign-address-block guard (Round 76ds/76ff): skip any line that
      // sits just below a Buyer / Seller / Owner / Lender / Broker header.
      if (isInsideForeignAddressSection(lines, i)) continue;
      // (a) Full "Street, City, ST ZIP" form: this line is a street and a
      //     city/state/zip line follows nearby (Round 76di lookahead window).
      //     The city line must not itself be inside a foreign-party block.
      if (STREET_RE.test(line)) {
        for (let j = i + 1; j < Math.min(i + 25, lines.length); j++) {
          const cityLine = lines[j];
          if (!cityLine || !CITY_RE.test(cityLine)) continue;
          if (isInsideForeignAddressSection(lines, j)) break;
          const combined = parseAddress(`${line}, ${cityLine}`);
          if (combined) return combined;
          break; // first city line after the street is the pairing
        }
      }
      // (b) Single-line form — covers "312 Highway 11 E", Salt-Lake grid
      //     ("3854 W 5400 S"), and "1 N Wacker Dr, Suite 4000" shapes that
      //     (a)'s STREET_RE can't pair.
      const single = parseAddress(line);
      if (single) return single;
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

  // Parse a dollar cell into a numeric amount. Handles abbreviated
  // forms ($10.13M, $250K, $1.2B) as well as the plain "$10,134,761"
  // shape. Returns null when the string isn't a recognizable amount,
  // or when it carries an explicit per-SF suffix (which would
  // otherwise sneak past the >= 1000 guard for adjacent stat cells).
  function parseDollarAmount(str) {
    if (!str || typeof str !== 'string') return null;
    const trimmed = str.trim();
    if (/\/sf\b/i.test(trimmed)) return null;
    const m = trimmed.match(/^\$?([\d,]+(?:\.\d+)?)\s*([KMB])?\b/i);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const suffix = (m[2] || '').toUpperCase();
    if (suffix === 'K') n *= 1e3;
    else if (suffix === 'M') n *= 1e6;
    else if (suffix === 'B') n *= 1e9;
    return n;
  }

  // ── Property field extraction ─────────────────────────────────────────

  function extractFields(lines, pageUrl) {
    const data = {};
    // Sale comp detail pages (/Comp/NNN/) show historical per-sale values in
    // their stat cards. These are captured but flagged so the caller can route
    // them into the matching sales_history entry instead of top-level fields.
    const compMatch = (pageUrl || '').match(/\/Comp\/(\d+)\//i);
    const isSaleCompPage = !!compMatch;
    if (isSaleCompPage) data._comp_id = compMatch[1];

    // Track when we enter a Sales History / Prior Sales section on Summary pages.
    // "Asking Price" labels after this point are historical per-sale values,
    // not the current listing price.
    let inSalesHistorySection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = i > 0 ? lines[i - 1] : '';
      const next = i < lines.length - 1 ? lines[i + 1] : '';

      // Detect sales history sections (on Summary and Sale tabs).
      // Round 76ex (2026-04-29): added "Last Sale", "Last Loan",
      // "Sale/Loan History", "Sale Loan History" — these are the section
      // headings used on /public-record sub-tabs. Without these, the
      // historical $18,500 from 1997 (5 Route 45 Mannington DOT easement)
      // landed as data.asking_price because the askingLabelRe ate "Sale Price"
      // labels inside the public-record body.
      if (/^(sales?\s+history|prior\s+sales?|transaction\s+history|transaction\s+details|last\s+sale|last\s+loan|sale[\s\/]*loan\s+history)$/i.test(line)) {
        inSalesHistorySection = true;
      }

      if (!data.cap_rate && /^(actual\s+)?cap\s+rate$/i.test(line)) {
        // Guard (2026-06-02): only accept a nearby percent that's a plausible
        // CRE cap rate in % units [2,15]. Without this, an adjacent occupancy %
        // (95%), LTV (75%), or escalation (2%) could land in cap_rate — the same
        // adjacent-cell leak class as the asking-price/SF fix above.
        const plausibleCapPct = (s) => {
          const m = String(s).match(/(\d+(?:\.\d+)?)\s*%/);
          if (!m) return false;
          const v = parseFloat(m[1]);
          return Number.isFinite(v) && v >= 2 && v <= 15;
        };
        if (plausibleCapPct(prev)) data.cap_rate = prev;
        else if (plausibleCapPct(next)) data.cap_rate = next;
        else if (i < lines.length - 2 && plausibleCapPct(lines[i + 2])) data.cap_rate = lines[i + 2];
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

      // Asking price: only capture from the stat card area (before sales history
      // section). Historical "Asking Price" fields inside prior sales records
      // belong to those individual sales, not the current listing.
      // Round 76dv: also accept "For Sale" / "Sale Price" / "Price" labels
      // when the URL is a /for-sale/ listing page. CoStar's For Sale layout
      // uses those labels instead of "Asking Price" — without this branch,
      // captures from /detail/for-sale/<id>/property left metadata.asking_price
      // empty, which made upsertDialysisListings early-exit and never create
      // an available_listings row (5 Route 45 / Mannington NJ, 2026-04-29).
      // Round 76dx: this function takes pageUrl, not url — referencing
      // the wrong identifier threw ReferenceError, killing extractFields()
      // and leaving the sidebar in empty state on /for-sale/ pages.
      // Round 76ex (2026-04-29): on /public-record sub-tabs, the page is
      // dominated by historical sale data (Last Sale, Sale/Loan History,
      // assessment/loan rows). Even though the URL is /detail/for-sale/...,
      // the body content has "Sale Price" labels for every historical sale.
      // Restrict to exact "Asking Price" so the 1997 DOT easement at $18,500
      // can't masquerade as a current-listing asking price.
      const isForSaleUrl = /\/detail\/for-sale\//i.test(pageUrl || '');
      const isPublicRecordTab = /\/public-record(?:\b|\/|$)/i.test(pageUrl || '');
      const askingLabelRe = (isForSaleUrl && !isPublicRecordTab)
        ? /^(asking\s+price|for\s+sale|sale\s+price|price)$/i
        : /^asking\s+price$/i;
      if (!inSalesHistorySection && !data.asking_price && askingLabelRe.test(line)) {
        // CoStar stat cards put the VALUE above the LABEL —
        // "$10.13M\nSale Price\n$1,410.35\nPrice/SF" — so when both
        // prev and next look like dollar amounts, prev is this
        // label's value and next is the *following* field's per-SF
        // value. Prefer the larger of the two: a real asking price
        // is always larger than the per-SF figure CoStar sandwiches
        // between consecutive stat cells. parseDollarAmount handles
        // the K/M/B suffixed forms that the old `parseFloat(strip $)`
        // path silently treated as < 1000 and discarded.
        // Bug 4302 S Main St (2026-05-21): stat card pinned
        // asking_price to "$1,410.35" because the old code took next
        // unconditionally when its numeric form was >= 1000.
        // 2017 Quintard Ave (Anniston AL, 2026-06-02): a "Not Disclosed" Sale
        // Price card sits directly above the SF/RBA card, so `prev` is the text
        // "Not Disclosed" (no number) and the next-stat fallback below grabbed
        // the adjacent RBA value (9,972) as the asking price. Guard: when the
        // value cell is an explicit non-disclosure token, the price is absent —
        // do NOT fall through to the neighbouring (size/date) stat. Also refuse
        // a `next` value whose own card label (lines[i+2]) is a non-price stat.
        const NON_DISCLOSED_RE = /^(not\s+disclosed|undisclosed|not\s+available|withheld|confidential|n\/?a|tbd|--+|—|call|inquire|upon\s+request)\b/i;
        const NON_PRICE_STAT_LABEL = /\b(sf\s*rba|rba|sq\.?\s*ft|square\s*f(?:ee|oo)t|ac\s+lot|acres?|lot|on\s+market|days?|built|year\s+built|stories|units?|floors?|tenancy)\b/i;
        const prevUndisclosed = NON_DISCLOSED_RE.test((prev || '').trim());
        const nextCardLabel = i + 2 < lines.length ? (lines[i + 2] || '') : '';
        const nextIsForeignStat = NON_PRICE_STAT_LABEL.test(nextCardLabel);
        const prevAmt = parseDollarAmount(prev);
        const nextAmt = parseDollarAmount(next);
        let chosen = null;
        if (prevUndisclosed) {
          chosen = null;                       // price genuinely undisclosed
        } else if (prevAmt && prevAmt >= 1000 && (nextAmt == null || prevAmt >= nextAmt)) {
          chosen = prev;
        } else if (nextAmt && nextAmt >= 1000 && !nextIsForeignStat) {
          chosen = next;
        }
        if (chosen) data.asking_price = chosen;
      }

      // Sale price: prefer stat card value (appears first, is most recent sale)
      // but skip "Not Disclosed" — grab actual dollar amounts.
      // Guard: a real sale price is at least $1,000 (reject price/SF values like $198.63)
      // Round 76dn: tightened the non-numeric fallback. Previously accepted
      // any next-line text < 60 chars, which let CoStar column headers
      // ("Price/SF", "Cap Rate", etc.) leak in as the sale_price value
      // when the Sale Price column had no data on a row.
      // 4302 S Main St NEW listing (2026-05-21): on /detail/for-sale/
      // URLs CoStar labels the stat-card *asking* price as "Sale Price"
      // (there's no actual sale yet on a NEW listing). The block above
      // already routes that value to data.asking_price via the widened
      // askingLabelRe — capturing it again here would propagate the
      // asking price into dia.sales_transactions as a phantom closed
      // sale. Skip the sale_price write on /for-sale/ pages outside
      // the /public-record sub-tab (which still carries real historical
      // sales).
      if (/^sale\s+price$/i.test(line) && !(isForSaleUrl && !isPublicRecordTab)) {
        // Same stat-card hazard as asking_price above — when prev
        // and next are both dollar amounts, prev (value above label)
        // beats the smaller per-SF figure in next.
        const prevAmt = parseDollarAmount(prev);
        const nextAmt = parseDollarAmount(next);
        let chosen = null;
        if (prevAmt && prevAmt >= 1000 && (nextAmt == null || prevAmt >= nextAmt)) {
          chosen = prev;
        } else if (nextAmt && nextAmt >= 1000) {
          chosen = next;
        }
        if (chosen) {
          if (!data.sale_price || !/^\$/.test(data.sale_price)) data.sale_price = chosen;
        } else if (!data.sale_price && next && /^(not\s+disclosed|confidential|n\/?a|—|-|undisclosed|withheld)$/i.test(next.trim())) {
          data.sale_price = next; // known sentinel values only
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
        // Round 76ek.g (2026-05-08): "SF Avail" / "Office Avail" / "Retail Avail"
        // were leaking through as property_type because the For Lease panel's
        // "Office Avail | 24,105 SF" cell sometimes lands adjacent to a "Type"
        // label in the line stream. Reject anything ending in "Avail" or
        // "Available" — those are leasing-availability columns, never the
        // property type. Also reject "For Lease" / "For Sale" / "Asking" labels
        // that show up in the same neighborhood.
        if (next
            && next.length < 50
            && !/^\d/.test(next)
            && !/^(investment|sale)/i.test(next)
            && !/^(size|type|class|use|status|source|subtype|sf|rba|year|stories|floors|land|lot|parking|zoning|occupancy|tenancy|market|submarket|building|property)$/i.test(next)
            && !/\b(avail|available)\b/i.test(next)
            && !/^(for\s+(lease|sale)|asking(\s+(rent|price))?|listing|smallest\s+space|max\s+contiguous|vacant|leased|service\s+type)$/i.test(next)) {
          data.property_type = next;
        }
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

      // Stat-card / summary loan fields. CoStar's Property Summary tab
      // sometimes shows "Loan Amount: $23,500,000 · Loan Type: New
      // Conventional · Origination: 2025-11-13" as a top-level block
      // detached from the per-deed Transaction Details. Capture those
      // at the root of the data payload so sidebar-pipeline's loan
      // fallback path has something to compose when the deed history
      // doesn't pair a lender with a loan_amount on a single row.
      if (!data.loan_amount && /^loan\s+amount$/i.test(line)
          && /^\$[\d,.]+/.test(next)) {
        data.loan_amount = next;
      }
      if (!data.loan_type && /^loan\s+type$/i.test(line)
          && next && next.length < 60 && !/^[\d$]/.test(next)) {
        data.loan_type = next;
      }
      if (!data.loan_origination_date
          && (/^(origination(\s+date)?|loan\s+origination(\s+date)?)$/i.test(line))
          && next && next.length < 30
          && /\d/.test(next)) {
        data.loan_origination_date = next;
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

      // Guards (2026-06-02): magnitude-check the adjacent value so a total rent
      // can't leak into rent_per_sf and a per-SF figure can't leak into
      // annual_rent (same adjacent-cell leak class as the asking-price/SF fix).
      if (!data.rent_per_sf && /^rent\/?sf$/i.test(line)) {
        const v = parseDollarAmount(next);
        if (v != null && v >= 1 && v <= 500) data.rent_per_sf = next;   // $/SF band
      }

      if (!data.annual_rent && /^annual\s+rent$/i.test(line)) {
        const v = parseDollarAmount(next);
        if (v != null && v >= 1000) data.annual_rent = next;            // a total rent, not a per-SF value
      }

      // Tenant name — appears as a label/value pair on property detail pages
      // e.g. "Tenant" label followed by "VA Madison East Clinic" or "DaVita..."
      // Reject CoStar section header labels that follow a "Tenant" label in page text.
      const TENANT_REJECT = /^(public\s+record|building|building\s+info|land|market|market\s+data|submarket|sources|my\s+notes|contacts|sale|transaction|assessment|investment|research|verified|confirmed|not\s+disclosed|no\s+tenant|owner.occupied|vacant|available|none|name|sf\s+occupied|sf|source|floor|move\s+date|exp\s+date|lease\s+type|lease\s+term|lease\s+start|lease\s+expir.*|rent\/?sf|analytics|reports|data|directory|stacking\s+plan|leasing|for\s+lease|for\s+sale|property\s+info|demographics|transit|walk\s+score|industry|sector|property\s+type|property\s+subtype|secondary\s+type|building\s+class|construction|year\s+built|year\s+renovated|lot\s+size|zoning|parking|stories|floors|typical\s+floor|ceiling\s+height|tenancy|single\s+tenant|multi.tenant|net\s+lease|gross\s+lease|nnn|modified\s+gross|buyer|seller|broker|listing\s+broker|buyer\s+broker|lender|owner|recorded\s+buyer|recorded\s+seller|true\s+buyer|true\s+seller|current\s+owner)$/i;

      // Bug 76w (2026-04-27): TENANT_REJECT has 'data' alone but not 'my data'.
      // Without TENANT_LABEL_BUTTON_REJECT, a 'Tenant\nMy Data' (CoStar
      // toggle button text) sets tenant_name='My Data' and the classifier
      // sees junk. Mirrors path 2's Round 76s filter.
      const TENANT_LABEL_BUTTON_REJECT = /^(my\s+data|shared\s+data|show|hide|expand|collapse|view|see\s+(all|more|details))$/i;
      const TENANT_LABEL_COMPOUND_REJECT = /(\u00b7|\u2022)|(:[^,\n]*\b(\d|\$)[^,\n]*\/(sf|fs|mg|ig|nnn|gross|net)\b)/i;
      if (!data.tenant_name && /^tenant\s*name?$/i.test(line) && next
          && next.length > 2 && next.length < 80
          && !TENANT_REJECT.test(next)
          && !TENANT_LABEL_BUTTON_REJECT.test(next)
          && !TENANT_LABEL_COMPOUND_REJECT.test(next)
          && !/^(tenancy|type|sf|detail|info)/i.test(next)) {
        data.tenant_name = next;
      }

      // Also capture from "Tenants" header when only one tenant is shown
      // (property detail shows a single tenant inline, not a full table).
      // On Industrial Sale Comp pages the next line is a summary bar like
      // "Tenancy: Single · Owner Occupied: No · Est. Rent: $6 - 7/SF (Industrial)";
      // skip past up to 2 summary-bar / SF-only lines to find the real tenant name.
      if (!data.tenant_name && /^tenants?$/i.test(line)) {
        // Bug 76s (2026-04-27): this path also needs the Round 76q rejects
        // (OM section headers, NAICS sectors, compound metadata, plain
        // 'show'/'hide' button text) — without them, when a Tenants table
        // is followed by 'Show' (CoStar's expand button), tenant_name gets
        // set to 'Show'. Then line ~120's '!data.tenant_name'-gated
        // tenants[0].name fallback never fires because tenant_name is
        // already set. Result: classifier sees 'show' and returns null.
        const TENANT_SUMMARY_BAR = /^(tenancy[:\s]|single\s+tenant|multi.tenant|owner\s+occupied|est\.?\s*rent|net\s+lease|gross\s+lease|\$?\d)/i;
        const SF_ONLY_LINE = /^[\d,]+\s*sf\s*$/i;
        const BUTTON_TEXT_REJECT = /^(show|hide|expand|collapse|view|see\s+(all|more|details))$/i;
        const COMPOUND_OR_NAICS_REJECT = /(\u00b7|\u2022)|(:[^,\n]*\b(\d|\$)[^,\n]*\/(sf|fs|mg|ig|nnn|gross|net)\b)|^(health\s+care(\s+and\s+social\s+assistance)?|finance\s+and\s+insurance|retail\s+trade|wholesale\s+trade|public\s+administration)\s*$/i;
        let cand = next;
        let k = i + 1;
        for (let s = 0; s < 3 && cand && (TENANT_SUMMARY_BAR.test(cand) || SF_ONLY_LINE.test(cand) || BUTTON_TEXT_REJECT.test(cand) || COMPOUND_OR_NAICS_REJECT.test(cand)); s++) {
          k++;
          cand = lines[k];
        }
        if (cand
            && cand.length > 2 && cand.length < 80
            && /^[A-Z]/.test(cand)
            && !TENANT_REJECT.test(cand)
            && !TENANT_SUMMARY_BAR.test(cand)
            && !SF_ONLY_LINE.test(cand)
            && !BUTTON_TEXT_REJECT.test(cand)
            && !COMPOUND_OR_NAICS_REJECT.test(cand)
            && !/^(at\s+sale|detail|directory|stacking)/i.test(cand)) {
          data.tenant_name = cand;
        }
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

    // Round 76ek.b (2026-05-08): when the user is on a CMBS Loan Details
    // sub-page (product.costar.com/detail/lookup/{N}/loan), capture the
    // visible loan record into data.loan_records[]. The backend writers
    // upsertLoanRecord / upsertLoanSnapshot / upsertLoanTopTenants will
    // fan it out into gov.loans + gov.loan_snapshots + gov.loan_top_tenants
    // (and the dia mirror, gated on properties.track_cmbs_snapshots for
    // the snapshot+tenants tables). Pagination across the top-of-page
    // "1 of N" loan-record list and the "1 of N Commentary Entries"
    // sub-pager are deferred to Round 76ek.c/d.
    if (LOAN_DETAIL_URL_RE.test(pageUrl || '')) {
      data.loan_records = parseCmbsLoanDetail(lines, pageUrl);
    }

    // Round 76ek.e (2026-05-08): CMBS Financials tab. Same property-detail
    // page, /detail/lookup/{N}/cmbs-financials route. Captures multi-year
    // actual operating financials. Hard rules:
    //   1. Only ingest when "Property" toggle is active (not "Market"). The
    //      Market view shows submarket Avg PSF — worthless for our purposes.
    //   2. Only ingest "Totals" view (not "Per SF").
    //   3. Skip the "Underwritten" column — it's the lender's pro-forma at
    //      origination, not actual.
    //   4. "Most Recent" YTD partial-year columns are kept but tagged with
    //      months_covered < 12 so analytics can annualize before comparing.
    if (CMBS_FINANCIALS_URL_RE.test(pageUrl || '')) {
      data.property_financials = parseCmbsFinancials(lines, pageUrl);
    }

    // Round 76ex (2026-04-29): the historical-asking-price guard previously
    // lived here, but this scope's `data` object never contains sales_history
    // (sales_history is built separately by extractSalesHistory() and merged
    // into accumulated.sales_history in the outer scope). The guard never
    // fired. It's now hoisted into extract() AFTER both data and salesHistory
    // are computed — see the call site near `const salesHistory = ...`.
    return data;
  }

  // ── Round 76ek.b: CMBS Loan Details parser ─────────────────────────────
  //
  // The Loan Details sub-page (.../detail/lookup/{N}/loan) presents a CMBS
  // servicer report: header (Originated/Disposed dates, Maturity, Origination
  // Amount, Originator), Collateral block (this loan's allocation + a snapshot
  // of NOI/DSCR/GLA), Top Tenants table (rent-roll snapshot at the report
  // date), Terms (interest_rate, term, IO period, …), Performance (loan_status,
  // delinquency count, modification, watchlist), Prepayment Periods (defeasance
  // status), Contacts (servicer / special servicer / originator / sponsor),
  // and a Commentary block.
  //
  // This .b cut captures only the *currently-visible* loan record. Round
  // 76ek.d adds the top-of-page "1 of N" loan-record pager loop. Round 76ek.c
  // adds the commentary pager. Round 76ek.e adds the financial-history tab.
  const LOAN_DETAIL_URL_RE = /\/detail\/lookup\/(\d+)\/loan(?:\/?$|\?|#)/i;

  function parseCmbsLoanDetail(lines, pageUrl) {
    const urlMatch = (pageUrl || '').match(LOAN_DETAIL_URL_RE);
    if (!urlMatch) return [];

    const rec = {
      costar_loan_id: urlMatch[1],
      source_url:     pageUrl,
      data_source:    'costar_cmbs_loan',
    };
    const snapshot = {
      data_source: 'costar_cmbs_loan',
      top_tenants: [],
    };
    // Round 76ek.c (2026-05-08): commentary entries — one per CMBS report
    // narrative event ("Delinquency – December 2020", "Modification –
    // Jul 2024", etc.). Multi-entry capture in this round only handles the
    // currently-visible entry; auto-pagination across the "X of N
    // Commentary Entries" pager comes in Round 76ek.d.
    const commentaryEntries = [];
    let pendingEntry = null;

    // ── Local parsing helpers (kept inside the function so they don't
    //    pollute the outer scope and don't accidentally collide with the
    //    file's other parseDate/parseCurrency-shaped helpers).
    function lp_parseDate(s) {
      if (!s) return null;
      const t = String(s).trim();
      const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (slash) {
        const [, mo, d, y] = slash;
        return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      }
      const monNames = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                        Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
      const monYear = t.match(/^([A-Z][a-z]{2})\s+(\d{4})$/);
      if (monYear && monNames[monYear[1]]) {
        const mm = monNames[monYear[1]];
        const lastDay = new Date(parseInt(monYear[2]), parseInt(mm), 0).getDate();
        return `${monYear[2]}-${mm}-${String(lastDay).padStart(2,'0')}`;
      }
      const monDayYear = t.match(/^([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{4})$/);
      if (monDayYear && monNames[monDayYear[1]]) {
        const mm = monNames[monDayYear[1]];
        return `${monDayYear[3]}-${mm}-${String(monDayYear[2]).padStart(2,'0')}`;
      }
      return null;
    }
    function lp_parseCurrency(s) {
      if (!s) return null;
      const n = parseFloat(String(s).replace(/[$,\s]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    function lp_parsePct(s) {
      if (!s) return null;
      const m = String(s).match(/(-?[\d.]+)\s*%/);
      if (!m) return null;
      const n = parseFloat(m[1]);
      return Number.isFinite(n) ? n / 100 : null;
    }
    function lp_parseInt(s) {
      if (!s) return null;
      const n = parseInt(String(s).replace(/[,\s]/g, ''), 10);
      return Number.isFinite(n) ? n : null;
    }
    function lp_parseMonths(s) {
      if (!s) return null;
      const m = String(s).match(/(\d+)\s*Mos?/i);
      return m ? parseInt(m[1], 10) : null;
    }
    function lp_parseSF(s) {
      if (!s) return null;
      const m = String(s).match(/(-?[\d,]+)\s*SF/i);
      return m ? parseFloat(m[1].replace(/,/g, '')) : null;
    }
    function lp_parseFloat(s) {
      if (!s) return null;
      const n = parseFloat(String(s).replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) ? n : null;
    }

    // ── Header: "Originated 7/1/2015, Disposed 11/25/2020"
    for (const line of lines) {
      const m = String(line).match(/^Originated\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:,\s*Disposed\s+(\d{1,2}\/\d{1,2}\/\d{4}))?/i);
      if (m) {
        rec.origination_date = lp_parseDate(m[1]);
        // Disposition date is informational only — loan_status carries
        // the temporal context (e.g. "Disposed").
        break;
      }
    }

    // ── "Data Source: CMBS, As of Nov 2020" → snapshot as_of_date hint
    //    Used only when the more precise "NOI Date" inside Collateral is
    //    absent (rare). Anchored to month-end.
    for (const line of lines) {
      const m = String(line).match(/Data\s+Source:\s*CMBS,\s*As\s+of\s+([A-Z][a-z]{2}\s+\d{4})/i);
      if (m) {
        snapshot.as_of_date = lp_parseDate(m[1]);
        break;
      }
    }

    // ── Section-anchored extraction
    // Round 76ek.h (2026-05-08): non-CMBS loans (county-records-derived,
    // not securitized) use a much simpler layout — header is just "Loan"
    // instead of "Collateral / Terms / Performance / …" and the only
    // sections are "Loan" and "Contacts". Treat the bare "Loan" header
    // as an alias for "Collateral" so the same field-extraction branch
    // fires. Otherwise origination_amount, origination_date, doc number
    // never reach the writer (Martek Ice IDF LLC, 2075 North Blvd —
    // 2026-05-08 user report).
    const SECTIONS = new Set([
      'Loan',
      'Collateral', 'Performance', 'Terms', 'Prepayment Periods',
      'Contacts', 'Portfolio Loan Detail', 'Top Tenants', 'Commentary',
    ]);

    let currentSection = null;
    for (let i = 0; i < lines.length; i++) {
      const line = String(lines[i] || '').trim();
      const next = String(lines[i + 1] || '').trim();
      const prev = String(lines[i - 1] || '').trim();

      if (SECTIONS.has(line)) {
        currentSection = line;
        continue;
      }

      // Top Tenants block — rows of (tenant_name, expiration_date, occupied_sf)
      // emitted as three consecutive lines by the DOM walker.
      if (currentSection === 'Top Tenants') {
        if (/^top\s+tenants\s+as\s+reported/i.test(line)) {
          currentSection = null;
          continue;
        }
        const isLabelRow = /^(top\s+tenants?|expiration\s+date|occupied)$/i.test(line);
        const isDate     = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line);
        const isSF       = /^[\d,]+\s*SF$/i.test(line);
        if (!isLabelRow && !isDate && !isSF) {
          const next2 = String(lines[i + 2] || '').trim();
          if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(next) && /^[\d,]+\s*SF$/i.test(next2)) {
            snapshot.top_tenants.push({
              rank:            snapshot.top_tenants.length + 1,
              tenant_name:     line,
              expiration_date: lp_parseDate(next),
              occupied_sf:     lp_parseSF(next2),
            });
            i += 2;
            continue;
          }
        }
        continue;
      }

      // Round 76ek.h: 'Loan' is the bare-page header on non-CMBS loan tabs;
      // it carries the same field labels (Origination Amount / Origination
      // Date / Doc Number) as the CMBS Collateral block, just without the
      // pool-allocation columns. Process it through the same branch.
      if (currentSection === 'Collateral' || currentSection === 'Loan') {
        // CoStar truncates labels with "..." — match on prefixes.
        // Origination Am... = allocated balance for THIS collateral
        // Origination Ap... = origination appraisal value
        if (/^origination\s+am(?:ount|\.\.\.)?$/i.test(line)) {
          rec.loan_amount = lp_parseCurrency(next);
        } else if (/^origination\s+ap(?:praisal|\.\.\.)?$/i.test(line)) {
          rec.origination_appraisal = lp_parseCurrency(next);
        } else if (/^%\s+of\s+total\s+loan$/i.test(line)) {
          rec.pct_of_total_loan = lp_parsePct(next);
        } else if (/^#\s+of\s+collateral$/i.test(line)) {
          rec.num_collateral = lp_parseInt(next);
        } else if (/^origination\s+ltv$/i.test(line)) {
          rec.ltv = lp_parsePct(next);
        } else if (/^appraisal\s+date$/i.test(line)) {
          rec.appraisal_date = lp_parseDate(next);
        } else if (/^noi$/i.test(line) && lp_parseCurrency(next) != null) {
          snapshot.noi = lp_parseCurrency(next);
        } else if (/^debt\s+service$/i.test(line)) {
          snapshot.debt_service = lp_parseCurrency(next);
        } else if (/^noi\s+dscr/i.test(line)) {
          snapshot.noi_dscr = lp_parseFloat(next);
        } else if (/^noi\s+date$/i.test(line)) {
          const d = lp_parseDate(next);
          if (d) snapshot.as_of_date = d;
        } else if (/^gla$/i.test(line)) {
          snapshot.gla = lp_parseSF(next);
        }
        // Round 76ek.l (2026-05-08): non-CMBS Loan tab fields. The simple
        // /detail/lookup/{N}/loan layout lists Origination Date / Doc Number /
        // Multi Properties? all under the "Loan" header. In CMBS captures,
        // origination_date lives in the "Terms" section, but on this layout
        // Terms doesn't exist — the field would never be captured without
        // adding a handler here. 2026-05-08 user report: 2075 North Blvd
        // Idaho Falls / Martek Building had loan_amount + originator
        // captured but origination_date null, leaving the gov.loans row
        // missing the key date.
        else if (/^origination\s+date$/i.test(line)) {
          rec.origination_date = lp_parseDate(next) || rec.origination_date;
        } else if (/^maturity\s+date$/i.test(line)) {
          rec.maturity_date = lp_parseDate(next) || rec.maturity_date;
        } else if (/^doc(?:ument)?\s+(?:number|#|num\.?)$/i.test(line)) {
          // No dedicated column; tag onto the loan source_url query string
          // for traceability. Parser-side only — backend already preserves
          // source_url verbatim.
          if (next && next.length < 50) rec.doc_number = next;
        }
        // Multi Properties? / # of Properties → no column, skip silently.
        continue;
      }

      if (currentSection === 'Terms') {
        if (/^origination\s+date$/i.test(line)) {
          rec.origination_date = lp_parseDate(next) || rec.origination_date;
        } else if (/^maturity\s+date$/i.test(line)) {
          rec.maturity_date = lp_parseDate(next);
        } else if (/^origination\s+a(?:mortization|m\.\.\.)$/i.test(line)) {
          rec.amortization_months = lp_parseMonths(next);
        } else if (/^origination\s+ter(?:m|\.\.\.)$/i.test(line)) {
          rec.origination_term_months = lp_parseMonths(next);
        } else if (/^origination\s+io/i.test(line)) {
          rec.origination_io_months = lp_parseMonths(next);
        } else if (/^interest\s+rate$/i.test(line)) {
          rec.interest_rate = lp_parsePct(next);
        } else if (/^rate\s+type$/i.test(line)) {
          rec.rate_type = next || null;
        } else if (/^balloon\s+maturity$/i.test(line)) {
          rec.balloon_maturity = /^yes$/i.test(next);
        } else if (/^interest\s+only$/i.test(line)) {
          rec.interest_only = next || null;
        } else if (/^pay\s+frequency$/i.test(line)) {
          rec.pay_frequency = next || null;
        }
        continue;
      }

      if (currentSection === 'Performance') {
        if (/^loan\s+status$/i.test(line)) {
          rec.loan_status = next || null;
        } else if (/^#\s+delinquent/i.test(line)) {
          rec.num_delinquent = lp_parseInt(next);
        } else if (/^modification$/i.test(line)) {
          rec.modification = /^yes$/i.test(next);
        } else if (/^special\s+servicing$/i.test(line)) {
          rec.special_servicing = next || null;
        } else if (/^watchlist$/i.test(line)) {
          rec.watchlist = next || null;
        }
        continue;
      }

      if (currentSection === 'Prepayment Periods') {
        if (/^status\s+at\s+disposal$/i.test(line)) {
          rec.status_at_disposal = next || null;
        }
        continue;
      }

      if (currentSection === 'Contacts') {
        if (/^servicer$/i.test(line)) rec.servicer = next || null;
        else if (/^special\s+servicer$/i.test(line)) rec.special_servicer = next || null;
        else if (/^originator$/i.test(line)) rec.originator = next || null;
        else if (/^sponsor$/i.test(line)) rec.sponsor = next || null;
        // Round 76ek.h: Borrower (the SPE LLC that signed the note). On
        // non-CMBS loans this is the only Contacts entry besides Originator.
        // Distinct from Sponsor: borrower = LLC entity, sponsor = principals.
        else if (/^borrower$/i.test(line)) rec.borrower = next || null;
        continue;
      }

      // Round 76ek.c: Commentary section parsing. CoStar's CMBS detail page
      // shows dated narrative entries for loan events — delinquency, payoff,
      // modification, watchlist removal, etc. Each entry has:
      //   - sub-header "Commentary Entry"
      //   - entry label like "Delinquency – December 2020"
      //   - pagination indicator "X of N Commentary Entries"
      //   - body text (free-form narrative)
      //
      // This .c cut captures only the currently-visible entry (the indicator
      // tells us which "X of N" we're seeing). Round 76ek.d adds the
      // auto-pager that walks all entries.
      if (currentSection === 'Commentary') {
        // Skip the sub-header
        if (/^commentary\s+entry$/i.test(line)) continue;
        // Pagination indicator — record which page we're on (entry rank)
        const pagerMatch = line.match(/^(\d+)\s+of\s+(\d+)\s+commentary\s+entries$/i);
        if (pagerMatch && pendingEntry) {
          pendingEntry.rank = parseInt(pagerMatch[1], 10);
          continue;
        }
        if (pagerMatch) continue;

        // Entry label heuristic: "<event-name> – <Month> <Year>" or similar.
        // Examples seen on CoStar: "Delinquency – December 2020", "Payoff –
        // 2021", "Watchlist Removal – Mar 2024", "Modification – Q3 2023".
        // Match leading capitalized phrase + dash + date-shaped trailer.
        const entryLabelRe =
          /^([A-Z][A-Za-z][\w\s\/]+?)\s*[-–—]\s*((?:Q[1-4]\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)?\s*\d{4})\s*$/;
        if (entryLabelRe.test(line)) {
          // Commit any in-progress entry first (we hit a new label)
          if (pendingEntry && pendingEntry.body.length > 0) {
            commentaryEntries.push(finalizeCommentaryEntry(pendingEntry));
          }
          const m = line.match(entryLabelRe);
          pendingEntry = {
            entry_label: line,
            entry_event: (m[1] || '').trim(),
            entry_period: (m[2] || '').trim(),
            entry_date: parseCommentaryDate(m[2]),
            body: [],
            rank: null,
          };
          continue;
        }

        // Otherwise it's body text for the current entry. Skip empty lines
        // and the literal "View 12 Month Pay Status History" link CoStar
        // sometimes embeds.
        if (pendingEntry && line && !/^view\s+\d+\s+month\s+pay\s+status/i.test(line)) {
          pendingEntry.body.push(line);
        }
        continue;
      }

      // Stat-card area (before any section header) — values render BEFORE
      // their labels in CoStar's stat-card layout, so we look at `prev`.
      if (!currentSection) {
        if (/^maturity\s+date$/i.test(line) && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(prev)) {
          rec.maturity_date = rec.maturity_date || lp_parseDate(prev);
        } else if (/^origination\s+amount$/i.test(line) && /^\$/.test(prev)) {
          rec.origination_amount = lp_parseCurrency(prev);
        } else if (/^originator$/i.test(line) && prev && !/[\$%]|^\d/.test(prev)) {
          rec.originator = rec.originator || prev;
        }
      }
    }

    // Round 76ek.c: commit any in-progress commentary entry once the
    // section walk finishes.
    if (pendingEntry && pendingEntry.body.length > 0) {
      commentaryEntries.push(finalizeCommentaryEntry(pendingEntry));
    }

    // Helper: parse the date trailer of an entry label.
    //   "December 2020" → 2020-12-31 (month-end anchor)
    //   "Mar 2024"      → 2024-03-31
    //   "Q3 2023"       → 2023-09-30 (quarter-end)
    //   "2021"          → 2021-12-31 (year-end)
    function parseCommentaryDate(s) {
      if (!s) return null;
      const t = String(s).trim();
      const monNames = {
        january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
        july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
        jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',
        sep:'09',sept:'09',oct:'10',nov:'11',dec:'12',
      };
      // Q3 2023 → 2023-09-30
      const quarter = t.match(/^Q([1-4])\s+(\d{4})$/i);
      if (quarter) {
        const q = parseInt(quarter[1], 10);
        const y = quarter[2];
        const m = q * 3;                       // 3, 6, 9, 12
        const lastDay = new Date(parseInt(y), m, 0).getDate();
        return `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
      }
      // Month + Year
      const monYear = t.match(/^([A-Za-z]+)\s+(\d{4})$/);
      if (monYear && monNames[monYear[1].toLowerCase()]) {
        const mm = monNames[monYear[1].toLowerCase()];
        const lastDay = new Date(parseInt(monYear[2]), parseInt(mm), 0).getDate();
        return `${monYear[2]}-${mm}-${String(lastDay).padStart(2,'0')}`;
      }
      // Year only
      const yearOnly = t.match(/^(\d{4})$/);
      if (yearOnly) return `${yearOnly[1]}-12-31`;
      return null;
    }

    // Helper: collapse the body lines into a single string and trim.
    function finalizeCommentaryEntry(entry) {
      return {
        entry_label: entry.entry_label,
        entry_date:  entry.entry_date,
        body:        entry.body.join(' ').replace(/\s+/g, ' ').trim(),
        rank:        entry.rank,
      };
    }

    if (commentaryEntries.length > 0) {
      rec.commentary = commentaryEntries;
    }

    // Pooled CMBS: this collateral's allocated balance is what we treat as
    // loan_amount for the loans-table row. Single-property loans: the
    // header origination_amount IS the loan amount.
    if (rec.loan_amount == null && rec.origination_amount != null) {
      rec.loan_amount = rec.origination_amount;
    }

    // Round 76ek.l (2026-05-08): pre-guard diagnostic. Logs whatever was
    // captured BEFORE the identity guard runs, so when the user reports
    // "loan details aren't being pulled in" we can see in DevTools whether
    // the parser actually fired but bailed at the guard, vs. didn't fire
    // at all. Prefixed with the URL so multi-tab captures stay separable.
    console.log('[LCC CoStar] Round 76ek.l: parseCmbsLoanDetail pre-guard state', {
      url:                pageUrl,
      origination_date:   rec.origination_date,
      maturity_date:      rec.maturity_date,
      originator:         rec.originator,
      borrower:           rec.borrower,
      origination_amount: rec.origination_amount,
      loan_amount:        rec.loan_amount,
      doc_number:         rec.doc_number,
      will_emit:          !!(rec.origination_date || rec.maturity_date
                            || rec.originator || rec.origination_amount
                            || rec.loan_amount),
    });

    // Identity guard — only emit a record when we got at least one of the
    // loan-identifying fields. Prevents empty {} payloads on partially-loaded
    // pages (the MutationObserver sometimes fires before the DOM settles).
    if (!rec.origination_date && !rec.maturity_date && !rec.originator
        && !rec.origination_amount && !rec.loan_amount) {
      return [];
    }

    if (snapshot.noi != null || snapshot.noi_dscr != null
        || snapshot.gla != null || snapshot.top_tenants.length > 0) {
      rec.snapshot = snapshot;
    }

    console.log('[LCC CoStar] Round 76ek.b: parsed CMBS loan record', {
      costar_loan_id:    rec.costar_loan_id,
      origination_date:  rec.origination_date,
      maturity_date:     rec.maturity_date,
      originator:        rec.originator,
      loan_amount:       rec.loan_amount,
      interest_rate:     rec.interest_rate,
      loan_status:       rec.loan_status,
      snapshot_noi:      snapshot.noi,
      snapshot_dscr:     snapshot.noi_dscr,
      snapshot_as_of:    snapshot.as_of_date,
      top_tenant_count:  snapshot.top_tenants.length,
      commentary_count:  commentaryEntries.length,
    });

    return [rec];
  }

  // ── Round 76ek.e: CMBS Financials tab parser ──────────────────────────
  //
  // The Financials tab (/detail/lookup/{N}/cmbs-financials) shows multi-year
  // actual operating financials sourced from the CMBS servicer. Layout:
  //
  //   [Property | Market]   [Totals | Per SF]
  //   Income Statement
  //   ┌─────────────────────────┬───────────┬─────┬─────┬─────┬─────────────┐
  //   │                         │ Most      │ 2023│ 2022│ 2021│ Underwritten│
  //   │                         │ Recent    │     │     │     │             │
  //   ├─────────────────────────┼───────────┼─────┼─────┼─────┼─────────────┤
  //   │ Number of Months Covered│ 6         │ 12  │ 12  │ 12  │             │
  //   │ Statement Ending Date   │ Jun 30… │ Dec…│ Dec…│ Dec…│ Dec 30, 2014│
  //   │ INCOME:                 │           │     │     │     │             │
  //   │ Gross Potential Rent    │ $920,246  │ ... │ ... │ ... │ $1,834,699  │
  //   │ Vacancy/Collection Loss │ -         │ -   │ -   │ -   │ ($293,552)  │
  //   │ Base Rent               │ ...       │ ... │ ... │ ... │ -           │
  //   │ Effective Gross Income  │ ...       │ ... │ ... │ ... │ ...         │
  //   │ OPERATING EXPENSES:     │           │     │     │     │             │
  //   │ Real Estate Taxes       │ ...       │ ... │ ... │ ... │ ...         │
  //   │ Total Operating Expenses│ ...       │ ... │ ... │ ... │ ...         │
  //   │ Net Operating Income    │ ...       │ ... │ ... │ ... │ ...         │
  //   │ Capital Expenditures    │ ...       │ ... │ ... │ ... │ ...         │
  //   └─────────────────────────┴───────────┴─────┴─────┴─────┴─────────────┘
  //
  // Hard ingestion rules (per user, Round 76ek.e):
  //   • Property toggle MUST be active. Market = submarket Avg PSF; useless.
  //   • Totals toggle MUST be active. Per SF = ratio, not absolute.
  //   • Underwritten column is SKIPPED — it's lender pro-forma, not actual.
  //   • "Most Recent" partial-year is captured but tagged months_covered < 12.
  const CMBS_FINANCIALS_URL_RE = /\/detail\/lookup\/(\d+)\/cmbs-financials(?:\/?$|\?|#)/i;

  // Mapping from CoStar income-statement labels to property_financials columns.
  // Anything not in this map lands in the line_items JSONB instead.
  const FIN_LABEL_TO_COLUMN = {
    'gross potential rent':       'gross_income',
    'vacancy/collection loss':    'vacancy',
    'effective gross income':     'effective_gross_income',
    'real estate taxes':          'taxes',
    'property insurance':         'insurance',
    'cam':                        'cam',
    'common area maintenance':    'cam',
    'total operating expenses':   'operating_expenses',
    'net operating income':       'noi',
    'noi':                        'noi',
    'capital expenditures':       'capex',
    'capex':                      'capex',
  };

  // line_items snake_case key for any label that isn't promoted to a column.
  function fin_labelToKey(label) {
    return String(label || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function fin_parseMoney(s) {
    if (s == null) return null;
    const t = String(s).trim();
    if (!t || t === '-' || t === '–' || t === '—') return null;
    // "($293,552)" → -293552  (parens = negative on financial reports)
    const isNeg = /^\s*\(.+\)\s*$/.test(t);
    const cleaned = t.replace(/[$()\s,]/g, '');
    if (cleaned === '' || cleaned === '-') return null;
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return null;
    return isNeg ? -n : n;
  }

  function fin_parseDate(s) {
    if (!s) return null;
    const t = String(s).trim();
    const monNames = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                      Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    const m = t.match(/^([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m && monNames[m[1]]) {
      return `${m[3]}-${monNames[m[1]]}-${String(m[2]).padStart(2,'0')}`;
    }
    return null;
  }

  function parseCmbsFinancials(lines, pageUrl) {
    if (!CMBS_FINANCIALS_URL_RE.test(pageUrl || '')) return [];

    // ── Step 1: detect toggle state. We scan for the toggle labels and
    //    verify both required selections are active. CoStar's DOM marks
    //    the active toggle with aria-pressed="true" or a class change,
    //    but the line walker collapses those, so we use a simpler heuristic:
    //    if "Per SF" appears in a stat-card-shaped value position (i.e.
    //    the page is rendering SF values like "$25.32 / SF" or "Per SF"
    //    appears alongside totals), treat as Per SF mode and bail.
    //
    // Practically: the cleanest signal is the presence of "/SF" or "Per SF"
    // suffixes on the value cells. If we see them on income-statement rows,
    // we're in Per SF mode. We also bail if we see the "Market" subhead
    // (which only appears in Market mode).
    let inMarketMode = false;
    let inPerSfMode  = false;
    let propertyToggleSeen = false;
    let totalsToggleSeen   = false;
    for (const raw of lines) {
      const line = String(raw || '').trim();
      if (/^market\s+income\s+statement$/i.test(line)) inMarketMode = true;
      if (/^submarket\s+(avg|average)\s+/i.test(line)) inMarketMode = true;
      if (/^property$/i.test(line)) propertyToggleSeen = true;
      if (/^totals$/i.test(line))   totalsToggleSeen = true;
      // Per-SF mode signature: values like "$25.32" with "/SF" suffix on
      // the same row, or a header row that explicitly says "$ / SF".
      if (/\$\/\s*sf|\/\s*sf$/i.test(line)) inPerSfMode = true;
    }

    if (inMarketMode) {
      console.log('[LCC CoStar] Round 76ek.e: cmbs-financials in Market mode — skipping ingestion (submarket avgs are not useful).');
      return [];
    }
    if (inPerSfMode) {
      console.log('[LCC CoStar] Round 76ek.e: cmbs-financials in Per SF mode — skipping ingestion (need Totals).');
      return [];
    }
    // We don't *require* the Property/Totals labels to be visible (CoStar's
    // DOM sometimes hides the inactive toggle), but if neither indicator
    // fired we log it for debugging.
    if (!propertyToggleSeen && !totalsToggleSeen) {
      console.log('[LCC CoStar] Round 76ek.e: toggle indicators not detected; proceeding with default Property/Totals assumption.');
    }

    // ── Step 2: identify column positions. Walk to the header row that
    //    contains "Most Recent" or year tokens, then read the column labels.
    //    Each subsequent income/expense row should produce N values where
    //    N = number of columns.
    //
    // CoStar's DOM renders the table cells as separate lines in our walker.
    // The reliable way to assemble rows is to look for known row labels and
    // grab the next K lines as values, where K = number of columns minus
    // any leading label-area blank.

    // First, harvest column headers. We expect a sequence like:
    //   "" (top-left blank), "Most Recent", "2023", "2022", "2021", "Underwritten"
    // But the leading blank may be missing. Look for the run of column-header
    // tokens: "Most Recent" + 1-4 year tokens + optional "Underwritten".
    let columnLabels = [];
    let columnsHeaderIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = String(lines[i] || '').trim();
      if (line !== 'Most Recent') continue;
      // Look ahead up to 6 lines for years and Underwritten
      const candidate = ['Most Recent'];
      let j = i + 1;
      while (j < lines.length && j < i + 8) {
        const next = String(lines[j] || '').trim();
        if (/^\d{4}$/.test(next))     { candidate.push(next); j++; continue; }
        if (/^underwritten$/i.test(next)) { candidate.push('Underwritten'); j++; continue; }
        break;
      }
      if (candidate.length >= 2) {
        columnLabels = candidate;
        columnsHeaderIdx = i;
        break;
      }
    }
    if (columnLabels.length === 0) {
      console.log('[LCC CoStar] Round 76ek.e: column header row not found.');
      return [];
    }

    // Build the column index → drop_underwritten map.
    const dropMask = columnLabels.map(c => /^underwritten$/i.test(c));

    // ── Step 3: walk rows. For each known row label, read N consecutive
    //    value lines and assign them to columns by index.
    //
    // ROW_LABELS is the set of labels we recognize. Anything else under
    // INCOME: / OPERATING EXPENSES: gets dumped into line_items.
    //
    // We don't care about exact label matching beyond what FIN_LABEL_TO_COLUMN
    // covers; the rest goes into the JSONB blob keyed by snake_case label.
    const N = columnLabels.length;

    // Per-column accumulators: one bucket per non-Underwritten year-column.
    const buckets = columnLabels.map((label, idx) => ({
      label,
      drop:           dropMask[idx],
      months_covered: null,
      period_end:     null,  // ISO date
      cols:           {},    // structured columns
      line_items:     {},    // unmapped labels → numeric values
    }));

    // Helper: at line i with label `lbl`, read the next N lines as values.
    function captureRow(i, label) {
      const values = [];
      let j = i + 1;
      let read = 0;
      while (j < lines.length && read < N) {
        const v = String(lines[j] || '').trim();
        // Skip empty lines (CoStar sometimes emits blank cells as empty strings)
        if (v === '' && read < N) { j++; continue; }
        // Stop if we hit the next row label (heuristic: lines that are not
        // numeric, not "-", not date-shaped, and not a parenthesized number
        // are probably the next label, so we abort).
        const isNumeric = /^\(?\s*\$?[\d,.]+\s*\)?$|^-$|^–$|^—$/.test(v);
        const isDate    = /^[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}$/.test(v);
        if (read > 0 && !isNumeric && !isDate) {
          // Probably hit the next row's label; stop here even if read < N.
          break;
        }
        values.push(v);
        read++;
        j++;
      }
      return { values, nextIdx: j };
    }

    let lastIdx = columnsHeaderIdx + columnLabels.length;
    for (let i = lastIdx; i < lines.length; i++) {
      const line = String(lines[i] || '').trim();
      if (!line) continue;

      // Stop scanning when we hit a non-financials section.
      if (/^(rent\s+roll|income\s+statement|expense\s+history|loan\s+details|sales|images|map|public\s+record|news|by\s+using\s+this|©\s*\d{4})/i.test(line)) {
        // Income Statement is the section we're parsing — don't break on it
        if (!/^income\s+statement$/i.test(line)) break;
      }

      // Section headers we just skip past (INCOME:, OPERATING EXPENSES:)
      if (/^(income|operating\s+expenses|or)\s*:?$/i.test(line)) continue;

      // Special row: Number of Months Covered
      if (/^number\s+of\s+months\s+covered$/i.test(line)) {
        const { values, nextIdx } = captureRow(i, line);
        for (let c = 0; c < Math.min(values.length, N); c++) {
          const m = parseInt(String(values[c]).replace(/[^\d]/g, ''), 10);
          if (Number.isFinite(m)) buckets[c].months_covered = m;
        }
        i = nextIdx - 1;
        continue;
      }

      // Special row: Statement Ending Date
      if (/^statement\s+ending\s+date$/i.test(line)) {
        const { values, nextIdx } = captureRow(i, line);
        for (let c = 0; c < Math.min(values.length, N); c++) {
          const d = fin_parseDate(values[c]);
          if (d) buckets[c].period_end = d;
        }
        i = nextIdx - 1;
        continue;
      }

      // All other rows: numeric values. Capture if next N lines look like
      // money/dash/parenthesized.
      const { values, nextIdx } = captureRow(i, line);
      if (values.length === 0) continue;

      const lower = line.toLowerCase();
      const mappedCol = FIN_LABEL_TO_COLUMN[lower];
      const liKey     = mappedCol ? null : fin_labelToKey(line);

      for (let c = 0; c < Math.min(values.length, N); c++) {
        const num = fin_parseMoney(values[c]);
        if (num == null) continue;
        if (mappedCol) {
          buckets[c].cols[mappedCol] = num;
        } else if (liKey) {
          buckets[c].line_items[liKey] = num;
        }
      }
      i = nextIdx - 1;
    }

    // ── Step 4: build property_financials rows from non-Underwritten buckets
    //    that actually have data.
    const out = [];
    for (const b of buckets) {
      if (b.drop) continue;
      if (!b.period_end) continue;  // can't write without a fiscal_year anchor
      const hasAny = b.months_covered != null
        || Object.keys(b.cols).length > 0
        || Object.keys(b.line_items).length > 0;
      if (!hasAny) continue;

      const fiscalYear = parseInt(b.period_end.slice(0, 4), 10);
      if (!Number.isFinite(fiscalYear)) continue;

      out.push({
        source:          'costar_cmbs_loan',
        fiscal_year:     fiscalYear,
        period_end_date: b.period_end,
        months_covered:  b.months_covered != null ? b.months_covered : null,
        is_actual:       true,
        ...b.cols,
        line_items:      Object.keys(b.line_items).length > 0 ? b.line_items : null,
        source_url:      pageUrl,
        data_source:     'costar_cmbs_loan',
      });
    }

    console.log('[LCC CoStar] Round 76ek.e: parsed CMBS financials', {
      columns:      columnLabels,
      dropped:      columnLabels.filter((_, i) => dropMask[i]),
      rows_emitted: out.length,
      summary:      out.map(r => ({
        fy:     r.fiscal_year,
        end:    r.period_end_date,
        months: r.months_covered,
        noi:    r.noi,
        opex:   r.operating_expenses,
        egi:    r.effective_gross_income,
        li_keys: r.line_items ? Object.keys(r.line_items).length : 0,
      })),
    });

    return out;
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

  // CoStar UI elements that appear in tenant sections but are NOT tenant names.
  // Round 76eu-E (2026-04-29): added For-Lease-at-Sale panel labels +
  // "Withheld" sentinel after 5 Route 45 Mannington showed Withheld
  // landing in ctx.tenants[]. The server-side filter caught it on write,
  // but the comparison panel in the sidebar UI shows the unfiltered
  // ctx.tenants[] so the user saw "Withheld" listed as a proposed tenant
  // change. Filter at extraction so junk never reaches the UI.
  const COSTAR_UI_REJECT = /^(name|source:.*|costar.*research|directory|stacking\s+plan|available|moving\s+(out|in)|show|both|tenant|industry|floor|sf\s+occupied|move\s+date|exp\s+date|lease\s+(start|type|term|activity|status)|rent\/?sf|rent\s+(type|schedule|steps|adjust(?:ment)?s?|escalation\s+type)|my\s+data|shared\s+data|direct|office|retail|industrial|medical|warehouse|flex|mixed[-\s]?use|sublease|status|vacant|occupied|renewal|expiring|current|historical|all|none|sort|filter|search|export|print|map|list|grid|table|view|collapse|expand|details|summary|overview|edit|add|remove|save|cancel|close|back|next|prev|more|less|total|subtotal|avg|min|max|moved\s+out|confirmed|withheld|for\s+lease\s+at\s+sale|smallest\s+space|max\s+contiguous|total\s+(available|vacant)|direct\s+vacant|sublet\s+(available|space)?|office\s+avail(?:able)?|retail\s+avail(?:able)?|industrial\s+avail(?:able)?|flex\s+avail(?:able)?|warehouse\s+avail(?:able)?|medical\s+avail(?:able)?|asking\s+rent|rent|service\s+type|tenancy|owner\s+occupied|sign\s+date|leased|use|services|use\s+type|space\s+(use|type|category|id)|building\s+id|tenant\s+(id|type)|expense\s+(type|structure)|expenses?|listing\s+(id|type|status)|on\s+market(?:\s+(?:since|date))?|days?\s+on\s+market|move[-\s]?in\s+ready|brand|brand\/tenant|tenant\/brand|condition|class|grade|unkwn|unknown|n\/?a|tbd|since\s+\w+\s+\d{1,2},?\s+\d{4})$/i;
  // OM-style table-of-contents section headers that CoStar sometimes renders
  // adjacent to the Tenants list. Without this, repeating the issue from
  // 2026-04-25 (Bug M) at the extension layer: "Loan", "Financials",
  // "Changes" leak through as tenant names. Extending here mirrors the
  // server-side OM_SECTION_RE in api/_handlers/sidebar-pipeline.js.
  const OM_SECTION_REJECT = /^(loan|loans|financial|financials|changes|recent\s+changes|sale\s+highlights|investment\s+highlights|key\s+highlights|property\s+(overview|highlights|summary|info|description)|location\s+overview|tenant\s+(overview|details?|info)|lease\s+abstract|rent\s+roll|operating\s+statement|comparable\s+sales|sales\s+comps|lease\s+comps|disclaimer|confidentiality|table\s+of\s+contents|appendix|exhibits?|executive\s+summary|sale\s+notes|md\/dds|md\/dental|medical\/office|office\/medical)\s*$/i;
  // Compound CoStar metadata strings smashed onto one line, recognized by
  // either the middle-dot delimiter OR the simultaneous presence of a
  // colon-separated key and a /SF token (e.g.
  // "Tenancy: Summary \u00b7 Owner Occupied: No \u00b7 Est. Rent: $14 - 17/SF (Retail)").
  // Broadened 2026-04-27 (Round 76q): also match /FS /MG /IG /NNN lease-type
  // suffixes ('Est. Rent: $22 - 27/FS (Office)') plus a more liberal compound
  // detector — lines containing TWO or more 'Key: Value' pairs separated by
  // ANY delimiter ('Tenancy: Summary - Owner Occupied: No - Est. Rent: ...').
  const COMPOUND_METADATA_REJECT = /(\u00b7|\u2022)|(:[^,\n]*\b(\d|\$)[^,\n]*\/(sf|fs|mg|ig|nnn|gross|net)\b)|((?:[a-z][a-z\s]*:[^,:\n]+){2,})/i;
  // NAICS sector classifications that CoStar surfaces near the tenant list.
  // Mirrors server-side NAICS_SECTOR_RE in api/_handlers/sidebar-pipeline.js.
  // Without this, 'Health Care and Social Assistance' (the NAICS sector for
  // dialysis operators) leaks through as a tenant name with an absurd 15 SF
  // value attached — observed 2026-04-27 from a CoStar Tenants horizontal
  // table layout.
  const NAICS_SECTOR_REJECT = /^(agriculture|mining|utilities|construction|manufacturing|wholesale\s+trade|retail\s+trade|transportation\s+and\s+warehousing|information|finance\s+and\s+insurance|real\s+estate(\s+and\s+rental(\s+and\s+leasing)?)?|professional(,?\s+scientific(,?\s+and\s+technical\s+services)?)?|management\s+of\s+companies|administrative(\s+and\s+support)?|educational\s+services|health\s+care(\s+and\s+social\s+assistance)?|arts(,?\s+entertainment(,?\s+and\s+recreation)?)?|accommodation(\s+and\s+food\s+services)?|other\s+services|public\s+administration)\s*$/i;
  // Building-size sanity guard: any tenant entry with leased SF below this
  // threshold is almost certainly a NAICS-percentage or footer-stat artifact,
  // not a real tenant. Real commercial tenants don't lease 15 SF.
  const MIN_PLAUSIBLE_TENANT_SF = 100;

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

      // Bare "Tenants" header used on Industrial Sale Comp pages — the
      // body is a single-tenant summary bar followed by the tenant name
      // and an SF value. parseTenantSection skips the summary bar lines.
      if (/^tenants?$/i.test(line)) {
        parseTenantSection(lines, i + 1, tenants);
        continue;
      }
    }

    // Fallback: single-tenant industrial block where neither structured
    // section fired. Detect "Tenancy: Single" → next capitalized non-junk
    // line → SF value, and synthesize one tenant entry from that block.
    if (tenants.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        if (!/tenancy\s*[:\s]\s*single/i.test(lines[i])) continue;
        for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
          const cand = lines[j];
          if (!cand) continue;
          if (/^[\d,]+\s*sf\s*$/i.test(cand)) continue;
          if (/^(tenancy[:\s]|owner\s+occupied|est\.?\s*rent|net\s+lease|gross\s+lease|\$?\d)/i.test(cand)) continue;
          if (cand.length < 3 || cand.length > 80) continue;
          if (!/^[A-Z]/.test(cand)) continue;
          if (/@/.test(cand) || /^https?:/i.test(cand)) continue;
          const sfLine = lines[j + 1];
          // Round 76dr: same placeholder-zero guard as parseTenantSection.
          let hasSf = false;
          if (sfLine && /^[\d,]+(\s*sf)?$/i.test(sfLine)) {
            const sfNum = parseInt(sfLine.replace(/[^\d]/g, ''), 10);
            const startsWithMultipleZeros = /^0{2,}/.test(sfLine.replace(/[^\d]/g, ''));
            hasSf = Number.isFinite(sfNum) && sfNum >= 100 && !startsWithMultipleZeros;
          }
          const entry = { name: cand };
          if (hasSf) entry.sf = sfLine.replace(/\s*sf\s*$/i, '').trim() + ' SF';
          tenants.push(entry);
          break;
        }
        if (tenants.length) break;
      }
    }

    // Round 76ej.m (2026-05-04): final-pass junk filter. Defense in depth
    // for tenants that slipped past parseTenantSection's section-break
    // logic — Pettit Ave Sale Comp Summary tab continued to surface
    // "About the Architect" / "M Ford Mcneil" / "Brooklyn, NY 11233" /
    // "Since Jun 23, 2009" / "Medical" / "Unkwn" as tenant rows. Apply
    // every junk pattern we know about against tenant.name and drop
    // hits silently. Pure defensive code — never logs successes.
    const FINAL_JUNK_RE = new RegExp(
      '^(' + [
        // CoStar UI labels and column headers
        'lease\\s+activity', 'sign\\s+date', 'leased', 'use', 'services',
        'rent\\s+(type|schedule|steps|adjust(?:ment)?s?|escalation\\s+type)',
        'use\\s+type', 'space\\s+(use|type|category|id)',
        'building\\s+id', 'tenant\\s+(id|type)',
        'expense\\s+(type|structure)', 'expenses?',
        'listing\\s+(id|type|status)',
        'on\\s+market(?:\\s+(?:since|date))?',
        'days?\\s+on\\s+market',
        'brand', 'brand/tenant', 'tenant/brand',
        'condition', 'class', 'grade',
        'about\\s+the\\s+(architect|developer|owner|seller|buyer|building|tenant|property|broker|firm)',
        'true\\s+(seller|buyer)', 'recorded\\s+(seller|buyer)',
        'listing\\s+broker', 'listing\\s+contacts?', 'costar\\s+comp\\s+contact',
        // Bare use categories (anchored, won't false-positive on real names)
        'medical', 'office', 'retail', 'industrial', 'warehouse',
        'flex', 'mixed[-\\s]?use', 'residential', 'hospitality',
        'specialty', 'land', 'other',
        // Placeholders
        'unkwn', 'unknown', 'n/?a', 'tbd', 'none', 'null',
        '-+', '—+', '\\.{2,}',
        // Date strings
        '(since\\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\\s+\\d{1,2},?\\s+\\d{4}',
        'q[1-4]\\s+\\d{4}',
        '\\d{1,2}/\\d{1,2}/\\d{2,4}',
        '\\d{4}-\\d{1,2}-\\d{1,2}',
        '\\d{4}\\s*[-–]\\s*\\d{4}',
        // City, ST ZIP residue
        '[a-z\\s]+,\\s*[a-z]{2}(\\s+\\d{5}(-\\d{4})?)?',
        // Generic country names
        'united\\s+states', 'usa', 'us',
      ].join('|') + ')\\s*$',
      'i'
    );
    const cleaned = tenants.filter((t) => {
      if (!t || !t.name) return false;
      const n = String(t.name).trim();
      if (n.length < 3) return false;
      if (FINAL_JUNK_RE.test(n)) {
        console.debug('[costar.js] Dropped junk tenant:', n);
        return false;
      }
      return true;
    });
    return cleaned;
  }

  function parseTenantSection(lines, startIdx, tenants) {
    let current = null;

    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];

      // Stop at next major section (includes demographics, traffic, location,
      // property-description sections, and CoStar chrome panels). Without
      // these stops, extractTenants bleeds past the real Tenants block and
      // picks up lines like "About the Owner", "Amenities", "Airport X.XX mi",
      // "Drive …", and CoStar-branded footers as if they were tenants.
      // Round 76dn: added public\s+transportation. Without it, "Public
      // Transportation" (CoStar's airports/drive-times section header on
      // the property summary page) was being parsed as a tenant name.
      // Round 76ef: added sale\s+highlights, location\s+highlights,
      // tenant\s+highlights, conditions, sale\s+contacts, and other
      // header variants seen on the 1507 Hillview Dr / Hillsboro capture
      // where Sale Highlights bullet text was being captured as tenants.
      // Round 76ej.l: added 'architect|developer' to about-the-* list and
      // 'true\s+(seller|buyer)' / 'recorded\s+(seller|buyer)' / 'listing\s+broker'
      // / 'costar\s+comp\s+contact' for Sale Comp Contacts page section
      // headers (Pettit Ave capture). Also added 'lease\s+activity' which
      // is the column-header bar atop the lease history table on the
      // Lease tab — without this, parseTenantSection bled past the
      // tenant block into 'Sign Date' / 'Use' / 'Services' / 'Rent Type'
      // column headers and captured them as tenant rows.
      if (/^(seller|buyer|listing|building|land\b|market|public\s+record|public\s+transportation|my\s+notes|sources|sale\s+comp|sale\s+contacts|©|contacts|demographics|traffic|location|walk\s+score|transit\s+score|transportation|nearby|environmental|flood|tax\s+history|assessment\s+history|about\s+the\s+(owner|seller|buyer|building|tenant|property|architect|developer|broker|firm)|amenities|airport|drive(\s+time|\s+to)?|costar|costar\s+comp\s+contact|investment\s+highlights|property\s+highlights|property\s+summary|location\s+highlights|tenant\s+highlights|sale\s+highlights|sale\s+notes|conditions|documents|comparable|expense\s+structure|income\s+(&|and)\s+expenses|rent\s+roll|space\s+available|lease\s+activity|true\s+(seller|buyer)|recorded\s+(seller|buyer)|listing\s+broker|listing\s+contacts?)/i.test(line)) break;

      // Skip CoStar UI elements + OM section headers + compound metadata strings + NAICS sectors
      if (COSTAR_UI_REJECT.test(line)) continue;
      if (OM_SECTION_REJECT.test(line)) continue;
      if (COMPOUND_METADATA_REJECT.test(line)) continue;
      if (NAICS_SECTOR_REJECT.test(line)) continue;

      // Skip lines that are just dates (month/year) — these are column values, not names
      if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}$/i.test(line)) continue;
      // Round 76ej.l: also skip "Since Jun 23, 2009" / "Mar 26, 2026" /
      // "Q2 2026" / "1/15/2024" / ISO-date / "2020-2025" residue.
      if (/^(since\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:uary|ruary|ch|il|y|e|y|ust|tember|ober|ember)?\s+\d{1,2},?\s+\d{4}|q[1-4]\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{4}\s*[-–]\s*\d{4})\s*$/i.test(line)) continue;

      // Skip summary-bar values seen under a bare "Tenants" header on
      // Industrial Sale Comp pages (Tenancy:, Owner Occupied, Est. Rent).
      if (/^(tenancy\s*[:\s]|owner\s+occupied|est\.?\s*rent|net\s+lease|gross\s+lease|nnn|modified\s+gross)/i.test(line)) continue;

      // SF value (often follows tenant name): "8,750" or "8,750 SF".
      // Round 76dr: reject placeholder values like "0000,000", "0", or any
      // string with multiple leading zeros — those are CoStar sandbox/test
      // tenant rows that the prior digit-and-comma matcher accepted as
      // valid. Real SF values start with 1-9 (commercial buildings of
      // any meaningful size are >= 100 SF).
      if (/^[\d,]+(\s*sf)?$/i.test(line)) {
        const sfNum = parseInt(line.replace(/[^\d]/g, ''), 10);
        const startsWithMultipleZeros = /^0{2,}/.test(line.replace(/[^\d]/g, ''));
        if (Number.isFinite(sfNum) && sfNum >= 100 && !startsWithMultipleZeros) {
          if (current) current.sf = line.replace(/\s*sf\s*$/i, '').trim() + ' SF';
        }
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
      const TENANT_SECTION_REJECT = /^(industry|sector|property\s+type|property\s+subtype|secondary\s+type|building\s+class|construction|year\s+built|year\s+renovated|lot\s+size|zoning|parking|stories|floors|typical\s+floor|ceiling\s+height|tenancy|single\s+tenant|multi.tenant|net\s+lease|gross\s+lease|nnn|modified\s+gross|submarket|market|market\s+data|analytics|reports|demographics|transit|walk\s+score|name|source|available|vacant|none|sf|sf\s+occupied|directory|stacking\s+plan|leasing|for\s+lease|for\s+sale|lease\s+type|lease\s+term|rent\/?sf|move\s+date|exp\s+date|floor|assessment|investment|research|my\s+notes|contacts|data|verified|confirmed|population|households|median\s+age|median\s+hh\s+income|daytime\s+employees|traffic|traffic\s+vol|last\s+measured|collection\s+street|cross\s+street|distance|location|nearby|environmental|flood|tax\s+history|assessment\s+history|transportation)$/i;
      // Also reject: street names (ending in Ave/St/Blvd + optional direction),
      // product attribution, growth projections, and store-type labels
      const TENANT_STREET_JUNK = /\b(ave|st|blvd|rd|dr|pkwy|pl|ct|ln|way|hwy)\s*(n|s|e|w|ne|nw|se|sw)?$/i;
      const TENANT_JUNK_PATTERN = /^(made\s+with\s+|.*trafficmetrix|.*growth\s+'\d|store\s+type)/i;
      // Round 76dq: catch CoStar placeholder/sandbox tenant entries seen on
      // 5 Route 45 Mannington — "xxx", "Abc 9999", and similar all-x or
      // alphabet+digit nonsense names that aren't real tenants.
      // Also reject obviously placeholder SF rows like "0000,000".
      const TENANT_PLACEHOLDER = /^(x{2,}|y{2,}|z{2,}|abc\b|xyz\b|test\b|sample\b|placeholder\b|tbd\b|t\.b\.d\.?|n\/?a)\b/i;
      const TENANT_ALPHA_THEN_DIGITS_ONLY = /^[A-Za-z]{1,4}\s*\d{2,}$/;
      // Round 76ef: sentence-rejection rule. Sale Highlights / Tenant
      // Highlights bullets bleed into the tenant block when the section-
      // break regex above misses them; bullet text reads like a sentence
      // ("Tenant has 20-year operating history at the site"), not a
      // 1-4 word business name. Reject candidates that:
      //   (a) have 7+ words (real commercial tenants rarely exceed 6 words
      //       — e.g. "Federal Reserve Bank of San Francisco" = 6); OR
      //   (b) contain mid-string lowercase helper verbs / clause-joiners
      //       that mark sentence prose.
      const wordCount = line.trim().split(/\s+/).length;
      const SENTENCE_VERB_RE = /\s+(has|have|is|are|was|were|will|been|calls\s+for|indicates|signed|executed|installed|located|limited\s+to|priced\s+at|ensures?|provides?|offers?|features?|includes?|presents?)\s+/i;
      if (line.length > 2 && line.length < 80 && /^[A-Z]/.test(line) &&
          !/^\d/.test(line) && !/@/.test(line) && !/^https?:/i.test(line) &&
          !TENANT_SECTION_REJECT.test(line) &&
          !TENANT_STREET_JUNK.test(line) &&
          !TENANT_JUNK_PATTERN.test(line) &&
          !TENANT_PLACEHOLDER.test(line) &&
          !TENANT_ALPHA_THEN_DIGITS_ONLY.test(line) &&
          wordCount <= 6 &&
          !SENTENCE_VERB_RE.test(line)) {
        // Push previous tenant via the plausibility-checked helper.
        pushTenantIfPlausible(current, tenants);
        current = { name: line };
        continue;
      }
    }

    pushTenantIfPlausible(current, tenants);
  }

  // Plausibility-checked tenant insert. Drops dupes by name. Drops tenants
  // whose attached SF is < MIN_PLAUSIBLE_TENANT_SF (Round 76q) — those are
  // almost always NAICS percentages or other CoStar UI artifacts that the
  // upstream regex filters didn't catch.
  function pushTenantIfPlausible(t, list) {
    if (!t || !t.name) return;
    if (list.some((existing) => existing.name === t.name)) return;
    if (t.sf) {
      const sfNum = parseInt(String(t.sf).replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(sfNum) && sfNum > 0 && sfNum < MIN_PLAUSIBLE_TENANT_SF) {
        // Suppress noisy log spam — only log first few drops per session
        if (typeof window !== 'undefined') {
          window.__lcc_tenant_drops = (window.__lcc_tenant_drops || 0) + 1;
          if (window.__lcc_tenant_drops < 5) {
            console.log('[lcc-extension] dropped tenant with implausible SF:', t.name, t.sf);
          }
        }
        return;
      }
    }
    list.push(t);
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
  const CONTACT_NAME_REJECT = /^(since\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|since\s+\d|seller\s*$|buyer\s*$|buyer\s+contacts?|seller\s+contacts?|investment\s+manager|research\s+consultant|other\s*[-–—]\s*private|president|vice\s+president|officer|director|manager|analyst|consultant|partner|principal|agent|broker|owner|lender|not\s+disclosed|not\s+available|no\s+buyer|no\s+seller|confirmed|verified|research\s+complete|comp\s+status|united\s+states|[a-z].*,\s*[a-z]{2}\s+\d{5}|logo|source|add\s+notes|name$|developer(\s*[-–—]\s*\w+)?$|sale\s+notes?$|about\s+the\s+(owner|seller|buyer|building|tenant|property)|amenities|airport(\s|$)|drive(\s+time|\s+to|\s+distance)?$|costar\s+(est|group|comp|research)|investment\s+highlights|property\s+(highlights|summary)|developer\s*[-–—]\s*(regional|national|local))/i;

  // Pure job titles that sometimes slip in as "names" when the DOM puts a
  // title on its own line (no preceding Name/Title pair to anchor on).
  const TITLE_ONLY_PATTERNS = [
    /^(senior|junior|managing|executive|vice|chief|assistant)\s+(managing\s+)?(director|vice\s+president|vp|president|officer|partner|principal|consultant|broker|manager|analyst|associate)\b/i,
    // Title, Department suffix — "Senior Managing Director, Brokerage"
    /,\s*(capital\s+markets|brokerage|research|investment\s+sales|debt|equity|acquisitions?|dispositions?|industrial|office|retail|multifamily)\s*$/i,
    /^senior\s+comps?\s+researcher\b/i,
    // Bare title + department phrases that aren't personal names
    /^(director|manager|analyst|associate|partner|principal|consultant|broker|president|agent)\s*,/i,
    // Title without preceding qualifier but whose whole content is a title
    /^(comps?\s+researcher|research\s+analyst|acquisitions?\s+(manager|director|associate|analyst)|asset\s+manager|portfolio\s+manager|transaction\s+manager|financial\s+analyst)\b/i,
    // Titles that embed "of" — "Director of Acquisitions", "Head of Capital Markets"
    /^(director|manager|head|vp|vice\s+president|president)\s+of\s+/i,
  ];

  // Reject city/state/zip patterns like "Saint Louis, MO 63125"
  function isContactNameGarbage(s) {
    if (!s || s.length < 2) return true;
    const trimmed = s.trim();
    if (CONTACT_NAME_REJECT.test(trimmed)) return true;
    // Round 76ek.g (2026-05-08): CoStar's per-sale Verification block
    // surfaces sentence-shaped footnotes that the contact extractor was
    // capturing as TRUE_SELLER_CONTACT names — e.g. "The sale price RBA
    // were verified with listing broker" / "The deed was unavailable
    // at the time of publication." Reject any string that's clearly a
    // sentence: starts with a determiner (the/this/a/an/it), contains a
    // verb auxiliary (was/were/is/are/has/have/had/will/would), and has
    // ≥4 tokens. Real contact names are at most 4 tokens (First Middle
    // Last, optional Sr./Jr.) and don't have verb auxiliaries.
    const SENTENCE_SHAPE_RE =
      /^(the|this|that|a|an|it|all|none|no)\b[\s\S]+\b(was|were|is|are|has|have|had|will|would|been|verified|unavailable|confirmed|disclosed|published|obtained|recorded|reported)\b/i;
    if (SENTENCE_SHAPE_RE.test(trimmed) && trimmed.split(/\s+/).length >= 4) return true;
    // Trailing period on a multi-word string is a strong sentence signal
    // for our contact-name domain (legitimate names never end in '.').
    if (/\w\.\s*$/.test(trimmed) && trimmed.split(/\s+/).length >= 4) return true;
    // City, ST ZIP pattern (e.g. "Los Angeles, CA 90048")
    if (/^[A-Z][a-z]+.*,\s*[A-Z]{2}\s+\d{4,5}/.test(s)) return true;
    // Concatenated multi-line address (contains ZIP mid-string with no break)
    if (/\b\d{5}\b.*\b(united\s+states|us)\b/i.test(s)) return true;
    // "One Financial CenterBoston" — address concatenation artifact
    if (/\d{5}[A-Z]/.test(s)) return true;
    // Standalone date patterns
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d/i.test(s)) return true;
    // Pure title strings masquerading as names
    for (const pat of TITLE_ONLY_PATTERNS) {
      if (pat.test(trimmed)) return true;
    }
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
      // Reject single-token first-name-only captures. CoStar contact
      // blocks always print broker names as "First Last" (sometimes with
      // a middle initial). A lone "John" slipping through here meant a
      // logo/title boundary confused the extractor into treating the
      // stray first-name token as a new person. Single-letter initials
      // like "T Smith" are fine — they contain a space.
      if (!/\s/.test(s.trim())) return false;
      return true;
    }

    function isTitleLine(s) {
      return /director|manager|analyst|advisor|associate|vp\b|president|officer|agent|broker|partner|principal|senior|managing|consultant/i.test(s);
    }

    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];

      // Stop at section boundaries and page footer content (prefix match)
      if (/^(transaction\s+details|building|land\b|market|tenants?\s+at|public\s+record|my\s+notes|sources|verification|sale\s+comp|comparable|©\s*\d{4}|by\s+using\s+this|costar\s+comp|last\s+updated|report\s+an\s+error|publication\s+date)/i.test(line)) break;
      // Stop at any contact-section header that appears as a standalone line.
      // Required to prevent one section's parser (e.g. Listing Broker) from
      // sweeping across adjacent sections (True Buyer, Recorded Buyer, Current
      // Owner, Lender, …) and tagging those people with the wrong role.
      if (j > startIdx && /^(true\s+(buyer|seller)|current\s+owner|recorded\s+(owner|buyer|seller)|buyer\s+broker|listing\s+(broker|agent)|lender|seller|buyer)$/i.test(line)) break;

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

  // Elements whose own text marks the end of the Contacts region (nothing
  // after them belongs to any contact role). Matching is done against
  // getOwnText (not textContent) to avoid matching parents that happen to
  // contain the label deep in their subtree.
  const SECTION_END_SENTINEL_RE = /^(my\s+notes|sources(\s+&\s+research)?|verification|documents?|assessment(\s+at\s+sale)?|public\s+record|tenants?\s+at|sale\s+comp\s+id|income\s+&\s+expenses|transaction\s+details|building(\s+summary|\s+information)?|land\b|market|investment\s+highlights)/i;

  // `a.compareDocumentPosition(b) & FOLLOWING` is true when b follows a in
  // document order (or is a descendant of a). We use this to bucket each
  // mailto/tel link to the nearest section header that precedes it, cut off
  // by any intervening end sentinel.
  function extractContactsFromDOM() {
    const contacts = [];

    const allLinks = document.querySelectorAll(
      'a[href^="mailto:"],a[href^="tel:"]'
    );
    if (allLinks.length === 0) return contacts;

    // Collect role-section headers AND end sentinels in a single scan so
    // they stay in document order. Each "Contacts" panel on CoStar holds
    // several role headers inside one DOM subtree — we can't rely on a
    // common ancestor to scope them; we have to slice by document order
    // between adjacent markers.
    const markers = [];
    const allElements = document.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,div,span,p,td,th,label'
    );
    for (const el of allElements) {
      const ownText = getOwnText(el).trim();
      if (!ownText || ownText.length > 80) continue;
      const role = roleFromHeader(ownText);
      if (role) {
        markers.push({ element: el, kind: 'section', role, text: ownText });
        continue;
      }
      if (SECTION_END_SENTINEL_RE.test(ownText)) {
        markers.push({ element: el, kind: 'end', text: ownText });
      }
    }
    if (!markers.some(m => m.kind === 'section')) return contacts;

    // querySelectorAll returns elements in document order already; sort is
    // defensive in case future refactors merge multiple queries here.
    markers.sort((a, b) => {
      if (a.element === b.element) return 0;
      const p = a.element.compareDocumentPosition(b.element);
      if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    // For a given link, walk the markers in reverse doc order and find the
    // first one that precedes it. If that marker is an end sentinel, the
    // link is outside any role section — drop it.
    function ownerForLink(linkEl) {
      let owner = null;
      for (const m of markers) {
        const p = m.element.compareDocumentPosition(linkEl);
        if (p & Node.DOCUMENT_POSITION_FOLLOWING) {
          owner = m;                   // m precedes linkEl
        } else {
          break;                       // markers are in doc order
        }
      }
      return owner;
    }

    // Nearest reasonably-sized ancestor of the link — used as the "contact
    // block" for name/title extraction. Bounded walk avoids climbing out of
    // the role section.
    function findBlockForLink(linkEl) {
      let block = linkEl.parentElement;
      for (let i = 0; i < 6; i++) {
        if (!block || block === document.body) return null;
        const text = (block.textContent || '').trim();
        if (text.length >= 10 && text.length <= 500) return block;
        block = block.parentElement;
      }
      return null;
    }

    // Dedup by (block, role) — the same block may hold both a mailto and a
    // tel link; we want one contact row out of that, not two.
    const seenBlockRoles = new Map(); // block → Set<role>
    for (const link of allLinks) {
      const owner = ownerForLink(link);
      if (!owner || owner.kind !== 'section') continue;
      const block = findBlockForLink(link);
      if (!block) continue;

      let roleSet = seenBlockRoles.get(block);
      if (!roleSet) {
        roleSet = new Set();
        seenBlockRoles.set(block, roleSet);
      }
      if (roleSet.has(owner.role)) continue;
      roleSet.add(owner.role);

      const person = extractPersonFromBlock(block);
      if (person && person.name) {
        person.role = owner.role;
        contacts.push(person);
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

    // Name: look for prominent text elements (strong, heading, first link).
    // Require at least one space in the candidate so a stray first-name
    // token from a logo/title boundary ("John") can't become the captured
    // name. Single-token titles and role labels are already rejected by
    // isContactNameGarbage, but broker names always arrive as "First Last".
    const nameEl = block.querySelector(
      'strong, b, h3, h4, h5, [class*="name"], [class*="Name"]'
    );
    if (nameEl) {
      const candidate = nameEl.textContent.replace(/\s+/g, ' ').trim();
      if (candidate.length >= 3 && candidate.length <= 60 &&
          /^[A-Z]/.test(candidate) && !/@/.test(candidate) &&
          !/^\d/.test(candidate) && !/^(logo|http)/i.test(candidate) &&
          /\s/.test(candidate) &&
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
            /\s/.test(line) &&
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

    // Parse Transaction Details block (most recent sale or active listing)
    // Only mark is_current for active listings — closed sales with confirmed
    // pricing or "Research Complete" comp status are historical, not current.
    for (let i = 0; i < lines.length; i++) {
      if (/^transaction\s+details$/i.test(lines[i])) {
        const sale = parseTransactionBlock(lines, i + 1);
        if (sale && (sale.sale_date || sale.sale_price)) {
          const isClosed = /^(research\s+complete|confirmed)/i.test(sale.comp_status || '')
            || /^(full\s+value|confirmed|partial)/i.test(sale.price_status || '');
          if (!isClosed) sale.is_current = true;
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

    // Round 76ej.y (2026-05-05): "Last Sale" / "Last Loan" summary
    // blocks. Counties without per-deed records (Bay County, FL —
    // Panama City Beach 140 Richard Jackson Blvd / 6494163) collapse
    // their CoStar Public Record tab into a single Last Sale + Last
    // Loan summary instead of an expandable Sale/Loan History list.
    // Without this branch, the only historical sale on those listings
    // never reached sales_history → never landed in dia/gov
    // sales_transactions → property looked like it had no prior sale
    // even though CoStar shows the $4.9M MARINA LAKES LLC purchase
    // from 12/19/2006 right at the top of the page.
    if (sales.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        if (/^last\s+sale$/i.test(lines[i])) {
          const lastSale = parseLastSaleSummary(lines, i + 1);
          if (lastSale && (lastSale.sale_date || lastSale.sale_price)) {
            sales.push(lastSale);
          }
          break;
        }
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

  // Parse the single-record "Last Sale" summary that some CoStar
  // counties show in lieu of an expandable Sale/Loan History. Field
  // labels overlap parseDeedHistory's set with two key differences:
  //   - "Sale Date"        (instead of "Transaction Date")
  //   - "Sale Price (LTV)" — strip the "(LTV X%)" suffix
  // Also walks an immediately-following "Last Loan" block and merges
  // its origination_date / loan_amount / lender into the sale record
  // (for these counties the loan IS the financing of the same sale).
  function parseLastSaleSummary(lines, startIdx) {
    const sale = {};
    const STOP = /^(improvements|assessment|owner|tax|parcel|tenants?|listings|public\s+record|land\b|building\b|building\s+info|map\s+view|photos)$/i;
    let i;
    let inLoanBlock = false;

    for (i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      const next = i + 1 < lines.length ? lines[i + 1] : '';

      if (/^last\s+loan$/i.test(line))    { inLoanBlock = true; continue; }
      if (STOP.test(line)) break;
      if (/^(transaction|sale\s+contact\s+details|loan\s+details|contact\s+details)$/i.test(line)) continue;

      // Sale (and Last Sale) fields
      if (!inLoanBlock) {
        if (/^sale\s+date$/i.test(line) && next)             { sale.sale_date = next; continue; }
        if (/^recordation\s+date$/i.test(line) && next)      { sale.recordation_date = next; continue; }
        if (/^sale\s+type$/i.test(line) && next)             { sale.sale_type = next; continue; }
        if (/^transaction\s+type$/i.test(line) && next)      { sale.transaction_type = next; continue; }
        if (/^deed\s+type$/i.test(line) && next)             { sale.deed_type = next; continue; }
        if (/^document\s+#$/i.test(line) && next)            { sale.document_number = next; continue; }
        if (/^doc\s+book\/page$/i.test(line) && next)        { sale.doc_book_page = next; continue; }
        if (/^sale\s+price(?:\s+\(ltv\))?$/i.test(line) && next && /^\$/.test(next)) {
          // "Sale Price (LTV)" → next line is "$4,900,000 (LTV 73%)".
          // Keep only the dollar amount; LTV stays in transaction_type/notes.
          const m = next.match(/^\$[\d,]+(?:\.\d+)?/);
          sale.sale_price = m ? m[0] : next;
          continue;
        }

        if (/^buyer$/i.test(line)) {
          if (next && next.length < 80 && !/^(address|seller|title|loan)/i.test(next)) {
            sale.buyer = next;
            sale.buyer_address = findEntityAddress(lines, i + 2);
          }
          continue;
        }
        if (/^seller$/i.test(line)) {
          if (next && next.length < 80 && !/^(title|buyer|address|lender|loan)/i.test(next)) {
            sale.seller = next;
            sale.seller_address = findEntityAddress(lines, i + 2);
          }
          continue;
        }
        if (/^title\s+company$/i.test(line) && next && next.length < 80) {
          sale.title_company = next;
          continue;
        }
      } else {
        // Last Loan block — these fields associate with the same sale.
        if (/^origination\s+date$/i.test(line) && next)      { sale.loan_origination_date = next; continue; }
        if (/^loan\s+amount$/i.test(line) && next)           { sale.loan_amount = next; continue; }
        if (/^loan\s+type$/i.test(line) && next)             { sale.loan_type = next; continue; }
        if (/^loan\s+term$/i.test(line) && next)             { sale.loan_term = next; continue; }
        if (/^(originator|lender)$/i.test(line) && next && next.length < 80) {
          sale.lender = next; continue;
        }
        if (/^document\s+#$/i.test(line) && next)            { sale.loan_document_number = next; continue; }
        if (/^doc\s+book\/page$/i.test(line) && next)        { sale.loan_doc_book_page = next; continue; }
        if (/^borrower$/i.test(line) && next && !sale.buyer && next.length < 80) {
          sale.buyer = next; continue;
        }
      }
    }

    return sale;
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
      backgroundColor: '#FFFFFF',
      border: '1.5px solid #1F3864',
      borderRadius: '4px',
      cursor: 'pointer',
    });
    btn.addEventListener('click', () => {
      safeSendMessage({ type: 'OPEN_SIDE_PANEL' });
    });
    headingEl.parentElement?.appendChild(btn);
  }
})();
