#!/usr/bin/env node
// ============================================================================
// OWNERGAP2-harris — load HCAD's free bulk PDATA export into `hcad_real_acct_stage`
// (Dialysis_DB). Life Command Center.
// ----------------------------------------------------------------------------
// ⚠️ THIS SCRIPT DOES NOT FETCH FROM hcad.org. This environment has no egress
//    to that host (confirmed 2026-09-16: the outbound proxy answers `CONNECT
//    tunnel failed, response 403` — a policy denial), so the download must
//    happen OUTSIDE this sandbox, by hand, from a machine with normal internet
//    access. This script takes the file an operator already downloaded and
//    loads it — nothing here reaches the network except the LCC Dialysis_DB
//    write path it already uses.
//
// ── OPERATOR STEPS (run these OUTSIDE this environment) ─────────────────────
//   1. Open  https://hcad.org/pdata/pdata-property-downloads.html
//   2. Download "Real_acct_owner.zip" (the current year's export). No login,
//      no CAPTCHA — it is a plain static-file download.
//   3. (Optional, recommended) Read the codebook to confirm the state_class
//      codes this script assumes for "commercial":
//      https://hcad.org/assets/uploads/pdf/pdataCodebook.pdf
//      This script assumes F1 (Real, Commercial), F2 (Real, Industrial),
//      L1 (Personal, Commercial), L2 (Personal, Industrial) — see
//     api/_shared/hcad-pdata-parse.js and the migration header for why that
//     is unverified and how to correct it if the codebook says otherwise.
//   4. Hand the downloaded .zip (or its extracted real_acct.txt / owners.txt)
//     to this script:
//
//       node scripts/hcad-pdata-load.mjs --file /path/to/Real_acct_owner.zip [--owners /path/to/owners.txt] \
//         [--file-year 2026] [--apply]
//
//     Dry-run by DEFAULT (prints what would be loaded and exits without
//     writing). Add --apply to actually upsert into hcad_real_acct_stage.
//
//     If the zip already carries owners.txt inside it, --owners is not
//     needed — the script looks for it in the archive. If you already
//     extracted the files, point --file straight at real_acct.txt (a
//     directory is also accepted: it looks for real_acct.txt / owners.txt
//     inside it).
//
// IDEMPOTENCY: the stage's unique key is (acct, file_year) — re-running this
// loader against the same or an updated export upserts in place
// (`Prefer: resolution=merge-duplicates`), never stacking duplicate history.
// ============================================================================

import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import { parseRealAcctText, parseOwnersText, isAnyCommercialClass } from '../api/_shared/hcad-pdata-parse.js';
import { domainQuery } from '../api/_shared/domain-db.js';

const UPSERT_BATCH_SIZE = 500;

function parseArgs(argv) {
  const out = { file: null, owners: null, fileYear: null, apply: false, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--owners') out.owners = argv[++i];
    else if (a === '--file-year') out.fileYear = parseInt(argv[++i], 10);
    else if (a === '--apply') out.apply = true;
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`
OWNERGAP2-harris HCAD PDATA loader

Usage:
  node scripts/hcad-pdata-load.mjs --file <path> [--owners <path>] [--file-year YYYY] [--apply] [--limit N]

  --file <path>       REQUIRED. Path to Real_acct_owner.zip, an extracted
                       real_acct.txt, or a directory containing either.
  --owners <path>     Optional path to owners.txt (multi-owner supplement).
                       If --file is a zip or a directory, owners.txt inside it
                       is used automatically when present.
  --file-year YYYY    The tax/appraisal year this export represents. Defaults
                       to the current calendar year if omitted -- SET THIS
                       EXPLICITLY for a real load; the stage's dedup key is
                       (acct, file_year), so a wrong year here creates a
                       SEPARATE row set rather than upserting the right one.
  --apply             Actually write to hcad_real_acct_stage. Without it, this
                       script is a DRY RUN -- it parses and reports counts and
                       writes nothing.
  --limit N           Load only the first N parsed rows (debugging).

This script has NO network access to hcad.org. See this file's header for the
operator download steps.
`);
}

/** Load raw bytes for real_acct.txt (+ owners.txt if present) from --file. */
async function loadSourceTexts({ file, owners: ownersPath }) {
  if (!existsSync(file)) throw new Error(`--file not found: ${file}`);
  const st = statSync(file);
  let realAcctText = null;
  let ownersText = ownersPath && existsSync(ownersPath) ? readFileSync(ownersPath, 'utf8') : null;
  let sourceFile = basename(file);

  if (st.isDirectory()) {
    const realAcctPath = findCaseInsensitive(file, 'real_acct.txt');
    if (!realAcctPath) throw new Error(`real_acct.txt not found inside directory: ${file}`);
    realAcctText = readFileSync(realAcctPath, 'utf8');
    sourceFile = basename(realAcctPath);
    if (!ownersText) {
      const ownersInDir = findCaseInsensitive(file, 'owners.txt');
      if (ownersInDir) ownersText = readFileSync(ownersInDir, 'utf8');
    }
    return { realAcctText, ownersText, sourceFile };
  }

  if (extname(file).toLowerCase() === '.zip') {
    const zip = await JSZip.loadAsync(readFileSync(file));
    const entries = Object.keys(zip.files);
    const realAcctEntry = entries.find((e) => /real_acct\.txt$/i.test(e));
    if (!realAcctEntry) {
      throw new Error(`real_acct.txt not found inside zip. Entries seen: ${entries.join(', ')}`);
    }
    realAcctText = await zip.files[realAcctEntry].async('string');
    sourceFile = basename(realAcctEntry);
    if (!ownersText) {
      const ownersEntry = entries.find((e) => /owners\.txt$/i.test(e));
      if (ownersEntry) ownersText = await zip.files[ownersEntry].async('string');
    }
    return { realAcctText, ownersText, sourceFile };
  }

  // Assume it's already the extracted real_acct.txt.
  realAcctText = readFileSync(file, 'utf8');
  return { realAcctText, ownersText, sourceFile };
}

function findCaseInsensitive(dir, targetName) {
  const entries = readdirSync(dir);
  const hit = entries.find((e) => e.toLowerCase() === targetName.toLowerCase());
  return hit ? join(dir, hit) : null;
}

async function upsertRows(rows, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  let written = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
    // The dedup key is the plain unique index on (acct, file_year) -- both
    // are single, non-expression columns, so PostgREST can infer the ON
    // CONFLICT arbiter without an explicit on_conflict= query param
    // (CLAUDE.md's "PostgREST write surface" footgun: an expression/partial
    // index would NOT be inferable this way, but this one is plain columns).
    const r = await q('dialysis', 'POST', 'hcad_real_acct_stage', chunk, {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    });
    if (!r.ok) { errors.push(`chunk_${i}_failed:${r.status}`); continue; }
    written += chunk.length;
  }
  return { written, errors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) { printHelp(); process.exit(args.help ? 0 : 1); return; }

  const fileYear = Number.isFinite(args.fileYear) ? args.fileYear : new Date().getFullYear();
  console.log(`[hcad-pdata-load] file_year=${fileYear} apply=${args.apply} source=${args.file}`);

  const { realAcctText, ownersText, sourceFile } = await loadSourceTexts(args);
  const parsed = parseRealAcctText(realAcctText, { fileYear, sourceFile });
  if (!parsed.ok) {
    console.error(`[hcad-pdata-load] PARSE FAILED: ${parsed.reason}`
      + (parsed.missing ? ` (missing columns: ${parsed.missing.join(', ')})` : ''));
    console.error('[hcad-pdata-load] See api/_shared/hcad-pdata-parse.js FIELD_CANDIDATES '
      + 'to add a header-name alias if this is a genuine HCAD export with a renamed column.');
    process.exit(2);
    return;
  }

  let rows = parsed.rows;
  if (Number.isFinite(args.limit)) rows = rows.slice(0, args.limit);

  // Fold owners.txt in as owner_name_2 when the real_acct row didn't already
  // carry a second owner -- fill-blanks, never overwrite.
  if (ownersText) {
    const ownersParsed = parseOwnersText(ownersText);
    if (ownersParsed.ok) {
      let folded = 0;
      for (const row of rows) {
        if (row.owner_name_2) continue;
        const extra = ownersParsed.rowsByAcct.get(row.acct);
        if (extra && extra.length > 1) { row.owner_name_2 = extra[1].name; folded += 1; }
      }
      console.log(`[hcad-pdata-load] owners.txt: ${ownersParsed.rowsByAcct.size} accounts with `
        + `multi-owner rows, ${folded} folded into owner_name_2 (fill-blanks only)`);
    } else {
      console.warn(`[hcad-pdata-load] owners.txt present but not parsed: ${ownersParsed.reason}`);
    }
  }

  const commercial = rows.filter((r) => isAnyCommercialClass(r.state_class));
  for (const r of rows) r.is_commercial_class = isAnyCommercialClass(r.state_class);

  console.log(`[hcad-pdata-load] parsed ${parsed.totalLines} lines -> ${rows.length} rows `
    + `(${parsed.skippedBlank} skipped blank/no-acct)`);
  console.log(`[hcad-pdata-load] commercial (F1/F2/L1/L2) = ${commercial.length} of ${rows.length} `
    + '-- see the migration header: this classification is UNVERIFIED against the real codebook PDF');

  if (!args.apply) {
    console.log('[hcad-pdata-load] DRY RUN -- pass --apply to write to hcad_real_acct_stage.');
    console.log(`[hcad-pdata-load] sample row: ${JSON.stringify(rows[0] || null, null, 2)}`);
    return;
  }

  const { written, errors } = await upsertRows(rows);
  console.log(`[hcad-pdata-load] wrote ${written} of ${rows.length} rows to hcad_real_acct_stage `
    + `(source_file=${sourceFile}, file_year=${fileYear})`);
  if (errors.length) {
    console.error(`[hcad-pdata-load] ${errors.length} chunk(s) failed: ${errors.join('; ')}`);
    process.exit(3);
  }
}

// ⚠️ CLAUDE.md OCR1: never string-build file:// or read argv via a Windows-
// unsafe compare. This is the cross-platform form.
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error('[hcad-pdata-load] FATAL:', err?.stack || err);
    process.exit(1);
  });
}

export { loadSourceTexts, upsertRows, parseArgs };
