// ============================================================================
// api/_shared/feature-flag.js — the SHARED env-OR-registry flag resolver.
//
// The house flag pattern (see api/_handlers/comms-owner-attribution-tick.js,
// api/_handlers/contact-acquisition-engine.js, and admin.js `w93FlagEnabled`)
// enables a capability on EITHER an env var OR the `feature_flags_registry.state`
// row, so flipping the registry row (e.g. from Cowork) activates the feature
// without a Railway env var. This module is the single reusable implementation
// so a new surface never re-forks it and can never drift to a `process.env`-only
// gate (which is exactly the Prompt-109 bug: draft-assist ignored the registry).
//
// Precedence: an EXPLICITLY-set env var WINS (on OR off — the ops override);
// otherwise the registry `state='on'` decides. An unset/blank env var is NOT an
// override — it falls through to the registry.
// ============================================================================

import { opsQuery } from './ops-db.js';

const ON_VALUES = ['on', '1', 'true', 'yes', 'enabled'];
const OFF_VALUES = ['off', '0', 'false', 'no', 'disabled'];

/**
 * Resolve a feature flag from the env var OR the registry row.
 * @param {string} envName  process.env key (usually === the flag name)
 * @param {{state?:string}|null} flagRow  the feature_flags_registry row (or null)
 * @returns {boolean}
 */
export function flagEnabled(envName, flagRow) {
  const env = String(process.env[envName] == null ? '' : process.env[envName]).trim().toLowerCase();
  if (ON_VALUES.includes(env)) return true;    // explicit env ON — ops override
  if (OFF_VALUES.includes(env)) return false;  // explicit env OFF — ops override
  return String(flagRow?.state || '').toLowerCase() === 'on';  // else the registry decides
}

/** Fetch a single `feature_flags_registry` row (flag,state). Null on any error. */
export async function fetchFeatureFlag(flagName) {
  try {
    const r = await opsQuery(
      'GET',
      'feature_flags_registry?flag=eq.' + flagName + '&select=flag,state&limit=1',
      undefined,
      { countMode: 'none' },
    );
    return r.ok && Array.isArray(r.data) ? r.data[0] : null;
  } catch (_e) {
    return null;
  }
}
