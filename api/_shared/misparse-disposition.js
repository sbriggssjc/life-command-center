// HP1-P2misparse (2026-09-12) — dispose the contact guard's blocks instead of
// notifying the broker about every one of them. PURE + dependency-free.
//
// GROUNDING (measured live on LCC Opps, 2026-09-12): `inbox_items` carried
// **130** `status='new'` rows of `source_type='contact_misparse_review'`
// (the backlog row said 117 — it is still growing), holding **307 rejected
// contacts across only 42 distinct (name, reason) pairs and ~26 properties**.
// `Equity Funds` was blocked 31 times, `View Less` 29, `Marcus & Millichap` 26.
//
// The guard's DECISIONS are correct. The defect is B6a over-applied: a skipped
// step must emit, but it must emit to a COUNTER, not to the broker's homepage.
// Nothing here changes what is blocked — only whether a human is told, and how
// often. `planContactMinting` (tm-misparse.js) remains the sole authority on
// mint-vs-block; this module only ever partitions the ALREADY-BLOCKED set.
//
// Four classes, four dispositions:
//   A. CoStar UI chrome ("View Less", "Demographics", "Public REIT")  -> silent
//   B. firms parsed as persons ("Marcus & Millichap", "Colliers")     -> notify
//                                                                        (BR1)
//   C. job titles in the name slot ("Executive Vice Chairman")        -> notify
//                                                                        + bug
//   D. email_fanout                                                   -> notify,
//      EXCEPT the one name that matches its email's local part, which is the
//      batch's true owner and is handed back to the mint set (see
//      `recoverFanoutOwner`).

// ── Class A: page furniture ────────────────────────────────────────────────
//
// EXACT, case-insensitive, whitespace-collapsed match ONLY — never a substring.
// P158a: a `contains` rule swallows real firms and real people ("Per SF" as a
// substring would eat a surname; "Demographics Group LLC" is a real-shaped
// name). Every entry below was observed VERBATIM in the live population as a
// CoStar page label, not as anyone's name. Adding an entry is a claim that the
// string is page furniture in every capture, everywhere — measure the blast
// radius over live `rejected_contacts` before adding one.
const NON_CONTACT_CHROME = new Set([
  'view less',
  'view more',
  'demographics',
  'public reit',
  'equity fund',
  'equity funds',
  'costar property contact',
  'per sf',
  'fund name',
  'owner name',
  'listing broker',
  'buyer broker',
  'seller broker',
]);

export function normalizeChromeKey(name) {
  return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True when a BLOCKED candidate's name is pure CoStar page furniture.
 *  Never consulted for minting — a chrome name is blocked by the guard either
 *  way; this only decides whether the broker hears about it. */
export function isNonContactChrome(name) {
  return NON_CONTACT_CHROME.has(normalizeChromeKey(name));
}

export function nonContactChromeNames() {
  return [...NON_CONTACT_CHROME];
}

// ── Dedupe key ─────────────────────────────────────────────────────────────
//
// One notification per (property, name, reason) — not one per capture. 307
// rejections collapse to 42 distinct (name, reason) pairs; re-notifying on
// every re-capture is what built the 130-row pile without a single new
// decision for the broker to make.
export function reviewDedupeKey(propertyEntityId, name, reason) {
  return [
    propertyEntityId == null ? '' : String(propertyEntityId),
    normalizeChromeKey(name),
    String(reason == null ? '' : reason),
  ].join('');
}

/** Partition an already-blocked review batch into what the broker is told
 *  about and what is only counted.
 *
 *  @param reviewItems  the `review` array from planContactMinting
 *  @param opts.propertyEntityId  property the capture is against
 *  @param opts.alreadyNotified   Set of reviewDedupeKey() strings already on
 *                                an open inbox row (suppresses re-notification)
 *  @returns { notify, silentChrome, duplicate } — the three arrays always
 *           partition the input exactly (no item is dropped unaccounted for). */
export function partitionReviewForNotification(reviewItems, opts = {}) {
  const items = Array.isArray(reviewItems) ? reviewItems : [];
  const propertyEntityId = opts.propertyEntityId ?? null;
  const already = opts.alreadyNotified instanceof Set ? opts.alreadyNotified : new Set();

  const notify = [];
  const silentChrome = [];
  const duplicate = [];
  const seen = new Set();

  for (const r of items) {
    const name = r?.contact?.name;
    if (isNonContactChrome(name)) { silentChrome.push(r); continue; }
    const key = reviewDedupeKey(propertyEntityId, name, r?.reason);
    if (already.has(key) || seen.has(key)) { duplicate.push(r); continue; }
    seen.add(key);
    notify.push(r);
  }
  return { notify, silentChrome, duplicate, keys: [...seen] };
}

// ── Class D: recover the one real contact inside a fan-out batch ───────────
//
// `email_fanout` fires when the scraper staples ONE broker's mailbox onto every
// name on the page. Blocking the batch is right — most of it is misattribution.
// But the local part identifies the mailbox's true owner: jcollins@ is James D.
// Collins, william.collins@ is William M. Collins. That one pairing is not
// fanout; it is the capture's real contact, and it was being thrown away with
// the collateral.
//
// STRICT and CONSERVATIVE by construction:
//   • exactly ONE name in the batch may match — a tie mints NOTHING (we cannot
//     tell which of two Collinses owns jcollins@, and guessing writes a person
//     onto a stranger's mailbox);
//   • an organization-shaped name can never be recovered (`southpace` matching
//     "Southpace Properties, Inc." is the firm, not a person) — the caller
//     injects the org test rather than this module re-implementing one, which
//     is the normaliser drift this repo keeps paying for;
//   • page chrome can never be recovered;
//   • the rules are whole-string equalities on a punctuation-stripped local
//     part — no fuzzy distance, no prefix scoring.

function nameTokens(name) {
  return String(name == null ? '' : name)
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')          // drop digits/punctuation, keep hyphen+apostrophe
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z]/g, ''))  // "o'brien" -> "obrien", "smith-jones" -> "smithjones"
    .filter((t) => t.length > 0);
}

function localPart(email) {
  const s = String(email == null ? '' : email).trim().toLowerCase();
  const at = s.indexOf('@');
  if (at <= 0) return '';
  return s.slice(0, at).replace(/[^a-z0-9]/g, '').replace(/[0-9]+$/, '');
}

/** Which strict rule (if any) proves `email`'s local part names `name`.
 *  Returns the rule name, or null. */
export function localPartMatchRule(email, name) {
  const lp = localPart(email);
  if (!lp || lp.length < 3) return null;
  const toks = nameTokens(name);
  // A middle initial is a single letter and is never part of a local part here;
  // first = first token, last = last token, both must be real words.
  if (toks.length < 2) return null;
  const first = toks[0];
  const last = toks[toks.length - 1];
  if (first.length < 2 || last.length < 2) return null;

  if (lp === first + last) return 'first_last';
  if (lp === last + first) return 'last_first';
  if (lp === first.charAt(0) + last) return 'initial_last';
  if (lp === first + last.charAt(0)) return 'first_initial';
  if (lp === last) return 'surname_only';
  if (lp === first && first.length >= 4) return 'firstname_only';
  return null;
}

/** Find the single true owner of a fan-out email inside its blocked batch.
 *
 *  @param reviewItems  the `review` array from planContactMinting
 *  @param opts.isOrganization  (contact) => boolean — injected; an org-shaped
 *                              candidate is never recoverable
 *  @returns { recovered: [{contact, email, rule}], refusals: [{email, reason, candidates}] } */
export function recoverFanoutOwner(reviewItems, opts = {}) {
  const items = Array.isArray(reviewItems) ? reviewItems : [];
  const isOrganization = typeof opts.isOrganization === 'function' ? opts.isOrganization : () => false;

  const byEmail = new Map();
  for (const r of items) {
    if (r?.reason !== 'email_fanout') continue;
    const em = String(r.email || r.contact?.email || '').toLowerCase().trim();
    if (!em) continue;
    if (!byEmail.has(em)) byEmail.set(em, []);
    byEmail.get(em).push(r);
  }

  const recovered = [];
  const refusals = [];
  for (const [em, batch] of byEmail) {
    const hits = [];
    for (const r of batch) {
      const name = r?.contact?.name;
      if (!name) continue;
      if (isNonContactChrome(name)) continue;
      if (isOrganization(r.contact)) continue;
      const rule = localPartMatchRule(em, name);
      if (rule) hits.push({ contact: r.contact, email: em, rule, item: r });
    }
    if (hits.length === 1) { recovered.push(hits[0]); continue; }
    if (hits.length > 1) {
      refusals.push({ email: em, reason: 'ambiguous_local_part', candidates: hits.map((h) => h.contact.name) });
    } else {
      refusals.push({ email: em, reason: 'no_local_part_match', candidates: batch.map((b) => b?.contact?.name).filter(Boolean) });
    }
  }
  return { recovered, refusals };
}
