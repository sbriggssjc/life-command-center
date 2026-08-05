#!/usr/bin/env node
// ============================================================================
// W5.1 — Party-extraction backlog runner (workstation one-shot) — Life Command Center
//
// Fills the missing buyer/seller/broker/lender fields on LIVE sales from the CoStar
// sale-note narrative, via the two-channel adjudicator in
// api/_handlers/party-extract.js:
//   Channel A — resolver POST /extract-parties (GLiNER spans, span-anchored)
//   Channel B — invokeExtractionAI (GaryBuilt/qwen2.5 local primary → cloud fallback)
// Writes fill-blanks ONLY, through the field-priority guard, provenance-tagged, and
// recorded in the reversible ledger public.party_extract_batch. Disagreements land in
// public.party_extract_disagreements (never written to sales).
//
// THREE MODES (dry-run is always the default; --apply is the only writing mode):
//   1. --sample N     process N stratified rows, NO writes, emit a review sheet
//                     (JSON + CSV) for Scott to approve before any bulk write.
//   2. (default)      dry-run the backlog: adjudicate + record would-write ledger rows
//                     (applied=false) + disagreements, but PATCH nothing on the domain DB.
//   3. --apply        bulk write fill-blanks to the domain sales_transactions, ledger
//                     applied=true. GATED: only proceeds while Channel B ran on ollama
//                     (ai_final_provider='ollama') unless --allow-cloud / W51_ALLOW_CLOUD=1,
//                     so the ~thousands-of-notes sweep costs ZERO cloud.
//
// Idempotent + resumable: the ledger UNIQUE(batch_tag,domain,record_pk,field_name) makes
// re-inserts no-ops; already-ledgered (batch, sale) pairs are skipped. Reversible per the
// migration header (NULL each field where the domain value still equals written_value).
//
// ENV (via .env.local / process.env):
//   OPS_SUPABASE_URL / *_SERVICE_ROLE_KEY   LCC Opps (guard + ledger + disagreements)
//   DIA_SUPABASE_URL / GOV_SUPABASE_URL + service keys  (domain reads + fill-blank writes)
//   RESOLVER_URL                            Channel A endpoint (required)
//   OLLAMA_URL (+ OLLAMA_MODEL/_API_KEY)    Channel B local primary (bulk gate)
//   W51_ALLOW_CLOUD=1                       allow the bulk run to use the cloud chain
//
// USAGE:
//   node scripts/party-extract-backlog.mjs --sample 30 --domain gov      # review sheet, no writes
//   node scripts/party-extract-backlog.mjs --domain gov                  # dry-run backlog
//   node scripts/party-extract-backlog.mjs --domain gov --apply          # bulk write (ollama-gated)
//   node scripts/party-extract-backlog.mjs --domain both --apply --allow-cloud
//
// W5.1b: gov is the DEFAULT --apply target. Under the agreement-only write path (A-only lane
// demoted to log), the 100-row sample yielded ZERO dia writes in 60 rows (dia's `notes` is
// mostly bookkeeping) vs 26 gov write-rows in 40. dia remains runnable but is expected
// near-empty until a richer dia note source exists. A note-quality prefilter skips bookkeeping
// stubs before either channel runs, and portfolio notes are deduped by hash (one extraction
// per unique note, fanned out to all member rows) to contain error blast-radius + cut cost.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvForScripts } from './_env-file.mjs';

// Load env BEFORE importing modules that read process.env at call time.
Object.assign(process.env, loadEnvForScripts(path.resolve(fileURLToPath(new URL('..', import.meta.url)))));

const { domainQuery } = await import('../api/_shared/domain-db.js');
const { opsQuery } = await import('../api/_shared/ops-db.js');
const { shouldWriteField } = await import('../api/_shared/field-priority-guard.js');
const { invokeExtractionAI } = await import('../api/_shared/ai.js');
const {
  extractParties, PARTY_FIELD_MAP, NOTE_COLUMNS, CANONICAL_FIELDS,
} = await import('../api/_handlers/party-extract.js');

// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
const args = parseArgs(process.argv);
const DOMAINS = (() => {
  const d = (args.domain || 'both').toLowerCase();
  return d === 'both' ? ['dia', 'gov'] : [d];
})();
const SAMPLE = args.sample ? Math.max(1, parseInt(args.sample, 10) || 100) : 0;
const APPLY = !!args.apply && !SAMPLE;                 // --sample never writes
const LIMIT = parseInt(args.limit, 10) || (SAMPLE || 500);
const DELAY_MS = parseInt(args['delay-ms'], 10) || 400;
const MIN_NOTE_LEN = parseInt(args['min-note-len'], 10) || 40;
const ALLOW_CLOUD = !!args['allow-cloud'] || process.env.W51_ALLOW_CLOUD === '1';
const RESOLVER_URL = args['resolver-url'] || process.env.RESOLVER_URL || '';
const DATE_TAG = args['date-tag'] || new Date().toISOString().slice(0, 10).replace(/-/g, '');
const OUT_DIR = args['out-dir'] || path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'outputs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DOMAIN_TABLE = (d) => `${d}.sales_transactions`;
const DOMAIN_DB_TAG = (d) => (d === 'dia' ? 'dia_db' : 'gov_db');

// Bookkeeping / non-narrative note stubs that carry no deal-party signal — skipped before
// either channel runs (54/60 dia sample notes were these; each wasted ~35s of GLiNER).
// Keyed by a label so the runner can report skips per pattern.
const NOTE_PREFILTERS = [
  ['master_xlsx_backfill', /^master_xlsx_backfill/i],
  ['historical_csv_import', /^historical_csv_import/i],
  ['office_sub_tenant_stub', /^Office - Sub/i],
];

// Classify a note: null when there is no usable note; otherwise { text, source, skip? , skipReason? }.
// `skip` marks a note that exists but matches a bookkeeping pattern or is under MIN_NOTE_LEN.
function noteText(row, domain) {
  for (const col of NOTE_COLUMNS[domain]) {
    const raw = row[col];
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!s) continue;
    if (s.length < MIN_NOTE_LEN) return { text: String(raw), source: col, skip: true, skipReason: 'under_min_len' };
    for (const [label, re] of NOTE_PREFILTERS) {
      if (re.test(s)) return { text: String(raw), source: col, skip: true, skipReason: label };
    }
    return { text: String(raw), source: col };
  }
  return null;
}

// FNV-1a hash of the trimmed note text — cheap, stable, no crypto import. Portfolio sales share
// a byte-identical note; we extract ONCE per unique hash and fan the result to all member rows.
function noteHash(text) {
  let h = 0x811c9dc5;
  const s = String(text || '').trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

function missingMappedFields(row, domain) {
  const map = PARTY_FIELD_MAP[domain];
  const missing = {};
  for (const field of CANONICAL_FIELDS) {
    const col = map[field];
    if (!col) continue;               // no column in this domain (e.g. dia lender)
    const cur = row[col];
    if (cur == null || String(cur).trim() === '') missing[field] = col;
  }
  return missing;                     // { canonicalField: column }
}

// PostgREST select list per domain (party columns + note columns + pk).
function selectCols(domain) {
  const map = PARTY_FIELD_MAP[domain];
  const cols = new Set(['sale_id', ...NOTE_COLUMNS[domain], ...Object.values(map)]);
  return [...cols].join(',');
}

// Page live candidate sales (has a note AND ≥1 blank mapped party field), cursor by sale_id.
// `prefilterSkips` (optional) accumulates a per-pattern count of bookkeeping notes skipped.
async function* candidates(domain, prefilterSkips) {
  let cursor = null;
  const sel = selectCols(domain);
  while (true) {
    let pth = `sales_transactions?transaction_state=eq.live&select=${sel}&order=sale_id.asc&limit=1000`;
    if (cursor != null) pth += `&sale_id=gt.${encodeURIComponent(cursor)}`;
    const res = await domainQuery(domain, 'GET', pth);
    if (!res.ok) throw new Error(`${domain} candidate read ${res.status}: ${JSON.stringify(res.data)}`);
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) return;
    for (const row of rows) {
      cursor = row.sale_id;
      const nt = noteText(row, domain);
      if (!nt) continue;
      if (nt.skip) {
        if (prefilterSkips) prefilterSkips[nt.skipReason] = (prefilterSkips[nt.skipReason] || 0) + 1;
        continue;
      }
      const missing = missingMappedFields(row, domain);
      if (!Object.keys(missing).length) continue;
      yield { row, note: nt, missing };
    }
    if (rows.length < 1000) return;
  }
}

async function alreadyLedgered(domain, saleId, batchTag) {
  const res = await opsQuery('GET',
    `party_extract_batch?batch_tag=eq.${encodeURIComponent(batchTag)}&target_database=eq.${domain}&record_pk=eq.${encodeURIComponent(String(saleId))}&select=id&limit=1`);
  return res.ok && Array.isArray(res.data) && res.data.length > 0;
}

async function insertLedger(rowObj) {
  await opsQuery('POST', 'party_extract_batch', rowObj,
    { headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } });
}
async function insertDisagreement(rowObj) {
  await opsQuery('POST', 'party_extract_disagreements', rowObj,
    { headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } });
}

// Missing-field snapshot for the before/after report.
async function missingCounts(domain) {
  const map = PARTY_FIELD_MAP[domain];
  const out = {};
  for (const field of CANONICAL_FIELDS) {
    const col = map[field];
    if (!col) continue;
    const q = `sales_transactions?transaction_state=eq.live&or=(${col}.is.null,${col}.eq.)&select=sale_id`;
    const r = await domainQuery(domain, 'GET', q, null, { Prefer: 'count=exact' });
    out[col] = r.count ?? (Array.isArray(r.data) ? r.data.length : null);
  }
  return out;
}

// ---------------------------------------------------------------------------
async function processDomain(domain, { batchTag, sampleCollector }) {
  const stats = { scanned: 0, ai_calls: 0, writes: 0, dry_writes: 0, disagreements: 0,
    skipped_ledgered: 0, dedup_hits: 0, prefilter_skips: {}, cloud_stop: false, provider_hist: {} };
  let processed = 0;
  // Portfolio-note dedup: adjudicated result (+ provider) per unique note hash.
  const noteCache = new Map();

  for await (const cand of candidates(domain, stats.prefilter_skips)) {
    if (processed >= LIMIT) break;
    const { row, note, missing } = cand;
    const saleId = row.sale_id;

    if (!SAMPLE && await alreadyLedgered(domain, saleId, batchTag)) { stats.skipped_ledgered++; continue; }

    let result;
    let fromCache = false;
    const hash = noteHash(note.text);
    if (noteCache.has(hash)) {
      result = noteCache.get(hash);
      fromCache = true;
      stats.dedup_hits++;
    } else {
      try {
        result = await extractParties(note.text, { resolverUrl: RESOLVER_URL, invokeExtractionAIImpl: invokeExtractionAI });
      } catch (err) {
        console.warn(`[w51] ${domain} sale=${saleId} extract failed: ${err.message}`);
        continue;
      }
      noteCache.set(hash, result);
      stats.ai_calls++;
    }
    processed++;
    stats.scanned++;
    const provider = result.aiFinalProvider || 'unknown';
    stats.provider_hist[provider] = (stats.provider_hist[provider] || 0) + 1;

    // BULK gate: the sweep only runs free (ollama). A cloud fallback in --apply without
    // --allow-cloud is a STOP condition (log + halt this domain), never a silent cost leak.
    if (APPLY && provider !== 'ollama' && !ALLOW_CLOUD) {
      console.error(`[w51] STOP: Channel B fell back to '${provider}' (not ollama) on ${domain} sale=${saleId}. ` +
        `Bring OLLAMA_URL up or pass --allow-cloud to proceed. Halting bulk run for ${domain}.`);
      stats.cloud_stop = true;
      break;
    }

    const decisions = missingOnly(result.decisions, missing);
    const sampleRow = SAMPLE ? {
      domain, sale_id: saleId, note_source: note.source,
      note_excerpt: note.text.slice(0, 240).replace(/\s+/g, ' '),
      channel_a: pickCore(result.channelA), channel_a_spans: (result.channelA?.spans || []).map((s) => `${s.field}:${s.text}`),
      channel_b: result.channelB, ai_provider: provider, verdicts: {},
    } : null;

    for (const [field, dec] of Object.entries(decisions)) {
      const col = missing[field];
      if (sampleRow) sampleRow.verdicts[field] = summarizeDecision(dec, col);

      if (dec.decision === 'write') {
        // fill-blanks re-check already guaranteed by `missing`. Consult the guard.
        const allowed = await shouldWriteField({
          targetDb: DOMAIN_DB_TAG(domain), targetTable: DOMAIN_TABLE(domain), recordPk: String(saleId),
          fieldName: col, value: dec.value, source: dec.source, confidence: dec.confidence,
          sourceRunId: batchTag,
        });
        if (!allowed.write) continue; // strict-mode block (unlikely; these are record_only)

        if (APPLY) {
          const patch = { [col]: dec.value };
          const pr = await domainQuery(domain, 'PATCH',
            `sales_transactions?sale_id=eq.${encodeURIComponent(String(saleId))}&${col}=is.null`,
            patch, { Prefer: 'return=minimal' }, { label: 'w51-party-extract', sourceRunId: batchTag });
          if (!pr.ok) { console.warn(`[w51] ${domain} sale=${saleId} PATCH ${col} ${pr.status}`); continue; }
          stats.writes++;
        } else {
          stats.dry_writes++;
        }
        await insertLedger({
          batch_tag: batchTag, target_database: domain, target_table: DOMAIN_TABLE(domain),
          record_pk: String(saleId), field_name: col, written_value: dec.value,
          source: dec.source, confidence: dec.confidence,
          channel_a_value: dec.aValue, channel_b_value: dec.bValue,
          span_text: dec.span?.text ?? null, span_start: dec.span?.start ?? null, span_end: dec.span?.end ?? null,
          note_source: note.source, ai_final_provider: provider, applied: APPLY,
        });
      } else if (dec.disagreementKind) {
        stats.disagreements++;
        await insertDisagreement({
          batch_tag: batchTag, target_database: domain, record_pk: String(saleId), field_name: field,
          channel_a_value: dec.aValue, channel_b_value: dec.bValue, channel_a_core: dec.aCore, channel_b_core: dec.bCore,
          disagreement_kind: dec.disagreementKind, note_excerpt: note.text.slice(0, 240).replace(/\s+/g, ' '),
          ai_final_provider: provider,
        });
      }
    }

    if (sampleRow && sampleCollector) sampleCollector.push(sampleRow);
    // Only pace when we actually hit the resolver/AI — a dedup cache hit did no network.
    if (DELAY_MS && !fromCache) await sleep(DELAY_MS);
  }
  return stats;
}

function missingOnly(decisions, missing) {
  const out = {};
  for (const field of Object.keys(missing)) if (decisions[field]) out[field] = decisions[field];
  return out;
}
function pickCore(channelA) {
  if (!channelA) return null;
  const o = {};
  for (const f of CANONICAL_FIELDS) if (channelA[f]) o[f] = channelA[f];
  return o;
}
function summarizeDecision(dec, col) {
  if (dec.decision === 'write') return { would_write: col, value: dec.value, source: dec.source, confidence: dec.confidence };
  if (dec.disagreementKind) return { would_write: null, disagreement: dec.disagreementKind, a: dec.aValue, b: dec.bValue };
  return { would_write: null };
}

// ---------------------------------------------------------------------------
function writeReviewSheet(rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `w51_party_sample_${DATE_TAG}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2));
  // CSV — one line per (row, field) verdict for easy human scanning.
  const header = ['domain', 'sale_id', 'note_source', 'field', 'would_write', 'value', 'source', 'confidence', 'disagreement', 'a', 'b', 'ai_provider', 'note_excerpt'];
  const csvLines = [header.join(',')];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  for (const r of rows) {
    for (const [field, v] of Object.entries(r.verdicts)) {
      csvLines.push([r.domain, r.sale_id, r.note_source, field, v.would_write || '', v.value || '',
        v.source || '', v.confidence ?? '', v.disagreement || '', v.a || '', v.b || '', r.ai_provider, r.note_excerpt]
        .map(esc).join(','));
    }
  }
  const csvPath = path.join(OUT_DIR, `w51_party_sample_${DATE_TAG}.csv`);
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  return { jsonPath, csvPath };
}

// ---------------------------------------------------------------------------
async function main() {
  if (!RESOLVER_URL) {
    console.error('[w51] RESOLVER_URL is required (Channel A). Set it in .env.local or pass --resolver-url.');
    process.exit(2);
  }
  const mode = SAMPLE ? `SAMPLE(${SAMPLE})` : APPLY ? 'APPLY' : 'DRY-RUN';
  console.log(`[w51] mode=${mode} domains=${DOMAINS.join(',')} limit=${LIMIT} allow_cloud=${ALLOW_CLOUD} resolver=${RESOLVER_URL}`);

  const sampleCollector = SAMPLE ? [] : null;
  const report = {};
  for (const domain of DOMAINS) {
    const batchTag = `w51_${DATE_TAG}_${domain}`;
    const before = APPLY ? await missingCounts(domain) : null;
    const stats = await processDomain(domain, { batchTag, sampleCollector });
    const after = APPLY ? await missingCounts(domain) : null;
    report[domain] = { batchTag, stats, before, after };
    console.log(`[w51] ${domain}: ${JSON.stringify(stats)}`);
    if (APPLY) console.log(`[w51] ${domain} missing before→after:`, JSON.stringify({ before, after }));
  }

  if (SAMPLE && sampleCollector) {
    const paths = writeReviewSheet(sampleCollector);
    console.log(`[w51] review sheet (${sampleCollector.length} rows): ${paths.jsonPath} , ${paths.csvPath}`);
    console.log('[w51] Sample is dry — no domain writes. Have Scott approve before any --apply run.');
  }
  console.log('[w51] done.');
}

// Only run when invoked directly (keeps the module importable for tests).
// Windows-safe: argv[1] is a backslash path (C:\...), never equal to the file:// URL
// string directly — normalize through pathToFileURL before comparing.
const invokedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => { console.error('[w51] fatal:', err); process.exit(1); });
}

export { processDomain, noteText, noteHash, missingMappedFields, selectCols };
