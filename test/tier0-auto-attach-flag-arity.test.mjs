// test/tier0-auto-attach-flag-arity.test.mjs
// ============================================================================
// Regression guard for a real production bug found live 2026-09-12 (Cowork):
// `tier0-auto-attach-tick.js` called `flagEnabled(await fetchFeatureFlag(FLAG))`
// — ONE argument, missing the flag name — instead of the shared helper's actual
// two-argument signature `flagEnabled(envName, flagRow)`. Every other caller in
// this repo (ambiguous-entity-automerge-tick.js, bench-rank-tick.js,
// briefing-analyst-take-tick.js, market-brief-psql-tick.js,
// market-brief-rss-tick.js, operator-triage-tick.js,
// ownership-chain-draft-tick.js) passes both arguments correctly; this file was
// the sole exception.
//
// Effect: `flagEnabled` received the flag ROW object as its `envName` argument
// (so `process.env[rowObject]` never matched an ON/OFF string) and `undefined`
// as `flagRow` (so `flagRow?.state` was always undefined) — the function fell
// through to its own `false` default on every call, regardless of what
// `feature_flags_registry.state` said. `feature_flags_registry` showed
// `TIER0_AUTO_ATTACH` state='on' since 2026-08-28; the tick's own run log
// (`lcc_tier0_auto_attach_run_log`) shows `flag_enabled=false,
// skipped_reason='flag_off'` on every single run from 2026-08-27 through
// 2026-09-12 (17 runs, 0 attaches) — the registry flip that
// `docs/architecture/tier0-owner-contact-system.md` recorded as "RESOLVED
// 2026-08-28" never actually took effect.
//
// This is a static source guard, not a live DB test (this handler talks to
// Supabase via opsQuery and has no live-DB harness in this suite) — it fails
// if the exact broken one-argument call pattern reappears, in this file or a
// future one that copies it.
// ============================================================================

import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TICK_FILE = path.join(REPO_ROOT, 'api', '_handlers', 'tier0-auto-attach-tick.js');

it('tier0-auto-attach-tick.js calls flagEnabled with BOTH arguments (FLAG, row)', () => {
  const src = readFileSync(TICK_FILE, 'utf8');

  // The exact broken shape must never reappear: flagEnabled given only the
  // fetchFeatureFlag(...) result, with no leading flag-name argument.
  assert.ok(
    !/flagEnabled\(\s*await\s+fetchFeatureFlag\(/.test(src),
    'flagEnabled() must not be called with fetchFeatureFlag(...) as its ONLY argument — ' +
      'flagEnabled(envName, flagRow) requires the flag name FIRST. This exact one-argument ' +
      'call silently made TIER0_AUTO_ATTACH read as permanently off for 16 days ' +
      '(2026-08-27 to 2026-09-12) despite the registry saying \'on\'.'
  );

  // The fixed shape must be present: FLAG passed explicitly as the first argument.
  assert.ok(
    /flagEnabled\(\s*FLAG\s*,\s*await\s+fetchFeatureFlag\(FLAG\)\s*\)/.test(src),
    'Expected flagEnabled(FLAG, await fetchFeatureFlag(FLAG)) — the same two-argument ' +
      'pattern every other tick in this repo uses.'
  );
});
