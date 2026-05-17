#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #7: seed cadence + inbox triage on new contact entities
// Closes findings: D-2 (sidebar new-contact dead-end), partial D-6
// Branch: audit/07-contact-cadence-seed
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
    eol,
    get content() { return content; },
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
// FILE 1: api/_handlers/sidebar-pipeline.js
// ----------------------------------------------------------------------------
// Edits:
//   (a) Import getCadenceState from cadence-engine.
//   (b) In unpackContacts, after a person entity is newly created via
//       ensureEntityLink (link.createdEntity === true), fire:
//         1. getCadenceState({ entity_id: link.entityId }, { domain })
//            — initializes touchpoint_cadence at touch 0.
//         2. POST inbox_items source_type='new_contact_qualify'
//            — surfaces the new contact for Scott's triage.
//       Both wrapped in try/catch; failures NEVER roll back the unpack flow.
// ============================================================================
async function patchSidebarPipeline(report) {
  const path = resolve(REPO_ROOT, 'api', '_handlers', 'sidebar-pipeline.js');
  const original = await readFile(path, 'utf8');
  const ctx = makeApplier(original);

  // (a) Import getCadenceState
  ctx.E('sidebar.import.getCadenceState',
`import { runListingBdPipeline } from '../_shared/listing-bd.js';`,
`import { runListingBdPipeline } from '../_shared/listing-bd.js';
import { getCadenceState } from '../_shared/cadence-engine.js';`);

  // (b) Inject the cadence-seed + inbox-triage block right after
  // `if (link.createdEntity) created++;` in unpackContacts. Anchor uses the
  // surrounding lines for uniqueness.
  ctx.E('sidebar.unpackContacts.cadence-seed',
`    if (!link.ok) {
      console.error('[Sidebar pipeline] Failed to create contact entity:', contact.name, link.error);
      continue;
    }

    if (link.createdEntity) created++;

    // Store additional contact details via PATCH if we have enrichment data
    if (entityType === 'person' && (contact.email || contact.phones?.length || contact.title)) {`,
`    if (!link.ok) {
      console.error('[Sidebar pipeline] Failed to create contact entity:', contact.name, link.error);
      continue;
    }

    if (link.createdEntity) created++;

    // ── Item #7 (audit/07-contact-cadence-seed): seed cadence + inbox
    // triage for newly-created person entities so each captured broker
    // is immediately visible in the triage flow instead of dead-ending
    // at a row write. Closes D-2 and the contact-side of D-6.
    //
    // Gating:
    //   • Only on link.createdEntity === true (skip pre-existing entities;
    //     they already have whatever cadence state they need).
    //   • Only for person entities — companies don't get cadence rows.
    //   • Only when we have a workspaceId + userId (sidebar paths that
    //     skip the bridge gate land here with both unset; bail silently).
    //
    // Both calls wrapped in try/catch: a failure here MUST NOT roll back
    // the upstream unpackContacts work. Stragglers can be re-seeded later
    // via a backfill if needed.
    if (link.createdEntity && entityType === 'person' && workspaceId && link.entityId) {
      try {
        // 1. Initialize touchpoint_cadence at touch 0 (idempotent — if a
        //    row already exists for this entity_id it's returned unchanged).
        const cadenceRes = await getCadenceState(
          { entity_id: link.entityId },
          { domain }
        );
        if (!cadenceRes?.ok) {
          console.warn('[contact-cadence-seed] getCadenceState non-ok for',
            link.entityId, '-', cadenceRes?.error || 'unknown');
        }
        // 2. POST inbox_items so the new contact lands in Scott's triage
        //    queue. Skip if cadence row was pre-existing (is_new === false)
        //    — that means this contact was already triaged before.
        if (cadenceRes?.ok && cadenceRes.is_new) {
          const role = contact.role || 'unknown';
          const title = \`New contact: \${contact.name}\${role && role !== 'unknown' ? ' (' + role + ')' : ''}\`;
          const bodyLines = [
            \`Captured from \${source} on \${new Date(extractedAt).toLocaleDateString()}.\`,
            \`Role: \${role}\`,
          ];
          if (contact.company) bodyLines.push(\`Firm: \${contact.company}\`);
          if (contact.email)   bodyLines.push(\`Email: \${contact.email}\`);
          if (contact.phones?.length) bodyLines.push(\`Phone: \${contact.phones[0]}\`);
          if (contact.title)   bodyLines.push(\`Title: \${contact.title}\`);
          bodyLines.push('');
          bodyLines.push('Triage to qualify, set priority tier, and route to the right cadence template.');

          const inboxRes = await opsQuery('POST', 'inbox_items', {
            workspace_id:   workspaceId,
            source_user_id: userId,
            visibility:     'private',
            title,
            body:           bodyLines.join('\\n'),
            source_type:    'new_contact_qualify',
            status:         'new',
            priority:       'normal',
            entity_id:      link.entityId,
            domain:         domain || null,
            metadata: {
              role,
              source:           \`\${source}_sidebar\`,
              contact_name:     contact.name,
              contact_email:    contact.email || null,
              contact_phone:    contact.phones?.[0] || contact.phone || null,
              contact_company:  contact.company || null,
              contact_title:    contact.title || null,
              cadence_id:       cadenceRes.cadence?.id || null,
              extracted_at:     extractedAt,
              property_entity_id: propertyEntityId || null,
            },
          }, { 'Prefer': 'return=minimal' });
          if (!inboxRes?.ok) {
            console.warn('[contact-cadence-seed] inbox_items POST failed for',
              link.entityId, '-', inboxRes?.status, inboxRes?.data);
          } else {
            console.log(\`[contact-cadence-seed] seeded cadence + inbox for new contact \${contact.name} (entity \${link.entityId}, domain \${domain})\`);
          }
        }
      } catch (err) {
        // Never propagate — cadence/inbox seeding is best-effort follow-up
        // to the unpackContacts core work.
        console.error('[contact-cadence-seed] failed (non-fatal):', err?.message || err);
      }
    }

    // Store additional contact details via PATCH if we have enrichment data
    if (entityType === 'person' && (contact.email || contact.phones?.length || contact.title)) {`);

  const c = ctx.content;
  if (c === original) {
    report.push(['sidebar-pipeline.js', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`api/_handlers/sidebar-pipeline.js (${ctx.eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

// ============================================================================
// FILE 2: AUDIT_PROGRESS.md — flip item #7 status
// ============================================================================
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  let c = original;

  // Item #7 row: PENDING → IN PROGRESS
  const oldRow = N(`| 7 | Seed cadence on new contact writes | \`audit/07-contact-cadence-seed\` | 🟦 PENDING | D-2, D-6 | CRITICAL |`);
  const newRow = N(`| 7 | Seed cadence on new contact writes | \`audit/07-contact-cadence-seed\` | 🟧 REVIEW | D-2, D-6 (part) | CRITICAL · sidebar path landed. contacts-handler mirror = follow-up. |`);
  const n7 = c.split(oldRow).length - 1;
  if (n7 === 1) c = c.replace(oldRow, newRow);
  else console.warn('[audit_progress] item-7 row not found (n=' + n7 + ')');

  // Item #5 row update (still says IN PROGRESS — should be DONE Phase A on main)
  const item5InProgress = N(`| 5 | Fix silent-write loop in sidebar-pipeline (provenance integrity) + sidebar→ownership_research_queue schema fix | \`audit/05-provenance-integrity\` | 🟨 IN PROGRESS | A-3, D-13 | CRITICAL · Phase A (this commit): ingest_write_failures table + domainQuery instrumentation. Phase B (deferred): gate 47 pushProvenance/recordCoStarFieldsProvenance call sites on .ok + fix D-13 column-schema mismatch in two ownership_research_queue writers. |`);
  const item5Done = N(`| 5 | Fix silent-write loop in sidebar-pipeline (provenance integrity) | \`audit/05-provenance-integrity\` | ✅ DONE (Phase A) / ⏸️ DEFERRED (Phase B) | A-3 | Phase A merged to main as \`08846cc\`. ingest_write_failures table live + domainQuery instrumented. Phase B (pushProvenance gating + D-13 column-schema fix) deferred until we observe real failure patterns. |`);
  const n5 = c.split(item5InProgress).length - 1;
  if (n5 === 1) c = c.replace(item5InProgress, item5Done);

  const appendBlock = N(`

## Closeout — item 7 — Seed cadence + inbox triage on new contact entities
- **Status:** 🟧 REVIEW (pending merge to main)
- **Branch:** \`audit/07-contact-cadence-seed\`
- **Patch:** \`audit/patches/07-contact-cadence-seed/apply.mjs\`
- **Closes:** D-2 (sidebar new-contact dead-end) ✓. D-6 (cadence engine only covers contacts) is partially addressed — the contact half now seeds automatically; the broader \`subject_kind = property | listing | owner\` extension stays open as a separate finding.
- **Files changed:**
  - \`api/_handlers/sidebar-pipeline.js\`
    - Added \`getCadenceState\` import from \`./cadence-engine.js\`.
    - Inside \`unpackContacts\` (the entity-creation pass), after \`ensureEntityLink\` returns \`link.createdEntity === true\` for a person entity AND workspaceId/userId are present:
      1. Call \`getCadenceState({ entity_id: link.entityId }, { domain })\` to initialize the cadence row at touch 0 (idempotent — returns existing row if already there).
      2. If \`cadenceRes.is_new === true\` (genuinely-new entity, not a re-link of an existing one), POST an \`inbox_items\` row with \`source_type='new_contact_qualify'\`, the entity_id, role-aware title, and contact metadata (firm, email, phone, title, property_entity_id) for Scott's triage flow.
    - Whole block wrapped in try/catch. A failure here NEVER rolls back the unpackContacts core work.
  - \`AUDIT_PROGRESS.md\` — item #5 flipped to DONE (Phase A) with merge SHA \`08846cc\`; item #7 to REVIEW; new closeout section.
- **Scope of impact:**
  - Every CoStar sidebar capture that produces a new person contact will now create a triage inbox item AND a cadence row.
  - Re-captures of the same broker (existing entity) are a no-op for both calls — no spam.
  - Companies (org-type entities) are NOT seeded into cadence — only persons.
- **What this does NOT do:**
  - Does NOT mirror the seed for non-sidebar contact creates (contacts-handler / Salesforce-sync paths). Those producers create LCC entities through a different path; covering them requires reading \`contacts-handler.js\` and adding a similar hook. **Deferred to a follow-up.**
  - Does NOT extend the cadence engine to property / listing / owner subjects (the broader D-6). The audit lists that as a separate fix.
- **Verification (post-commit, post-deploy):**
  1. \`grep -c "getCadenceState" api/_handlers/sidebar-pipeline.js\` → ≥ 2 (import + call)
  2. \`grep -c "contact-cadence-seed" api/_handlers/sidebar-pipeline.js\` → ≥ 1
  3. \`node -c api/_handlers/sidebar-pipeline.js\` → parses
  4. After deploy, capture a CoStar listing on a property with brokers you've never seen before. On LCC Opps SQL:
     \`\`\`sql
     SELECT * FROM inbox_items
     WHERE source_type = 'new_contact_qualify'
       AND created_at > now() - interval '15 minutes'
     ORDER BY created_at DESC LIMIT 20;

     SELECT * FROM touchpoint_cadence
     WHERE current_touch = 0
       AND created_at > now() - interval '15 minutes'
     ORDER BY created_at DESC LIMIT 20;
     \`\`\`
     Both should return rows matching the new brokers.
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

async function main() {
  console.log(`\n=== LCC Audit Sprint — Item #7: seed cadence on new contacts ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN (no writes)' : 'APPLY (will write files)'}`);
  console.log(`Repo: ${REPO_ROOT}\n`);

  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}.`);
  }

  const report = [];
  await patchSidebarPipeline(report);
  await updateAuditProgress(report);

  console.log(`--- ${DRY ? 'DRY-RUN' : 'APPLY'} SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(60)}  ${sign}${delta} bytes  (${note})`);
  }

  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply.\n`);
    console.log(`  node audit/patches/07-contact-cadence-seed/apply.mjs --apply\n`);
  } else {
    console.log(`\n✓ Apply complete. Next steps:\n`);
    console.log(`  git status`);
    console.log(`  git diff --stat`);
    console.log(`  node -c api/_handlers/sidebar-pipeline.js`);
    console.log(`  git add -A`);
    console.log(`  git commit -F audit/patches/07-contact-cadence-seed/COMMIT_MSG.txt\n`);
  }
}

main().catch(err => {
  console.error(`\n❌ FAILED: ${err.message}\n`);
  console.error(`No files were modified.\n`);
  process.exit(1);
});
