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

/**
 * Build the subject_hint match anchor from a path before any content parse.
 * PROPERTIES/<bucket>/<TENANT or BRAND>[/<City, ST>]/…files
 * @param {string} serverRelativePath  '/'-joined path (server-relative or local-relative)
 * @returns {{tenant_brand:?string, city:?string, state:?string, vertical:?string, bucket:?string}}
 */
export function parseSubjectHintFromPath(serverRelativePath) {
  const raw = String(serverRelativePath || '').replace(/\\/g, '/');
  const segs = raw.split('/').map(s => s.trim()).filter(Boolean);

  const hint = { tenant_brand: null, city: null, state: null, vertical: null, bucket: null };

  // Research-root vertical (e.g. "Dialysis Research" / "Gv't Leased Research").
  for (const s of segs) {
    if (/dialysis\s*research/i.test(s)) hint.vertical = 'dia';
    else if (/(gv'?t|gov(ernment)?)\s*leased?\s*research/i.test(s)) hint.vertical = 'gov';
  }

  // PROPERTIES/<bucket>/<tenant_brand>[/<City, ST>]
  const propIdx = segs.findIndex(s => /^properties$/i.test(s));
  if (propIdx !== -1) {
    hint.bucket = segs[propIdx + 1] || null;            // A-Z | 1-9 | Multi | Portfolio
    hint.tenant_brand = segs[propIdx + 2] || null;      // the brand/tenant folder
    for (let i = propIdx + 3; i < segs.length; i++) {
      const m = segs[i].match(/^(.+),\s*([A-Z]{2})$/);
      if (m) { hint.city = m[1].trim(); hint.state = m[2]; break; }
    }
  }

  // Also accept a "City, ST" segment anywhere (some research/flat folders use it).
  if (!hint.city) {
    for (const s of segs) {
      const m = s.match(/^(.+),\s*([A-Z]{2})$/);
      if (m) { hint.city = m[1].trim(); hint.state = m[2]; break; }
    }
  }

  // Tenant-implied vertical when the research-root didn't decide it.
  if (!hint.vertical && hint.tenant_brand) {
    if (DIA_CUES.test(hint.tenant_brand)) hint.vertical = 'dia';
    else if (GOV_CUES.test(hint.tenant_brand)) hint.vertical = 'gov';
  }

  return hint;
}
