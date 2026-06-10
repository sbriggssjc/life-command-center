#!/usr/bin/env node
/**
 * Folder-Feed local backfill — one-time legacy sweep of the Team Briggs tree.
 * Life Command Center · Phase 2, Slice 1.
 *
 * The Team Briggs Documents library is synced to disk on Scott's machine
 * (default: C:\Users\scott\NorthMarq Capital, LLC\Team Briggs - Documents), so a
 * local pass can bulk-read the thousands of legacy files with ZERO SharePoint
 * API. It walks the tree, classifies each file by filename (same classifier as
 * the cloud worker — api/_shared/folder-feed-classify.js), builds the
 * path→subject_hint match anchor, and for OM/flyer PDFs POSTs them through the
 * SAME promoter as the email/cloud channel (stageOmIntake via
 * /api/intake/stage-om). Use this for the big legacy sweep; the lcc-folder-feed
 * cron + the PA "List folder" flow maintain steady-state on new files.
 *
 * Bytes are local, so this uploads them directly (the prompt-sanctioned backfill
 * mode) — stageOmIntake's ingest-to-Storage handles the large ones. Steady-state
 * uses the cloud worker's reference mode (no re-upload).
 *
 * Idempotent + resumable via a local manifest of processed (path, sha256) — a
 * re-run skips anything already staged. Gentle concurrency on the 60-connection
 * tier (default 3).
 *
 * Required env / flags:
 *   LCC_BASE_URL   (or --base)   e.g. https://app.lifecommandcenter.com
 *   LCC_API_KEY    (or --key)    the X-LCC-Key
 *   LCC_USER_EMAIL (or --email)  optional; tags the intake's caller identity
 *
 * Usage:
 *   node scripts/folder-feed-backfill.mjs --root "C:\\Users\\scott\\NorthMarq Capital, LLC\\Team Briggs - Documents"
 *   node scripts/folder-feed-backfill.mjs --root ./Team-Briggs --dry-run
 *   node scripts/folder-feed-backfill.mjs --root ./Team-Briggs --limit 50 --concurrency 2
 *
 * Flags:
 *   --root <dir>          Library root on disk (REQUIRED).
 *   --base <url>          LCC base URL (else LCC_BASE_URL).
 *   --key <key>           X-LCC-Key (else LCC_API_KEY).
 *   --email <addr>        Caller email (else LCC_USER_EMAIL).
 *   --workspace <id>      X-LCC-Workspace override (optional).
 *   --limit N             Max OM files to stage this run. Default: unlimited.
 *   --concurrency N       Parallel stage POSTs. Default: 3.
 *   --manifest <file>     Resume manifest. Default: .folder-feed-backfill.json
 *   --dry-run             Walk + classify + report; stage nothing.
 *   --include-skipped     Also list non-OM files in the report (not staged).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative, sep, basename } from 'path';
import { createHash } from 'crypto';
import { classifyFile, parseSubjectHintFromPath } from '../api/_shared/folder-feed-classify.js';

// ---- arg parsing -----------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const ROOT        = args.root || process.env.FOLDER_FEED_LOCAL_ROOT;
const BASE        = (args.base || process.env.LCC_BASE_URL || '').replace(/\/+$/, '');
const API_KEY     = args.key || process.env.LCC_API_KEY || '';
const EMAIL       = args.email || process.env.LCC_USER_EMAIL || '';
const WORKSPACE   = args.workspace || process.env.LCC_DEFAULT_WORKSPACE_ID || '';
const LIMIT       = args.limit ? parseInt(args.limit, 10) : Infinity;
const CONCURRENCY = Math.max(1, Math.min(8, parseInt(args.concurrency || '3', 10)));
const MANIFEST    = args.manifest || '.folder-feed-backfill.json';
const DRY_RUN     = !!args['dry-run'];
const INCLUDE_SKIPPED = !!args['include-skipped'];

if (!ROOT) { console.error('ERROR: --root <library dir> is required.'); process.exit(2); }
if (!existsSync(ROOT)) { console.error(`ERROR: root not found: ${ROOT}`); process.exit(2); }
if (!DRY_RUN && (!BASE || !API_KEY)) {
  console.error('ERROR: --base/LCC_BASE_URL and --key/LCC_API_KEY are required unless --dry-run.');
  process.exit(2);
}

// ---- manifest (resume) -----------------------------------------------------
function loadManifest() {
  if (!existsSync(MANIFEST)) return { staged: {} };
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); }
  catch { return { staged: {} }; }
}
function saveManifest(m) {
  try { writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); }
  catch (e) { console.warn('manifest save failed:', e.message); }
}
const manifest = loadManifest();

// ---- walk ------------------------------------------------------------------
function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('~$') || ent.name === '.DS_Store') continue; // office locks
    const full = join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (ent.isFile()) yield full;
  }
}

// '/'-joined path relative to the library root, so the classifier + anchor read
// the same shape the cloud worker sees (PROPERTIES/<bucket>/<brand>/<City, ST>).
function relPosix(full) {
  return relative(ROOT, full).split(sep).join('/');
}

function sha256File(full) {
  const buf = readFileSync(full);
  return { sha256: createHash('sha256').update(buf).digest('hex'), buf };
}

async function stageOne(full, relPath) {
  const { sha256, buf } = sha256File(full);
  const manifestKey = `${relPath}::${sha256}`;
  if (manifest.staged[manifestKey]) return { status: 'already', relPath };

  const subjectHint = parseSubjectHintFromPath(relPath);
  if (DRY_RUN) return { status: 'would_stage', relPath, subjectHint };

  const envelope = {
    inputs: {
      intake_source:  'folder_feed_backfill',
      intake_channel: 'folder_feed',
      intent:         `Folder-feed backfill: ${relPath}`,
      seed_data: {
        tags: ['folder_feed', 'backfill'],
        subject_hint: subjectHint,
        source_path: relPath,
      },
      artifacts: {
        primary_document: {
          bytes_base64: buf.toString('base64'),
          file_name:    basename(full),
          mime_type:    'application/pdf',
          size_bytes:   buf.length,
          sha256,
        },
      },
    },
  };

  const headers = { 'Content-Type': 'application/json', 'X-LCC-Key': API_KEY };
  if (EMAIL) headers['X-LCC-User-Email'] = EMAIL;
  if (WORKSPACE) headers['X-LCC-Workspace'] = WORKSPACE;

  const res = await fetch(`${BASE}/api/intake/stage-om`, {
    method: 'POST', headers, body: JSON.stringify(envelope),
  });
  const text = await res.text().catch(() => '');
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* keep */ }

  if (res.ok && (json?.ok || json?.intake_id)) {
    manifest.staged[manifestKey] = { intake_id: json.intake_id || null, at: new Date().toISOString() };
    return { status: 'staged', relPath, intake_id: json.intake_id || null, matched: !!json.matched_entity_id };
  }
  if (res.ok && json?.skipped) {
    manifest.staged[manifestKey] = { skipped: json.skipped, at: new Date().toISOString() };
    return { status: 'skipped_by_pipeline', relPath, reason: json.skipped };
  }
  return { status: 'error', relPath, http: res.status, detail: (json?.error || text || '').slice(0, 160) };
}

// ---- main ------------------------------------------------------------------
async function main() {
  const report = {
    root: ROOT, mode: DRY_RUN ? 'dry_run' : 'stage',
    files_seen: 0, om_found: 0, staged: 0, already: 0, skipped_pipeline: 0,
    non_om: 0, error: 0, by_type: {},
  };

  // Collect OM targets first (so concurrency is easy + the report is upfront).
  const omTargets = [];
  for (const full of walk(ROOT)) {
    report.files_seen++;
    const rel = relPosix(full);
    const cls = classifyFile(basename(full));
    report.by_type[cls.type] = (report.by_type[cls.type] || 0) + 1;
    if (cls.isOm) {
      report.om_found++;
      omTargets.push({ full, rel });
    } else {
      report.non_om++;
      if (INCLUDE_SKIPPED) console.log(`  skip[${cls.type}] ${rel}`);
    }
    if (omTargets.length >= LIMIT && Number.isFinite(LIMIT)) break;
  }

  const queue = omTargets.slice(0, Number.isFinite(LIMIT) ? LIMIT : omTargets.length);
  let idx = 0;
  let sinceSave = 0;

  async function worker() {
    while (idx < queue.length) {
      const my = queue[idx++];
      try {
        const r = await stageOne(my.full, my.rel);
        if (r.status === 'staged') { report.staged++; console.log(`  staged ${r.relPath}${r.matched ? ' (matched)' : ''}`); }
        else if (r.status === 'already') { report.already++; }
        else if (r.status === 'would_stage') { report.staged++; console.log(`  would-stage ${r.relPath}`); }
        else if (r.status === 'skipped_by_pipeline') { report.skipped_pipeline++; console.log(`  pipeline-skip ${r.relPath} (${r.reason})`); }
        else { report.error++; console.warn(`  ERROR ${r.relPath} [${r.http}] ${r.detail}`); }
      } catch (e) {
        report.error++; console.warn(`  ERROR ${my.rel}: ${e.message}`);
      }
      if (!DRY_RUN && ++sinceSave >= 10) { saveManifest(manifest); sinceSave = 0; }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (!DRY_RUN) saveManifest(manifest);

  console.log('\n=== Folder-Feed backfill report ===');
  console.log(JSON.stringify(report, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
