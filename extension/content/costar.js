// ============================================================================
// LCC Assistant — Content Script: CoStar
// Extracts property data from sale comp / property detail pages.
// Uses page-text scanning (innerText) because CoStar's React DOM is too
// deeply nested for reliable sibling/parent traversal.
// ============================================================================

(function () {
  'use strict';

  let lastDetectedId = null;
  let extractionTimer = null;

  const observer = new MutationObserver(() => {
    // Debounce: wait 1s after last DOM mutation for page to settle
    clearTimeout(extractionTimer);
    extractionTimer = setTimeout(extract, 1000);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Also run once after initial load in case observer misses the final render
  setTimeout(extract, 2500);

  // ── Main extraction ───────────────────────────────────────────────────

  function extract() {
    const url = window.location.href;

    // Step 1: Find address from h1 element (lightweight DOM check)
    const h1 = document.querySelector('h1');
    const rawTitle = h1?.textContent?.trim() || '';
    let address = parseAddress(rawTitle);

    // Fallback: scan visible text for first street-address-like line
    let lines = null;
    if (!address) {
      lines = getPageLines();
      address = findAddressInLines(lines);
    }

    if (!address) return;

    // De-duplicate: don't re-extract the same page
    const pageId = address + '|' + url;
    if (pageId === lastDetectedId) return;
    lastDetectedId = pageId;

    // Step 2: Full text extraction (only runs once per page)
    if (!lines) lines = getPageLines();
    const data = extractFields(lines);
    const location = findLocationInLines(lines);

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'costar',
        entity_type: 'property',
        address,
        page_url: url,
        city: location.city,
        state: location.state,
        ...data,
      },
    });

    if (h1) injectLccButton(h1);
  }

  // ── Page text helpers ─────────────────────────────────────────────────

  function getPageLines() {
    return document.body.innerText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  function parseAddress(raw) {
    if (!raw || raw.length < 3) return null;
    // "586 Rice St - Fresenius Medical Care" → "586 Rice St"
    let addr = raw.split(/\s+[-–—]\s+/)[0].trim();
    if (/^\d+\s/.test(addr) ||
      /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|pl|place|way|hwy|highway|pkwy|parkway|pike|cir|circle|loop|terr|trail)\b/i.test(addr)) {
      return addr;
    }
    if (raw.length < 100) return raw;
    return null;
  }

  function findAddressInLines(lines) {
    for (const line of lines) {
      if (line.length > 120 || line.length < 5) continue;
      if (/^\d+\s+\w+/.test(line) &&
        /\b(st|street|ave|avenue|blvd|dr|drive|rd|road|ln|lane|ct|way|hwy|pkwy)\b/i.test(line)) {
        return line.split(/\s+[-–—]\s+/)[0].trim();
      }
    }
    return null;
  }

  function findLocationInLines(lines) {
    for (const line of lines) {
      // Match "Saint Paul, MN 55103" or "Dallas, TX"
      const m = line.match(/^([A-Za-z][A-Za-z\s.]{1,35}),\s*([A-Z]{2})\s*(\d{5})?/);
      if (m) return { city: m[1].trim(), state: m[2] };
    }
    return { city: null, state: null };
  }

  // ── Field extraction from page text lines ─────────────────────────────
  //
  // CoStar uses two main patterns visible in innerText:
  //   Stat cards:        "6.76%"  then  "Cap Rate"   (value ABOVE label)
  //   Detail sections:   "Sale Date"  then  "Mar 27, 2026"  (label ABOVE value)
  //   Tab-separated:     "Improvements\t$2,839,200\t$324.48/SF"
  //
  // We scan all lines and match labels, then look prev/next for the value.

  function extractFields(lines) {
    const data = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = i > 0 ? lines[i - 1] : '';
      const next = i < lines.length - 1 ? lines[i + 1] : '';

      // ── Cap Rate ──────────────────────────────────────────────
      if (!data.cap_rate) {
        if (/^(actual\s+)?cap\s+rate$/i.test(line)) {
          if (/[\d.]+%/.test(prev)) data.cap_rate = prev;
          else if (/[\d.]+%/.test(next)) data.cap_rate = next;
          // Handle blank line between label and value
          else if (i < lines.length - 2 && /[\d.]+%/.test(lines[i + 2])) data.cap_rate = lines[i + 2];
        }
      }

      // ── Sale Date ─────────────────────────────────────────────
      if (!data.sale_date) {
        if (/^sale\s+date$/i.test(line)) {
          if (/[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}/.test(prev)) data.sale_date = prev;
          else if (/[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}/.test(next)) data.sale_date = next;
        }
      }

      // ── Asking Price ──────────────────────────────────────────
      if (!data.asking_price) {
        if (/^asking\s+price$/i.test(line)) {
          if (/^\$[\d,]+/.test(next)) data.asking_price = next;
          else if (/^\$[\d,]+/.test(prev)) data.asking_price = prev;
        }
      }

      // ── Sale Price ────────────────────────────────────────────
      if (!data.sale_price) {
        if (/^sale\s+price$/i.test(line)) {
          if (next && next.length < 60) data.sale_price = next;
        }
      }

      // ── Square Footage (stat card: "8,750" above "SF RBA") ───
      if (!data.square_footage) {
        if (/^sf\s+rba$/i.test(line)) {
          if (/^[\d,]+$/.test(prev)) data.square_footage = prev + ' SF';
        }
        // Detail section: "RBA" above "8,750 SF"
        if (/^rba$/i.test(line)) {
          if (/^[\d,]+\s*sf/i.test(next)) data.square_footage = next;
        }
      }

      // ── Year Built ────────────────────────────────────────────
      if (!data.year_built) {
        if (/^(year\s+)?built$/i.test(line)) {
          if (/^\d{4}$/.test(prev)) data.year_built = prev;
          else if (/^\d{4}$/.test(next)) data.year_built = next;
        }
      }

      // ── Stories ───────────────────────────────────────────────
      if (!data.stories) {
        if (/^stories$/i.test(line)) {
          if (/^\d+$/.test(next)) data.stories = next;
          else if (/^\d+$/.test(prev)) data.stories = prev;
        }
      }

      // ── Building Class ────────────────────────────────────────
      if (!data.building_class) {
        if (/^class$/i.test(line)) {
          if (/^[A-C]$/i.test(next)) data.building_class = next;
          else if (/^[A-C]$/i.test(prev)) data.building_class = prev;
        }
      }

      // ── Occupancy / Leased ────────────────────────────────────
      if (!data.occupancy) {
        if (/^leased(\s+at\s+sale)?$/i.test(line) || /^(percent\s+)?leased$/i.test(line) || /^occupancy$/i.test(line)) {
          if (/^\d+%$/.test(prev)) data.occupancy = prev;
          else if (/^\d+%$/.test(next)) data.occupancy = next;
        }
      }

      // ── Zoning ────────────────────────────────────────────────
      if (!data.zoning) {
        if (/^zoning$/i.test(line)) {
          if (next && next.length < 20 && !/^(market|land|parking)/i.test(next)) {
            data.zoning = next;
          }
        }
      }

      // ── Lot Size ──────────────────────────────────────────────
      if (!data.lot_size) {
        if (/^land\s+acres$/i.test(line)) {
          if (/[\d.]+\s*ac/i.test(next)) data.lot_size = next;
        } else if (/^land\s+sf$/i.test(line)) {
          if (/[\d,]+\s*sf/i.test(next)) data.lot_size = next;
        }
      }

      // ── Parking ───────────────────────────────────────────────
      if (!data.parking) {
        if (/^parking\s+ratio$/i.test(line)) {
          if (next && next.length < 30) data.parking = next;
        }
      }

      // ── Property Type ─────────────────────────────────────────
      if (!data.property_type) {
        if (/^type$/i.test(line)) {
          // Must be in Building section — check that the value looks like a property type
          if (next && next.length < 50 && !/^\d/.test(next) && !/^(investment|sale)/i.test(next)) {
            data.property_type = next;
          }
        }
      }

      // ── NOI ───────────────────────────────────────────────────
      if (!data.noi) {
        if (/^noi$/i.test(line)) {
          if (/^\$?[\d,]+/.test(next)) data.noi = next;
          else if (/^\$?[\d,]+/.test(prev)) data.noi = prev;
        }
      }

      // ── Price/SF ──────────────────────────────────────────────
      if (!data.price_per_sf) {
        if (/^price\/?sf$/i.test(line) || /^price\s+per\s+sf$/i.test(line)) {
          if (/^\$?[\d,.]+/.test(next)) data.price_per_sf = next;
          else if (/^\$?[\d,.]+/.test(prev)) data.price_per_sf = prev;
        }
      }

      // ── Owner / Seller ────────────────────────────────────────
      if (!data.owner_name) {
        if (/^recorded\s+seller$/i.test(line)) {
          if (next && next.length > 2 && next.length < 80) data.owner_name = next;
        }
      }

      // ── Tenant ────────────────────────────────────────────────
      if (!data.tenant_name) {
        if (/^tenants?\s+at\s+sale$/i.test(line)) {
          // Scan ahead: skip header lines like "Name", "Source:"
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const t = lines[j];
            if (!t || /^(name|source:|logo)$/i.test(t)) continue;
            if (t.length > 2 && t.length < 80 && !/^\d+$/.test(t)) {
              data.tenant_name = t;
              break;
            }
          }
        }
      }

      // ── Listing Broker ────────────────────────────────────────
      if (!data.broker_name) {
        if (/^listing\s+broker$/i.test(line)) {
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const b = lines[j];
            if (!b || /^(logo|no\s+)$/i.test(b)) continue;
            if (b.startsWith('(') || b.includes('@')) continue;
            if (b.length > 3 && b.length < 60) {
              data.broker_name = b;
              break;
            }
          }
        }
      }

      // ── Tab-separated assessment table ────────────────────────
      // "Improvements\t$2,839,200\t$324.48/SF"
      // "Total Value\t$3,122,800\t$356.89/SF"
      if (line.includes('\t')) {
        const parts = line.split('\t').map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const label = parts[0].toLowerCase();
          const value = parts[1];
          if (!data.improvement_value && label === 'improvements') data.improvement_value = value;
          if (!data.assessed_value && label === 'total value') data.assessed_value = value;
          if (!data.land_value && label === 'land') data.land_value = value;
        }
      }

      // ── Parcels ───────────────────────────────────────────────
      if (!data.parcel_number) {
        if (/^parcels?$/i.test(line)) {
          if (next && /^[\d-]+$/.test(next)) data.parcel_number = next;
        }
      }
    }

    return data;
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
