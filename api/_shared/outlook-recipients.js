// ============================================================================
// Outlook recipient / sender parsing — display-name preservation (Prompt 96)
// ----------------------------------------------------------------------------
// The Outlook correspondence loggers (handleOutlookSent, handleOutlookMessage /
// logInboundCorrespondenceDualAnchor, handleOutlookMessageExtract, the tagged
// path) historically FLATTENED Graph's `{ name, address }` recipient objects to
// the bare email string, so `activity_events.metadata.from`/`to` carried no
// display name. That starved the W9.4 comms-harvest arm (header-pair binding
// keys on the display name; see docs/audits/W9_4_comms_harvest_dryrun_*).
//
// These helpers ACCEPT the richer shapes Graph / Power Automate can send and
// preserve the name alongside the address. They are forward-only feedstock:
//   * parseAddress(token)   → { name, email } from a Graph object, a
//                             { name, email/address } object, or an RFC/Graph
//                             string ('Jane Roe <j@x.com>' | 'j@x.com').
//   * parseAddressList(v)   → [{ name, email }] from an array (of objects or
//                             strings) OR a ';'/','-delimited string. Only
//                             entries carrying a real email are kept.
//
// Never throws; a shape it can't read yields nulls, never a crash. No email is
// invented — a token with no address is dropped from a list (kept, email null,
// only when parsed as a lone sender via parseAddress).
// ============================================================================

function lower(s) { return s == null ? null : String(s).trim().toLowerCase() || null; }

// Minimal, dependency-free email shape check (the harvest planner does the
// authoritative normalize/validate on the read side; here we only need to tell
// an address token from a display-name token).
const EMAIL_SHAPE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
function looksLikeEmailToken(s) {
  return !!s && EMAIL_SHAPE.test(String(s).trim());
}

// Parse ONE address token (object or string) into { name, email }.
// email is lowercased; a token that is itself only an email yields name:null.
export function parseAddress(token) {
  if (token == null) return { name: null, email: null };

  // Graph shape: { emailAddress: { name, address } }
  if (typeof token === 'object') {
    if (token.emailAddress && typeof token.emailAddress === 'object') {
      return {
        name:  token.emailAddress.name ? String(token.emailAddress.name).trim() || null : null,
        email: lower(token.emailAddress.address),
      };
    }
    // Plain object: { name, email } or { name, address }
    const email = lower(token.email || token.address);
    const name = token.name ? String(token.name).trim() || null : null;
    // A "name" that is itself the email is not a display name.
    return { name: name && !looksLikeEmailToken(name) ? name : null, email };
  }

  // String: 'Name <email>' | '"Doe, John" <email>' | 'email'
  const s = String(token).trim();
  if (!s) return { name: null, email: null };
  const m = s.match(/^(.*?)<\s*([^<>]+?)\s*>\s*$/);
  if (m) {
    let name = m[1].trim().replace(/^["']|["']$/g, '').trim();
    const email = looksLikeEmailToken(m[2]) ? lower(m[2]) : null;
    if (name && looksLikeEmailToken(name)) name = '';
    return { name: name || null, email };
  }
  if (looksLikeEmailToken(s)) return { name: null, email: lower(s) };
  // A lone display name with no address.
  return { name: s.replace(/^["']|["']$/g, '').trim() || null, email: null };
}

// Split a delimited recipient STRING into individual tokens. Recipient lists use
// ';' as the primary separator (Outlook / Graph); a display name may itself carry
// a comma ('Doe, John <j@x>'), so we split on ',' ONLY when there is no ';' and
// the pieces look like bare emails (no angle-bracket forms present).
function splitRecipientString(str) {
  const s = String(str || '');
  if (!s.trim()) return [];
  let parts = s.split(/[;\n\r]+/).map((t) => t.trim()).filter(Boolean);
  // If there were no ';' separators but the single blob holds multiple bare
  // emails separated by commas, split those. Skip when angle-bracket display
  // forms are present (a comma there is inside a quoted name).
  if (parts.length === 1 && !parts[0].includes('<') && parts[0].includes(',')) {
    parts = parts[0].split(',').map((t) => t.trim()).filter(Boolean);
  }
  return parts;
}

// Parse a recipient value (array or delimited string) into [{ name, email }].
// Only entries with a real email are kept (a create-contact / header-pair needs
// an address to bind to). Deduped by email. Never throws.
export function parseAddressList(value) {
  if (value == null) return [];
  let tokens;
  if (Array.isArray(value)) {
    tokens = value;
  } else if (typeof value === 'string') {
    tokens = splitRecipientString(value);
  } else if (typeof value === 'object') {
    tokens = [value]; // a lone Graph/plain object
  } else {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const t of tokens) {
    const { name, email } = parseAddress(t);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ name: name || null, email });
  }
  return out;
}

// Convenience: pull the first available display name for a parsed sender/list.
export function firstNameFor(pairs, email) {
  const e = lower(email);
  for (const p of (pairs || [])) {
    if (p && p.email === e && p.name) return p.name;
  }
  return null;
}
