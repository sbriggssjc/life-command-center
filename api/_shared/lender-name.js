// ── ORE follow-up (2026-07-16): lender-name CLEANER — sits IN FRONT of
// `resolveOrCreateLender` (sidebar-pipeline.js) so BOTH the deed-path lender and
// the one-time backfill of the ~1,755 messy CoStar text-lenders
// (dia `loans.lender_name` / gov `loans.originator`) resolve to a clean, dedupable
// display name. The dedup itself (normalized_name / lower(name) GET-then-insert)
// still lives in resolveOrCreateLender — this module only produces the DISPLAY
// name (or skips). The cleaner's quality IS the dedup quality.
//
// Doctrine (Scott): surface ambiguity, never guess. A broker-mashed / allocation-
// noted / suffix-variant name is transformed to its real lender; a genuinely
// ambiguous / non-lender string (multi-lender `;`, CMBS securitization trust code,
// placeholder `Private/Other`, bare generic fragment) is SKIPPED — left as a
// text-only row, never forced into `lenders`. Idempotent:
// cleanLenderName(cleanLenderName(x).clean).clean === cleanLenderName(x).clean.
//
// Grounded live 2026-07-16 (text-only rows, lender_id IS NULL):
//   dia   403 rows /  322 distinct: leading-broker ~99, cmbs ~12, semicolon 9,
//     bare-placeholder 9.
//   gov 1,352 rows /  800 distinct: leading-broker ~331, cmbs ~195, semicolon 77,
//     bare-placeholder 53 (Private/Other alone = 42).

// Curated brokerage / capital-intermediary firm prefixes CoStar mashes onto the
// originator. Anchored ^ so only a LEADING prefix is stripped (matched in a LOOP,
// so a co-broker chain "CBRE | Colliers <lender>" strips both). Superset of
// sf-nm-classifier `COMPETITOR_BROKER_RE` plus the debt-brokerage intermediaries
// + advisory firms that show up in the loan originator column.
export const BROKER_PREFIX_RE = new RegExp(
  '^(?:' +
    'marcus\\s*&\\s*millichap|m\\s*&\\s*m|mmi|' +
    'jones\\s+lang\\s+la\\s?salle|jll|' +
    'cushman\\s*&\\s*wakefield|cushman|wakefield|c\\s*&\\s*w|thalhimer|' +
    'cb\\s+richard\\s+ellis|cbre|' +
    'colliers(?:\\s+international)?|cassidy\\s*&\\s*pinkard(?:\\s+colliers)?|' +
    'cassidy\\s+turley|colliers\\s+turley\\s+martin\\s+tucker|turley\\s+martin\\s+tucker|' +
    'commerce\\s+crg|' +
    'newmark\\s+knight\\s+frank|newmark|' +
    'eastdil(?:\\s+secured)?|' +
    'hff|' +
    'grubb\\s*&\\s*ellis|' +
    'stan\\s+johnson(?:\\s+co(?:mpany)?)?|' +
    'avison\\s+young|' +
    'cornish\\s*&\\s*carey(?:\\s*/\\s*oncor)?|oncor|' +
    'the\\s+boulos\\s+co(?:mpany)?|' +
    'capital\\s+real\\s+estate\\s+group|capital\\s+pacific|' +
    'capital\\s+investment\\s+advisors|commercial\\s+investment\\s+advisors|' +
    'healthcare\\s+re\\s+capital|' +
    'faris\\s+lee(?:\\s+investments)?|latter\\s*&\\s*blum|friedman\\s+re\\s+group|' +
    'charles\\s+dunn|binswanger|carlton\\s+group|advantis(?:\\s+gva)?|gva\\s+advantis|' +
    'transwestern|trammell\\s+crow(?:\\s+co(?:mpany)?)?|sperry\\s+van\\s+ness|' +
    'voit(?:\\s+re\\s+services)?|spaulding\\s*&\\s*slye(?:\\s+colliers)?|klnb|' +
    'berkadia|walker\\s*&\\s*dunlop|northmarq|savills|kidder(?:\\s+mathews)?|' +
    'lee\\s*&\\s*associates|(?:the\\s+)?boulder\\s+group|' +
    'institutional\\s+property\\s+advisors|ipa|srs|nai|matthews|flagship|svn' +
  ')(?:\\s+|$)',
  'i'
);

// A CMBS / CDO securitization trust code is a DEBT vehicle, not a callable/BD-
// trackable lender — skip it (dominant gov junk after broker strip). Signals: a
// `YYYY-<letter>…` securitization series (2005-C20, 2007-LDP11, 2006-TOP23,
// 2015-GC29, 2018-CX11, 2012-C6…) or a known shelf acronym paired with a year
// (BACM 2006-1, GE 2001-1, MS 2006-TOP23). Checked on the ORIGINAL string (before
// broker strip) so "CBRE Wachovia 2005-C20" is skipped whole.
const CMBS_SERIES_RE = /\b(?:19|20)\d{2}-[A-Za-z]\w*/;               // year-dash-letter
const CMBS_SHELF_YEAR_RE = new RegExp(
  '\\b(?:bacm|bbcms|bmark|benchmark|cgcmt|comm|csail|csfb|cd|cobalt|gccf|gcms|' +
  'gsms|gs|jpmcc|jpmbb|jpmbc|lbubs|lb-ubs|lb|mlcfc|ml-cfc|msc|msbam|ms|wfcm|' +
  'wf-rbs|wfrbs|wf|bear|bscms|gecmc|gmac|citi|wachovia|cscf|cd)\\b\\s*(?:19|20)\\d{2}',
  'i'
);
function looksLikeCmbsCode(s) {
  return CMBS_SERIES_RE.test(s) || CMBS_SHELF_YEAR_RE.test(s);
}

// Real lending arms whose name STARTS with a broker firm — must NOT be stripped.
// (Marcus & Millichap Capital Corporation is M&M's balance-sheet lender, already a
// row in dia `lenders`.) Matched on the alloc-stripped, whitespace-collapsed name.
const LENDER_ARM_ALLOW = new Set([
  'marcus & millichap capital corporation',
  'marcus & millichap capital corp',
]);

// Bare/generic fragments + placeholders that are NOT a lender identity. A cleaned
// name reduced to one of these (or too short) is skipped, never created.
const BARE_GENERIC = new Set([
  'bank', 'banks', 'bank na', 'bank n a', 'trust', 'na', 'n a', 'one', 'america',
  'co', 'company', 'financial', 'financial corp', 'financial group', 'capital',
  'capital corp', 'capital corporation', 'corporation', 'corp', 'group', 'partners',
  'credit union', 'federal credit union', 'fcu', 'cu', 'lp', 'llc', 'inc',
  'private', 'other', 'private/other', 'privateother', 'unknown', 'n/a', 'na na',
  'seller', 'buyer', 'lender', 'various', 'undisclosed', 'insurance', 'life',
  'government agency', 'agency', 'cmbs', 'ca', 'bay', 'central ca',
]);

function collapse(s) {
  return String(s == null ? '' : s)
    .replace(/[™®℠]/g, ' ')   // ™ ® ℠ — CoStar decorates broker names
    .replace(/\s+/g, ' ')
    .trim();
}

// Strip a LEADING dash/bullet/pipe/paren and surrounding junk ("- HTLF" → "HTLF",
// "| Colliers …" → "Colliers …", "(PMC)" → "PMC)").
function stripLeadingJunk(s) {
  return s.replace(/^[\s\-–—•|/,;.()]+/, '');
}

// Remove allocation / amount parentheticals: ($1.5m alloc'd), ($1.0m approx),
// ($0.5m), (1.7 alloc'd), ($140.7m). Deliberately does NOT touch a state/qualifier
// parenthetical like "(AR)" / "(MN)" — those disambiguate a real bank name.
function stripAllocationNotes(s) {
  return s.replace(
    /\(\s*\$?\s*[\d][\d.,]*\s*[mk]?\s*(?:alloc'?d|allocated|approx\.?|mm)?\s*\)/gi,
    ' '
  );
}

// The "core" alnum length that guards too-short / bare fragments.
function coreLen(s) {
  return s.replace(/[^a-z0-9]/gi, '').length;
}

// Loop the broker-prefix strip so a co-broker chain ("CBRE | Colliers <lender>",
// "Cushman & Wakefield ; Grubb & Ellis <lender>") reduces to the trailing lender.
// Bounded (≤6) and only advances while it keeps consuming characters → terminates.
function stripBrokerPrefixes(s) {
  let cur = s, stripped = false;
  for (let i = 0; i < 6; i++) {
    const next = stripLeadingJunk(cur);
    const m = next.match(BROKER_PREFIX_RE);
    if (!m) { cur = next; break; }
    const remainder = collapse(next.slice(m[0].length));
    if (remainder === cur) break;   // no progress → stop
    cur = remainder;
    stripped = true;
    if (!cur) break;
  }
  return { s: cur, stripped };
}

/**
 * cleanLenderName(name) → { clean, skip, reason }
 *   clean  — the cleaned display name to hand to resolveOrCreateLender (null when skipped)
 *   skip   — true when the string is ambiguous/garbage (leave the row text-only)
 *   reason — one of: 'empty' | 'multi_lender' | 'cmbs_code' | 'placeholder_generic'
 *            | 'too_short' | 'broker_only'  (a broker firm with no real lender remainder)
 *   Non-skip reasons that annotate a transform: 'broker_prefix' | 'alloc_note' |
 *            'lender_arm' | 'clean'
 * Idempotent + pure. Never throws.
 */
export function cleanLenderName(name) {
  let s = stripLeadingJunk(collapse(name));
  if (!s) return { clean: null, skip: true, reason: 'empty' };

  // Multi-lender field ("… ; …") — do NOT pick one of many. Surface for review.
  if (s.includes(';')) return { clean: null, skip: true, reason: 'multi_lender' };

  // CMBS / CDO securitization trust — a debt vehicle, not a BD-trackable lender.
  if (looksLikeCmbsCode(s)) return { clean: null, skip: true, reason: 'cmbs_code' };

  let reason = 'clean';

  const withAlloc = s;
  s = collapse(stripAllocationNotes(s));
  if (s !== withAlloc) reason = 'alloc_note';
  if (!s) return { clean: null, skip: true, reason: 'empty' };

  // A genuine lending arm that starts with a broker firm — keep whole, don't strip.
  if (LENDER_ARM_ALLOW.has(s.toLowerCase())) return { clean: s, skip: false, reason: 'lender_arm' };

  // Strip a leading brokerage/intermediary prefix chain (co-brokers included).
  const b = stripBrokerPrefixes(s);
  if (b.stripped) {
    if (!b.s) return { clean: null, skip: true, reason: 'broker_only' };
    // A broker whose only remainder is a bare generic ("Capital Corporation",
    // "Bank", "Private/Other") is not a lender.
    if (BARE_GENERIC.has(b.s.toLowerCase())) return { clean: null, skip: true, reason: 'broker_only' };
    // A broker-stripped remainder that is itself a CMBS code (the broker mashed a
    // securitization trust) is not a lender.
    if (looksLikeCmbsCode(b.s)) return { clean: null, skip: true, reason: 'cmbs_code' };
    s = b.s;
    reason = 'broker_prefix';
  }

  const finalLower = s.toLowerCase();
  if (BARE_GENERIC.has(finalLower)) return { clean: null, skip: true, reason: 'placeholder_generic' };
  if (coreLen(s) < 4) return { clean: null, skip: true, reason: 'too_short' };

  return { clean: s, skip: false, reason };
}

export default cleanLenderName;
