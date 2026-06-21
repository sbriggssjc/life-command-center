#!/usr/bin/env node
// ============================================================================
// UW#4 — FREE-first lease OCR drainer (workstation one-shot)
// Life Command Center
//
// The lease extractor (UW#2 / R58) lifts escalation %, guarantor, renewal,
// expiration, and expense structure off the floor — but ~54% of executed lease
// PDFs are SCANNED image-only and park `needs_ocr` (0 fields filled) because the
// extractor needs a text layer. This drainer adds that text layer with a FREE
// local OCR engine (Tesseract via ocrmypdf), so the bulk drain costs ZERO
// per-page cloud spend; only the free-tier MISSES escalate to the in-server
// cloud OCR (gpt-4o vision), and only when --escalate is set.
//
// Why a workstation script (not an in-tick cron): the OCR binary isn't in the
// Railway image, and a 50-page scan blows the per-tick budget. This runs where
// the binaries live and there is no time budget — the established one-shot
// backfill pattern (geocode-properties-backfill / folder-feed-backfill). It
// supplies only the recovered TEXT to the server; every guard / fill-blanks /
// provenance / dedupe runs SERVER-SIDE through the SAME `attachLeaseDoc` — OCR
// adds a text layer, it never changes the extractor or its guards.
//
// FLOW per doc:
//   1. GET  /api/lease-backfill?ocr_queue=1   → the needs_ocr worklist
//   2. read the PDF from the locally-synced SharePoint library (--library-root)
//   3. free OCR → { text, confidence }   (ocrmypdf, + best-effort tesseract TSV
//      mean word-confidence)
//   4. conf >= --conf-min  → POST /api/lease-backfill?id=<id> {ocr_text, ocr_confidence}
//      conf <  --conf-min  → --escalate ? POST with NO ocr_text (server cloud OCR)
//                                       : record skipped_low_conf
//   5. server re-runs the SAME extractor on the supplied text → enriched /
//      ambiguous / draft_not_executed / … (re-stamps `enriched`, draining the queue)
//
// SAFETY: GET dry-run by default for the worklist; --dry-run shows what would be
// OCR'd without writing. Resumable via a local manifest. Gentle concurrency.
// Reversible (a successful re-process re-stamps the folder_feed_seen marker; the
// enrich itself is fill-blanks-only with conflicts → Decision Center).
//
// PREREQUISITES (Scott's workstation):
//   • Node 20+
//   • ocrmypdf            (pip install ocrmypdf  /  brew install ocrmypdf)
//     — pulls Tesseract + Ghostscript. For the confidence pass also install
//       poppler (pdftoppm) + tesseract on PATH. Confidence is best-effort: when
//       the TSV pass can't run it reports null (the server still records the
//       enrich; a null-confidence row is simply not flagged low).
//   • the SharePoint "Team Briggs - Documents" library synced locally
//
// ENV / ARGS:
//   --base / LCC_BASE_URL          the live LCC origin (Railway)
//   --key  / LCC_API_KEY           X-LCC-Key
//   --email / LCC_USER_EMAIL       (optional) X-LCC-User-Email
//   --workspace / LCC_DEFAULT_WORKSPACE_ID (optional)
//   --library-root / LEASE_OCR_LIBRARY_ROOT   local synced library root
//   --strip-prefix                 server-relative prefix to strip before joining
//                                  the library root (default '/sites/TeamBriggs20/Shared Documents')
//   --limit <n>                    docs per run (default 25)
//   --concurrency <n>              parallel OCR (default 2, max 4 — gentle)
//   --conf-min <0-100>             escalate/skip below this mean word conf (default 55)
//   --engine ocrmypdf|tesseract    free OCR engine (default ocrmypdf)
//   --ocr-cmd "<tmpl>"             full override; {in} {sidecar} placeholders
//   --escalate                     allow cloud-OCR fallback on a free-tier miss
//   --manifest <path>              resume manifest (default .lease-ocr-backfill.json)
//   --dry-run                      list + locate only; no OCR, no POST
// ============================================================================

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// ---- arg parsing (mirrors folder-feed-backfill.mjs) ------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const BASE         = (args.base || process.env.LCC_BASE_URL || '').replace(/\/+$/, '');
const API_KEY      = args.key || process.env.LCC_API_KEY || '';
const EMAIL        = args.email || process.env.LCC_USER_EMAIL || '';
const WORKSPACE    = args.workspace || process.env.LCC_DEFAULT_WORKSPACE_ID || '';
const LIBRARY_ROOT = args['library-root'] || process.env.LEASE_OCR_LIBRARY_ROOT || '';
const STRIP_PREFIX = args['strip-prefix'] || '/sites/TeamBriggs20/Shared Documents';
const LIMIT        = Math.max(1, parseInt(args.limit || '25', 10));
const CONCURRENCY  = Math.max(1, Math.min(4, parseInt(args.concurrency || '2', 10)));
const CONF_MIN     = Math.max(0, Math.min(100, parseFloat(args['conf-min'] ?? '55')));
const ENGINE       = args.engine === 'tesseract' ? 'tesseract' : 'ocrmypdf';
const OCR_CMD      = args['ocr-cmd'] || '';
const ESCALATE     = !!args.escalate;
const MANIFEST     = args.manifest || '.lease-ocr-backfill.json';
const DRY_RUN      = !!args['dry-run'];

// ---- manifest (resume) -----------------------------------------------------
function loadManifest() {
  if (!existsSync(MANIFEST)) return { done: {} };
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); }
  catch { return { done: {} }; }
}
function saveManifest(m) {
  try { writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); }
  catch (e) { console.warn('manifest save failed:', e.message); }
}
const manifest = loadManifest();

// ---- pure helpers (exported for unit tests) --------------------------------

/**
 * Map a SharePoint server-relative path to the locally-synced library file.
 * Strips `stripPrefix` (the site/library prefix) and joins under `libraryRoot`,
 * normalizing separators for the host OS. Returns null when the prefix doesn't
 * match (an unexpected path shape — surfaced, never guessed).
 */
export function localPathFor(serverRelativePath, libraryRoot, stripPrefix) {
  const p = String(serverRelativePath || '').replace(/\\/g, '/');
  const pref = String(stripPrefix || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!p) return null;
  let rel = p;
  if (pref) {
    const lower = p.toLowerCase();
    const idx = lower.indexOf(pref.toLowerCase());
    if (idx === -1) return null;        // prefix not found → don't guess
    rel = p.slice(idx + pref.length);
  }
  rel = rel.replace(/^\/+/, '');
  if (!rel) return null;
  return join(libraryRoot, ...rel.split('/'));
}

/**
 * Mean word confidence (0-100) from Tesseract TSV output. TSV `conf` is the
 * last column; values are -1 for non-word rows. Averages only conf >= 0 over
 * non-empty tokens. Returns null when there is no scorable word.
 */
export function meanConfidenceFromTsv(tsv) {
  const lines = String(tsv || '').split(/\r?\n/);
  let sum = 0, n = 0;
  for (let i = 1; i < lines.length; i++) {           // row 0 is the header
    const cols = lines[i].split('\t');
    if (cols.length < 12) continue;
    const conf = parseFloat(cols[10]);
    const word = (cols[11] || '').trim();
    if (!word || !Number.isFinite(conf) || conf < 0) continue;
    sum += conf; n += 1;
  }
  return n ? Math.round((sum / n) * 10) / 10 : null;
}

// ---- free OCR engines (system binaries; workstation only) ------------------

function run(cmd, argv, opts = {}) {
  return spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}

// Best-effort mean word confidence: rasterize the first few pages (pdftoppm) and
// run tesseract TSV over them. Any missing binary / failure → null (honest), so
// the enrich still records, just unflagged.
function freeOcrConfidence(pdfPath, scratch) {
  try {
    const prefix = join(scratch, 'pg');
    const ppm = run('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '3', pdfPath, prefix]);
    if (ppm.status !== 0) return null;
    const confs = [];
    for (let pg = 1; pg <= 3; pg++) {
      const img = `${prefix}-${pg}.png`;
      if (!existsSync(img) && !existsSync(`${prefix}-0${pg}.png`)) continue;
      const real = existsSync(img) ? img : `${prefix}-0${pg}.png`;
      const t = run('tesseract', [real, 'stdout', 'tsv']);
      if (t.status === 0) {
        const c = meanConfidenceFromTsv(t.stdout);
        if (c != null) confs.push(c);
      }
    }
    if (!confs.length) return null;
    return Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10) / 10;
  } catch { return null; }
}

/**
 * Free OCR one local PDF → { ok, text, confidence, engine } or { ok:false, reason }.
 * Never throws. Default engine ocrmypdf (text via --sidecar) with a best-effort
 * tesseract-TSV confidence pass; --engine tesseract uses pdftoppm + tesseract
 * end-to-end; --ocr-cmd is a full override ({in} {sidecar} placeholders).
 */
export function freeOcr(pdfPath) {
  const scratch = mkdtempSync(join(tmpdir(), 'lease-ocr-'));
  try {
    const sidecar = join(scratch, 'sidecar.txt');

    if (OCR_CMD) {
      const filled = OCR_CMD.replace(/\{in\}/g, pdfPath).replace(/\{sidecar\}/g, sidecar);
      const r = run('/bin/sh', ['-c', filled]);
      if (r.status !== 0) return { ok: false, reason: `ocr_cmd_exit_${r.status}:${(r.stderr || '').slice(0, 200)}` };
      const text = existsSync(sidecar) ? readFileSync(sidecar, 'utf8') : (r.stdout || '');
      if (!text.trim()) return { ok: false, reason: 'ocr_cmd_empty' };
      return { ok: true, text: text.trim(), confidence: freeOcrConfidence(pdfPath, scratch), engine: 'custom' };
    }

    if (ENGINE === 'tesseract') {
      const prefix = join(scratch, 'pg');
      const ppm = run('pdftoppm', ['-png', '-r', '200', pdfPath, prefix]);
      if (ppm.status !== 0) return { ok: false, reason: `pdftoppm_exit_${ppm.status}` };
      const parts = []; const confs = [];
      for (let pg = 1; pg <= 500; pg++) {
        const a = `${prefix}-${pg}.png`, b = `${prefix}-${String(pg).padStart(2, '0')}.png`;
        const img = existsSync(a) ? a : (existsSync(b) ? b : null);
        if (!img) break;
        const txt = run('tesseract', [img, 'stdout']);
        if (txt.status === 0 && txt.stdout) parts.push(txt.stdout);
        const tsv = run('tesseract', [img, 'stdout', 'tsv']);
        if (tsv.status === 0) { const c = meanConfidenceFromTsv(tsv.stdout); if (c != null) confs.push(c); }
      }
      const text = parts.join('\n').trim();
      if (!text) return { ok: false, reason: 'tesseract_empty' };
      const confidence = confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10) / 10 : null;
      return { ok: true, text, confidence, engine: 'tesseract' };
    }

    // Default: ocrmypdf (handles rasterization + Tesseract + a text layer).
    const out = join(scratch, 'out.pdf');
    const r = run('ocrmypdf', ['--force-ocr', '--sidecar', sidecar, '--output-type', 'pdf', pdfPath, out]);
    if (r.status !== 0 && !existsSync(sidecar)) {
      return { ok: false, reason: `ocrmypdf_exit_${r.status}:${(r.stderr || '').slice(0, 200)}` };
    }
    const text = existsSync(sidecar) ? readFileSync(sidecar, 'utf8').trim() : '';
    if (!text) return { ok: false, reason: 'ocrmypdf_empty' };
    return { ok: true, text, confidence: freeOcrConfidence(pdfPath, scratch), engine: 'ocrmypdf' };
  } catch (err) {
    return { ok: false, reason: `free_ocr_threw:${err?.message || err}` };
  } finally {
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ---- HTTP ------------------------------------------------------------------
function authHeaders(extra = {}) {
  const h = { 'X-LCC-Key': API_KEY, ...extra };
  if (EMAIL) h['X-LCC-User-Email'] = EMAIL;
  if (WORKSPACE) h['X-LCC-Workspace'] = WORKSPACE;
  return h;
}

async function fetchOcrQueue() {
  const res = await fetch(`${BASE}/api/lease-backfill?ocr_queue=1&limit=${LIMIT}`, { headers: authHeaders() });
  const text = await res.text().catch(() => '');
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* keep */ }
  if (!res.ok || !json) throw new Error(`ocr_queue ${res.status}: ${text.slice(0, 200)}`);
  return Array.isArray(json.items) ? json.items : [];
}

async function resubmit(id, ocrText, ocrConfidence) {
  const body = ocrText ? { ocr_text: ocrText, ocr_confidence: ocrConfidence } : {};
  const res = await fetch(`${BASE}/api/lease-backfill?id=${encodeURIComponent(id)}`, {
    method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* keep */ }
  if (!res.ok) return { ok: false, status: res.status, detail: text.slice(0, 300) };
  return { ok: true, result: json?.result || json };
}

// ---- per-doc worker --------------------------------------------------------
async function processDoc(item) {
  const key = String(item.id);
  if (manifest.done[key]) return { id: item.id, status: 'already', path: item.path };

  const local = LIBRARY_ROOT ? localPathFor(item.path, LIBRARY_ROOT, STRIP_PREFIX) : null;
  if (!local) return { id: item.id, status: 'no_local_path', path: item.path };
  if (!existsSync(local)) return { id: item.id, status: 'local_missing', path: item.path, local };

  if (DRY_RUN) return { id: item.id, status: 'would_ocr', path: item.path, local };

  const ocr = freeOcr(local);
  if (!ocr.ok) {
    if (ESCALATE) {
      const r = await resubmit(item.id, null, null);       // server cloud OCR
      if (r.ok) { manifest.done[key] = { outcome: r.result?.outcome || 'escalated', via: 'cloud', at: new Date().toISOString() }; }
      return { id: item.id, status: 'escalated_free_fail', reason: ocr.reason, result: r.result || null, ok: r.ok };
    }
    return { id: item.id, status: 'free_ocr_failed', reason: ocr.reason };
  }

  const conf = ocr.confidence;
  const lowConf = conf != null && CONF_MIN > 0 && conf < CONF_MIN;
  if (lowConf && !ESCALATE) {
    return { id: item.id, status: 'skipped_low_conf', confidence: conf, engine: ocr.engine };
  }

  // Below the floor + --escalate → cloud OCR; otherwise submit the free text.
  const r = lowConf
    ? await resubmit(item.id, null, null)
    : await resubmit(item.id, ocr.text, conf);
  if (r.ok) {
    manifest.done[key] = {
      outcome: r.result?.outcome || null, via: lowConf ? 'cloud' : 'free',
      confidence: conf, engine: ocr.engine, at: new Date().toISOString(),
    };
  }
  return {
    id: item.id, status: lowConf ? 'escalated_low_conf' : 'submitted',
    via: lowConf ? 'cloud' : 'free', confidence: conf, engine: ocr.engine,
    text_len: ocr.text.length, result: r.result || null, ok: r.ok,
  };
}

// ---- gentle concurrency pool ----------------------------------------------
async function runPool(items, worker, concurrency) {
  const results = []; let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await worker(items[i]); }
      catch (e) { results[i] = { id: items[i]?.id, status: 'threw', error: e?.message || String(e) }; }
      saveManifest(manifest);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}

// ---- main ------------------------------------------------------------------
async function main() {
  if (!BASE || !API_KEY) {
    console.error('ERROR: --base/LCC_BASE_URL and --key/LCC_API_KEY are required.');
    process.exit(2);
  }
  if (!DRY_RUN && !LIBRARY_ROOT) {
    console.error('ERROR: --library-root/LEASE_OCR_LIBRARY_ROOT is required (the locally-synced SharePoint library).');
    process.exit(2);
  }
  console.log(`[lease-ocr-backfill] base=${BASE} engine=${ENGINE} conf-min=${CONF_MIN} escalate=${ESCALATE} concurrency=${CONCURRENCY} dry-run=${DRY_RUN}`);

  let queue;
  try { queue = await fetchOcrQueue(); }
  catch (e) { console.error('ERROR listing OCR queue:', e.message); process.exit(1); }

  console.log(`[lease-ocr-backfill] needs_ocr queue: ${queue.length} doc(s)`);
  if (!queue.length) { console.log('Nothing to drain.'); return; }

  const results = await runPool(queue, processDoc, CONCURRENCY);
  saveManifest(manifest);

  // ---- tally ----
  const tally = {};
  for (const r of results) tally[r.status] = (tally[r.status] || 0) + 1;
  const enriched = results.filter((r) => r.result?.outcome === 'enriched');
  const fieldsFilled = enriched.reduce((s, r) => s + (r.result?.fields_filled || 0), 0);
  const conflicts = enriched.reduce((s, r) => s + (r.result?.conflicts || 0), 0);
  const leasesCreated = enriched.filter((r) => r.result?.lease_created).length;
  const confs = results.map((r) => r.confidence).filter((c) => typeof c === 'number');
  const meanConf = confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10) / 10 : null;

  console.log('\n=== lease-ocr-backfill summary ===');
  console.log('status:', JSON.stringify(tally, null, 0));
  console.log(`enriched: ${enriched.length}  fields_filled: ${fieldsFilled}  conflicts→DecisionCenter: ${conflicts}  leases_created: ${leasesCreated}`);
  console.log(`free-tier mean confidence: ${meanConf == null ? 'n/a' : meanConf}`);
  const escalations = results.filter((r) => /escalat/.test(r.status)).length;
  console.log(`free-tier hit: ${results.filter((r) => r.via === 'free').length}  escalated to cloud: ${escalations}`);
  if (DRY_RUN) console.log('(dry-run — no OCR, no writes)');
}

// Only drive the drain when invoked directly (`node scripts/lease-ocr-backfill.mjs`);
// importing for unit tests must NOT run main() (it calls process.exit).
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((e) => { console.error('fatal:', e?.message || e); process.exit(1); });
}
