#!/usr/bin/env node
/**
 * ORE follow-up (2026-07-16): normalize the MESSY existing text-lenders on
 * `loans` into the `lenders` entity table and stamp `loans.lender_id`.
 *
 * The loan writers historically stored the lender as TEXT (dia `lender_name` /
 * gov `originator`); the `lenders` table was dormant. Those ~1,755 text-only
 * rows carry broker-mashed names ("Marcus & Millichap Capstar Bank"), allocation
 * notes ("JLL CIT Group ($1.5m alloc'd)"), and suffix variants ("Wells Fargo" vs
 * "Wells Fargo Bank Na"). This script runs each through the SHARED cleaner
 * (`cleanLenderName`) + the SHARED resolver (`resolveOrCreateLender`) — the exact
 * same choke point the forward deed-path uses — so a broker-mashed/alloc-noted
 * name resolves to a clean, dedupable lender and an AMBIGUOUS one (multi-lender
 * `;`, placeholder Private/Other, bare fragment) is SKIPPED and left text-only.
 *
 * SAFETY: fill-blanks only. It NEVER touches a loan that already carries a
 * `lender_id`, and it only ever WRITES `loans.lender_id` (never the text column).
 * Reverse a run by clearing the lender_id it set (the created `lenders` rows are
 * additive and harmless if left). Dry-run first — see the DRY-RUN section below.
 *
 * Required env (set the pair(s) for the domain(s) you run):
 *   DIA_SUPABASE_URL, DIA_SUPABASE_SERVICE_KEY  (legacy: DIA_SUPABASE_KEY)
 *   GOV_SUPABASE_URL, GOV_SUPABASE_SERVICE_KEY  (legacy: GOV_SUPABASE_KEY)
 *
 * Usage:
 *   node scripts/lender-backfill.mjs --domain=both --dry-run          # the gate
 *   node scripts/lender-backfill.mjs --domain=dia --apply --limit=50  # capped apply
 *   node scripts/lender-backfill.mjs --domain=both --apply            # broad apply
 *
 * Flags:
 *   --domain=dia|gov|both   Which database(s). Default: both
 *   --dry-run               Report the cleaner distribution + would-create count,
 *                           NO writes. Default when --apply is absent.
 *   --apply                 Resolve + stamp loans.lender_id fill-blanks.
 *   --limit=N               Max loan rows stamped per domain (apply). Default: all.
 *   --page=N                Rows fetched per PostgREST page. Default: 1000.
 *   --sample=N              How many before→after transforms to print. Default: 25.
 */

import process from 'node:process';
import { cleanLenderName } from '../api/_shared/lender-name.js';
import { resolveOrCreateLender } from '../api/_handlers/sidebar-pipeline.js';

const args = parseArgs(process.argv.slice(2));
const domains = (args.domain === 'both' || !args.domain) ? ['dia', 'gov'] : [args.domain];
const apply = args.apply === true || args.apply === 'true';
const dryRun = !apply || args['dry-run'] === true;
const limit = args.limit != null ? parseInt(args.limit, 10) : Infinity;
const pageSize = Math.min(parseInt(args.page || '1000', 10), 1000);
const sampleN = parseInt(args.sample || '25', 10);

// dia stores the lender as `lender_name`; gov as `originator`. Both loans carry
// a `lender_id` uuid + a `loan_id` PK (verified live 2026-07-16).
const DOMAIN = {
  dia: {
    supaDomain: 'dialysis',
    url: process.env.DIA_SUPABASE_URL,
    key: process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY,
    lenderCol: 'lender_name',
  },
  gov: {
    supaDomain: 'government',
    url: process.env.GOV_SUPABASE_URL,
    key: process.env.GOV_SUPABASE_SERVICE_KEY || process.env.GOV_SUPABASE_KEY,
    lenderCol: 'originator',
  },
};

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else out[a.slice(2)] = true;
  }
  return out;
}

// A minimal PostgREST adapter matching the `resolveOrCreateLender` domainQuery
// contract: q(domain, method, path, body?, headers?) -> { ok, status, data }.
// POST always requests `return=representation` so the created lender_id comes back.
function buildQuery(cfg) {
  const base = cfg.url.replace(/\/$/, '') + '/rest/v1/';
  const authHeaders = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
  };
  return async function q(_domain, method, path, body, extraHeaders) {
    const headers = { ...authHeaders, ...(extraHeaders || {}) };
    if (method === 'POST' && !headers.Prefer) headers.Prefer = 'return=representation';
    let data = null;
    try {
      const resp = await fetch(base + path, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
      const text = await resp.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { ok: resp.ok, status: resp.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: null, error: String(err) };
    }
  };
}

// Page the text-only loans (lender_id NULL, non-empty text lender).
async function fetchTextOnlyLoans(cfg, q) {
  const col = cfg.lenderCol;
  const rows = [];
  let offset = 0;
  for (;;) {
    const path =
      `loans?lender_id=is.null&${col}=not.is.null&select=loan_id,${col}` +
      `&order=loan_id.asc&limit=${pageSize}&offset=${offset}`;
    const res = await q(null, 'GET', path);
    if (!res.ok || !Array.isArray(res.data)) {
      throw new Error(`fetch loans failed (status ${res.status}): ${JSON.stringify(res.data)?.slice(0, 300)}`);
    }
    for (const r of res.data) rows.push({ loan_id: r.loan_id, raw: r[col] });
    if (res.data.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

function classifyDistribution(rows) {
  // Verdict tally + the set of distinct CLEANED names (the dedup target).
  const verdicts = {};
  const skips = {};
  const cleanedSet = new Map();  // lower(clean) -> {clean, count}
  const transforms = [];         // sample of before->after
  const skipSamples = [];
  let stampable = 0;             // rows whose text cleans to a non-skip name
  for (const r of rows) {
    const c = cleanLenderName(r.raw);
    const key = c.skip ? `skip:${c.reason}` : c.reason;
    verdicts[key] = (verdicts[key] || 0) + 1;
    if (c.skip) {
      skips[c.reason] = (skips[c.reason] || 0) + 1;
      if (skipSamples.length < sampleN) skipSamples.push({ raw: r.raw, reason: c.reason });
      continue;
    }
    stampable++;
    const lk = c.clean.toLowerCase();
    const existing = cleanedSet.get(lk);
    if (existing) existing.count++;
    else cleanedSet.set(lk, { clean: c.clean, count: 1 });
    if (c.clean !== String(r.raw).trim() && transforms.length < sampleN) {
      transforms.push({ raw: r.raw, clean: c.clean, why: c.reason });
    }
  }
  return { verdicts, skips, cleanedSet, transforms, skipSamples, stampable };
}

async function runDomain(dom) {
  const cfg = DOMAIN[dom];
  if (!cfg.url || !cfg.key) {
    console.log(`\n[${dom}] SKIPPED — missing ${dom.toUpperCase()}_SUPABASE_URL / _SERVICE_KEY`);
    return;
  }
  const q = buildQuery(cfg);
  console.log(`\n═══ ${dom.toUpperCase()} (loans.${cfg.lenderCol}) ═══`);
  const rows = await fetchTextOnlyLoans(cfg, q);
  console.log(`text-only loans (lender_id NULL, ${cfg.lenderCol} present): ${rows.length}`);
  if (rows.length === 0) return;

  const dist = classifyDistribution(rows);
  console.log(`distinct raw names: ${new Set(rows.map(r => String(r.raw).trim().toLowerCase())).size}`);
  console.log(`stampable rows (clean, non-skip): ${dist.stampable}`);
  console.log(`distinct CLEANED lender names (dedup target): ${dist.cleanedSet.size}`);
  console.log('verdict distribution:', dist.verdicts);
  if (Object.keys(dist.skips).length) console.log('skip reasons (left text-only):', dist.skips);

  if (dist.transforms.length) {
    console.log(`\n  sample transforms (before → after):`);
    for (const t of dist.transforms) console.log(`    "${t.raw}"  →  "${t.clean}"   [${t.why}]`);
  }
  if (dist.skipSamples.length) {
    console.log(`\n  sample skips (kept text-only):`);
    for (const s of dist.skipSamples) console.log(`    "${s.raw}"   [skip:${s.reason}]`);
  }

  if (dryRun) {
    console.log(`\n  [DRY-RUN] no writes. ${dist.stampable} rows would resolve into ~${dist.cleanedSet.size} lenders.`);
    return;
  }

  // ── APPLY: resolve + stamp loans.lender_id fill-blanks (capped by --limit). ──
  const resolveCache = new Map();  // lower(clean) -> lender_id | null
  let stamped = 0, resolveFailed = 0, skipped = 0, patchFailed = 0, processed = 0;
  for (const r of rows) {
    if (stamped >= limit) break;
    processed++;
    const c = cleanLenderName(r.raw);
    if (c.skip) { skipped++; continue; }
    const lk = c.clean.toLowerCase();
    let lenderId = resolveCache.get(lk);
    if (lenderId === undefined) {
      lenderId = await resolveOrCreateLender(cfg.supaDomain, r.raw, { domainQuery: q });
      resolveCache.set(lk, lenderId || null);
    }
    if (!lenderId) { resolveFailed++; continue; }
    // Fill-blanks PATCH: guarded on lender_id IS NULL so a concurrent write is a no-op.
    const res = await q(
      null, 'PATCH',
      `loans?loan_id=eq.${encodeURIComponent(String(r.loan_id))}&lender_id=is.null`,
      { lender_id: lenderId },
      { Prefer: 'return=minimal' },
    );
    if (res.ok) stamped++;
    else patchFailed++;
  }
  console.log(`\n  [APPLY] processed ${processed} · stamped ${stamped} · skipped ${skipped} · ` +
    `resolve_failed ${resolveFailed} · patch_failed ${patchFailed} · ` +
    `distinct lenders resolved ${[...resolveCache.values()].filter(Boolean).length}`);
}

(async () => {
  console.log(`lender-backfill — mode=${dryRun ? 'DRY-RUN' : 'APPLY'} domains=${domains.join(',')}` +
    (apply && limit !== Infinity ? ` limit=${limit}/domain` : ''));
  for (const dom of domains) {
    try { await runDomain(dom); }
    catch (err) { console.error(`[${dom}] ERROR:`, err.message || err); }
  }
  console.log('\nDone.');
})();
