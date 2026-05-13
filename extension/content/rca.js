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
    // Round 76ct 2026-04-28: extend to capture sf + lease_expiration columns.
    // RCA's tenant table renders 3 columns: name | sf | expiration.
    document.querySelectorAll('table.tenants tbody tr').forEach((tr) => {
      const nameTd = tr.querySelector('td.name');
      const sfTd   = tr.querySelector('td.sf');
      const expTd  = tr.querySelector('td.expiration');
      if (nameTd) {
        const name = textOf(nameTd);
        if (name && name.length > 1) {
          const tenant = { name };
          if (sfTd)  tenant.sf = textOf(sfTd);
          if (expTd) tenant.lease_expiration = textOf(expTd);
          data.tenants.push(tenant);
        }
      }
    });
    // Promote first tenant's name + expiration to top-level so writers that
    // expect scalar tenant_name / lease_expiration find them.
    if (data.tenants[0]) {
      if (!data.tenant_name) data.tenant_name = data.tenants[0].name;
      if (!data.lease_expiration && data.tenants[0].lease_expiration) {
        data.lease_expiration = data.tenants[0].lease_expiration;
      }
    }

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
    // Round 76ep (2026-05-09): broaden the row selector AND make label
    // matching tolerant of trailing colons / punctuation. The original
    // selector + exact label matching was missing fields like Floors,
    // Parking, Metro, Submarket, MSA, Q Score, Walk Score, Transit Score,
    // Interest, Property Type, Deed (FBI HQ Chelsea capture had `deed`
    // null in metadata even though the page clearly shows two deed
    // numbers). Multi-selector + label.replace(/:$/) catches both.
    const rowSet = new Set();
    [
      '.PropertyCharacteristicsTable .row.row-no-gutters',
      '.property-characteristics .row',
      '.property-characteristics-table .row',
      '[data-section="characteristics"] .row',
      '[data-section="property-characteristics"] .row',
      '#property-characteristics .row',
    ].forEach(sel => {
      document.querySelectorAll(sel).forEach(row => rowSet.add(row));
    });
    const rows = [...rowSet];

    const seenLabels = [];
    rows.forEach((row) => {
      const labelEl = row.querySelector('label');
      const valueDiv = row.querySelector('div:not(label)');
      if (!labelEl || !valueDiv) return;
      // Strip trailing colon, normalize whitespace, lowercase. RCA emits
      // 'Property Type:', 'Q Score:', etc. with the colon as part of the
      // <label> text on some pages.
      const label = textOf(labelEl)
        .toLowerCase()
        .replace(/[:?]+\s*$/, '')
        .trim();
      const value = textOf(valueDiv).trim();
      if (!label || !value) return;
      seenLabels.push(label);
      mapCharacteristic(data, label, value);
    });

    // Diagnostic: which labels did we walk? Reveals (in DevTools) labels
    // RCA uses that mapCharacteristic doesn't yet handle — useful when
    // the user reports "Q Score not captured" etc.
    console.log('[lcc-rca] Round 76ep: extractCharacteristics scanned',
      rows.length, 'rows; labels seen:', seenLabels);

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
    else if (label === 'deed') {
      data.deed_book_page = value;
      // Round 76em (2026-05-09): structure deed text into individual records
      // so the existing upsert*DeedRecords writers in sidebar-pipeline.js can
      // pick them up. RCA emits multiple deeds as a single string, e.g.
      // "072584000221 18195 072584000213 18192" for property 201 Maple St —
      // four tokens that pair off as (document_number, book_page) per deed.
      // Each token group maps to one historical event (a Sale or Construction).
      // We DON'T try to correlate-by-date here (events render in a separate
      // table) — just emit the structured records so the backend matcher can
      // align them to sales_history entries by index or by trying.
      const tokens = value.split(/[\s,;]+/).filter(t => t && /\d/.test(t));
      const deedRecords = [];
      for (let i = 0; i < tokens.length; i += 2) {
        const docNum = tokens[i];
        const bookPage = tokens[i + 1] || null;
        if (docNum && /^\d{6,}$/.test(docNum)) {
          deedRecords.push({
            document_number: docNum,
            book_page:       bookPage,
            data_source:     'rca_sidebar',
          });
        }
      }
      if (deedRecords.length > 0) {
        data.deed_records = deedRecords;
      }
    }
  }

  function extractPropertyHistory(data) {
    // Round 76en (2026-05-09): broaden the row selector. The original
    // 'tr.ellipsify' was missing Construction events on the FBI HQ Chelsea
    // capture (RCA renders different event types with different CSS
    // classes — Sale rows had .ellipsify, Construction rows had a
    // different/no class). Now: try multiple selectors and merge unique
    // rows, then filter inside the loop for rows that actually carry a
    // td.transaction cell.
    const rowSet = new Set();
    [
      '#transactions tr.ellipsify',
      '#transactions tbody tr',
      '#transactions tr',
      'table.transactions tbody tr',
      '[data-section="transactions"] tr',
    ].forEach(sel => {
      document.querySelectorAll(sel).forEach(tr => rowSet.add(tr));
    });
    const rows = [...rowSet];

    // Diagnostic: surfaces what the selector found so users can DevTools
    // their way to a fix when the sidebar doesn't match the page. Logged
    // once per extract call.
    console.log('[lcc-rca] Round 76en: extractPropertyHistory found',
      rows.length, 'candidate rows');

    rows.forEach((tr) => {
      const txTd = tr.querySelector('td.transaction');
      const priceTd = tr.querySelector('td.transactionPrice');
      const entitiesTd = tr.querySelector('td.entities');
      const commentsTd = tr.querySelector('td.comments');
      if (!txTd) return;

      const txText = textOf(txTd);
      // 'Sale Feb '26 Office' or 'Refinance Mar '24 Office' etc.
      const txTypeM = txText.match(/^\s*(Sale|Refinance|Construction|Distress|Foreclosure|Auction|Land\s+Sale|Land\s+Acquisition|Acquisition)/i);
      const dateM = txText.match(/(\w+\s+'?\d{2,4})/);
      if (!txTypeM) return;

      const evt = {
        kind: txTypeM[1].toLowerCase().replace(/\s+/g, '_'),
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
        // Lender follows after a separator (↔, with, ↣) when present, OR can
        // appear inline as 'Bank Name ($X.Xm approx)' trailing the seller —
        // RCA renders it without a separator when the lender icon is shown
        // adjacent to the seller. Round 76aj 2026-04-28: detect that pattern
        // and split it out before storing the seller field.
        const fromMatch = entitiesText.match(/^(.+?)\s+from\s+(.+?)(?:\s+(?:↔|↣|with|by)\s+(.+))?$/i);
        if (fromMatch) {
          evt.buyer  = (fromMatch[1] || '').trim() || null;
          let sellerRaw = (fromMatch[2] || '').trim();
          let lenderRaw = (fromMatch[3] || '').trim();

          // Strip a trailing lender chunk from the seller text. Pattern:
          //   '...Trust 2016 First Citizens ($3.4m approx)'
          // Round 76em: use entity-suffix-anchored splitter (Group/LLC/Corp/
          // Trust/Holdings/...) so seller "ACS Dev corp JV Molasky Group"
          // doesn't get truncated to "ACS" with the rest leaked into lender.
          const split = splitSellerAndLenderFromTail(sellerRaw);
          if (split) {
            sellerRaw = split.seller;
            if (!lenderRaw) lenderRaw = split.lender;
          }

          evt.seller = sellerRaw || null;
          if (lenderRaw) evt.lender = lenderRaw;
        } else {
          // Refinance / standalone-mortgage: 'Borrower ↔ Lender' or 'Borrower with Lender'
          const refiMatch = entitiesText.match(/^(.+?)\s+(?:↔|↣|with|by)\s+(.+)$/);
          if (refiMatch) {
            evt.buyer  = (refiMatch[1] || '').trim() || null;
            evt.lender = (refiMatch[2] || '').trim() || null;
          } else if (evt.kind === 'refinance') {
            // Round 76ep (2026-05-09): Refinance events on RCA frequently
            // render as 'BORROWER LENDER ($Xm approx) [; SECONDARY-LENDER
            // ($Ym approx)]' with no '↔' / 'with' / 'by' separator. The
            // refiMatch + fromMatch paths above both fail; result is a
            // sales_history entry with no buyer/seller/lender at all.
            // Concrete example (US FAA, 159-02 Rockaway Blvd Queens):
            // 'EJME Citigroup ($30.0m approx) ; Citigroup ($20.0m approx)'.
            //
            // Strategy: split on ';' for multi-lender (pari-passu / 2nd
            // mortgage). For each part, match '<text> <lender> ($amt)' where
            // the lender is 1-3 capitalized tokens immediately before the
            // dollar parenthetical. The first part's prefix is the borrower;
            // subsequent parts are additional lenders.
            const refiParts = entitiesText.split(/\s*;\s*/);
            const refiParsed = refiParts
              .map((p, i) => parseRcaRefiPart(p.trim(), i === 0))
              .filter(Boolean);
            if (refiParsed.length > 0) {
              const primary = refiParsed[0];
              if (primary.borrower) evt.buyer = primary.borrower;
              if (primary.lender)   evt.lender = primary.lender;
              if (primary.loan_amount) evt.loan_amount = primary.loan_amount;
              if (refiParsed.length > 1) {
                evt.additional_lenders = refiParsed.slice(1).map(p => ({
                  lender:      p.lender,
                  loan_amount: p.loan_amount,
                }));
              }
            }
          } else if (evt.kind === 'construction') {
            // Round 76em (2026-05-09): Construction events on RCA show the
            // developer as the sole entity, optionally followed by a
            // construction lender in '$X.Xm approx' tail form. Example
            // (FBI HQ Chelsea, 201 Maple St): 'ACS Dev corp JV Molasky Group
            // TIAA-CREF ($130.8m approx)'. The fromMatch + refiMatch paths
            // above both fail because there's no 'from' or '↔' separator —
            // result: developer + construction loan both dropped silently.
            const cSplit = splitSellerAndLenderFromTail(entitiesText);
            if (cSplit) {
              evt.developer = cSplit.seller;
              evt.lender    = cSplit.lender;
            } else {
              // No trailing $ amount or no entity-suffix split — the whole
              // text is the developer.
              evt.developer = entitiesText.trim() || null;
            }
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

        // Round 76em (2026-05-09): extract the loan amount from the lender
        // string. RCA formats it inline as 'Old National Bank ($94.2m approx)'
        // — without a separate column for the dollar value. upsertDomainLoans
        // needs sale.loan_amount to be set or it skips the row entirely
        // (line ~4990 in sidebar-pipeline.js), so without this extraction
        // every RCA capture has its loan amount silently dropped.
        //
        // CRITICAL: emit the EXPANDED number, not the "$Xm" shorthand.
        // Backend parseCurrency (api/_handlers/sidebar-pipeline.js:427)
        // strips $/, but doesn't handle the m/k/b suffix — so "$94.2m"
        // would parse as 94.2 dollars, not 94,200,000. Pass the raw
        // number; parseCurrency handles numeric input cleanly via its
        // typeof===number short-circuit.
        if (evt.lender) {
          const amtMatch = evt.lender.match(/\$\s*([\d,.]+)\s*([mkb]?)\s*(?:approx)?/i);
          if (amtMatch) {
            const num = parseFloat(amtMatch[1].replace(/,/g, ''));
            const unit = (amtMatch[2] || '').toLowerCase();
            let dollars = num;
            if (unit === 'm') dollars *= 1e6;
            else if (unit === 'k') dollars *= 1e3;
            else if (unit === 'b') dollars *= 1e9;
            if (Number.isFinite(dollars) && dollars > 0) {
              // Round 76eo (2026-05-09): integer round for currency. JS
              // floating-point makes 130.8 * 1e6 = 130800000.00000001
              // which rendered ugly in the sidebar. Cents don't matter at
              // multi-million-dollar scale, so coerce to nearest dollar.
              evt.loan_amount = Math.round(dollars);
            }
            // Strip trailing parenthetical so lender name is clean
            evt.lender = evt.lender.replace(/\s*\(\s*\$[\d,.]+\s*[mkb]?\s*(?:approx)?\s*\)\s*$/i, '').trim();
          }
        }
      }

      // Comments: narrative
      if (commentsTd) {
        evt.comments = textOf(commentsTd);
      }

      // Round 76ct: CMBS deal-name detection. Loans securitized into a CMBS
      // trust appear in RCA's entities/comments cell as the trust name, e.g.
      // 'CFCRE 2016-C6 ($4.0m)' or 'GSMS 2014-GC22'. Pattern: 2-6 capital
      // letters + space + 4-digit year + dash + alphanumeric tranche tag.
      // Captured into evt.cmbs_deal_name so downstream writers can trigger
      // enrichment against the dia.cmbs_loans table.
      const cmbsBlob = `${evt.lender || ''} ${evt.entities_text || ''} ${evt.comments || ''}`;
      const cmbsMatch = cmbsBlob.match(/\b([A-Z]{2,6})\s+(20\d{2})-([A-Z0-9]{1,8})\b/);
      if (cmbsMatch) {
        evt.cmbs_deal_name = `${cmbsMatch[1]} ${cmbsMatch[2]}-${cmbsMatch[3]}`;
        evt.cmbs_sponsor   = cmbsMatch[1];
        evt.cmbs_vintage   = parseInt(cmbsMatch[2], 10);
        evt.cmbs_tranche   = cmbsMatch[3];
      }

      data.sales_history.push(evt);
    });

    // Round 76en (2026-05-09): diagnostic — what the parser actually
    // captured. If the user reports "Construction event missing" this
    // log line tells us whether the parser saw it or not.
    console.log('[lcc-rca] Round 76en: extractPropertyHistory captured',
      data.sales_history.length, 'events:',
      data.sales_history.map(e => ({
        kind:        e.kind,
        date:        e.sale_date,
        buyer:       e.buyer || null,
        seller:      e.seller || null,
        developer:   e.developer || null,
        lender:      e.lender || null,
        loan_amount: e.loan_amount || null,
      }))
    );
  }

  // Round 76em (2026-05-09): split a "<seller-or-developer> <lender> ($Xm approx)"
  // string into its two entity halves. The previous lazy-quantifier regex
  // (^(.+?)\s+([A-Z][A-Za-z0-9 &'\-]+?)\s*\(\s*\$[\d.,]+...) split on the
  // FIRST capitalized token, so "ACS Dev corp JV Molasky Group Old National
  // Bank ($94.2m approx)" became seller="ACS" / lender="Dev corp JV Molasky
  // Group Old National Bank". Heuristic that actually works on RCA's data:
  // walk the string and find the LAST entity-suffix word (Group/LLC/Corp/
  // Trust/Holdings/etc.) — that marks the end of the seller name. Everything
  // after = lender. Works for FBI HQ Chelsea (Group → Old National Bank) and
  // construction equivalent (Group → TIAA-CREF).
  function splitSellerAndLenderFromTail(text) {
    if (!text) return null;
    const parenMatch = text.match(/\s*\(\s*\$[\d.,]+\s*[mkb]?\s*(?:approx)?\s*\)\s*$/i);
    if (!parenMatch) return null;
    const parenSuffix = parenMatch[0];
    const noParens = text.slice(0, parenMatch.index).trim();
    const ENTITY_SUFFIX_RE =
      /\b(Group|LLC|L\.L\.C\.?|LP|L\.P\.?|LLP|Corp|Corporation|Inc|Incorporated|Trust|Fund|Capital|Partners|Realty|REIT|Holdings?|Bancorp|Company|Companies|Co\.?|Ventures|Properties|Investments?|Acquisitions?|Management|JV|Equities|Equity|Associates)\b/g;
    let lastMatch = null;
    let m;
    while ((m = ENTITY_SUFFIX_RE.exec(noParens)) !== null) {
      lastMatch = { idx: m.index, len: m[0].length };
    }
    if (!lastMatch) return null;
    const splitPos = lastMatch.idx + lastMatch.len;
    const seller = noParens.slice(0, splitPos).trim();
    const lenderName = noParens.slice(splitPos).trim();
    // Lender must have at least one capitalized name token after the
    // suffix; otherwise the split was bogus (entity-suffix at end of string).
    if (!seller || !lenderName || !/[A-Z]/.test(lenderName)) return null;
    return {
      seller,
      lender: `${lenderName} ${parenSuffix}`.replace(/\s+/g, ' ').trim(),
    };
  }

  // Round 76ep (2026-05-09): parse a single Refinance entity-text part.
  // RCA renders multi-lender refinances as ';'-separated chunks like:
  //   'EJME Citigroup ($30.0m approx)' (first chunk: borrower + lender + amt)
  //   'Citigroup ($20.0m approx)'      (later chunks: lender + amt only)
  // Returns { borrower?, lender, loan_amount } when the chunk has a
  // dollar parenthetical, else null. Lender is 1-3 capitalized tokens.
  function parseRcaRefiPart(part, isFirst) {
    if (!part) return null;
    // Try with prefix: '<borrower-text> <lender> ($amt)'
    const withPrefix = part.match(
      /^(.+?)\s+([A-Z][A-Za-z0-9'\-&]+(?:\s+[A-Z][A-Za-z0-9'\-&]+){0,2})\s*\(\s*\$([\d,.]+)\s*([mkb]?)\s*(?:approx)?\s*\)\s*$/
    );
    if (withPrefix) {
      return {
        borrower:    withPrefix[1].trim() || null,
        lender:      withPrefix[2].trim(),
        loan_amount: rcaParseDollars(withPrefix[3], withPrefix[4]),
      };
    }
    // Try without prefix: '<lender> ($amt)' — used by secondary chunks.
    const noPrefix = part.match(
      /^([A-Z][A-Za-z0-9'\-&]+(?:\s+[A-Z][A-Za-z0-9'\-&]+){0,2})\s*\(\s*\$([\d,.]+)\s*([mkb]?)\s*(?:approx)?\s*\)\s*$/
    );
    if (noPrefix) {
      return {
        borrower:    null,
        lender:      noPrefix[1].trim(),
        loan_amount: rcaParseDollars(noPrefix[2], noPrefix[3]),
      };
    }
    return null;
  }

  // Helper used by parseRcaRefiPart and the inline lender-amt extractor.
  // Returns an integer-rounded dollar amount.
  function rcaParseDollars(numStr, unit) {
    const n = parseFloat(String(numStr || '').replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const u = (unit || '').toLowerCase();
    let dollars = n;
    if (u === 'm') dollars *= 1e6;
    else if (u === 'k') dollars *= 1e3;
    else if (u === 'b') dollars *= 1e9;
    return Math.round(dollars);
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
    // Round 76ep (2026-05-09): broaden the financing-block selector. The
    // user-reported 159-02 Rockaway Blvd capture had data.loans=null
    // even though the page clearly shows '$30.0 m 1st Mortgage with
    // Citigroup' under a 'Financing' header — apparently RCA's CSS class
    // name has evolved past the bare '.financing'. Try multiple selectors
    // and merge unique nodes. Same diagnostic log pattern as the history
    // extractor so DevTools reveals what was found.
    const finSet = new Set();
    [
      '.financing',
      '.financing-block',
      '.financing-detail',
      '.loan-detail',
      '.loan-summary',
      '[data-section="financing"]',
      '[data-section="loans"]',
      '#financing > div',
      'section.financing > div',
    ].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => finSet.add(el));
    });
    const finEls = [...finSet];

    finEls.forEach((finEl) => {
      const summaryEl = finEl.querySelector('.summary, h3, h4, .loan-summary, [class*="summary"]');
      const summary = summaryEl ? textOf(summaryEl) : textOf(finEl).split('\n')[0];
      const loan = { summary };

      // Round 76eu (2026-05-13): positional text-walker. The Round 76et
      // line-based parser failed because textOf() collapses ALL whitespace
      // (including newlines) to single spaces via .replace(/\s+/g, ' '),
      // so the entire financing block arrived as ONE line — the regex
      // ^Label:\s*(.+)$ matched the FIRST label and consumed everything
      // else as its value (loan.loan_status held the entire concatenated
      // string). Switch to a positional approach: find every known-label
      // position in the flat text and slice each value from end-of-colon
      // to start-of-next-label (or end of text).
      const KNOWN_LABELS = [
        'Loan Status', 'Loan Type', 'Loan Amount', 'Interest Rate',
        'Debt Yield', 'Total Reserves', 'Term', 'Deal Appraisal',
        'Originator', 'Lender Name', 'Lender Group', 'Special Servicer',
        'Mortgage Broker', 'Original LTV', 'Loan DSCR', 'Loan dscr',
        'Amortization Type', 'Origination', 'Defeasance Date',
        'Prepayment Date', 'Original Maturity', 'Extension Maturity',
      ];
      const labelToKey = (lbl) =>
        lbl.toLowerCase().replace(/[:?]+$/, '').trim().replace(/\s+/g, '_');
      const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const seenLabels = [];
      const rawText = textOf(finEl);

      // Sort labels longest-first so "Loan Amount" matches before "Loan",
      // "Original Maturity" before "Original LTV", etc. Combine into one
      // alternation regex; lead-in is start-or-whitespace + the label +
      // optional whitespace + colon + optional whitespace.
      const sortedLabels = [...KNOWN_LABELS].sort((a, b) => b.length - a.length);
      const labelUnion = sortedLabels.map(escapeRe).join('|');
      const labelRe = new RegExp('(?:^|\\s)(' + labelUnion + ')\\s*:\\s*', 'gi');

      const hits = [];
      let _m;
      while ((_m = labelRe.exec(rawText)) !== null) {
        // labelStart points at the label word itself (skip the lead-in
        // whitespace if any). valueStart is just past ": ".
        const leadWs = _m[0].length - _m[0].trimStart().length;
        hits.push({
          label:      _m[1],
          labelStart: _m.index + leadWs,
          valueStart: _m.index + _m[0].length,
        });
      }
      for (let i = 0; i < hits.length; i++) {
        const valueEnd = (i + 1 < hits.length)
          ? hits[i + 1].labelStart
          : rawText.length;
        const value = rawText.slice(hits[i].valueStart, valueEnd).trim();
        if (!value) continue;
        const key = labelToKey(hits[i].label);
        if (loan[key] === undefined) {
          loan[key] = value;
          seenLabels.push(key);
        }
      }

      // Fallback: structural .row + label/div walker if positional walker
      // returned nothing (e.g. RCA flipped to a structural layout).
      if (seenLabels.length === 0) {
        const rowSet = new Set();
        ['.row.row-no-gutters', '.row', '[class*="row-no-gutters"]'].forEach(sel => {
          finEl.querySelectorAll(sel).forEach(r => rowSet.add(r));
        });
        [...rowSet].forEach((row) => {
          const labelEl = row.querySelector('label');
          const valueDiv = row.querySelector('div:not(label)');
          if (!labelEl || !valueDiv) return;
          const label = textOf(labelEl).replace(/[:?]+\s*$/, '').trim().toLowerCase();
          const value = textOf(valueDiv).trim();
          if (!label || !value) return;
          const key = label.replace(/\s+/g, '_');
          if (loan[key] === undefined) {
            loan[key] = value;
            seenLabels.push(key);
          }
        });
      }

      console.log('[lcc-rca] Round 76eu: extractFinancing parsed',
        seenLabels.length, 'label/value pair(s):', seenLabels);

      if (loan.summary || Object.keys(loan).length > 1) {
        // Round 76er.b (2026-05-13): normalize the label/value strings into
        // typed fields the backend writer can consume directly. The Financing
        // section emits values like "$1.6 m (approx)", "3.3%", "84 Months",
        // "04/30/2021"; without normalization the backend's parseCurrency /
        // parsePercent helpers would mis-parse them ("$1.6 m" → 1.6) or
        // silently drop them. Emit alongside the raw label-value pairs so
        // downstream consumers can still see the original text.
        const normalized = {};
        // Loan amount: "$1.6 m (approx)" → 1600000
        const amtMatch = String(loan.loan_amount || '').match(
          /\$?\s*([\d.,]+)\s*([mkb])?/i
        );
        if (amtMatch) {
          normalized.loan_amount_dollars =
            rcaParseDollars(amtMatch[1], amtMatch[2]);
        }
        // Interest rate: "3.3%" → 3.3 (or "3.3% null" → 3.3)
        const rateMatch = String(loan.interest_rate || '').match(/([\d.]+)\s*%/);
        if (rateMatch) {
          normalized.interest_rate_pct = parseFloat(rateMatch[1]);
        }
        // LTV: "61.9%" → 61.9
        const ltvMatch = String(loan.original_ltv || '').match(/([\d.]+)\s*%/);
        if (ltvMatch) normalized.ltv_pct = parseFloat(ltvMatch[1]);
        // Debt yield: "10.0%" → 10.0
        const dyMatch = String(loan.debt_yield || '').match(/([\d.]+)\s*%/);
        if (dyMatch) normalized.debt_yield_pct = parseFloat(dyMatch[1]);
        // Term: "84 Months" → 84 months, 7 years
        const termMatch = String(loan.term || '').match(/([\d.]+)\s*(month|mo|year|yr)/i);
        if (termMatch) {
          const n = parseFloat(termMatch[1]);
          const isYears = /year|yr/i.test(termMatch[2]);
          normalized.term_months = isYears ? Math.round(n * 12) : Math.round(n);
          normalized.term_years  = isYears ? n : Math.round(n / 12 * 100) / 100;
        }
        // Total Reserves: "$394,730" → 394730
        const resMatch = String(loan.total_reserves || '').match(
          /\$?\s*([\d.,]+)\s*([mkb])?/i
        );
        if (resMatch) {
          normalized.total_reserves_dollars =
            rcaParseDollars(resMatch[1], resMatch[2]);
        }
        // Deal Appraisal: "$48,500,000" → 48500000
        const apprMatch = String(loan.deal_appraisal || '').match(
          /\$?\s*([\d.,]+)\s*([mkb])?/i
        );
        if (apprMatch) {
          normalized.origination_appraisal_dollars =
            rcaParseDollars(apprMatch[1], apprMatch[2]);
        }
        // Dates: "04/30/2021" → "2021-04-30"
        const toIso = (s) => {
          if (!s) return null;
          const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
          if (!m) return null;
          let y = m[3];
          if (y.length === 2) {
            const n = parseInt(y, 10);
            y = (n <= 69 ? '20' : '19') + y.padStart(2, '0');
          }
          return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
        };
        const origDate = toIso(loan.origination);
        if (origDate) normalized.origination_date_iso = origDate;
        const matDate = toIso(loan.original_maturity);
        if (matDate) normalized.maturity_date_iso = matDate;
        const defDate = toIso(loan.defeasance_date);
        if (defDate) normalized.defeasance_date_iso = defDate;
        const prepayDate = toIso(loan.prepayment_date);
        if (prepayDate) normalized.prepayment_date_iso = prepayDate;
        // CMBS flag: "CMBS" group implies is_cmbs=true
        if (loan.lender_group && /\bcmbs\b/i.test(loan.lender_group)) {
          normalized.is_cmbs = true;
        }
        Object.assign(loan, normalized);

        data.loans = data.loans || [];
        data.loans.push(loan);
      }
    });

    console.log('[lcc-rca] Round 76ep: extractFinancing found',
      finEls.length, 'financing block(s); captured',
      (data.loans || []).length, 'loan(s).');
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
