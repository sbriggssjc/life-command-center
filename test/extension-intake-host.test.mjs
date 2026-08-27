// Prompt 194 — the sidebar channel posted every OM to a RETIRED host.
//
// Grounded live 2026-08-26 (docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md):
// `extension/background.js` carried SIX hardcoded fallbacks to
// `https://life-command-center-nine.vercel.app` for the intake endpoints
// (prepare-upload / stage-om / document-notify / intake-outlook-message).
// Vercel was retired 2026-07-20 but that deployment kept serving a frozen
// pre-retirement build holding the same LCC Opps service key — so the posts
// SUCCEEDED against a months-old pipeline. Result: 0 of 350 sidebar rows in 30
// days carried the Prompt-61 schema or a `_provider` stamp, while email and
// folder_feed rows written from Railway in the SAME HOUR were 100% both.
// Correlated 25/25 by PostgREST writer IP (Railway 152.55.x / 162.220.232.x vs
// ephemeral AWS us-east-1 lambda IPs).
//
// The guard is structural and anchored on STABLE tokens (the retired hostname,
// and the name of the single resolver) rather than a line number or a sliced
// region — see the block-slice footgun in CLAUDE.md.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT  = join(ROOT, 'extension');

/** Every .js file under extension/, recursively. */
function extensionSources(dir = EXT, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { extensionSources(p, acc); continue; }
    if (p.endsWith('.js')) acc.push(p);
  }
  return acc;
}

// Strip comments so prose may name the retired host while code may not.
// ORDER MATTERS: whole-line `//` comments go FIRST. A comment containing a
// path glob like `/api/*` otherwise opens a phantom block comment that eats
// the rest of the file — which is exactly how the first draft of this guard
// counted 1 occurrence where the file has 8, and passed on nothing.
// The line-comment pattern is anchored at line start so a `https://` inside a
// string literal is never mistaken for one.
function stripComments(src) {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const RETIRED_HOST = 'life-command-center-nine.vercel.app';

describe('Prompt 194 — extension intake host', () => {
  it('no extension source resolves the retired Vercel deployment in executable code', () => {
    const offenders = [];
    for (const file of extensionSources()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (code.includes(RETIRED_HOST)) offenders.push(file.slice(ROOT.length + 1));
    }
    assert.deepEqual(
      offenders, [],
      `The retired Vercel deployment (${RETIRED_HOST}) is referenced in executable code. ` +
      'It still serves a pre-2026-07-20 build with live LCC Opps credentials, so posting ' +
      'to it succeeds silently against a stale pipeline. Route through pickIntakeHost().',
    );
  });

  it('background.js declares exactly one intake-host resolver, defaulting to Railway', () => {
    const src = readFileSync(join(EXT, 'background.js'), 'utf8');
    assert.equal(
      (src.match(/^const DEFAULT_INTAKE_HOST\s*=/gm) || []).length, 1,
      'background.js must declare DEFAULT_INTAKE_HOST exactly once — one owner of the host decision.',
    );
    assert.match(
      src, /^const DEFAULT_INTAKE_HOST\s*=\s*'https:\/\/[^']*railway\.app'/m,
      'DEFAULT_INTAKE_HOST must be the Railway origin — server.js is the single source of /api/* routing.',
    );
    assert.match(
      src, /function pickIntakeHost\(/,
      'pickIntakeHost() is the single resolver every intake call site must use.',
    );
  });

  it('every intake API call site takes its host from the resolver', () => {
    const code = stripComments(readFileSync(join(EXT, 'background.js'), 'utf8'));

    // Any intake endpoint must be built from an interpolated host variable,
    // never a literal origin.
    const literalOrigin = code.match(/['"`]https:\/\/[^'"`\s]+\/api\/intake[^'"`\s]*['"`]/g) || [];
    assert.deepEqual(
      literalOrigin, [],
      `Intake endpoint(s) built from a literal origin: ${literalOrigin.join(', ')}. ` +
      'Use `${host}/api/intake/...` with host from pickIntakeHost()/getIntakeHost().',
    );

    // LCC_VERCEL_URL survives ONLY as a deliberate staging override, read
    // inside the resolver. A call site that dereferences it directly is the
    // exact shape that shipped the stale host — quoted occurrences are
    // storage.sync.get key lists and are fine.
    const derefs = code.match(/(?<!['"])\bLCC_VERCEL_URL\b(?!['"])/g) || [];
    assert.equal(
      derefs.length, 1,
      `LCC_VERCEL_URL is dereferenced ${derefs.length} time(s); exactly one is allowed ` +
      '(inside pickIntakeHost). A direct read at a call site bypasses the Railway default.',
    );
  });
});
