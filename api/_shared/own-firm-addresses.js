// api/_shared/own-firm-addresses.js
//
// Guard against creating property records at the firm's OWN office /
// signature addresses. CRE OM/flyer extractors frequently grab the
// "For more information contact …" broker contact-block address instead of
// the subject property's address (the 6120 S Yale Ave case — 11 dia
// properties + 3 real active listings were created at the Briggs/Northmarq
// Tulsa office). This denylist is a defense-in-depth, model-independent
// guard: it runs regardless of what the AI returns.
//
// Add new office / signature / brokerage-HQ addresses here as they surface.
// Match is whitespace/punctuation-insensitive substring on the normalized
// address, so "6120 S. Yale Ave, Ste 300" and "6120 S Yale Ave Ste 300"
// both match the same entry.

export const OWN_FIRM_ADDRESSES = [
  '6120 s yale ave ste 300',   // Briggs / Northmarq office, Tulsa OK 74136
  '6120 s yale ave suite 300', // same, "suite" spelled out
  // add other office / signature addresses here
];

// Normalize to lowercase alphanumerics only (drops spaces, punctuation,
// ste/suite separators) so trivial formatting differences don't defeat it.
function normAddr(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const OWN_FIRM_NORM = OWN_FIRM_ADDRESSES.map(normAddr).filter(Boolean);

/**
 * True when `addr` is (or contains) one of the firm's own office addresses.
 * @param {string|null|undefined} addr
 * @returns {boolean}
 */
export function isOwnFirmAddress(addr) {
  if (!addr) return false;
  const n = normAddr(addr);
  if (!n) return false;
  return OWN_FIRM_NORM.some((own) => n.includes(own));
}
