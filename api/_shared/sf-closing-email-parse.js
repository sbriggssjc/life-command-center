// api/_shared/sf-closing-email-parse.js
// ============================================================================
// Parse a Northmarq Salesforce "Deal Closing Announcement" email into a
// normalized closed-deal record. PURE + deps-free → unit-tested against the
// raw .eml fixture.
//
// The email body is a fixed label→value HTML table (sender
// salesforce@northmarq.com, subject "Deal Closing Announcement - <name>").
// Labels (Deal Team + Deal Info sections):
//   Team Name, Broker, Deal Name, Deal Type, City, State, Sale Price, Cap Rate,
//   Closing Date, Property Type, Property Subtype, Seller Company, Buyer Company,
//   Seller/Buyer 1031 Exchange (ignored).
// The SF Opportunity Id + buyer/seller Account Ids ride in
// `/lightning/r/Opportunity/<id>/view` and `/lightning/r/Account/<id>/view`
// hrefs — extracted from the raw HTML by position (seller link precedes buyer).
//
// Companion: api/_handlers/sf-deal-closing.js (the handler that stages this
// into sf_deal_staging) + docs/architecture/sf_deal_closing_email_ingest_PLAN.md.
// ============================================================================

/** Subject prefix + sender that identify a Deal Closing Announcement email. */
export const CLOSING_SENDER = 'salesforce@northmarq.com';
export const CLOSING_SUBJECT_RE = /^\s*(?:(?:re|fw|fwd)\s*:\s*)*deal closing announcement\b/i;
// Salesforce-originated message-id domains (the genuine SF send is from sfdc.net
// / salesforce.com). Authoritative + always present on the direct announcement.
export const CLOSING_SF_MESSAGE_ID_RE = /@[\w.-]*(?:sfdc\.net|salesforce\.com)\b/i;
// SF fingerprint inside the (forwarded) body — the Opportunity/Account lightning
// links or a bare salesforce.com host. Survives an Outlook forward (which strips
// the sfdc.net message-id but embeds the full original body).
const CLOSING_SF_BODY_RE = /\/lightning\/r\/(?:Opportunity|Account)\/|salesforce\.com|sfdc\.net/i;

/**
 * Is this flagged email a Northmarq Deal Closing Announcement?
 *
 * The subject prefix ("Deal Closing Announcement", possibly behind FW:/RE:) is
 * MANDATORY (it's an SF-template-specific subject). Beyond that, at least one
 * Salesforce fingerprint must be present — because Power Automate's flagged-email
 * payload does NOT reliably carry the sender address (observed null live), so a
 * sender-only gate silently never fires. Fingerprints, any one:
 *   - sender contains salesforce@northmarq.com (primary, when PA sends it)
 *   - the internet message-id is from sfdc.net / salesforce.com (direct SF send)
 *   - the body carries an SF Opportunity/Account lightning link (covers forwards,
 *     whose message-id is an Outlook host but whose body embeds the original)
 * Tolerant of a display-name wrapper on the sender.
 */
export function isClosingAnnouncement({ senderEmail, subject, messageId, bodyHtml } = {}) {
  const subj = String(subject || '');
  if (!CLOSING_SUBJECT_RE.test(subj)) return false;
  const from = String(senderEmail || '').toLowerCase();
  if (from.includes(CLOSING_SENDER)) return true;
  if (CLOSING_SF_MESSAGE_ID_RE.test(String(messageId || ''))) return true;
  if (CLOSING_SF_BODY_RE.test(String(bodyHtml || ''))) return true;
  return false;
}

// ── decoding helpers ─────────────────────────────────────────────────────────

// Quoted-printable: a raw .eml text/html part carries `=3D` for `=`, `=20`, and
// soft line-breaks `=\r\n`. PA-decoded bodies arrive clean; decode only when the
// QP markers are present so a clean HTML body is untouched.
function decodeQuotedPrintableIfNeeded(s) {
  if (!/=\r?\n|=[0-9A-Fa-f]{2}/.test(s)) return s;
  return s
    .replace(/=\r?\n/g, '')                       // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function cellText(innerHtml) {
  return decodeEntities(String(innerHtml).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// ── value coercion ───────────────────────────────────────────────────────────

function num(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// "06/23/2026" | "6/23/26" | "2026-06-23" → "2026-06-23" (null if unparseable).
function toIsoDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = (Number(yy) >= 70 ? '19' : '20') + yy;
    return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// "Covington, GA" → { city:'Covington', state:'GA' }. Splits on the LAST comma;
// a trailing 2-letter token is the state.
function splitCityState(v) {
  const s = String(v || '').trim();
  if (!s) return { city: null, state: null };
  const m = s.match(/^(.*),\s*([A-Za-z]{2})\.?$/);
  if (m) return { city: m[1].trim() || null, state: m[2].toUpperCase() };
  return { city: s || null, state: null };
}

// First SF id (15/18 char) inside a /lightning/r/<Object>/<id>/view href.
function firstSfIdFor(html, object) {
  const re = new RegExp(`/lightning/r/${object}/([A-Za-z0-9]{15,18})`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

// First Account id appearing AFTER a label's position in the raw HTML — so the
// seller link (under "Seller Company") and buyer link (under "Buyer Company")
// are associated correctly even though both are /Account/ hrefs.
function accountIdAfterLabel(html, label) {
  const idx = html.search(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  if (idx < 0) return null;
  const m = html.slice(idx).match(/\/lightning\/r\/Account\/([A-Za-z0-9]{15,18})/i);
  return m ? m[1] : null;
}

// Known labels → output keys (the cell-pair walk reads these).
const LABELS = new Map([
  ['team name', 'deal_team'],
  ['broker', 'broker'],
  ['deal name', 'deal_name'],
  ['deal type', 'deal_type'],
  ['city, state', 'city_state'],
  ['sale price', '_sale_price'],
  ['cap rate', '_cap_rate'],
  ['closing date', '_closing_date'],
  ['property type', 'property_type'],
  ['property subtype', 'property_subtype'],
  ['seller company', 'seller_company'],
  ['buyer company', 'buyer_company'],
]);

/**
 * Parse the announcement HTML body. Returns a normalized record; every field is
 * nullable. `ok` is true when at least the deal name (or city/state) resolved.
 *
 * @param {string} rawHtml — the email's text/html body (QP-encoded or decoded).
 * @returns {{ok:boolean, deal_name, deal_type, city, state, sale_price,
 *   cap_rate, close_date, property_type, property_subtype, seller_company,
 *   seller_account_id, buyer_company, buyer_account_id, sf_opportunity_id,
 *   deal_team, broker}}
 */
export function parseClosingAnnouncement(rawHtml) {
  const html = decodeQuotedPrintableIfNeeded(String(rawHtml || ''));
  const out = {
    ok: false, deal_name: null, deal_type: null, city: null, state: null,
    sale_price: null, cap_rate: null, close_date: null, property_type: null,
    property_subtype: null, seller_company: null, seller_account_id: null,
    buyer_company: null, buyer_account_id: null, sf_opportunity_id: null,
    deal_team: null, broker: null,
  };

  // Cell-pair walk: a label cell is followed by its value cell (next non-empty
  // cell that is NOT itself a known label — guards an empty value).
  const cells = [];
  const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(html)) !== null) cells.push(cellText(m[1]));

  const raw = {};
  for (let i = 0; i < cells.length; i++) {
    const key = LABELS.get(cells[i].toLowerCase());
    if (!key) continue;
    let j = i + 1;
    while (j < cells.length && cells[j] === '') j++;
    if (j >= cells.length) continue;
    if (LABELS.has(cells[j].toLowerCase())) continue; // empty value, next is a label
    if (raw[key] == null) raw[key] = cells[j];
  }

  out.deal_name = raw.deal_name || null;
  out.deal_type = raw.deal_type || null;
  out.property_type = raw.property_type || null;
  out.property_subtype = raw.property_subtype || null;
  out.seller_company = raw.seller_company || null;
  out.buyer_company = raw.buyer_company || null;
  out.deal_team = raw.deal_team || null;
  out.broker = raw.broker || null;
  out.sale_price = num(raw._sale_price);
  out.cap_rate = num(raw._cap_rate);
  out.close_date = toIsoDate(raw._closing_date);
  const cs = splitCityState(raw.city_state);
  out.city = cs.city;
  out.state = cs.state;

  out.sf_opportunity_id = firstSfIdFor(html, 'Opportunity');
  out.seller_account_id = accountIdAfterLabel(html, 'Seller Company');
  out.buyer_account_id = accountIdAfterLabel(html, 'Buyer Company');

  out.ok = !!(out.deal_name || (out.city && out.state));
  return out;
}
