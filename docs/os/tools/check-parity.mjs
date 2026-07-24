#!/usr/bin/env node
// Parity/drift check: (1) each surface bundle matches current canon; (2) each in-repo live artifact's
// managed region matches its bundle. Exits non-zero on drift (CI-friendly).
// Usage: node tools/check-parity.mjs [--root=<docs/os>]
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve((process.argv.slice(2).find(a => a.startsWith('--root=')) || '').split('=')[1] || process.cwd());
const log = (sym, msg) => console.log(`${sym} ${msg}`);

function canonVersion() {
  const t = readFileSync(join(ROOT, 'canon', '00-INDEX.md'), 'utf8');
  const m = t.match(/CANON_VERSION[:*\s]+([0-9]+\.[0-9]+\.[0-9]+)/i);
  if (!m) throw new Error('CANON_VERSION not found');
  return m[1];
}
function loadBlocks() {
  const dir = join(ROOT, 'canon', 'blocks');
  const b = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.md')) b[f.replace(/\.md$/, '')] = readFileSync(join(dir, f), 'utf8').trim();
  return b;
}

const version = canonVersion();
const manifest = JSON.parse(readFileSync(join(ROOT, 'render.manifest.json'), 'utf8'));
const blocks = loadBlocks();
const bundleDir = join(ROOT, manifest.bundleDir || 'surfaces');
let fail = 0, warn = 0;

for (const [id, s] of Object.entries(manifest.surfaces)) {
  const bundlePath = join(bundleDir, `${id}.canon.md`);
  if (!existsSync(bundlePath)) { log('✗', `${id}: bundle missing — run render`); fail++; continue; }
  const bundle = readFileSync(bundlePath, 'utf8');
  let ok = bundle.includes(`Canon: v${version}`);
  if (!ok) { log('✗', `${id}: bundle stamped stale (want v${version}) — run render`); fail++; }
  for (const bid of s.blocks) {
    if (!blocks[bid]) { log('✗', `${id}: canon block '${bid}' missing`); fail++; ok = false; }
    else if (!bundle.includes(blocks[bid])) { log('✗', `${id}: bundle missing/altered block '${bid}' — run render`); fail++; ok = false; }
  }
  if (ok) log('✓', `${id}: bundle current (v${version}, ${s.blocks.length} blocks)`);

  if (s.liveArtifact) {
    const p = resolve(ROOT, s.liveArtifact);
    if (!existsSync(p)) { log('•', `${id}: live artifact not in this tree — sync per protocol`); continue; }
    const t = readFileSync(p, 'utf8');
    if (s.markerBegin && t.includes(s.markerBegin) && t.includes(s.markerEnd)) {
      const region = t.slice(t.indexOf(s.markerBegin), t.indexOf(s.markerEnd));
      const good = region.includes(`v${version}`) && s.blocks.every(bid => region.includes(blocks[bid]));
      if (good) log('✓', `${id}: live artifact migrated & current`);
      else { log('✗', `${id}: live managed region STALE — run render --write-live & republish`); fail++; }
    } else { log('⚠', `${id}: live artifact not yet migrated (no CANON markers) — bootstrap per RENDER-AND-PARITY.md`); warn++; }
  } else if (s.external) {
    log('•', `${id}: external surface (${id.startsWith('northmarq') ? 'SharePoint prompt' : 'skills'}) — update via SURFACE-SYNC-PROTOCOL.md`);
  }
}
console.log(`\nCanon v${version} · ${fail} drift · ${warn} un-migrated`);
process.exit(fail ? 1 : 0);
