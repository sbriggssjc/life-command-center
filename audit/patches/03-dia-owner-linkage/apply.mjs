#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #3, Phase A: wire resolveOwnerLinks for dia domain
// Closes finding: A-2 (the forward-looking half — Phase B = backfill, deferred)
// Branch: audit/03-dia-owner-linkage
//
// Run from the repo root:
//   node audit/patches/03-dia-owner-linkage/apply.mjs --dry
//   node audit/patches/03-dia-owner-linkage/apply.mjs --apply
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
function toEol(s, eol) {
  return s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
}
function expectUnique(content, anchor, label) {
  const n = content.split(anchor).length - 1;
  if (n === 0) throw new EditError(label, 'anchor NOT FOUND. File may already be patched, or codebase drifted.');
  if (n > 1)   throw new EditError(label, `anchor matched ${n} times — must be UNIQUE.`);
}
function makeApplier(originalContent) {
  const eol = detectEol(originalContent);
  let content = originalContent;
  return {
    eol,
    get content() { return content; },
    set content(v) { content = v; },
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

// ============================================================================
// FILE 1: api/_handlers/intake-promoter.js
// ----------------------------------------------------------------------------
// Edits:
//   (a) Add import { reconcilePropertyOwnership } from sidebar-pipeline.js.
//   (b) Replace the dia early-return at line 1504 with a dispatch to a new
//       function resolveOwnerLinksDia(match, snapshot).
//   (c) Define resolveOwnerLinksDia ABOVE resolveOwnerLinks: mirrors gov
//       logic with dia column names (normalized_name vs canonical_name, no
//       sf_account_id on recorded_owners, sf_company_id on true_owners).
//       After patching FKs, call reconcilePropertyOwnership('dialysis', ...)
//       to denormalize recorded_owner_name + true_owner_name on properties.
// ============================================================================
async function patchIntakePromoter(report) {
  const path = resolve(REPO_ROOT, 'api', '_handlers', 'intake-promoter.js');
  const original = await readFile(path, 'utf8');
  const ctx = makeApplier(original);

  // ---- (a) Import reconcilePropertyOwnership ----
  // The file already imports many things from sidebar-pipeline.js (or related).
  // Insert as a sibling import after the existing entity-link.js import line.
  // We use a unique anchor — the line that imports ensureEntityLink (line 14
  // per audit reading).
  ctx.E('promoter.import.reconcile',
`// api/_handlers/intake-promoter.js`,
`// api/_handlers/intake-promoter.js
// Item #3 (audit/03-dia-owner-linkage): pulled in to denormalize
// recorded_owner_name / true_owner_name on dia.properties after the new
// resolveOwnerLinksDia branch patches recorded_owner_id / true_owner_id.
import { reconcilePropertyOwnership } from './sidebar-pipeline.js';`);

  // ---- (b) Replace the dia early-return + (c) wire dispatch ----
  // The current shape (lines 1503-1506):
  //   async function resolveOwnerLinks(match, snapshot) {
  //     if (match.domain !== 'government') {
  //       return { ok: true, skipped: `owner_resolution_not_implemented_for_${match.domain}` };
  //     }
  //
  // We replace it with a dispatcher that hands dia off to a new sibling
  // function defined ABOVE resolveOwnerLinks.
  ctx.E('promoter.dispatch',
`async function resolveOwnerLinks(match, snapshot) {
  if (match.domain !== 'government') {
    return { ok: true, skipped: \`owner_resolution_not_implemented_for_\${match.domain}\` };
  }`,
`// ── Item #3 (audit/03-dia-owner-linkage): dia owner resolution sibling.
// Mirrors the gov resolveOwnerLinks pattern below with dia column names:
//   - lookup tables: recorded_owners (PK recorded_owner_id UUID),
//     true_owners (PK true_owner_id UUID) — same as gov
//   - fuzzy-match cols: dia uses 'normalized_name' (gov uses 'canonical_name')
//   - SF link: dia.recorded_owners has NO sf_account_id; dia.true_owners
//     has sf_company_id + salesforce_id. The dia SF integration runs via
//     crossReferenceSalesforce in sidebar-pipeline.js, NOT via the
//     resolveOwnerLinks SF auto-link path. We surface sf_sync_flags for
//     telemetry but skip the gov-style auto-PATCH for sf_account_id.
// After the FK patches, call reconcilePropertyOwnership('dialysis', ...)
// to denormalize recorded_owner_name / true_owner_name onto properties
// (matching what sidebar-pipeline's deed-parser flow already does for
// CoStar captures).
async function resolveOwnerLinksDia(match, snapshot) {
  const propertyId = match.property_id; // dia property_id is BIGINT, not UUID
  const propRes = await domainQuery(
    'dialysis',
    'GET',
    \`properties?property_id=eq.\${propertyId}&select=recorded_owner_id,true_owner_id,assessed_owner,notes&limit=1\`
  );
  if (!propRes.ok || !Array.isArray(propRes.data) || !propRes.data.length) {
    return { ok: false, skipped: 'property_not_found' };
  }
  const prop = propRes.data[0];

  // Owner-name signal: same priority as gov.
  let ownerName = (snapshot?.seller_name || '').trim()
               || (prop.assessed_owner || '').trim();
  if (!ownerName && typeof prop.notes === 'string') {
    const m = prop.notes.match(/(?:Lessor|Owner|Seller)\\s*:\\s*([^\\n,;]+)/i);
    if (m) ownerName = m[1].trim();
  }

  const result = {
    ok: true,
    domain:          'dialysis',
    owner_name_used: ownerName || null,
    recorded_owner:  { already_linked: !!prop.recorded_owner_id },
    true_owner:      { already_linked: !!prop.true_owner_id },
    sf_sync_flags:   [],
  };
  if (!ownerName) {
    result.skipped = 'no_owner_signal';
    return result;
  }

  // Normalize same way as gov (strip suffix tokens, collapse whitespace).
  const coreName = ownerName
    .replace(/,/g, ' ')
    .replace(/\\b(LLC|L\\.L\\.C\\.|LP|L\\.P\\.|INC|INC\\.|CORP|CORP\\.|LLP|CO|LTD|PLLC)\\b/gi, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
  const pattern = \`*\${coreName}*\`;

  // dia.recorded_owners has no sf_account_id; dia.true_owners has
  // sf_company_id (different name). Two helpers because column lists differ.
  const lookupRecordedOwner = async () => {
    const [byName, byNorm] = await Promise.all([
      domainQuery('dialysis', 'GET',
        \`recorded_owners?name=ilike.\${encodeURIComponent(pattern)}&select=recorded_owner_id,name,true_owner_id&limit=5\`
      ),
      domainQuery('dialysis', 'GET',
        \`recorded_owners?normalized_name=ilike.\${encodeURIComponent(pattern)}&select=recorded_owner_id,name,true_owner_id&limit=5\`
      ),
    ]);
    const rows = [], seen = new Set();
    for (const r of (byName.data || [])) { if (!seen.has(r.recorded_owner_id)) { seen.add(r.recorded_owner_id); rows.push(r); } }
    for (const r of (byNorm.data || [])) { if (!seen.has(r.recorded_owner_id)) { seen.add(r.recorded_owner_id); rows.push(r); } }
    return rows;
  };
  const lookupTrueOwner = async () => {
    const [byName, byNorm] = await Promise.all([
      domainQuery('dialysis', 'GET',
        \`true_owners?name=ilike.\${encodeURIComponent(pattern)}&select=true_owner_id,name,sf_company_id,salesforce_id&limit=5\`
      ),
      domainQuery('dialysis', 'GET',
        \`true_owners?normalized_name=ilike.\${encodeURIComponent(pattern)}&select=true_owner_id,name,sf_company_id,salesforce_id&limit=5\`
      ),
    ]);
    const rows = [], seen = new Set();
    for (const r of (byName.data || [])) { if (!seen.has(r.true_owner_id)) { seen.add(r.true_owner_id); rows.push(r); } }
    for (const r of (byNorm.data || [])) { if (!seen.has(r.true_owner_id)) { seen.add(r.true_owner_id); rows.push(r); } }
    return rows;
  };

  // ---- true_owner first
  if (!prop.true_owner_id) {
    const toRows = await lookupTrueOwner();
    if (toRows.length) {
      const best = toRows[0];
      const patchRes = await domainQuery(
        'dialysis',
        'PATCH',
        \`properties?property_id=eq.\${propertyId}\`,
        { true_owner_id: best.true_owner_id }
      );
      result.true_owner = {
        already_linked: false,
        resolved_id:    best.true_owner_id,
        resolved_name:  best.name,
        sf_company_id:  best.sf_company_id || null,
        salesforce_id:  best.salesforce_id || null,
        patched:        patchRes.ok,
      };
      if (!best.sf_company_id && !best.salesforce_id) {
        result.sf_sync_flags.push({
          kind: 'true_owner',
          owner_id: best.true_owner_id,
          name: best.name,
          reason: 'no_sf_link — surface for manual SF match (dia SF sync runs via crossReferenceSalesforce)',
        });
      }
    } else {
      result.true_owner.lookup = 'no_match';
    }
  } else {
    const existing = await domainQuery(
      'dialysis',
      'GET',
      \`true_owners?true_owner_id=eq.\${encodeURIComponent(prop.true_owner_id)}&select=true_owner_id,name,sf_company_id,salesforce_id&limit=1\`
    );
    if (existing.ok && existing.data?.length) {
      const row = existing.data[0];
      result.true_owner.resolved_name = row.name;
      result.true_owner.sf_company_id = row.sf_company_id || null;
      result.true_owner.salesforce_id = row.salesforce_id || null;
    }
  }

  // ---- recorded_owner
  if (!prop.recorded_owner_id) {
    const roRows = await lookupRecordedOwner();
    if (roRows.length) {
      const best = roRows[0];
      const patchRes = await domainQuery(
        'dialysis',
        'PATCH',
        \`properties?property_id=eq.\${propertyId}\`,
        { recorded_owner_id: best.recorded_owner_id }
      );
      result.recorded_owner = {
        already_linked: false,
        resolved_id:    best.recorded_owner_id,
        resolved_name:  best.name,
        true_owner_id:  best.true_owner_id || null,
        patched:        patchRes.ok,
      };
    } else {
      result.recorded_owner.lookup = 'no_match';
    }
  } else {
    const existing = await domainQuery(
      'dialysis',
      'GET',
      \`recorded_owners?recorded_owner_id=eq.\${encodeURIComponent(prop.recorded_owner_id)}&select=recorded_owner_id,name,true_owner_id&limit=1\`
    );
    if (existing.ok && existing.data?.length) {
      result.recorded_owner.resolved_name = existing.data[0].name;
    }
  }

  // Denormalize recorded_owner_name + true_owner_name onto properties.
  // reconcilePropertyOwnership reads ownership_history if present and
  // patches the denorm columns. If no ownership_history rows exist, it
  // returns { updated:false } silently — safe to call unconditionally.
  try {
    const reconcileRes = await reconcilePropertyOwnership('dialysis', propertyId);
    if (reconcileRes?.updated) {
      result.reconcile = { ok: true, patch: reconcileRes.patch };
    } else {
      result.reconcile = { ok: true, reason: reconcileRes?.reason || 'no_ownership_history' };
    }
  } catch (err) {
    result.reconcile = { ok: false, error: err?.message || String(err) };
  }

  return result;
}

async function resolveOwnerLinks(match, snapshot) {
  if (match.domain === 'dialysis') {
    return resolveOwnerLinksDia(match, snapshot);
  }
  if (match.domain !== 'government') {
    return { ok: true, skipped: \`owner_resolution_not_implemented_for_\${match.domain}\` };
  }`);

  // ---- Write ----
  const c = ctx.content;
  if (c === original) {
    report.push(['intake-promoter.js', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  const label = `api/_handlers/intake-promoter.js (${ctx.eol === '\r\n' ? 'CRLF' : 'LF'})`;
  report.push([label, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

// ============================================================================
// FILE 2: AUDIT_PROGRESS.md — flip item #3 status
// ============================================================================
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) {
    throw new Error('AUDIT_PROGRESS.md not found.');
  }
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, eol);

  let c = original;

  // Item #2 row: flip from "IN PROGRESS (Phase B pending)" to "DONE (Phase A merged, Phase B deferred)"
  const item2Old = N(`| 2 | Drain \`llc_research_queue\` (cron + UI, no scraper) | \`audit/02-research-queue-drain\` | 🟨 IN PROGRESS | A-1, B-5 | CRITICAL · Phase A: cron scheduled (2026-05-17). Phase B: UI surfaces. D-13 moved to item #5 — see notes below. |`);
  const item2New = N(`| 2 | Drain \`llc_research_queue\` (cron + UI, no scraper) | \`audit/02-research-queue-drain\` | ✅ DONE (Phase A) / ⏸️ DEFERRED (Phase B) | A-1, B-5 | Phase A merged to main as \`54ee38e\` (cron live, verified). Phase B (UI) deferred to follow-up session. D-13 moved to item #5. |`);
  const n2 = c.split(item2Old).length - 1;
  if (n2 === 1) c = c.replace(item2Old, item2New);
  else console.warn('[audit_progress] item-2 row not found or already updated');

  // Item #3 row: PENDING → IN PROGRESS
  const item3Old = N(`| 3 | Wire \`resolveOwnerLinks\` for dia + backfill | \`audit/03-dia-owner-linkage\` | 🟦 PENDING | A-2 | CRITICAL |`);
  const item3New = N(`| 3 | Wire \`resolveOwnerLinks\` for dia + backfill | \`audit/03-dia-owner-linkage\` | 🟨 IN PROGRESS | A-2 | CRITICAL · Phase A: forward-looking dia owner resolution (this commit). Phase B: one-shot backfill of 13,338 NULL-owner dia properties (deferred). |`);
  const n3 = c.split(item3Old).length - 1;
  if (n3 === 1) c = c.replace(item3Old, item3New);
  else console.warn('[audit_progress] item-3 row not found or already updated');

  // Append closeout block before the existing "Sprint preflight" anchor.
  const appendBlock = N(`

## Closeout — item 3 — Phase A (resolveOwnerLinksDia)
- **Status:** 🟨 IN PROGRESS (Phase A landed; Phase B = one-shot backfill, deferred)
- **Branch:** \`audit/03-dia-owner-linkage\`
- **Patch:** \`audit/patches/03-dia-owner-linkage/apply.mjs\`
- **Closes:** A-2 (forward-looking half) — backfill of historical 13,338 NULL-owner dia properties is Phase B.
- **Files changed:**
  - \`api/_handlers/intake-promoter.js\`
    - New \`resolveOwnerLinksDia(match, snapshot)\` sibling function (~120 lines). Mirrors the gov \`resolveOwnerLinks\` pattern with dia column names (\`normalized_name\` instead of \`canonical_name\`, \`sf_company_id\`/\`salesforce_id\` instead of \`sf_account_id\`). Owner-name signal: \`snapshot.seller_name\` → \`property.assessed_owner\` → parsed from \`property.notes\`. Patches \`true_owner_id\` and \`recorded_owner_id\` on \`dia.properties\` when a fuzzy ILIKE match is found.
    - Updated \`resolveOwnerLinks\` dispatcher to route dia matches to the new sibling instead of returning the \`owner_resolution_not_implemented_for_dialysis\` skip.
    - After FK patches, calls \`reconcilePropertyOwnership('dialysis', propertyId)\` to denormalize \`recorded_owner_name\` + \`true_owner_name\` onto \`dia.properties\` (matching what \`sidebar-pipeline.js\` already does for CoStar captures).
    - New import: \`reconcilePropertyOwnership\` from \`./sidebar-pipeline.js\`.
  - \`AUDIT_PROGRESS.md\` — this file.
- **Scope of impact:**
  - **Forward-looking:** Every new dia OM intake from this commit forward will get owner FK linkage if a matching \`recorded_owners\` / \`true_owners\` row exists. Audit baseline (pre-patch): 13,338 of 15,219 dia properties (87.6%) have NULL \`recorded_owner_id\`. Phase A doesn't fix the historical backlog; Phase B will.
  - **Backward-looking (Phase B, deferred):** A one-shot Node script that walks the 13,338 NULL-owner properties and applies the same fuzzy-match logic. Will need rate-limiting + progress tracking + resumability (13k+ PostgREST round trips). ~200 lines of Node.
- **Verification (post-commit):**
  1. \`grep -c "resolveOwnerLinksDia" api/_handlers/intake-promoter.js\` → ≥ 2 (definition + dispatch call)
  2. \`grep -c "reconcilePropertyOwnership" api/_handlers/intake-promoter.js\` → ≥ 2 (import + call)
  3. \`node -c api/_handlers/intake-promoter.js\` → parses
  4. (Smoke test) Re-promote an existing dia OM intake by re-flagging it in Power Automate; query \`SELECT recorded_owner_id, true_owner_id FROM dia.properties WHERE property_id = <X>\` before and after; the FKs should now populate when a matching owner exists.
- **Commit SHA:** _paste after \`git commit\`_

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

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log(`\n=== LCC Audit Sprint — Item #3 Phase A: dia owner linkage ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN (no writes)' : 'APPLY (will write files)'}`);
  console.log(`Repo: ${REPO_ROOT}\n`);

  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}.`);
  }

  const report = [];
  await patchIntakePromoter(report);
  await updateAuditProgress(report);

  console.log(`--- ${DRY ? 'DRY-RUN' : 'APPLY'} SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(60)}  ${sign}${delta} bytes  (${note})`);
  }

  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply to write changes:\n`);
    console.log(`  node audit/patches/03-dia-owner-linkage/apply.mjs --apply\n`);
  } else {
    console.log(`\n✓ Apply complete. Next steps:\n`);
    console.log(`  git status`);
    console.log(`  git diff --stat`);
    console.log(`  node -c api/_handlers/intake-promoter.js`);
    console.log(`  git add -A`);
    console.log(`  git commit -F audit/patches/03-dia-owner-linkage/COMMIT_MSG.txt\n`);
  }
}

main().catch(err => {
  console.error(`\n❌ FAILED: ${err.message}\n`);
  console.error(`No files were modified.\n`);
  process.exit(1);
});
