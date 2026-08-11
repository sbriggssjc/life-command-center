export const MANIFEST_VERSION = '1.0';
export const APPROVED_SEED_CODES = Object.freeze([
  '261QX0200X',
  '261QI0500X',
  '261QX0203X',
]);

export const MANIFEST_TOP_LEVEL_KEYS = Object.freeze([
  'manifest_version',
  'freeze_date',
  'transform_version',
  'sources',
  'parameters',
]);

export function assertManifestContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Manifest must be an object');
  const unknown = Object.keys(value).filter((key) => !MANIFEST_TOP_LEVEL_KEYS.includes(key));
  if (unknown.length) throw new Error(`Unknown manifest key(s): ${unknown.sort().join(', ')}`);
  for (const key of MANIFEST_TOP_LEVEL_KEYS) {
    if (!Object.hasOwn(value, key)) throw new Error(`Missing manifest key: ${key}`);
  }
  if (value.manifest_version !== MANIFEST_VERSION) throw new Error('Unsupported manifest_version');
  if (!Array.isArray(value.sources) || value.sources.length !== 2) throw new Error('Manifest requires two sources');
  return true;
}
