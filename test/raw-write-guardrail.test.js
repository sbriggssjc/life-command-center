import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.vercel']);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
      continue;
    }
    if (JS_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

const rawProxyMutationPattern = /new URL\(['"]\/api\/(?:gov|dia)-query['"][\s\S]{0,500}?method:\s*['"](POST|PATCH)['"]/g;
const rawGovWritePattern = /govQuery\('(POST|PATCH)'/g;
const rawDiaWritePattern = /diaQuery\([\s\S]{0,120}?method:\s*['"](POST|PATCH)['"]/g;

describe('raw write guardrail', () => {
  it('does not allow new direct gov/dia business mutations outside approved exemptions', () => {
    const files = walk(ROOT);
    const findings = [];

    for (const file of files) {
      const relative = rel(file);
      const text = fs.readFileSync(file, 'utf8');

      if (relative === 'app.js') {
        const allowedProxyHits = [...text.matchAll(rawProxyMutationPattern)];
        if (allowedProxyHits.length > 3) {
          findings.push(`${relative}: unexpected number of raw proxy mutation blocks (${allowedProxyHits.length})`);
        }
        continue;
      }

      if (relative === 'api/data-proxy.js' || relative === 'api/sync.js') {
        continue;
      }

      if (rawGovWritePattern.test(text)) {
        findings.push(`${relative}: contains raw govQuery POST/PATCH mutation`);
      }
      rawGovWritePattern.lastIndex = 0;

      if (rawDiaWritePattern.test(text)) {
        findings.push(`${relative}: contains raw diaQuery POST/PATCH mutation`);
      }
      rawDiaWritePattern.lastIndex = 0;

      if (rawProxyMutationPattern.test(text)) {
        findings.push(`${relative}: contains direct /api/gov-query or /api/dia-query mutation block`);
      }
      rawProxyMutationPattern.lastIndex = 0;
    }

    assert.deepEqual(findings, []);
  });
});
