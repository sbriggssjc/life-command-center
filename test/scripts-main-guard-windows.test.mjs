// A script whose "run as main" guard compares import.meta.url to a string built
// from process.argv[1] NEVER runs on Windows: argv[1] is `C:\...\x.mjs`, the URL
// is `file:///C:/...`. main() is skipped and the command exits 0 having done
// nothing — the silent-success shape this repo catalogues everywhere. It bit the
// OCR1 bake-off on its first real run (2026-09-02): --self-test, --fetch-baselines
// and --run all printed nothing and Scott had no way to tell.
//
// Class guard over every script, not the one file: the idiom is a copy-paste.
// Comments are stripped first so a fix's own explanatory comment cannot satisfy
// or trip the grep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['scripts', 'mcp', 'api'];

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function* walk(dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* walk(p); }
    else if (/\.(mjs|js)$/.test(e.name)) yield p;
  }
}

const BAD_GUARD = /import\.meta\.url\s*===?\s*(`file:\/\/\$\{process\.argv\[1\]\}`|['"]file:\/\/['"]\s*\+\s*process\.argv\[1\])/;
const BAD_PATHNAME = /new URL\(import\.meta\.url\)\.pathname/;

test('no script guards main() with a string compare against process.argv[1]', () => {
  const offenders = [];
  let scanned = 0;
  for (const root of ROOTS) for (const f of walk(root)) {
    scanned++;
    const src = stripComments(readFileSync(f, 'utf8'));
    if (BAD_GUARD.test(src)) offenders.push(`${f}: string-compare main guard (never matches on Windows)`);
    if (BAD_PATHNAME.test(src)) offenders.push(`${f}: new URL(import.meta.url).pathname (yields /C:/... on Windows)`);
  }
  assert.ok(scanned > 20, `population control: scanned only ${scanned} files`);
  assert.deepEqual(offenders, []);
});

test('positive control: the detector matches the exact idiom that bit OCR1', () => {
  assert.ok(BAD_GUARD.test('if (import.meta.url === `file://${process.argv[1]}`) {'));
  assert.ok(BAD_PATHNAME.test("readFileSync(new URL(import.meta.url).pathname, 'utf8')"));
  assert.ok(!BAD_GUARD.test('if (import.meta.url === pathToFileURL(process.argv[1]).href) {'));
});
