#!/usr/bin/env node
// ============================================================================
// scripts/voice-distill.mjs — W10 voice-profile distiller
//   Stage 1  (Prompt 100): openings-only corpus (~255-char Graph bodyPreview).
//   Stage 1+ (Prompt 117): FULL BODIES. Sign-offs, paragraph shape and long-form
//                          structure are now IN the data, so they are extracted
//                          rather than inferred.
//
// ON-PREM PRIVACY DOCTRINE (non-negotiable): Scott's decade of client mail NEVER
// leaves the box. This script talks to OLLAMA DIRECTLY (OLLAMA_URL) — there is NO
// cloud fallback path here, unlike invokeExtractionAI. If OLLAMA_URL is unset it
// REFUSES to distill rather than risk a cloud round-trip. Run it on the GaryBuilt
// box (or a host tunneled to its ollama), never on a cloud runner.
//
// It is analysis-only: it writes a JSON attributes file for a human to fold into
// BRIGGS-WRITING-VOICE.md. It never sends anything, never mutates the corpus.
//
// TWO LAYERS, and layer 1 needs no model at all:
//   1. DETERMINISTIC shape stats per bucket (sign-off frequency table, paragraph
//      and sentence shape, long-form share, list usage). Regex + arithmetic only,
//      so `--stats-only` produces real, citable evidence with zero egress and zero
//      model. This is what the regenerated profile's sign-off / long-form sections
//      are built on.
//   2. QUALITATIVE distill on a BOUNDED STRATIFIED SAMPLE via local ollama, for
//      the things counting cannot express (transitions, how he builds a
//      multi-paragraph update, what he never does at length). Every claim must
//      cite a verbatim excerpt; excerpts that are not a literal substring of the
//      sample are DROPPED, not trusted.
//
// Anything written to disk is run through `redactExcerpt` — the model may see the
// real text on-prem, but the artifact that a human folds into a committed doc
// must not carry a third party's contact details or a live deal number.
//
// Usage (on the box / a host with OLLAMA_URL pointed at it):
//   node scripts/voice-distill.mjs --stats-only          # deterministic only, no model
//   node scripts/voice-distill.mjs --dry-run             # + print the prompts, still no model
//   OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5:14b \
//     node scripts/voice-distill.mjs                     # full distill
//   node scripts/voice-distill.mjs --bucket external_follow_up --sample 30
//   node scripts/voice-distill.mjs --out docs/os/voice/briggs-voice-attributes.json
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvForScripts } from './_env-file.mjs';
import {
  cleanEmailBodyDetailed, classifyDraftType, pickBestBody,
  voiceCorpusExclusion, bodyShape, redactExcerpt,
} from '../api/_shared/voice-corpus-clean.js';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const STATS_ONLY = argv.includes('--stats-only');
const DRY_RUN = argv.includes('--dry-run');
const ONE_BUCKET = arg('--bucket', null);
const SAMPLE = Number(arg('--sample', '24'));
const LONGFORM_SAMPLE = Number(arg('--longform-sample', '10'));
// Bound what any single exemplar can contribute to a prompt. A few bodies run to
// 200k+ chars; feeding one wholesale would crowd out every other exemplar.
const PER_SAMPLE_CHARS = Number(arg('--sample-chars', '1800'));
const OUT = arg('--out', 'docs/os/voice/briggs-voice-attributes.json');

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;

const OLLAMA_URL = String(process.env.OLLAMA_URL || env.OLLAMA_URL || '').trim().replace(/\/+$/, '');
const OLLAMA_MODEL = String(process.env.OLLAMA_MODEL || env.OLLAMA_MODEL || 'qwen2.5:14b').trim();

// Scott's authored-from addresses (verified live 2026-08-13, re-verified 2026-08-18
// — no other spelling carries a material body count). Family "hbriggs"/
// "ellentbriggs" are deliberately excluded — different people.
const SCOTT_FROM = new Set([
  'sabriggs@northmarq.com',
  'teambriggs@northmarq.com',
  'sbriggs@stanjohnsonco.com',
  'teambriggs@stanjohnsonco.com',
]);

async function rest(pathq) {
  const res = await fetch(`${OPS_URL}/rest/v1/${pathq}`, {
    headers: { apikey: OPS_KEY, Authorization: `Bearer ${OPS_KEY}` },
  });
  const text = await res.text();
  try { return text ? JSON.parse(text) : []; } catch { return []; }
}

// PostgREST caps at 1000 rows/page — stride at 1000 (footgun in CLAUDE.md).
async function pageAll(build) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await rest(build(offset, 1000));
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

function normFrom(x) { return String(x || '').toLowerCase(); }

async function loadCorpus() {
  // activity_events (2022→now) — the long-range source. Still ~255-char previews:
  // the full bodies live in email_bodies, so this leg is the openings-era tail.
  const ae = await pageAll((o, l) =>
    `activity_events?select=body,title,metadata,occurred_at` +
    `&source_type=in.(outlook,outlook_sent,outlook_tagged)` +
    `&body=not.is.null&order=occurred_at.desc&offset=${o}&limit=${l}`);
  // email_bodies — the full-body store (Prompt 110/114/116 sweep). body_html is
  // the shape that actually landed; body_text stays selected for forward compat.
  const eb = await pageAll((o, l) =>
    `email_bodies?select=body_preview,body_text,body_html,subject,from_email,to_emails,cc_emails,sent_at,received_at,internet_message_id` +
    `&order=received_at.desc&offset=${o}&limit=${l}`);

  const seen = new Set();
  const rows = [];
  const excluded = { not_scott_from: 0, duplicate: 0, empty_body: 0 };
  const push = (imid, raw, subject, from, toEmails, ccEmails, ts, source) => {
    if (!SCOTT_FROM.has(normFrom(from))) { excluded.not_scott_from += 1; return; }
    if (!raw) { excluded.empty_body += 1; return; }
    const key = imid || 'body:' + String(raw).slice(0, 80);
    if (seen.has(key)) { excluded.duplicate += 1; return; }
    seen.add(key);

    const { cleaned, signoff, chars_before_clean, chars_after_clean } = cleanEmailBodyDetailed(raw);
    // P117: `from_email` is NOT proof of authorship on this store — the app's own
    // briefings and inbound mail filed under Scott's address both carry it.
    const reason = voiceCorpusExclusion({ cleaned, subject, toEmails, ccEmails, fromEmail: from });
    if (reason) { excluded[reason] = (excluded[reason] || 0) + 1; return; }

    const { bucket, audience } = classifyDraftType({ cleaned, subject, toEmails, fromEmail: from });
    rows.push({
      cleaned, subject, audience, bucket, ts, source, signoff,
      shape: bodyShape(cleaned),
      raw_chars: chars_before_clean,
      kept_chars: chars_after_clean,
    });
  };
  // P117 ORDER MATTERS: dedup is first-wins on internet_message_id, and the two
  // stores OVERLAP on the May-2026→now window. `email_bodies` therefore MUST be
  // drained FIRST — otherwise the ~255-char activity_events preview of a message
  // claims the key and its own FULL body is discarded as a duplicate, which would
  // have quietly cancelled most of this prompt's upgrade.
  for (const r of eb) {
    // P117 fix: Stage 1 passed `body_preview` straight through, so it could never
    // have seen a full body even after the sweep landed. Route through pickBestBody.
    const raw = pickBestBody({ body_text: r.body_text, body_html: r.body_html, body_preview: r.body_preview });
    push(r.internet_message_id, raw, r.subject, r.from_email, r.to_emails || [], r.cc_emails || [], r.sent_at || r.received_at, 'email_bodies');
  }
  for (const r of ae) {
    const m = r.metadata || {};
    const raw = pickBestBody({ body_text: m.body_text, body_html: m.body_html, body: r.body });
    push(m.internet_message_id, raw, r.title, m.from_email, m.to_emails || [], m.cc_emails || [], r.occurred_at, 'activity_events');
  }
  return { rows, excluded };
}

function bucketStats(rows) {
  const by = {};
  for (const r of rows) (by[r.bucket] ||= []).push(r);
  return by;
}

// ---------------------------------------------------------------------------
// LAYER 1 — deterministic shape evidence (NO model, NO egress)
// ---------------------------------------------------------------------------

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function avg(nums, dp = 1) {
  if (!nums.length) return 0;
  const p = 10 ** dp;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * p) / p;
}

/**
 * Everything the profile's sign-off / paragraph / long-form sections can claim
 * WITHOUT a model. Counts are the evidence; the profile quotes them directly.
 */
export function deterministicShapeStats(pool) {
  const full = pool.filter((r) => r.raw_chars > 300);   // past the old preview cap
  const long = pool.filter((r) => r.shape.is_long_form);
  const signoffs = {};
  for (const r of pool) {
    const key = r.signoff ? r.signoff.replace(/[,.!]\s*$/, '').toLowerCase() : '(none)';
    signoffs[key] = (signoffs[key] || 0) + 1;
  }
  const withSignoff = pool.filter((r) => r.signoff).length;
  return {
    n: pool.length,
    n_full_body: full.length,
    full_body_share_pct: pool.length ? Math.round((full.length / pool.length) * 1000) / 10 : 0,
    n_long_form: long.length,
    // Retention: how much of the raw body was Scott's own prose. The single most
    // load-bearing number for "is the cleaner doing its job on a full body".
    avg_raw_chars: Math.round(avg(pool.map((r) => r.raw_chars), 0)),
    avg_kept_chars: Math.round(avg(pool.map((r) => r.kept_chars), 0)),
    kept_share_pct: (() => {
      const rawSum = pool.reduce((a, r) => a + r.raw_chars, 0);
      const keptSum = pool.reduce((a, r) => a + r.kept_chars, 0);
      return rawSum ? Math.round((keptSum / rawSum) * 1000) / 10 : 0;
    })(),
    median_kept_chars: median(pool.map((r) => r.kept_chars)),
    avg_words: avg(pool.map((r) => r.shape.words)),
    avg_sentences: avg(pool.map((r) => r.shape.sentences)),
    avg_words_per_sentence: avg(pool.map((r) => r.shape.words_per_sentence)),
    avg_paragraphs: avg(pool.map((r) => r.shape.paragraphs)),
    avg_words_per_paragraph: avg(pool.map((r) => r.shape.words_per_paragraph)),
    avg_first_paragraph_words: avg(pool.map((r) => r.shape.first_paragraph_words)),
    signoff_rate_pct: pool.length ? Math.round((withSignoff / pool.length) * 1000) / 10 : 0,
    signoff_forms: Object.fromEntries(Object.entries(signoffs).sort((a, b) => b[1] - a[1])),
    uses_list_pct: pool.length ? Math.round((pool.filter((r) => r.shape.uses_list).length / pool.length) * 1000) / 10 : 0,
    exclamation_rate_pct: pool.length ? Math.round((pool.filter((r) => r.shape.exclamations > 0).length / pool.length) * 1000) / 10 : 0,
    // Long-form only: the structure Stage 1 structurally could not observe.
    long_form: long.length ? {
      n: long.length,
      avg_paragraphs: avg(long.map((r) => r.shape.paragraphs)),
      avg_words: avg(long.map((r) => r.shape.words)),
      avg_first_paragraph_words: avg(long.map((r) => r.shape.first_paragraph_words)),
      uses_list_pct: Math.round((long.filter((r) => r.shape.uses_list).length / long.length) * 1000) / 10,
      signoff_rate_pct: Math.round((long.filter((r) => r.signoff).length / long.length) * 1000) / 10,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// Bounded STRATIFIED sampling — never feed the pool wholesale
// ---------------------------------------------------------------------------

/**
 * Stratify by LENGTH (short reply / mid / long-form) and then by RECENCY inside
 * each stratum, so a bucket dominated by one-liners still contributes long-form
 * exemplars and a 2023 habit is not read as current. Deterministic (no RNG), so
 * two runs over the same corpus produce the same sample.
 */
export function stratifiedSample(pool, k) {
  if (pool.length <= k) return [...pool];
  const strata = [
    pool.filter((r) => r.kept_chars < 200),
    pool.filter((r) => r.kept_chars >= 200 && r.kept_chars < 400),
    pool.filter((r) => r.kept_chars >= 400),
  ].map((s) => [...s].sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || ''))));

  const out = [];
  const want = strata.map((s) => (s.length ? Math.max(1, Math.round((k * s.length) / pool.length)) : 0));
  for (let i = 0; i < strata.length; i += 1) out.push(...strata[i].slice(0, want[i]));
  // Top up / trim to exactly k, newest-first across whatever is left.
  if (out.length < k) {
    const chosen = new Set(out);
    const rest = pool.filter((r) => !chosen.has(r))
      .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    out.push(...rest.slice(0, k - out.length));
  }
  return out.slice(0, k);
}

function clip(text, n) {
  const t = String(text || '');
  return t.length <= n ? t : `${t.slice(0, n)} …[truncated]`;
}

// ---------------------------------------------------------------------------
// LAYER 2 — on-prem qualitative distill
// ---------------------------------------------------------------------------

async function callOllama(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {}),
      ...(process.env.CF_ACCESS_CLIENT_ID ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID } : {}),
      ...(process.env.CF_ACCESS_CLIENT_SECRET ? { 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET } : {}),
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: 'json',
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content: 'You are a writing-style analyst. Output ONLY valid JSON. Every claimed pattern MUST cite a verbatim excerpt from the provided emails — never invent an example. If a field has no evidence, use null or an empty array.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const j = await res.json().catch(() => ({}));
  const content = j?.message?.content || '';
  try { return JSON.parse(content); } catch { return { _raw: content }; }
}

function numberedSamples(samples) {
  return samples
    .map((s, i) => `--- EMAIL #${i + 1} (${s.audience}, ${s.shape.words} words, ${s.shape.paragraphs} paragraph(s)${s.signoff ? `, sign-off "${s.signoff}"` : ', no sign-off'}) ---\n${clip(s.cleaned, PER_SAMPLE_CHARS)}`)
    .join('\n\n');
}

/** Base style pass — the Stage-1 attributes, now read off whole emails. */
export function distillPrompt(bucket, samples, stats) {
  return [
    `Context bucket: ${bucket}. Below are ${samples.length} COMPLETE emails written by Scott Briggs`,
    `(reply chains, signatures and disclaimers already removed — what remains is only his own prose).`,
    ``,
    numberedSamples(samples),
    ``,
    `Deterministic measurements already taken over this bucket (${stats.n} emails) — do NOT contradict them:`,
    `  sign-off present on ${stats.signoff_rate_pct}% of emails; observed forms: ${JSON.stringify(stats.signoff_forms)}`,
    `  average ${stats.avg_words} words, ${stats.avg_sentences} sentences, ${stats.avg_paragraphs} paragraphs`,
    ``,
    `Extract his STYLE as JSON with these keys:`,
    `{"greeting_patterns":[],"signoff_patterns":[],"signoff_when_used":"","avg_sentence_words":0,`,
    `"sentence_length":"","formality_register":"","directness_vs_hedging":"","characteristic_phrases":[],`,
    `"paragraph_shape":"","opening_move":"","closing_move":"","transitions":[],"punctuation_habits":"",`,
    `"never_does":[],"evidence":[{"attribute":"","excerpt":""}]}`,
    ``,
    `"opening_move" = what the FIRST sentence does. "closing_move" = what the LAST sentence does.`,
    `"transitions" = the literal words/phrases he uses to move between points.`,
    `Every characteristic_phrase, every transition and every "evidence.excerpt" must be a verbatim`,
    `substring of the emails above. Do not fabricate. Do not invent an example to fill a field.`,
  ].join('\n');
}

/**
 * Long-form pass — runs ONLY on emails past the old 255-char ceiling, i.e. exactly
 * the material Stage 1 could not contain. Skipped (honestly) when a bucket has
 * too few long bodies to say anything.
 */
export function longFormPrompt(bucket, samples) {
  return [
    `Context bucket: ${bucket}. Below are ${samples.length} of Scott Briggs's LONGER emails (multi-paragraph),`,
    `cleaned to his own prose only. Analyse how he BUILDS a longer note.`,
    ``,
    numberedSamples(samples),
    ``,
    `Return JSON:`,
    `{"structure":"","paragraph_progression":[],"how_he_enumerates":"","how_he_hands_off_next_steps":"",`,
    `"what_he_never_does_at_length":[],"evidence":[{"attribute":"","excerpt":""}]}`,
    ``,
    `"paragraph_progression" = an ordered list naming what each paragraph position typically does`,
    `(e.g. "1: answers the question outright"). Base it only on the emails above.`,
    `Every excerpt must be a verbatim substring of the emails above.`,
  ].join('\n');
}

/**
 * Enforce the verbatim-citation rule mechanically: any excerpt / phrase the model
 * returns that is not literally present in the sample is DROPPED and counted, so a
 * hallucinated example can never reach the committed profile. Survivors are
 * redacted before they touch disk.
 */
export function enforceVerbatim(attributes, samples) {
  const hay = samples.map((s) => s.cleaned).join('\n');
  const dropped = [];
  const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
  const haystack = norm(hay);
  const keep = (v) => {
    const t = norm(v);
    if (t.length < 3) return false;
    if (haystack.includes(t)) return true;
    dropped.push(t);
    return false;
  };
  const out = JSON.parse(JSON.stringify(attributes || {}));
  for (const key of ['characteristic_phrases', 'transitions']) {
    if (Array.isArray(out[key])) out[key] = out[key].filter(keep).map(redactExcerpt);
  }
  if (Array.isArray(out.evidence)) {
    out.evidence = out.evidence.filter((e) => keep(e && e.excerpt))
      .map((e) => ({ attribute: e.attribute, excerpt: redactExcerpt(e.excerpt) }));
  }
  return { attributes: out, dropped_unverbatim: dropped.length, dropped_samples: dropped.slice(0, 5).map(redactExcerpt) };
}

// ---------------------------------------------------------------------------

async function main() {
  if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS_SUPABASE_URL / OPS_SUPABASE_KEY'); process.exit(1); }
  console.log('[voice-distill] loading corpus from LCC Opps…');
  const { rows, excluded } = await loadCorpus();
  const by = bucketStats(rows);
  const summary = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length]));
  const overall = deterministicShapeStats(rows);

  console.log('[voice-distill] usable Scott-authored corpus:', rows.length);
  console.log('[voice-distill] excluded (why):', excluded);
  console.log(`[voice-distill] full bodies: ${overall.n_full_body} (${overall.full_body_share_pct}%) · long-form (>=400 chars): ${overall.n_long_form}`);
  console.log(`[voice-distill] retention: avg raw ${overall.avg_raw_chars} chars -> kept ${overall.avg_kept_chars} (${overall.kept_share_pct}% is Scott's own prose)`);
  console.log(`[voice-distill] sign-off present on ${overall.signoff_rate_pct}% of emails; forms:`, overall.signoff_forms);
  console.table(summary);
  for (const [b, pool] of Object.entries(by)) {
    const st = deterministicShapeStats(pool);
    console.log(`  · ${b}: n=${st.n} full=${st.n_full_body} long=${st.n_long_form} words~${st.avg_words} paras~${st.avg_paragraphs} signoff=${st.signoff_rate_pct}%`);
  }

  const result = {
    generated_at: new Date().toISOString(),
    generated_from: STATS_ONLY || DRY_RUN ? 'deterministic-only' : 'ollama:' + OLLAMA_MODEL,
    corpus_size: rows.length,
    excluded,
    bucket_counts: summary,
    overall_shape: overall,
    buckets: {},
  };
  for (const [b, pool] of Object.entries(by)) {
    result.buckets[b] = { n: pool.length, shape: deterministicShapeStats(pool) };
  }

  if (STATS_ONLY) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(`[voice-distill] --stats-only: wrote deterministic evidence to ${OUT}. No model was called.`);
    return;
  }

  if (!OLLAMA_URL && !DRY_RUN) {
    console.error('\n[voice-distill] REFUSING to distill: OLLAMA_URL is unset.');
    console.error('  The corpus must NEVER go to a cloud model. Set OLLAMA_URL to the');
    console.error('  local GaryBuilt ollama and re-run on the box. (Use --stats-only for');
    console.error('  the full deterministic evidence with no model at all, or --dry-run to');
    console.error('  print the prompts that WOULD be sent.)');
    process.exit(2);
  }

  const buckets = ONE_BUCKET ? [ONE_BUCKET] : Object.keys(by);
  for (const b of buckets) {
    const pool = by[b] || [];
    if (pool.length === 0) { console.warn(`[voice-distill] bucket ${b}: 0 rows, skipping`); continue; }
    const stats = deterministicShapeStats(pool);
    const sample = stratifiedSample(pool, Math.max(1, SAMPLE));
    const longPool = pool.filter((r) => r.shape.is_long_form);
    const longSample = stratifiedSample(longPool, Math.max(1, LONGFORM_SAMPLE));

    const basePrompt = distillPrompt(b, sample, stats);
    const lfPrompt = longSample.length >= 3 ? longFormPrompt(b, longSample) : null;

    if (DRY_RUN) {
      console.log(`\n===== DRY RUN · bucket ${b} · sample ${sample.length}/${pool.length} · long-form ${longSample.length}/${longPool.length} =====`);
      console.log(`[prompt chars] base=${basePrompt.length}${lfPrompt ? ` longform=${lfPrompt.length}` : ' longform=SKIPPED (<3 long bodies)'}`);
      result.buckets[b].sampled = sample.length;
      result.buckets[b].long_form_sampled = longSample.length;
      result.buckets[b].dry_run = true;
      continue;
    }

    console.log(`[voice-distill] distilling ${b} (${sample.length}/${pool.length}; long-form ${longSample.length}) on ${OLLAMA_MODEL}…`);
    const base = enforceVerbatim(await callOllama(basePrompt), sample);
    result.buckets[b].sampled = sample.length;
    result.buckets[b].attributes = base.attributes;
    result.buckets[b].dropped_unverbatim = base.dropped_unverbatim;
    result.buckets[b].dropped_samples = base.dropped_samples;

    if (lfPrompt) {
      const lf = enforceVerbatim(await callOllama(lfPrompt), longSample);
      result.buckets[b].long_form_sampled = longSample.length;
      result.buckets[b].long_form_attributes = lf.attributes;
      result.buckets[b].long_form_dropped_unverbatim = lf.dropped_unverbatim;
    } else {
      result.buckets[b].long_form_attributes = null;
      result.buckets[b].long_form_skipped_reason = `only ${longPool.length} long-form bod(ies) — too thin to characterise`;
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`[voice-distill] wrote ${OUT}. Fold the evidenced attributes into BRIGGS-WRITING-VOICE.md, bump its version, and commit.`);
}

// Only run when invoked directly — importing this module (tests) must not hit the
// network, read env, or exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
