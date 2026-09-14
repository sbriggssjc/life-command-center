// News Alert Review assist.
//
// Local Ollama is used as an annotation engine only: it extracts candidate facts
// and evidence from the alert payload, but never creates properties, leads, loans,
// or opportunities. The human promotion path decides what becomes canonical.

const CONFIDENCE_MAX = 1;

function cleanText(value, max = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function clampConfidence(value) {
  const n = Number(value);
  return Math.max(0, Math.min(CONFIDENCE_MAX, Number.isFinite(n) ? n : 0));
}

function cleanEvidence(value) {
  return cleanText(value, 260);
}

function stringList(value, maxItems = 8, maxLen = 160) {
  const arr = Array.isArray(value) ? value : (value ? [value] : []);
  return arr.map((v) => cleanText(v, maxLen)).filter(Boolean).slice(0, maxItems);
}

export function buildNewsAlertExtractionPrompt(alert) {
  const a = alert || {};
  const payload = {
    news_lead_id: a.news_lead_id || null,
    source: a.source || null,
    domain: a.domain || null,
    tenant: a.tenant || null,
    city: a.city || null,
    state: a.state || null,
    article_title: a.article_title || null,
    summary: a.summary || null,
    raw_subject: a.raw_subject || null,
    article_url: a.article_url || null,
  };
  return [
    'You are the LCC local news-alert extraction assist agent.',
    'You only ANNOTATE. You never decide truth, never create records, never write canonical data, and never invent missing facts.',
    'Extract commercial real estate development facts from the Google Alert payload below using ONLY the visible title, summary, subject, tenant/location hints, and URL.',
    'If the payload does not explicitly name a fact, return null or an empty array. Every extracted fact should include short evidence copied from the payload.',
    '',
    'Return ONLY strict JSON with these keys:',
    '{',
    '  "project": { "name", "description", "project_type", "address", "city", "state", "tenant", "domain", "confidence", "evidence" },',
    '  "parties": [ { "name", "role", "confidence", "evidence" } ],',
    '  "permits": [ { "permit_number", "permit_type", "jurisdiction", "applicant", "status", "date", "confidence", "evidence" } ],',
    '  "timeline": [ { "event", "date_or_period", "confidence", "evidence" } ],',
    '  "debt_or_deed_signals": [ { "signal_type", "party", "date_or_period", "confidence", "evidence" } ],',
    '  "follow_up_triggers": [ string ],',
    '  "recommended_next_step": "track" | "research_owner" | "research_permit" | "monitor" | "dismiss" | "uncertain",',
    '  "reason": string',
    '}',
    '',
    'Role examples for parties: recorded_owner, land_owner, applicant, developer, tenant, lender, seller, buyer, contractor, agency, broker, unknown.',
    'Debt/deed signal examples: construction_loan, deed_recorded, land_purchase, permit_filing, notice_of_commencement, tax_parcel, none.',
    'Use modest confidence if the evidence is only a headline or snippet. If unsure, choose recommended_next_step "uncertain".',
    '',
    JSON.stringify({ alert: payload }, null, 2),
  ].join('\n');
}

export function parseNewsAlertExtractionJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try { return JSON.parse(candidate); } catch (_e) { /* fallback below */ }
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(candidate.slice(first, last + 1)); } catch (_e) { /* no-op */ }
  }
  return null;
}

const NEXT_STEPS = new Set(['track', 'research_owner', 'research_permit', 'monitor', 'dismiss', 'uncertain']);
const PARTY_ROLES = new Set([
  'recorded_owner', 'land_owner', 'applicant', 'developer', 'tenant', 'lender',
  'seller', 'buyer', 'contractor', 'agency', 'broker', 'unknown',
]);

function normalizeProject(obj, fallback = {}) {
  const p = obj && typeof obj === 'object' ? obj : {};
  return {
    name: cleanText(p.name, 220) || null,
    description: cleanText(p.description, 500) || null,
    project_type: cleanText(p.project_type, 120) || null,
    address: cleanText(p.address, 180) || null,
    city: cleanText(p.city, 100) || fallback.city || null,
    state: cleanText(p.state, 40) || fallback.state || null,
    tenant: cleanText(p.tenant, 160) || fallback.tenant || null,
    domain: cleanText(p.domain, 60) || fallback.domain || null,
    confidence: clampConfidence(p.confidence),
    evidence: cleanEvidence(p.evidence) || null,
  };
}

function normalizeParties(value) {
  const arr = Array.isArray(value) ? value : [];
  return arr.map((raw) => {
    const p = raw && typeof raw === 'object' ? raw : {};
    let role = cleanText(p.role, 80).toLowerCase();
    if (!PARTY_ROLES.has(role)) role = 'unknown';
    return {
      name: cleanText(p.name, 180),
      role,
      confidence: clampConfidence(p.confidence),
      evidence: cleanEvidence(p.evidence),
    };
  }).filter((p) => p.name).slice(0, 12);
}

function normalizeObjects(value, allowedKeys) {
  const arr = Array.isArray(value) ? value : [];
  return arr.map((raw) => {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const key of allowedKeys) {
      if (key === 'confidence') out.confidence = clampConfidence(src.confidence);
      else if (key === 'evidence') out.evidence = cleanEvidence(src.evidence);
      else out[key] = cleanText(src[key], 180) || null;
    }
    return out;
  }).filter((o) => Object.values(o).some((v) => v && v !== 0)).slice(0, 12);
}

export function normalizeNewsAlertExtraction(raw, alert = {}, meta = {}) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  let next = cleanText(obj.recommended_next_step, 60).toLowerCase();
  if (!NEXT_STEPS.has(next)) next = 'uncertain';
  return {
    project: normalizeProject(obj.project, alert),
    parties: normalizeParties(obj.parties),
    permits: normalizeObjects(obj.permits, ['permit_number', 'permit_type', 'jurisdiction', 'applicant', 'status', 'date', 'confidence', 'evidence']),
    timeline: normalizeObjects(obj.timeline, ['event', 'date_or_period', 'confidence', 'evidence']),
    debt_or_deed_signals: normalizeObjects(obj.debt_or_deed_signals, ['signal_type', 'party', 'date_or_period', 'confidence', 'evidence']),
    follow_up_triggers: stringList(obj.follow_up_triggers),
    recommended_next_step: next,
    reason: cleanText(obj.reason, 360) || null,
    model: meta.model || null,
    provider: meta.provider || null,
    parsed_ok: !!raw,
    at: meta.at || null,
  };
}

