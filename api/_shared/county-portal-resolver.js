// ============================================================================
// County recorder/assessor portal resolver  (R26 Unit 2)
// Life Command Center
//
// Turns a "Research recorded owner" gap on a GOV property into a one-click
// county-portal lookup. The routing key is `gov.properties.county` (filled by
// the GovernmentProject R26 Unit 1 backfill); it joins to
// `gov.county_authorities` to pick the best portal URL.
//
// Preference order (deed records — where owner names appear — first):
//   recorder_url  →  assessor_url  →  netronline_url
//
// This does NOT auto-fill the owner. It removes the dead-end: the operator is
// routed straight to the right county recorder instead of hunting for it. When
// no county / authority resolves, callers render the current behavior (no
// link) — never a broken or guessed URL.
//
// county_authorities is a GOV-only table, so resolution is gov-only; dia
// returns empty (dia owner sourcing is CoStar/CMS-driven). Reads go through the
// trusted server-side `domainQuery` (service-role) path — no RLS loosening.
// ============================================================================

// Strip a trailing administrative suffix so a property county joins the bare
// names in county_authorities ("Los Angeles", not "Los Angeles County").
// Mirrors normalize_county_name() in GovernmentProject/src/backfill_county.py.
const COUNTY_SUFFIX_RE =
  /(?:^|\s)(?:county|parish|borough|census area|municipality|municipio|city and borough|city)$/i;

export function bareCounty(name) {
  if (name == null) return '';
  let s = String(name).trim().replace(/\s+/g, ' ');
  s = s.replace(COUNTY_SUFFIX_RE, '').trim();
  return s;
}

function countyKey(county, state) {
  return bareCounty(county).toLowerCase() + '|' + String(state || '').trim().toUpperCase();
}

// Pick the best portal URL from a county_authorities row. Recorder first
// (deed/owner records), then assessor, then the NetROnline aggregator.
export function pickPortal(authRow) {
  if (!authRow) return null;
  const tiers = [
    ['recorder_url', 'recorder'],
    ['assessor_url', 'assessor'],
    ['netronline_url', 'records'],
  ];
  for (const [col, kind] of tiers) {
    const url = authRow[col];
    if (typeof url === 'string' && /^https?:\/\//i.test(url.trim())) {
      return { url: url.trim(), kind };
    }
  }
  return null;
}

// Human label for the link, e.g. "Maricopa Recorder" / "Los Angeles records".
export function portalLabel(kind, county) {
  const c = bareCounty(county);
  const suffix = kind === 'recorder' ? 'Recorder'
    : kind === 'assessor' ? 'Assessor'
    : 'records';
  return c ? `${c} ${suffix}` : suffix;
}

const isGov = (domain) => domain === 'gov' || domain === 'government';

/**
 * Batch-resolve recorder portals for a set of GOV property ids.
 *
 * @param {string} domain - 'gov' | 'government' (anything else → empty map)
 * @param {Array<number|string>} propertyIds
 * @param {{ domainQuery: Function }} deps
 * @returns {Promise<Map<string, {county:string, portal_url:string, portal_label:string, portal_kind:string}>>}
 *          keyed by String(property_id). Missing/unresolvable ids are simply absent.
 */
export async function resolvePortalsForProperties(domain, propertyIds, deps) {
  const out = new Map();
  if (!isGov(domain)) return out;
  const ids = Array.from(new Set((propertyIds || [])
    .filter((v) => v != null && v !== '')
    .map((v) => String(v))));
  if (ids.length === 0) return out;
  const domainQuery = deps && deps.domainQuery;
  if (typeof domainQuery !== 'function') return out;

  // 1. Property → (county, state). Only rows that already carry a county.
  const propPath = 'properties'
    + '?property_id=in.(' + ids.map(encodeURIComponent).join(',') + ')'
    + '&county=not.is.null'
    + '&select=property_id,county,state';
  const propRes = await domainQuery('government', 'GET', propPath);
  if (!propRes || !propRes.ok || !Array.isArray(propRes.data) || propRes.data.length === 0) {
    return out;
  }
  const props = propRes.data.filter((p) => p && p.county && p.state);
  if (props.length === 0) return out;

  // 2. county_authorities for the involved states (one query, state-scoped).
  const states = Array.from(new Set(props
    .map((p) => String(p.state || '').trim().toUpperCase())
    .filter(Boolean)));
  if (states.length === 0) return out;
  const authPath = 'county_authorities'
    + '?state_code=in.(' + states.map(encodeURIComponent).join(',') + ')'
    + '&select=county_name,state_code,recorder_url,assessor_url,netronline_url';
  const authRes = await domainQuery('government', 'GET', authPath);
  const authRows = (authRes && authRes.ok && Array.isArray(authRes.data)) ? authRes.data : [];
  if (authRows.length === 0) return out;

  const authMap = new Map();
  for (const a of authRows) {
    authMap.set(countyKey(a.county_name, a.state_code), a);
  }

  // 3. Match + pick.
  for (const p of props) {
    const auth = authMap.get(countyKey(p.county, p.state));
    const portal = pickPortal(auth);
    if (!portal) continue;
    // Display the canonical county name from the authority row (Title Case),
    // not the property's raw value (which may be lower/uppercase).
    const county = bareCounty(auth.county_name) || bareCounty(p.county);
    out.set(String(p.property_id), {
      county,
      portal_url: portal.url,
      portal_label: portalLabel(portal.kind, county),
      portal_kind: portal.kind,
    });
  }
  return out;
}

/** Single-property convenience wrapper. Returns the portal object or null. */
export async function resolvePortalForProperty(domain, propertyId, deps) {
  const map = await resolvePortalsForProperties(domain, [propertyId], deps);
  return map.get(String(propertyId)) || null;
}
