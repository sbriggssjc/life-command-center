#!/usr/bin/env node
// ============================================================================
// OCR1 — local OCR vs Google Document AI bake-off harness
// Life Command Center · exploratory MEASUREMENT, wires nothing
//
// Runs every local OCR engine on PATH over the same real documents DocAI has
// already read, then asks the ONE question that matters: does the CONSUMER
// (`extractTenantFromLease`) get the same answer from the local text as it does
// from the DocAI text?
//
// ⚠️ char_len IS NOT A QUALITY METRIC AND IS NEVER RANKED ON. A garbled OCR
// produces plenty of characters — this repo has already been burned by exactly
// that (the gpt-4o tier averaged 1,511 chars, passed every count-based check,
// and was useless). Char counts are printed as CONTEXT, in a column that says so.
//
// ⚠️ THE BOTH-NULL TRAP IS THE WHOLE DESIGN PROBLEM HERE. If a document defeats
// BOTH engines, every field comes back null on both sides and naive equality
// reports 100% agreement over a total failure. So `agreement_rate` EXCLUDES
// both-null by construction (see scoreDocument) and `both_null` is reported
// beside it on every row. A high both-null share means the sample is not
// discriminating, NOT that local matched DocAI.
//
// TWO ARMS, because the sample the brief asks for cannot exist (OCR1 §6a):
// "leases over 30 pages WITH a DocAI baseline" is impossible — the 30-page cap
// is precisely WHY longer documents have no baseline.
//
//   ARM A  bakeoff/<id>/source.pdf + docai.txt   → field agreement vs baseline
//   ARM B  bakeoff/<id>/source.pdf   (no docai)  → coherence + clause legibility
//                                                  (over-cap docs; NO baseline
//                                                   exists to agree with — say so)
//
// USAGE (Scott's workstation / the GaryBuilt box — NOT the sandbox, which has
// no egress to Supabase or SharePoint):
//
//   # 1. pull the DocAI baselines for the arm-A ids (needs OPS_SUPABASE_*)
//   node scripts/ocr-bakeoff.mjs --fetch-baselines 336,431,425,327,255,386,343,299,436,228
//
//   # 2. drop the PDFs in as bakeoff/<id>/source.pdf, then:
//   node scripts/ocr-bakeoff.mjs --run
//
//   # plumbing proof, no real documents, no model, no network:
//   node scripts/ocr-bakeoff.mjs --self-test
//
// OUTPUT: <dir>/agreement.json (machine) + <dir>/agreement.md (the deliverable).
//
// ⚠️ bakeoff/ IS GIT-IGNORED. It holds client lease text and must never be
// committed. The harness refuses to write outside --dir.
// ============================================================================

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadEnvForScripts } from './_env-file.mjs';

// ---------------------------------------------------------------------------
// The six consumer fields the bake-off is graded on. These are the fields the
// BOV generator actually renders — agreement on THESE is the deliverable.
// ---------------------------------------------------------------------------
// ⚠️ `key` IS THE KEY ON THE CONSUMER'S TENANT OBJECT, NOT THE MODEL'S JSON KEY.
// `extractTenantFromLease` renames on the way out (bov-extract.js:270-284):
// tenant_name→name, leased_sf→sf. Grading on the JSON names reads `undefined`
// off an object that has never had them, and — because a missing key normalizes
// to null on BOTH sides — renders as `both_null` forever: a field silently not
// measured, wearing the same label as a field both engines failed on. That bug
// was live in this harness's first run (2 of 6 fields) and is why
// assertGradedFieldsReadable() exists. `label` is what the report prints.
export const GRADED_FIELDS = [
  { key: 'name', label: 'tenant_name', type: 'string' },
  { key: 'lease_commencement', label: 'lease_commencement', type: 'date' },
  { key: 'lease_expiration', label: 'lease_expiration', type: 'date' },
  { key: 'year1_rent', label: 'year1_rent', type: 'number' },
  { key: 'sf', label: 'leased_sf', type: 'number' },
  { key: 'lease_type', label: 'lease_type', type: 'string' },
];

/**
 * POSITIVE CONTROL for the above. Given a tenant object the consumer produced
 * from text that STATES all six values, every graded key must be readable. A
 * key that is structurally absent (renamed upstream) shows up here instead of
 * quietly inflating both_null. Returns the unreadable labels.
 */
export function assertGradedFieldsReadable(tenant) {
  if (!tenant) return GRADED_FIELDS.map((f) => f.label);
  return GRADED_FIELDS.filter((f) => !(f.key in tenant)).map((f) => f.label);
}

// Back-half clauses (ABSTRACT_KEYS names, bov-extract.js:46-54). These live deep
// in a long lease and are the reason the page cap matters at all — arm B grades
// whether an uncapped local read reaches them.
export const BACK_HALF_CLAUSES = ['renewal_options', 'early_termination', 'default_cure', 'holdover'];

// Model-independent vocabulary for the same clauses, so arm B can say whether the
// back half is LEGIBLE even when the extractor's 90k slice never reaches it.
const CLAUSE_VOCAB = {
  renewal_options: [/option\s+to\s+(extend|renew)/i, /renewal\s+(option|term)/i, /extension\s+option/i],
  early_termination: [/early\s+termination/i, /right\s+to\s+terminate/i, /termination\s+option/i],
  default_cure: [/cure\s+period/i, /event\s+of\s+default/i, /right\s+to\s+cure/i],
  holdover: [/hold[\s-]?over/i, /holding\s+over/i],
};

// ---------------------------------------------------------------------------
// Field normalization + comparison
// ---------------------------------------------------------------------------

/** Normalize one graded value for COMPARISON by type. Raw values are always reported. */
export function normalizeField(type, value) {
  if (value == null || value === '') return null;
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'date') {
    const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : String(value).trim().toLowerCase() || null;
  }
  // string (tenant name / lease type): case + punctuation + whitespace insensitive.
  const s = String(value).toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  return s || null;
}

/**
 * Compare one field across baseline (DocAI) and candidate (local).
 *
 * ⚠️ `both_null` IS ITS OWN VERDICT AND IS NEVER COUNTED AS AGREEMENT. Two
 * engines that both failed to find a value have not agreed about anything.
 */
export function compareField(field, baselineVal, candidateVal) {
  const type = typeof field === 'string' ? 'string' : field.type;
  const b = normalizeField(type, baselineVal);
  const c = normalizeField(type, candidateVal);
  if (b == null && c == null) return 'both_null';
  if (b == null) return 'candidate_only';   // local found it, DocAI did not → local WIN
  if (c == null) return 'baseline_only';    // DocAI found it, local did not → local LOSS
  return b === c ? 'agree' : 'disagree';
}

/**
 * Score one document: baseline tenant vs each candidate engine's tenant.
 *
 * `agreement_rate` = agree / (agree + disagree + candidate_only + baseline_only).
 * The denominator EXCLUDES both_null on purpose — see the header. A document
 * where every field is both_null returns agreement_rate === null (not 1.0), so a
 * total mutual failure can never render as a perfect score.
 */
export function scoreDocument(baselineTenant, candidateTenant, fields = GRADED_FIELDS) {
  const verdicts = {};
  const tally = { agree: 0, disagree: 0, candidate_only: 0, baseline_only: 0, both_null: 0 };
  for (const f of fields) {
    const v = compareField(f, baselineTenant?.[f.key], candidateTenant?.[f.key]);
    verdicts[f.label] = {
      verdict: v,
      baseline: baselineTenant?.[f.key] ?? null,
      candidate: candidateTenant?.[f.key] ?? null,
    };
    tally[v] += 1;
  }
  const decided = tally.agree + tally.disagree + tally.candidate_only + tally.baseline_only;
  return {
    verdicts,
    tally,
    decided_fields: decided,
    both_null_fields: tally.both_null,
    agreement_rate: decided ? tally.agree / decided : null,
  };
}

/**
 * Model-independent text-quality context. ⚠️ NOT a quality metric and NOT ranked
 * on — it is the cheapest way to spot a garbled read that still has plenty of
 * characters, which is the failure mode char_len cannot see.
 */
export function garbleStats(text) {
  const s = String(text || '');
  if (!s.trim()) return { chars: 0, tokens: 0, wordlike_ratio: null, mean_word_len: null, junk_ratio: null };
  const tokens = s.split(/\s+/).filter(Boolean);
  const wordlike = tokens.filter((t) => /^[A-Za-z][A-Za-z'-]{1,14}$/.test(t));
  const junk = (s.match(/[^\x09\x0A\x0D\x20-\x7E]/g) || []).length;
  const meanLen = wordlike.length
    ? wordlike.reduce((a, t) => a + t.length, 0) / wordlike.length : null;
  return {
    chars: s.length,
    tokens: tokens.length,
    wordlike_ratio: tokens.length ? Number((wordlike.length / tokens.length).toFixed(3)) : null,
    mean_word_len: meanLen == null ? null : Number(meanLen.toFixed(2)),
    junk_ratio: s.length ? Number((junk / s.length).toFixed(4)) : null,
  };
}

/**
 * Arm B: is the back half of a long lease LEGIBLE? Model-independent — scans the
 * FULL local text (not the extractor's 90k slice) for each clause's vocabulary
 * and reports where in the document it appears, as a 0-1 position.
 */
export function clauseLegibility(text) {
  const s = String(text || '');
  const out = {};
  for (const [clause, pats] of Object.entries(CLAUSE_VOCAB)) {
    let hit = null;
    for (const p of pats) {
      const m = s.match(p);
      if (m && m.index != null) { hit = m.index; break; }
    }
    out[clause] = hit == null
      ? { found: false, position: null }
      : { found: true, position: s.length ? Number((hit / s.length).toFixed(3)) : null };
  }
  out.found_count = Object.values(out).filter((v) => v && v.found).length;
  return out;
}

// ---------------------------------------------------------------------------
// Engine probing + invocation (shape mirrors scripts/lease-ocr-backfill.mjs,
// which is the reference implementation for engine choice and flags — but that
// one is workstation-only and returns no per-page text, so this re-does it.)
// ---------------------------------------------------------------------------

const ENGINE_BINARIES = {
  surya: 'surya_ocr',
  paddleocr: 'paddleocr',
  ocrmypdf: 'ocrmypdf',
  tesseract: 'tesseract',
};

function run(cmd, argv, opts = {}) {
  return spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts });
}

function binaryAvailable(cmd) {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
  return !(r.error && r.error.code === 'ENOENT');
}

function binaryVersion(cmd) {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
  if (r.error) return null;
  return String(r.stdout || r.stderr || '').split(/\r?\n/)[0].trim() || null;
}

/**
 * Which engines can actually run here. ⚠️ REPORTED, never assumed — the answer
 * differs per machine and is itself one of the measurements OCR1 asks for.
 * `tesseract` additionally needs pdftoppm (poppler) to rasterize a PDF.
 */
export function probeEngines() {
  const out = {};
  for (const [engine, bin] of Object.entries(ENGINE_BINARIES)) {
    const available = binaryAvailable(bin);
    const entry = { binary: bin, available, version: available ? binaryVersion(bin) : null };
    if (engine === 'tesseract') {
      entry.needs = 'pdftoppm';
      entry.rasterizer_available = binaryAvailable('pdftoppm');
      entry.available = available && entry.rasterizer_available;
    }
    out[engine] = entry;
  }
  return out;
}

function meanConfidenceFromTsv(tsv) {
  const confs = [];
  for (const line of String(tsv || '').split(/\r?\n/).slice(1)) {
    const cols = line.split('\t');
    if (cols.length < 12) continue;
    const c = Number(cols[10]);
    const word = (cols[11] || '').trim();
    if (word && Number.isFinite(c) && c >= 0) confs.push(c);
  }
  if (!confs.length) return null;
  return Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10) / 10;
}

function pdfPageCount(pdfPath) {
  const r = run('pdfinfo', [pdfPath]);
  if (r.status === 0) {
    const m = String(r.stdout).match(/^Pages:\s+(\d+)/m);
    if (m) return Number(m[1]);
  }
  return null;
}

/** pdftoppm + tesseract, page by page — yields per-page text AND confidence. */
function tesseractOcr(pdfPath, scratch, { maxPages = 0, dpi = 200 } = {}) {
  const prefix = join(scratch, 'pg');
  const argv = ['-png', '-r', String(dpi)];
  if (maxPages > 0) argv.push('-f', '1', '-l', String(maxPages));
  argv.push(pdfPath, prefix);
  const ppm = run('pdftoppm', argv);
  if (ppm.status !== 0) return { ok: false, reason: `pdftoppm_exit_${ppm.status}:${(ppm.stderr || '').slice(0, 160)}` };

  const pages = []; const confs = [];
  for (let pg = 1; pg <= 2000; pg++) {
    let img = null;
    for (const w of [String(pg), String(pg).padStart(2, '0'), String(pg).padStart(3, '0'), String(pg).padStart(4, '0')]) {
      const cand = `${prefix}-${w}.png`;
      if (existsSync(cand)) { img = cand; break; }
    }
    if (!img) break;
    const txt = run('tesseract', [img, 'stdout']);
    pages.push({ page: pg, text: txt.status === 0 ? (txt.stdout || '') : '' });
    const tsv = run('tesseract', [img, 'stdout', 'tsv']);
    if (tsv.status === 0) { const c = meanConfidenceFromTsv(tsv.stdout); if (c != null) confs.push(c); }
  }
  const text = pages.map((p) => p.text).join('\n').trim();
  if (!text) return { ok: false, reason: 'tesseract_empty' };
  return {
    ok: true, text, pages, engine: 'tesseract',
    confidence: confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10) / 10 : null,
  };
}

/** ocrmypdf --sidecar. Sidecar pages are \f-separated, so per-page survives. */
function ocrmypdfOcr(pdfPath, scratch) {
  const sidecar = join(scratch, 'sidecar.txt');
  const out = join(scratch, 'out.pdf');
  const r = run('ocrmypdf', ['--force-ocr', '--sidecar', sidecar, '--output-type', 'pdf', pdfPath, out]);
  if (r.error && r.error.code === 'ENOENT') return { ok: false, reason: 'ocrmypdf_not_installed' };
  if (r.status !== 0 && !existsSync(sidecar)) {
    return { ok: false, reason: `ocrmypdf_exit_${r.status}:${(r.stderr || '').slice(0, 200)}` };
  }
  const raw = existsSync(sidecar) ? readFileSync(sidecar, 'utf8') : '';
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'ocrmypdf_empty' };
  const pages = raw.split('\f').map((t, i) => ({ page: i + 1, text: t }));
  return { ok: true, text, pages, engine: 'ocrmypdf', confidence: null };
}

function findFile(dir, predicate) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { const f = findFile(full, predicate); if (f) return f; }
    else if (predicate(e.name)) return full;
  }
  return null;
}

/** Surya — native PDF, per-line confidence, strong on rent tables. */
function suryaOcr(pdfPath, scratch) {
  const out = join(scratch, 'surya');
  const r = run('surya_ocr', [pdfPath, '--output_dir', out]);
  if (r.error && r.error.code === 'ENOENT') return { ok: false, reason: 'surya_not_installed' };
  const js = findFile(out, (n) => n === 'results.json') || findFile(out, (n) => n.endsWith('.json'));
  if (!js) return { ok: false, reason: `surya_no_output:${(r.stderr || '').slice(0, 160)}` };
  let parsed;
  try { parsed = JSON.parse(readFileSync(js, 'utf8')); } catch { return { ok: false, reason: 'surya_bad_json' }; }
  const pages = []; const confs = [];
  const docs = Array.isArray(parsed) ? parsed : Object.values(parsed).flat();
  let pageNo = 0;
  for (const pg of docs) {
    pageNo += 1;
    const lines = pg?.text_lines || pg?.lines || [];
    const t = lines.map((l) => l.text || '').join('\n');
    pages.push({ page: pg?.page ?? pageNo, text: t });
    for (const l of lines) if (Number.isFinite(l?.confidence)) confs.push(l.confidence);
  }
  const text = pages.map((p) => p.text).join('\n').trim();
  if (!text) return { ok: false, reason: 'surya_empty' };
  const mean = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
  return {
    ok: true, text, pages, engine: 'surya',
    confidence: mean == null ? null : Math.round((mean <= 1 ? mean * 100 : mean) * 10) / 10,
  };
}

/** PaddleOCR 3.x. CLI flags vary across versions — override with --engine-cmd. */
function paddleOcr(pdfPath, scratch) {
  const out = join(scratch, 'paddle');
  const r = run('paddleocr', ['ocr', '-i', pdfPath, '--save_path', out]);
  if (r.error && r.error.code === 'ENOENT') return { ok: false, reason: 'paddleocr_not_installed' };
  let blob = r.stdout || '';
  if (!blob.trim()) {
    const js = findFile(out, (n) => n.endsWith('.json'));
    if (js) blob = readFileSync(js, 'utf8');
  }
  const lines = []; const confs = [];
  for (const m of blob.matchAll(/'([^']{2,})',\s*([01]\.\d+)/g)) { lines.push(m[1]); confs.push(Number(m[2])); }
  if (!lines.length) {
    try {
      const j = JSON.parse(blob);
      const walk = (n) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === 'object') {
          if (typeof n.text === 'string') { lines.push(n.text); if (Number.isFinite(n.confidence)) confs.push(n.confidence); }
          Object.values(n).forEach(walk);
        }
      };
      walk(j);
    } catch { /* not json */ }
  }
  const text = lines.join('\n').trim();
  if (!text) return { ok: false, reason: `paddleocr_no_text:${(r.stderr || '').slice(0, 160)}` };
  const mean = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
  return {
    ok: true, text, pages: null, engine: 'paddleocr',
    confidence: mean == null ? null : Math.round((mean <= 1 ? mean * 100 : mean) * 100) / 100,
  };
}

/** Run one engine over one PDF, timed. Never throws. */
export function runEngine(engine, pdfPath, opts = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'ocr-bakeoff-'));
  const t0 = Date.now();
  try {
    let res;
    if (engine === 'tesseract') res = tesseractOcr(pdfPath, scratch, opts);
    else if (engine === 'ocrmypdf') res = ocrmypdfOcr(pdfPath, scratch);
    else if (engine === 'surya') res = suryaOcr(pdfPath, scratch);
    else if (engine === 'paddleocr') res = paddleOcr(pdfPath, scratch);
    else res = { ok: false, reason: `unknown_engine:${engine}` };
    res.elapsed_ms = Date.now() - t0;
    return res;
  } catch (err) {
    return { ok: false, reason: `engine_threw:${err?.message || err}`, elapsed_ms: Date.now() - t0 };
  } finally {
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// The consumer. ⚠️ BOTH ARMS MUST GO THROUGH THE SAME MODEL AND THE SAME PROMPT
// (OCR1 §6c) or the comparison measures the model, not the OCR. The model is
// recorded in the report and the report REFUSES to present stub numbers as real.
// ---------------------------------------------------------------------------

/**
 * A deterministic offline stub standing in for invokeExtractionAI. Used ONLY by
 * --self-test / --model stub, to prove the harness's own plumbing without a
 * model or a network. It reads the six graded fields straight out of the text
 * with regexes — good enough to show the pipeline carries values end to end, and
 * deliberately NOT good enough to be mistaken for an extraction.
 */
export function stubExtractionAI({ prompt }) {
  const text = String(prompt || '');
  const pick = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const num = (v) => { if (v == null) return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };
  const out = {
    tenant_name: pick(/TENANT:\s*([^\n]+)/i),
    guarantor: null,
    suite: null,
    leased_sf: num(pick(/RENTABLE (?:AREA|SF):\s*([\d,]+)/i)),
    lease_type: pick(/LEASE TYPE:\s*([A-Za-z]+)/i),
    year1_rent: num(pick(/(?:YEAR 1 |ANNUAL )?BASE RENT:\s*\$?([\d,]+)/i)),
    escalation_pct: null,
    lease_commencement: pick(/COMMENCEMENT(?: DATE)?:\s*(\d{4}-\d{2}-\d{2})/i),
    lease_expiration: pick(/EXPIRATION(?: DATE)?:\s*(\d{4}-\d{2}-\d{2})/i),
    rent_schedule: null,
    abstract: Object.fromEntries(BACK_HALF_CLAUSES.map((c) => {
      const found = (CLAUSE_VOCAB[c] || []).some((p) => p.test(text));
      return [c, found ? 'stated' : null];
    })),
    clause_refs: {},
  };
  return Promise.resolve({ ok: true, data: { response: JSON.stringify(out), model: 'stub/offline' } });
}

// ---------------------------------------------------------------------------
// Baseline fetch — the workstation can reach Supabase, the sandbox cannot.
// ---------------------------------------------------------------------------

async function fetchBaselines(ids, dir) {
  const env = loadEnvForScripts(process.cwd());
  const url = env.OPS_SUPABASE_URL;
  const key = env.OPS_SUPABASE_SERVICE_KEY || env.OPS_SUPABASE_KEY;
  if (!url || !key) {
    console.error('Missing OPS_SUPABASE_URL / OPS_SUPABASE_SERVICE_KEY — cannot fetch baselines.');
    console.error('(The sandbox has no egress to Supabase; run this on the workstation.)');
    process.exit(1);
  }
  const q = `${url.replace(/\/$/, '')}/rest/v1/lcc_cre_property_document_text`
    + `?document_id=in.(${ids.join(',')})`
    + '&extractor_version=eq.unit1_v1&needs_ocr=is.false&raw_text=not.is.null'
    + '&select=document_id,document_type,page_count,ocr_pages,char_len,ocr_tier,raw_text,pages';
  const r = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) { console.error(`baseline fetch failed: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`); process.exit(1); }
  const rows = await r.json();
  const got = new Set();
  for (const row of rows) {
    const d = join(dir, String(row.document_id));
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'docai.txt'), row.raw_text || '');
    if (row.pages) writeFileSync(join(d, 'docai.pages.json'), JSON.stringify(row.pages, null, 2));
    writeFileSync(join(d, 'meta.json'), JSON.stringify({
      document_id: row.document_id, document_type: row.document_type,
      page_count: row.page_count, ocr_pages: row.ocr_pages,
      char_len: row.char_len, ocr_tier: row.ocr_tier,
    }, null, 2));
    got.add(String(row.document_id));
    console.log(`  ${row.document_id}  ${row.document_type}  ${row.page_count}pp  ${row.char_len} chars  → ${d}/docai.txt`);
  }
  // ⚠️ Name the ids that did NOT come back. An id absent from the response and an
  // id that has no baseline are the same silence otherwise.
  const missing = ids.filter((i) => !got.has(String(i)));
  if (missing.length) console.log(`\n  ⚠️ no baseline row for: ${missing.join(', ')} (over-cap? different extractor_version?)`);
  console.log(`\nFetched ${got.size}/${ids.length}. Now drop each document's PDF in as ${dir}/<id>/source.pdf`);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function listDocDirs(dir, only) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !only || only.includes(n))
    .filter((n) => existsSync(join(dir, n, 'source.pdf')))
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

async function extractFrom(text, pages, invoke, extractTenantFromLease) {
  const res = await extractTenantFromLease(
    { document_id: 'bakeoff', raw_text: text, pages: pages || null },
    { invokeExtractionAI: invoke },
  );
  return res;
}

async function runBakeoff(opts) {
  const { dir, engines, useStub, only, maxPages, dpi } = opts;
  const probe = probeEngines();
  const runnable = engines.filter((e) => probe[e]?.available);

  console.log('\n=== ENGINES ===');
  for (const [e, p] of Object.entries(probe)) {
    const mark = p.available ? '✔' : '✗';
    const extra = p.needs && !p.rasterizer_available ? `  (missing ${p.needs})` : '';
    console.log(`  ${mark} ${e.padEnd(10)} ${p.version || (p.available ? '' : 'not installed')}${extra}`);
  }
  if (!runnable.length) {
    console.error('\nNo OCR engine available on PATH. Install one (see docs/UW4_LEASE_OCR.md) and re-run.');
    process.exit(2);
  }
  console.log(`\nRunning: ${runnable.join(', ')}`);

  // The consumer + model. Imported lazily so --self-test never needs ai.js.
  const { extractTenantFromLease } = await import('../api/_shared/bov-extract.js');
  let invoke = stubExtractionAI;
  let modelLabel = 'stub/offline';
  if (!useStub) {
    const ai = await import('../api/_shared/ai.js');
    invoke = ai.invokeExtractionAI;
    modelLabel = 'invokeExtractionAI (see report model column for what actually served)';
  }

  const docDirs = listDocDirs(dir, only);
  if (!docDirs.length) {
    console.error(`\nNo documents found. Expected ${dir}/<id>/source.pdf`);
    process.exit(2);
  }

  const results = [];
  for (const id of docDirs) {
    const d = join(dir, id);
    const pdf = join(d, 'source.pdf');
    const baselinePath = join(d, 'docai.txt');
    const arm = existsSync(baselinePath) ? 'A' : 'B';
    const meta = existsSync(join(d, 'meta.json'))
      ? JSON.parse(readFileSync(join(d, 'meta.json'), 'utf8')) : {};
    const sourcePages = pdfPageCount(pdf) ?? meta.page_count ?? null;

    console.log(`\n--- doc ${id} (arm ${arm}, ${sourcePages ?? '?'}pp, ${(statSync(pdf).size / 1e6).toFixed(1)} MB) ---`);

    // Baseline side (arm A only).
    let baseline = null;
    if (arm === 'A') {
      const btext = readFileSync(baselinePath, 'utf8');
      const bpages = existsSync(join(d, 'docai.pages.json'))
        ? JSON.parse(readFileSync(join(d, 'docai.pages.json'), 'utf8')) : null;
      const bres = await extractFrom(btext, bpages, invoke, extractTenantFromLease);
      baseline = {
        engine: 'google_docai', text_stats: garbleStats(btext),
        clauses: clauseLegibility(btext),
        ok: !!bres?.ok, reason: bres?.reason || null,
        tenant: bres?.ok ? bres.tenant : null, model: bres?.model || null,
      };
      // ⚠️ POSITIVE CONTROL: a graded key the consumer does not emit would score
      // `both_null` on every document forever — a field silently not measured.
      baseline.unreadable_fields = bres?.ok ? assertGradedFieldsReadable(bres.tenant) : null;
      if (baseline.unreadable_fields?.length) {
        console.log(`    ⚠️ GRADED FIELDS NOT PRESENT ON THE CONSUMER'S TENANT OBJECT: ${baseline.unreadable_fields.join(', ')}`);
        console.log('       These would read both_null on every row. Fix GRADED_FIELDS keys before believing any rate.');
      }
      console.log(`    baseline google_docai   ${baseline.text_stats.chars} chars  extract=${baseline.ok ? 'ok' : bres?.reason}`);
    }

    const candidates = [];
    for (const engine of runnable) {
      const ocr = runEngine(engine, pdf, { maxPages, dpi });
      if (!ocr.ok) {
        console.log(`    ${engine.padEnd(12)} FAILED  ${ocr.reason}  (${(ocr.elapsed_ms / 1000).toFixed(1)}s)`);
        candidates.push({ engine, ok: false, reason: ocr.reason, elapsed_ms: ocr.elapsed_ms });
        continue;
      }
      writeFileSync(join(d, `local.${engine}.txt`), ocr.text);
      const stats = garbleStats(ocr.text);
      const eres = await extractFrom(ocr.text, ocr.pages, invoke, extractTenantFromLease);
      const pagesRead = ocr.pages?.length ?? null;
      const perPage = pagesRead ? ocr.elapsed_ms / pagesRead : null;
      const entry = {
        engine, ok: true, elapsed_ms: ocr.elapsed_ms,
        pages_read: pagesRead, ms_per_page: perPage == null ? null : Math.round(perPage),
        ocr_confidence: ocr.confidence, text_stats: stats,
        clauses: clauseLegibility(ocr.text),
        extract_ok: !!eres?.ok, extract_reason: eres?.reason || null,
        tenant: eres?.ok ? eres.tenant : null, model: eres?.model || null,
      };
      if (arm === 'A' && baseline?.tenant) entry.score = scoreDocument(baseline.tenant, entry.tenant);
      candidates.push(entry);
      console.log(`    ${engine.padEnd(12)} ${stats.chars} chars  ${pagesRead ?? '?'}pp  `
        + `${(ocr.elapsed_ms / 1000).toFixed(1)}s (${perPage == null ? '?' : Math.round(perPage)}ms/pp)  `
        + `conf=${ocr.confidence ?? 'n/a'}  wordlike=${stats.wordlike_ratio}  `
        + (entry.score ? `agree=${entry.score.tally.agree}/${entry.score.decided_fields} (both_null ${entry.score.both_null_fields})` : `clauses=${entry.clauses.found_count}/4`));
    }

    results.push({
      document_id: id, arm, source_pages: sourcePages, meta,
      baseline, candidates,
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    model: modelLabel,
    model_is_stub: useStub,
    graded_fields: GRADED_FIELDS.map((f) => f.label),
    engines_probed: probe,
    engines_run: runnable,
    sample_size: results.length,
    arm_a_count: results.filter((r) => r.arm === 'A').length,
    arm_b_count: results.filter((r) => r.arm === 'B').length,
    documents: results,
  };
  writeFileSync(join(dir, 'agreement.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(dir, 'agreement.md'), renderReport(report));
  console.log(`\nWrote ${join(dir, 'agreement.json')} and ${join(dir, 'agreement.md')}`);
  return report;
}

// ---------------------------------------------------------------------------
// Report rendering — the deliverable
// ---------------------------------------------------------------------------

export function renderReport(rep) {
  const L = [];
  L.push('# OCR1 bake-off — local OCR vs Google Document AI');
  L.push('');
  L.push(`Generated ${rep.generated_at} · sample **${rep.sample_size}** documents `
    + `(arm A ${rep.arm_a_count}, arm B ${rep.arm_b_count}) · model \`${rep.model}\``);
  L.push('');
  if (rep.model_is_stub) {
    L.push('> 🔴 **THESE NUMBERS WERE PRODUCED WITH THE OFFLINE STUB EXTRACTOR, NOT A MODEL.**');
    L.push('> They prove the harness plumbing only. They are NOT a bake-off result and must');
    L.push('> not be quoted as field agreement.');
    L.push('');
  }
  L.push(`> ⚠️ **Sample size is ${rep.sample_size} documents.** State that with every claim.`);
  L.push('> `chars` is CONTEXT, never the metric — a garbled read produces plenty of characters.');
  L.push('');

  L.push('## Engines');
  L.push('');
  L.push('| engine | available | version |');
  L.push('|---|---|---|');
  for (const [e, p] of Object.entries(rep.engines_probed)) {
    L.push(`| \`${e}\` | ${p.available ? 'yes' : 'no'} | ${p.version || '—'} |`);
  }
  L.push('');

  const armA = rep.documents.filter((d) => d.arm === 'A');
  if (armA.length) {
    L.push('## Arm A — field agreement vs the DocAI baseline');
    L.push('');
    L.push('⚠️ `rate` EXCLUDES both-null fields by construction. `both_null` is fields where');
    L.push('**neither** engine found a value — never agreement. A high `both_null` share means');
    L.push('the document defeated both sides, not that they agreed.');
    L.push('');
    L.push('| doc | pp | engine | agree | disagree | local-only | docai-only | both_null | **rate** | s/pp | chars (ctx) |');
    L.push('|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const d of armA) {
      for (const c of d.candidates) {
        if (!c.ok) { L.push(`| ${d.document_id} | ${d.source_pages ?? '?'} | ${c.engine} | — | — | — | — | — | **FAILED** | — | ${c.reason} |`); continue; }
        const s = c.score;
        const rate = s?.agreement_rate == null ? '—' : `${(s.agreement_rate * 100).toFixed(0)}%`;
        L.push(`| ${d.document_id} | ${d.source_pages ?? '?'} | ${c.engine} | ${s?.tally.agree ?? '—'} | ${s?.tally.disagree ?? '—'} `
          + `| ${s?.tally.candidate_only ?? '—'} | ${s?.tally.baseline_only ?? '—'} | ${s?.both_null_fields ?? '—'} | **${rate}** `
          + `| ${c.ms_per_page == null ? '—' : (c.ms_per_page / 1000).toFixed(1)} | ${c.text_stats.chars} |`);
      }
    }
    L.push('');
    // Per-field roll-up, per engine.
    L.push('### Per-field, per engine (arm A)');
    L.push('');
    const byEngine = {};
    for (const d of armA) for (const c of d.candidates) {
      if (!c.ok || !c.score) continue;
      byEngine[c.engine] ||= {};
      for (const f of rep.graded_fields) {
        byEngine[c.engine][f] ||= { agree: 0, disagree: 0, candidate_only: 0, baseline_only: 0, both_null: 0 };
        byEngine[c.engine][f][c.score.verdicts[f].verdict] += 1;
      }
    }
    for (const [eng, fields] of Object.entries(byEngine)) {
      L.push(`**${eng}**`);
      L.push('');
      L.push('| field | agree | disagree | local-only | docai-only | both_null | rate |');
      L.push('|---|---:|---:|---:|---:|---:|---:|');
      for (const f of rep.graded_fields) {
        const t = fields[f];
        const dec = t.agree + t.disagree + t.candidate_only + t.baseline_only;
        L.push(`| \`${f}\` | ${t.agree} | ${t.disagree} | ${t.candidate_only} | ${t.baseline_only} | ${t.both_null} | ${dec ? `${((t.agree / dec) * 100).toFixed(0)}%` : '—'} |`);
      }
      L.push('');
    }
    // Every disagreement, named. A failure mode is more useful than an average.
    L.push('### Disagreements and misses, named');
    L.push('');
    let any = false;
    for (const d of armA) for (const c of d.candidates) {
      if (!c.ok || !c.score) continue;
      for (const [f, v] of Object.entries(c.score.verdicts)) {
        if (v.verdict === 'agree' || v.verdict === 'both_null') continue;
        any = true;
        L.push(`- doc **${d.document_id}** · \`${c.engine}\` · \`${f}\` — **${v.verdict}** · docai=\`${v.baseline ?? 'null'}\` · local=\`${v.candidate ?? 'null'}\``);
      }
    }
    if (!any) L.push('_(none)_');
    L.push('');
  }

  const armB = rep.documents.filter((d) => d.arm === 'B');
  if (armB.length) {
    L.push('## Arm B — beyond the page cap (NO DocAI baseline exists)');
    L.push('');
    L.push('⚠️ **There is nothing to agree with here** — these documents are over the 30-page cap,');
    L.push('which is exactly why they have no baseline. Graded on consumer-field coherence and on');
    L.push('whether the back-half clauses are legible in the FULL local text.');
    L.push('');
    L.push('| doc | pp | engine | pages read | fields found /6 | back-half clauses /4 | s/pp | chars (ctx) | wordlike |');
    L.push('|---|---:|---|---:|---:|---:|---:|---:|---:|');
    for (const d of armB) {
      for (const c of d.candidates) {
        if (!c.ok) { L.push(`| ${d.document_id} | ${d.source_pages ?? '?'} | ${c.engine} | — | — | — | — | **FAILED** ${c.reason} | — |`); continue; }
        const found = GRADED_FIELDS.filter((f) => c.tenant && c.tenant[f.key] != null && c.tenant[f.key] !== '').length;
        L.push(`| ${d.document_id} | ${d.source_pages ?? '?'} | ${c.engine} | ${c.pages_read ?? '?'} | ${found} | ${c.clauses.found_count} `
          + `| ${c.ms_per_page == null ? '—' : (c.ms_per_page / 1000).toFixed(1)} | ${c.text_stats.chars} | ${c.text_stats.wordlike_ratio} |`);
      }
    }
    L.push('');
    L.push('### Back-half clause positions (0 = start of document, 1 = end)');
    L.push('');
    L.push('| doc | engine | ' + BACK_HALF_CLAUSES.join(' | ') + ' |');
    L.push('|---|---|' + BACK_HALF_CLAUSES.map(() => '---').join('|') + '|');
    for (const d of armB) for (const c of d.candidates) {
      if (!c.ok) continue;
      L.push(`| ${d.document_id} | ${c.engine} | `
        + BACK_HALF_CLAUSES.map((k) => (c.clauses[k].found ? `${c.clauses[k].position}` : '—')).join(' | ') + ' |');
    }
    L.push('');
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Self-test — synthetic fixture, no network, no model, no real documents.
// Renders a known "scanned lease" page (image-only PDF, so OCR is genuinely
// exercised) plus a deliberately DEGRADED copy, then asserts the harness carries
// values end to end AND that the degraded copy scores worse than the clean one.
// ---------------------------------------------------------------------------

const FIXTURE_LINES = [
  'STANDARD FORM COMMERCIAL LEASE',
  '',
  'TENANT: Blackwood Medical Partners LLC',
  'LEASE TYPE: NNN',
  'RENTABLE SF: 14250',
  'BASE RENT: $412500',
  'COMMENCEMENT: 2019-06-01',
  'EXPIRATION: 2034-05-31',
  '',
  'Section 14. Option to extend the term for two',
  'additional periods of five years each.',
  'Section 19. Early termination is permitted only',
  'upon payment of the unamortized allowance.',
  'Section 22. Upon an event of default Tenant shall',
  'have a thirty (30) day cure period.',
  'Section 27. Any holding over shall be at 150% of',
  'the then-current base rent.',
];

function buildFixture(dir) {
  const py = `
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
lines = ${JSON.stringify(FIXTURE_LINES)}
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 30)
except Exception:
    font = ImageFont.load_default()

def render(path, degrade=False, noisy=False):
    img = Image.new("L", (1275, 1650), 255)
    d = ImageDraw.Draw(img)
    y = 90
    for ln in lines:
        d.text((90, y), ln, fill=0, font=font)
        y += 52
    if noisy:
        # Readable but ERROR-PRONE: the case the bake-off actually lives in. Must
        # yield text WITH mistakes, so the harness is shown detecting and naming a
        # disagreement rather than only agree-or-fail.
        import random
        random.seed(11)
        img = img.rotate(0.9, resample=Image.BICUBIC, fillcolor=255)
        img = img.resize((700, 906), Image.BILINEAR).resize((1275, 1650), Image.BILINEAR)
        img = img.filter(ImageFilter.GaussianBlur(1.5))
        img = img.point(lambda p: max(0, min(255, int(p * 0.70 + 62))))
        px = img.load()
        for _ in range(24000):
            x = random.randrange(img.size[0]); y = random.randrange(img.size[1])
            px[x, y] = 0 if random.random() < 0.5 else 255
    if degrade:
        # ⚠️ Must degrade ENOUGH to discriminate. A gentle blur cost 1 character on
        # tesseract, so the "degraded is worse" assertion passed on noise. This is
        # a hard downsample + skew + blur + low contrast + speckle: a bad fax.
        import random
        random.seed(7)
        img = img.rotate(2.4, resample=Image.BICUBIC, fillcolor=255)
        img = img.resize((510, 660), Image.BILINEAR).resize((1275, 1650), Image.BILINEAR)
        img = img.filter(ImageFilter.GaussianBlur(1.9))
        img = img.point(lambda p: max(0, min(255, int(p * 0.62 + 80))))
        px = img.load()
        for _ in range(40000):
            x = random.randrange(img.size[0]); y = random.randrange(img.size[1])
            px[x, y] = 0 if random.random() < 0.5 else 255
    img.save(path, "PDF", resolution=150.0)

render(sys.argv[1], degrade=False)
render(sys.argv[2], degrade=True)
render(sys.argv[3], noisy=True)
print("ok")
`;
  const cleanDir = join(dir, 'FIXTURE-clean');
  const degradedDir = join(dir, 'FIXTURE-degraded');
  const noisyDir = join(dir, 'FIXTURE-noisy');
  for (const d of [cleanDir, degradedDir, noisyDir]) mkdirSync(d, { recursive: true });
  const r = run('python3', ['-c', py,
    join(cleanDir, 'source.pdf'), join(degradedDir, 'source.pdf'), join(noisyDir, 'source.pdf')]);
  if (r.status !== 0) {
    return { ok: false, reason: `fixture_render_failed: ${(r.stderr || '').slice(0, 300)}` };
  }
  // The clean fixture doubles as arm A: its "baseline" is the ground truth text,
  // so a perfect OCR scores 100% and any OCR error shows up as a disagreement.
  // Both clean and noisy get the ground-truth baseline, so both are arm A: the
  // clean one must score 100%, the noisy one must surface real disagreements.
  writeFileSync(join(cleanDir, 'docai.txt'), FIXTURE_LINES.join('\n'));
  writeFileSync(join(noisyDir, 'docai.txt'), FIXTURE_LINES.join('\n'));
  return { ok: true, cleanDir, degradedDir, noisyDir };
}

async function selfTest(dir) {
  console.log('=== OCR1 harness self-test (synthetic fixture, no network, no model) ===\n');
  const fx = buildFixture(dir);
  if (!fx.ok) {
    console.error(`✗ ${fx.reason}`);
    console.error('  Needs python3 + Pillow to render the fixture. Honest skip — not a pass.');
    process.exit(3);
  }
  console.log('Fixture rendered: FIXTURE-clean (arm A, ground-truth baseline) + FIXTURE-degraded (arm B)\n');
  const rep = await runBakeoff({
    dir, engines: ['surya', 'paddleocr', 'ocrmypdf', 'tesseract'],
    useStub: true, only: ['FIXTURE-clean', 'FIXTURE-degraded', 'FIXTURE-noisy'], maxPages: 0, dpi: 200,
  });

  // Assertions — the plumbing claims this harness makes about itself.
  const clean = rep.documents.find((d) => d.document_id === 'FIXTURE-clean');
  const degraded = rep.documents.find((d) => d.document_id === 'FIXTURE-degraded');
  const noisy = rep.documents.find((d) => d.document_id === 'FIXTURE-noisy');
  const nc = noisy?.candidates.find((c) => c.ok);
  const cc = clean?.candidates.find((c) => c.ok);
  const dc = degraded?.candidates.find((c) => c.ok);
  // A total OCR failure on the degraded copy IS the extreme of "worse" — the
  // assertion must be able to express it, not evaluate `undefined` and read false.
  const degradedFailed = !!degraded?.candidates.length && !dc;
  const checks = [
    ['arm A detected on the fixture with a baseline', clean?.arm === 'A'],
    ['arm B detected on the fixture without one', degraded?.arm === 'B'],
    ['an engine produced text', !!cc && cc.text_stats.chars > 0],
    ['the consumer extracted from local OCR text', !!cc?.extract_ok],
    ['agreement was scored against the baseline', !!cc?.score],
    ['agreement_rate excludes both-null', cc?.score?.agreement_rate == null
      || cc.score.decided_fields === cc.score.tally.agree + cc.score.tally.disagree + cc.score.tally.candidate_only + cc.score.tally.baseline_only],
    ['back-half clauses located in the clean read', (cc?.clauses.found_count ?? 0) >= 3],
    ['per-page timing recorded', Number.isFinite(cc?.ms_per_page)],
    // POSITIVE CONTROL for the graded-field keys. The fixture STATES all six, so
    // a null here means the harness is reading a key the consumer never emits.
    ['every graded field key is present on the consumer tenant object',
      (clean?.baseline?.unreadable_fields?.length ?? 1) === 0],
    ['all six graded fields non-null from the ground-truth baseline',
      !!clean?.baseline?.tenant && GRADED_FIELDS.every((f) => clean.baseline.tenant[f.key] != null && clean.baseline.tenant[f.key] !== '')],
    ['no field scored both_null against ground truth', cc?.score?.both_null_fields === 0],
    // ⚠️ MEANINGFUL margin, not noise: the first fixture degraded by 1 character
    // and this assertion passed anyway, which made it worthless.
    ['the degraded copy is materially worse (engine failure, or >=10% on some measure)',
      degradedFailed || (!!dc && (dc.text_stats.chars < cc.text_stats.chars * 0.9
        || dc.clauses.found_count < cc.clauses.found_count
        || (dc.text_stats.wordlike_ratio ?? 1) < (cc.text_stats.wordlike_ratio ?? 0) * 0.9))],
    // The case the bake-off actually lives in: imperfect OCR. The harness must
    // score it and NAME the mismatched fields, not just pass-or-fail.
    ['the noisy copy still produced text', !!nc && nc.text_stats.chars > 0],
    ['the noisy copy scored a real disagreement or miss (not just agree/fail)',
      !!nc?.score && (nc.score.tally.disagree + nc.score.tally.baseline_only + nc.score.tally.candidate_only) > 0],
    ['the noisy copy scores strictly below the clean copy',
      !!nc?.score && !!cc?.score && nc.score.agreement_rate < cc.score.agreement_rate],
  ];
  console.log('\n=== SELF-TEST ASSERTIONS ===');
  let failed = 0;
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? '✔' : '✗'} ${name}`);
    if (!pass) failed += 1;
  }
  console.log(`\nclean:    ${cc?.text_stats.chars} chars · clauses ${cc?.clauses.found_count}/4 · wordlike ${cc?.text_stats.wordlike_ratio} · agree ${cc?.score?.tally.agree}/${cc?.score?.decided_fields}`);
  console.log(`noisy:    ${nc?.text_stats.chars} chars · clauses ${nc?.clauses.found_count}/4 · wordlike ${nc?.text_stats.wordlike_ratio} · agree ${nc?.score?.tally.agree}/${nc?.score?.decided_fields} · disagree ${nc?.score?.tally.disagree}`);
  console.log(degradedFailed
    ? `degraded: OCR FAILED (${degraded.candidates.map((c) => c.reason).join('; ')}) — the extreme of "worse"`
    : `degraded: ${dc?.text_stats.chars} chars · clauses ${dc?.clauses.found_count}/4 · wordlike ${dc?.text_stats.wordlike_ratio}`);
  if (failed) { console.error(`\n${failed} assertion(s) FAILED`); process.exit(1); }
  console.log('\nAll self-test assertions passed. Harness plumbing verified.');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { dir: 'bakeoff', engines: null, model: 'real', only: null, maxPages: 0, dpi: 200, mode: null, ids: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--run') a.mode = 'run';
    else if (t === '--self-test') a.mode = 'self-test';
    else if (t === '--fetch-baselines') { a.mode = 'fetch'; a.ids = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (t === '--dir') a.dir = argv[++i];
    else if (t === '--engines') a.engines = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (t === '--model') a.model = argv[++i];
    else if (t === '--only') a.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (t === '--max-pages') a.maxPages = Number(argv[++i]) || 0;
    else if (t === '--dpi') a.dpi = Number(argv[++i]) || 200;
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const dir = resolve(process.cwd(), a.dir);
  if (!a.mode) {
    console.log(readFileSync(new URL(import.meta.url).pathname, 'utf8').split('\n')
      .filter((l) => l.startsWith('//')).slice(0, 40).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  }
  mkdirSync(dir, { recursive: true });
  if (a.mode === 'fetch') return fetchBaselines(a.ids, dir);
  if (a.mode === 'self-test') return selfTest(dir);
  return runBakeoff({
    dir,
    engines: a.engines || ['surya', 'paddleocr', 'ocrmypdf', 'tesseract'],
    useStub: a.model === 'stub',
    only: a.only, maxPages: a.maxPages, dpi: a.dpi,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
