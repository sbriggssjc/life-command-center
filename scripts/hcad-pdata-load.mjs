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
//      This script assumes F1 (Real, Commercial), F2 (Real, Industrial) for
//      the FULL LOAD filter below — see api/_shared/hcad-pdata-parse.js and
//      the migration header for why that is unverified and how to correct it
//      if the codebook says otherwise.
//   4. Hand the downloaded .zip (or its extracted real_acct.txt / owners.txt)
//     to this script:
//
//       node --env-file=.env.local scripts/hcad-pdata-load.mjs \
//         --file /path/to/Real_acct_owner.zip [--owners /path/to/owners.txt] \
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
// ── PROBLEM 3: LOCAL CREDENTIALS (OWNERGAP2-harris-b) ───────────────────────
// Running this OUTSIDE Cowork/Railway (a bare local machine, e.g. Scott's
// laptop) needs `DIA_SUPABASE_URL` and `DIA_SUPABASE_SERVICE_KEY` (or
// `DIA_SUPABASE_KEY`) set — `api/_shared/domain-db.js::getDomainCredentials`
// reads them via `process.env`, and without them every write 503s
// ("dialysis database not configured"). Get the values from the Supabase
// dashboard (Dialysis_DB project, `zqzrriwuavgrquhisnoa`) -> Project
// Settings -> API: `DIA_SUPABASE_URL` = the Project URL,
// `DIA_SUPABASE_SERVICE_KEY` = the `service_role` secret key (never the
// anon key — the stage table grants write only to `service_role`). Put
// them in a local `.env.local` (gitignored) and run with
// `node --env-file=.env.local scripts/hcad-pdata-load.mjs …` — Node's
// built-in `--env-file` flag needs no extra dependency. A DRY RUN (the
// default, no `--apply`) parses and reports without ever calling
// `domainQuery`, so it works with no credentials at all; only `--apply`
// needs them.
//
// IDEMPOTENCY: the stage's unique key is (acct, file_year) — re-running this
// loader against the same or an updated export upserts in place
// (`Prefer: resolution=merge-duplicates`), never stacking duplicate history.
//
// ── PROBLEM 2: STREAMING (OWNERGAP2-harris-b) ───────────────────────────────
// `real_acct.txt` inside `Real_acct_owner.zip` is ~889 MB uncompressed — on
// Scott's machine, both `readFileSync(...).toString()` and JSZip's
// `.async('string')` threw `RangeError: Invalid string length` trying to
// materialize that as ONE JS string (a string that size is already close to
// V8's per-string limit, and UTF-16 storage roughly doubles it again). This
// script never does that: the zip entry is read via JSZip's `.nodeStream()`
// (decompresses to Buffer/string CHUNKS, not one string) and processed
// line-by-line with `node:readline`; a plain extracted `.txt` file streams
// the same way via `fs.createReadStream`. Only a `UPSERT_BATCH_SIZE`-row
// buffer of rows is ever held in memory at once.
//
// It ALSO filters to state_class F1/F2 (Real, Commercial/Industrial) WHILE
// STREAMING, per the ticket's spec — a full Harris County roll is dominated
// by residential/vacant/other accounts OWNERGAP2 never queries, and staging
// all of them from an 889 MB source would recreate a second copy of the
// whole county roll for no benefit (the matcher already treats every other
// class as a non-owner account per PDR2, wherever it DOES appear — e.g. in
// a hand-curated partial load like Cowork's 37-row seed, which deliberately
// keeps a few C2/X2/L1 rows to exercise that exclusion path). `--include-all`
// disables the filter for exactly that kind of deliberate broader load.
//
// ── OWNERGAP2-harris-c: THE REAL FULL-ROLL LOAD SILENTLY UNDER-WROTE AND MIS-
//    WROTE ITS OUTPUT (four separate defects, found on Scott's real
//    2026-09-16 run + fixed here). See
//    `docs/claude-code/prompts/OWNERGAP2-harris-c-*.md` for the full writeup.
//    Numbered 1-4 here for cross-reference; NOT the same numbering as the
//    "PROBLEM 1/2/3" headers above (those are OWNERGAP2-harris-b's).
//   1. `resolution=merge-duplicates` never fired without an explicit
//      `on_conflict=acct,file_year` — PostgREST infers an arbiter WITHOUT one
//      only from the PRIMARY KEY (the `id` bigserial here, which never
//      collides), not from `uq_hcad_stage_acct_year`. 19 of 72 chunks 23505'd
//      on the real load; 18,276 of 71,276 rows never landed. Fixed: the POST
//      path now carries `?on_conflict=acct,file_year` explicitly.
//   2. The failure was invisible: `flush()` read `.ok`/`.status` off
//      `upsertRows()`'s real `{written, errors}` return shape, so it always
//      printed `chunk_at_0_failed:undefined` and `written` never advanced —
//      "wrote 0 of 71276" even when 53,000 rows had landed. Fixed: the real
//      shape is read, and a failed chunk's PostgREST `code`/`message` are
//      printed (not just the HTTP status).
//   3. The real 2026 `real_acct.txt` header carries NO `name`-shaped column
//      at all (`acct, yr, mailto, mail_addr_1, ...`), so `owner_name` was
//      NULL on every one of 71,276 rows. Fixed: `owners.txt`'s ln_num=1 row
//      (its first row per acct) fills `owner_name` itself when the real_acct
//      header has no name column (see `hcad-pdata-parse.js`'s header for the
//      full mapping story) — and `--apply` REFUSES to write at all if any
//      staged row still has no owner_name after that fallback (prints the
//      count; a stage with null owners is worse than no stage).
//   4. HCAD's own placeholder owner string ("CURRENT OWNER", written when
//      ownership on an account has never been resolved) is filtered by the
//      MATCHER now, not here — see `isHcadPlaceholderOwnerName` in
//      `ownergap2-harris-pdata-match.js`.
// ============================================================================

import { createReadStream, readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, extname, basename } from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import {
  mapHeader, parseRealAcctLine, parseOwnersText,
  isCommercialRealClass, isAnyCommercialClass,
} from '../api/_shared/hcad-pdata-parse.js';
import { domainQuery } from '../api/_shared/domain-db.js';

const UPSERT_BATCH_SIZE = 1000;

function parseArgs(argv) {
  const out = {
    file: null, owners: null, fileYear: null, apply: false, limit: null,
    includeAll: false, includeClasses: [], dsn: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--owners') out.owners = argv[++i];
    else if (a === '--file-year') out.fileYear = parseInt(argv[++i], 10);
    else if (a === '--apply') out.apply = true;
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10);
    else if (a === '--include-all') out.includeAll = true;
    else if (a === '--include-classes') {
      out.includeClasses = String(argv[++i] || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    }
    else if (a === '--dsn') out.dsn = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`
OWNERGAP2-harris HCAD PDATA loader

Usage:
  node --env-file=.env.local scripts/hcad-pdata-load.mjs --file <path> \\
    [--owners <path>] [--file-year YYYY] [--apply] [--limit N] [--include-all] \\
    [--include-classes C2,X2] [--dsn <url>]

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
  --limit N           Stop after the first N F1/F2 rows found (debugging).
  --include-all       Stage EVERY state_class, not just F1/F2 (Real,
                       Commercial/Industrial) -- see this file's header for
                       why F1/F2-only is the default for a full 889 MB load.
  --include-classes C2,X2
                       Stage these ADDITIONAL state_class codes alongside
                       F1/F2 (comma-separated), without staging the whole
                       county the way --include-all does. Pass the SAME list
                       to the matcher's buildHarrisPdataCandidates /
                       resolveHarrisFromPdata "includeClasses" option to
                       admit them at match time too -- staging alone does not
                       widen what the matcher will accept as real-property
                       commercial. Whether to ever admit a class like C2
                       (Texas PTAD "vacant commercial lot") is an operator
                       decision (S5, docs/os/OPERATOR-CHECKLIST.md), never a
                       default this script flips on its own.
  --dsn <url>         Alternative to DIA_SUPABASE_URL/DIA_SUPABASE_SERVICE_KEY
                       env vars -- see PROBLEM 3 in this file's header for
                       the normal (env-var) path. Accepts
                       "https://<url>|<service-role-key>" (pipe-separated);
                       when given, overrides whatever env vars are set.

This script has NO network access to hcad.org. See this file's header for the
operator download steps and the DIA_SUPABASE_* credentials needed for --apply.
`);
}

function findCaseInsensitive(dir, targetName) {
  const entries = readdirSync(dir);
  const hit = entries.find((e) => e.toLowerCase() === targetName.toLowerCase());
  return hit ? join(dir, hit) : null;
}

/**
 * Open a STREAM of real_acct.txt's decompressed bytes, plus (buffered --
 * see this file's header) owners.txt text if present. `--file` may be a
 * zip, a directory, or the already-extracted real_acct.txt.
 *
 * ⚠️ `stream.nodeStream('nodebuffer')`, NEVER `.async('string')` for the
 * real_acct.txt entry -- that is the entire point of this rewrite (an
 * 889 MB decompressed payload cannot be one JS string). owners.txt is the
 * small multi-owner SUPPLEMENT (not the county roll) and stays buffered.
 */
async function openSources({ file, owners: ownersPath }) {
  if (!existsSync(file)) throw new Error(`--file not found: ${file}`);
  const st = statSync(file);

  if (st.isDirectory()) {
    const realAcctPath = findCaseInsensitive(file, 'real_acct.txt');
    if (!realAcctPath) throw new Error(`real_acct.txt not found inside directory: ${file}`);
    let ownersText = ownersPath && existsSync(ownersPath) ? readFileSync(ownersPath, 'utf8') : null;
    if (!ownersText) {
      const ownersInDir = findCaseInsensitive(file, 'owners.txt');
      if (ownersInDir) ownersText = readFileSync(ownersInDir, 'utf8');
    }
    const stream = createReadStream(realAcctPath);
    stream.setEncoding('utf8');
    return { stream, sourceFile: basename(realAcctPath), ownersText };
  }

  if (extname(file).toLowerCase() === '.zip') {
    // The ZIP FILE ITSELF (compressed) is read as one Buffer -- that is fine
    // even for an 889 MB uncompressed payload, because text compresses well
    // (the real export is expected in the tens-to-low-hundreds of MB
    // compressed) and a Buffer has no V8 string-length ceiling the way a JS
    // string does. What must NEVER be buffered whole is the DECOMPRESSED
    // real_acct.txt content -- that is what nodeStream() avoids.
    const zip = await JSZip.loadAsync(readFileSync(file));
    const entries = Object.keys(zip.files);
    const realAcctEntry = entries.find((e) => /real_acct\.txt$/i.test(e));
    if (!realAcctEntry) {
      throw new Error(`real_acct.txt not found inside zip. Entries seen: ${entries.join(', ')}`);
    }
    const stream = zip.files[realAcctEntry].nodeStream('nodebuffer');
    stream.setEncoding('utf8');
    let ownersText = ownersPath && existsSync(ownersPath) ? readFileSync(ownersPath, 'utf8') : null;
    if (!ownersText) {
      const ownersEntry = entries.find((e) => /owners\.txt$/i.test(e));
      if (ownersEntry) ownersText = await zip.files[ownersEntry].async('string');
    }
    return { stream, sourceFile: basename(realAcctEntry), ownersText };
  }

  // Assume it's already the extracted real_acct.txt.
  const ownersText = ownersPath && existsSync(ownersPath) ? readFileSync(ownersPath, 'utf8') : null;
  const stream = createReadStream(file);
  stream.setEncoding('utf8');
  return { stream, sourceFile: basename(file), ownersText };
}

/**
 * Stream-parse real_acct.txt line-by-line, filter to F1/F2 (unless
 * `includeAll`), fold in owners.txt's owner supplement (fill-blanks only),
 * and -- once the whole file has been read -- upsert the STAGED rows (never
 * the raw 889 MB text) via `upsert(rows)`. The DECOMPRESSED TEXT is never
 * materialized as more than the current line -- the whole point of this
 * function existing (OWNERGAP2-harris-b Problem 2) -- but the much smaller
 * set of already-filtered STAGED rows (tens of thousands, not millions) is
 * now held in memory as one array rather than flushed batch-by-batch, so the
 * "refuse to apply on a missing owner_name" check below (Problem 3) can run
 * BEFORE anything is written, not discover the defect after 53,000 rows
 * already landed.
 *
 * @returns {{totalLines, skippedBlank, staged, classSkipped, written, errors,
 *   sampleRow, missingOwnerName, ownerNameHeaderMissing}}
 */
async function streamLoadRealAcct(stream, opts) {
  const {
    fileYear, sourceFile, apply, limit, includeAll, ownersByAcct, upsert,
    includeClasses = [],
  } = opts;
  const includeClassSet = new Set(includeClasses.map((c) => String(c).trim().toUpperCase()).filter(Boolean));
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let hm = null;
  let lineNo = 0;
  let totalLines = 0;
  let skippedBlank = 0;
  let staged = 0;
  let classSkipped = 0;
  let sampleRow = null;
  let missingOwnerName = 0;
  const rows = [];

  for await (const rawLine of rl) {
    lineNo += 1;
    if (lineNo === 1) {
      hm = mapHeader(rawLine);
      if (!hm.ok) {
        rl.close();
        throw Object.assign(new Error('missing_required_columns'), { missing: hm.missing });
      }
      continue;
    }
    totalLines += 1;
    const { row, blank } = parseRealAcctLine(rawLine, hm, { fileYear, sourceFile });
    if (blank) { skippedBlank += 1; continue; }

    // OWNERGAP2-harris-c PROBLEM 3: the real 2026 real_acct.txt header is
    // `acct, yr, mailto, mail_addr_1, ...` -- there is NO `name`-shaped
    // column, so FIELD_CANDIDATES.owner_name matches nothing and every row's
    // owner_name comes back null from parseRealAcctLine. owners.txt's row at
    // ln_num 1 (i.e. its FIRST row per acct, in file order -- the same
    // ordering assumption the owner_name_2 fallback below already makes) IS
    // the primary owner per the ticket, so it fills owner_name itself when
    // real_acct.txt's own column is absent, never just a second owner.
    if (!row.owner_name && ownersByAcct && ownersByAcct.size) {
      const primary = ownersByAcct.get(row.acct);
      if (primary && primary.length >= 1 && primary[0].name) row.owner_name = primary[0].name;
    }
    // Fold owners.txt's SECOND owner in as owner_name_2 -- fill-blanks only,
    // never overwrites a value real_acct.txt's own mailto column already
    // supplied (see hcad-pdata-parse.js's FIELD_CANDIDATES header for why
    // owner_name_2 defaults to mailto, not this supplement).
    if (!row.owner_name_2 && ownersByAcct && ownersByAcct.size) {
      const extra = ownersByAcct.get(row.acct);
      if (extra && extra.length > 1) row.owner_name_2 = extra[1].name;
    }

    const stateClass = row.state_class ? String(row.state_class).trim().toUpperCase() : null;
    const admittedByIncludeClasses = !!stateClass && includeClassSet.has(stateClass);
    if (!includeAll && !admittedByIncludeClasses && !isCommercialRealClass(row.state_class)) {
      classSkipped += 1; continue;
    }
    row.is_commercial_class = isAnyCommercialClass(row.state_class);

    if (!row.owner_name) missingOwnerName += 1;

    if (!sampleRow) sampleRow = row;
    staged += 1;
    if (Number.isFinite(limit) && staged > limit) { staged -= 1; break; }
    rows.push(row);
  }

  const ownerNameHeaderMissing = !(hm && 'owner_name' in hm.map);
  let written = 0;
  const errors = [];
  if (apply) {
    // OWNERGAP2-harris-c PROBLEM 3 (refusal): a stage with null owners is
    // worse than no stage -- the matcher would read `owner: null` on every
    // such row and report `source_states_no_owner`, silently discarding
    // exactly the real-owner signal this load exists to capture. Refuse the
    // WHOLE write rather than land a partially-nulled stage; the operator
    // reruns with a `--owners` file that actually covers the gap, or accepts
    // the (printed) count as a known ceiling before forcing a partial load.
    if (missingOwnerName > 0) {
      errors.push(`refused_missing_owner_name:${missingOwnerName}_of_${staged}_staged_rows_have_no_owner_name`
        + `${ownerNameHeaderMissing ? ' (real_acct.txt header carries no name column at all)' : ''}`);
    } else {
      const r = await upsert(rows);
      written = r.written;
      if (r.errors.length) errors.push(...r.errors);
    }
  }

  return {
    totalLines, skippedBlank, staged, classSkipped, written, errors, sampleRow,
    missingOwnerName, ownerNameHeaderMissing,
  };
}

async function upsertRows(rows, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  let written = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
    // OWNERGAP2-harris-c: `on_conflict=` MUST be passed explicitly. PostgREST
    // infers an ON CONFLICT arbiter WITHOUT it only from the table's PRIMARY
    // KEY, never from another unique index -- even a plain-column one
    // (CLAUDE.md's "PostgREST write surface" footgun talks about expression/
    // partial indexes being un-inferable; a comment on the pre-fix code
    // claimed the plain-column form didn't need this, which was itself
    // wrong). `hcad_real_acct_stage`'s PK is the `id` bigserial, which a
    // fresh row never collides on -- so every chunk touching one of the
    // already-staged accounts hit `23505 duplicate key value violates
    // unique constraint "uq_hcad_stage_acct_year"` on the REAL load (19 of
    // 72 chunks, 18,276 of 71,276 rows never written).
    const r = await q('dialysis', 'POST', 'hcad_real_acct_stage?on_conflict=acct,file_year', chunk, {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    });
    if (!r.ok) {
      const code = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data.code : null;
      const message = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data.message : null;
      errors.push(`chunk_${i}_failed:status=${r.status}${code ? `,code=${code}` : ''}`
        + `${message ? `,message=${String(message).slice(0, 200)}` : ''}`);
      continue;
    }
    written += chunk.length;
  }
  return { written, errors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) { printHelp(); process.exit(args.help ? 0 : 1); return; }

  // --dsn is a small escape hatch (Problem 3): "https://...|<service-role-key>"
  // overrides the DIA_SUPABASE_* env vars for this run only, in case an
  // operator would rather pass credentials on the command line than write a
  // .env.local. The normal, RECOMMENDED path is still the env vars -- see
  // this file's header.
  if (args.dsn) {
    const sep = args.dsn.indexOf('|');
    if (sep < 0) {
      console.error('[hcad-pdata-load] --dsn must be "https://<url>|<service-role-key>"');
      process.exit(1);
      return;
    }
    process.env.DIA_SUPABASE_URL = args.dsn.slice(0, sep);
    process.env.DIA_SUPABASE_SERVICE_KEY = args.dsn.slice(sep + 1);
  }

  const fileYear = Number.isFinite(args.fileYear) ? args.fileYear : new Date().getFullYear();
  console.log(`[hcad-pdata-load] file_year=${fileYear} apply=${args.apply} `
    + `include_all=${args.includeAll} include_classes=${args.includeClasses.join(',') || 'none'} `
    + `source=${args.file}`);

  const { stream, sourceFile, ownersText } = await openSources(args);

  // owners.txt is the small multi-owner SUPPLEMENT (buffered -- see header).
  // OWNERGAP2-harris-c: on the real 2026 export real_acct.txt carries NO
  // `name`-shaped column at all, so owners.txt's ln_num=1 row fills
  // owner_name ITSELF, not just a second owner -- see the fallback inside
  // `streamLoadRealAcct`. It still only fills owner_name_2 (fill-blanks) when
  // real_acct.txt's own mailto column left it blank.
  let ownersByAcct = new Map();
  if (ownersText) {
    const ownersParsed = parseOwnersText(ownersText);
    if (ownersParsed.ok) {
      ownersByAcct = ownersParsed.rowsByAcct;
      console.log(`[hcad-pdata-load] owners.txt: ${ownersParsed.rowsByAcct.size} accounts with multi-owner rows`);
    } else {
      console.warn(`[hcad-pdata-load] owners.txt present but not parsed: ${ownersParsed.reason}`);
    }
  }

  let result;
  try {
    result = await streamLoadRealAcct(stream, {
      fileYear, sourceFile, apply: args.apply, limit: args.limit,
      includeAll: args.includeAll, includeClasses: args.includeClasses, ownersByAcct,
      upsert: (rows) => upsertRows(rows),
    });
  } catch (err) {
    console.error(`[hcad-pdata-load] PARSE FAILED: ${err.message}`
      + (err.missing ? ` (missing columns: ${err.missing.join(', ')})` : ''));
    console.error('[hcad-pdata-load] See api/_shared/hcad-pdata-parse.js FIELD_CANDIDATES '
      + 'to add a header-name alias if this is a genuine HCAD export with a renamed column.');
    process.exit(2);
    return;
  }

  const filterLabel = args.includeAll
    ? 'ALL classes (--include-all)'
    : `F1/F2 real-commercial only${args.includeClasses.length ? ` + ${args.includeClasses.join(',')} (--include-classes)` : ''}`;
  console.log(`[hcad-pdata-load] parsed ${result.totalLines} lines -> ${result.staged} rows staged `
    + `(${filterLabel}) (${result.skippedBlank} skipped blank/no-acct, `
    + `${result.classSkipped} skipped non-F1/F2)`);
  console.log('[hcad-pdata-load] -- see the migration header: F1/F2 classification is UNVERIFIED '
    + 'against the real codebook PDF');
  console.log(`[hcad-pdata-load] owner_name missing on ${result.missingOwnerName} of ${result.staged} `
    + `staged rows${result.ownerNameHeaderMissing ? ' (real_acct.txt header carries no name column -- '
    + 'owners.txt is the sole owner_name source)' : ''}`);

  if (!args.apply) {
    console.log('[hcad-pdata-load] DRY RUN -- pass --apply to write to hcad_real_acct_stage.');
    console.log(`[hcad-pdata-load] sample row: ${JSON.stringify(result.sampleRow || null, null, 2)}`);
    return;
  }

  console.log(`[hcad-pdata-load] wrote ${result.written} of ${result.staged} rows to hcad_real_acct_stage `
    + `(source_file=${sourceFile}, file_year=${fileYear})`);
  if (result.errors.length) {
    console.error(`[hcad-pdata-load] ${result.errors.length} error(s): ${result.errors.join('; ')}`);
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

export { openSources, upsertRows, parseArgs, streamLoadRealAcct };
