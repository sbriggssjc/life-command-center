// ============================================================================
// OWNERGAP2-harris — pure parser for HCAD's free bulk PDATA export
// (`real_acct.txt` + `owners.txt`, inside `Real_acct_owner.zip`).
// Life Command Center — no I/O, no network, no model. Given raw file text, it
// returns rows; it decides nothing about which row matches which property
// (that is `api/_shared/ownergap2-harris-pdata-match.js`) and it never writes.
// ----------------------------------------------------------------------------
// ⚠️ WRITTEN WITHOUT A REAL SAMPLE FILE. This environment has no egress to
//    hcad.org (confirmed 2026-09-16: `CONNECT tunnel failed, response 403` —
//    the agent proxy's own policy, not HCAD's bot wall this time), so neither
//    `Real_acct_owner.zip` nor the codebook PDF that documents its exact
//    columns could be fetched. Two assumptions are made here and BOTH are
//    stated, not hidden:
//
//    1. DELIMITER — HCAD's PDATA text exports are widely documented (by every
//       downstream consumer of this specific dataset, independent of any one
//       site) as TAB-delimited with a header row. This parser therefore
//       defaults to tab, but SNIFFS the header line first (counts tabs vs
//       commas vs pipes) and uses whichever delimiter actually splits the
//       header into more than one field — so a differently-delimited export
//       does not silently mis-parse into one giant column.
//
//    2. COLUMN NAMES — rather than assume a fixed column ORDER (which breaks
//       silently the moment HCAD adds or reorders a column), this parser is
//       HEADER-DRIVEN: it reads the header row, maps each REQUIRED logical
//       field to whichever of several known-documented candidate header names
//       is present (case/whitespace-insensitive), and REFUSES to run rather
//       than guess when a required field cannot be found. `raw_row` in the
//       staging table keeps every column the loader saw, so a rename the
//       candidate list does not cover is recoverable without a re-download —
//       see the migration header for the same point made about state_class.
// ============================================================================

/** Candidate header names for each logical field, most-likely first. Extend
 * this list (never guess a POSITION) if a real export uses a different name. */
const FIELD_CANDIDATES = {
  acct: ['acct', 'account', 'account_number', 'hcad_num'],
  owner_name: ['owner_name', 'name', 'mailto', 'owner1', 'owner_1'],
  owner_name_2: ['owner_name_2', 'name2', 'owner2', 'owner_2', 'aka'],
  mail_addr_1: ['mail_addr_1', 'mailing_address_1', 'mail_address_1', 'mail_addr1'],
  mail_addr_2: ['mail_addr_2', 'mailing_address_2', 'mail_address_2', 'mail_addr2'],
  mail_city: ['mail_city', 'mailing_city'],
  mail_state: ['mail_state', 'mailing_state'],
  mail_zip: ['mail_zip', 'mailing_zip'],
  str_num: ['str_num', 'street_number', 'situs_num'],
  str: ['str', 'street', 'street_name', 'site_str'],
  str_sfx: ['str_sfx', 'street_suffix', 'site_str_sfx'],
  site_addr_1: ['site_addr_1', 'situs_addr_1', 'property_address', 'site_address_1'],
  site_addr_2: ['site_addr_2', 'situs_addr_2', 'site_address_2'],
  site_addr_3: ['site_addr_3', 'situs_addr_3', 'site_address_3'],
  state_class: ['state_class', 'state_cd', 'statecode', 'property_class'],
};

// The two fields a row cannot be staged without. Everything else is
// fill-blanks (null when absent) — this mirrors the OWNERGAP2 discipline of
// never fabricating a value, applied to a MISSING COLUMN rather than a
// missing name.
const REQUIRED_FIELDS = ['acct'];

function sniffDelimiter(headerLine) {
  const counts = { '\t': 0, ',': 0, '|': 0 };
  for (const ch of headerLine) if (ch in counts) counts[ch] += 1;
  const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return best[1] > 0 ? best[0] : '\t';
}

function normHeaderCell(cell) {
  return String(cell ?? '').trim().replace(/^"|"$/g, '').toLowerCase();
}

/**
 * Build a { logicalField: columnIndex } map from a header row, or refuse.
 * @returns {{ok:boolean, map:object, missing:string[], delimiter:string}}
 */
export function mapHeader(headerLine) {
  const delimiter = sniffDelimiter(headerLine);
  const cells = headerLine.split(delimiter).map(normHeaderCell);
  const index = new Map();
  cells.forEach((c, i) => { if (c && !index.has(c)) index.set(c, i); });

  const map = {};
  const missing = [];
  for (const [field, candidates] of Object.entries(FIELD_CANDIDATES)) {
    const hit = candidates.find((c) => index.has(c));
    if (hit != null) map[field] = index.get(hit);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in map)) missing.push(field);
  }
  return { ok: missing.length === 0, map, missing, delimiter, columnCount: cells.length };
}

function splitLine(line, delimiter) {
  // HCAD PDATA cells are not documented to carry embedded delimiters or
  // quoted multi-line text (unlike a general CSV), so a plain split is
  // sufficient and does not risk mis-parsing a genuinely simple TSV/PSV as if
  // it needed RFC4180 quote handling it was never given. Strip a bare
  // wrapping quote per cell (some exports quote every field).
  return line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
}

/**
 * Parse `real_acct.txt` into staging rows.
 * @param {string} text - the raw file content (already decoded).
 * @param {object} opts - { fileYear: number, sourceFile: string }
 * @returns {{ok:boolean, reason?:string, missing?:string[], rows:object[], totalLines:number, skippedBlank:number}}
 */
export function parseRealAcctText(text, opts = {}) {
  const out = { ok: false, rows: [], totalLines: 0, skippedBlank: 0 };
  if (text == null || String(text).trim() === '') { out.reason = 'empty_file'; return out; }
  const lines = String(text).split(/\r\n|\r|\n/);
  const header = lines[0];
  if (header == null) { out.reason = 'no_header'; return out; }
  const hm = mapHeader(header);
  if (!hm.ok) { out.reason = 'missing_required_columns'; out.missing = hm.missing; return out; }

  const fileYear = Number.isFinite(opts.fileYear) ? opts.fileYear : new Date().getFullYear();
  const sourceFile = opts.sourceFile || null;

  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i];
    out.totalLines += 1;
    if (raw == null || raw.trim() === '') { out.skippedBlank += 1; continue; }
    const cells = splitLine(raw, hm.delimiter);
    const get = (field) => {
      const idx = hm.map[field];
      if (idx == null) return null;
      const v = cells[idx];
      return v == null || v.trim() === '' ? null : v.trim();
    };
    const acct = get('acct');
    if (!acct) { out.skippedBlank += 1; continue; }

    const raw_row = {};
    for (const field of Object.keys(FIELD_CANDIDATES)) {
      const v = get(field);
      if (v != null) raw_row[field] = v;
    }

    out.rows.push({
      acct,
      file_year: fileYear,
      owner_name: get('owner_name'),
      owner_name_2: get('owner_name_2'),
      mail_addr_1: get('mail_addr_1'),
      mail_addr_2: get('mail_addr_2'),
      mail_city: get('mail_city'),
      mail_state: get('mail_state'),
      mail_zip: get('mail_zip'),
      str_num: get('str_num'),
      str: get('str'),
      str_sfx: get('str_sfx'),
      site_addr_1: get('site_addr_1'),
      site_addr_2: get('site_addr_2'),
      site_addr_3: get('site_addr_3'),
      state_class: get('state_class'),
      raw_row,
      source_file: sourceFile,
    });
  }
  out.ok = true;
  return out;
}

/**
 * Parse the multi-owner supplement `owners.txt` (one row per (acct, owner
 * line) for accounts with more than one owner of record). Returns rows keyed
 * by `acct` so a loader can fold them into `owner_name_2` etc. — kept as a
 * SEPARATE parse rather than merged blindly, because a real_acct row that
 * already carries an owner name must never be silently overwritten by an
 * owners.txt row for the same acct (fill-blanks, same as the rest of this
 * arc).
 */
export function parseOwnersText(text) {
  const out = { ok: false, rowsByAcct: new Map(), totalLines: 0, skippedBlank: 0 };
  if (text == null || String(text).trim() === '') { out.reason = 'empty_file'; return out; }
  const lines = String(text).split(/\r\n|\r|\n/);
  const header = lines[0];
  if (header == null) { out.reason = 'no_header'; return out; }
  const delimiter = sniffDelimiter(header);
  const cells = header.split(delimiter).map(normHeaderCell);
  const acctIdx = cells.findIndex((c) => ['acct', 'account', 'account_number'].includes(c));
  const nameIdx = cells.findIndex((c) => ['name', 'owner_name', 'owner'].includes(c));
  const pctIdx = cells.findIndex((c) => ['pct_own', 'pct_ownership', 'percent_ownership'].includes(c));
  if (acctIdx < 0 || nameIdx < 0) { out.reason = 'missing_required_columns'; out.missing = ['acct', 'name']; return out; }

  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i];
    out.totalLines += 1;
    if (raw == null || raw.trim() === '') { out.skippedBlank += 1; continue; }
    const row = splitLine(raw, delimiter);
    const acct = (row[acctIdx] || '').trim();
    const name = (row[nameIdx] || '').trim();
    if (!acct || !name) { out.skippedBlank += 1; continue; }
    const pct = pctIdx >= 0 ? row[pctIdx] : null;
    if (!out.rowsByAcct.has(acct)) out.rowsByAcct.set(acct, []);
    out.rowsByAcct.get(acct).push({ name, pct: pct || null });
  }
  out.ok = true;
  return out;
}

// ── Commercial state_class classification (unverified, see migration header) ─
//
// Texas Comptroller property-type-code taxonomy, the same one every Texas CAD
// (including HCAD) files its `state_class` under. F1/F2 are REAL property
// (commercial/industrial) — the account this arc wants, matching PDR2's
// Commercial-vs-Personal distinction. L1/L2 are BUSINESS PERSONAL PROPERTY —
// the tenant's equipment, exactly like the payload path's `HARRIS_PERSONAL_
// PROPERTY_TYPES`. ⚠️ Not independently verified against pdataCodebook.pdf.
export const HCAD_COMMERCIAL_REAL_CLASSES = new Set(['F1', 'F2']);
export const HCAD_COMMERCIAL_PERSONAL_CLASSES = new Set(['L1', 'L2']);

export function normalizeStateClass(value) {
  if (value == null) return null;
  const t = String(value).trim().toUpperCase();
  return t || null;
}

/** true for the REAL PROPERTY commercial/industrial classes. */
export function isCommercialRealClass(stateClass) {
  const c = normalizeStateClass(stateClass);
  return !!c && HCAD_COMMERCIAL_REAL_CLASSES.has(c);
}

/** true for the BUSINESS PERSONAL PROPERTY commercial/industrial classes. */
export function isCommercialPersonalClass(stateClass) {
  const c = normalizeStateClass(stateClass);
  return !!c && HCAD_COMMERCIAL_PERSONAL_CLASSES.has(c);
}

/** The stage's `is_commercial_class` flag: real OR personal commercial. */
export function isAnyCommercialClass(stateClass) {
  return isCommercialRealClass(stateClass) || isCommercialPersonalClass(stateClass);
}

/**
 * Map a staged state_class to the SAME account-type vocabulary the payload
 * path uses (`isHarrisRealPropertyAccount` / `isHarrisPersonalPropertyAccount`
 * in ownergap2-sources.js), so one matcher downstream serves both paths.
 */
export function harrisStateClassToAccountType(stateClass) {
  if (isCommercialRealClass(stateClass)) return 'commercial';
  if (isCommercialPersonalClass(stateClass)) return 'personal';
  return null;
}
