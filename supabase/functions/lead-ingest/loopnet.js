// ============================================================================
// loopnet.js — LoopNet marketing-lead email parser (pure ESM)
//
// LoopNet (a CoStar property) emails Scott two kinds of lead notification, keyed
// off the subject line:
//
//   A. INQUIRY  — subject "LoopNet Lead for <property>". A prospect asked to
//      learn more about a listing. The body carries a buyer line
//      `From: <Name> | <phone> | <email> | (Listing ID : <digits>)`, the property
//      name + address, and a short message ("…would like to learn more…").
//      -> activity_type = 'loopnet_inquiry'
//
//   B. FAVORITE — subject "<Name> favorited <property>". A prospect favorited a
//      listing. The body reads "Your listing has been favorited by <Name>,"
//      followed by the buyer's email and phone on their own lines, then the
//      property address and use type.
//      -> activity_type = 'loopnet_favorite'
//
// rawBody is the email's HTML — strip tags to text FIRST, then parse the text.
//
// CRITICAL: the buyer's email/phone are NOT the first contact info in the body —
// the inquiry template lists the notified NorthMarq teammates ("To: …") first,
// so a naive "first @ in the body" grabs a teammate. We exclude internal /
// vendor domains (northmarq.com, loopnet.com, costar.com) when selecting the
// buyer email.
//
// This module is PURE ESM (no Deno/Node APIs) so it is imported by BOTH the Deno
// edge function (lead-ingest/index.ts) AND the node test (test/loopnet.test.mjs)
// with no drift. All I/O (DB, env) lives in the handler.
// ============================================================================

// Domains that are never the buyer: our own people + the sender/vendor.
export const INTERNAL_EMAIL_DOMAINS = /@(northmarq\.com|loopnet\.com|costar\.com)$/i;

// ── HTML → text ─────────────────────────────────────────────────────────────

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "'", lsquo: "'",
  ldquo: '"', rdquo: '"', copy: "©", reg: "®", trade: "™",
};

function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePointToStr(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePointToStr(parseInt(d, 10)))
    .replace(/&([a-z0-9]+);/gi, (m, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m;
    });
}

function codePointToStr(cp) {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try { return String.fromCodePoint(cp); } catch { return ""; }
}

// Strip an HTML email body to readable, line-oriented text. Also tolerant of a
// body that is already plain text (no tags) — it just falls through cleanly.
export function stripHtmlToText(html) {
  if (!html) return "";
  let t = String(html);
  // Drop comments (incl. MSO conditional junk) and style/script blocks first.
  t = t.replace(/<!--[\s\S]*?-->/g, " ");
  t = t.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Block-level boundaries -> newlines so table cells / paragraphs stay distinct.
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/(p|div|tr|td|th|h[1-6]|li|table|ul|ol)>/gi, "\n");
  // Strip any remaining tags.
  t = t.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  // Normalize whitespace (treat NBSP as a space; collapse runs; trim lines).
  t = t.replace(/\r/g, "");
  t = t.replace(/[ \t ​]+/g, " ");
  t = t.replace(/[ \t]*\n[ \t]*/g, "\n");
  t = t.replace(/\n{2,}/g, "\n");
  return t.trim();
}

// ── Small field helpers ─────────────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 10-digit US phone, optional area-code parens / separators, optional extension.
const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d+)?/i;

// The buyer email = the first email in the body that is NOT one of our own /
// the vendor's addresses.
export function pickBuyerEmail(text) {
  const all = String(text || "").match(EMAIL_RE) || [];
  for (const e of all) {
    if (!INTERNAL_EMAIL_DOMAINS.test(e)) return e;
  }
  return null;
}

function firstPhone(s) {
  const m = String(s || "").match(PHONE_RE);
  return m ? m[0].trim() : null;
}

function looksLikeName(s) {
  if (!s) return false;
  const v = s.trim();
  if (!v || v.length > 80) return false;
  if (/@/.test(v)) return false;                 // an email
  if (/\d{3}[-.\s)]?\d{3}/.test(v)) return false; // a phone
  if (/listing id/i.test(v)) return false;
  return /[A-Za-z]/.test(v);
}

function splitName(name) {
  if (!name) return { first: null, last: null };
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] || null, last: parts.slice(1).join(" ") || null };
}

// City / State / ZIP anywhere in the text: "Woodland Hills, CA 91367".
// Uses the FIRST occurrence, which is the subject property — the CoStar footer
// address ("Arlington, VA 22209") always appears later in the body.
function findCityStateZip(text) {
  const m = String(text || "").match(
    /([A-Za-z][A-Za-z .'\/-]+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/,
  );
  if (!m) return { match: null, city: null, state: null, zip: null };
  return { match: m[0], city: m[1].trim(), state: m[2], zip: m[3] };
}

// A standalone street line: starts with a house number. Excludes phones, emails,
// and "City, ST ZIP" lines (the char class has no comma, so those never match).
const STREET_LINE_RE = /^(\d{1,6}\s+[0-9A-Za-z][0-9A-Za-z .'#\/-]+)$/;

// Resolve the leased-premises street from the parsed lines. Handles both the
// inquiry layout ("<street> | City, ST ZIP" on one line) and the favorite layout
// ("<street>" then "City, ST ZIP" on separate lines).
function findStreet(lines, csz) {
  // (1) Same line as the City/State/ZIP, before a pipe: "20931 Burbank Blvd | Woodland Hills, CA 91367"
  if (csz.match) {
    const cszLine = lines.find((l) => l.includes(csz.match));
    if (cszLine && cszLine.includes("|")) {
      for (const seg of cszLine.split("|").map((s) => s.trim())) {
        if (seg === csz.match || (csz.city && seg.includes(csz.city))) continue;
        // A street segment starts with a house number and is not a "City, ST ZIP".
        if (/^\d{1,6}\s+\S/.test(seg) && !/,\s*[A-Z]{2}\s+\d{5}/.test(seg)) return seg;
      }
    }
  }
  // (2) A standalone street line — prefer the one just above the City/State line.
  const cszIdx = csz.match ? lines.findIndex((l) => l.includes(csz.match)) : -1;
  const ordered = cszIdx > 0 ? [lines[cszIdx - 1], ...lines] : lines;
  for (const l of ordered) {
    if (!l || /@/.test(l)) continue;
    if (csz.match && l.includes(csz.match)) continue;
    const m = l.match(STREET_LINE_RE);
    if (m) return m[1].trim();
  }
  return null;
}

// ── The parser ──────────────────────────────────────────────────────────────

export function parseLoopNetEmail(rawBody, subject) {
  const text = stripHtmlToText(rawBody || "");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const subj = (subject || "").trim();

  const isFavorite = /\bfavorited\b/i.test(subj) || /has been favorited/i.test(text);
  const activityType = isFavorite ? "loopnet_favorite" : "loopnet_inquiry";

  // ── buyer email (never internal / vendor) ──
  const email = pickBuyerEmail(text);

  // ── LoopNet listing id (inquiry template carries "(Listing ID : <digits>)") ──
  const listingIdMatch = text.match(/Listing\s*ID\s*[:#]?\s*(\d{4,})/i);
  const loopnetListingId = listingIdMatch ? listingIdMatch[1] : null;

  // ── name, phone, company (template-specific) ──
  let name = null;
  let phone = null;
  let company = null;
  let message = null;

  if (isFavorite) {
    // "Your listing has been favorited by <Name>," — take the text after
    // "favorited by" up to the segment boundary (a trailing comma/period or the
    // start of the next sentence). Preserves middle initials (e.g. "Jane Q. Broker").
    const favLine = lines.find((l) => /favorited by/i.test(l));
    if (favLine) {
      const m = favLine.match(/favorited by\s+(.+)$/i);
      if (m) {
        let n = m[1].split(/\s+(?:Below|If you|Contact|To\b)/i)[0]; // drop a trailing clause
        n = n.replace(/[,.;:]+\s*$/, "").trim();
        if (looksLikeName(n)) name = n;
      }
    }
    if (!name) {
      // Fall back to the subject: "<Name> favorited <property>".
      const subjMatch = subj.match(/^(.+?)\s+favorited\b/i);
      if (subjMatch && looksLikeName(subjMatch[1])) name = subjMatch[1].trim();
    }
    phone = firstPhone(text);
    message = (favLine && /has been favorited/i.test(favLine)) ? favLine : (favLine || null);
  } else {
    // Inquiry buyer line: "From: <Name> | <phone> | <email> | (Listing ID : …)".
    const fromLine = lines.find((l) => /^From:\s*/i.test(l));
    if (fromLine) {
      const rest = fromLine.replace(/^From:\s*/i, "").trim();
      const segs = rest.split("|").map((s) => s.trim()).filter(Boolean);
      const leftover = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (i === 0 && looksLikeName(seg)) { name = seg; continue; }
        if (!phone && PHONE_RE.test(seg) && !/@/.test(seg)) { phone = firstPhone(seg); continue; }
        if (/@/.test(seg)) continue;                 // the email (already picked globally)
        if (/listing id/i.test(seg)) continue;       // the listing-id segment
        leftover.push(seg);
      }
      // Any remaining non-name/phone/email/listing segment is a company (if any).
      const comp = leftover.find((s) => looksLikeName(s) && s !== name);
      if (comp) company = comp;
    }
    if (!phone) phone = firstPhone(text);
    // The inquiry message: "…I found <property> on LoopNet and would like to learn more…".
    message =
      lines.find((l) => /would like to learn more/i.test(l)) ||
      lines.find((l) => /I found .* on LoopNet/i.test(l)) ||
      null;
  }

  // ── property name + address ──
  let propertyName = null;
  if (!isFavorite) {
    const subjMatch = subj.match(/LoopNet\s+Lead\s+for\s+(.+)$/i);
    if (subjMatch) propertyName = subjMatch[1].trim();
  }
  // (Favorite: the subject property IS the address — no separate tenant/property name.)

  const csz = findCityStateZip(text);
  const street = findStreet(lines, csz);
  const cityState = [csz.city, csz.state].filter(Boolean).join(", ");
  const cityStateZip = [cityState, csz.zip].filter(Boolean).join(" ");
  const fullAddress = [street, cityStateZip].filter(Boolean).join(", ");

  // A single human-readable "property" string (used for display + fixture asserts):
  //   inquiry  -> "<Property Name> / <full address>"
  //   favorite -> "<full address>"
  const property = propertyName
    ? [propertyName, fullAddress].filter(Boolean).join(" / ")
    : (fullAddress || propertyName || null);

  const { first, last } = splitName(name);

  return {
    // Contact
    lead_name: name || null,
    lead_first_name: first,
    lead_last_name: last,
    lead_email: email,
    lead_phone: phone,
    lead_company: company || null,
    // Property
    property_name: propertyName,
    property_address: street || null,
    property_city: csz.city,
    property_state: csz.state,
    property_zip: csz.zip,
    property: property || null,          // combined display string
    // LoopNet's own listing id (NOT the SF listing id — see the future map note
    // in the handler). SF listing linkage stamps marketing_leads.listing_id.
    loopnet_listing_id: loopnetListingId,
    // Classification
    activity_type: activityType,
    message: message || null,
    // Alias so the shared SF-activity note snippet (matchAndCreateActivity) works.
    activity_detail: message || null,
    // deal_name is the SF-task subject / listing display; prefer the property name,
    // else the street, else the full address.
    deal_name: propertyName || street || fullAddress || subj || null,
  };
}
