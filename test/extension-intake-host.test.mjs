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

// EXT-HOST (2026-09-10) — the resolver must also refuse a STORED retired origin.
// Measured: on 2026-09-09 sidebar OMs at 13:11 and 19:25 UTC were written from
// Railway, while 14:28, 18:59 and 20:30 UTC were written from AWS Lambda IPs —
// the frozen Vercel build — on the same machine, same day. 1.0.52 returned
// whatever chrome.storage.sync held; a profile configured in the Vercel era
// still holds that origin. The rule is platform-wide (*.vercel.app) because the
// guard above forbids the literal hostname in executable code.
describe('EXT-HOST — a stored retired origin resolves to Railway', () => {
  // Evaluate the real resolver from source, not a re-implementation.
  function loadResolver() {
    const src = readFileSync(join(EXT, 'background.js'), 'utf8');
    const grab = (re) => { const m = src.match(re); assert.ok(m, `missing ${re}`); return m[0]; };
    const body = [
      grab(/^const DEFAULT_INTAKE_HOST\s*=.*$/m),
      grab(/function isRetiredIntakeOrigin\([\s\S]*?\n}/),
      grab(/function pickIntakeHost\([\s\S]*?\n}/),
      'return { pickIntakeHost, isRetiredIntakeOrigin, DEFAULT_INTAKE_HOST };',
    ].join('\n');
    return new Function(body)();
  }

  const RETIRED_ORIGIN = 'https://' + ['life-command-center-nine', 'vercel', 'app'].join('.');
  const RAILWAY = 'https://tranquil-delight-production-633f.up.railway.app';

  it('a stored *.vercel.app origin in LCC_RAILWAY_URL is replaced by the Railway default', () => {
    const { pickIntakeHost, DEFAULT_INTAKE_HOST } = loadResolver();
    assert.equal(pickIntakeHost({ LCC_RAILWAY_URL: RETIRED_ORIGIN }), DEFAULT_INTAKE_HOST);
    assert.equal(pickIntakeHost({ LCC_RAILWAY_URL: RETIRED_ORIGIN + '/' }), DEFAULT_INTAKE_HOST);
  });

  it('a stored *.vercel.app origin in LCC_VERCEL_URL (Railway unset) is also refused', () => {
    const { pickIntakeHost, DEFAULT_INTAKE_HOST } = loadResolver();
    assert.equal(pickIntakeHost({ LCC_VERCEL_URL: RETIRED_ORIGIN }), DEFAULT_INTAKE_HOST);
  });

  it('positive control: a configured Railway origin is honoured unchanged (minus trailing slash)', () => {
    const { pickIntakeHost } = loadResolver();
    assert.equal(pickIntakeHost({ LCC_RAILWAY_URL: RAILWAY + '/' }), RAILWAY);
    assert.equal(pickIntakeHost({}), RAILWAY);
  });

  it('negative control: the refusal is about the platform, not a string accident', () => {
    const { isRetiredIntakeOrigin } = loadResolver();
    assert.equal(isRetiredIntakeOrigin('https://x.vercel.app'), true);
    assert.equal(isRetiredIntakeOrigin('https://vercel.app.example.com'), false);
    assert.equal(isRetiredIntakeOrigin('not a url'), false);
  });

  it('sidepanel.js carries the same rule for its own config reads', () => {
    const src = readFileSync(join(EXT, 'sidepanel.js'), 'utf8');
    assert.match(src, /function normalizeLCCHost\(/, 'sidepanel.js must normalize LCC_RAILWAY_URL through normalizeLCCHost()');
    assert.match(src, /\.vercel\\\.app\$|\\\.vercel\\\.app\$/, 'normalizeLCCHost must refuse *.vercel.app');
    const cfgReads = (stripComments(src).match(/chrome\.storage\.sync\.get\(\['LCC_RAILWAY_URL'/g) || []).length;
    assert.equal(cfgReads, 1, 'sidepanel.js must read LCC_RAILWAY_URL through getLCCConfig() only');
  });
});
