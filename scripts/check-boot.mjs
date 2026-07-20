#!/usr/bin/env node
// check-boot.mjs — CI must catch an app that can't boot.
//
// Why this exists (2026-07-20 incident): a bad merge left api/intake.js with two
// `error:` keys in one object literal and no comma between them:
//     error: '...',
//     error: '...'   ← SyntaxError: Unexpected identifier 'error'
// server.js imports api/intake.js at boot, so every Railway build crash-looped
// and Railway kept serving the last healthy container — production froze while
// four subsequent merges silently never shipped. The 2,000-test suite passed the
// whole time, because tests import individual modules; NOTHING imports the app.
// (This is very likely the mechanism behind the earlier "_route dispatch
// regressed" misdiagnoses — the routes were never missing; the deploys weren't
// landing.) test/operations-subroutes.test.mjs guards the REPO dispatch, not the
// deploy, so it structurally cannot catch this.
//
// Two gates, cheapest first:
//   1. SYNTAX SWEEP — `node --check` over server.js + api/**/*.js (incl.
//      _handlers/ and _shared/). This alone catches the exact intake.js bug: it
//      was the ONLY broken file among the ~14 api/*.js + ~137 handler/shared
//      modules. Cheap, precise, zero side effects.
//   2. IMPORT BOOT — import('./server.js') in a child process with
//      LCC_BOOT_CHECK=1 (server.js skips app.listen in that mode). Resolving the
//      full module graph catches import-time failures a syntax check misses: a
//      bad named export, a circular import, a module-level throw. It binds no
//      port, opens no socket, hits no DB, and needs no secrets (it only warns
//      about missing env vars — graceful degradation, by design).
//
// Requires NO network, NO database, NO secrets. Fast — keep it that way so
// nobody skips it. Exit 0 = the app can boot; non-zero = it can't.
//
// Usage: node scripts/check-boot.mjs   |   npm run check:boot

import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function run(cmd, args, extraEnv) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: ROOT, env: { ...process.env, ...extraEnv }, timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr, err }),
    );
  });
}

// Recursively collect every .js file under a directory.
function collectJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collectJs(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

async function syntaxSweep() {
  const files = [join(ROOT, 'server.js'), ...collectJs(join(ROOT, 'api'))];
  console.log(`▶ Syntax sweep: node --check over ${files.length} files (server.js + api/**/*.js)`);
  const failures = [];
  // Bounded concurrency so we don't spawn hundreds of node processes at once.
  const CONCURRENCY = 8;
  let idx = 0;
  async function worker() {
    while (idx < files.length) {
      const file = files[idx++];
      const { code, stderr } = await run(process.execPath, ['--check', file]);
      if (code !== 0) failures.push({ file: relative(ROOT, file), detail: (stderr || '').trim() });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  if (failures.length) {
    for (const f of failures) {
      console.error(`  ✖ ${f.file}`);
      if (f.detail) console.error(`      ${f.detail.split('\n').slice(0, 4).join('\n      ')}`);
    }
    return { ok: false, count: failures.length };
  }
  console.log(`  ✓ all ${files.length} files parse`);
  return { ok: true };
}

async function importBoot() {
  console.log('▶ Import boot: import(./server.js) with LCC_BOOT_CHECK=1 (no port, no DB, no secrets)');
  const serverUrl = pathToFileURL(join(ROOT, 'server.js')).href;
  // Run in a child so a module-level throw / process.exit can't take THIS
  // process with it, and so LCC_BOOT_CHECK is scoped to the child.
  const child = `
    process.env.LCC_BOOT_CHECK = '1';
    try {
      await import(${JSON.stringify(serverUrl)});
      console.log('__BOOT_IMPORT_OK__');
      process.exit(0);
    } catch (e) {
      console.error('IMPORT FAILED: ' + (e && (e.stack || e.message) || e));
      process.exit(1);
    }
  `;
  const { code, stdout, stderr } = await run(
    process.execPath,
    ['--input-type=module', '-e', child],
    { LCC_BOOT_CHECK: '1' },
  );
  const out = `${stdout}${stderr}`;
  if (code !== 0 || !out.includes('__BOOT_IMPORT_OK__')) {
    console.error('  ✖ server.js could not be imported:');
    for (const line of out.trim().split('\n').filter(Boolean)) {
      if (!line.includes('boot-check OK')) console.error(`      ${line}`);
    }
    return { ok: false };
  }
  console.log('  ✓ server.js imports cleanly (full module graph resolved)');
  return { ok: true };
}

async function main() {
  const started = Date.now();
  const sweep = await syntaxSweep();
  // Only attempt the import boot if the syntax is valid — otherwise the import
  // would fail for the same reason and the sweep already named the file(s).
  const boot = sweep.ok ? await importBoot() : { ok: false, skipped: true };
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  if (!sweep.ok || !boot.ok) {
    console.error(`\n✖ Boot check FAILED (${secs}s) — the app cannot boot; do not deploy.`);
    if (boot.skipped) console.error('  (import boot skipped: fix the syntax error(s) above first)');
    process.exit(1);
  }
  console.log(`\n✓ Boot check passed (${secs}s) — the app can boot.`);
}

main().catch((err) => {
  console.error(`✖ check-boot crashed: ${err.stack || err.message}`);
  process.exit(2);
});
