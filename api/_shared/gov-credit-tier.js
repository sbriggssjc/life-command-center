// Government credit-tier resolver.
//
// The domain classifier decides whether something belongs in the government
// vertical. This resolver answers a narrower reporting question: which credit
// bucket(s) does the tenant evidence support?

const BUCKETS = ['federal', 'state', 'municipal'];

const FEDERAL_PATTERNS = [
  /\bgsa\b/,
  /\bgeneral services administration\b/,
  /\bfederal\b/,
  /\bunited states\b/,
  /\bu\.?s\.?\s+(?:government|dept|department|agency|attorney|court|marshal|army|navy|air force|marine|coast guard)\b/,
  /\bdept\.?\s+of\s+veterans?\s+affairs\b/,
  /\bveterans?\s+affairs\b/,
  /\bdepartment\s+of\s+veterans?\s+affairs\b/,
  /\bva\b/,
  /\bsocial security\b/,
  /\bssa\b/,
  /\birs\b/,
  /\binternal revenue\b/,
  /\bfbi\b/,
  /\bdea\b/,
  /\bice\b/,
  /\buscis\b/,
  /\bfema\b/,
  /\busda\b/,
  /\bhud\b/,
  /\bepa\b/,
  /\bfda\b/,
  /\bdoj\b/,
  /\bdod\b/,
  /\bnoaa\b/,
  /\bfaa\b/,
  /\bnps\b/,
  /\busps\b/,
  /\bpostal service\b/,
  /\barmy corps\b/,
  /\bcustoms\s+and\s+border\b/,
  /\bcbp\b/,
  /\btsa\b/,
  /\bfederal aviation\b/,
  /\bfood and drug\b/,
  /\bdepartment of justice\b/,
  /\bdepartment of defense\b/,
  /\bnational oceanic\b/,
  /\bnational park service\b/,
  /\bforest service\b/,
  /\bnational forest\b/,
  /\bcitizenship\b/,
  /\bimmigration\s+(?:services?|and\s+customs|and\s+naturalization)\b/,
  /\bmine\s+safety\b/,
  /\bindian\s+health\b/,
  /\bjustice\s+department\b/,
  /\bdrug\s+enforcement\b/,
  /\btransportation\s+security\b/,
  /\bbankruptcy\s+court\b/,
  /\btax\s+court\b/,
  /\bdistrict\s+court\b/,
];

const STATE_PATTERNS = [
  /\bstate\s+of\b/,
  /\bhuman services\b/,
  /\bhealth\s+(?:and|&)\s+human\s+services\b/,
  /\b(?:child|children'?s|adult|family)\s+protective(?:\s+services)?\b/,
  /\bdept\.?\s+of\b/,
  /\bdepartment\s+of\s+(?:transportation|corrections?|criminal justice|public safety|health|state health|human services|family and protective services|licensing|revenue|labor|education)\b/,
  /\bcomm(?:ission|\.)?\s+on\b/,
  /\bcriminal justice\b/,
  /\bjuvenile justice\b/,
  /\bparks?\s+and\s+wildlife\b/,
  /\bwildlife\s+(?:department|commission|service|resources?|conservation)\b/,
  /\bcomptroller\b/,
  /\benvironmental quality\b/,
  /\blottery commission\b/,
  /\bland office\b/,
  /\brailroad commission\b/,
  /\bworkforce\s+(?:commission|solutions|development\s+board)\b/,
  /\beducation agency\b/,
  /\badministrative hearings\b/,
  /\bwater development board\b/,
  /\balcoholic beverage\s+(?:commission|control)\b/,
  /\blicensing\s+(?:and|&)\s+regulation\b/,
  /\bsecurities board\b/,
  /\banimal health commission\b/,
  /\bboard of\s+\w+\s+examiners\b/,
  /\bpublic safety\b/,
  /\bstate board\b/,
  /\bhistorical commission\b/,
  /\bsupreme court of\b/,
];

const MUNICIPAL_PATTERNS = [
  /\bmunicipal\b/,
  /\blocal\b/,
  /\bcounty\s+of\b/,
  /\bcity\s+of\b/,
  /\btown\s+of\b/,
  /\bvillage\s+of\b/,
  /\bborough\s+of\b/,
  /\bparish\s+of\b/,
  /\bschool district\b/,
  /\bindependent school district\b/,
  /\bisd\b/,
  /\bmunicipal utility district\b/,
  /\bmud\b/,
  /\bwater district\b/,
  /\bfire district\b/,
  /\bpolice department\b/,
  /\bsheriff(?:'s)?\s+office\b/,
  /\bpublic works\b/,
  /\bcounty\s+(?:health|human services|public safety|courthouse|department|commission|authority)\b/,
  /\bcity\s+(?:hall|department|council|police|fire|public works|authority)\b/,
  /\bsuperior court\b/,
  /\bcourthouse\b/,
];

const EXPLICIT_TYPE_PATTERNS = [
  ['federal', /\bfederal\b/i],
  ['state', /\bstate\b/i],
  ['municipal', /\b(municipal|local|county|city)\b/i],
];

function cleanText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).join(' | ');
  if (typeof value === 'object') {
    return Object.values(value).map(cleanText).filter(Boolean).join(' | ');
  }
  return String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitTenantText(value) {
  const raw = cleanText(value);
  if (!raw) return [];
  return raw
    .split(/\s*(?:\||;|\/|\band\b|\+|,)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

function bucketFromExplicitType(value) {
  const text = cleanText(value);
  if (!text) return [];
  const buckets = [];
  for (const [bucket, rx] of EXPLICIT_TYPE_PATTERNS) {
    if (rx.test(text)) buckets.push({ bucket, source: 'explicit_government_type', evidence: value });
  }
  return buckets;
}

function firstPatternMatch(text, patterns) {
  if (!text) return null;
  for (const rx of patterns) {
    if (rx.test(text)) return rx.source;
  }
  return null;
}

function bucketsFromText(value, source) {
  const chunks = splitTenantText(value);
  const candidates = chunks.length ? chunks : [cleanText(value)];
  const out = [];
  for (const text of candidates) {
    const federal = firstPatternMatch(text, FEDERAL_PATTERNS);
    if (federal) out.push({ bucket: 'federal', source, evidence: text, pattern: federal });
    const state = firstPatternMatch(text, STATE_PATTERNS);
    if (state) out.push({ bucket: 'state', source, evidence: text, pattern: state });
    const municipal = firstPatternMatch(text, MUNICIPAL_PATTERNS);
    if (municipal) out.push({ bucket: 'municipal', source, evidence: text, pattern: municipal });
  }
  return out;
}

function dedupeBuckets(matches) {
  const byBucket = new Map();
  for (const match of matches) {
    if (!match?.bucket || !BUCKETS.includes(match.bucket)) continue;
    if (!byBucket.has(match.bucket)) byBucket.set(match.bucket, match);
  }
  return BUCKETS.filter((b) => byBucket.has(b)).map((b) => byBucket.get(b));
}

export function governmentCreditBuckets(input = {}) {
  const matches = [];
  matches.push(...bucketFromExplicitType(input.government_type ?? input.governmentType));
  matches.push(...bucketsFromText(input.agency, 'agency'));
  matches.push(...bucketsFromText(input.agency_full_name ?? input.agencyFullName, 'agency_full_name'));
  matches.push(...bucketsFromText(input.tenant_name ?? input.tenantName, 'tenant_name'));
  matches.push(...bucketsFromText(input.primary_tenant ?? input.primaryTenant, 'primary_tenant'));
  matches.push(...bucketsFromText(input.tenantNames, 'tenant_names'));
  matches.push(...bucketsFromText(input.sale_notes_raw ?? input.saleNotesRaw, 'sale_notes_raw'));
  matches.push(...bucketsFromText(input.sale_notes ?? input.saleNotes, 'sale_notes'));
  matches.push(...bucketsFromText(input.comments, 'comments'));
  matches.push(...bucketsFromText(input.lease_number ?? input.leaseNumber, 'lease_number'));
  matches.push(...bucketsFromText(input.source_text ?? input.sourceText, 'source_text'));
  return dedupeBuckets(matches);
}

export function deriveGovernmentCreditTier(input = {}) {
  const buckets = governmentCreditBuckets(input);
  return {
    buckets: buckets.map((m) => m.bucket),
    matches: buckets,
    primaryType: buckets.length === 1 ? buckets[0].bucket : null,
    isMultiBucket: buckets.length > 1,
  };
}

export function normalizeGovernmentCreditTier(value) {
  const buckets = bucketFromExplicitType(value);
  return buckets.length === 1 ? buckets[0].bucket : null;
}
