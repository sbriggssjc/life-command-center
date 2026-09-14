// ============================================================================
// LCC Assistant — For-Sale/For-Lease "Contacts" panel parser (trailing-label)
// Pure, DOM-free helpers for CoStar's redesigned listing Contacts panel, which
// prints each contact as a NAME/FIRM line followed by its ROLE-LABEL line
// (trailing label) — the opposite of the comp-page layout where the role label
// HEADS the block. Loaded before costar.js (manifest order); also importable
// from Node for unit tests. Publishes `globalThis.__lccForSaleContacts`.
//
// WHY
//   On the for-sale summary the panel reads:
//       Newmark
//       Sales Company
//       2601 Olive St, Suite 1600
//       Dallas, TX 75201
//       United States
//       (469) 467-2000
//       Bradley Veo Timmons
//       True Owner
//       The Dalles, OR 97058
//       United States
//       (541) 980-2057
//   The comp-oriented leading-header handlers in costar.js see "Sales Company"
//   as a HEADER and sweep forward past Newmark's address/phone, capturing the
//   NEXT name ("Bradley Veo Timmons" — the True Owner) as a listing_broker and
//   stopping only at "True Owner". Result: the real owner is mislabeled the
//   broker. This module parses the block from the PRECEDING name instead, so the
//   firm and the owner each get their own correct role.
//
// SCOPE
//   These same label words HEAD the block on comp pages, so the caller gates
//   this parser on a for-sale/for-lease listing page (isForSaleContactsUrl).
// ============================================================================

(function () {
  'use strict';

  // label → role. "Sales Company/Contact", "Listing Contact/Broker" are the
  // listing (sell-side) broker; "Buyer Broker" the buy-side; owner labels map to
  // owner; property-manager to property_manager.
  const TRAILING_ROLE_LABEL = [
    [/^(?:sales?\s+comp(?:any|anies)|sales?\s+contacts?|listing\s+contacts?|listing\s+broker|listing\s+agent)$/i, 'listing_broker'],
    [/^buyer\s+broker$/i, 'buyer_broker'],
    [/^(?:true\s+owner|recorded\s+owner|current\s+owner)$/i, 'owner'],
    [/^property\s+manage(?:r|ment)$/i, 'property_manager'],
  ];

  function trailingRoleFor(label) {
    const s = (label == null ? '' : String(label)).trim();
    for (const [re, role] of TRAILING_ROLE_LABEL) if (re.test(s)) return role;
    return null;
  }

  function isPhone(s)     { return /^\(?\d{3}\)?\s*[-.]?\s*\d{3}[-.]?\d{4}/.test(s); }
  function isEmail(s)     { return /@/.test(s) && /\.\w{2,}$/.test(s) && !/^https?:/i.test(s); }
  function isURL(s)       { return /^(https?:\/\/|www\.)/i.test(s); }
  function isStreet(s)    { return /^\d+\s+\S/.test(s); }
  function isCityState(s) { return /^[A-Za-z].*,\s*[A-Z]{2}\s+\d{5}/.test(s); }

  // Reject obvious non-name lines (UI chrome, labels, country, page footer) so
  // the trailing-label trigger never fires on a stray section boundary. Firms
  // are single-token ("Newmark") so a space is NOT required here.
  const NAME_REJECT_RE = /^(?:united\s+states|contacts?|no\s+|not\s+available|source:|about\s+the|listing\s+id|©|by\s+using|costar|last\s+updated|report\s+an|public\s+transportation|documents|my\s+notes|sources|verification|terms\s+of|privacy|help\s+with|request\s+training|share\s+feedback|all\s+rights)/i;

  function looksLikeContactName(s) {
    const t = (s == null ? '' : String(s)).trim();
    if (t.length < 2 || t.length > 80) return false;
    if (!/^[A-Z0-9]/.test(t)) return false;
    if (/@/.test(t) || /^\d/.test(t)) return false;
    if (isPhone(t) || isEmail(t) || isURL(t) || isStreet(t) || isCityState(t)) return false;
    if (trailingRoleFor(t)) return false;          // a role label is not a name
    if (NAME_REJECT_RE.test(t)) return false;
    return true;
  }

  // A person name reads "First [M.] Last…"; anything else captured as a contact
  // name on this panel is treated as an organization/firm.
  function looksLikePerson(name) {
    const t = (name || '').trim();
    if (!/\s/.test(t)) return false;                          // single token → firm
    if (/\b(llc|l\.l\.c|lp|llp|inc|corp|co\.?|company|companies|trust|holdings?|partners|associates|properties|group|capital|ventures|management|realty|advisors?|newmark|cbre|jll|colliers)\b/i.test(t)) return false;
    return /^[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]*){1,3}$/.test(t);
  }

  // Where a trailing-label block ends: at the next block (a name line that is
  // itself followed by a role label), at a fresh role label, or at a section
  // boundary / page footer.
  function isBlockBoundary(lines, k) {
    const line = lines[k];
    if (line == null) return true;
    if (NAME_REJECT_RE.test(String(line).trim()) && !isPhone(line) && !isCityState(line) && !isStreet(line)) {
      // Footer/section words end the block; "United States" is handled as a
      // skippable detail line by the caller, so exclude it here.
      if (!/^united\s+states$/i.test(String(line).trim())) return true;
    }
    if (trailingRoleFor(line)) return true;                    // a lone next label
    if (looksLikeContactName(line) && trailingRoleFor(lines[k + 1])) return true; // next block
    return false;
  }

  // Parse ONE trailing-label block. `labelIdx` points at the role-label line;
  // the contact's name/firm is the immediately-preceding line. Returns the
  // contact plus `endIdx` = the last line index consumed (so the caller can
  // advance its cursor).
  function parseTrailingLabelBlock(lines, labelIdx, role) {
    const name = (lines[labelIdx - 1] == null ? '' : String(lines[labelIdx - 1])).trim();
    if (!name || !looksLikeContactName(name)) return null;

    const contact = {
      role,
      name,
      type: looksLikePerson(name) ? 'person' : 'organization',
      address: null, city: null, state: null, zip: null,
      phone: null, email: null, website: null,
    };

    let endIdx = labelIdx;
    for (let k = labelIdx + 1; k < lines.length; k++) {
      const line = String(lines[k] == null ? '' : lines[k]).trim();
      if (k - labelIdx > 12) break;                    // safety bound
      if (isBlockBoundary(lines, k)) break;
      endIdx = k;
      if (/^united\s+states$/i.test(line)) continue;
      if (isEmail(line))  { if (!contact.email) contact.email = line; continue; }
      if (isPhone(line))  { if (!contact.phone) contact.phone = line.replace(/\s*\([pPfFmMwW]\)\s*$/, '').trim(); continue; }
      if (isURL(line))    { if (!contact.website) contact.website = line; continue; }
      if (isCityState(line)) {
        const m = line.match(/^(.+),\s*([A-Z]{2})\s+(\d{5})/);
        if (m) { contact.city = m[1].trim(); contact.state = m[2]; contact.zip = m[3]; }
        continue;
      }
      if (isStreet(line)) { if (!contact.address) contact.address = line; continue; }
      // Any other line inside the block is ignored (suite/floor fragments, etc.)
    }
    // Strip null keys for a clean contact object.
    for (const key of Object.keys(contact)) if (contact[key] == null) delete contact[key];
    return { contact, endIdx };
  }

  // Scan the whole `lines` array for trailing-label blocks and return the
  // contacts. Standalone entry point (used by tests); costar.js integrates the
  // per-block parse inline so it can suppress the leading-header handlers.
  function parseForSaleContacts(lines) {
    const out = [];
    if (!Array.isArray(lines)) return out;
    for (let i = 1; i < lines.length; i++) {
      const role = trailingRoleFor(lines[i]);
      if (!role) continue;
      if (!looksLikeContactName(lines[i - 1])) continue;
      const parsed = parseTrailingLabelBlock(lines, i, role);
      if (parsed && parsed.contact && parsed.contact.name) {
        out.push(parsed.contact);
        i = parsed.endIdx;   // skip past the consumed detail lines
      }
    }
    return out;
  }

  function isForSaleContactsUrl(url) {
    return /\/(for-sale|for-lease)\//i.test(url || '');
  }

  // ── Structured figure mapper (preferred path) ────────────────────────────
  // CoStar's redesigned Contacts panel is a clean, data-testid-labelled DOM
  // (a <figure> per contact). The DOM adapter in costar.js extracts one raw
  // record per figure; this PURE mapper turns those records into roled
  // contacts. Keeping the mapping pure makes the role/type/address logic
  // Node-testable without a DOM.
  //
  // Raw figure record shape:
  //   { name, jobTitle, designation, company, email, phones:[], addressLines:[] }
  //   `designation` is the company card's type line ("Sales Company",
  //   "True Owner", "Recorded Owner", "Property Manager"); a PERSON card
  //   (broker agent) has a jobTitle ("Associate") and no designation.
  function mapForSaleFigures(figures) {
    const out = [];
    if (!Array.isArray(figures)) return out;
    for (const f of figures) {
      if (!f || !f.name || typeof f.name !== 'string') continue;
      const name = f.name.trim();
      if (!looksLikeContactName(name)) continue;

      // Role: a designation line maps directly; a designation-less person card
      // is the listing agent (sell-side broker). An unmapped designation is
      // skipped (never guess a role).
      let role = null;
      if (f.designation && String(f.designation).trim()) {
        role = trailingRoleFor(f.designation);
        if (!role) continue;
      } else {
        role = 'listing_broker';
      }

      const contact = {
        role,
        name,
        type: looksLikePerson(name) ? 'person' : 'organization',
        address: null, city: null, state: null, zip: null,
        phone: null, email: null, company: null,
      };
      if (f.company && String(f.company).trim()) contact.company = String(f.company).trim();

      // Address lines → street + city/state/zip (skip "United States"/blanks).
      const addrLines = Array.isArray(f.addressLines) ? f.addressLines : [];
      for (const raw of addrLines) {
        const line = String(raw == null ? '' : raw).trim();
        if (!line || /^united\s+states$/i.test(line)) continue;
        if (isCityState(line)) {
          const m = line.match(/^(.+),\s*([A-Z]{2})\s+(\d{5})/);
          if (m) { contact.city = m[1].trim(); contact.state = m[2]; contact.zip = m[3]; }
        } else if (isStreet(line) && !contact.address) {
          contact.address = line;
        }
      }

      // Phones: first valid → phone; keep the full de-duped list on phones[].
      const rawPhones = Array.isArray(f.phones) ? f.phones : (f.phone ? [f.phone] : []);
      const phones = [];
      for (const p of rawPhones) {
        const s = String(p == null ? '' : p).replace(/\s*\([pPfFmMwW]\)\s*$/, '').trim();
        if (isPhone(s) && !phones.includes(s)) phones.push(s);
      }
      if (phones.length) { contact.phone = phones[0]; contact.phones = phones; }

      const email = (typeof f.email === 'string' ? f.email.trim() : '');
      if (email && isEmail(email)) contact.email = email;

      for (const key of Object.keys(contact)) if (contact[key] == null) delete contact[key];
      out.push(contact);
    }
    return out;
  }

  const api = {
    parseForSaleContacts,
    parseTrailingLabelBlock,
    mapForSaleFigures,
    trailingRoleFor,
    looksLikeContactName,
    looksLikePerson,
    isForSaleContactsUrl,
  };

  if (typeof globalThis !== 'undefined') globalThis.__lccForSaleContacts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
