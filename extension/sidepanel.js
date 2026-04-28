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
};

async function getLCCConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['LCC_RAILWAY_URL', 'LCC_API_KEY'], resolve);
  });
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
  ['tenant_name', 'Tenant', 'tenant_name'],
  ['owner_name', 'Owner', 'owner_name'],
  ['broker_name', 'Broker', 'broker_name'],
  ['broker_company', 'Brokerage', 'broker_company'],
  ['sale_price', 'Last Sale Price', 'sale_price'],
  ['sale_date', 'Last Sale Date', 'sale_date'],
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

async function loadPropertyTab() {
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
    </div>`;
    actions.innerHTML = '';
    wireScanButton();
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
  // Use the address-based lookup_asset endpoint (purpose-built for dedup
  // by address + city + state) instead of search_entity_targets, which
  // matches on entity name and is fragile against address formatting
  // differences and missing dedup signals.
  const lookupQuery = new URLSearchParams({ action: 'lookup_asset', address });
  if (city) lookupQuery.set('city', city);
  if (state) lookupQuery.set('state', state);
  const searchResult = await apiCall(`/api/entities?${lookupQuery.toString()}`, null, 'GET');

  const lccEntity = searchResult.ok ? (searchResult.data?.entity || null) : null;
  const matched = !!(lccEntity && lccEntity.id);

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

  // ── SECTION 1: Existing LCC data (shown first when matched) ───────
  if (matched) {
    html += '<div class="lcc-section">';
    html += '<div class="lcc-section-header">In LCC Database</div>';
    html += renderLccFields(lccEntity, responseData);
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

      btn.disabled = true;
      btn.textContent = 'Staging…';
      const toast = document.createElement('div');
      toast.className = 'update-toast';
      toast.textContent = 'Posting to LCC intake…';
      card.appendChild(toast);

      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const sourceUrl = tabs?.[0]?.url || url;
        const hostname = (() => { try { return new URL(sourceUrl).hostname; } catch { return null; } })();

        // Derive a real filename from the URL's last path segment (ignoring
        // querystring). The doc card's `label` is a display string like
        // "Marketing Brochure/Flyer" — not safe to use as a filename.
        const urlFileName = (() => {
          try {
            const u = new URL(url);
            const last = u.pathname.split('/').filter(Boolean).pop() || '';
            const decoded = decodeURIComponent(last);
            if (decoded && /\.(pdf|xlsx?|docx?)$/i.test(decoded)) return decoded;
          } catch {}
          return 'document.pdf';
        })();

        const resp = await chrome.runtime.sendMessage({
          type: 'STAGE_PDF_TO_LCC',
          url,
          fileName: urlFileName,
          sourceUrl,
          hostname,
          intent: `Staged from ${hostname || 'browser'}${label ? ` — ${label}` : ''}`,
        });

        if (resp?.ok && resp?.body?.ok) {
          const b = resp.body;
          btn.textContent = `✓ Staged (${b.extraction_status || 'received'})`;
          btn.style.background = 'var(--green)';
          btn.style.color = '#fff';
          toast.textContent = `Intake id: ${b.intake_id} — ${b.message || ''}`;
          setTimeout(() => toast.remove(), 8000);
        } else {
          const asString = (v) => {
            if (v == null) return '';
            if (typeof v === 'string') return v;
            try { return JSON.stringify(v); } catch { return String(v); }
          };
          const status = resp?.status ? `HTTP ${resp.status}` : '';
          const errCode = asString(resp?.body?.error || resp?.error || 'unknown');
          const errDetail = asString(resp?.body?.detail || resp?.body?.message || resp?.body || '');
          const contentType = resp?.contentType ? ` [${resp.contentType}]` : '';
          btn.textContent = 'Failed';
          btn.style.background = 'var(--red, #dc2626)';
          btn.style.color = '#fff';
          toast.textContent = `Stage failed: ${status} ${errCode}${contentType} — ${errDetail}`;
          toast.style.maxHeight = '160px';
          toast.style.overflow = 'auto';
          toast.style.fontSize = '10px';
          toast.style.whiteSpace = 'pre-wrap';
          toast.style.userSelect = 'text';
          setTimeout(() => toast.remove(), 30000);
          btn.disabled = false;
          // Also dump to console for easier copying
          console.error('[Stage to LCC] failed', resp);
        }
      } catch (err) {
        btn.textContent = 'Error';
        toast.textContent = `Stage error: ${err.message || err}`;
        setTimeout(() => toast.remove(), 8000);
        btn.disabled = false;
      }
    });
  });

  // Action buttons
  if (ctx && ctx.address) {
    const sourceLabel = escapeHtml(domainLabel);
    if (matched) {
      actions.innerHTML = `<button class="btn btn-sm btn-confirm" id="updateLccBtn">Update LCC with ${sourceLabel} Data</button>`;
    } else {
      actions.innerHTML = `<button class="btn btn-sm btn-success" id="saveLccBtn">Save Property to LCC</button>`;
    }
    wirePropertyActions(ctx, lccEntity);
  }

  console.log('[Re-run btn] matched:', matched,
    'entity_type:', lccEntity?.entity_type,
    'pipeline_status:', lccEntity?.metadata?._pipeline_status);

  // Pipeline button — always available on matched assets
  if (matched && lccEntity.entity_type === 'asset') {
    const meta = lccEntity.metadata || {};
    let pipelineLabel;
    if (meta._pipeline_status === 'success') {
      pipelineLabel = 'Re-run Pipeline';
    } else if (meta._pipeline_status === 'failed') {
      pipelineLabel = 'Retry Pipeline (Failed)';
    } else if (!meta._pipeline_processed_at) {
      pipelineLabel = 'Run Pipeline';
    } else {
      pipelineLabel = 'Re-run Pipeline';
    }

    const rerunBtn = document.createElement('button');
    rerunBtn.className = 'btn btn-sm btn-secondary';
    rerunBtn.id = 'rerunPipelineBtn';
    rerunBtn.textContent = pipelineLabel;
    actions.appendChild(rerunBtn);

    rerunBtn.addEventListener('click', async () => {
      rerunBtn.disabled = true;
      rerunBtn.textContent = 'Running...';

      const result = await apiCall('/api/entities?action=process_sidebar_extraction', {
        entity_id: lccEntity.id,
        force: true,
      });

      if (result.ok) {
        const toast = document.createElement('div');
        toast.className = 'update-toast updated';
        toast.textContent = 'Pipeline re-ran successfully';
        actions.prepend(toast);
        pollPipelineStatus(lccEntity.id, actions).then(() => {
          rerunBtn.textContent = 'Re-run Pipeline';
          rerunBtn.disabled = false;
        });
      } else {
        const errMsg = toErrorMessage(result.data?.error)
          || toErrorMessage(result.error)
          || 'Unknown error';
        const toast = document.createElement('div');
        toast.className = 'update-toast';
        toast.textContent = errMsg;
        actions.prepend(toast);
        rerunBtn.textContent = 'Re-run Pipeline';
        rerunBtn.disabled = false;
      }
    });
  }

  $('#lastUpdated').textContent = `Property: ${new Date().toLocaleTimeString()}`;
}

function renderDetectedFields(ctx, sourceLabel) {
  let html = `<div class="section-label">${escapeHtml(sourceLabel || 'Detected')} Data</div>`;
  for (const [key, label] of PROPERTY_FIELDS) {
    const valStr = toDisplayString(ctx[key]);
    if (valStr) {
      html += `<div class="context-field">
        <span class="context-label">${escapeHtml(label)}</span>
        <span class="context-value compare-new">${escapeHtml(valStr)}</span>
      </div>`;
    }
  }
  return html;
}

function renderCompareTable(ctx, lccEntity, sourceLabel) {
  // Only show fields where source has data that's new or different from LCC
  const rows = PROPERTY_FIELDS.filter(([srcKey, , lccKey]) => {
    const srcStr = toDisplayString(ctx[srcKey]);
    const lccStr = toDisplayString(lccEntity[lccKey]);
    return srcStr && (!lccStr || srcStr !== lccStr);
  });

  if (!rows.length) return `<div class="section-label">No new data from ${escapeHtml(sourceLabel || 'source')}</div>`;

  let html = `<div class="section-label">Proposed Updates from ${escapeHtml(sourceLabel || 'Source')}</div>`;
  html += '<table class="compare-table">';
  html += `<tr><th>Field</th><th>${escapeHtml(sourceLabel || 'Source')}</th><th>Current LCC</th></tr>`;

  for (const [srcKey, label, lccKey] of rows) {
    const srcVal = toDisplayString(ctx[srcKey]);
    const lccVal = toDisplayString(lccEntity[lccKey]);
    const srcDisplay = srcVal || '—';
    const lccDisplay = lccVal || '—';

    let srcCls = '';
    if (srcVal && !lccVal) srcCls = 'compare-new';
    else if (srcVal && lccVal && srcVal !== lccVal) srcCls = 'compare-diff';

    html += `<tr>
      <td class="field-label">${escapeHtml(label)}</td>
      <td class="${srcCls}">${escapeHtml(srcDisplay)}</td>
      <td>${escapeHtml(lccDisplay)}</td>
    </tr>`;
  }

  html += '</table>';
  return html;
}

// ── Cap rate provenance helpers ─────────────────────────────────────────────
//
// The dialysis pipeline (api/_shared/rent-projection.js) stores three fields
// per sale once a confirmed rent anchor arrives: stated_cap_rate (raw CoStar),
// calculated_cap_rate (projected from the anchor), and cap_rate_confidence
// ('low' | 'medium' | 'high'). We mirror that three-state model in the UI.

function formatCapPct(raw) {
  if (raw == null || raw === '') return null;
  // Accept '7.15%' strings or decimal numerics (0.0715 or 7.15) from LCC.
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.endsWith('%')) return trimmed;
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) return formatCapPct(asNum);
    return trimmed;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Values under 1 are assumed to be decimal fractions (0.0715 → 7.15%).
  const pct = n < 1 ? n * 100 : n;
  return pct.toFixed(2) + '%';
}

/**
 * Read cap-rate provenance from whatever LCC has for this property.
 * Returns { statedPct, calculatedPct, confidence, sourceLabel } where unset
 * fields are null. Provenance fields live on the most recent sale in the
 * LCC metadata sales_history (if the dialysis pipeline back-fills them),
 * or on the property metadata itself as a fallback.
 */
function pickCapRateState(meta) {
  const mostRecentSale = Array.isArray(meta?.sales_history) && meta.sales_history.length
    ? [...meta.sales_history].sort((a, b) => {
        const da = a.sale_date ? Date.parse(a.sale_date) : 0;
        const db = b.sale_date ? Date.parse(b.sale_date) : 0;
        return db - da;
      })[0]
    : null;

  const source = mostRecentSale || meta || {};
  const stated     = source.stated_cap_rate ?? source.cap_rate ?? null;
  const calculated = source.calculated_cap_rate ?? null;
  const confidence = source.cap_rate_confidence || null;
  const rentSource = source.rent_source || meta?.anchor_rent_source || null;

  // Human-readable provenance caption.
  let sourceLabel = null;
  if (confidence === 'high' || rentSource === 'projected_from_lease_confirmed'
      || rentSource === 'lease_confirmed') {
    sourceLabel = 'lease confirmed';
  } else if (confidence === 'medium' || rentSource === 'projected_from_om_confirmed'
      || rentSource === 'om_confirmed') {
    sourceLabel = 'projected from OM';
  } else {
    sourceLabel = 'CoStar stated';
  }

  return {
    statedPct:     formatCapPct(stated),
    calculatedPct: formatCapPct(calculated),
    confidence:    confidence || 'low',
    sourceLabel,
  };
}

/**
 * Render a cap-rate cell using the three-state model. ``costarStr`` is the
 * value we just scraped (may be null/empty if CoStar didn't surface one).
 */
function renderCapRateRow(label, costarStr, state) {
  const confidence = state.confidence || 'low';
  const sourceLabel = state.sourceLabel || 'CoStar stated';

  // State 2 / 3 — calculated cap rate is available.
  if (state.calculatedPct) {
    const lock = confidence === 'high' ? '\uD83D\uDD12 ' : '';
    const check = '\u2713';
    const stated = state.statedPct || costarStr;
    return `<div class="context-field" style="background:rgba(74,222,128,0.06)">
      <span class="context-label">${escapeHtml(label)}</span>
      <span class="context-value" style="display:block">
        <span style="color:var(--text);font-size:11px">CoStar stated: ${escapeHtml(stated || '—')}</span><br>
        <span style="color:#4ade80;font-size:11px;font-weight:600">Calculated: ${escapeHtml(state.calculatedPct)}</span>
        <span style="color:#4ade80;font-size:11px;margin-left:4px">${check} ${lock}${escapeHtml(confidence)} confidence (${escapeHtml(sourceLabel)})</span>
      </span>
    </div>`;
  }

  // State 1 — no anchor rent yet; show low-confidence amber row.
  const warn = '\u26A0';
  return `<div class="context-field" style="background:rgba(251,191,36,0.08)">
    <span class="context-label">${escapeHtml(label)}</span>
    <span class="context-value">
      <span style="color:#fbbf24;font-size:11px">CoStar: ${escapeHtml(costarStr)}</span>
      <span style="background:rgba(251,191,36,0.2);color:#fbbf24;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px">${warn} low confidence (${escapeHtml(sourceLabel)})</span>
    </span>
  </div>`;
}

function renderIngestDiff(ctx, lccEntity) {
  const meta = lccEntity.metadata || {};

  // Pull cap-rate provenance off whatever LCC has for this property. We look
  // first at the most recent sale in LCC metadata (where the dialysis pipeline
  // stores calculated_cap_rate / cap_rate_confidence / stated_cap_rate), and
  // fall back to the property-level metadata fields if present.
  const capRateState = pickCapRateState(meta);
  const capRateLabel = capRateState.calculatedPct
    ? 'Cap Rate (stated / calculated)'
    : 'Cap Rate';

  const comparisons = [
    { label: 'Asking Price', costar: ctx.asking_price, db: null },
    { label: capRateLabel, costar: ctx.cap_rate, db: null,
      capRateState },
    { label: 'Building Size', costar: ctx.square_footage,
      db: lccEntity.metadata?.square_footage },
    (() => {
      const INVALID = /^(public\s+record|building|land|market|sources)$/i;
      const tenantCostar = (() => {
        const raw = (ctx.tenants||[]).map(t=>t.name).join(', ') || ctx.tenant_name;
        return (raw && !INVALID.test(raw)) ? raw : null;
      })();
      const tenantDb = (() => {
        const raw = meta.tenant_name || (meta.tenants||[]).map(t=>t.name).join(', ');
        return (raw && !INVALID.test(raw)) ? raw : null;
      })();
      return { label: 'Tenant', costar: tenantCostar, db: tenantDb,
        hint: (!tenantCostar && !tenantDb)
          ? 'Not available on comp pages \u2014 open property details in CoStar'
          : null };
    })(),
    { label: 'Owner',
      costar: (ctx.contacts||[]).find(c=>c.role==='owner')?.name,
      db: meta.contacts ? meta.contacts.find(c=>c.role==='owner')?.name : null },
    (() => {
      // Round 76ac (2026-04-27): save is upsert by recordation_date and
      // never deletes — a smaller CoStar count doesn't reduce the DB.
      // Show that explicitly so users don't fear losing the older sale.
      const cstarN = (ctx.sales_history||[]).length;
      const dbN    = meta.sales_history ? meta.sales_history.length : 0;
      let costarStr = cstarN + ' records';
      let hint = null;
      if (cstarN < dbN) {
        costarStr = cstarN + ' new (preserves ' + dbN + ')';
        hint = 'Save is additive \u2014 existing sales are preserved';
      } else if (cstarN > dbN) {
        costarStr = cstarN + ' records (will add ' + (cstarN - dbN) + ')';
      }
      return { label: 'Sales in History',
        costar: costarStr,
        db: dbN + ' records',
        hint };
    })(),
  ];

  let html = '<div class="section-label">Comparison: CoStar vs LCC</div>';
  for (const c of comparisons) {
    const costarStr = toDisplayString(c.costar);
    const dbStr = toDisplayString(c.db);
    if (!costarStr && !dbStr && !c.hint) continue;

    // Cap Rate row — three-state display driven by what's in the LCC
    // dialysis DB. When no anchor rent exists we show the unverified CoStar
    // value with low-confidence (amber) styling. Once the pipeline has
    // computed a calculated cap rate, we show stated + calculated side-by-
    // side, with high confidence getting a lock icon.
    if (c.capRateState && costarStr) {
      html += renderCapRateRow(c.label, costarStr, c.capRateState);
      continue;
    }

    const changed = costarStr && dbStr && costarStr !== dbStr;
    html += `<div class="context-field" style="background:${
      changed ? 'rgba(251,191,36,0.08)' : 'transparent'}">
      <span class="context-label">${escapeHtml(c.label)}</span>
      <span class="context-value">
        ${dbStr ? '<span style="color:var(--text3);font-size:10px">DB: ' +
          escapeHtml(dbStr) + '</span><br>' : ''}
        ${costarStr ? '<span style="color:var(--text);font-size:11px">\u2192 ' +
          escapeHtml(costarStr) + '</span>' : ''}
        ${(!costarStr && !dbStr && c.hint) ? '<span style="color:var(--text3);font-size:10px;font-style:italic">\u26A0 ' +
          escapeHtml(c.hint) + '</span>' : ''}
      </span>
    </div>`;
  }
  return html;
}

function renderLccFields(entity, data) {
  let html = '';
  const fields = [
    ['address', 'Address'], ['city', 'City'], ['state', 'State'],
    ['asset_type', 'Asset Type'], ['building_class', 'Building Class'],
    ['year_built', 'Year Built'], ['square_footage', 'Square Footage'],
  ];
  for (const [key, label] of fields) {
    const val = entity[key];
    if (val) {
      const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val || '');
      html += `<div class="context-field">
        <span class="context-label">${escapeHtml(label)}</span>
        <span class="context-value">${escapeHtml(valStr)}</span>
      </div>`;
    }
  }
  return html;
}

function wirePropertyActions(ctx, lccEntity) {
  const updateBtn = $('#updateLccBtn');
  const saveBtn = $('#saveLccBtn');
  const domain = ctx.domain || 'source';
  const domainLabel = DOMAIN_LABELS[domain] || domain;

  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      updateBtn.disabled = true;
      updateBtn.textContent = 'Updating...';

      // Re-read live pageContext so OM-enriched data is included
      // (the closure ctx may be stale if OM ingestion happened after render)
      const liveCtx = (await getPageContext()) || ctx;

      // PATCH the existing entity — merge new CRE data into metadata
      const fields = extractSourceFields(liveCtx);
      const metadata = { ...(lccEntity.metadata || {}), ...buildMetadata(liveCtx, domain) };
      // Clear pipeline gate so re-ingestion triggers a fresh pipeline run
      delete metadata._pipeline_processed_at;
      delete metadata._pipeline_status;
      delete metadata._pipeline_summary;
      delete metadata._pipeline_last_error;
      const result = await apiCall(`/api/entities?id=${lccEntity.id}`, {
        ...fields,
        metadata,
        description: `Updated from ${domainLabel} on ${new Date().toLocaleDateString()}`,
      }, 'PATCH');

      if (result.ok) {
        updateBtn.className = 'btn btn-sm btn-success';
        updateBtn.textContent = 'Updated! Checking pipeline...';
        const toast = document.createElement('div');
        toast.className = 'update-toast updated';
        toast.textContent = `Property data synced from ${domainLabel}`;
        $('#propertyActions').prepend(toast);
        pollPipelineStatus(lccEntity.id, $('#propertyActions')).then(() => {
          updateBtn.textContent = 'Updated!';
        });
      } else {
        updateBtn.disabled = false;
        updateBtn.textContent = 'Update Failed — Retry';
        updateBtn.className = 'btn btn-sm btn-danger';
        const errMsg = toErrorMessage(result.error)
          || toErrorMessage(result.data?.error)
          || toErrorMessage(result.data?.message)
          || `HTTP ${result.status || 'error'}`;
        const toast = document.createElement('div');
        toast.className = 'update-toast';
        toast.textContent = errMsg;
        $('#propertyActions').prepend(toast);
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      // Re-read live pageContext so OM-enriched data is included
      const liveCtx = (await getPageContext()) || ctx;

      const fields = extractSourceFields(liveCtx);
      const metadata = buildMetadata(liveCtx, domain);

      const result = await apiCall('/api/entities', {
        entity_type: 'asset',
        name: liveCtx.address,
        address: liveCtx.address,
        city: liveCtx.city,
        state: liveCtx.state,
        zip: liveCtx.zip || null,
        county: liveCtx.county || null,
        asset_type: (() => {
          const rawType = fields.property_type || liveCtx.property_subtype || null;
          const INVALID_TYPES = ['size', 'type', 'class', 'sf', 'rba', 'stories'];
          return (rawType && !INVALID_TYPES.includes(rawType.toLowerCase())) ? rawType : 'property';
        })(),
        description: `Imported from ${domainLabel}`,
        metadata,
      });

      // If created, link the external identity (CoStar parcel/URL)
      const newEntityId = result.data?.entity?.id;
      if (result.ok && newEntityId) {
        const extId = liveCtx.parcel_number || liveCtx.page_url || liveCtx.address;
        await apiCall('/api/entities?action=link', {
          entity_id: newEntityId,
          source_system: domain || 'extension',
          source_type: 'property',
          external_id: extId,
          external_url: liveCtx.page_url || null,
        }).catch(() => {}); // linking is best-effort
      }

      if (result.ok) {
        saveBtn.className = 'btn btn-sm btn-success';
        saveBtn.textContent = 'Saved! Checking pipeline...';
        const toast = document.createElement('div');
        toast.className = 'update-toast updated';
        toast.textContent = 'Property added to LCC';
        $('#propertyActions').prepend(toast);
        pollPipelineStatus(newEntityId, $('#propertyActions')).then(() => {
          saveBtn.textContent = 'Saved!';
          setTimeout(() => loadPropertyTab(), 1500);
        });
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Failed — Retry';
        saveBtn.className = 'btn btn-sm btn-danger';
        const errMsg = toErrorMessage(result.error)
          || toErrorMessage(result.data?.error)
          || toErrorMessage(result.data?.message)
          || `HTTP ${result.status || 'error'}`;
        const toast = document.createElement('div');
        toast.className = 'update-toast';
        toast.textContent = errMsg;
        $('#propertyActions').prepend(toast);
      }
    });
  }
}

function extractSourceFields(ctx) {
  const fields = {};
  for (const [key] of PROPERTY_FIELDS) {
    if (ctx[key]) fields[key] = ctx[key];
  }
  for (const [key] of ASSESSOR_FIELDS) {
    if (ctx[key]) fields[key] = ctx[key];
  }
  return fields;
}

function buildMetadata(ctx, domain) {
  // Capture ALL extracted data for the cleaning/propagation pipeline.
  // Keys match database column names where possible.
  // Belt-and-suspenders filter: strip CoStar section headings that slip past extractFields()
  const INVALID_TENANT = /^(public\s+record|building|land|market|submarket|sources|assessment|investment|not\s+disclosed|none|vacant|available|owner.occupied|confirmed|verified|research|industry|sector|property\s+type|property\s+subtype|building\s+class|tenancy|single\s+tenant|multi.tenant|net\s+lease|gross\s+lease|nnn|modified\s+gross|buyer|seller|broker|listing\s+broker|buyer\s+broker|lender|owner|recorded\s+buyer|recorded\s+seller|true\s+buyer|true\s+seller|current\s+owner)$/i;
  const m = {
    source: domain || 'extension',
    source_url: ctx.page_url || null,
    _version: ctx._version || null,
    costar_comp_id: ctx.costar_comp_id || null,
    extracted_at: new Date().toISOString(),
    // Financials
    asking_price: ctx.asking_price || null,
    cap_rate: ctx.cap_rate || null,
    noi: ctx.noi || null,
    price_per_sf: ctx.price_per_sf || null,
    sale_price: ctx.sale_price || null,
    sale_date: ctx.sale_date || null,
    // Building
    building_class: ctx.building_class || null,
    year_built: ctx.year_built || null,
    year_renovated: ctx.year_renovated || null,
    construction_start: ctx.construction_start || null,
    square_footage: ctx.square_footage || null,
    typical_floor_sf: ctx.typical_floor_sf || null,
    lot_size: ctx.lot_size || null,
    land_sf: ctx.land_sf || null,
    far: ctx.far || null,
    stories: ctx.stories || null,
    parking: ctx.parking || null,
    zoning: ctx.zoning || null,
    occupancy: ctx.occupancy || null,
    ownership_type: ctx.ownership_type || null,
    location_type: ctx.location_type || null,
    building_name: ctx.building_name || null,
    property_subtype: ctx.property_subtype || null,
    days_on_market: ctx.days_on_market || null,
    comp_status: ctx.comp_status || null,
    price_status: ctx.price_status || null,
    // Public records
    parcel_number: ctx.parcel_number || null,
    county: ctx.county || null,
    assessed_value: ctx.assessed_value || null,
    land_value: ctx.land_value || null,
    improvement_value: ctx.improvement_value || null,
    // Tenant / Lease
    tenant_name:       (ctx.tenant_name && !INVALID_TENANT.test(ctx.tenant_name)) ? ctx.tenant_name : null,
    primary_tenant:    (ctx.primary_tenant && !INVALID_TENANT.test(ctx.primary_tenant)) ? ctx.primary_tenant : null,
    tenancy_type: ctx.tenancy_type || null,
    owner_occupied: ctx.owner_occupied || null,
    est_rent: ctx.est_rent || null,
    lease_type: ctx.lease_type || null,
    lease_term: ctx.lease_term || null,
    lease_expiration: ctx.lease_expiration || null,
    lease_commencement: ctx.lease_commencement || null,
    rent_per_sf: ctx.rent_per_sf || null,
    annual_rent: ctx.annual_rent || null,
    expense_structure: ctx.expense_structure || null,
    renewal_options: ctx.renewal_options || null,
    guarantor: ctx.guarantor || null,
    rent_escalations: ctx.rent_escalations || null,
    sf_leased: ctx.sf_leased || null,
    // Market data
    subject_vacancy: ctx.subject_vacancy || null,
    submarket_vacancy: ctx.submarket_vacancy || null,
    market_vacancy: ctx.market_vacancy || null,
    subject_rent_psf: ctx.subject_rent_psf || null,
    market_rent_psf: ctx.market_rent_psf || null,
    submarket_12mo_leased: ctx.submarket_12mo_leased || null,
    submarket_avg_months_on_market: ctx.submarket_avg_months_on_market || null,
    submarket_12mo_sales_volume: ctx.submarket_12mo_sales_volume || null,
    market_sale_price_psf: ctx.market_sale_price_psf || null,
    // Arrays
    tenants: ctx.tenants || [],
    contacts: ctx.contacts || [],
    sales_history: ctx.sales_history || [],
    // Sale notes & document links from CoStar comp detail pages
    sale_notes_raw: ctx.sale_notes_raw || null,
    document_links: ctx.document_links || [],
    documents: ctx.documents || [],
    // Listing broker (from OM extraction)
    listing_broker: ctx.listing_broker || null,
    listing_firm: ctx.listing_firm || null,
    listing_email: ctx.listing_email || null,
    listing_phone: ctx.listing_phone || null,
    // PDF / OM ingestion tracking
    pdf_count: (ctx.pdf_extracted_texts || []).length || 0,
    pdf_extracted_texts: ctx.pdf_extracted_texts || [],
  };
  // Strip null values to keep metadata clean
  for (const key of Object.keys(m)) {
    if (m[key] === null) delete m[key];
  }
  return m;
}

// ── Assessor / public records extra fields ──────────────────────────────────

function renderAssessorFields(ctx) {
  const hasAssessor = ASSESSOR_FIELDS.some(([key]) => ctx[key]);
  if (!hasAssessor) return '';

  let html = '<div class="section-label">Public Records Data</div>';
  for (const [key, label] of ASSESSOR_FIELDS) {
    const val = ctx[key];
    if (val) {
      html += `<div class="context-field">
        <span class="context-label">${escapeHtml(label)}</span>
        <span class="context-value">${escapeHtml(val)}</span>
      </div>`;
    }
  }
  return html;
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
      let lenderLine = s.lender ? `<strong>Lender:</strong> ${escapeHtml(s.lender)}` : '<strong>Loan:</strong>';
      if (s.loan_amount) lenderLine += ` — ${escapeHtml(s.loan_amount)}`;
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

// ── Organization view (SOS / business entity lookups) ───────────────────────

function loadOrgView(source, domainLabel) {
  const header = $('#propertyHeader');
  const body = $('#propertyBody');
  const actions = $('#propertyActions');

  const name = source.name || 'Unknown Entity';
  const siteType = source.site_type || 'business-search';

  header.innerHTML = `
    <div class="property-title">${escapeHtml(name)}</div>
    <div class="property-source">${domainBadge(source.domain)} ${escapeHtml(domainLabel)} (${escapeHtml(siteType)})</div>
  `;

  let html = '<div class="section-label">Entity Details</div>';
  for (const [key, label] of ORG_FIELDS) {
    const val = source[key];
    if (val) {
      html += `<div class="context-field">
        <span class="context-label">${escapeHtml(label)}</span>
        <span class="context-value">${escapeHtml(val)}</span>
      </div>`;
    }
  }

  if (!ORG_FIELDS.some(([key]) => source[key])) {
    html += '<div class="empty-state">No entity details found</div>';
  }

  body.innerHTML = html;

  // Action: save org to LCC or search for it
  actions.innerHTML = `
    <button class="btn btn-sm btn-primary" id="searchOrgBtn">Search in LCC</button>
    <button class="btn btn-sm btn-success" id="saveOrgBtn" style="margin-left:6px;">Save to LCC</button>
  `;

  const searchBtn = $('#searchOrgBtn');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      $('#searchInput').value = name;
      switchTab('search');
      doSearch();
    });
  }

  const saveBtn = $('#saveOrgBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const fields = {};
      for (const [key] of ORG_FIELDS) {
        if (source[key]) fields[key] = source[key];
      }

      const result = await apiCall('/api/entities', {
        entity_type: 'organization',
        name,
        org_type: fields.entity_type_detail || null,
        description: `Imported from ${source.domain || 'public-records'}`,
      });

      if (result.ok) {
        saveBtn.className = 'btn btn-sm btn-success';
        saveBtn.textContent = 'Saved!';
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Failed — Retry';
        saveBtn.className = 'btn btn-sm btn-danger';
        const errMsg = toErrorMessage(result.error)
          || toErrorMessage(result.data?.error)
          || toErrorMessage(result.data?.message)
          || `HTTP ${result.status || 'error'}`;
        const toast = document.createElement('div');
        toast.className = 'update-toast';
        toast.textContent = errMsg;
        saveBtn.parentElement?.prepend(toast);
      }
    });
  }

  $('#lastUpdated').textContent = `Entity: ${new Date().toLocaleTimeString()}`;
}

// ── Scan This Page ──────────────────────────────────────────────────────────

function wireScanButton() {
  const scanBtn = $('#scanPageBtn');
  if (!scanBtn) return;

  scanBtn.addEventListener('click', async () => {
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
