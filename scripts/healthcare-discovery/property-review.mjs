import { createHash } from 'node:crypto';

const HEX_64 = /^[a-f0-9]{64}$/;
const PROPERTY_FORMS = new Set(['stnl', 'dominant_user', 'minority_mob', 'campus', 'operator_owned', 'unknown']);
const QUALIFYING_FORMS = new Set(['stnl', 'dominant_user']);
const DECISIONS = new Set(['advance_primary_lane', 'advance_narrow_archetype', 'advisory_only', 'enrichment_only', 'stop']);

export const REVIEW_CONTRACT_VERSION = 'healthcare_property_review:1.0';
export const HARD_GATES = Object.freeze({
  clinical_precision: 0.90,
  property_classification: 0.80,
  qualifying_property_share: 0.50,
  addressable_path_share: 0.60,
  bounded_economics_share: 0.50,
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertFingerprint(value, label) {
  if (!HEX_64.test(value) || /^0{64}$/.test(value)) throw new Error(`${label} must be a non-placeholder SHA-256 fingerprint`);
}

function rank(seed, fingerprint) {
  return hash(`${seed}:${fingerprint}`);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1];
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function wilson(successes, total, z = 1.96) {
  if (!total) return null;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denominator;
  return { low: Number(Math.max(0, center - margin).toFixed(4)), high: Number(Math.min(1, center + margin).toFixed(4)) };
}

function validateSamplingContract(contract) {
  if (!contract || contract.contract_version !== REVIEW_CONTRACT_VERSION) throw new Error('Unsupported property-review contract');
  if (!['asc', 'idtf_fixed_site'].includes(contract.lane)) throw new Error('Unsupported property-review lane');
  assertFingerprint(contract.release_id, 'release_id');
  if (!Number.isSafeInteger(contract.sample_size) || contract.sample_size !== 50) throw new Error('sample_size must equal 50');
  if (typeof contract.seed !== 'string' || contract.seed.length < 16) throw new Error('seed must be a stable non-secret string of at least 16 characters');
  if (!Array.isArray(contract.cells) || !contract.cells.length) throw new Error('sampling cells are required');
  const names = new Set();
  let quota = 0;
  for (const cell of contract.cells) {
    if (!/^[a-z][a-z0-9_]+$/.test(cell.name) || names.has(cell.name)) throw new Error('sampling cell names must be unique snake_case');
    names.add(cell.name);
    if (!Number.isSafeInteger(cell.quota) || cell.quota <= 0) throw new Error(`${cell.name}.quota must be positive`);
    if (!Array.isArray(cell.all) || !cell.all.length || cell.all.some((rule) => !rule || typeof rule.field !== 'string' || !Array.isArray(rule.in) || !rule.in.length)) throw new Error(`${cell.name}.all must contain reviewed field/in rules`);
    quota += cell.quota;
  }
  if (quota !== 50) throw new Error('sampling-cell quotas must total 50');
}

function matches(candidate, rules) {
  return rules.every(({ field, in: allowed }) => allowed.includes(candidate[field]));
}

export function buildPropertySamplingFrame(candidates, contract) {
  validateSamplingContract(contract);
  if (!Array.isArray(candidates)) throw new Error('candidates must be an array');
  const fingerprints = new Set();
  for (const candidate of candidates) {
    assertFingerprint(candidate.candidate_fingerprint, 'candidate_fingerprint');
    if (fingerprints.has(candidate.candidate_fingerprint)) throw new Error('candidate fingerprints must be unique');
    fingerprints.add(candidate.candidate_fingerprint);
  }
  const selected = [];
  const selectedIds = new Set();
  const cellCounts = {};
  for (const cell of contract.cells) {
    const eligible = candidates
      .filter((candidate) => !selectedIds.has(candidate.candidate_fingerprint) && matches(candidate, cell.all))
      .sort((a, b) => rank(`${contract.seed}:${cell.name}`, a.candidate_fingerprint).localeCompare(rank(`${contract.seed}:${cell.name}`, b.candidate_fingerprint)));
    if (eligible.length < cell.quota) throw new Error(`sampling cell ${cell.name} has ${eligible.length} eligible candidates for quota ${cell.quota}`);
    for (const candidate of eligible.slice(0, cell.quota)) {
      selectedIds.add(candidate.candidate_fingerprint);
      selected.push({ candidate_fingerprint: candidate.candidate_fingerprint, sampling_cell: cell.name });
    }
    cellCounts[cell.name] = cell.quota;
  }
  return {
    receipt_version: REVIEW_CONTRACT_VERSION,
    lane: contract.lane,
    release_id: contract.release_id,
    sample_size: selected.length,
    seed_fingerprint: hash(contract.seed),
    cell_counts: cellCounts,
    selection_fingerprint: hash(canonicalJson(selected)),
    selected,
  };
}

function assertReview(review) {
  assertFingerprint(review.candidate_fingerprint, 'review candidate_fingerprint');
  if (typeof review.clinical_verified !== 'boolean') throw new Error('clinical_verified must be boolean');
  if (!PROPERTY_FORMS.has(review.property_form)) throw new Error('property_form is invalid');
  for (const field of ['landlord_addressable', 'economics_bounded']) if (![true, false, null].includes(review[field])) throw new Error(`${field} must be boolean or null`);
  for (const field of ['clinical_minutes', 'property_minutes', 'ownership_minutes', 'economics_minutes', 'contact_minutes']) {
    if (!Number.isFinite(review[field]) || review[field] < 0) throw new Error(`${field} must be a nonnegative number`);
  }
}

export function buildPropertyReviewReceipt(frame, reviews) {
  if (frame.receipt_version !== REVIEW_CONTRACT_VERSION || frame.sample_size !== 50 || frame.selected.length !== 50) throw new Error('A frozen 50-property frame is required');
  if (!Array.isArray(reviews) || reviews.length !== 50) throw new Error('Exactly 50 property reviews are required');
  const selected = new Set(frame.selected.map((row) => row.candidate_fingerprint));
  const reviewed = new Set();
  const forms = Object.fromEntries([...PROPERTY_FORMS].map((form) => [form, 0]));
  let clinicalVerified = 0;
  let classifiable = 0;
  let qualifying = 0;
  let addressable = 0;
  let economicsBounded = 0;
  const minutes = [];
  for (const review of reviews) {
    assertReview(review);
    if (!selected.has(review.candidate_fingerprint) || reviewed.has(review.candidate_fingerprint)) throw new Error('Reviews must match the frozen frame exactly once');
    reviewed.add(review.candidate_fingerprint);
    forms[review.property_form] += 1;
    clinicalVerified += Number(review.clinical_verified);
    const isClassifiable = review.property_form !== 'unknown';
    const isQualifying = QUALIFYING_FORMS.has(review.property_form);
    classifiable += Number(isClassifiable);
    qualifying += Number(isQualifying);
    if (isQualifying) {
      addressable += Number(review.landlord_addressable === true);
      economicsBounded += Number(review.economics_bounded === true);
    }
    minutes.push(review.clinical_minutes + review.property_minutes + review.ownership_minutes + review.economics_minutes + review.contact_minutes);
  }
  if (reviewed.size !== selected.size) throw new Error('Reviews do not cover the frozen frame');
  const metrics = {
    clinical_precision: ratio(clinicalVerified, 50),
    property_classification: ratio(classifiable, 50),
    qualifying_property_share: ratio(qualifying, classifiable),
    addressable_path_share: ratio(addressable, qualifying),
    bounded_economics_share: ratio(economicsBounded, qualifying),
  };
  const gates = Object.fromEntries(Object.entries(HARD_GATES).map(([name, threshold]) => [name, { observed: metrics[name], threshold, pass: metrics[name] !== null && metrics[name] >= threshold }]));
  return {
    receipt_version: REVIEW_CONTRACT_VERSION,
    lane: frame.lane,
    release_id: frame.release_id,
    selection_fingerprint: frame.selection_fingerprint,
    reviewed_count: 50,
    classification_counts: { property_form: forms },
    metrics,
    confidence_intervals_95: {
      clinical_precision: wilson(clinicalVerified, 50),
      property_classification: wilson(classifiable, 50),
      qualifying_property_share: wilson(qualifying, classifiable),
      addressable_path_share: wilson(addressable, qualifying),
      bounded_economics_share: wilson(economicsBounded, qualifying),
    },
    research_minutes: { median: percentile(minutes, 0.5), p90: percentile(minutes, 0.9) },
    gate_result: Object.values(gates).every((gate) => gate.pass) ? 'pass' : 'fail',
    gates,
    allowed_decisions: [...DECISIONS].sort(),
    privacy: { classification: 'aggregate_only', record_level_identifiers_emitted: false },
  };
}

export function serializePropertyReviewReceipt(receipt) {
  const aggregate = structuredClone(receipt);
  delete aggregate.selected;
  return `${canonicalJson(aggregate)}\n`;
}
