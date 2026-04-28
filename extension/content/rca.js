// ============================================================================
// LCC Assistant — Content Script: RCA (Real Capital Analytics, MSCI)
//
// Captures Property Details + Investor Profile pages from app.rcanalytics.com.
// Unlike CoStar, RCA's React DOM uses stable, semantic class names so we can
// querySelector for specific fields rather than line-scanning textContent.
//
// Triggers when:
//   - hostname endsWith 'rcanalytics.com'
//   - pathname matches /^\/(property|company|company-contacts|company-profile|lender-profile)\//
//
// Sends CONTEXT_DETECTED message with domain='rca' so background.js routes
// it to the same /api/entities sidebar save endpoint as CoStar. The metadata
// schema is intentionally identical to what CoStar emits so server-side
// sidebar-pipeline.js writers handle RCA captures with no domain-specific code.
//
// See extension/samples/rca_property_detail_NOTES.md for the field mapping.
// ============================================================================

(function () {
  'use strict';

  let lastUrl = null;
  let extractionTimer = null;
  let lastSentSig = null;

  // Watch for SPA route changes via MutationObserver; RCA is angular and
  // often does in-place rewrites without a full page navigate.
  const observer = new MutationObserver(() => {
    clearTimeout(extractionTimer);
    extractionTimer = setTimeout(extract, 600);
  });

  function isRcaPropertyDetail() {
    return location.pathname.includes('/property/');
  }
  function isRcaInvestorProfile() {
    return location.pathname.startsWith('/company/')
        || location.pathname.startsWith('/company-profile/')
        || location.pathname.startsWith('/company-contacts/');
  }

  function start() {
    if (!/(^|\.)rcanalytics\.com$/.test(location.hostname)) return;
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(extract, 1000); // initial pass after first render
  }

  // ── Extract: Property Details page ──────────────────────────────────────
  function extractPropertyDetails() {
    const data = {
      domain: 'rca',
      entity_type: 'property',
      _version: 1,
      _source: 'rca',
      page_url: location.href,
      contacts: [],
      tenants: [],
      sales_history: [],
    };

    // Property name + description
    const nameEl = document.querySelector('h1.property-name');
    if (nameEl) data.building_name = textOf(nameEl);

    // Address: h5.property-address has 2 spans (street, then city/state[/zip])
    const addrEl = document.querySelector('h5.property-address');
    if (addrEl) {
      const spans = addrEl.querySelectorAll(':scope > span');
      const street = spans[0] ? textOf(spans[0]) : '';
      const cityStateZip = spans[1] ? textOf(spans[1]) : '';
      data.address = street;
      // 'Victorville, CA 92394 USA' — parse city/state/zip
      const m = cityStateZip.match(/^([^,]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?\s*(USA?)?$/);
      if (m) {
        data.city = m[1].trim();
        data.state = m[2].trim();
        if (m[3]) data.zip = m[3].trim();
      } else {
        data.city = cityStateZip;
      }
    }

    // Property description block: '11,780 sf Suburban Office owned by Vana Medical LLC'
    const descEl = document.querySelector('.property-description');
    if (descEl) {
      const txt = textOf(descEl);
      const sfM = txt.match(/([\d,]+)\s*sf/i);
      if (sfM) data.square_footage = sfM[1] + ' SF';
    }

    // Property Characteristics — label/value pairs
    extractCharacteristics(data);

    // Tenants
    document.querySelectorAll('table.tenants tbody tr').forEach((tr) => {
      const nameTd = tr.querySelector('td.name');
      if (nameTd) {
        const name = textOf(nameTd);
        if (name && name.length > 1) data.tenants.push({ name });
      }
    });
    if (data.tenants[0] && !data.tenant_name) data.tenant_name = data.tenants[0].name;

    // Owners — capture the primary owner as a contact + as recorded_owner_name
    const ownerEl = document.querySelector('#owners .owner .name a, #owners .owner .name');
    if (ownerEl) {
      const ownerName = textOf(ownerEl);
      data.recorded_owner_name = ownerName;
      const ownerAddrEl = document.querySelector('#owners .owner .address');
      data.contacts.push({
        name: ownerName,
        role: 'owner',
        address: ownerAddrEl ? textOf(ownerAddrEl) : null,
      });
    }

    // Property History — sales, refinances, events
    extractPropertyHistory(data);

    // Financing — current loans
    extractFinancing(data);

    return data;
  }

  function extractCharacteristics(data) {
    // Each .row.row-no-gutters has a <label> and a <div><span>...</span></div>
    const rows = document.querySelectorAll('.PropertyCharacteristicsTable .row.row-no-gutters');
    rows.forEach((row) => {
      const labelEl = row.querySelector('label');
      const valueDiv = row.querySelector('div:not(label)');
      if (!labelEl || !valueDiv) return;
      const label = textOf(labelEl).toLowerCase().trim();
      const value = textOf(valueDiv).trim();
      if (!label || !value) return;
      mapCharacteristic(data, label, value);
    });

    // Round 76ai 2026-04-28: Derive a more semantic property_type by combining
    // RCA's separated property_type + features fields. RCA shows "Office" with
    // features="Medical" for medical office, but the LCC dashboard categorizes
    // properties as "Medical Office" — keep that intact when re-saving from RCA.
    const features = (data.features || '').toLowerCase();
    const baseType = (data.property_type || '').toLowerCase();
    const subtype  = (data.property_subtype || '').toLowerCase();
    if (/medical/.test(features) && (baseType === 'office' || subtype.includes('sub'))) {
      data.property_type = 'Medical Office';
    } else if (/dialysis|kidney|renal/.test(features)) {
      data.property_type = 'Medical Office';
    }
  }

  function mapCharacteristic(data, label, value) {
    // RCA uses lowercase labels like 'sf', 'year built', 'property type'.
    // Map them to our metadata schema (mostly aligned with CoStar's).
    const numStrip = (s) => s.replace(/[,]/g, '').match(/-?\d+(\.\d+)?/)?.[0] || s;
    if (label === 'sf')                 data.square_footage = value;
    else if (label === 'buildings')     data.buildings = numStrip(value);
    else if (label === 'floors')        data.floors = numStrip(value);
    else if (/^land area/.test(label))  data.lot_size = value;
    else if (label === 'metro')         data.metro = value;
    else if (label === 'submarket')     data.submarket = value;
    else if (label === 'county')        data.county = value;
    else if (label === 'msa')           data.msa = value;
    else if (label === 'property type') data.property_type = value;
    else if (label === 'property subtype') data.property_subtype = value;
    else if (label === 'features')      data.features = value;
    else if (label === 'year built')    data.year_built = numStrip(value);
    else if (/^year renov/.test(label)) data.year_renovated = numStrip(value);
    else if (/^occ as of|^occupancy/.test(label)) data.occupancy = value;
    else if (label === 'interest')      data.interest = value;
    else if (label === 'q score')       data.q_score = numStrip(value);
    else if (label === 'walk score')    data.walk_score = value;
    else if (label === 'transit score') data.transit_score = value;
    else if (label === 'apn')           data.parcel_number = value.split(/\s+/)[0]; // first APN
    else if (label === 'deed')          data.deed_book_page = value;
  }

  function extractPropertyHistory(data) {
    // Each tr.ellipsify in #transactions table is one event.
    const rows = document.querySelectorAll('#transactions tr.ellipsify');
    rows.forEach((tr) => {
      const txTd = tr.querySelector('td.transaction');
      const priceTd = tr.querySelector('td.transactionPrice');
      const entitiesTd = tr.querySelector('td.entities');
      const commentsTd = tr.querySelector('td.comments');
      if (!txTd) return;

      const txText = textOf(txTd);
      // 'Sale Feb '26 Office' or 'Refinance Mar '24 Office' etc.
      const txTypeM = txText.match(/^\s*(Sale|Refinance|Construction|Distress|Foreclosure|Auction)/i);
      const dateM = txText.match(/(\w+\s+'?\d{2,4})/);
      if (!txTypeM) return;

      const evt = {
        kind: txTypeM[1].toLowerCase(),
        date_label: dateM ? dateM[1] : null,
        sale_date: rcaParseAbbrevDate(dateM ? dateM[1] : null),
      };

      // Price block: '$5,362,000 approx $455 /sf'
      if (priceTd) {
        const priceText = textOf(priceTd);
        const priceM = priceText.match(/\$([\d,.]+(?:\s*[mk])?)/i);
        const psfM   = priceText.match(/\$([\d,.]+)\s*\/sf/i);
        if (priceM) evt.sale_price = '$' + priceM[1];
        if (psfM)   evt.price_per_sf = '$' + psfM[1];
        const capM = priceText.match(/(\d+(?:\.\d+)?)\s*%/);
        if (capM) evt.cap_rate = capM[1] + '%';
      }

      // Entities: buyer/seller/lender chain.
      // Round 76ai 2026-04-28: parse the structured fields. RCA renders the
      // entities cell as 'Buyer from Seller ↔ Lender ↔ Broker' with role
      // icons in front of each entity (B, S, F, L). textContent gives us the
      // concatenated names; split on the role keywords.
      if (entitiesTd) {
        const entitiesText = textOf(entitiesTd);
        evt.entities_text = entitiesText;

        // 'X from Y' splits buyer (left of 'from') from seller (right).
        // Lender follows after a separator (↔, with, ↣) when present.
        const fromMatch = entitiesText.match(/^(.+?)\s+from\s+(.+?)(?:\s+(?:↔|↣|with|by)\s+(.+))?$/i);
        if (fromMatch) {
          evt.buyer  = (fromMatch[1] || '').trim() || null;
          evt.seller = (fromMatch[2] || '').trim() || null;
          if (fromMatch[3]) evt.lender = fromMatch[3].trim();
        } else {
          // Refinance / standalone-mortgage: 'Borrower ↔ Lender' or 'Borrower with Lender'
          const refiMatch = entitiesText.match(/^(.+?)\s+(?:↔|↣|with|by)\s+(.+)$/);
          if (refiMatch) {
            evt.buyer  = (refiMatch[1] || '').trim() || null;
            evt.lender = (refiMatch[2] || '').trim() || null;
          }
        }

        // Also try anchor-text selectors when the role icons leave a usable
        // prefix in the DOM (RCA sometimes does data-role attrs).
        const anchors = entitiesTd.querySelectorAll('a, span[data-role]');
        anchors.forEach((a) => {
          const role = (a.getAttribute('data-role') || a.className || '').toLowerCase();
          const txt = textOf(a);
          if (!txt) return;
          if (/owner|buyer/.test(role) && !evt.buyer)  evt.buyer  = txt;
          if (/seller/.test(role)      && !evt.seller) evt.seller = txt;
          if (/lender|fund/.test(role) && !evt.lender) evt.lender = txt;
          if (/broker/.test(role)      && !evt.broker) evt.broker = txt;
        });
      }

      // Comments: narrative
      if (commentsTd) {
        evt.comments = textOf(commentsTd);
      }

      data.sales_history.push(evt);
    });
  }

  // Convert RCA's abbreviated 'Feb '26' / 'May 16' style to ISO YYYY-MM-01.
  // Server-side upsertDomainSales calls parseDate which accepts YYYY-MM-DD.
  function rcaParseAbbrevDate(label) {
    if (!label) return null;
    const m = String(label).trim().match(/^([A-Za-z]+)\s+'?(\d{2,4})$/);
    if (!m) return null;
    const monthNames = {
      jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
      jul:'07', aug:'08', sep:'09', sept:'09', oct:'10', nov:'11', dec:'12',
    };
    const mo = monthNames[m[1].toLowerCase().slice(0,3)] || monthNames[m[1].toLowerCase()];
    if (!mo) return null;
    let yr = m[2];
    if (yr.length === 2) {
      const n = parseInt(yr, 10);
      // 2-digit years: 00-69 -> 2000-2069, 70-99 -> 1970-1999
      yr = (n <= 69 ? '20' : '19') + yr.padStart(2, '0');
    }
    return `${yr}-${mo}-01`;
  }

  function extractFinancing(data) {
    document.querySelectorAll('.financing').forEach((finEl, idx) => {
      const summaryEl = finEl.querySelector('.summary');
      const summary = summaryEl ? textOf(summaryEl) : '';
      const loan = { summary };

      // Each property-detail-metric pair
      finEl.querySelectorAll('property-detail-metric .metric').forEach((row) => {
        const label = textOf(row.querySelector('label') || row).replace(/:$/, '').trim().toLowerCase();
        const valueEl = row.querySelector('.col-sm-7 span') || row.querySelector('.col-sm-7');
        const value = valueEl ? textOf(valueEl) : '';
        if (!label || !value) return;
        loan[label.replace(/\s+/g, '_')] = value;
      });

      if (loan.summary || Object.keys(loan).length > 1) {
        data.loans = data.loans || [];
        data.loans.push(loan);
      }
    });
  }

  // ── Extract: Investor Profile (lighter pass, mostly metadata) ───────────
  function extractInvestorProfile() {
    const data = {
      domain: 'rca',
      entity_type: 'organization',
      _version: 1,
      _source: 'rca',
      page_url: location.href,
      contacts: [],
    };
    const nameEl = document.querySelector('.col-md-3 h1, .investor-name, h1');
    if (nameEl) data.name = textOf(nameEl);

    // Investor highlights bullets
    const bullets = [];
    document.querySelectorAll('.Investor-Highlights ul li, .investor-highlights li').forEach((li) => {
      const t = textOf(li);
      if (t) bullets.push(t);
    });
    if (bullets.length) data.investor_highlights = bullets.join(' | ');

    // CEO/Principal, Investor Group, Address — typically rendered as label/value rows
    document.querySelectorAll('.investor-info-row, .row').forEach((row) => {
      const label = textOf(row.querySelector('label, .label')).toLowerCase();
      const val   = textOf(row.querySelector('.value, span'));
      if (!label || !val) return;
      if (/^ceo|principal/i.test(label)) data.ceo_principal = val;
      else if (/^investor group/i.test(label)) data.investor_group = val;
      else if (/^address/i.test(label))   data.address = val;
    });

    return data;
  }

  // ── Driver ──────────────────────────────────────────────────────────────
  function extract() {
    if (!/(^|\.)rcanalytics\.com$/.test(location.hostname)) return;

    let data = null;
    if (isRcaPropertyDetail())     data = extractPropertyDetails();
    else if (isRcaInvestorProfile()) data = extractInvestorProfile();
    else return;

    if (!data || (!data.address && !data.name)) return;

    // Dedupe sends — only emit when the URL or a key field changed.
    const sig = JSON.stringify({
      url: location.href,
      key: data.address || data.name,
      sf: data.square_footage,
      sales: data.sales_history?.length,
    });
    if (sig === lastSentSig) return;
    lastSentSig = sig;

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data,
    });
    console.log('[lcc-rca] sent CONTEXT_DETECTED for', data.address || data.name);
  }

  function textOf(el) {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // SPA route detection — patch pushState/replaceState to re-run extraction.
  const origPush = history.pushState;
  history.pushState = function (...args) {
    origPush.apply(this, args);
    setTimeout(extract, 800);
  };
  window.addEventListener('popstate', () => setTimeout(extract, 800));

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
  } else {
    window.addEventListener('DOMContentLoaded', start);
  }
})();
