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

      // Per-file allowlists with caps. Each cap is the count of raw
      // mutations currently shipped — the test allows the existing ones
      // through but still trips on a new addition. When you intentionally
      // add another, bump the cap here and document why.
      //
      // app.js: 3 legacy gov-query proxy blocks pending migration.
      // gov.js: 2 gov-query proxy blocks (mass property update + cron triggers).
      // api/_handlers/contacts-handler.js: 2 govQuery PATCHes that auto-link
      //   newly-created or merged contacts to Salesforce sf_contact_id /
      //   sf_account_id (back-write from Power Automate matchback flow).
      const PROXY_CAPS = { 'app.js': 3, 'gov.js': 2 };
      const GOV_QUERY_CAPS = { 'api/_handlers/contacts-handler.js': 2 };

      if (relative === 'api/data-proxy.js' || relative === 'api/sync.js') {
        continue;
      }

      if (PROXY_CAPS[relative] !== undefined) {
        const hits = [...text.matchAll(rawProxyMutationPattern)];
        if (hits.length > PROXY_CAPS[relative]) {
          findings.push(`${relative}: ${hits.length} raw proxy mutation blocks (cap=${PROXY_CAPS[relative]})`);
        }
        continue;
      }

      if (GOV_QUERY_CAPS[relative] !== undefined) {
        const hits = [...text.matchAll(rawGovWritePattern)];
        if (hits.length > GOV_QUERY_CAPS[relative]) {
          findings.push(`${relative}: ${hits.length} raw govQuery POST/PATCH mutations (cap=${GOV_QUERY_CAPS[relative]})`);
        }
        rawGovWritePattern.lastIndex = 0;
        // Allowlisted file: still check dia and proxy patterns below.
        if (rawDiaWritePattern.test(text)) {
          findings.push(`${relative}: contains raw diaQuery POST/PATCH mutation`);
        }
        rawDiaWritePattern.lastIndex = 0;
        if (rawProxyMutationPattern.test(text)) {
          findings.push(`${relative}: contains direct /api/gov-query or /api/dia-query mutation block`);
        }
        rawProxyMutationPattern.lastIndex = 0;
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
