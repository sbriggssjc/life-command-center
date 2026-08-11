import { createHash } from 'node:crypto';

export const NORMALIZATION_VERSION = 'healthcare-address-v1';

const STREET_SUFFIXES = Object.freeze(new Map([
  ['AVENUE', 'AVE'],
  ['BOULEVARD', 'BLVD'],
  ['CIRCLE', 'CIR'],
  ['COURT', 'CT'],
  ['DRIVE', 'DR'],
  ['HIGHWAY', 'HWY'],
  ['LANE', 'LN'],
  ['PARKWAY', 'PKWY'],
  ['PLACE', 'PL'],
  ['ROAD', 'RD'],
  ['STREET', 'ST'],
  ['TERRACE', 'TER'],
]));

function cleanPart(value) {
  return String(value || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9# -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStreet(value) {
  return cleanPart(value)
    .split(' ')
    .map((token) => STREET_SUFFIXES.get(token) || token)
    .join(' ');
}

export function normalizeAddress(parts) {
  const normalized = {
    line1: normalizeStreet(parts.line1),
    line2: cleanPart(parts.line2),
    city: cleanPart(parts.city),
    state: cleanPart(parts.state),
    postal_code: cleanPart(parts.postalCode).replace(/^(\d{5}).*$/, '$1'),
    country: cleanPart(parts.country || 'US') || 'US',
  };
  const complete = Boolean(
    normalized.line1 && normalized.city && /^[A-Z]{2}$/.test(normalized.state)
      && /^\d{5}$/.test(normalized.postal_code),
  );
  return { ...normalized, complete };
}

export function fingerprint(kind, values) {
  const payload = [kind, NORMALIZATION_VERSION, ...values].join('\u001f');
  return createHash('sha256').update(payload).digest('hex');
}

export function addressFingerprint(address) {
  return fingerprint('address', [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postal_code,
    address.country,
  ]);
}

export function rowFingerprint({ npi, addressHash, taxonomyCodes, locationRole }) {
  return fingerprint('observation', [npi, addressHash, [...taxonomyCodes].sort().join(','), locationRole]);
}

export function candidateFingerprint({ addressHash, modality }) {
  return fingerprint('candidate', [addressHash, modality]);
}
