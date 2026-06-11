// ============================================================================
// Folder-Feed classifier + path anchor — pure helpers (no DB / network imports)
// Life Command Center · Phase 2, Slice 1
//
// Shared by the cloud worker (api/_handlers/folder-feed.js) and the local
// backfill script (scripts/folder-feed-backfill.mjs) so the filename classifier
// and the path→subject_hint anchor have ONE implementation. Kept dependency-free
// so the CLI script can import it without pulling the whole intake chain.
// ============================================================================

// Dialysis operator / government cues used to infer the vertical from the
// tenant-brand folder name. Deliberately small + anchored on whole words so a
// brand like "Federal Realty" doesn't false-positive to gov.
export const DIA_CUES = /\b(dialysis|davita|fresenius|us\s*renal|american\s*renal|satellite|dva|nephrology|kidney)\b/i;
export const GOV_CUES = /\b(gsa|ssa|dhs|fbi|irs|va|usda|federal|government|gov't|agency|social\s*security)\b/i;

// ── LCC write-back marker (Phase 2, Slice 2b) ───────────────────────────────
// Every deliverable LCC writes back into a property folder is tagged ` [LCC]`
// in its filename. This is the SINGLE source of truth for that marker so the
// re-ingest guard (classifyFile) and the write-back tagger (ensureLccTag) can
// never diverge. Detection is case-insensitive and space-agnostic.
export const LCC_TAG = ' [LCC]';

/** True when a filename carries the LCC write-back marker. */
export function hasLccTag(name) {
  return /\[lcc\]/i.test(String(name || ''));
}

/**
 * Insert the ` [LCC]` marker before the extension if not already present, so a
 * re-ingest of our own deliverable classifies as lcc_generated (skipped), never
 * re-extracted as third-party intel.
 * @param {string} fileName
 * @returns {string}
 */
export function ensureLccTag(fileName) {
  const name = String(fileName || '').trim() || 'document.pdf';
  if (hasLccTag(name)) return name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}${LCC_TAG}`;
  return `${name.slice(0, dot)}${LCC_TAG}${name.slice(dot)}`;
}

/**
 * Never overwrite an existing SharePoint file — when `name` collides with a
 * name already in the destination folder, append ` (YYYY-MM-DD)` (then a short
 * `-N` counter) before the extension. Write-back is additive, never destructive.
 * @param {string} name              the desired (already [LCC]-tagged) file name
 * @param {Set<string>|string[]} existing  names present in the destination folder
 * @returns {string}                 a name guaranteed absent from `existing`
 */
export function dedupeFileName(name, existing) {
  const lc = new Set(
    (existing instanceof Set ? [...existing] : (existing || [])).map(s => String(s).toLowerCase())
  );
  if (!lc.has(String(name).toLowerCase())) return name;
  const dot  = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot) : '';
  const date = new Date().toISOString().slice(0, 10);
  let candidate = `${stem} (${date})${ext}`;
  let n = 2;
  while (lc.has(candidate.toLowerCase())) {
    candidate = `${stem} (${date}-${n})${ext}`;
    n++;
  }
  return candidate;
}

/**
 * Filename-first classifier (cheap). Only om/flyer are STAGED this slice; every
 * other recognized type is recorded with its detected_type so later units can
 * light them up without re-walking the tree.
 * @param {string} name  filename (extension included)
 * @returns {{type:string, isOm:boolean}}
 */
export function classifyFile(name) {
  const fn = String(name || '').trim();
  const lower = fn.toLowerCase();
  const ext = (lower.split('.').pop() || '');

  // Slice 2b re-ingest guard — a file we authored + wrote back (` [LCC]` tag) is
  // OUR output, not new market intel. Record it (skipped/lcc_generated) and
  // NEVER re-extract it. Checked FIRST so an `… OM [LCC].pdf` doesn't fall into
  // the OM branch below and re-ingest our own BOV/OM as a third-party doc.
  if (hasLccTag(fn)) return { type: 'lcc_generated', isOm: false };

  // OM / flyer / marketing — the only types this slice extracts. Restrict to
  // PDF (the OM extractor's wheelhouse); a "*OM*.xlsx" is a master sheet, not an
  // OM, and is handled by the tabular branch below.
  if (ext === 'pdf' && /\b(om|offering|flyer|marketing|brochure|teaser)\b/i.test(lower)) {
    return { type: 'om', isOm: true };
  }
  if (/\b(lease|abstract|estoppel)\b/i.test(lower)) return { type: 'lease', isOm: false };
  if (/\b(rent\s*roll|master|inventory)\b/i.test(lower)) return { type: 'master', isOm: false };
  if (/\b(comp|comparable)s?\b/i.test(lower)) return { type: 'comp', isOm: false };
  if (/\b(bov|valuation)\b/i.test(lower)) return { type: 'bov', isOm: false };
  if (/\b(tax|cim|psa|dd|due\s*diligence|title)\b/i.test(lower)) return { type: 'dd', isOm: false };
  return { type: 'unknown', isOm: false };
}

// ── Archive / working-folder exclusion (Phase 2, Slice 2f) ──────────────────
// Some On Market subfolders are NOT live-deal sources and must never be ingested
// or re-surface as deferred backlog:
//   • /OLD/, /Archive/, /Archived/ path SEGMENTS — deprecated listings.
//   • leading-underscore working/staging folders (e.g. "_added or updated in
//     comps spreadsheet") — scratch, not deal docs.
// Each pattern is anchored to a WHOLE path SEGMENT so a tenant legitimately named
// "Old Dominion …" (segment "Old Dominion", not "OLD") is NOT caught. Keep the
// list small + named — extend it here, in one place.
export const EXCLUDED_FOLDER_SEGMENT_RES = [/^old$/i, /^archive$/i, /^archived$/i];

/**
 * True when ANY '/'-delimited segment of `folderPath` is an archive segment
 * (OLD/Archive/Archived) or a leading-underscore working/staging folder. Treats
 * every segment as a FOLDER — call with a folder path, or with a file's PARENT
 * directory (never the bare filename) so a `_draft.pdf` file in a clean folder
 * isn't false-excluded.
 * @param {string} folderPath
 * @returns {boolean}
 */
export function isExcludedFolderPath(folderPath) {
  const segs = String(folderPath || '').replace(/\\/g, '/').split('/').map(s => s.trim()).filter(Boolean);
  return segs.some(seg =>
    seg.startsWith('_') || EXCLUDED_FOLDER_SEGMENT_RES.some(re => re.test(seg))
  );
}

// ── City/ST + street-address + portfolio recovery (Phase 2, Slice 2d.1) ─────
// The PROPERTIES tree rarely follows the clean PROPERTIES/<tenant>/<City, ST>/
// shape: the "City, ST" usually lives in the FILENAME ("… - Austin, TX - …")
// or is fused into the tenant folder ("Cypress Grove Office - Greenville, MS"),
// and a large share of folders are multi-property PORTFOLIOS. These pure
// helpers recover that signal so the light attach can resolve a single
// in-domain property — or correctly REFUSE (portfolio / out-of-universe).

const STREET_SUFFIX = '(?:Ave|Avenue|St|Street|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Hwy|Highway|Pkwy|Parkway|Ct|Court|Pl|Place|Cir|Circle|Ter|Terrace|Trl|Trail|Sq|Square|Loop|Pike|Expressway|Expy)';

// Multi-property markers — a portfolio folder/master sheet covers MANY
// properties, so it must never single-attach. Tagged for the Stage-B fan-out.
const PORTFOLIO_RE = /\bportfolios?\b|\bof\s+(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,3})\b|\(\s*\d{1,3}\s*\)|\b[A-Z]{2}\s*&\s*[A-Z]{2}\b/i;

/**
 * Find a "City, ST" pair anywhere in a string (filename or fused folder name),
 * not just anchored at the segment end. Takes the LAST valid occurrence and
 * strips any tenant prefix joined by a space-adjacent dash (Slice 2g). Returns
 * {city, state} or null.
 */
export function extractCityState(text) {
  return splitCityState(text);
}

/** Extract a leading "<number> <street> <suffix>" address, else null. */
export function extractStreetAddress(text) {
  const s = String(text || '');
  const m = s.match(new RegExp(`\\b(\\d{1,6}\\s+[A-Za-z0-9.'# ]{1,40}?\\b${STREET_SUFFIX})\\b`, 'i'));
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/** True when any part names a multi-property portfolio. */
export function isPortfolioHint(...parts) {
  return parts.some(p => PORTFOLIO_RE.test(String(p || '')));
}

/**
 * Reduce a tenant-folder label to a matchable tenant CORE by stripping the
 * fused "- City, ST", portfolio descriptors, "(N)" counts, trailing "- ST" /
 * "- PA & TN", and trailing ALL-CAPS broker initials ("- HEDRICK"). So
 * "FMC Portfolio of 14 - Capital Square" → "FMC", "Cypress Grove Office -
 * Greenville, MS" → "Cypress Grove Office". Falls back to the original when the
 * cleanup would empty it.
 */
export function tenantCore(tenant) {
  let t = String(tenant || '');
  t = t.replace(/[-,]\s*[A-Za-z.'/ ]+,\s*[A-Z]{2}\s*$/, '');     // trailing - City, ST
  t = t.replace(/\s*[-(]?\s*Portfolio\b.*$/i, '');                // Portfolio …
  t = t.replace(/\(\s*\d+\s*\)\s*$/, '');                         // (N)
  t = t.replace(/-\s*[A-Z]{2}(\s*&\s*[A-Z]{2})?\s*$/, '');        // - ST / - PA & TN
  t = t.replace(/-\s*[A-Z][A-Z]{2,}(\s+[A-Z]{2,})*\s*$/, '');     // - HEDRICK / - BRIGGS HERROLD
  return t.replace(/[-–—\s]+$/, '').trim() || String(tenant || '').trim();
}

// USPS 2-letter codes (50 states + DC + PR). Used to validate a filename-derived
// "City, ST" token so a stray 2-caps token (`- Memo, XX`) never false-positives
// into a city/state. Kept inline so this module stays dependency-free (the CLI
// backfill imports it without pulling the intake chain).
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR',
]);

// A space-adjacent dash (" - ", "Foo- Bar", "Foo -Bar") — the boundary between a
// tenant/descriptor PREFIX and the real "City, ST". A bare hyphen with NO
// adjacent space (Winston-Salem) is part of the city, never a separator.
const TENANT_PREFIX_SEP_RE = /\s[-–—]|[-–—]\s/g;

/**
 * Slice 2g — the ONE "City, ST" extractor shared by every parser. Reads the LAST
 * "<run>, <ST>" pair (cities sit near the end of a folder/file label) where the
 * run is city-legal characters (letters, space, period, apostrophe, slash,
 * hyphen) and ST is a real US/territory code. The captured run keeps INTERNAL
 * hyphens (Winston-Salem) but DROPS any tenant prefix joined by a space-adjacent
 * dash:
 *   "DaVita Anchored - Tracy, CA"          → Tracy, CA
 *   "KCMO - 4601 Madison - Kansas City, MO" → Kansas City, MO   (digits break the run)
 *   "Stone Oak MOB - San Antonio, TX"       → San Antonio, TX
 *   "Winston-Salem, NC"                     → Winston-Salem, NC  (no spaced dash)
 *   "Tracy, CA"                             → Tracy, CA
 * Returns {city, state} or null.
 * @param {string} text
 * @returns {{city:string, state:string}|null}
 */
function splitCityState(text) {
  const s = String(text || '').replace(/\.[A-Za-z0-9]{1,5}$/, ' ').trim(); // drop extension
  if (!s) return null;
  // Every "<run>, <ST>" candidate; take the LAST whose ST is a real state.
  const re = /([A-Za-z][A-Za-z.'/ -]*?)\s*,\s*([A-Z]{2})(?![A-Za-z])/g;
  let m, last = null;
  while ((m = re.exec(s)) !== null) {
    if (US_STATE_CODES.has(m[2])) last = m;
  }
  if (!last) return null;
  let city = last[1].trim();
  // Strip a tenant/descriptor prefix joined by a space-adjacent dash — keep only
  // the part AFTER the last such separator. Internal (un-spaced) hyphens survive.
  let cut = -1, sm;
  TENANT_PREFIX_SEP_RE.lastIndex = 0;
  while ((sm = TENANT_PREFIX_SEP_RE.exec(city)) !== null) cut = sm.index + sm[0].length;
  if (cut >= 0) city = city.slice(cut);
  city = city.replace(/^[-–—\s]+/, '').replace(/\s+/g, ' ').trim();
  if (!city) return null;
  return { city, state: last[2] };
}

/**
 * Slice 2e — parse "City, ST" out of a FILENAME (the actual PROPERTIES tree has
 * no City, ST folder level; the city/state live in the file name, e.g.
 * "Vervent - Portland, OR (Master Sheet).xlsx"). Returns {city, state} only when
 * BOTH parse AND the state is a real US state; otherwise null (a pure rollup name
 * like "ARA Portfolio of 5 - Master Sheet.xlsx" correctly returns null).
 *
 * Slice 2g — delegates the actual parse to the shared splitCityState core so a
 * tenant prefix ("DaVita Anchored - Tracy, CA") is stripped to the bare city
 * while a legitimately hyphenated city ("Winston-Salem, NC") is preserved.
 * @param {string} fileName
 * @returns {{city:string, state:string}|null}
 */
export function parseCityStateFromFilename(fileName) {
  let stem = String(fileName || '').replace(/\\/g, '/');
  stem = stem.split('/').pop() || '';
  // Drop the extension and any trailing parenthetical label group(s) so a
  // "(Stan Johnson Company)" credit can never be mistaken for the City, ST.
  stem = stem.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  stem = stem.replace(/(?:\s*\([^)]*\))+\s*$/, '').trim();
  if (!stem) return null;
  return splitCityState(stem);
}

/**
 * Slice 2e — true when a subject_hint looks like a multi-property rollup with no
 * resolvable City, ST: a `Portfolio` bucket OR a tenant carrying "Portfolio"
 * ("ARA Portfolio of 5"), and no city/state. Such files legitimately don't map
 * to ONE property, so the caller parks them (skipped) instead of churning the
 * match_disambiguation lane. A rollup-bucket file whose FILENAME still resolves a
 * City, ST (e.g. "Thrive - San Antonio, TX") is NOT a rollup — it maps to one
 * property — so the city/state guard returns false there.
 * @param {{tenant_brand:?string, city:?string, state:?string, bucket:?string}} hint
 * @returns {boolean}
 */
export function looksLikePortfolioRollup(hint) {
  if (!hint || hint.city || hint.state) return false;
  const tenant = String(hint.tenant_brand || '').trim();
  if (!tenant) return false;
  const bucket = String(hint.bucket || '').trim();
  if (/^portfolio$/i.test(bucket)) return true;     // PROPERTIES/Portfolio/<tenant>
  if (/\bportfolio\b/i.test(tenant)) return true;    // "… Portfolio of N", "… Portfolio (N)"
  return false;
}

/**
 * Build the subject_hint match anchor from a path before any content parse.
 * PROPERTIES/<bucket>/<TENANT or BRAND>[/<City, ST>]/…files
 * @param {string} serverRelativePath  '/'-joined path (server-relative or local-relative)
 * @returns {{tenant_brand:?string, tenant_core:?string, city:?string, state:?string,
 *            address:?string, vertical:?string, bucket:?string, is_portfolio:boolean}}
 */
export function parseSubjectHintFromPath(serverRelativePath) {
  const raw = String(serverRelativePath || '').replace(/\\/g, '/');
  const segs = raw.split('/').map(s => s.trim()).filter(Boolean);
  const fileName = segs.length ? segs[segs.length - 1] : '';

  const hint = { tenant_brand: null, tenant_core: null, city: null, state: null, address: null, vertical: null, bucket: null, is_portfolio: false };

  // Research-root vertical (e.g. "Dialysis Research" / "Gv't Leased Research").
  for (const s of segs) {
    if (/dialysis\s*research/i.test(s)) hint.vertical = 'dia';
    else if (/(gv'?t|gov(ernment)?)\s*leased?\s*research/i.test(s)) hint.vertical = 'gov';
  }

  // PROPERTIES/<bucket>/<tenant_brand>[/<City, ST>]
  // Slice 2g — parse each segment through the shared splitCityState core so a
  // fused "DaVita Anchored - Tracy, CA" folder yields the BARE city ("Tracy"),
  // not the tenant-prefixed whole segment, while "Winston-Salem, NC" is kept
  // intact. The greedy `^(.+), ST$` segment regex did neither.
  const propIdx = segs.findIndex(s => /^properties$/i.test(s));
  if (propIdx !== -1) {
    hint.bucket = segs[propIdx + 1] || null;            // A-Z | 1-9 | Multi | Portfolio
    hint.tenant_brand = segs[propIdx + 2] || null;      // the brand/tenant folder
    for (let i = propIdx + 3; i < segs.length; i++) {
      const cs = splitCityState(segs[i]);
      if (cs) { hint.city = cs.city; hint.state = cs.state; break; }
    }
  }

  // Also accept a "City, ST" segment anywhere (research/flat folders use it; the
  // tenant folder is often FUSED — "Cypress Grove Office - Greenville, MS").
  if (!hint.city) {
    for (const s of segs) {
      const cs = splitCityState(s);
      if (cs) { hint.city = cs.city; hint.state = cs.state; break; }
    }
  }

  // ── Recover City/ST + street address + portfolio signal (Slice 2d.1) ──
  // The clean PROPERTIES/<tenant>/<City, ST> shape is the exception. When NO
  // segment carried the anchor, pull it from the FILENAME (its trailing
  // parenthetical label is stripped) or the tenant folder. splitCityState above
  // already de-prefixes fused segments, so there is no longer a fused-city case
  // to re-derive here.
  if (!hint.state) {
    const cs = splitCityState(fileName) || splitCityState(hint.tenant_brand);
    if (cs) { hint.city = cs.city; hint.state = cs.state; }
  }
  hint.address = extractStreetAddress(fileName) || extractStreetAddress(hint.tenant_brand) || null;
  hint.is_portfolio = isPortfolioHint(hint.tenant_brand, fileName);
  if (hint.tenant_brand) hint.tenant_core = tenantCore(hint.tenant_brand);

  // Slice 2e — filename City, ST fallback (additional guard). The real PROPERTIES
  // tree often carries the city/state in the FILENAME; run only when nothing above
  // produced a city (a path segment / the Slice-2d.1 recovery always wins) and
  // never overwrite an existing value.
  if (!hint.city && segs.length) {
    const fromName = parseCityStateFromFilename(segs[segs.length - 1]);
    if (fromName) { hint.city = fromName.city; hint.state = fromName.state; }
  }

  // Tenant-implied vertical when the research-root didn't decide it. Use the
  // cleaned core so cues survive a fused "DaVita Portfolio (3) - AR" label.
  if (!hint.vertical && (hint.tenant_core || hint.tenant_brand)) {
    const t = hint.tenant_core || hint.tenant_brand;
    if (DIA_CUES.test(t)) hint.vertical = 'dia';
    else if (GOV_CUES.test(t)) hint.vertical = 'gov';
  }

  return hint;
}
