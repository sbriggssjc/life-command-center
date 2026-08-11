import { createHash } from 'node:crypto';

import { canonicalJson } from './nppes.mjs';

const PROHIBITED_RECEIPT_PATTERNS = Object.freeze([
  /\b\d{10}\b/,
  /provider business practice location/i,
  /address line/i,
  /synthetic clinic|testville/i,
]);

export function verifyPhaseAAcceptance(firstReceipt, secondReceipt) {
  const first = canonicalJson(firstReceipt);
  const second = canonicalJson(secondReceipt);
  const violations = PROHIBITED_RECEIPT_PATTERNS.filter((pattern) => pattern.test(first)).map((pattern) => pattern.source);
  const checks = {
    reproducible_bytes: first === second,
    aggregate_only: violations.length === 0,
    secondary_location_contract: Number.isSafeInteger(firstReceipt?.counts?.secondary_source_rows),
    bounded_candidate_state: Number.isSafeInteger(firstReceipt?.counts?.candidate_locations),
  };
  return {
    acceptance_version: '1.0',
    status: Object.values(checks).every(Boolean) ? 'pass' : 'fail',
    checks,
    receipt_sha256: createHash('sha256').update(first).digest('hex'),
    violation_classes: violations,
  };
}
