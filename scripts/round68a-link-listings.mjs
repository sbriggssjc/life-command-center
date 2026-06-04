#!/usr/bin/env node
/**
 * Round 68-A — Task 2 LINK class: link real listings to their sale.
 *
 * Plan-v1 review (Scott) found 401 unlinked sales whose property already has a
 * REAL listing in the 3y-prior window. Synthesizing those would double-count the
 * marketing event on every INCLUDE chart. For the 212 where an UNLINKED real
 * listing is available, link it to its nearest prior sale instead of synthesizing
 * — real listing dates beat imputed ones. (The other ~189 are already covered by
 * a sibling-linked listing; they are simply excluded from synthesis — no row
 * touched.)
 *
 * Per link (reads v_round68a_link_candidates):
 *   UPDATE available_listings SET
 *     sale_transaction_id = sale_id,
 *     off_market_date     = COALESCE(off_market_date, sale_date),
 *     sold_date           = COALESCE(sold_date, sale_date),
 *     status='sold', is_active=false
 *   WHERE listing_id = <id> AND sale_transaction_id IS NULL;   -- idempotency guard
 *
 * The WHERE ... sale_transaction_id IS NULL guard makes a second run a no-op and
 * prevents stealing a listing that some other process linked in between.
 * listing_date is left untouched (it is the real, captured marketing date).
 *
 * MODES: DRY-RUN default (writes scripts/round68a_link_plan.json, no DB writes);
 *        --commit performs the updates.
 *
 * USAGE:
 *   DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... node scripts/round68a-link-listings.mjs
 *   DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... node scripts/round68a-link-listings.mjs --commit
 *
 * ORDER: run this BEFORE round68a-synthesize-listings.mjs. Linking sets
 * sale_transaction_id, which the synth candidate view keys off — but the synth
 * view already excludes the whole LINK class, so order is not load-bearing; it is
 * just the natural sequence (links first, then synthesize the remainder).
 */
import process from 'node:process';
import { writeFileSync } from 'node:fs';

const A = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  if (!a.startsWith('--')) return [];
  const i = a.indexOf('='); return [[a.slice(2, i < 0 ? undefined : i), i < 0 ? true : a.slice(i + 1)]];
}));
const COMMIT = A.commit === true || A.commit === 'true';
const OUT = A.out || 'scripts/round68a_link_plan.json';
const URL = process.env.DIA_SUPABASE_URL;
const KEY = process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY;
if (!URL || !KEY) { console.error('FATAL: set DIA_SUPABASE_URL + DIA_SUPABASE_SERVICE_KEY'); process.exit(1); }

async function rest(method, path, body, extraHeaders = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function getAll(pathBase) {
  const rows = []; const page = 1000;
  for (let off = 0; ; off += page) {
    const sep = pathBase.includes('?') ? '&' : '?';
    const chunk = await rest('GET', `${pathBase}${sep}limit=${page}&offset=${off}`);
    rows.push(...chunk);
    if (chunk.length < page) break;
  }
  return rows;
}

async function main() {
  const links = await getAll('v_round68a_link_candidates?select=*&order=sale_date.desc');
  const byYear = {};
  for (const l of links) { const y = Number(String(l.sale_date).slice(0, 4)); byYear[y] = (byYear[y] || 0) + 1; }
  const gaps = links.map(l => l.gap_days).sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;

  const plan = {
    round: '68-A', task: 'Task 2 — LINK class (real listing -> nearest prior sale)',
    generated_at: new Date().toISOString(), mode: COMMIT ? 'commit' : 'dry_run',
    total_links: links.length,
    gap_days: { min: gaps[0] ?? null, median, max: gaps[gaps.length - 1] ?? null },
    links_by_sale_year: byYear,
    sample_12: links.slice(0, 12).map(l => ({
      listing_id: l.listing_id, sale_id: l.sale_id,
      listing_date: l.listing_date, sale_date: l.sale_date, gap_days: l.gap_days,
    })),
  };
  writeFileSync(OUT, JSON.stringify(plan, null, 2));
  console.log(`[round68a-link] candidates=${links.length}  median_gap=${median}d  plan -> ${OUT}`);

  if (!COMMIT) { console.log('[round68a-link] DRY RUN — no writes. Re-run with --commit after verifying.'); return; }

  let linked = 0, skipped = 0;
  for (const l of links) {
    // PATCH #1 — the link + sold status, guarded so a second run (or a race)
    // is a no-op. is_active=false + status='sold' makes fn_listing_close_if_sold
    // early-return (it skips terminal-state rows), so it won't fight this write.
    const res = await rest(
      'PATCH',
      `available_listings?listing_id=eq.${l.listing_id}&sale_transaction_id=is.null`,
      { sale_transaction_id: l.sale_id, status: 'sold', is_active: false },
      { Prefer: 'return=representation' },
    );
    if (!(Array.isArray(res) && res.length)) { skipped += 1; continue; } // already linked
    linked += 1;
    // PATCH #2/#3 — set off_market_date / sold_date ONLY where currently NULL
    // (Scott's rule: don't clobber an existing off-market/sold date). The
    // is.null filters make these naturally idempotent.
    await rest('PATCH',
      `available_listings?listing_id=eq.${l.listing_id}&off_market_date=is.null`,
      { off_market_date: l.sale_date }, { Prefer: 'return=minimal' });
    await rest('PATCH',
      `available_listings?listing_id=eq.${l.listing_id}&sold_date=is.null`,
      { sold_date: l.sale_date }, { Prefer: 'return=minimal' });
    if ((linked + skipped) % 50 === 0) process.stdout.write(`\r[round68a-link] ${linked} linked / ${skipped} skipped`);
  }
  console.log(`\n[round68a-link] COMMIT complete — ${linked} linked, ${skipped} skipped (already linked).`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
