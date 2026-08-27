Warning: truncated output (original token count: 49366)
Total output lines: 4162

// ============================================================================
// LCC Assistant — Side Panel Logic
// Manages 3 tabs: Property, Search, Chat
// API calls made directly via fetch (no background.js dependency)
// ============================================================================

// ── Helpers ─────────────────────────────────────────────────────────────────

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Coerce any value (string, number, array, object) to a safe display string.
// Prevents "[object Object]" from leaking into the UI.
function toDisplayString(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try {
    return JSON.stringify(val);
  } catch (_) {
    return String(val);
  }
}

// Extract a human-readable error message from arbitrary API error shapes.
function toErrorMessage(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    return val.message || val.error || val.detail || toDisplayString(val);
  }
  return String(val);
}

// Render a concise human-readable summary of the pipeline_summary object
// returned from the ingestion pipeline. Prevents raw JSON leaking into toasts.
function formatPipelineSummary(summary) {
  if (!summary || typeof summary !== 'object') return String(summary || '');
  const r = summary.domain_records || {};
  const parts = [];
  if (r.sales > 0)       parts.push(r.sales + ' sale' + (r.sales > 1 ? 's' : ''));
  if (r.leases > 0)      parts.push(r.leases + ' lease' + (r.leases > 1 ? 's' : ''));
  if (r.loans > 0)       parts.push(r.loans + ' loan' + (r.loans > 1 ? 's' : ''));
  if (r.owners > 0)      parts.push(r.owners + ' owner' + (r.owners > 1 ? 's' : ''));
  if (r.listings > 0)    parts.push(r.listings + ' listing' + (r.listings > 1 ? 's' : ''));
  if (r.brokers > 0)     parts.push(r.brokers + ' broker' + (r.brokers > 1 ? 's' : ''));
  if (r.deed_records > 0) parts.push(r.deed_records + ' deed' + (r.deed_records > 1 ? 's' : ''));
  if (r.true_owners > 0)  parts.push(r.true_owners + ' true owner' + (r.true_owners > 1 ? 's' : ''));
  if (r.contacts > 0)     parts.push(r.contacts + ' contact' + (r.contacts > 1 ? 's' : ''));

  // Fix domain label — must match exactly what the pipeline sets
  const PIPELINE_DOMAIN_LABELS = {
    'dialysis':   'Dialysis DB',
    'government': 'Government DB',
    'net_lease':  'Net Lease DB',
  };
  const domainLabel = PIPELINE_DOMAIN_LABELS[summary.domain] || summary.domain || '';
  const base = '→ ' + (domainLabel ? domainLabel + ': ' : '');

  return parts.length
    ? base + parts.join(', ')
    : base + 'no new records (all deduped)';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function domainBadge(domain) {
  if (!domain) return '';
  const d = domain.toLowerCase();
  if (d === 'government' || d === 'gov') return '<span class="domain-badge gov">GOV</span>';
  if (d === 'dialysis' || d === 'dia') return '<span class="domain-badge dia">DIA</span>';
  if (d === 'costar') return '<span class="domain-badge" style="background:#1A5276;color:white;">CS</span>';
  if (d === 'loopnet') return '<span class="domain-badge" style="background:#E67E22;color:white;">LN</span>';
  if (d === 'crexi') return '<span class="domain-badge" style="background:#27AE60;color:white;">CX</span>';
  if (d === 'salesforce') return '<span class="domain-badge" style="background:#00A1E0;color:white;">SF</span>';
  if (d === 'public-records') return '<span class="domain-badge" style="background:#7D3C98;color:white;">PR</span>';
  return '';
}

const DOMAIN_LABELS = {
  costar: 'CoStar',
  loopnet: 'LoopNet',
  crexi: 'CREXi',
  salesforce: 'Salesforce',
  outlook: 'Outlook',
  'public-records': 'Public Records',
  rca: 'RCA',
};

async function getLCCConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['LCC_RAILWAY_URL', 'LCC_API_KEY'], resolve);
  });
}

// W1.4-L3b (2026-07-29): does a capture (fresh page ctx OR a stored entity's
// metadata) carry anything the domain classifier / pipeline can actually
// extract? Guards "Promote to DB" so it never fires on an empty capture whose
// only signal is the entity name — which silently classifies domain:null and
// writes zero rows. Content = an address, OR a core property/financial/lease
// field, OR PDF text, OR a non-empty content array.
function hasExtractableContent(src) {
  if (!src || typeof src !== 'object') return false;
  if (src.address && String(src.address).trim()) return true;
  const SCALAR_KEYS = [
    'tenant_name', 'primary_tenant', 'building_name', 'property_subtype', 'sub_type',
    'asking_price', 'cap_rate', 'noi', 'price_per_sf', 'sale_price', 'annual_rent',
    'square_footage', 'year_built', 'parcel_number',
    'lease_expiration', 'lease_commencement', 'lease_type',
  ];
  for (const k of SCALAR_KEYS) {
    if (src[k] != null && String(src[k]).trim() !== '') return true;
  }
  const ARRAY_KEYS = [
    'tenants', 'contacts', 'sales_history', 'portfolio_properties',
    'pdf_extracted_texts', 'documents', 'document_links',
  ];
  for (const k of ARRAY_KEYS) {
    if (Array.isArray(src[k]) && src[k].length > 0) return true;
  }
  return false;
}

async function pollPipelineStatus(entityId, container) {
  // Round 76af 2026-04-28: poll up to 4 times (3.5s, 6s, 10s, 16s) before
  // giving up. The previous single-poll-at-3.5s would frequently render
  // 'Domain: not matched' just because the server pipeline wasn't done yet,
  // even on captures that classified perfectly. Now we only show 'no domain'
  // after every poll missed — and even then we say 'still processing' rather
  // than the misleading 'not matched' diagnostic.
  const POLL_WAITS_MS = [3500, 6000, 10000, 16000];

  const config = await getLCCConfig();
  const baseUrl = config.LCC_RAILWAY_URL;
  if (!baseUrl) return;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/entities?id=${entityId}&fields=metadata`;
  const headers = {};
  if (config.LCC_API_KEY) headers['X-LCC-Key'] = config.LCC_API_KEY;

  let lastMeta = null;
  for (const waitMs of POLL_WAITS_MS) {
    try {
      await new Promise((r) => setTimeout(r, waitMs));
      const res = await fetch(url, { method: 'GET', headers });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      const meta = data?.entity?.metadata || data?.metadata || {};
      lastMeta = meta;

      const summary = meta._pipeline_summary;
      const status  = meta._pipeline_status;
      const lastError = meta._pipeline_last_error;

      // Terminal states — render and stop polling.
      if (status === 'failed') {
        const line = document.createElement('div');
        line.className = 'update-toast';
        line.textContent = `→ Pipeline error: ${toErrorMessage(lastError) || 'unknown'}`;
        container.prepend(line);
        return;
      }
      if (summary) {
        const line = document.createElement('div');
        line.className = 'update-toast updated';
        line.textContent = formatPipelineSummary(summary);
        container.prepend(line);
        return;
      }
      // No summary yet — keep polling.
    } catch (_) {
      // best-effort — keep polling on transient errors
    }
  }

  // All polls exhausted without a summary. Render a neutral "still processing"
  // message — NOT 'Domain: not matched' (which was misleading; the classifier
  // ran fine, the pipeline summary just hadn't landed yet on slow runs).
  const line = document.createElement('div');
  line.className = 'update-toast';
  line.style.background = '#FEF3C7';
  line.style.color = '#92400E';
  line.style.borderColor = '#FCD34D';
  line.textContent = '→ Pipeline still processing — refresh in a moment';
  container.prepend(line);
}

async function apiCall(endpoint, body, method = 'POST') {
  try {
    const config = await getLCCConfig();
    const baseUrl = config.LCC_RAILWAY_URL;
    const apiKey = config.LCC_API_KEY;

    if (!baseUrl) {
      return { ok: false, error: 'LCC URL not configured. Click ⚙ to open Settings.' };
    }

    const url = `${baseUrl.replace(/\/+$/, '')}${endpoint}`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-LCC-Key'] = apiKey;

    const fetchOpts = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') {
      fetchOpts.body = JSON.stringify(body || {});
    }
    const res = await fetch(url, fetchOpts);

    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

async function getPageContext() {
  return new Promise((resolve) => {
    chrome.storage.session.get(['pageContext'], (result) => {
      resolve(result.pageContext || null);
    });
  });
}

// ── Restricted ASC frozen-50 research target ───────────────────────────────
// This is a separate evidence-only path. It never calls Save Property, the
// dia/gov propagator, Salesforce writeback, opportunity creation, or outreach.
async function wireAscResearchAction(ctx, actions) {
  if (!ctx?.address || !actions) return;
  const result = await apiCall('/api/asc-research-target', null, 'GET');
  const target = result.ok ? result.data?.target : null;
  if (!target) return;

  const identity = target.cms_identity || {};
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:8px;padding:8px;border:1px solid #93C5FD;border-radius:6px;background:#EFF6FF;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:11px;font-weight:700;color:#1E3A8A;margin-bottom:5px;';
  title.textContent = `ASC Research ${target.sample_ordinal}/50 — ${identity.facility_name || identity.ccn || 'Frozen candidate'}`;
  wrap.appendChild(title);
  const detail = document.createElement('div');
  detail.style.cssText = 'font-size:10px;color:#475569;margin-bottom:6px;';
  detail.textContent = `${identity.address || ''}, ${identity.city || ''}, ${identity.state || ''} ${identity.zip || ''}`.trim();
  wrap.appendChild(detail);
  const button = document.createElement('button');
  button.className = 'btn btn-sm btn-primary';
  button.textContent = 'Attach capture to ASC research';
  wrap.appendChild(button);
  const missing = document.createElement('button');
  missing.className = 'btn btn-sm btn-secondary';
  missing.style.cssText = 'margin-left:5px;margin-top:5px;';
  missing.textContent = 'Complete: CoStar + RCA not found';
  wrap.appendChild(missing);
  actions.appendChild(wrap);

  missing.addEventListener('click', async () => {
    const label = identity.facility_name || identity.ccn || 'this frozen candidate';
    const confirmed = window.confirm(
      `Confirm you manually searched the exact frozen candidate (${label}) in both CoStar and RCA and found no matching property. No evidence capture will be created.`,
    );
    if (!confirmed) return;
    missing.disabled = true;
    button.disabled = true;
    missing.textContent = 'Recording missingness…';
    const advanced = await apiCall('/api/asc-research-complete', {
      run_id: target.run_id,
      candidate_fingerprint: target.candidate_fingerprint,
      source_dispositions: { costar: 'not_found', rca: 'not_found' },
    });
    if (advanced.ok) {
      missing.textContent = 'Missingness recorded ✓ — open next property';
      detail.textContent = 'CoStar and RCA not-found dispositions recorded with zero captures; second review required. The next frozen candidate will load on the next page scan.';
    } else {
      missing.disabled = false;
      button.disabled = false;
      missing.textContent = 'Complete: CoStar + RCA not found';
      detail.textContent = toErrorMessage(
        advanced.data?.detail || advanced.data?.error || advanced.error
      ) || 'Could not record licensed-source missingness';
    }
  });

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Validating address…';
    // CoStar injects this extension into same-origin child frames. A child
    // frame can update session.pageContext after the property card rendered,
    // but without carrying the subject address/state. Do not let that partial
    // context replace the complete page context that produced this card.
    const sessionCtx = await getPageContext();
    const liveCtx = sessionCtx?.address && sessionCtx?.state ? sessionCtx : ctx;
    const domain = liveCtx.domain || liveCtx.source || '';
    const context = {
      ...buildMetadata(liveCtx, domain),
      address: liveCtx.address,
      city: liveCtx.city,
      state: liveCtx.state,
      zip: liveCtx.zip,
      page_url: liveCtx.page_url,
      source: domain,
    };
    const capture = await apiCall('/api/asc-research-capture', { target, context });
    if (capture.ok) {
      button.textContent = 'ASC evidence captured ✓';
      button.className = 'btn btn-sm btn-success';
      const lccCount = capture.data?.reconciliation?.lcc_matches?.length || 0;
      const sfCount = capture.data?.reconciliation?.salesforce_identities?.length || 0;
      detail.textContent = `Structured evidence saved privately; LCC matches: ${lccCount}; Salesforce identities: ${sfCount}. No canonical or CRM writes.`;
      const complete = document.createElement('button');
      complete.className = 'btn btn-sm btn-secondary';
      complete.style.marginLeft = '5px';
      complete.textContent = 'Complete property capture';
      wrap.appendChild(complete);
      complete.addEventListener('click', async () => {
        complete.disabled = true;
        complete.textContent = 'Advancing…';
        const advanced = await apiCall('/api/asc-research-complete', {
          run_id: target.run_id,
          candidate_fingerprint: target.candidate_fingerprint,
        });
        if (advanced.ok) {
          complete.textContent = 'Complete ✓ — open next property';
          detail.textContent = 'Evidence collection completed for this candidate. The next frozen candidate will load on the next page scan.';
        } else {
          complete.disabled = false;
          complete.textContent = 'Complete property capture';
          detail.textContent = toErrorMessage(
            advanced.data?.detail || advanced.data?.error || advanced.error
          ) || 'Could not advance candidate';
        }
      });
    } else {
      button.disabled = false;
      button.textContent = 'Capture blocked — retry';
      button.className = 'btn btn-sm btn-danger';
      detail.textContent = toErrorMessage(
        capture.data?.detail || capture.data?.error || capture.error
      ) || 'Capture failed';
    }
  });
}

// ── PDF text extraction (pdf.js) ───────────────────────────────────────────

/**
 * Extract all text from a PDF at the given URL using pdf.js.
 * Returns { text, pageCount } or throws on failure.
 */
async function extractPdfText(url) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('pdf.js not loaded');
  }
  // Set worker path relative to extension root
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

  // Fetch PDF via background.js to handle CORS
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching PDF`);
  const arrayBuffer = await resp.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    pages.push(pageText);
  }
  return { text: pages.join('\n\n'), pageCount: pdf.numPages };
}

/**
 * Parse deal metrics from raw PDF text (OM, deed, brochure).
 * Returns an object with extracted fields.
 */
/**
 * Pre-process PDF text to extract label-value pairs from OM investment overview.
 * PDFs often render label-value tables as bullet-separated lists where values
 * appear BEFORE their labels. This function finds known CRE labels and extracts
 * the value that appears in the bullet entry immediately before each label.
 */
function extractBulletTablePairs(text) {
  const pairs = {};
  // Split on bullet separators
  const parts = text.split(/\n\s*•\s*\n/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 4) return pairs;

  // Known OM investment overview labels → output keys
  const KNOWN_LABELS = {
    'BUILDING SIZE': 'building_size',
    'YEAR BUILT': 'year_built',
    'YEAR BUILT / EFFECTIVE AGE': 'year_built_effective_age',
    'TYPE OF OWNERSHIP': 'type_of_ownership',
    'TENANT NAME': 'tenant_name',
    'LEASE TYPE': 'lease_type',
    'LANDLORD RESPONSIBILITIES': 'landlord_responsibilities',
    'OCCUPANCY': 'occupancy',
    'OCCUPANY': 'occupancy',  // common typo
    'LEASE COMMENCEMENT': 'lease_commencement',
    'LEASE EXPIRATION': 'lease_expiration',
    'OPTIONS': 'options',
    'RENEWAL OPTIONS': 'options',
    'RENT INCREASES': 'rent_increases',
    'ESCALATIONS': 'escalations',
    'GUARANTOR': 'guarantor',
    'EXPENSE STRUCTURE': 'expense_structure',
    'LOT SIZE': 'lot_size',
    'PARKING': 'parking',
    'ZONING': 'zoning',
  };

  // For each part, check if it matches a known label
  for (let i = 1; i < parts.length; i++) {
    const normalized = parts[i].trim().toUpperCase();
    // Check for exact label match (the part may contain only the label text)
    for (const [label, key] of Object.entries(KNOWN_LABELS)) {
      if (normalized === label || normalized.startsWith(label + '\n')) {
        // The value is the part immediately before this label.
        // If that part has multiple lines (e.g. first chunk includes headers),
        // take only the last non-empty line as the value.
        const rawVal = parts[i - 1].trim();
        const lines = rawVal.split('\n').map(l => l.trim()).filter(Boolean);
        const val = lines.length > 0 ? lines[lines.length - 1] : '';
        if (val.length > 0 && val.length < 100) {
          pairs[key] = val;
        }
        break;
      }
    }
  }
  return pairs;
}

/**
 * Pre-process PDF text to extract rent roll table data.
 * Looks for column headers (LEASE START, LEASE END, MONTHLY RENT, etc.)
 * followed by data rows.
 */
function extractRentRollData(text) {
  const data = {};
  // Match rent roll row: date date $amount $amount $amount pct%
  const rowMatch = text.match(
    /(?:current|initial|base)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+\$?([\d,]+(?:\.\d+)?)\s+\$?([\d,]+(?:\.\d+)?)\s+\$?([\d.]+)\s+([\d.]+)%/i
  );
  if (rowMatch) {
    data.lease_start = rowMatch[1];
    data.lease_end = rowMatch[2];
    data.monthly_rent = '$' + rowMatch[3];
    data.annual_rent = '$' + rowMatch[4];
    data.rent_psf = '$' + rowMatch[5];
    data.cap_rate = rowMatch[6] + '%';
  }

  // Extract renewal option rows: Option N date date FMR FMR
  const optionMatches = [...text.matchAll(
    /option\s*(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(FMR|[\d$,]+)/gi
  )];
  if (optionMatches.length > 0) {
    data.renewal_options_detail = optionMatches.map(m => ({
      option: parseInt(m[1], 10),
      start: m[2], end: m[3], rent: m[4],
    }));
  }

  // Extract rent roll footnotes
  const notes = [];
  const noteMatches = text.matchAll(/\*\s*tenant\s+(reimburses|occupies|is\s+responsible)(?:[^.]|\.\d)+\./gi);
  for (const m of noteMatches) notes.push(m[0].replace(/^\*\s*/, '').trim());
  if (notes.length > 0) data.rent_roll_notes = notes;

  return data;
}

function parsePdfDealMetrics(text) {
  const metrics = {};
  if (!text) return metrics;

  // Pre-process: extract structured data from bullet tables and rent roll
  const bulletPairs = extractBulletTablePairs(text);
  const rentRoll = extractRentRollData(text);

  // Use bullet-table pairs for fields that are hard to regex from raw text
  if (bulletPairs.lease_commencement) metrics.lease_commencement = bulletPairs.lease_commencement;
  if (bulletPairs.guarantor) metrics.guarantor = bulletPairs.guarantor;
  if (bulletPairs.type_of_ownership) metrics.ownership_type = bulletPairs.type_of_ownership;
  if (bulletPairs.lease_type) metrics.lease_type = bulletPairs.lease_type;
  if (bulletPairs.rent_increases) metrics.rent_increase_mechanism = bulletPairs.rent_increases;
  if (bulletPairs.landlord_responsibilities) metrics.landlord_responsibilities = bulletPairs.landlord_responsibilities;
  if (bulletPairs.options) metrics.renewal_options = bulletPairs.options;
  if (bulletPairs.occupany || bulletPairs.occupancy) metrics.occupancy = (bulletPairs.occupany || bulletPairs.occupancy);
  if (bulletPairs.tenant_name) metrics.tenant_name = bulletPairs.tenant_name;
  if (bulletPairs.building_size) {
    const num = parseInt(bulletPairs.building_size.replace(/[^0-9]/g, ''), 10);
    if (num >= 500 && num <= 500000) metrics.building_sf = bulletPairs.building_size;
  }
  // Year built / effective age — handle various key formats from bullet table
  const yrKey = Object.keys(bulletPairs).find(k => k.includes('year_built'));
  if (yrKey && bulletPairs[yrKey]) {
    const yrParts = bulletPairs[yrKey].split(/\s*[\/\-]\s*/);
    if (yrParts[0] && /^\d{4}$/.test(yrParts[0].trim())) metrics.year_built = yrParts[0].trim();
    if (yrParts[1] && /^\d{4}$/.test(yrParts[1].trim())) metrics.year_renovated = yrParts[1].trim();
  }

  // Use rent roll data
  if (rentRoll.monthly_rent) metrics.monthly_rent = rentRoll.monthly_rent;
  if (rentRoll.annual_rent && !metrics.annual_rent) metrics.annual_rent = rentRoll.annual_rent;
  if (rentRoll.rent_psf) metrics.rent_per_sf = rentRoll.rent_psf + '/SF';
  if (rentRoll.cap_rate) metrics.cap_rate = rentRoll.cap_rate;
  if (rentRoll.lease_start) metrics.current_term_start = rentRoll.lease_start;
  if (rentRoll.lease_end && !metrics.lease_expiration) metrics.lease_expiration = rentRoll.lease_end;
  if (rentRoll.rent_roll_notes) metrics.expense_notes = rentRoll.rent_roll_notes.join(' | ');
  if (rentRoll.renewal_options_detail) {
    metrics.option_periods = rentRoll.renewal_options_detail
      .map(o => `Option ${o.option}: ${o.start}–${o.end} (${o.rent})`).join('; ');
  }

  // NOI
  const noiMatch = text.match(/\bNOI\b[:\s]*\$?([\d,]+(?:\.\d+)?)/i)
    || text.match(/net\s+operating\s+income[:\s]*\$?([\d,]+(?:\.\d+)?)/i);
  if (noiMatch) metrics.noi = '$' + noiMatch[1].trim();

  // Cap rate
  const capMatch = text.match(/cap\s*(?:italization)?\s*rate[:\s]*([\d.]+)\s*%/i)
    || text.match(/\b([\d.]+)\s*%\s*cap/i);
  if (capMatch) metrics.cap_rate = capMatch[1] + '%';

  // Annual rent
  const rentMatch = text.match(/(?:annual|base|current)\s+rent[:\s]*\$?([\d,]+(?:\.\d+)?)/i);
  if (rentMatch) metrics.annual_rent = '$' + rentMatch[1].trim();

  // Rent per SF
  const rentSfMatch = text.match(/\$\s*([\d.]+)\s*(?:\/|\s+per\s+)(?:sf|square\s+foot)/i)
    || text.match(/rent[:\s]*\$?([\d.]+)\s*(?:\/sf|psf)/i);
  if (rentSfMatch) metrics.rent_per_sf = '$' + rentSfMatch[1] + '/SF';

  // Lease expiration
  const expMatch = text.match(/(?:lease\s+)?expir(?:es|ation|y)[:\s]*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4})/i);
  if (expMatch) metrics.lease_expiration = expMatch[1].trim();

  // Lease term
  const termMatch = text.match(/(?:lease\s+)?term[:\s]*(\d+)\s*(?:year|yr)s?/i);
  if (termMatch) metrics.lease_term = termMatch[1] + ' years';

  // Rent escalations / bumps
  const escMatch = text.match(/(?:annual\s+)?(?:escalation|increase|bump)s?[:\s]*([\d.]+)\s*%/i)
    || text.match(/([\d.]+)\s*%\s*(?:annual\s+)?(?:escalation|increase|bump)/i);
  if (escMatch) metrics.escalation = escMatch[1] + '%';

  // Renewal options (don't overwrite bullet-table value)
  if (!metrics.renewal_options) {
    const renewMatch = text.match(/(?:renewal|extension)\s+option[s]?[:\s]*([\w\s,()]+?)(?:\.|;|$)/i);
    if (renewMatch && renewMatch[1].length < 80) metrics.renewal_options = renewMatch[1].trim();
  }

  // Expense structure (NNN, NN, Gross, Modified Gross)
  const expenseMatch = text.match(/\b(triple\s+net|NNN|double\s+net|NN|modified\s+gross|full\s+service\s+gross)\b/i);
  if (expenseMatch) metrics.expense_structure = expenseMatch[0].trim();

  // Building SF (don't overwrite bullet-table value)
  if (!metrics.building_sf) {
    const sfMatch = text.match(/([\d,]+)\s*(?:rentable\s+)?(?:square\s+feet|sf|RSF)\b/i);
    if (sfMatch) {
      const num = parseInt(sfMatch[1].replace(/,/g, ''), 10);
      if (num >= 500 && num <= 500000) metrics.building_sf = sfMatch[1] + ' SF';
    }
  }

  // Year built / renovated (don't overwrite bullet-table value)
  if (!metrics.year_built) {
    const yrMatch = text.match(/(?:built|constructed|year\s+built)[:\s]*(\d{4})/i);
    if (yrMatch) metrics.year_built = yrMatch[1];
  }

  // Occupancy (don't overwrite bullet-table value)
  if (!metrics.occupancy) {
    const occMatch = text.match(/([\d.]+)\s*%\s*(?:occupied|occupancy|leased)/i);
    if (occMatch) metrics.occupancy = occMatch[1] + '%';
  }

  // Tenant name (don't overwrite bullet-table value)
  if (!metrics.tenant_name) {
    const tenantMatch = text.match(/(?:tenant|leased\s+to|occupied\s+by)[:\s]*([A-Z][A-Za-z\s&,.'-]+?)(?:\s*[-–—(,]|\s+at\s+|\s+since\s+|\s+through\s+|\.)/);
    if (tenantMatch && tenantMatch[1].length < 60) metrics.tenant_name = tenantMatch[1].trim();
  }

  // Sale price
  const priceMatch = text.match(/(?:sale|purchase|acquisition)\s+price[:\s]*\$?([\d,]+(?:\.\d+)?(?:\s*(?:M|million))?)/i);
  if (priceMatch) metrics.sale_price = '$' + priceMatch[1].trim();

  // Asking price / list price
  const askMatch = text.match(/(?:asking|list)\s+price[:\s]*\$?([\d,]+(?:\.\d+)?(?:\s*(?:M|million))?)/i);
  if (askMatch) metrics.asking_price = '$' + askMatch[1].trim();

  // ── Tier 1 fields ─────────────────────────────────────────────────────────

  // Lease commencement date
  const commMatch = text.match(/(?:lease\s+)?commencement[:\s]*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (commMatch) metrics.lease_commencement = commMatch[1].trim();

  // Guarantor (Corporate, Personal, etc.)
  const guarMatch = text.match(/guarantor[:\s]*(corporate|personal|individual|parent|none)\b/i);
  if (guarMatch) metrics.guarantor = guarMatch[1].trim();

  // Year renovated — "1991 / 2012" or "renovated 2012" or "effective age 2012"
  const renovMatch = text.match(/(?:renovated|renovation|effective\s+age)[:\s]*(\d{4})/i)
    || text.match(/(?:built|year\s+built)[:\s\/]*\d{4}\s*[\/\-]\s*(\d{4})/i);
  if (renovMatch) metrics.year_renovated = renovMatch[1];

  // Monthly rent
  const moRentMatch = text.match(/monthly\s+rent[:\s]*\$?([\d,]+(?:\.\d+)?)/i);
  if (moRentMatch) metrics.monthly_rent = '$' + moRentMatch[1].trim();

  // Listing broker — name, firm, phone, email
  // "In State Broker: Brian Brockman" or "CONTACT\nBrian Brockman" on final page
  // Require Firstname Lastname pattern (capitalized, 2+ chars each)
  const brokerNameMatch = text.match(/(?:in\s+state\s+broker|contact)\s*[:\s]\s*([A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,20})\b/i)
    || text.match(/(?:listing\s+agent|presented\s+by|exclusive(?:ly)?\s+(?:listed|marketed)\s+by)\s*[:\s]\s*([A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,20})\b/i);
  if (brokerNameMatch) metrics.listing_broker = brokerNameMatch[1].trim();

  const brokerFirmMatch = text.match(/(?:in\s+state\s+broker|brokerage|(?:listed|marketed|offered)\s+by)[:\s]*(?:[A-Za-z ]+?•\s*)?([A-Za-z][A-Za-z &.,'-]+?(?:Realty|Real\s+Estate|Capital|Group|Advisors|Partners|Properties|Brokerage|Inc\.?|LLC|Co\.?))/i);
  if (brokerFirmMatch) metrics.listing_firm = brokerFirmMatch[1].trim();

  const brokerPhoneMatch = text.match(/(\d{3}[\s.\-]\d{3}[\s.\-]\d{4})/);
  if (brokerPhoneMatch) metrics.listing_phone = brokerPhoneMatch[1].trim();

  const brokerEmailMatch = text.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  if (brokerEmailMatch) metrics.listing_email = brokerEmailMatch[1].trim();

  // ── Tier 2 fields ─────────────────────────────────────────────────────────

  // Ownership type (don't overwrite bullet-table value)
  if (!metrics.ownership_type) {
    const ownTypeMatch = text.match(/(?:type\s+of\s+ownership|ownership\s+(?:type|interest)|estate\s+type)[:\s]*(fee\s+simple|ground\s+lease|leasehold|fee\s+absolute)/i)
      || text.match(/\b(fee\s+simple|ground\s+lease)\b/i);
    if (ownTypeMatch) metrics.ownership_type = ownTypeMatch[1].trim();
  }

  // Rent increase mechanism (don't overwrite bullet-table value)
  if (!metrics.rent_increase_mechanism) {
    const rentIncMatch = text.match(/(?:rent\s+increase|escalation|bump)s?[:\s]*((?:FMR|fair\s+market\s+(?:rent|value|reset)|CPI|consumer\s+price|fixed)[^.;]*?)(?:\.|;|$)/i);
    if (rentIncMatch && rentIncMatch[1].length < 80) metrics.rent_increase_mechanism = rentIncMatch[1].trim();
  }

  // Landlord responsibilities / expense notes (don't overwrite bullet-table value)
  if (!metrics.landlord_responsibilities) {
    const llRespMatch = text.match(/(?:landlord\s+responsibilit(?:y|ies)|LL\s+responsible)[:\s]*([^.]+\.)/i);
    if (llRespMatch && llRespMatch[1].length < 200) metrics.landlord_responsibilities = llRespMatch[1].trim();
  }

  // Tenant credit profile — extract from tenant overview section
  const tickerMatch = text.match(/(?:NYSE|NASDAQ|stock\s+(?:ticker|symbol))[:\s]*([A-Z]{1,5})\b/i);
  if (tickerMatch) metrics.tenant_ticker = tickerMatch[1].toUpperCase();

  const tenantRevMatch = text.match(/(?:total\s+)?revenue[:\s]*\$?([\d,.]+)\s*(billion|million|B|M)\b/i);
  if (tenantRevMatch) {
    const unit = /^[bB]/.test(tenantRevMatch[2]) ? 'B' : 'M';
    metrics.tenant_revenue = '$' + tenantRevMatch[1] + unit;
  }

  const tenantIncomeMatch = text.match(/net\s+income[:\s]*\$?([\d,.]+)\s*(billion|million|B|M)\b/i);
  if (tenantIncomeMatch) {
    const unit = /^[bB]/.test(tenantIncomeMatch[2]) ? 'B' : 'M';
    metrics.tenant_net_income = '$' + tenantIncomeMatch[1] + unit;
  }

  const locationsMatch = text.match(/(?:locations?|(?:number\s+of\s+)?(?:clinics?|facilit(?:y|ies)|stores?|centers?))[:\s]*([\d,]+)\b/i);
  if (locationsMatch) {
    const num = parseInt(locationsMatch[1].replace(/,/g, ''), 10);
    if (num >= 10 && num <= 100000) metrics.tenant_locations = locationsMatch[1];
  }

  return metrics;
}

// ── State ───────────────────────────────────────────────────────────────────

let currentTab = 'property';
let chatHistory = [];
let selectedEntity = null;
let _suppressStorageRerender = false; // true while OM ingest writes to storage

// ── Tab switching ───────────────────────────────────────────────────────────

$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

// Persistent Property-tab footer: the SOS Research Worklist is reachable
// regardless of context (no scan required). Lives outside the render targets
// (#propertyHeader/#propertyBody/#propertyActions), so it survives every
// re-render and only needs wiring once.
$('#sosWorklistBtn')?.addEventListener('click', () => renderLlcResearchQueue('government'));

function switchTab(tab) {
  currentTab = tab;
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));

  if (tab === 'property') {
    loadPropertyTab();
  }
}

// ── Settings ────────────────────────────────────────────────────────────────

$('#openSettings').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
});

// ── Connection check ────────────────────────────────────────────────────────

async function checkConnection() {
  try {
    const config = await getLCCConfig();
    const baseUrl = config.LCC_RAILWAY_URL;
    const apiKey = config.LCC_API_KEY;

    if (!baseUrl) {
      $('#statusDot').className = 'status-dot offline';
      $('#statusText').textContent = 'Not configured — click ⚙';
      return;
    }

    const headers = {};
    if (apiKey) headers['X-LCC-Key'] = apiKey;

    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, { headers });
    if (res.ok) {
      $('#statusDot').className = 'status-dot online';
      $('#statusText').textContent = 'Connected';
    } else {
      $('#statusDot').className = 'status-dot offline';
      $('#statusText').textContent = `Error ${res.status}`;
    }
  } catch (err) {
    $('#statusDot').className = 'status-dot offline';
    $('#statusText').textContent = 'LCC offline';
  }
}

// ── Page context badge ──────────────────────────────────────────────────────

async function updatePageContextBadge() {
  const ctx = await getPageContext();
  const badge = $('#pageContextBadge');
  if (ctx && ctx.domain) {
    badge.textContent = DOMAIN_LABELS[ctx.domain] || ctx.domain.charAt(0).toUpperCase() + ctx.domain.slice(1);
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1: PROPERTY
// ══════════════════════════════════════════════════════════════════════════════

// Field display config: [costarKey, label, lccEntityKey]
const PROPERTY_FIELDS = [
  ['asking_price', 'Asking Price', 'asking_price'],
  ['cap_rate', 'Cap Rate', 'cap_rate'],
  ['noi', 'NOI', 'noi'],
  ['price_per_sf', 'Price/SF', 'price_per_sf'],
  ['property_type', 'Property Type', 'asset_type'],
  ['building_class', 'Building Class', 'building_class'],
  ['year_built', 'Year Built', 'year_built'],
  ['square_footage', 'Square Footage', 'square_footage'],
  ['lot_size', 'Lot Size', 'lot_size'],
  ['stories', 'Stories', 'stories'],
  ['units', 'Units', 'units'],
  ['parking', 'Parking', 'parking'],
  ['zoning', 'Zoning', 'zoning'],
  ['occupancy', 'Occupancy', 'occupancy'],
  ['lease_term', 'Lease Term', 'lease_term'],
  ['remaining_term', 'Remaining Term', 'remaining_term'],
  ['lease_expiration', 'Lease Expiration', 'lease_expiration'],
  ['renewal_options', 'Lease Options', 'renewal_options'],
  ['lease_type', 'Lease Type', 'lease_type'],
  // Round 76ej.k: structured-panel fields above; these next two are
  // typically only mined from the marketing description prose by
  // crexi.js extractCrexiLeaseFromDescription().
  ['expense_structure', 'Expense Structure', 'expense_structure'],
  ['rent_escalations', 'Rent Escalations', 'rent_escalations'],
  ['tenant_name', 'Tenant', 'tenant_name'],
  ['owner_name', 'Owner', 'owner_name'],
  ['broker_name', 'Broker', 'broker_name'],
  ['broker_company', 'Brokerage', 'broker_company'],
  ['sale_price', 'Last Sale Price', 'sale_price'],
  ['sale_date', 'Last Sale Date', 'sale_date'],
  ['acreage', 'Acreage', 'acreage'],
  ['days_on_market', 'Days on Market', 'days_on_market'],
];

// Extra fields from county assessor / recorder sites
const ASSESSOR_FIELDS = [
  ['parcel_number', 'Parcel / APN'],
  ['assessed_value', 'Assessed Value'],
  ['market_value', 'Market Value'],
  ['land_value', 'Land Value'],
  ['improvement_value', 'Improvement Value'],
  ['tax_amount', 'Tax Amount'],
  ['mailing_address', 'Mailing Address'],
  ['document_type', 'Document Type'],
  ['grantor', 'Grantor'],
  ['grantee', 'Grantee'],
  ['book_page', 'Book/Page'],
  ['legal_description', 'Legal Description'],
];

// Fields for SOS / business entity lookups
const ORG_FIELDS = [
  ['name', 'Entity Name'],
  ['filing_number', 'Filing Number'],
  ['status', 'Status'],
  ['entity_type_detail', 'Entity Type'],
  ['formation_date', 'Formation Date'],
  ['state_of_formation', 'Jurisdiction'],
  ['registered_agent', 'Registered Agent'],
  ['agent_address', 'Agent Address'],
  ['principal_address', 'Principal Address'],
  ['officers', 'Officers / Members'],
];

// SOS capture form fields (Unit 3) — the keys map 1:1 to the /api/sos-writeback
// `capture` contract. Each is pre-filled from the scanner (auto-grab) and stays
// editable so a scan miss never blocks capture. `true` = render a textarea.
const SOS_CAPTURE_FIELDS = [
  ['name', 'Entity Name'],
  ['filing_number', 'Filing Number'],
  ['status', 'Status'],
  ['formation_date', 'Formation Date'],
  ['state_of_formation', 'Jurisdiction / State of Formation'],
  ['registered_agent', 'Registered Agent'],
  ['agent_address', 'Agent Address', true],
  ['principal_address', 'Principal / Mailing Address', true],
  ['officers', 'Officers / Managers / Members', true],
];

// Round 76ek (2026-04-29): accept an optional `prefetchEntityId` to skip
// the address-based lookup and resolve the LCC entity by id directly.
// Passed in by the post-save flow so a successful Save immediately flips
// the action button to "Update" without depending on string equality
// between the live page address and the saved entity address.
async function loadPropertyTab(opts) {
  const prefetchEntityId = opts && opts.prefetchEntityId;
  const header = $('#propertyHeader');
  const body = $('#propertyBody');
  const actions = $('#propertyActions');

  // Determine data source: page context or selected entity from search
  const ctx = await getPageContext();
  const source = ctx && (ctx.address || ctx.name) ? ctx : selectedEntity;

  if (!source) {
    header.innerHTML = '';
    body.innerHTML = `<div class="empty-state">
      Browse a property on CoStar, LoopNet, CREXi, or any supported site.<br><br>
      On an unsupported site?<br>
      <button class="btn btn-sm btn-primary" id="scanPageBtn" style="margin-top:8px;">Scan This Page</button>
      <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">
        Works on county assessors, recorders, SOS sites, and more
      </div>
      <div style="margin-top:14px;">
        <button class="btn btn-sm btn-secondary" id="worklistBtnEmpty">📋 SOS Research Worklist</button>
        <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">
          Start SOS research — pick a state, then an owner to look up
        </div>
      </div>
    </div>`;
    actions.innerHTML = '';
    wireScanButton();
    $('#worklistBtnEmpty')?.addEventListener('click', () => renderLlcResearchQueue('government'));
    return;
  }

  // Handle scan-result-empty (scanner found nothing)
  if (source.scan_result === 'empty') {
    header.innerHTML = `<div class="property-title">${escapeHtml(source.page_title || 'Unknown Page')}</div>
      <div class="property-source">Scanned page — no structured data detected</div>`;
    body.innerHTML = `<div class="empty-state">
      The scanner couldn't find structured property or entity data on this page.<br><br>
      <button class="btn btn-sm btn-primary" id="scanPageBtn" style="margin-top:6px;">Retry Scan</button>
    </div>`;
    actions.innerHTML = '';
    wireScanButton();
    return;
  }

  const entityType = source.entity_type || 'property';
  const domain = source.domain || '';
  const domainLabel = DOMAIN_LABELS[domain] || domain || 'Page';
  const siteType = source.site_type || '';

  // Organization entities (SOS / business search)
  if (entityType === 'organization') {
    loadOrgView(source, domainLabel);
    return;
  }

  // Property entities (CRE sites, assessor, recorder, search results)
  const address = source.address || source.name || '';
  const city = source.city || '';
  const state = source.state || '';

  header.innerHTML = `
    <div class="property-title">${escapeHtml(address)}</div>
    ${city || state ? `<div class="property-subtitle">${escapeHtml([city, state].filter(Boolean).join(', '))}</div>` : ''}
    <div class="property-source">${domainBadge(domain)} ${escapeHtml(domainLabel)}${siteType ? ` (${escapeHtml(siteType)})` : ''}${source._version ? ` v${source._version}` : ''}</div>
  `;

  body.innerHTML = '<div class="loading"><div class="spinner"></div><br>Looking up property...</div>';
  actions.innerHTML = '';

  // Query LCC to see if this property already exists.
  // Round 76ek: lookup_asset now accepts entity_id, source_url, and
  // parcel_number in addition to the legacy address+city+state path. Pass
  // every signal we have — the server tries them in order of precision so
  // tiny address-spelling drift ("Drive" vs "Dr") no longer hides a saved
  // entity from the sidebar.
  // Round 76ej.i (2026-05-04): also pass canonical_url (no query string)
  // and crexi_listing_id so the server can recognise listings whose
  // tracking params drifted between the original save and re-visits.
  const lookupQuery = new URLSearchParams({ action: 'lookup_asset' });
  if (prefetchEntityId) lookupQuery.set('entity_id', prefetchEntityId);
  if (source.source_url || source.page_url) {
    lookupQuery.set('source_url', source.source_url || source.page_url);
  }
  if (source.canonical_url) lookupQuery.set('canonical_url', source.canonical_url);
  if (source.crexi_listing_id) {
    lookupQuery.set('domain_listing_id', source.crexi_listing_id);
    lookupQuery.set('listing_source',    'crexi');
  }
  if (source.parcel_number) lookupQuery.set('parcel_number', source.parcel_number);
  if (source.domain_property_id && source.domain) {
    lookupQuery.set('domain_property_id', source.domain_property_id);
    lookupQuery.set('domain', source.domain);
  }
  if (address) lookupQuery.set('address', address);
  if (city) lookupQuery.set('city', city);
  if (state) lookupQuery.set('state', state);
  const searchResult = await apiCall(`/api/entities?${lookupQuery.toString()}`, null, 'GET');

  const lccEntity = searchResult.ok ? (searchResult.data?.entity || null) : null;
  const matched = !!(lccEntity && lccEntity.id);
  if (matched && searchResult.data?.matched_via) {
    // Helpful breadcrumb in console — surfaces the identity key that won
    // (entity_id / source_url / parcel_number / address / address_alias /
    // address_wildcard) when diagnosing future "lost the match" reports.
    console.debug('[lookup_asset] matched via', searchResult.data.matched_via, '→', lccEntity.id);
  }

  // If matched, fetch full context for that entity
  let responseData = {};
  if (matched) {
    const ctxResult = await apiCall('/api/chat', {
      copilot_action: 'fetch_listing_activity_context',
      params: { entity_id: lccEntity.id },
    });
    responseData = ctxResult.ok ? (ctxResult.data?.data || ctxResult.data || {}) : {};
  }

  let html = '';

  // Match status banner
  if (searchResult.ok) {
    html += `<div class="match-status ${matched ? 'found' : 'not-found'}">
      <span class="match-dot ${matched ? 'found' : 'not-found'}"></span>
      ${matched ? 'Found in LCC database' : 'Not yet in LCC database'}
    </div>`;
  } else if (searchResult.error) {
    html += `<div class="match-status not-found">
      <span class="match-dot not-found"></span>
      LCC lookup: ${escapeHtml(searchResult.error)}
    </div>`;
  }

  // Round 76cr-Phase 2 UI: domain-mismatch warning banner. The sidebar
  // pipeline records mismatchWarning in entity.metadata._classifier_diag
  // when the classifier picks one domain but the PRIMARY tenant slot
  // looks like the other (e.g. classified as dialysis but primary tenant
  // is "VA Medical Center"). Surface as an actionable banner.
  const mismatch = lccEntity?.metadata?._classifier_diag?.mismatchWarning
    || lccEntity?.metadata?.domain_mismatch_warning
    || null;
  if (mismatch && mismatch.suggested_domain) {
    const sugLabel = DOMAIN_LABELS[mismatch.suggested_domain] || mismatch.suggested_domain;
    const curLabel = DOMAIN_LABELS[lccEntity?.domain] || lccEntity?.domain || 'current domain';
    html += `<div class="domain-mismatch-banner" style="background:#FFF7E6;border:1px solid #F5A623;border-radius:6px;padding:10px;margin-bottom:12px;font-size:12px;color:#7A4F01;">
      <div style="font-weight:700;margin-bottom:4px;">⚠ Possible domain misclassification</div>
      <div>Routed to <strong>${escapeHtml(curLabel)}</strong>, but the primary tenant looks like <strong>${escapeHtml(sugLabel)}</strong>.</div>
      <div style="margin-top:4px;font-style:italic;color:#9C6500;">Primary tenant signal: "${escapeHtml((mismatch.primary_tenant_text || '').substring(0, 80))}"</div>
    </div>`;
  } else {
    // Round 76cr-Phase 2b (Round 76em, 2026-04-29): capture-time domain
    // mismatch warning. The post-save banner above only fires for entities
    // that already went through the server-side classifier. For unmatched
    // captures (matched=false) and even matched-but-correctly-classified
    // captures where the live page just-now changed tenants, run a small
    // client-side heuristic against the live ctx so the user gets warned
    // BEFORE clicking Save Property to LCC. Cheaper than a full classifier
    // and catches the obvious cases that account for ~95% of the
    // misclassification queue (VA hospitals, GSA leases, post offices,
    // courthouses, IRS, SSA, etc. mistakenly captured into dialysis).
    const captureWarning = detectCaptureDomainMismatch(ctx, domain);
    if (captureWarning) {
      const sugLabel = DOMAIN_LABELS[captureWarning.suggested_domain] || captureWarning.suggested_domain;
      const curLabel = DOMAIN_LABELS[domain] || domain || 'this domain';
      html += `<div class="domain-mismatch-banner" style="background:#FFF7E6;border:1px solid #F5A623;border-radius:6px;padding:10px;margin-bottom:12px;font-size:12px;color:#7A4F01;">
        <div style="font-weight:700;margin-bottom:4px;">⚠ Check before saving — possible wrong domain</div>
        <div>You're capturing into <strong>${escapeHtml(curLabel)}</strong>, but the tenant looks like <strong>${escapeHtml(sugLabel)}</strong>.</div>
        <div style="margin-top:4px;font-style:italic;color:#9C6500;">Tenant: "${escapeHtml((captureWarning.tenant_text || '').substring(0, 80))}" · Matched: <code>${escapeHtml(captureWarning.matched_pattern)}</code></div>
        <div style="margin-top:6px;font-size:11px;color:#7A4F01;">If this is correct, save anyway — the warning won't block. If you should be on the ${escapeHtml(sugLabel)} side, switch tabs or capture from the right channel.</div>
      </div>`;
    }
  }

  // ── SECTION 1: Existing LCC data (shown first when matched) ───────
  if (matched) {
    html += '<div class="lcc-section">';
    html += '<div class="lcc-section-header">In LCC Database</div>';
    html += renderLccFields(lccEntity, responseData, ctx);
    html += renderRelatedLccData(responseData, lccEntity);
    html += '</div>';
  }

  // ── SECTION 2: Source data / proposed changes ─────────────────────
  if (ctx && ctx.address) {
    if (matched) {
      html += renderCompareTable(ctx, lccEntity, domainLabel);
    } else {
      html += renderDetectedFields(ctx, domainLabel);
    }
  }

  // Assessor/recorder extra fields
  if (ctx && ASSESSOR_FIELDS.some(([key]) => ctx[key])) {
    html += renderAssessorFields(ctx);
  }

  // ── SECTION 3: Tenants from source ──────────────────────────────
  const tenants = ctx?.tenants || [];
  if (tenants.length) {
    html += renderTenants(tenants, ctx);
  }

  // ── SECTION 4: Contacts from source ───────────────────────────────
  const contacts = ctx?.contacts || [];
  if (contacts.length) {
    html += renderContacts(contacts);
  }

  // ── SECTION 4a: Marketing description / OM link from source ──────
  if (ctx && (ctx.marketing_headline || ctx.marketing_description || ctx.om_available || ctx.om_url)) {
    html += renderMarketingSection(ctx);
  }

  // ── SECTION 4: Sales history from source ──────────────────────────
  const salesHistory = ctx?.sales_history || [];
  if (salesHistory.length) {
    html += renderSalesHistory(salesHistory, ctx);
  }

  // ── SECTION 4b: Sale notes from source ─────────────────────────
  if (ctx?.sale_notes_raw) {
    html += renderSaleNotes(ctx.sale_notes_raw);
  }

  // ── SECTION 5: Documents from source ──────────────────────────
  // Collect documents from top-level AND from each sale record's document_links
  // so all OMs from all comp pages are visible on the summary page
  const topDocLinks = ctx?.document_links || [];
  const saleDocLinks = (ctx?.sales_history || []).flatMap(s =>
    Array.isArray(s.document_links) ? s.document_links : []
  );
  const seenUrls = new Set();
  const documentLinks = [...topDocLinks, ...saleDocLinks].filter(d => {
    if (!d.url || seenUrls.has(d.url)) return false;
    seenUrls.add(d.url);
    return true;
  });
  if (documentLinks.length) {
    html += renderDocuments(documentLinks);
  }

  // ── SECTION 6: Diff preview (what this save would update) ────────
  if (matched && ctx && ctx.address) {
    html += renderIngestDiff(ctx, lccEntity);
  }

  body.innerHTML = html;

  // Wire the "Stage Listing to LCC" button if it was rendered.
  if (ctx && (ctx.marketing_headline || ctx.marketing_description || ctx.om_available || ctx.om_url)) {
    wireStageListingButton(ctx);
  }

  // Document button handlers
  body.querySelectorAll('.doc-open-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });
  body.querySelectorAll('.doc-ingest-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      const card = btn.closest('.doc-card');
      if (!url || !card) return;

      // Show extraction spinner
      btn.disabled = true;
      btn.textContent = 'Extracting…';
      const spinner = document.createElement('div');
      spinner.className = 'update-toast';
      spinner.textContent = 'Fetching and parsing PDF…';
      card.appendChild(spinner);

      try {
        const { text, pageCount } = await extractPdfText(url);
        if (!text || text.trim().length < 20) {
          spinner.textContent = 'PDF extracted but no readable text found (may be scanned image)';
          setTimeout(() => spinner.remove(), 5000);
          btn.textContent = 'No Text';
          return;
        }

        // Parse deal metrics from extracted text
        const metrics = parsePdfDealMetrics(text);
        const metricKeys = Object.keys(metrics);

        // Update spinner with success
        spinner.textContent = `Extracted ${pageCount} page${pageCount > 1 ? 's' : ''}, ${text.length.toLocaleString()} chars`;
        setTimeout(() => spinner.remove(), 4000);
        btn.textContent = 'Extracted ✓';
        btn.style.background = 'var(--green)';
        btn.style.color = '#fff';

        // Render extracted metrics as tags below the card
        if (metricKeys.length > 0) {
          const metricsDiv = document.createElement('div');
          metricsDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;padding:4px 0;';
          for (const [key, val] of Object.entries(metrics)) {
            const tag = document.createElement('span');
            tag.style.cssText = 'background:#EFF6FF;color:#1E40AF;font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;';
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            tag.textContent = `${label}: ${val}`;
            metricsDiv.appendChild(tag);
          }
          card.appendChild(metricsDiv);
        }

        // Show extracted text preview (collapsible)
        const previewDiv = document.createElement('div');
        previewDiv.style.cssText = 'margin-top:6px;';
        const previewText = text.length > 500 ? text.substring(0, 500) + '…' : text;
        previewDiv.innerHTML = `<details style="font-size:10px;"><summary style="cursor:pointer;color:var(--accent);font-weight:600;">View extracted text (${text.length.toLocaleString()} chars)</summary><pre style="white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto;background:var(--bg);padding:6px;border-radius:4px;margin-top:4px;font-size:10px;line-height:1.4;">${escapeHtml(previewText)}</pre></details>`;
        card.appendChild(previewDiv);

        // Merge extracted metrics into current page context
        // Suppress the onChanged → loadPropertyTab re-render while we write,
        // otherwise the storage listener nukes the extraction UI we just built.
        _suppressStorageRerender = true;
        chrome.storage.session.get(['pageContext'], (result) => {
          const ctx = result.pageContext || {};

          // ── Store extracted text(s) for pipeline processing ──
          // Accumulate all OM texts so the pipeline has access to every OM.
          if (!ctx.pdf_extracted_texts) ctx.pdf_extracted_texts = [];
          ctx.pdf_extracted_texts.push({ text, metrics, url: url });
          // Primary text = first OM ingested (should be the current listing OM)
          if (!ctx.pdf_extracted_text) ctx.pdf_extracted_text = text;
          ctx.pdf_extracted_metrics = metrics;

          // ── Route OM metrics to the correct destination ──
          // If the user is viewing a sale comp page (viewing_comp_id set by
          // costar.js), the OM belongs to THAT historical sale — attach metrics
          // to the matching sales_history entry.
          // If on a Summary/property page, the OM is the current listing OM —
          // merge into top-level context fields.
          const viewingCompDate = ctx.viewing_comp_sale_date;

          // All OM fields — both sale-specific and property/lease
          const allOmFields = [
            'asking_price', 'sale_price', 'cap_rate', 'noi', 'price_per_sf',
            'annual_rent', 'lease_expiration', 'lease_term',
            'escalation', 'renewal_options', 'expense_structure',
            'building_sf', 'year_built', 'occupancy', 'tenant_name',
            'rent_per_sf', 'lease_commencement', 'guarantor', 'year_renovated',
            'monthly_rent', 'listing_broker', 'listing_firm', 'listing_phone',
            'listing_email', 'ownership_type', 'rent_increase_mechanism',
            'landlord_responsibilities', 'tenant_ticker', 'tenant_revenue',
            'tenant_net_income', 'tenant_locations', 'lease_type',
            'current_term_start', 'option_periods', 'expense_notes',
          ];

          // ── Match OM to the correct sale record ──
          // Priority: 1) viewing_comp_sale_date (on a comp page)
          //           2) document URL matches a sale record's document_links
          //           3) fall through to top-level only
          const normDate = (s) => {
            if (!s) return '';
            const d = new Date(s);
            return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : (s || '').trim();
          };

          let saleMatch = null;
          if (viewingCompDate && ctx.sales_history?.length) {
            // On a comp page — match by date
            const targetDate = normDate(viewingCompDate);
            saleMatch = ctx.sales_history.find(s => normDate(s.sale_date) === targetDate);
          }
          if (!saleMatch && ctx.sales_history?.length) {
            // Fallback: match by document URL — check if this OM's URL
            // appears in any sale record's document_links (set by costar.js
            // when visiting comp pages)
            saleMatch = ctx.sales_history.find(s =>
              Array.isArray(s.document_links) &&
              s.document_links.some(d => d.url === url)
            );
          }

          if (saleMatch) {
            // Enrich sale record with ALL OM-extracted data
            for (const key of allOmFields) {
              if (metrics[key] && !saleMatch[key]) saleMatch[key] = metrics[key];
            }
            saleMatch.om_extracted = true;
            saleMatch.om_url = url;
          }

          // Route OM data correctly:
          // - If the OM matched a sale record, it belongs to THAT sale — don't
          //   merge into top-level (avoids historical lease terms overwriting
          //   current listing context).
          // - If no sale match (current listing OM), ALWAYS overwrite top-level
          //   fields so the most recent OM wins for lease_commencement, etc.
          if (!saleMatch) {
            for (const field of allOmFields) {
              if (metrics[field]) ctx[field] = metrics[field];
            }
          }

          chrome.storage.session.set({ pageContext: ctx }, () => {
            // Release the re-render suppression after the write completes
            _suppressStorageRerender = false;
          });
        });

      } catch (err) {
        _suppressStorageRerender = false; // ensure flag is cleared on error
        spinner.textContent = `PDF extraction failed: ${err.message}`;
        spinner.style.background = '#FEE2E2';
        spinner.style.color = '#991B1B';
        setTimeout(() => spinner.remove(), 6000);
        btn.textContent = 'Retry';
        btn.disabled = false;
      }
    });
  });

  // "Stage to LCC" — sends the PDF to /api/intake/stage-om so it flows
  // through the unified pipeline (inbox_items + staged_intake_items +
  // AI extraction + property matching + memory log). Background.js handles
  // the byte fetch + POST to avoid CORS on listing-site PDFs.
  body.querySelectorAll('.doc-stage-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      const label = btn.dataset.label || '';
      const card = btn.closest('.doc-card');
      if (!url || !card) return;

      // Round 76ck: dedupe rapid-fire clicks. Disabled state alone doesn't
      // catch re-rendered clones of the same card. Use a 3s cooldown stamp.
      const now = Date.now();
      const lastClickAt = parseInt(btn.dataset.lastClick || '0', 10);
    …19366 tokens truncated…arking);
  push('Zoning', ctx.zoning);
  push('Occupancy', ctx.occupancy);
  push('Tenancy', ctx.tenancy);
  push('Tenant', ctx.tenant_name);
  push('Brand/Tenant', ctx.brand_tenant);
  push('Tenant Credit', ctx.tenant_credit);
  push('Lease Type', ctx.lease_type);
  push('Original Lease Term (years)', ctx.lease_term);
  push('Remaining Lease Term (years)', ctx.remaining_term);
  push('Lease Expiration Date', ctx.lease_expiration);
  // Round 76ej.k: surface marketing-description-mined lease facts
  // alongside the structured ones so the AI extractor + the LCC sidebar
  // both see them. Falsy/null skipped by `push`.
  push('Expense Structure', ctx.expense_structure);
  push('Rent Escalations', ctx.rent_escalations);
  // Round 76ej.e: spell renewal options out twice so the AI doesn't grab
  // just the leading digit. Live test 76ej.d had renewal_options="2"
  // land in dia.leases instead of "(2) 5 year options".
  if (ctx.renewal_options) {
    lines.push(`Renewal Options: ${ctx.renewal_options}`);
    lines.push(`Renewal Options Description: ${ctx.renewal_options}`);
  }
  push('Investment Type', ctx.investment_type);
  push('APN', ctx.apn);
  push('Days on Market', ctx.days_on_market);
  if (ctx.marketing_description) {
    lines.push('');
    lines.push('Marketing Description:');
    lines.push(ctx.marketing_description);
  }
  if (Array.isArray(ctx.contacts) && ctx.contacts.length) {
    lines.push('');
    lines.push('Listing Brokers:');
    for (const c of ctx.contacts) {
      const parts = [c.name, c.company, c.license, c.phones?.[0], c.email].filter(Boolean);
      if (parts.length) lines.push(`- ${parts.join(' · ')}`);
    }
  }
  return lines.join('\n');
}

async function wireStageListingButton(ctx) {
  const btn = $('.lcc-stage-listing-btn');
  const copyBtn = $('.lcc-copy-listing-btn');
  const status = $('.lcc-stage-status');
  if (!btn) return;

  const text = buildSyntheticListingText(ctx);

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { copyBtn.textContent = 'Copy Summary'; }, 2000);
      } catch (err) {
        copyBtn.textContent = 'Copy failed';
      }
    });
  }

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Staging…';
    if (status) status.textContent = 'Posting to LCC intake…';

    let hostname = null;
    try { hostname = new URL(ctx.page_url || location.href).hostname; } catch {}

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'STAGE_TEXT_TO_LCC',
        text,
        fileName: `crexi-${(ctx.address || 'listing').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60)}.txt`,
        sourceUrl: ctx.page_url || null,
        hostname,
        intent: `CREXi listing capture — ${ctx.address || 'unknown address'}`,
        seedData: {
          // Tell the promoter explicitly that this is OM-grade data so the
          // not_a_listing_doc guard doesn't reject the synthetic snapshot
          // when the AI returns no document_type (which is common for
          // bullet-list text that doesn't pattern-match an OM cover page).
          doctype: 'om',
          address: ctx.address || null,
          city: ctx.city || null,
          state: ctx.state || null,
          tenant_name: ctx.tenant_name || null,
          asking_price: ctx.asking_price || null,
          list_price: ctx.list_price || null,
          original_price: ctx.original_price || ctx.list_price || null,
          original_cap_rate: ctx.original_cap_rate || null,
          last_price_change: ctx.last_price_change || null,
          price_change_history: Array.isArray(ctx.price_change_history) ? ctx.price_change_history : null,
          cap_rate: ctx.cap_rate || null,
          lease_expiration: ctx.lease_expiration || null,
          // Round 76ej.l: marketing-description-mined lease facts so the
          // OM promoter sees them as seed_data hints. The structured
          // CREXi panel doesn't carry these — only the prose does.
          expense_structure: ctx.expense_structure || null,
          rent_escalations: ctx.rent_escalations || null,
          renewal_options: ctx.renewal_options || null,
          remaining_term: ctx.remaining_term || null,
          lease_facts_from_description: ctx.lease_facts_from_description || null,
        },
      });

      if (resp?.ok && resp?.body?.ok) {
        const b = resp.body;
        btn.textContent = `✓ Staged (${b.extraction_status || 'received'})`;
        btn.style.background = 'var(--green)';
        btn.style.color = '#fff';
        if (status) status.textContent = `Intake id: ${b.intake_id || '?'}`;
      } else {
        const errCode = resp?.body?.error || resp?.error || 'unknown';
        const errDetail = resp?.body?.detail || resp?.body?.message || '';
        btn.textContent = 'Failed';
        btn.style.background = 'var(--red, #dc2626)';
        btn.style.color = '#fff';
        btn.disabled = false;
        if (status) {
          status.style.color = 'var(--red, #dc2626)';
          status.textContent = `${errCode}${errDetail ? ' — ' + String(errDetail).slice(0, 120) : ''}`;
        }
        console.error('[Stage Listing] failed', resp);
      }
    } catch (err) {
      btn.textContent = 'Error';
      btn.disabled = false;
      if (status) status.textContent = `Error: ${err.message || err}`;
    }
  });

  // Round 76ej.f (2026-05-04): manual OM PDF upload handler.
  const fileInput = $('.lcc-upload-om-input');
  const uploadStatus = $('.lcc-upload-om-status');
  if (fileInput) {
    fileInput.addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;

      // Round 76ej.g (2026-05-04): cap raised to ~95 MB. Background's
      // STAGE_PDF_BYTES_TO_LCC now uploads through prepare-upload →
      // Supabase Storage → stage-om(storage_path) (Path C), which has
      // a 100 MB bucket limit instead of Vercel's ~4.5 MB body cap.
      // Cap a hair under 100 MB to leave room for base64 inflation in
      // the chrome.runtime message envelope and any service-worker
      // memory headroom.
      const MAX_BYTES = 95 * 1024 * 1024;
      if (file.size > MAX_BYTES) {
        if (uploadStatus) {
          uploadStatus.style.color = 'var(--red, #dc2626)';
          uploadStatus.textContent = `Too large (${(file.size / 1024 / 1024).toFixed(1)} MB > 95 MB cap). Email the OM to the LCC inbox.`;
        }
        return;
      }
      if (!/pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        if (uploadStatus) {
          uploadStatus.style.color = 'var(--red, #dc2626)';
          uploadStatus.textContent = 'Only PDF files are accepted here.';
        }
        return;
      }

      if (uploadStatus) {
        uploadStatus.style.color = 'var(--text-secondary)';
        uploadStatus.textContent = `Reading ${(file.size / 1024).toFixed(0)} KB…`;
      }
      fileInput.disabled = true;

      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        const base64 = btoa(binary);

        let hostname = null;
        try { hostname = new URL(ctx.page_url || location.href).hostname; } catch {}

        if (uploadStatus) uploadStatus.textContent = 'Uploading to LCC intake…';
        const resp = await chrome.runtime.sendMessage({
          type: 'STAGE_PDF_BYTES_TO_LCC',
          base64,
          fileName: file.name,
          mimeType: file.type || 'application/pdf',
          sourceUrl: ctx.page_url || null,
          hostname,
          intent: `Manual OM upload — ${ctx.address || 'unknown address'}`,
          seedData: {
            address: ctx.address || null,
            city: ctx.city || null,
            state: ctx.state || null,
            tenant_name: ctx.tenant_name || null,
            asking_price: ctx.asking_price || null,
            list_price: ctx.list_price || null,
            original_price: ctx.original_price || ctx.list_price || null,
            original_cap_rate: ctx.original_cap_rate || null,
            last_price_change: ctx.last_price_change || null,
            price_change_history: Array.isArray(ctx.price_change_history) ? ctx.price_change_history : null,
            cap_rate: ctx.cap_rate || null,
            lease_expiration: ctx.lease_expiration || null,
            // Round 76ej.l: marketing-description-mined lease facts.
            expense_structure: ctx.expense_structure || null,
            rent_escalations: ctx.rent_escalations || null,
            renewal_options: ctx.renewal_options || null,
            remaining_term: ctx.remaining_term || null,
            lease_facts_from_description: ctx.lease_facts_from_description || null,
          },
        });

        if (resp?.ok && resp?.body?.ok) {
          const b = resp.body;
          if (uploadStatus) {
            uploadStatus.style.color = 'var(--green)';
            uploadStatus.textContent = `✓ Staged ${b.intake_id || ''} (${b.extraction_status || 'received'})`;
          }
        } else {
          const errCode = resp?.body?.error || resp?.error || 'unknown';
          const errDetail = resp?.body?.detail || resp?.body?.message || '';
          if (uploadStatus) {
            uploadStatus.style.color = 'var(--red, #dc2626)';
            uploadStatus.textContent = `${errCode}${errDetail ? ' — ' + String(errDetail).slice(0, 120) : ''}`;
          }
          console.error('[Upload OM] failed', resp);
          fileInput.disabled = false;
        }
      } catch (err) {
        if (uploadStatus) {
          uploadStatus.style.color = 'var(--red, #dc2626)';
          uploadStatus.textContent = `Upload error: ${err.message || err}`;
        }
        fileInput.disabled = false;
      }
    });
  }
}

// ── Related LCC data (leases, ownership, tasks) ────────────────────────────

function renderRelatedLccData(responseData, lccEntity) {
  let html = '';
  const govData = responseData.gov_data || {};

  const leases = govData.gsa_leases || [];
  if (leases.length) {
    html += '<div class="section-label">Lease Details</div>';
    const lease = leases[0];
    if (lease.tenant || lease.agency) {
      html += `<div class="context-field"><span class="context-label">Tenant</span><span class="context-value">${escapeHtml(lease.tenant || lease.agency)}</span></div>`;
    }
    if (lease.lease_expiration || lease.expiration_date) {
      html += `<div class="context-field"><span class="context-label">Lease Expires</span><span class="context-value">${formatDate(lease.lease_expiration || lease.expiration_date)}</span></div>`;
    }
    if (lease.annual_rent) {
      html += `<div class="context-field"><span class="context-label">Annual Rent</span><span class="context-value">$${Number(lease.annual_rent).toLocaleString()}</span></div>`;
    }
  }

  const ownership = govData.ownership_history || [];
  if (ownership.length) {
    html += '<div class="section-label">Ownership</div>';
    const latest = ownership[0];
    html += `<div class="context-field"><span class="context-label">Owner</span><span class="context-value">${escapeHtml(latest.owner_name || latest.grantee || '—')}</span></div>`;
    if (latest.entity_type || latest.owner_type) {
      html += `<div class="context-field"><span class="context-label">Entity Type</span><span class="context-value">${escapeHtml(latest.entity_type || latest.owner_type)}</span></div>`;
    }
  }

  const tasks = (responseData.active_tasks || []).slice(0, 5);
  if (tasks.length) {
    html += '<div class="section-label">Active Tasks</div>';
    tasks.forEach((task) => {
      html += `<div class="related-entity">
        <div><span style="font-weight:600;">${escapeHtml(task.title || '')}</span>
        <div class="related-type">${escapeHtml(task.status || '')}</div></div>
      </div>`;
    });
  }

  if (lccEntity.research_status) {
    html += `<div class="context-field" style="margin-top:8px;"><span class="context-label">Research Status</span><span class="context-value">${escapeHtml(lccEntity.research_status)}</span></div>`;
  }

  return html;
}

// ── Contacts display ────────────────────────────────────────────────────────

function renderTenants(tenants, ctx) {
  if (!tenants.length) return '';
  let html = '<div class="section-label">Tenants</div>';

  // Show tenancy summary fields if available
  const summaryFields = [];
  if (ctx?.tenancy_type) summaryFields.push(`Tenancy: ${ctx.tenancy_type}`);
  if (ctx?.owner_occupied) summaryFields.push(`Owner Occupied: ${ctx.owner_occupied}`);
  if (ctx?.est_rent) summaryFields.push(`Est. Rent: ${ctx.est_rent}`);
  if (ctx?.lease_type) summaryFields.push(`Lease Type: ${ctx.lease_type}`);
  if (ctx?.lease_term) summaryFields.push(`Term: ${ctx.lease_term}`);
  if (ctx?.lease_expiration) summaryFields.push(`Expires: ${ctx.lease_expiration}`);
  if (ctx?.annual_rent) summaryFields.push(`Annual Rent: ${ctx.annual_rent}`);
  if (ctx?.rent_per_sf) summaryFields.push(`Rent/SF: ${ctx.rent_per_sf}`);
  if (summaryFields.length) {
    html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;">${summaryFields.map((f) => escapeHtml(f)).join(' · ')}</div>`;
  }

  for (const t of tenants) {
    html += '<div class="contact-card">';
    html += `<div class="contact-name">${escapeHtml(t.name || '')}</div>`;
    const details = [];
    if (t.sf) details.push(t.sf);
    if (t.location) details.push(t.location);
    if (t.lease_type) details.push(t.lease_type);
    if (t.rent_per_sf) details.push(`${t.rent_per_sf}/SF`);
    if (t.lease_start && t.lease_expiration) details.push(`${t.lease_start} — ${t.lease_expiration}`);
    else if (t.lease_expiration) details.push(`Exp: ${t.lease_expiration}`);
    if (details.length) {
      html += `<div class="contact-detail">${details.map((d) => escapeHtml(d)).join(' · ')}</div>`;
    }
    html += '</div>';
  }
  return html;
}

function renderContacts(contacts) {
  if (!contacts.length) return '';
  const roleLabels = {
    listing_broker: 'Listing Broker',
    buyer_broker: 'Buyer Broker',
    seller: 'Seller',
    buyer: 'Buyer',
    lender: 'Lender',
    owner: 'Current Owner',
  };

  let html = '<div class="section-label">Contacts</div>';
  for (const c of contacts) {
    html += '<div class="contact-card">';
    html += `<div class="contact-role">${escapeHtml(roleLabels[c.role] || c.role || '')}</div>`;
    html += `<div class="contact-name">${escapeHtml(c.name || '')}</div>`;
    if (c.ownership_type) html += `<div class="contact-detail">${escapeHtml(c.ownership_type)}</div>`;
    if (c.title) html += `<div class="contact-detail">${escapeHtml(c.title)}</div>`;
    if (c.company) html += `<div class="contact-detail">${escapeHtml(c.company)}</div>`;
    if (c.address) html += `<div class="contact-detail" style="color:var(--text-secondary);">${escapeHtml(c.address)}</div>`;
    if (c.email) html += `<div class="contact-detail"><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></div>`;
    if (c.phones && c.phones.length) {
      html += `<div class="contact-detail">${c.phones.map((p) => escapeHtml(p)).join(' &middot; ')}</div>`;
    }
    if (c.website) html += `<div class="contact-detail" style="color:var(--text-secondary);font-size:10px;">${escapeHtml(c.website)}</div>`;
    html += '</div>';
  }
  return html;
}

// ── Sales history display ───────────────────────────────────────────────────

function classifySale(sale, ctx) {
  // Infer sale classification from available data
  const tags = [];
  const yearBuilt = parseInt(ctx?.year_built);
  const saleYear = parseSaleYear(sale.sale_date);

  if (yearBuilt && saleYear && saleYear < yearBuilt) {
    tags.push('Pre-development (land sale)');
  }
  if (sale.transaction_type === 'Construction Loan' || /construction/i.test(sale.loan_type || '')) {
    tags.push('Construction financing');
  }
  if (sale.sale_price && sale.sale_price !== 'Not Disclosed') {
    const price = parseFloat(sale.sale_price.replace(/[$,]/g, ''));
    const sqft = parseFloat((ctx?.square_footage || '').replace(/[^0-9.]/g, ''));
    if (price && sqft && price / sqft < 50 && yearBuilt && saleYear && saleYear < yearBuilt) {
      tags.push('Likely vacant land');
    }
  }
  return tags;
}

function parseSaleYear(dateStr) {
  if (!dateStr) return null;
  // "2/28/2019" or "Mar 27, 2026"
  const m = dateStr.match(/\d{4}/);
  return m ? parseInt(m[0]) : null;
}

/**
 * Render the cap-rate line for a single sale when the LCC dialysis pipeline
 * has computed a calculated_cap_rate for it. Returns null when nothing has
 * been computed yet and the caller should fall through to the plain
 * "Cap: X%" details-line rendering.
 */
function renderSaleCapRateInline(sale) {
  const stated     = sale.stated_cap_rate ?? null;
  const calculated = sale.calculated_cap_rate ?? null;
  const confidence = sale.cap_rate_confidence || null;
  const rentSource = sale.rent_source || null;

  // No provenance info at all → let the classic "Cap: 7.15%" detail render.
  if (!calculated && !confidence) return null;

  const statedPct     = formatCapPct(stated ?? sale.cap_rate);
  const calculatedPct = formatCapPct(calculated);

  let sourceLabel = 'CoStar stated';
  if (confidence === 'high' || rentSource === 'projected_from_lease_confirmed') {
    sourceLabel = 'lease confirmed';
  } else if (confidence === 'medium' || rentSource === 'projected_from_om_confirmed') {
    sourceLabel = 'projected from OM';
  }

  if (calculatedPct) {
    const lock = confidence === 'high' ? '\uD83D\uDD12 ' : '';
    const check = '\u2713';
    return `<div class="sale-detail">
      <span style="color:var(--text);">CoStar stated: ${escapeHtml(statedPct || '—')}</span>
      &middot;
      <span style="color:#4ade80;font-weight:600">Calculated: ${escapeHtml(calculatedPct)}</span>
      <span style="color:#4ade80;margin-left:4px">${check} ${lock}${escapeHtml(confidence || 'medium')} confidence (${escapeHtml(sourceLabel)})</span>
    </div>`;
  }

  // Provenance says "low" but no calculation done yet.
  const warn = '\u26A0';
  return `<div class="sale-detail">
    <span style="color:#fbbf24">CoStar: ${escapeHtml(statedPct || '—')}</span>
    <span style="color:#fbbf24;margin-left:4px">${warn} low confidence (${escapeHtml(sourceLabel)})</span>
  </div>`;
}

function renderSalesHistory(sales, ctx) {
  if (!sales.length) return '';
  let html = '<div class="section-label">Sales History</div>';
  for (const s of sales) {
    const tags = classifySale(s, ctx);
    html += '<div class="sale-row">';
    html += '<div class="sale-row-header">';
    html += `<span class="sale-date">${escapeHtml(s.sale_date || '—')}</span>`;
    html += `<span class="sale-price">${escapeHtml(s.sale_price || s.asking_price || '—')}</span>`;
    html += '</div>';

    // Classification tags (land sale, construction, etc.)
    if (tags.length) {
      html += `<div style="margin:2px 0;"><span style="background:#FEF3C7;color:#92400E;font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;">${tags.map((t) => escapeHtml(t)).join(' · ')}</span></div>`;
    }

    // Transaction details line — cap rate uses the three-state display when
    // the LCC dialysis pipeline has filled in calculated_cap_rate and
    // cap_rate_confidence on this sale. Otherwise fall back to the flat
    // CoStar-stated value.
    const details = [];
    const saleCapRateHtml = renderSaleCapRateInline(s);
    if (saleCapRateHtml) {
      // Detail lines get rendered below via join — drop the cap rate in as a
      // pre-rendered HTML fragment to avoid stomping the per-cell styling.
    } else if (s.cap_rate) {
      details.push(`Cap: ${s.cap_rate}`);
    }
    if (s.sale_type) details.push(s.sale_type);
    if (s.sale_condition) details.push(s.sale_condition);
    if (s.transaction_type) details.push(s.transaction_type);
    if (s.deed_type) details.push(s.deed_type);
    if (s.hold_period) details.push(`Hold: ${s.hold_period}`);
    if (saleCapRateHtml) {
      html += saleCapRateHtml;
    }
    if (details.length) {
      html += `<div class="sale-detail">${details.map((d) => escapeHtml(d)).join(' &middot; ')}</div>`;
    }

    // Buyer/Seller with addresses
    if (s.seller) {
      html += `<div class="sale-detail"><strong>Seller:</strong> ${escapeHtml(s.seller)}${s.seller_address ? ` — ${escapeHtml(s.seller_address)}` : ''}</div>`;
    }
    if (s.buyer) {
      html += `<div class="sale-detail"><strong>Buyer:</strong> ${escapeHtml(s.buyer)}${s.buyer_address ? ` — ${escapeHtml(s.buyer_address)}` : ''}</div>`;
    }

    // Lender/Loan
    if (s.lender || s.loan_amount) {
      // Round 76eo (2026-05-09): defensive strip of "($X.Xm approx)" tail
      // from the lender display. Pre-Round-76em RCA captures stored the
      // raw "Old National Bank ($94.2m approx)" string; subsequent clean
      // captures couldn't overwrite it because background.js sales merge
      // (lines 450-454) preserves existing non-null fields. Strip at
      // render time so cached state shows the clean version regardless.
      const cleanLender = s.lender
        ? String(s.lender).replace(/\s*\(\s*\$[\d,.]+\s*[mkb]?\s*(?:approx)?\s*\)\s*$/i, '').trim()
        : '';
      let lenderLine = cleanLender ? `<strong>Lender:</strong> ${escapeHtml(cleanLender)}` : '<strong>Loan:</strong>';
      // Format loan_amount as currency when it's a number
      const formattedAmount = typeof s.loan_amount === 'number'
        ? '$' + Math.round(s.loan_amount).toLocaleString()
        : s.loan_amount;
      if (formattedAmount) lenderLine += ` — ${escapeHtml(String(formattedAmount))}`;
      if (s.loan_type) lenderLine += ` (${escapeHtml(s.loan_type)})`;
      if (s.interest_rate) lenderLine += ` @ ${escapeHtml(s.interest_rate)}`;
      if (s.loan_origination_date) lenderLine += ` — originated ${escapeHtml(s.loan_origination_date)}`;
      if (s.maturity_date) lenderLine += `, matures ${escapeHtml(s.maturity_date)}`;
      if (s.lender_address) lenderLine += `<br><span style="color:var(--text-secondary);font-size:10px;">${escapeHtml(s.lender_address)}</span>`;
      html += `<div class="sale-detail">${lenderLine}</div>`;
    }

    // Title company & document
    if (s.title_company) html += `<div class="sale-detail" style="color:var(--text-secondary);">Title: ${escapeHtml(s.title_company)}</div>`;
    if (s.document_number) html += `<div class="sale-detail" style="color:var(--text-secondary);">Doc #${escapeHtml(s.document_number)}</div>`;

    html += '</div>';
  }
  return html;
}

// ── Sale notes display ─────────────────────────────────────────────────────

function renderSaleNotes(raw) {
  if (!raw || !raw.trim()) return '';
  let html = '<div class="section-label">Sale Notes</div>';
  html += '<div style="background:var(--bg-secondary,#f8f8f8);border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:11px;line-height:1.5;color:var(--text-primary,#333);white-space:pre-wrap;word-break:break-word;">';
  html += escapeHtml(raw);
  html += '</div>';

  // Extract key financial metrics from the notes
  const extracts = [];
  const noiMatch = raw.match(/NOI\s*(?:of\s*)?\$?([\d,]+(?:\.\d+)?(?:\s*(?:M|K|million|thousand))?)/i);
  if (noiMatch) extracts.push({ label: 'NOI', value: noiMatch[1].trim() });

  const capMatch = raw.match(/cap\s*(?:rate)?\s*(?:of\s*)?([\d.]+)\s*%/i);
  if (capMatch) extracts.push({ label: 'Cap Rate', value: capMatch[1] + '%' });

  const rentMatch = raw.match(/(?:annual|yearly|base)\s*rent\s*(?:of\s*)?\$?([\d,]+(?:\.\d+)?(?:\s*(?:M|K|million|thousand))?)/i);
  if (rentMatch) extracts.push({ label: 'Rent', value: '$' + rentMatch[1].trim() });

  const leaseMatch = raw.match(/(?:lease\s*(?:term|expir(?:es|ation|y)))\s*(?:of\s*|:?\s*|in\s*)?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}|\d+\s*(?:year|yr)s?)/i);
  if (leaseMatch) extracts.push({ label: 'Lease', value: leaseMatch[1].trim() });

  const occupancyMatch = raw.match(/([\d.]+)\s*%\s*(?:occupied|occupancy|leased)/i);
  if (occupancyMatch) extracts.push({ label: 'Occupancy', value: occupancyMatch[1] + '%' });

  if (extracts.length) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">';
    for (const e of extracts) {
      html += `<span style="background:#EFF6FF;color:#1E40AF;font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;">${escapeHtml(e.label)}: ${escapeHtml(e.value)}</span>`;
    }
    html += '</div>';
  }
  return html;
}

// ── Document links display ──────────────────────────────────────────────────

const DOC_TYPE_ICONS = {
  deed: 'D', om: 'OM', brochure: 'B', lease: 'L', survey: 'S', other: '?',
};

function renderDocuments(docs) {
  if (!docs || !docs.length) return '';
  let html = '<div class="section-label">Documents</div>';
  for (const doc of docs) {
    const icon = DOC_TYPE_ICONS[doc.type] || '?';
    const name = escapeHtml(doc.label || doc.url || 'Untitled');
    const statusClass = 'captured';
    const statusLabel = 'URL Captured';
    html += '<div class="doc-card">';
    html += '<div class="doc-card-header">';
    html += `<span class="doc-type-icon">${escapeHtml(icon)}</span>`;
    html += `<span class="doc-name" title="${escapeHtml(doc.label || '')}">${name}</span>`;
    html += `<span class="doc-status ${statusClass}">${statusLabel}</span>`;
    html += '</div>';
    html += '<div class="doc-actions">';
    if (doc.url) {
      html += `<button class="btn btn-sm btn-secondary doc-open-btn" data-url="${escapeHtml(doc.url)}">Open</button>`;
    }
    html += `<button class="btn btn-sm btn-confirm doc-ingest-btn" data-url="${escapeHtml(doc.url || '')}">Ingest</button>`;
    html += `<button class="btn btn-sm btn-primary doc-stage-btn" data-url="${escapeHtml(doc.url || '')}" data-label="${escapeHtml(doc.label || '')}" title="Stage this OM into LCC intake">Stage to LCC</button>`;
    html += '</div>';
    html += '</div>';
  }
  return html;
}

// ── SOS-direct lookup: demand-driven LLC-research workhorse ──────────────────
// The "active research target" is the owner the broker chose from the LLC
// research queue. It's stashed in storage so that, after they navigate to the
// state SOS page and Scan it, the org view knows which recorded_owner +
// queue row the captured filing should be written back to.

function setActiveLlcResearch(target) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ lcc_active_llc_research: target || null }, resolve);
  });
}
function getActiveLlcResearch() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['lcc_active_llc_research'], (r) => resolve(r.lcc_active_llc_research || null));
  });
}

// ── Rapid click-through SOS worklist (Unit 1) ────────────────────────────────
// The operator batches ONE state (SOS site) at a time; within a state, highest
// deal value first (server-ranked). No per-state deep-link — finding the SOS
// search is trivial; the broker keeps their own SOS tab open. Each owner card
// offers "📋 Copy name" (copies the entity name + marks it the active capture
// target) and "✕ Not in <ST>" (records the negative result). After a Save
// (ingest) or a Not-registered disposition the list advances to the next owner
// WITHOUT a refetch, so a not-found-but-still-workable owner isn't re-surfaced
// under its other candidate state.
let _sosWorklist = null; // { domain, state, items:[], done:Set, byState:[], totalEligible:0 }

function _sosItemByQid(qid) {
  return _sosWorklist ? _sosWorklist.items.find((it) => it.queue_id === qid) : null;
}

// Mark this owner the active capture target so a subsequent Scan → SOS→Owner
// write-back (and the org-view form) targets the right owner.
function _sosSetActiveTarget(item) {
  if (!item) return;
  return setActiveLlcResearch({
    queue_id: item.queue_id,
    recorded_owner_id: item.recorded_owner_id || null,
    search_name: item.search_name || '',
    filing_state: item._states?.[0] || '',
    asset_state: item._states?.[1] || '',
    domain: _sosWorklist ? _sosWorklist.domain : (item.domain || 'government'),
  });
}

async function _sosCopyToClipboard(text) {
  try { await navigator.clipboard.writeText(text || ''); return true; }
  catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text || '';
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (_e) { return false; }
  }
}

function _sosToast(msg) {
  const host = $('#propertyBody');
  if (!host) return;
  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.textContent = msg;
  host.prepend(toast);
  setTimeout(() => toast.remove(), 5000);
}

// The running extension build (manifest version), stamped onto every SOS capture
// payload so the writeback provenance records which sidebar build produced it.
function _extVersion() {
  try { return chrome.runtime.getManifest().version || null; } catch { return null; }
}

// Mark an owner handled and re-render from the in-memory list (no refetch, so a
// still-workable owner isn't re-surfaced), surfacing the next owner as active.
function _sosAdvance(queueId) {
  if (!_sosWorklist) return false;
  _sosWorklist.done.add(queueId);
  _renderWorklistFromState();
  return true;
}

async function _sosDispositionNotFound(target, btn) {
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Recording…'; }
  const result = await apiCall('/api/sos-writeback', {
    domain: target.domain,
    recorded_owner_id: target.recorded_owner_id,
    queue_id: target.queue_id,
    outcome: 'not_found',
    searched_state: target.state || null,
    ext_version: _extVersion(),            // which extension build made this disposition (audit)
  });
  if (!result.ok) {
    if (btn) { btn.disabled = false; btn.textContent = orig || '✕ Not registered'; btn.classList.add('btn-danger'); }
    _sosToast(toErrorMessage(result.error) || toErrorMessage(result.data?.error) || 'Disposition failed');
    return false;
  }
  const rem = Array.isArray(result.data?.remaining_states) ? result.data.remaining_states.filter(Boolean) : [];
  _sosToast(result.data?.exhausted
    ? 'Not registered — sent back for further processing'
    : `Not registered in ${target.state || 'searched state'} — still open in ${rem.join(', ') || 'another state'}`);
  return true;
}

// Render the state-sorted SOS worklist into the Property tab. Fetches once, then
// re-renders from in-memory state on each advance.
async function renderLlcResearchQueue(domain, stateFilter) {
  const dom = (domain === 'government' || domain === 'dialysis') ? domain : 'government';
  const st = stateFilter ? String(stateFilter).toUpperCase() : null;  // 'NONE' = unknown-state bucket
  const header = $('#propertyHeader');
  const body = $('#propertyBody');

  header.innerHTML = `<div class="property-title">SOS Research Worklist</div>
    <div class="property-source">${dom === 'government' ? 'Government' : 'Dialysis'} · by state · ranked by deal value</div>`;
  body.innerHTML = '<div class="loading"><div class="spinner"></div><br>Loading worklist…</div>';

  const stateQs = st ? `&state=${encodeURIComponent(st)}` : '';
  const result = await apiCall(`/api/admin?_route=llc-research-queue&domain=${dom}&limit=25${stateQs}`, null, 'GET');
  if (!result.ok) {
    body.innerHTML = `<div class="error-state">${escapeHtml(toErrorMessage(result.error) || toErrorMessage(result.data?.error) || 'Failed to load worklist')}</div>`;
    return;
  }
  const items = (result.data?.items || []).map((it) => {
    const filing = it.filing_state ? String(it.filing_state).toUpperCase() : '';
    const asset = it.asset_state ? String(it.asset_state).toUpperCase() : '';
    const states = [];
    if (filing) states.push(filing);
    if (asset && asset !== filing) states.push(asset);
    return { ...it, _states: states };
  });
  _sosWorklist = {
    domain: dom,
    state: st,
    items,
    done: new Set(),
    byState: Array.isArray(result.data?.by_state) ? result.data.by_state : [],
    totalEligible: Number(result.data?.total_eligible) || 0,
  };
  _renderWorklistFromState();
}

// Re-render the whole worklist frame from the in-memory _sosWorklist (header
// actions + state picker + owner cards). Called by renderLlcResearchQueue and by
// _sosAdvance (no refetch) and after returning from the org-view capture step.
function _renderWorklistFromState() {
  const wl = _sosWorklist;
  if (!wl) return;
  const dom = wl.domain, st = wl.state;
  const body = $('#propertyBody');
  const actions = $('#propertyActions');

  $('#propertyHeader').innerHTML = `<div class="property-title">SOS Research Worklist</div>
    <div class="property-source">${dom === 'government' ? 'Government' : 'Dialysis'} · by state · ranked by deal value</div>`;

  // Persistent scan entry point — lives in the actions bar (NOT the scrolling
  // card list) so it never scrolls above the fold as the operator works owners.
  // The active browser tab IS the SOS record the operator navigated to
  // (independent of which owner card is highlighted), so this is a single
  // worklist-level button. Reuses the same SCAN_PAGE trigger (wireScanButton,
  // wired below): the scan result flows through loadOrgView → the editable
  // capture form pre-filled with the active worklist owner as the save target.
  actions.innerHTML = `
    <button class="btn btn-sm btn-primary" id="scanPageBtn" style="width:100%;">⎙ Scan this SOS page</button>
    <div style="font-size:10px;color:var(--text-secondary);margin:4px 0 8px;">Open the owner's record on your SOS site, then Scan to capture agent / principal address / officers.</div>
    <button class="btn btn-sm" id="llcQGov">Government</button>
    <button class="btn btn-sm" id="llcQDia" style="margin-left:6px;">Dialysis</button>
    <button class="btn btn-sm btn-primary" id="llcQBack" style="margin-left:6px;">← Back</button>`;
  $('#llcQGov')?.addEventListener('click', () => renderLlcResearchQueue('government'));
  $('#llcQDia')?.addEventListener('click', () => renderLlcResearchQueue('dialysis'));
  $('#llcQBack')?.addEventListener('click', () => { _sosWorklist = null; loadPropertyTab(); });
  // Wire the persistent "Scan this SOS page" button here so it works from BOTH
  // the empty-state and the remaining-owners render paths. On a scan the result
  // flows CONTEXT_DETECTED → loadPropertyTab → loadOrgView (the editable capture
  // form) with the active worklist owner as the save target.
  wireScanButton();

  // State picker — highest count first. '(unknown)' maps to the NONE bucket.
  let pickerHtml = '';
  if (wl.byState.length) {
    const stLabel = st ? (st === 'NONE' ? 'Unknown state' : st) : 'All states';
    pickerHtml = `<div class="section-label">SOS worklist — ${escapeHtml(stLabel)} · ${wl.totalEligible.toLocaleString()} owners awaiting SOS</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">`;
    pickerHtml += `<button class="btn btn-sm llc-state-chip ${!st ? 'btn-primary' : ''}" data-state="">All (${wl.totalEligible.toLocaleString()})</button>`;
    for (const s of wl.byState) {
      const chipState = s.state === '(unknown)' ? 'NONE' : s.state;
      const label = s.state === '(unknown)' ? 'Unknown' : s.state;
      const isActive = st && st === chipState;
      pickerHtml += `<button class="btn btn-sm llc-state-chip ${isActive ? 'btn-primary' : ''}"
        data-state="${escapeHtml(chipState)}">${escapeHtml(label)} (${Number(s.count).toLocaleString()})</button>`;
    }
    pickerHtml += '</div>';
  }

  const remaining = wl.items.filter((it) => !wl.done.has(it.queue_id));
  if (!remaining.length) {
    body.innerHTML = pickerHtml + `<div class="empty-state">${wl.items.length ? '✓ Worked every owner in this list.' : 'No owners awaiting SOS research in this state.'}<br><br>
      <button class="btn btn-sm btn-primary" id="sosReloadBtn" style="margin-top:6px;">↻ Reload / next batch</button></div>`;
    body.querySelectorAll('.llc-state-chip').forEach((chip) =>
      chip.addEventListener('click', () => renderLlcResearchQueue(dom, chip.dataset.state || null)));
    $('#sosReloadBtn')?.addEventListener('click', () => renderLlcResearchQueue(dom, st));
    setActiveLlcResearch(null);
    return;
  }

  // The FIRST remaining owner is the active capture target (ready to copy).
  _sosSetActiveTarget(remaining[0]);

  let html = pickerHtml + '<div class="section-label">Copy the name ▸ paste into your SOS search ▸ Scan the record — or dispose it.</div>';
  remaining.forEach((it, idx) => {
    const isActive = idx === 0;
    const loc = [it.property_city, it.property_state].filter(Boolean).join(', ');
    const val = it.rev_value ? '$' + Math.round(it.rev_value).toLocaleString() : '';
    const stateLabel = it._states.length ? it._states.join(' · ') : 'state unknown';
    const nfBtns = (it._states.length ? it._states : ['']).map((s) =>
      `<button class="btn btn-sm sos-nf-btn" style="margin-right:4px;margin-bottom:4px;"
        data-qid="${it.queue_id}" data-oid="${escapeHtml(it.recorded_owner_id || '')}"
        data-state="${escapeHtml(s)}" data-domain="${dom}">✕ Not in ${escapeHtml(s || '—')}</button>`).join('');
    html += `<div class="context-field sos-owner-card" data-qid="${it.queue_id}" style="flex-direction:column;align-items:stretch;${isActive ? 'outline:2px solid var(--accent,#2e86de);border-radius:6px;padding:6px;' : ''}">
      <div><span class="context-value" style="font-weight:600;">${escapeHtml(it.search_name || '(unnamed)')}</span></div>
      <div style="font-size:11px;color:var(--text-secondary);">${escapeHtml(it.tenant || '')}${it.tenant && loc ? ' · ' : ''}${escapeHtml(loc)}${val ? ' · ' + val : ''} · ${escapeHtml(stateLabel)}</div>
      <div style="margin-top:6px;">
        <button class="btn btn-sm btn-primary sos-copy-btn" style="margin-right:4px;margin-bottom:4px;"
          data-qid="${it.queue_id}" data-name="${escapeHtml(it.search_name || '')}">📋 Copy name</button>
        ${nfBtns}
      </div>
    </div>`;
  });
  body.innerHTML = html;

  body.querySelectorAll('.llc-state-chip').forEach((chip) =>
    chip.addEventListener('click', () => renderLlcResearchQueue(dom, chip.dataset.state || null)));

  body.querySelectorAll('.sos-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = _sosItemByQid(Number(btn.dataset.qid));
      if (item) _sosSetActiveTarget(item);
      const ok = await _sosCopyToClipboard(btn.dataset.name || '');
      // Highlight this card as the active target.
      body.querySelectorAll('.sos-owner-card').forEach((c) => { c.style.outline = ''; c.style.padding = ''; });
      const card = btn.closest('.sos-owner-card');
      if (card) { card.style.outline = '2px solid var(--accent,#2e86de)'; card.style.borderRadius = '6px'; card.style.padding = '6px'; }
      btn.textContent = ok ? '✓ Copied — paste + Scan' : 'Copy failed';
      btn.classList.remove('btn-primary'); btn.classList.add('btn-success');
      setTimeout(() => { btn.textContent = '📋 Copy name'; btn.classList.add('btn-primary'); btn.classList.remove('btn-success'); }, 2500);
    });
  });

  body.querySelectorAll('.sos-nf-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = {
        queue_id: Number(btn.dataset.qid),
        recorded_owner_id: btn.dataset.oid || null,
        state: btn.dataset.state || '',
        domain: btn.dataset.domain || dom,
      };
      const ok = await _sosDispositionNotFound(target, btn);
      if (ok) _sosAdvance(target.queue_id);
    });
  });
}

// ── Organization view (SOS / business entity lookups) ───────────────────────

// Renders the SOS entity as an EDITABLE capture form (Unit 3). Auto-grab pre-
// fills each field from the scanner; the operator confirms/corrects (or types on
// a scan miss — the form works on ANY state's SOS). Save posts the confirmed
// fields to /api/sos-writeback and auto-advances the worklist. When there's no
// active research target it falls back to the generic Save-to-LCC path.
async function loadOrgView(source, domainLabel) {
  const header = $('#propertyHeader');
  const body = $('#propertyBody');
  const actions = $('#propertyActions');

  const siteType = source.site_type || 'business-search';
  const target = await getActiveLlcResearch();
  const hasTarget = !!(target && target.recorded_owner_id);
  // Fall back to the worklist's active owner name when the SOS page title wasn't
  // captured (the bizfile parser never pulls a name from the results grid, so it
  // leaves `name` blank rather than guess). The editable field stays correctable.
  if (!source.name && hasTarget && target.search_name) source.name = target.search_name;
  const name = source.name || 'Unknown Entity';

  header.innerHTML = `
    <div class="property-title">${escapeHtml(name)}</div>
    <div class="property-source">${domainBadge(source.domain)} ${escapeHtml(domainLabel)} (${escapeHtml(siteType)})</div>
  `;

  const banner = hasTarget
    ? `<div class="section-label">Capturing for: <span style="font-weight:600;">${escapeHtml(target.search_name || 'owner')}</span></div>`
    : `<div class="section-label">Review the captured fields, then Save.</div>
       <div style="font-size:10px;color:var(--text-secondary);margin-bottom:6px;">Tip: open an owner from the Worklist first so Save writes back to the right owner.</div>`;

  // Editable form — pre-filled where the scan succeeded, blank+editable otherwise.
  const fieldHtml = SOS_CAPTURE_FIELDS.map(([key, label, multiline]) => {
    const val = escapeHtml(source[key] || '');
    const input = multiline
      ? `<textarea id="sosf_${key}" rows="2" class="sos-capture-input" style="width:100%;box-sizing:border-box;">${val}</textarea>`
      : `<input id="sosf_${key}" type="text" class="sos-capture-input" value="${val}" style="width:100%;box-sizing:border-box;" />`;
    return `<div style="margin-bottom:6px;">
      <label style="display:block;font-size:10px;color:var(--text-secondary);margin-bottom:2px;">${escapeHtml(label)}</label>
      ${input}
    </div>`;
  }).join('');

  body.innerHTML = banner + '<div class="section-label">SOS Entity Details (editable)</div>' + fieldHtml;

  // Not-registered buttons (per candidate state) when a target is active — the
  // operator may realise on the SOS page that this isn't the right registration.
  const nfStates = hasTarget
    ? Array.from(new Set([target.filing_state, target.asset_state].map((s) => (s ? String(s).toUpperCase() : '')).filter(Boolean)))
    : [];
  const nfBtns = hasTarget
    ? (nfStates.length ? nfStates : ['']).map((s) =>
        `<button class="btn btn-sm sos-org-nf-btn" style="margin-left:6px;" data-state="${escapeHtml(s)}">✕ Not in ${escapeHtml(s || '—')}</button>`).join('')
    : '';

  actions.innerHTML = `
    <button class="btn btn-sm btn-success" id="saveSosOwnerBtn">SOS → Owner</button>
    <button class="btn btn-sm" id="sosCopyNameBtn" style="margin-left:6px;">📋 Copy name</button>
    ${nfBtns}
    <button class="btn btn-sm btn-primary" id="llcQueueBtn" style="margin-left:6px;">← Worklist</button>
    ${hasTarget ? '' : '<button class="btn btn-sm" id="searchOrgBtn" style="margin-left:6px;">Search in LCC</button><button class="btn btn-sm" id="saveOrgBtn" style="margin-left:6px;">Save to LCC</button>'}
  `;

  $('#llcQueueBtn')?.addEventListener('click', () => {
    if (_sosWorklist) _renderWorklistFromState();
    else renderLlcResearchQueue(source.domain === 'dialysis' ? 'dialysis' : 'government');
  });

  $('#sosCopyNameBtn')?.addEventListener('click', async () => {
    const nm = (hasTarget && target.search_name) || ($('#sosf_name')?.value) || name;
    const ok = await _sosCopyToClipboard(nm);
    const b = $('#sosCopyNameBtn');
    if (b) { b.textContent = ok ? '✓ Copied' : 'Copy failed'; setTimeout(() => { b.textContent = '📋 Copy name'; }, 2000); }
  });

  document.querySelectorAll('.sos-org-nf-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!hasTarget) return;
      const ok = await _sosDispositionNotFound({
        queue_id: target.queue_id,
        recorded_owner_id: target.recorded_owner_id,
        state: btn.dataset.state || '',
        domain: target.domain,
      }, btn);
      if (ok) {
        await setActiveLlcResearch(null);
        if (_sosWorklist) _sosAdvance(target.queue_id);
        else renderLlcResearchQueue(target.domain);
      }
    });
  });

  // SOS → Owner: collect the EDITED form fields and write back, then advance.
  const sosBtn = $('#saveSosOwnerBtn');
  if (sosBtn) {
    sosBtn.addEventListener('click', async () => {
      if (!hasTarget) {
        _sosToast('Open the owner from the Worklist first so I know which owner to save to.');
        return;
      }
      const capture = {};
      for (const [key] of SOS_CAPTURE_FIELDS) {
        const el = $('#sosf_' + key);
        const v = el && typeof el.value === 'string' ? el.value.trim() : '';
        if (v) capture[key] = v;
      }
      if (!Object.keys(capture).length) {
        _sosToast('Nothing to save — fill in at least one field.');
        return;
      }
      sosBtn.disabled = true;
      sosBtn.textContent = 'Saving…';
      const result = await apiCall('/api/sos-writeback', {
        domain: target.domain,
        recorded_owner_id: target.recorded_owner_id,
        queue_id: target.queue_id,
        source_url: source.page_url || null,   // the SOS page — kept for audit/provenance
        ext_version: _extVersion(),            // which extension build made this capture (audit)
        capture,
      });
      if (result.ok) {
        sosBtn.className = 'btn btn-sm btn-success';
        const nObs = Number(result.data?.address_observations) || 0;
        sosBtn.textContent = `✓ Saved${nObs ? ` (+${nObs} address${nObs === 1 ? '' : 'es'})` : ''}`;
        await setActiveLlcResearch(null);   // consume the target
        // Auto-advance to the next owner in the worklist.
        if (_sosWorklist) setTimeout(() => _sosAdvance(target.queue_id), 700);
        else setTimeout(() => renderLlcResearchQueue(target.domain), 700);
      } else {
        sosBtn.disabled = false;
        sosBtn.textContent = 'SOS → Owner (retry)';
        sosBtn.className = 'btn btn-sm btn-danger';
        _sosToast(toErrorMessage(result.error) || toErrorMessage(result.data?.error) || `HTTP ${result.status || 'error'}`);
      }
    });
  }

  // Backward-compat (no active target): search + save-to-LCC.
  $('#searchOrgBtn')?.addEventListener('click', () => {
    $('#searchInput').value = name;
    switchTab('search');
    doSearch();
  });

  const saveBtn = $('#saveOrgBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      const result = await apiCall('/api/entities', {
        entity_type: 'organization',
        name,
        org_type: source.entity_type_detail || null,
        description: `Imported from ${source.domain || 'public-records'}`,
      });
      if (result.ok) {
        saveBtn.className = 'btn btn-sm btn-success';
        saveBtn.textContent = 'Saved!';
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Failed — Retry';
        saveBtn.className = 'btn btn-sm btn-danger';
        _sosToast(toErrorMessage(result.error) || toErrorMessage(result.data?.error) || toErrorMessage(result.data?.message) || `HTTP ${result.status || 'error'}`);
      }
    });
  }

  $('#lastUpdated').textContent = `Entity: ${new Date().toLocaleTimeString()}`;
}

// ── Scan This Page ──────────────────────────────────────────────────────────

// The SOS/county worklist targets an open-ended set of Secretary-of-State and
// county-assessor sites, so those hosts can't be a static manifest allow-list.
// `SCAN_PAGE` injects content/public-records.js via chrome.scripting.executeScript
// in the background, which needs a HOST permission for the active tab. `activeTab`
// does NOT cover a side-panel button click (it's only granted from the toolbar
// action, a context menu, or a keyboard command), so without this the injection
// throws "Cannot access contents of the page…" and the scan fails silently.
//
// Fix: request the broad `<all_urls>` optional host permission from the Scan
// click (a real user gesture — chrome.permissions.request REQUIRES one, and the
// side-panel click is the reliable gesture; the background message handler is
// not). The grant is one-time and persists across sessions, so every SOS/county
// page the operator later opens scans silently. Requested at runtime (not baked
// into the install) to keep the default permission footprint minimal.
async function ensureScanHostPermission() {
  const origins = ['<all_urls>'];
  try {
    if (await chrome.permissions.contains({ origins })) return { granted: true };
  } catch {
    // contains() can reject in some builds; fall through to request().
  }
  try {
    const granted = await chrome.permissions.request({ origins });
    return { granted };
  } catch (err) {
    return { granted: false, error: err?.message };
  }
}

function wireScanButton() {
  const scanBtn = $('#scanPageBtn');
  if (!scanBtn) return;

  scanBtn.addEventListener('click', async () => {
    // Acquire the host permission FIRST, inside this click gesture, before any
    // long async work — chrome.permissions.request needs the user gesture.
    const perm = await ensureScanHostPermission();
    if (!perm.granted) {
      scanBtn.textContent = 'Permission Denied';
      scanBtn.className = 'btn btn-sm btn-danger';
      _sosToast('Permission to read this page was denied. Click Scan again and choose "Allow" so the scanner can read the SOS record.');
      setTimeout(() => {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan This Page';
        scanBtn.className = 'btn btn-sm btn-primary';
      }, 2500);
      return;
    }

    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'SCAN_PAGE' }, resolve);
      });

      if (!response?.ok) {
        scanBtn.textContent = 'Scan Failed';
        scanBtn.className = 'btn btn-sm btn-danger';
        setTimeout(() => {
          scanBtn.disabled = false;
          scanBtn.textContent = 'Scan This Page';
          scanBtn.className = 'btn btn-sm btn-primary';
        }, 2000);
      }
      // If successful, the scanner will send CONTEXT_DETECTED → storage update
      // → storage listener will call loadPropertyTab() automatically
    } catch {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan This Page';
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2: SEARCH
// ══════════════════════════════════════════════════════════════════════════════

$('#searchBtn').addEventListener('click', doSearch);
$('#searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

async function doSearch() {
  const query = $('#searchInput').value.trim();
  if (!query) return;

  const container = $('#searchResults');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><br>Searching...</div>';

  const result = await apiCall('/api/chat', {
    copilot_action: 'search_entity_targets',
    params: { query },
  });

  if (!result.ok) {
    container.innerHTML = `<div class="error-state">${escapeHtml(result.error || 'Search failed')}</div>`;
    return;
  }

  const data = result.data;
  const entities = data?.entities || data?.data?.entities || data?.results || [];

  if (!entities.length) {
    container.innerHTML = '<div class="empty-state">No results found</div>';
    return;
  }

  let html = '';
  entities.forEach((entity) => {
    const type = entity.entity_type || 'unknown';
    html += `<div class="result-card" data-entity='${escapeHtml(JSON.stringify(entity))}'>`;

    if (type === 'person') {
      html += `<div class="result-name">${escapeHtml(entity.name || '')}${domainBadge(entity.domain)}</div>`;
      html += `<div class="result-meta">${escapeHtml([entity.title, entity.company || entity.org_name].filter(Boolean).join(' at '))}</div>`;
      if (entity.email) html += `<div class="result-meta">${escapeHtml(entity.email)}</div>`;
    } else if (type === 'asset') {
      html += `<div class="result-name">${escapeHtml(entity.address || entity.name || '')}${domainBadge(entity.domain)}</div>`;
      html += `<div class="result-meta">${escapeHtml([entity.city, entity.state].filter(Boolean).join(', '))} ${escapeHtml(entity.asset_type || '')}</div>`;
    } else {
      html += `<div class="result-name">${escapeHtml(entity.name || '')}${domainBadge(entity.domain)}</div>`;
      html += `<div class="result-meta">${escapeHtml(entity.org_type || entity.entity_type || '')}</div>`;
    }

    html += '</div>';
  });

  container.innerHTML = html;

  // Click handlers for result cards
  container.querySelectorAll('.result-card').forEach((card) => {
    card.addEventListener('click', () => {
      try {
        selectedEntity = JSON.parse(card.dataset.entity);
        switchTab('property');
      } catch {
        // Invalid entity data
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3: CHAT
// ══════════════════════════════════════════════════════════════════════════════

$('#chatSend').addEventListener('click', sendChat);
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});
$('#chatClear').addEventListener('click', clearChat);

async function sendChat() {
  const input = $('#chatInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  appendChatMessage('user', message);

  const action = routeMessage(message);

  const result = await apiCall('/api/chat', {
    copilot_action: action,
    message,
    history: chatHistory.slice(-8),
  });

  if (!result.ok) {
    appendChatMessage('assistant', result.error || 'Sorry, I could not process that request. Check your connection settings.');
    return;
  }

  const data = result.data;
  const reply = data?.response || data?.data?.response || data?.message || JSON.stringify(data, null, 2);
  appendChatMessage('assistant', reply);
}

function routeMessage(msg) {
  const lower = msg.toLowerCase();
  if (lower.includes('briefing') || lower.includes('morning') || lower.includes('today')) return 'get_daily_briefing_snapshot';
  if (lower.includes('search') || lower.includes('find') || lower.includes('look up')) return 'search_entity_targets';
  if (lower.includes('pipeline') || lower.includes('health') || lower.includes('bottleneck')) return 'get_pipeline_intelligence';
  if (lower.includes('queue') || lower.includes('task') || lower.includes('execution')) return 'get_my_execution_queue';
  if (lower.includes('inbox') || lower.includes('triage')) return 'list_staged_intake_inbox';
  if (lower.includes('contact') || lower.includes('call') || lower.includes('outreach')) return 'get_hot_business_contacts';
  if (lower.includes('sync') || lower.includes('connector')) return 'get_sync_run_health';
  return 'chat';
}

function appendChatMessage(role, text) {
  const container = $('#chatMessages');

  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();

  chatHistory.push({ role, content: text });

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg ${role}`;
  msgDiv.innerHTML = `<div class="chat-bubble">${escapeHtml(text)}</div>`;
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;

  chrome.storage.session.set({ chatHistory });
}

function clearChat() {
  chatHistory = [];
  const container = $('#chatMessages');
  container.innerHTML = '<div class="empty-state">Ask about this property or anything in your pipeline.</div>';
  chrome.storage.session.remove('chatHistory');
}

// Restore chat history on load
async function restoreChatHistory() {
  const stored = await chrome.storage.session.get(['chatHistory']);
  if (stored.chatHistory && stored.chatHistory.length) {
    chatHistory = stored.chatHistory;
    const container = $('#chatMessages');
    container.innerHTML = '';
    chatHistory.forEach((msg) => {
      const msgDiv = document.createElement('div');
      msgDiv.className = `chat-msg ${msg.role}`;
      msgDiv.innerHTML = `<div class="chat-bubble">${escapeHtml(msg.content)}</div>`;
      container.appendChild(msgDiv);
    });
    container.scrollTop = container.scrollHeight;
  }
}

// ── Storage listener for live context updates ───────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.pageContext) {
    updatePageContextBadge();
    // Skip re-render while OM ingest is writing to storage — the ingest
    // handler manages its own DOM state and a full re-render would wipe
    // out the extraction UI (spinner, metrics tags, extracted text preview).
    if (_suppressStorageRerender) return;
    if (currentTab === 'property') {
      loadPropertyTab();
    }
  }
});

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  const prefs = await chrome.storage.sync.get(['defaultTab']);
  if (prefs.defaultTab && prefs.defaultTab !== 'property') {
    switchTab(prefs.defaultTab);
  }

  requestAnimationFrame(async () => {
    await Promise.all([
      checkConnection(),
      updatePageContextBadge(),
      restoreChatHistory(),
    ]);

    if (currentTab === 'property') {
      loadPropertyTab();
    }
  });
}

init();
