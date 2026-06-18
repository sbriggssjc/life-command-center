// api/_shared/sf-id.js
// ============================================================================
// CONNECTIVITY #3 Unit 0 — Salesforce id matching + classification (ONE place)
// ----------------------------------------------------------------------------
// The two Salesforce link stores disagree on id LENGTH, not just on which
// owners are linked:
//   * domain DBs (dia true_owners.salesforce_id / gov true_owners.sf_account_id)
//     store the 15-char, CASE-SENSITIVE Salesforce id (with a few already 18).
//   * LCC external_identities(salesforce, Account|Contact) stores the 18-char
//     case-INsensitive id (the standard SOAP/REST canonical form).
//
// Matching the two with raw `=` reads EVERY real match as a mismatch (15 ≠ 18).
// So every comparison funnels through here:
//   * sf15(id)        → the first 15 chars (the case-sensitive natural key)
//   * sfIdsMatch(a,b) → compare by left-15 (case-sensitive), 15↔18 safe
//   * toSf18(id)      → the canonical 18-char form (standard SF checksum) — what
//                       we WRITE to external_identities so the store stays 18.
//   * classifySfId(id)→ object-type by the 3-char key prefix (001=Account, …)
//
// Only `001` Account ids flow into the Account reconciliation (Units 1-2); the
// classifier is what keeps a Contact (003) id from leaking into the Account
// store.
// ============================================================================

// Standard Salesforce 15→18 case-insensitive suffix alphabet.
const SF_SUFFIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

// 3-char key-prefix → SObject type (the subset we care about; everything else
// is reported as 'other' so it is visible but never auto-acted on).
const SF_KEY_PREFIX = {
  '001': 'Account',
  '003': 'Contact',
  '00Q': 'Lead',
  '006': 'Opportunity',
  '005': 'User',
};

/** Trim + stringify, returning null for empty/undefined. */
function clean(id) {
  if (id == null) return null;
  const s = String(id).trim();
  return s.length ? s : null;
}

/**
 * The 15-char case-sensitive natural key of a Salesforce id (the left 15 of an
 * 18-char id, or the id itself when already 15). Returns null for anything that
 * isn't a 15/18-char id.
 */
export function sf15(id) {
  const s = clean(id);
  if (!s) return null;
  if (s.length === 15) return s;
  if (s.length === 18) return s.slice(0, 15);
  return null;
}

/**
 * Do two Salesforce ids refer to the same record? Compares the 15-char
 * case-sensitive base, so a 15-char domain id and its 18-char LCC counterpart
 * match. Case-sensitive on purpose — SF 15-char ids ARE case-significant.
 */
export function sfIdsMatch(a, b) {
  const x = sf15(a);
  const y = sf15(b);
  return !!x && !!y && x === y;
}

/**
 * Canonical 18-char form (the standard Salesforce checksum extension). This is
 * what we WRITE to external_identities so the Account store stays uniformly
 * 18-char and a future 18-char capture of the same record collides cleanly.
 * Returns null for a non-15/18 input; an already-18 id is returned unchanged.
 */
export function toSf18(id) {
  const s = clean(id);
  if (!s) return null;
  if (s.length === 18) return s;
  if (s.length !== 15) return null;
  let suffix = '';
  for (let chunk = 0; chunk < 3; chunk++) {
    let bits = 0;
    for (let i = 0; i < 5; i++) {
      const c = s[chunk * 5 + i];
      if (c >= 'A' && c <= 'Z') bits |= (1 << i);
    }
    suffix += SF_SUFFIX_CHARS[bits];
  }
  return s + suffix;
}

/**
 * Classify a Salesforce id by its key-prefix. { kind, prefix }:
 *   kind ∈ Account | Contact | Lead | Opportunity | User | other | invalid
 *   prefix = the 3-char key prefix (or null when the id is malformed).
 */
export function classifySfId(id) {
  const s = clean(id);
  if (!s || (s.length !== 15 && s.length !== 18)) {
    return { kind: 'invalid', prefix: s ? s.slice(0, 3) : null };
  }
  const prefix = s.slice(0, 3);
  return { kind: SF_KEY_PREFIX[prefix] || 'other', prefix };
}

/** Convenience: is this an Account (001…) id? */
export function isAccountId(id) {
  return classifySfId(id).kind === 'Account';
}

/** Convenience: is this a Contact (003…) id? */
export function isContactId(id) {
  return classifySfId(id).kind === 'Contact';
}
