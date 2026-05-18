#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #5 Phase B: provenance integrity follow-up.
//
// Closes:
//   • D-13 — ownership_research_queue silent-write loop.
//   • pushProvenance gating mechanism (backwards-compatible signature
//     enhancement so future call sites can opt into "skip if upstream
//     write failed").
//
// ────────────────────────────────────────────────────────────────────────────
// D-13 DIAGNOSIS (verified 2026-05-17 via MCP):
//
// Production schema of public.ownership_research_queue on LCC gov:
//   research_id (uuid, PK), lead_id (uuid), task_type (text, NOT NULL),
//   task_status (text, default 'queued'), priority_score (int),
//   ai_prompt, ai_response, ai_confidence, ai_sources,
//   human_verified, human_notes, verified_by, verified_at,
//   created_at, completed_at, retry_count.
//
// sidebar-pipeline.js writers POST these columns:
//   property_id, address, city, state, recorded_owner_id,
//   recorded_owner_name, source, priority, status, created_at
//
// NONE of these match. Every POST has been silently failing since the
// table was migrated to the AI-pipeline shape (months ago). The Python
// AI pipeline already covers both use cases via lead_id + task_type, so
// the resolution is to NEUTRALIZE the sidebar writers (option (b) from
// the audit doc) rather than rewrite them to a parallel path.
//
// Two writers to fix:
//   1. Line ~1851: BROKER_FIRSTNAME_ONLY enqueue (for brokers with no
//      surname extracted). The AI pipeline's task_type='contact_discovery'
//      covers this.
//   2. Line ~2684: autoEnqueueOwnerResearch (for properties with known
//      recorded_owner but unknown true_owner). The AI pipeline's
//      task_type='entity_resolution' covers this.
//
// ────────────────────────────────────────────────────────────────────────────
// pushProvenance GATING:
//
// Today pushProvenance(provCollect, table, recordPk, fields) ALWAYS pushes
// regardless of whether the upstream write succeeded. If domainPatch fails
// silently (4xx) and the caller doesn't gate the pushProvenance call on
// r.ok, we end up recording provenance for a record that doesn't reflect
// what's actually in the DB.
//
// Phase B adds an OPTIONAL 7th parameter `writeResult` to pushProvenance.
// If passed and `writeResult.ok === false`, the push is skipped.
// Backwards compatible: existing call sites continue to work unchanged.
// New call sites can adopt the pattern incrementally.
//
// One concrete migration: the parcel_records PATCH at line ~3590, which
// currently calls pushProvenance unconditionally after domainPatch.
//
// ────────────────────────────────────────────────────────────────────────────
// Files changed:
//   • api/_handlers/sidebar-pipeline.js — neutralize 2 broken writers +
//     enhance pushProvenance signature + adopt gating at 1 sample call site
//   • AUDIT_PROGRESS.md — closeout
//
// Branch: audit/05B-provenance-integrity-phase-b
// ============================================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf   = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
function toEol(s, eol) { return s.replace(/\r\n/g, '\n').replace(/\n/g, eol); }
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0; let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
async function replaceUnique(path, oldStr, newStr, report, label) {
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const oldN = toEol(oldStr, eol);
  const newN = toEol(newStr, eol);
  const occ = countOccurrences(original, oldN);
  if (occ === 0) throw new Error(label + ': anchor not found in ' + path);
  if (occ > 1)  throw new Error(label + ': anchor matched ' + occ + ' times in ' + path);
  if (oldN === newN) { report.push([label, 0, 'no changes']); return; }
  const updated = original.replace(oldN, () => newN);
  const delta = updated.length - original.length;
  report.push([label + ' (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

// ─── sidebar-pipeline.js: 3 edits ───
async function patchSidebarPipeline(report) {
  const path = resolve(REPO_ROOT, 'api', '_handlers', 'sidebar-pipeline.js');
  if (!await fileExists(path)) throw new Error('sidebar-pipeline.js not found.');

  // 1. Enhance pushProvenance signature with optional writeResult gate.
  await replaceUnique(path,
    `/**
 * Push a per-row provenance entry into \`provCollect\` (Phase 2.2.b helper).
 * Safe to call with provCollect=undefined — no-op in that case so writers
 * stay backwards-compatible with non-sidebar callers.
 */
function pushProvenance(provCollect, table, recordPk, fields, confidence, source) {
  if (!Array.isArray(provCollect) || !table || !recordPk || !fields) return;`,
    `/**
 * Push a per-row provenance entry into \`provCollect\` (Phase 2.2.b helper).
 * Safe to call with provCollect=undefined — no-op in that case so writers
 * stay backwards-compatible with non-sidebar callers.
 *
 * Item #5 Phase B (2026-05-17): \`writeResult\` is an optional 7th
 * parameter. When provided, the push is skipped if the upstream write
 * failed (\`writeResult.ok === false\`). This prevents recording
 * provenance for a record that doesn't reflect what's in the DB.
 * Backwards compatible: existing call sites continue to work unchanged.
 * Migration pattern for new call sites:
 *
 *     const patchRes = await domainPatch(...);
 *     pushProvenance(provCollect, 'table', id, fields, undefined, undefined, patchRes);
 */
function pushProvenance(provCollect, table, recordPk, fields, confidence, source, writeResult) {
  // Gate: if a writeResult was supplied and it explicitly failed, skip.
  // (undefined/missing writeResult preserves legacy behavior — push goes through.)
  if (writeResult && writeResult.ok === false) return;
  if (!Array.isArray(provCollect) || !table || !recordPk || !fields) return;`,
    report, 'sidebar-pipeline.js (pushProvenance gating signature)');

  // 2. D-13 fix part 1: neutralize the BROKER_FIRSTNAME_ONLY writer.
  await replaceUnique(path,
    `  if (domain === 'government') {
    const lowConfidence = people.filter(c => c.name_quality === 'first_only');
    for (const c of lowConfidence) {
      await domainQuery('government', 'POST', 'ownership_research_queue', {
        property_id:         propertyId,
        address:             entity.address || null,
        city:                entity.city    || null,
        state:               entity.state   || null,
        recorded_owner_name: \`BROKER_FIRSTNAME_ONLY:\${c.name} (\${c.role || 'broker'})\`,
        source:              'costar_sidebar_firstname_only',
        priority:            'low',
        status:              'pending',
        created_at:          new Date().toISOString(),
      });
    }
  }`,
    `  // D-13 fix (Item #5 Phase B, 2026-05-17): the legacy enqueue below was a
  // 100% silent-fail since ownership_research_queue was migrated to the
  // AI-pipeline shape. The columns posted (property_id, address, city,
  // state, recorded_owner_name, source, priority, status) do not exist on
  // the live schema, which now uses lead_id, task_type ('contact_discovery'
  // for first-name-only brokers), task_status, ai_*, etc.
  //
  // The Python AI pipeline already runs contact_discovery against the same
  // signal stream via the lead_id-based queue, so the sidebar shouldn't
  // double-enqueue. Neutralized as a no-op. The few thousand
  // ingest_write_failures rows this surface generated will stop appearing.
  if (domain === 'government') {
    const _firstOnlyCount = (people || []).filter(c => c && c.name_quality === 'first_only').length;
    if (_firstOnlyCount > 0) {
      console.debug('[sidebar-pipeline] D-13: skipped legacy ownership_research_queue enqueue for ' +
        _firstOnlyCount + ' first-name-only broker(s) — covered by AI pipeline task_type=contact_discovery.');
    }
  }`,
    report, 'sidebar-pipeline.js (D-13: BROKER_FIRSTNAME_ONLY neutralize)');

  // 3. D-13 fix part 2: neutralize autoEnqueueOwnerResearch.
  await replaceUnique(path,
    `// ── Auto-enqueue ownership research ───────────────────────────────────────

async function autoEnqueueOwnerResearch(propertyId, entity, metadata) {
  // Only enqueue if true_owner_id is still null after pipeline ran
  const propCheck = await domainQuery('government', 'GET',
    \`properties?property_id=eq.\${propertyId}&select=true_owner_id,recorded_owner_id&limit=1\`
  );
  if (!propCheck.ok || !propCheck.data?.length) return;
  const prop = propCheck.data[0];

  // If true owner is already known, no research needed
  if (prop.true_owner_id) return;
  if (!prop.recorded_owner_id) return;

  // Check if already in research queue
  const queueCheck = await domainQuery('government', 'GET',
    \`ownership_research_queue?property_id=eq.\${propertyId}&status=neq.completed&select=id&limit=1\`
  );
  if (queueCheck.ok && queueCheck.data?.length) return; // already queued

  // Enqueue for research
  const ownerName = (metadata.contacts || [])
    .find(c => c.role === 'owner')?.name || null;

  await domainQuery('government', 'POST', 'ownership_research_queue', {
    property_id:         propertyId,
    address:             entity.address || null,
    city:                entity.city    || null,
    state:               entity.state   || null,
    recorded_owner_id:   prop.recorded_owner_id,
    recorded_owner_name: ownerName,
    source:              'costar_sidebar',
    priority:            'normal',
    status:              'pending',
    created_at:          new Date().toISOString(),
  });
}`,
    `// ── Auto-enqueue ownership research ───────────────────────────────────────
//
// D-13 fix (Item #5 Phase B, 2026-05-17): the legacy implementation below
// was a 100% silent-fail. The columns posted (property_id, address, city,
// state, recorded_owner_id, recorded_owner_name, source, priority, status)
// do not exist on the live ownership_research_queue schema, which uses
// lead_id, task_type ('entity_resolution' for unknown true_owner from a
// known recorded_owner), task_status, ai_*, etc. The Python AI pipeline
// already runs entity_resolution via the lead_id-based queue.
//
// Neutralized as a no-op — keeps the call site stable but stops generating
// ingest_write_failures rows. The caller in propagateToDomainDbDirect
// (line ~2349, gov-only) still invokes this; the function now logs and
// returns immediately.

async function autoEnqueueOwnerResearch(propertyId, entity, metadata) {
  // D-13: legacy schema mismatch. The AI pipeline handles entity_resolution
  // via the lead_id-based queue with task_type='entity_resolution'.
  void entity; void metadata;
  console.debug('[sidebar-pipeline] D-13: skipped legacy autoEnqueueOwnerResearch ' +
    'for property=' + propertyId + ' — covered by AI pipeline task_type=entity_resolution.');
  return;
}`,
    report, 'sidebar-pipeline.js (D-13: autoEnqueueOwnerResearch neutralize)');

  // 4. Sample migration: adopt the new gating pattern on the parcel_records
  //    PATCH at line ~3590. Currently calls pushProvenance unconditionally
  //    after domainPatch. Now gated on patch success.
  await replaceUnique(path,
    `      if (filteredParcelPatch && Object.keys(filteredParcelPatch).length > 0) {
        await domainPatch('dialysis',
          \`parcel_records?apn=eq.\${encodeURIComponent(apn)}\`,
          filteredParcelPatch,
          'upsertPublicRecords:dialysis:parcel'
        );
      }
      // Ensure join table link exists for existing parcel
      if (existingParcelId) {
        await linkPublicRecord('dialysis', propertyId, 'parcel', existingParcelId);
        pushProvenance(provCollect, 'parcel_records', existingParcelId, {
          apn, county, assessed_value: assessed,
        });
      }
    }
  }

  if (domain === 'government') {`,
    `      let _parcelPatchRes = { ok: true }; // default: nothing to patch → no failure
      if (filteredParcelPatch && Object.keys(filteredParcelPatch).length > 0) {
        _parcelPatchRes = await domainPatch('dialysis',
          \`parcel_records?apn=eq.\${encodeURIComponent(apn)}\`,
          filteredParcelPatch,
          'upsertPublicRecords:dialysis:parcel'
        );
      }
      // Ensure join table link exists for existing parcel
      if (existingParcelId) {
        await linkPublicRecord('dialysis', propertyId, 'parcel', existingParcelId);
        // Item #5 Phase B gating: only push provenance if the PATCH actually
        // succeeded. Prevents recording provenance for a write that 4xx'd.
        pushProvenance(provCollect, 'parcel_records', existingParcelId, {
          apn, county, assessed_value: assessed,
        }, undefined, undefined, _parcelPatchRes);
      }
    }
  }

  if (domain === 'government') {`,
    report, 'sidebar-pipeline.js (parcel_records gating sample)');
}

// ─── AUDIT_PROGRESS.md: append closeout entry ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 5 Phase B — provenance integrity (D-13 + gating)
- **Status:** ✅ DONE (Phase B) — Phase A landed earlier as \`08846cc\` (ingest_write_failures table + domainQuery instrumentation).
- **Branch:** \`audit/05B-provenance-integrity-phase-b\`
- **Patch:** \`audit/patches/05B-provenance-integrity-phase-b/apply.mjs\`
- **Closes:** D-13 (ownership_research_queue silent-write loop) + pushProvenance gating mechanism.

### D-13 — what was broken
Production schema of \`public.ownership_research_queue\` on gov (verified via MCP 2026-05-17):
\`\`\`
research_id, lead_id, task_type (NOT NULL), task_status, priority_score,
ai_prompt, ai_response, ai_confidence, ai_sources, human_verified,
human_notes, verified_by, verified_at, created_at, completed_at, retry_count
\`\`\`

Two writers in \`api/_handlers/sidebar-pipeline.js\` (lines ~1851 and ~2684) POSTed these columns:
\`\`\`
property_id, address, city, state, recorded_owner_id, recorded_owner_name,
source, priority, status, created_at
\`\`\`

**None match.** Every POST has 4xx'd silently since the table was migrated to the AI-pipeline shape. Phase A's instrumentation surfaced this as a recurring \`ingest_write_failures\` row.

### D-13 — resolution
Per the audit doc's option (b): **neutralize the writers** rather than rewrite to a parallel path. The Python AI pipeline already covers both cases via the \`lead_id\`-based queue:
- \`task_type='contact_discovery'\` for first-name-only brokers
- \`task_type='entity_resolution'\` for properties with unknown true_owner

Both sidebar writers now log a \`[sidebar-pipeline] D-13: skipped\` debug line and return. The few thousand \`ingest_write_failures\` rows this surface generated will stop appearing.

### pushProvenance gating
Phase B adds an OPTIONAL 7th parameter \`writeResult\` to \`pushProvenance\`:
\`\`\`js
function pushProvenance(provCollect, table, recordPk, fields, confidence, source, writeResult) {
  // Gate: if a writeResult was supplied and it explicitly failed, skip.
  if (writeResult && writeResult.ok === false) return;
  // ... existing logic
}
\`\`\`

**Backwards compatible** — existing call sites continue to work unchanged. New call sites can adopt the pattern:
\`\`\`js
const patchRes = await domainPatch(...);
pushProvenance(provCollect, 'table', id, fields, undefined, undefined, patchRes);
\`\`\`

One concrete migration in this patch: the \`parcel_records\` PATCH in \`upsertPublicRecords\` at line ~3590 now passes the PATCH result through to \`pushProvenance\`, so a 4xx PATCH no longer records phantom provenance.

### Files changed
- \`api/_handlers/sidebar-pipeline.js\` — pushProvenance signature + 2 writer neutralizations + 1 sample gating migration
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. \`grep -c "D-13:" api/_handlers/sidebar-pipeline.js\` → 4 or more (in-code comments)
2. \`grep -c "writeResult" api/_handlers/sidebar-pipeline.js\` → 2 or more (signature + sample call site)
3. \`grep -c "ownership_research_queue" api/_handlers/sidebar-pipeline.js\` → expected to drop from 4 to 0 (writers removed)
4. After deploy: a fresh CoStar capture with first-name-only brokers + an unknown true_owner should produce \`[sidebar-pipeline] D-13: skipped\` console lines, NOT new \`ingest_write_failures\` rows for ownership_research_queue.

### Phase C follow-ups (deferred)
- Sweep the remaining ~30 \`pushProvenance\` call sites and pass their upstream \`r\`/\`patchRes\`/etc. through to enable gating across the file.
- Consider promoting the \`writeResult\` gate to a default-required parameter once the sweep is complete (would surface any remaining ungated call sites at compile time via a lint rule).

### Discovery — Item #3 Phase B (dia owner backfill) re-scoped to Phase C
Verified via MCP 2026-05-17 that **all 13,338 NULL-owner dia properties** have:
- 0 ownership_history rows with recorded_owner_id populated
- 0 deed_records rows
- 0 sales_transactions rows
- 0 latest_deed_grantee text
- 0 assessed_owner text

\`reconcilePropertyOwnership\` (Phase A) has nothing to reconcile from — running it as a backfill would be a no-op for all 13,338. Item #3 Phase B as originally scoped is unsolvable with existing data.

The real next step is an **enrichment pipeline**, not a reconciliation. Options:
- Build a deferred SoS / county-recorder ingest that pulls deed grantee data by property address + state, then runs through the existing ownership reconciliation.
- Bulk manual research via the existing LLC research queue UI (Item #2 Phase B — also deferred).
- Integrate a commercial property-records API (CoreLogic, ATTOM Data, etc.) for the gap.

Item #3 Phase B is **re-classified as deferred to Phase C** with this explanatory note. The current state is: 13,338 dia properties remain NULL-owner; they surface correctly in the NBA queue as \`missing_recorded_owner\` gaps awaiting external enrichment.

`);

  const preflightAnchor = N('\n# Sprint preflight — 2026-05-17\n');
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, () => appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }
  if (c === original) { report.push(['AUDIT_PROGRESS.md', 0, 'no changes']); return; }
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Audit Sprint — Item #5 Phase B (D-13 + provenance gating) ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchSidebarPipeline(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(75) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
