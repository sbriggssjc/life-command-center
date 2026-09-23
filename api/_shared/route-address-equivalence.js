// GOV-CLASSIFY1 (2026-09-23) — numbered-route spelling equivalence.
//
// One building, several spellings of the road it sits on. Measured live:
// gov 16268 stores "49870 Ca-139"; the CoStar capture of the same building
// reads "49870 State Highway 139". gov_normalize_address folds the hyphen
// ("49870 ca 139") but not the words, so no existing lookup ever matched and
// the capture failed no_domain. The Malta MT pair (16193 / 40643) is the
// US-route form of the same defect ("US-2" / "US Highway 2").
//
// This module answers one narrow question: do two street strings name the
// SAME numbered route? It parses the route into (kind, number, tail) and
// compares those. It never scores and never guesses a civic number — the
// caller compares civic numbers exactly and requires a unique match.
//
// kind:
//   'us'    — US-2, US 2, U.S. 2, US Highway 2, US Hwy 2, US Route 2
//   'state' — CA-139, CA 139, CA Hwy 139, State Highway 139, State Hwy 139,
//             State Route 139, State Road 139, SR-139, SR 139, SH 139
//             (a 2-letter prefix counts only when it equals the capture's state)
//   'any'   — Highway 139, Hwy 139, Route 139, Rte 139 (the bare form names
//             no system, so it is compatible with both 'us' and 'state')
//
// Pure — unit-tested in test/gov-classify1-existing-record-first.test.mjs.

const US_STATE_CODES = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la',
  'me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok',
  'or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc','pr',
]);

const ROUTE_WORD = '(?:highway|hwy|route|rte|rt)';
// A route number: digits NOT followed by an ordinal suffix or more digits, so
// "NE 139th St" / "Route 13900" never read as route 139.
const NUM = '(\\d+)(?![0-9]|st\\b|nd\\b|rd\\b|th\\b)([a-z])?\\b';

const US_RE = new RegExp(`^(?:u s|us)\\s+(?:${ROUTE_WORD}\\s+)?${NUM}(.*)$`);
const STATE_WORD_RE = new RegExp(`^(?:state|st)\\s+(?:highway|hwy|route|rte|rt|road|rd)\\s+${NUM}(.*)$`);
const SR_RE = new RegExp(`^(?:sr|sh|srt|shwy)\\s+${NUM}(.*)$`);
const CODE_RE = new RegExp(`^([a-z]{2})\\s+(?:${ROUTE_WORD}\\s+)?${NUM}(.*)$`);
const BARE_RE = new RegExp(`^${ROUTE_WORD}\\s+${NUM}(.*)$`);

function prepStreet(street) {
  return String(street || '')
    .toLowerCase()
    .replace(/\./g, ' ')          // "U.S." -> "u s "
    .replace(/[-–—]/g, ' ')       // "CA-139" -> "ca 139"
    .replace(/[,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^u s\b/, 'u s');
}

function cleanTail(tail) {
  // "37139 Us-26 Hwy" stores the route word AFTER the number; a trailing
  // highway/route word carries no identity.
  return String(tail || '')
    .replace(/\b(?:highway|hwy|route|rte|rt)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse the street portion (after the civic number) of an address into a
 * numbered-route descriptor, or null when it is not a numbered route.
 *   parseRouteStreet('State Highway 139', 'CA') -> { kind:'state', number:'139', tail:'' }
 *   parseRouteStreet('Ca-139', 'CA')            -> { kind:'state', number:'139', tail:'' }
 *   parseRouteStreet('US Highway 2 W', 'MT')    -> { kind:'us', number:'2', tail:'w' }
 *   parseRouteStreet('5th St', 'TN')            -> null
 */
export function parseRouteStreet(street, state) {
  const s = prepStreet(street);
  if (!s) return null;
  const st = String(state || '').trim().toLowerCase();
  const build = (kind, m, numIdx) => ({
    kind,
    number: m[numIdx] + (m[numIdx + 1] || ''),
    tail: cleanTail(m[numIdx + 2]),
  });
  let m = s.match(US_RE);
  if (m) return build('us', m, 1);
  m = s.match(STATE_WORD_RE);
  if (m) return build('state', m, 1);
  m = s.match(SR_RE);
  if (m) return build('state', m, 1);
  m = s.match(CODE_RE);
  if (m && US_STATE_CODES.has(m[1]) && st && m[1] === st) return build('state', m, 2);
  m = s.match(BARE_RE);
  if (m) return build('any', m, 1);
  return null;
}

function kindsCompatible(a, b) {
  return a === b || a === 'any' || b === 'any';
}

/**
 * true  — both streets are numbered routes naming the same road;
 * false — both are numbered routes and they differ (different number/system);
 * null  — at least one side is not a numbered route (no opinion).
 */
export function routeStreetsEquivalent(streetA, streetB, state) {
  const a = parseRouteStreet(streetA, state);
  const b = parseRouteStreet(streetB, state);
  if (!a || !b) return null;
  return a.number === b.number && a.tail === b.tail && kindsCompatible(a.kind, b.kind);
}
