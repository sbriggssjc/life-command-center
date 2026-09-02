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
//   node scripts/ocr-bakeoff.mjs --run --control self
//
//   ⚠️ --control self IS NOT OPTIONAL IF YOU INTEND TO QUOTE A RATE. It runs the
//   SAME model twice on the SAME DocAI text and scores run 2 against run 1, which
//   is the FLOOR every engine rate is read against. Without it a 77% agreement
//   rate cannot be told apart from a model that disagrees with itself 23% of the
//   time on identical text. The report says so, loudly, when the control is absent.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
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
//
// ⚠️ A COMPARATOR ARTIFACT IS NOT AN OCR FINDING. OCR1's first real run scored
// 11 non-agreements over 47 fields and READING them showed four were the
// comparator, not the engines: two were `Kohl’s` vs `Kohl's` (one side emits a
// curly apostrophe, the other straight — the same tenant), two were `""` vs
// `null` (both mean "not found", scored `candidate_only`). Every rate this
// harness prints is normalized FIRST. The RAW pair is still reported on every
// disagreement (renderReport §"Disagreements and misses, named"), so a
// normalization can never hide a difference a human would call real.

/**
 * Unicode punctuation → ASCII, plus whitespace collapse. Quotes, apostrophes,
 * dashes and non-breaking spaces differ between OCR engines for reasons that
 * have nothing to do with whether the text was read correctly.
 */
export function normalizePunctuation(value) {
  return String(value)
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4\u0060]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "The source did not state this" wearing several spellings. A model returns
 * `""`, the literal string `null`, `N/A`, or a dash placeholder for the SAME
 * fact; scoring one against another reports `candidate_only` where there is no
 * disagreement at all.
 *
 * ⚠️ NARROW BY DESIGN — the measured set (`""`, `null`, `N/A`, `—`) plus the
 * dash family normalizePunctuation already collapses onto `-`. This is NOT a
 * general "looks empty" test: widening it is how a real value gets silently
 * nulled, which would inflate both_null and hide a genuine miss. Note `0` is a
 * value, never a sentinel.
 */
export function isNullSentinel(value) {
  if (value == null) return true;
  const s = normalizePunctuation(value);
  if (!s) return true;
  return /^(?:null|n\/a|-+)$/i.test(s);
}

/** Normalize one graded value for COMPARISON by type. Raw values are always reported. */
export function normalizeField(type, value) {
  if (isNullSentinel(value)) return null;
  const s = normalizePunctuation(value);
  if (type === 'number') {
    // Strip currency, thousands separators and a trailing unit ("14,250 sf").
    const n = Number(s.replace(/\bsf\b/gi, '').replace(/[$,\s]/g, ''));
    // ⚠️ ROUNDED, NOT TOLERANCED. 412500.4 and 412500 are one rent read two
    // ways; 412500 and 412600 are a DIGIT ERROR — exactly what the bake-off
    // exists to catch — and must stay a disagreement.
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  if (type === 'date') {
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : s.toLowerCase() || null;
  }
  // string (tenant name / lease type): case + punctuation + whitespace insensitive.
  const out = s.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  return out || null;
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
 * THE FLOOR. Roll up the per-document self-control scores — the SAME model run
 * twice on the SAME DocAI text — into a per-field self-agreement rate.
 *
 * ⚠️ AN ENGINE'S RATE MEANS NOTHING WITHOUT THIS ROW. OCR1's first run reported
 * 77% tesseract-vs-DocAI field agreement over 10 documents and the number had no
 * interpretation: 2 of the 11 non-agreements were MODEL arithmetic on text both
 * sides carried verbatim, and 4 date disagreements were "cause UNKNOWN without a
 * model self-agreement control". If the model disagrees with itself 20% of the
 * time on identical text, a 77% engine rate is a WIN, not a loss.
 *
 * ⚠️ TWO INDEPENDENT CALLS, NOT temperature=0. The point is to measure the model
 * AS THE HARNESS USES IT. Pinning the seed would measure a configuration nobody
 * runs and report a floor of 100% that the real pipeline never achieves.
 *
 * `self_disagree` folds `disagree` + `candidate_only` + `baseline_only`: run 2
 * finding a value run 1 did not is the model failing to agree with itself. The
 * raw four-way tally survives in the JSON. `both_null` is EXCLUDED from the
 * denominator, exactly as it is for the engines, so the two rates are comparable.
 */
export function summarizeSelfControl(scores, fields = GRADED_FIELDS) {
  const perField = {};
  for (const f of fields) {
    perField[f.label] = { self_agree: 0, self_disagree: 0, self_both_null: 0, self_rate: null };
  }
  const used = (scores || []).filter(Boolean);
  for (const sc of used) {
    for (const f of fields) {
      const v = sc.verdicts?.[f.label]?.verdict;
      if (!v) continue;
      const slot = perField[f.label];
      if (v === 'agree') slot.self_agree += 1;
      else if (v === 'both_null') slot.self_both_null += 1;
      else slot.self_disagree += 1;
    }
  }
  let agree = 0; let disagree = 0; let bothNull = 0;
  for (const f of fields) {
    const t = perField[f.label];
    const decided = t.self_agree + t.self_disagree;
    // ⚠️ null, never 1.0 — a field both runs left null was not measured (the
    // both-null trap, one layer up).
    t.self_rate = decided ? t.self_agree / decided : null;
    agree += t.self_agree; disagree += t.self_disagree; bothNull += t.self_both_null;
  }
  const decided = agree + disagree;
  return {
    documents: used.length,
    per_field: perField,
    overall: {
      self_agree: agree,
      self_disagree: disagree,
      self_both_null: bothNull,
      self_rate: decided ? agree / decided : null,
    },
  };
}

/**
 * An engine rate read against the floor, in PERCENTAGE POINTS.
 *
 * ⚠️ Returns null — never 0 — when either side has no decided field. 0 reads as
 * "at parity with the model"; the truth is "not measured" (P180: NULL is not
 * zero, and a lane summary is where that bites).
 */
export function deltaVsSelf(rate, selfRate) {
  if (rate == null || selfRate == null) return null;
  return Number(((rate - selfRate) * 100).toFixed(1));
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

/**
 * ⚠️ SHOW THE END OF stderr, NEVER THE BEGINNING. The first real run reported 36
 * engine failures whose printed reason was a `RequestsDependencyWarning` — the
 * first line every one of them emits — which hid BOTH real causes (surya: the
 * Docker daemon was not running; paddleocr: `paddlepaddle` was not installed).
 * A tool writes its warnings first and its cause last.
 */
export function stderrTail(text, n = 300) {
  const s = String(text || '').replace(/\s+$/, '');
  if (!s.trim()) return '';
  return s.length <= n ? s : `…${s.slice(-n)}`;
}

/**
 * Decide whether an engine can actually run here, from FACTS gathered by the
 * caller. Pure so it can be graded without a machine that has (or lacks) any of
 * these — the two states that cost the first run 36 failures are the two the
 * probe could not previously express.
 *
 * ⚠️ `paddleocr --version` SUCCEEDING DOES NOT MEAN THE ENGINE WORKS.
 * `pip install paddleocr` installs the WRAPPER; the engine is `paddlepaddle`,
 * a separate package. Without it every document fails at import.
 *
 * ⚠️ A tri-state is required, not a boolean: `paddleRuntime === null` means we
 * could not check (no python on PATH) and must NOT be read as "not installed".
 */
export function classifyEngineAvailability(engine, facts = {}) {
  const {
    binaryPresent, rasterizerPresent, paddleRuntime, suryaNeedsServer, dockerReachable,
  } = facts;
  if (!binaryPresent) return { available: false, note: 'not installed' };
  if (engine === 'tesseract' && rasterizerPresent === false) {
    return { available: false, note: 'missing pdftoppm (poppler-utils) — cannot rasterize a PDF' };
  }
  if (engine === 'paddleocr') {
    if (paddleRuntime === false) {
      return {
        available: false,
        note: 'wrapper only — `paddleocr` is on PATH but the `paddle` runtime is not: pip install paddlepaddle',
      };
    }
    if (paddleRuntime == null) {
      return { available: true, note: 'paddle runtime UNVERIFIED (no python on PATH) — may fail at import' };
    }
  }
  if (engine === 'surya' && suryaNeedsServer) {
    if (dockerReachable === false) {
      return {
        available: false,
        note: 'runs a VLM server via Docker — Docker daemon not reachable; intended for the GPU box',
      };
    }
    return { available: true, note: 'runs a VLM server via Docker — intended for the GPU box' };
  }
  return { available: true, note: null };
}

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
    const binaryPresent = binaryAvailable(bin);
    const facts = { binaryPresent };
    const entry = { binary: bin, version: binaryPresent ? binaryVersion(bin) : null };
    if (engine === 'tesseract') {
      facts.rasterizerPresent = binaryAvailable('pdftoppm');
      entry.needs = 'pdftoppm';
      entry.rasterizer_available = facts.rasterizerPresent;
    }
    if (engine === 'paddleocr' && binaryPresent) {
      facts.paddleRuntime = pythonModuleImportable('paddle');
      entry.paddle_runtime = facts.paddleRuntime;
    }
    if (engine === 'surya' && binaryPresent) {
      facts.suryaNeedsServer = suryaNeedsServer();
      entry.needs_vlm_server = facts.suryaNeedsServer;
      if (facts.suryaNeedsServer) {
        facts.dockerReachable = dockerReachable();
        entry.docker_reachable = facts.dockerReachable;
      }
    }
    const verdict = classifyEngineAvailability(engine, facts);
    entry.available = verdict.available;
    entry.note = verdict.note;
    out[engine] = entry;
  }
  return out;
}

/**
 * Can this machine `import <mod>` in python? Returns null — NOT false — when
 * there is no python on PATH: "we could not check" and "it is missing" are
 * different facts and must not read the same.
 */
function pythonModuleImportable(mod) {
  for (const py of ['python3', 'python']) {
    const r = spawnSync(py, ['-c', `import ${mod}`], { encoding: 'utf8' });
    if (r.error && r.error.code === 'ENOENT') continue;
    return r.status === 0;
  }
  return null;
}

/** Does this surya build drive a VLM server (vllm / llama.cpp) rather than run in-process? */
function suryaNeedsServer() {
  const r = spawnSync('surya_ocr', ['--help'], { encoding: 'utf8' });
  if (r.error) return false;
  return /vllm|llama[._]?cpp|ocr[_-]?server/i.test(`${r.stdout || ''}${r.stderr || ''}`);
}

function dockerReachable() {
  const r = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 15000 });
  if (r.error) return false;
  return r.status === 0;
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
  if (ppm.status !== 0) return { ok: false, reason: `pdftoppm_exit_${ppm.status}:${stderrTail(ppm.stderr)}` };

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
    return { ok: false, reason: `ocrmypdf_exit_${r.status}:${stderrTail(r.stderr)}` };
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
  if (!js) return { ok: false, reason: `surya_no_output:${stderrTail(r.stderr)}` };
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
  if (!text) return { ok: false, reason: `paddleocr_no_text:${stderrTail(r.stderr)}` };
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
  const quotedDate = (d) => (d ? { date: d, as_stated: d, precision: 'day' } : { date: null, as_stated: null, precision: null });
  const out = {
    tenant_name: pick(/TENANT:\s*([^\n]+)/i),
    guarantor: null,
    suite: null,
    leased_sf: num(pick(/RENTABLE (?:AREA|SF):\s*([\d,]+)/i)),
    lease_type: pick(/LEASE TYPE:\s*([A-Za-z]+)/i),
    // EXT1: the consumer takes a QUOTED rent (amount + the basis the lease
    // states it on) and QUOTED dates (a date only at day precision), and does
    // the annualization and any term arithmetic itself. The stub emits that
    // shape so --self-test exercises the path production runs, not a legacy one.
    base_rent: (() => {
      const stated = pick(/((?:YEAR 1 |ANNUAL )?BASE RENT:\s*\$?[\d,]+(?:\s*PER (?:MONTH|YEAR|SF))?)/i);
      const amount = num(pick(/(?:YEAR 1 |ANNUAL )?BASE RENT:\s*\$?([\d,]+)/i));
      if (amount == null) return null;
      const perMonth = /BASE RENT:[^\n]*PER MONTH/i.test(text);
      return { amount, basis: perMonth ? 'monthly' : 'annual', as_stated: stated };
    })(),
    escalation_pct: null,
    lease_commencement: quotedDate(pick(/COMMENCEMENT(?: DATE)?:\s*(\d{4}-\d{2}-\d{2})/i)),
    lease_expiration: quotedDate(pick(/EXPIRATION(?: DATE)?:\s*(\d{4}-\d{2}-\d{2})/i)),
    lease_term: null,
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
  const { dir, engines, useStub, only, maxPages, dpi, control } = opts;
  const probe = probeEngines();
  const runnable = engines.filter((e) => probe[e]?.available);

  console.log('\n=== ENGINES ===');
  for (const [e, p] of Object.entries(probe)) {
    const mark = p.available ? '✔' : '✗';
    // ⚠️ The NOTE is the deliverable when an engine cannot run — "not installed"
    // on a binary that IS on PATH is what produced 36 identical failures.
    const note = p.note ? `  — ${p.note}` : '';
    console.log(`  ${mark} ${e.padEnd(10)} ${p.version || ''}${note}`);
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
    let control_run = null;
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

      // ⚠️ THE CONTROL: the SAME model, the SAME prompt, the SAME DocAI text,
      // a SECOND independent call — scored with the SAME scoreDocument. This is
      // the floor every engine rate below is read against. Without it a raw
      // agreement percentage is uninterpretable (OCR1 §2).
      if (control === 'self' && baseline.ok && baseline.tenant) {
        const cres = await extractFrom(btext, bpages, invoke, extractTenantFromLease);
        control_run = {
          ok: !!cres?.ok, reason: cres?.reason || null,
          tenant: cres?.ok ? cres.tenant : null, model: cres?.model || null,
          score: cres?.ok ? scoreDocument(baseline.tenant, cres.tenant) : null,
        };
        const cs = control_run.score;
        console.log(`    self-control  run2 of the same model on the same text  `
          + (cs ? `agree=${cs.tally.agree}/${cs.decided_fields} (both_null ${cs.both_null_fields})`
            : `extract=${control_run.reason}`));
      } else if (control === 'self') {
        control_run = { ok: false, reason: 'baseline_extract_failed', tenant: null, model: null, score: null };
      }
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
      // ⚠️ ARM B HAS NO BASELINE, SO A COUNT IS ALL IT CAN REPORT — AND A COUNT
      // CANNOT BE READ. "5/6 fields found" at OCR confidence 68 on a title/docs
      // bundle is indistinguishable from 5/6 on a clean lease until somebody
      // reads the VALUES. They already exist in memory; carry them out.
      // (`bakeoff/` is git-ignored — these are client lease values and never
      // leave the box. The response/ copy stays values-free.)
      entry.graded_values = Object.fromEntries(
        GRADED_FIELDS.map((f) => [f.label, entry.tenant?.[f.key] ?? null]),
      );
      entry.fields_found = GRADED_FIELDS.filter((f) => !isNullSentinel(entry.tenant?.[f.key])).length;
      candidates.push(entry);
      console.log(`    ${engine.padEnd(12)} ${stats.chars} chars  ${pagesRead ?? '?'}pp  `
        + `${(ocr.elapsed_ms / 1000).toFixed(1)}s (${perPage == null ? '?' : Math.round(perPage)}ms/pp)  `
        + `conf=${ocr.confidence ?? 'n/a'}  wordlike=${stats.wordlike_ratio}  `
        + (entry.score ? `agree=${entry.score.tally.agree}/${entry.score.decided_fields} (both_null ${entry.score.both_null_fields})` : `clauses=${entry.clauses.found_count}/4`));
    }

    results.push({
      document_id: id, arm, source_pages: sourcePages, meta,
      baseline, control: control_run, candidates,
    });
  }

  const controlScores = results.filter((r) => r.arm === 'A').map((r) => r.control?.score || null);
  const report = {
    generated_at: new Date().toISOString(),
    model: modelLabel,
    model_is_stub: useStub,
    control_mode: control || 'none',
    self_control: control === 'self' ? summarizeSelfControl(controlScores) : null,
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
  L.push('| engine | available | version | note |');
  L.push('|---|---|---|---|');
  for (const [e, p] of Object.entries(rep.engines_probed)) {
    L.push(`| \`${e}\` | ${p.available ? 'yes' : 'no'} | ${p.version || '—'} | ${p.note || '—'} |`);
  }
  L.push('');

  // -------------------------------------------------------------------------
  // THE FLOOR, printed ABOVE the engine tables on purpose. A reader who meets a
  // 77% engine rate before meeting the model's own self-agreement has already
  // formed an opinion the number cannot support.
  // -------------------------------------------------------------------------
  L.push('## Model self-agreement control — the floor');
  L.push('');
  if (rep.control_mode !== 'self') {
    L.push('🔴 **NOT RUN** (`--control self` was not passed). There is no floor, so every');
    L.push('engine rate below is UNINTERPRETABLE: a disagreement between the DocAI text and');
    L.push('the local text may be the OCR or may be the model, and nothing here can tell them');
    L.push('apart. Re-run with `--control self` before quoting any rate.');
    L.push('');
  } else {
    const sc = rep.self_control;
    L.push('The SAME model, the SAME prompt, the SAME DocAI text, run TWICE and scored with the');
    L.push('SAME comparator. **An engine\'s rate is only meaningful relative to this row.**');
    L.push('');
    L.push('⚠️ Two independent calls — deliberately NOT `temperature=0`. This measures the model');
    L.push('as the harness uses it; pinning a seed would report a 100% floor the pipeline never has.');
    L.push('');
    if (rep.model_is_stub) {
      L.push('> 🔴 The stub extractor is DETERMINISTIC, so this control is 100% by construction.');
      L.push('> It proves the control is plumbed end to end and is NOT a measurement of any model.');
      L.push('');
    }
    L.push(`Documents controlled: **${sc?.documents ?? 0}**`);
    L.push('');
    L.push('| field | self-agree | self-disagree | both_null | **self-rate** |');
    L.push('|---|---:|---:|---:|---:|');
    for (const f of rep.graded_fields) {
      const t = sc?.per_field?.[f];
      const rate = t?.self_rate == null ? '—' : `${(t.self_rate * 100).toFixed(0)}%`;
      L.push(`| \`${f}\` | ${t?.self_agree ?? 0} | ${t?.self_disagree ?? 0} | ${t?.self_both_null ?? 0} | **${rate}** |`);
    }
    const ov = sc?.overall;
    L.push(`| **all fields** | ${ov?.self_agree ?? 0} | ${ov?.self_disagree ?? 0} | ${ov?.self_both_null ?? 0} `
      + `| **${ov?.self_rate == null ? '—' : `${(ov.self_rate * 100).toFixed(0)}%`}** |`);
    L.push('');
    L.push('⚠️ A field whose self-rate is `—` was never decided by either run: it has no floor,');
    L.push('so the engine rate for that field cannot be read either.');
    L.push('');
  }

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
      L.push('| field | agree | disagree | local-only | docai-only | both_null | rate | **rate − self** |');
      L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
      for (const f of rep.graded_fields) {
        const t = fields[f];
        const dec = t.agree + t.disagree + t.candidate_only + t.baseline_only;
        const rate = dec ? t.agree / dec : null;
        const selfRate = rep.self_control?.per_field?.[f]?.self_rate ?? null;
        // ⚠️ null renders as `—` ("no floor / not measured"), never as 0 ("at parity").
        const delta = deltaVsSelf(rate, selfRate);
        const deltaCell = delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} pp`;
        L.push(`| \`${f}\` | ${t.agree} | ${t.disagree} | ${t.candidate_only} | ${t.baseline_only} | ${t.both_null} `
          + `| ${rate == null ? '—' : `${(rate * 100).toFixed(0)}%`} | **${deltaCell}** |`);
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
        const found = c.fields_found ?? GRADED_FIELDS.filter((f) => !isNullSentinel(c.tenant?.[f.key])).length;
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
    // ⚠️ THE VALUES, NOT THE COUNT. A "fields found /6" score is not readable —
    // a garbled read that produces six plausible-looking wrong values scores the
    // same as a clean one. This table is the only way to tell them apart, and it
    // is why doc 407 (5/6 at confidence 68) needed a human eye.
    L.push('### Field values as read (arm B — no baseline exists to check them against)');
    L.push('');
    L.push('⚠️ Nothing here is verified. These are what the consumer returned from the local');
    L.push('text; read them for plausibility. A confident-looking value from a poor scan is the');
    L.push('failure mode a count cannot show.');
    L.push('');
    L.push('| doc | engine | ocr conf | ' + rep.graded_fields.join(' | ') + ' |');
    L.push('|---|---|---:|' + rep.graded_fields.map(() => '---').join('|') + '|');
    for (const d of armB) for (const c of d.candidates) {
      if (!c.ok) continue;
      const vals = rep.graded_fields.map((f) => {
        const v = c.graded_values?.[f];
        return v == null || v === '' ? '—' : String(v).replace(/\|/g, '\\|').slice(0, 60);
      });
      L.push(`| ${d.document_id} | ${c.engine} | ${c.ocr_confidence ?? '—'} | ${vals.join(' | ')} |`);
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
  if (r.error?.code === 'ENOENT') {
    return { ok: false, reason: 'python3 is not on PATH', fix: 'install Python 3 and put python3 on PATH' };
  }
  if (r.status !== 0) {
    const err = stderrTail(r.stderr);
    // ⚠️ NAME THE FIX, not just the failure. The first real run's --self-test on
    // Windows reported the missing dependency honestly and stopped there, so the
    // operator had to go read the traceback to learn it was one pip install.
    const fix = /No module named ['"]?PIL/i.test(err)
      ? 'pip install pillow'
      : 'render the fixture manually, or run --self-test on a box with python3 + Pillow';
    return { ok: false, reason: `fixture_render_failed: ${err}`, fix };
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
    console.error(`  FIX: ${fx.fix}`);
    process.exit(3);
  }
  console.log('Fixture rendered: FIXTURE-clean (arm A, ground-truth baseline) + FIXTURE-degraded (arm B)\n');
  const rep = await runBakeoff({
    dir, engines: ['surya', 'paddleocr', 'ocrmypdf', 'tesseract'],
    useStub: true, only: ['FIXTURE-clean', 'FIXTURE-degraded', 'FIXTURE-noisy'], maxPages: 0, dpi: 200,
    // ⚠️ The self-control runs here too — but the stub is DETERMINISTIC, so it
    // scores 100% by construction. That proves the plumbing carries a control
    // end to end; it says NOTHING about the real model's floor.
    control: 'self',
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
    // --- the OCR1c control -------------------------------------------------
    // ⚠️ These prove the control is PLUMBED, not that any floor is 100%. The
    // stub extractor is deterministic, so it agrees with itself by construction.
    ['the self-agreement control ran on every arm-A document',
      rep.control_mode === 'self'
      && rep.documents.filter((d) => d.arm === 'A').every((d) => !!d.control?.score)],
    ['the control is scored with the SAME comparator as the engines (both_null excluded)',
      !!clean?.control?.score
      && clean.control.score.decided_fields === clean.control.score.tally.agree
        + clean.control.score.tally.disagree + clean.control.score.tally.candidate_only
        + clean.control.score.tally.baseline_only],
    ['the report carries a per-field self-rate for every graded field',
      !!rep.self_control && GRADED_FIELDS.every((f) => f.label in rep.self_control.per_field)],
    ['the deterministic stub agrees with itself (plumbing only, NOT a model floor)',
      rep.self_control?.overall?.self_rate === 1],
    // --- arm B values ------------------------------------------------------
    ['arm B carries the field VALUES, not only a count',
      rep.documents.filter((d) => d.arm === 'B').every((d) => d.candidates.every(
        (c) => !c.ok || (c.graded_values && GRADED_FIELDS.every((f) => f.label in c.graded_values)))) ],
  ];
  console.log('\n=== SELF-TEST ASSERTIONS ===');
  let failed = 0;
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? '✔' : '✗'} ${name}`);
    if (!pass) failed += 1;
  }
  const sr = rep.self_control?.overall?.self_rate;
  console.log(`\ncontrol:  model self-agreement floor ${sr == null ? '—' : `${(sr * 100).toFixed(0)}%`} `
    + `over ${rep.self_control?.documents ?? 0} arm-A docs (STUB — deterministic, plumbing only)`);
  console.log(`clean:    ${cc?.text_stats.chars} chars · clauses ${cc?.clauses.found_count}/4 · wordlike ${cc?.text_stats.wordlike_ratio} · agree ${cc?.score?.tally.agree}/${cc?.score?.decided_fields}`);
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
  const a = { dir: 'bakeoff', engines: null, model: 'real', only: null, maxPages: 0, dpi: 200, mode: null, ids: null, control: null };
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
    else if (t === '--control') a.control = String(argv[++i] || '').trim() || null;
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const dir = resolve(process.cwd(), a.dir);
  if (!a.mode) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
      .filter((l) => l.startsWith('//')).slice(0, 40).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  }
  mkdirSync(dir, { recursive: true });
  if (a.mode === 'fetch') return fetchBaselines(a.ids, dir);
  if (a.mode === 'self-test') return selfTest(dir);
  if (a.control && a.control !== 'self') {
    console.error(`Unknown --control mode '${a.control}'. The only mode is 'self'.`);
    process.exit(2);
  }
  return runBakeoff({
    dir,
    engines: a.engines || ['surya', 'paddleocr', 'ocrmypdf', 'tesseract'],
    useStub: a.model === 'stub',
    only: a.only, maxPages: a.maxPages, dpi: a.dpi, control: a.control,
  });
}

// ⚠️ Windows: process.argv[1] is `C:\\...\\ocr-bakeoff.mjs` while import.meta.url is
// `file:///C:/...`, so a string compare NEVER matches and main() silently never
// runs — every command exits 0 having done nothing (bit us 2026-09-02 on the
// first real run). Compare URL to URL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
