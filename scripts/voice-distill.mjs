#!/usr/bin/env node
// ============================================================================
// scripts/voice-distill.mjs — W10 Stage 1 (Prompt 100)
//
// ON-PREM voice-profile distiller. Pulls Scott's authored sent-email corpus
// from LCC Opps, cleans it deterministically (api/_shared/voice-corpus-clean),
// stratifies by draft-type, samples per bucket, and asks the LOCAL GaryBuilt
// ollama model to distill STRUCTURED style attributes per context bucket.
//
// PRIVACY DOCTRINE (non-negotiable): Scott's decade of client mail NEVER leaves
// the box. This script talks to OLLAMA DIRECTLY (OLLAMA_URL) — there is NO cloud
// fallback path here, unlike invokeExtractionAI. If OLLAMA_URL is unset it
// REFUSES to run rather than risk a cloud round-trip. Run it on the box (or a
// host tunneled to the box's ollama), never on a cloud runner.
//
// It is analysis-only: it writes a JSON attributes file for a human to fold into
// BRIGGS-WRITING-VOICE.md. It never sends anything, never mutates the corpus.
//
// Usage (on the GaryBuilt box / a host with OLLAMA_URL set to it):
//   OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5:14b \
//     node scripts/voice-distill.mjs                       # all buckets
//   node scripts/voice-distill.mjs --bucket internal_coordination --sample 30
//   node scripts/voice-distill.mjs --stats-only            # counts, no LLM call
//   node scripts/voice-distill.mjs --out docs/os/voice/briggs-voice-attributes.json
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { loadEnvForScripts } from './_env-file.mjs';
import { cleanEmailBody, isMostlyBoilerplate, classifyDraftType } from '../api/_shared/voice-corpus-clean.js';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const STATS_ONLY = argv.includes('--stats-only');
const ONE_BUCKET = arg('--bucket', null);
const SAMPLE = Number(arg('--sample', '24'));
const OUT = arg('--out', 'docs/os/voice/briggs-voice-attributes.json');

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS_SUPABASE_URL / OPS_SUPABASE_KEY'); process.exit(1); }

const OLLAMA_URL = String(process.env.OLLAMA_URL || env.OLLAMA_URL || '').trim().replace(/\/+$/, '');
const OLLAMA_MODEL = String(process.env.OLLAMA_MODEL || env.OLLAMA_MODEL || 'qwen2.5:14b').trim();

// Scott's authored-from addresses (verified live 2026-08-13). Family "hbriggs"/
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
  // activity_events (2022→now) — the long-range source.
  const ae = await pageAll((o, l) =>
    `activity_events?select=body,title,metadata,occurred_at` +
    `&source_type=in.(outlook,outlook_sent,outlook_tagged)` +
    `&body=not.is.null&order=occurred_at.desc&offset=${o}&limit=${l}`);
  // email_bodies (2026-06→now) — recent, has to_emails typed.
  const eb = await pageAll((o, l) =>
    `email_bodies?select=body_preview,subject,from_email,to_emails,sent_at,received_at,internet_message_id` +
    `&body_preview=not.is.null&order=received_at.desc&offset=${o}&limit=${l}`);

  const seen = new Set();
  const rows = [];
  const push = (imid, raw, subject, from, toEmails, ts) => {
    if (!SCOTT_FROM.has(normFrom(from))) return;
    const key = imid || 'body:' + String(raw).slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);
    const cleaned = cleanEmailBody(raw);
    if (isMostlyBoilerplate(cleaned)) return;
    const { bucket, audience } = classifyDraftType({ cleaned, subject, toEmails, fromEmail: from });
    rows.push({ cleaned, subject, audience, bucket, ts });
  };
  for (const r of ae) {
    const m = r.metadata || {};
    push(m.internet_message_id, r.body, r.title, m.from_email, m.to_emails || [], r.occurred_at);
  }
  for (const r of eb) {
    push(r.internet_message_id, r.body_preview, r.subject, r.from_email, r.to_emails || [], r.sent_at || r.received_at);
  }
  return rows;
}

function bucketStats(rows) {
  const by = {};
  for (const r of rows) (by[r.bucket] ||= []).push(r);
  return by;
}

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

function distillPrompt(bucket, samples) {
  const numbered = samples.map((s, i) => `#${i + 1}: ${s.cleaned.replace(/\n+/g, ' / ')}`).join('\n');
  return [
    `Context bucket: ${bucket}. Below are ${samples.length} cleaned openings from Scott Briggs's own sent emails (reply chains and signatures already removed).`,
    ``,
    numbered,
    ``,
    `Extract his STYLE as JSON with these keys:`,
    `{"greeting_patterns":[],"signoff_patterns":[],"avg_sentence_words":0,"sentence_length":"",`,
    `"formality_register":"","directness_vs_hedging":"","characteristic_phrases":[],`,
    `"paragraph_shape":"","punctuation_habits":"","never_does":[],"evidence":[{"attribute":"","excerpt":""}]}`,
    `Every characteristic_phrase and every "evidence.excerpt" must be a verbatim substring of the emails above. Do not fabricate.`,
  ].join('\n');
}

(async () => {
  console.log('[voice-distill] loading corpus from LCC Opps…');
  const rows = await loadCorpus();
  const by = bucketStats(rows);
  const summary = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length]));
  console.log('[voice-distill] cleaned corpus size:', rows.length);
  console.table(summary);

  if (STATS_ONLY) {
    console.log('[voice-distill] --stats-only: no LLM call, nothing written.');
    return;
  }
  if (!OLLAMA_URL) {
    console.error('\n[voice-distill] REFUSING to distill: OLLAMA_URL is unset.');
    console.error('  The corpus must NEVER go to a cloud model. Set OLLAMA_URL to the');
    console.error('  local GaryBuilt ollama and re-run on the box. (Use --stats-only to');
    console.error('  inspect bucket counts without any model.)');
    process.exit(2);
  }

  const buckets = ONE_BUCKET ? [ONE_BUCKET] : Object.keys(by);
  const result = { generated_from: 'ollama:' + OLLAMA_MODEL, corpus_size: rows.length, bucket_counts: summary, buckets: {} };
  for (const b of buckets) {
    const pool = by[b] || [];
    if (pool.length === 0) { console.warn(`[voice-distill] bucket ${b}: 0 rows, skipping`); continue; }
    const sample = pool.slice(0, Math.max(1, SAMPLE));
    console.log(`[voice-distill] distilling ${b} (${sample.length}/${pool.length}) on ${OLLAMA_MODEL}…`);
    result.buckets[b] = { n: pool.length, sampled: sample.length, attributes: await callOllama(distillPrompt(b, sample)) };
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`[voice-distill] wrote ${OUT}. Fold the evidenced attributes into BRIGGS-WRITING-VOICE.md and commit.`);
})().catch((e) => { console.error(e); process.exit(1); });
