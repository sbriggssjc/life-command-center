// ============================================================================
// W9.3 WS3 — SF donor-handoff planner (pure, dependency-free brain).
//
// THE GAP (traced live 2026-08-08): W9.2's deterministic reachability arm keys on
// a PERSON-level SF identity — domain `contacts.sf_contact_id` (+ dia
// `salesforce_id`). W4.3/W9.3 land an ORG-level key — owner `sf_account_id` (gov
// true_owners/recorded_owners) / `sf_company_id` (dia true_owners). Nothing bridges
// the two, so an owner-link never raises the person-key count W9.2 needs; only ~20
// blank contacts carry an SF key today.
//
// A DIRECT sf_account_id -> sf_contact_id copy is SEMANTICALLY INVALID (an account
// is not a person). The correct handoff is an ACCOUNT -> CONTACTS EXPANSION: given
// an owner now linked to SF account A, enumerate A's SF contacts from the local
// SF-contact bridge (gov `sf_contacts_import`, dia `salesforce_contacts`), NAME-MATCH
// each against the owner's blank domain contact rows (contacts linked via
// true_owner_id / recorded_owner_id), and FILL-BLANKS stamp the REAL person-level
// `sf_contact_id` onto the matched contact. Conservative: a UNIQUE name match only —
// ambiguity is skipped, never guessed; a contact that already carries an
// sf_contact_id is never overwritten; nothing is fabricated.
//
// The acceptance metric this raises: # of blank-reachability contacts carrying an
// SF key (baseline ~20). Rising = W9.2's deterministic donor pool unlocks.
//
// Pure: no IO, no throws. Live query/write side: api/admin.js::handleSfDonorHandoffTick.
// ============================================================================

// Domain column maps. gov contacts: name/email/phone; dia contacts:
// contact_name/contact_email/contact_phone. The person-key filled is always
// `sf_contact_id`.
export function donorContactCols(domain) {
  const d = domain === 'government' ? 'gov' : domain === 'dialysis' ? 'dia' : domain;
  return d === 'dia'
    ? { nameCol: 'contact_name', emailCol: 'contact_email', phoneCol: 'contact_phone', pkCol: 'contact_id' }
    : { nameCol: 'name', emailCol: 'email', phoneCol: 'phone', pkCol: 'contact_id' };
}

// The owner sf-key column on the domain owner tables (mirrors sf-link-review.js).
export function donorOwnerSfCol(domain) {
  const d = domain === 'government' ? 'gov' : domain === 'dialysis' ? 'dia' : domain;
  return d === 'gov' ? 'sf_account_id' : 'sf_company_id';
}

// Normalize a person name to an order-independent token SIGNATURE so
// "John A. Smith", "Smith, John A", "JOHN SMITH" collapse to one key. Drops
// punctuation, lowercases, sorts significant tokens. Single-letter tokens
// (middle initials) are dropped so an initial mismatch doesn't split a match.
export function personNameSig(s) {
  const toks = String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
  return [...new Set(toks)].sort().join(' ');
}

// Build the SF-contact-name signature index for ONE account's contacts.
// sfContacts: [{ sf_contact_id, name, email, phone }] (name pre-assembled by the
// caller: gov full_name, dia first+last). Value = de-duped array so ambiguity is
// detectable.
export function buildSfContactSig(sfContacts) {
  const map = new Map();
  for (const c of (sfContacts || [])) {
    const sig = personNameSig(c && c.name);
    if (!sig) continue;
    const id = c && c.sf_contact_id;
    if (!id) continue;
    let arr = map.get(sig);
    if (!arr) { arr = []; map.set(sig, arr); }
    if (!arr.some((x) => String(x.sf_contact_id) === String(id))) {
      arr.push({ sf_contact_id: String(id), email: c.email || null, phone: c.phone || null });
    }
  }
  return map;
}

// Plan the fill for ONE blank domain contact against an account's SF-contact sig
// index. Returns { fill, reason, sfContactId, sfEmail, sfPhone }.
//   fill=false when: the contact already carries an sf_contact_id (fill-blanks),
//   no name match, or an AMBIGUOUS match (>1 SF contact under this account share
//   the contact's name signature) — never guessed.
export function planDonorStamp({ contact, sigIndex } = {}) {
  const c = contact || {};
  const has = c.sf_contact_id != null && String(c.sf_contact_id).trim() !== '';
  if (has) return { fill: false, reason: 'already_has_sf_contact_id', sfContactId: null };
  const sig = personNameSig(c.name);
  if (!sig) return { fill: false, reason: 'no_name', sfContactId: null };
  const hit = sigIndex && sigIndex.get(sig);
  if (!hit || !hit.length) return { fill: false, reason: 'no_sf_contact_match', sfContactId: null };
  if (hit.length > 1) return { fill: false, reason: 'ambiguous_sf_contact', sfContactId: null };
  return {
    fill: true, reason: 'unique_name_match',
    sfContactId: hit[0].sf_contact_id, sfEmail: hit[0].email || null, sfPhone: hit[0].phone || null,
  };
}

// Idempotency key for a stamped contact (skip on re-run).
export function donorScoredKey(domain, contactId, sfContactId) {
  return String(domain) + '|' + String(contactId) + '|' + String(sfContactId);
}

// Bounded/budget-floored driver over the (owner -> contacts) work items.
export function scoreDonorWithBudget(items, fn, { maxN = 500, budgetMs = 60000, now } = {}) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  const start = clock();
  const out = [];
  let i = 0;
  let budgetExhausted = false;
  for (; i < items.length; i++) {
    if (out.length >= maxN) break;
    if (clock() - start >= budgetMs) { budgetExhausted = true; break; }
    const r = fn(items[i], i);
    if (r != null) out.push(r);
  }
  return { results: out, covered: i, budget_exhausted: budgetExhausted,
    capped: out.length >= maxN, remaining: Math.max(0, items.length - i) };
}
