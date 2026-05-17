#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #4 Phase B-2 hotfix: cross-domain rank duplication
// One-line fix: spread order in the endpoint was clobbering the merged rank.
// Branch: audit/04-next-best-action-phase-b2-hotfix
// ============================================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

class EditError extends Error {
  constructor(label, msg) { super(`[${label}] ${msg}`); this.label = label; }
}
function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
function toEol(s, eol) { return s.replace(/\r\n/g, '\n').replace(/\n/g, eol); }
function expectUnique(content, anchor, label) {
  const n = content.split(anchor).length - 1;
  if (n === 0) throw new EditError(label, 'anchor NOT FOUND.');
  if (n > 1)   throw new EditError(label, `anchor matched ${n} times.`);
}
function makeApplier(originalContent) {
  const eol = detectEol(originalContent);
  let content = originalContent;
  return {
    eol, get content(){return content;},
    E(label, before, after) {
      const b = toEol(before, eol);
      const a = toEol(after, eol);
      expectUnique(content, b, label);
      content = content.replace(b, a);
    },
  };
}
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function patchAdminJs(report) {
  const path = resolve(REPO_ROOT, 'api', 'admin.js');
  const original = await readFile(path, 'utf8');
  const ctx = makeApplier(original);

  // Fix the spread order. The original wrote:
  //   const items = ...map((row, idx) => ({
  //     rank: offset + idx + 1,
  //     ...row,                  ← row.rank (per-domain SQL rank) overwrites
  //   }));
  // The merged rank we set was getting clobbered by the per-view rank
  // that each domain's v_next_best_action ROW_NUMBER() already computed.
  // Swap order so cross-domain rank wins.
  ctx.E('admin.nba.rank-spread-fix',
`  const items = merged.slice(offset, offset + limit).map((row, idx) => ({
    rank: offset + idx + 1,
    ...row,
  }));`,
`  const items = merged.slice(offset, offset + limit).map((row, idx) => ({
    // Hotfix (2026-05-17): spread row FIRST so the per-domain SQL rank
    // is overwritten by the merged cross-domain rank below. The original
    // order let row.rank (computed by ROW_NUMBER() inside each domain's
    // view) clobber the merged rank, producing duplicates like
    // 1, 1, 2, 2 across (gov, dia, gov, dia) when the merge interleaved.
    ...row,
    rank: offset + idx + 1,
  }));`);

  const c = ctx.content;
  if (c === original) {
    report.push(['admin.js', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`api/admin.js (${ctx.eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  let c = original;

  const appendBlock = N(`

## Hotfix — item 4 Phase B-2 — rank duplication on cross-domain merge
- **Status:** ✅ DONE (one-line fix)
- **Branch:** \`audit/04-next-best-action-phase-b2-hotfix\`
- **Patch:** \`audit/patches/04-next-best-action-phase-b2-hotfix/apply.mjs\`

### Bug
The first response from \`/api/admin?_route=next-best-action&limit=10\`
showed duplicated ranks: \`1, 1, 2, 2, 3, 4, 3, 5, ...\`. Each domain's
\`v_next_best_action\` view computes \`rank\` via \`ROW_NUMBER() OVER (...)\`
scoped to that view; when the endpoint merged across both domains and
spread the rows with \`{ rank: idx + 1, ...row }\`, the spread-after-rank
order let the per-domain rank clobber the merged cross-domain rank.

### Fix
Swap spread order so the merged rank wins:
\`\`\`js
// before
{ rank: offset + idx + 1, ...row }
// after
{ ...row, rank: offset + idx + 1 }
\`\`\`

### Verification (post-deploy)
\`\`\`powershell
curl -H "X-LCC-Key: \$env:LCC_API_KEY" \`
  "https://tranquil-delight-production-633f.up.railway.app/api/admin?_route=next-best-action&limit=15" |
  ConvertFrom-Json | Select-Object -ExpandProperty items |
  Format-Table rank, source_domain, gap_severity, property_id, @{n='value';e={\$_.gap_value -as [long]}}, gap_label
\`\`\`

Expected: \`rank\` column should now read \`1, 2, 3, 4, ...\` strictly
monotonic across the merged list regardless of \`source_domain\` interleaving.

`);

  const preflightAnchor = N(`\n# Sprint preflight — 2026-05-17\n`);
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }

  if (c === original) {
    report.push(['AUDIT_PROGRESS.md', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`AUDIT_PROGRESS.md (${eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log(`\n=== LCC Audit Sprint — Phase B-2 hotfix: rank duplication ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN' : 'APPLY'}\n`);
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}.`);
  }
  const report = [];
  await patchAdminJs(report);
  await updateAuditProgress(report);
  console.log(`--- SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(60)}  ${sign}${delta} bytes  (${note})`);
  }
  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply.\n`);
  }
}
main().catch(err => { console.error(`\n❌ FAILED: ${err.message}\n`); process.exit(1); });
