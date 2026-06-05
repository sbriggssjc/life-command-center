#!/usr/bin/env node
/**
 * Round 68 batch 3 — Task 1 (D10): firm-term backfill from the master workbook.
 *
 * Extends the Round 66x.2 Step-3 term backfill (migration
 * 20260712_cm_round66x2_step3_r2_term_backfill_from_master.sql, which only
 * touched the 280 master_xlsx_backfill_r2 IMPORTED sales) to EVERY
 * fingerprint-matched master<->sale pair, regardless of how the sale entered the
 * DB. The master workbook's TERM column is hand-curated firm-term-remaining at
 * sale and is authoritative; our resolver (dia_firm_term_fields, the
 * lease-in-effect-at-sale logic behind firm_term_years_at_sale) returns NULL
 * whenever no covering lease/OM-doc/notes term exists, and occasionally picks a
 * near-expired/renewal lease that disagrees with the curated term.
 *
 * WHY THIS IS THE LEVER FOR D10 (cohorts merge pre-2018): the canonical
 * cm_dialysis_sold_cap_by_term_dot view reads firm_term_years_at_sale + the
 * per-cohort n>=3 gate. Where term is NULL the deal falls out of every cohort;
 * where term is wrong it lands in the wrong cohort. 2013-2018 is where master
 * term coverage is densest (30/40/62/97/133/169 term rows) AND our term% is only
 * 49-78% — so this backfill recovers the most cohort separation there.
 *
 * THE IDENTITY TEST (established, from import-master-unmatched-comps.mjs +
 * dup-review-adjudicate.mjs): a master row M and an existing sale S are the SAME
 * transaction when, on UNTOUCHED source columns:
 *     same state  AND  |sale_date diff| <= --day-tol (default 90)
 *                 AND  |price diff| <= --price-tol (default 0.03)
 *                 AND  |cap diff| <= --cap-bp/10000 (default 5bp = 0.0005),
 *                      comparing M.sold_cap to S's ORIGINAL ingested cap
 *                      COALESCE(stated_cap_rate, cap_rate) — NOT cap_rate_final,
 *                      which may already carry a master override.
 * The cap agreement is what makes this an identity (date+price alone can collide
 * across a portfolio). Master rows without an in-band cap cannot satisfy the
 * identity test and are reported as `nocap_skipped` (NOT written) unless
 * --allow-nocap is passed (then date+price-only, lower confidence).
 *
 * THE WRITE: for each identity-matched pair where S is NOT firm_term_locked AND
 * (S.firm_term_years_at_sale IS NULL  OR  |S.term - M.term| > --term-tol (1.5)):
 *     firm_term_years_at_sale      = M.term_years
 *     firm_term_expiration_at_sale = sale_date + term*1yr
 *     firm_term_source             = 'master_curated'
 *     firm_term_computed_at        = now()
 *     firm_term_locked             = per --lock-mode (see below)
 * Two decision classes: NULL_FILL (S.term was NULL) and OVERRIDE (S.term present
 * but disagreed by > term-tol — the Venoy failure class).
 *
 * ── LOCKING (important durability note) ───────────────────────────────────────
 * There is an AFTER trigger on leases (dia_leases_refresh_firm_term) that
 * RE-RESOLVES firm_term_years_at_sale for every UNLOCKED sale on a property
 * whenever any lease on that property changes — and for these rows the resolver
 * returns NULL (NULL_FILL: no covering lease) or the wrong value (OVERRIDE). So
 * an UNLOCKED master backfill is silently reverted on the next lease touch.
 *   --lock-mode=all       (default, matches the 20260712 precedent) lock both
 *                         classes — durable; an analyst can unlock a row if a
 *                         confirmed covering lease later lands.
 *   --lock-mode=overrides lock only OVERRIDEs (a verification event: master wins
 *                         over a wrong lease term); leave NULL_FILLs unlocked so
 *                         a future genuinely-covering lease can win. Matches the
 *                         prompt's "NOT locked unless verified" literally, at the
 *                         cost of NULL_FILLs being reverted on lease churn.
 *   --lock-mode=none      never lock (fragile; for testing only).
 *
 * ── USAGE (dry-run is the default — NO writes) ────────────────────────────────
 *   DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... \
 *     node scripts/round68b-term-backfill-from-master.mjs --plan-out=r68b_term_plan.json
 *   # review the per-year counts + sample, then:
 *   ... node scripts/round68b-term-backfill-from-master.mjs --commit
 *
 * Flags: --master=FILE (default scripts/master_sales_comps_full.json),
 *        --day-tol=90 --price-tol=0.03 --cap-bp=5 --term-tol=1.5
 *        --lock-mode=all --allow-nocap --plan-out=FILE --commit
 *
 * Reversible: every write carries firm_term_source='master_curated'. To revert a
 * bad run (only rows this run touched, identified by the plan):
 *   node scripts/round68b-term-backfill-from-master.mjs --revert=r68b_term_plan.json --commit
 */
import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';

const A = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  if (!a.startsWith('--')) return [];
  const i = a.indexOf('='); return [[a.slice(2, i < 0 ? undefined : i), i < 0 ? true : a.slice(i + 1)]];
}));
const MASTER = A.master || 'scripts/master_sales_comps_full.json';
const COMMIT = A.commit === true || A.commit === 'true';
const DAY_TOL = parseInt(A['day-tol'] || '90', 10);
const PRICE_TOL = parseFloat(A['price-tol'] || '0.03');
const CAP_TOL = parseFloat(A['cap-bp'] || '5') / 10000;   // basis points -> decimal
const TERM_TOL = parseFloat(A['term-tol'] || '1.5');
const LOCK_MODE = A['lock-mode'] || 'all';                 // all | overrides | none
const ALLOW_NOCAP = A['allow-nocap'] === true || A['allow-nocap'] === 'true';
const PLAN_OUT = A['plan-out'] || 'r68b_term_plan.json';
const REVERT = A.revert || null;
const URL = process.env.DIA_SUPABASE_URL, KEY = process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY;
if (!URL || !KEY) { console.error('FATAL: DIA_SUPABASE_URL and DIA_SUPABASE_SERVICE_KEY required'); process.exit(1); }
if (!['all', 'overrides', 'none'].includes(LOCK_MODE)) { console.error(`FATAL: --lock-mode must be all|overrides|none`); process.exit(1); }

const DAY = 86400000;
const normCap = v => { if (v == null || v === '') return null; let c = Number(v); if (!isFinite(c)) return null; if (c > 1) c /= 100; return (c >= 0.04 && c <= 0.12) ? c : null; };
const normTerm = v => (v != null && isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 60) ? Number(v) : null;

async function rest(method, path, body) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: method === 'PATCH' ? 'return=minimal' : 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
async function pageAll(build) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const page = await rest('GET', build(off));
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

async function doRevert() {
  const plan = JSON.parse(readFileSync(REVERT, 'utf8'));
  const writes = (plan.rows || plan).filter(r => r.action === 'BACKFILL');
  console.log(`[revert] ${writes.length} rows | mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
  for (const w of writes) {
    // restore prior term + source; clear the lock this run may have set.
    const patch = {
      firm_term_years_at_sale: w.prev_term ?? null,
      firm_term_source: w.prev_source ?? null,
      firm_term_locked: w.prev_locked ?? false,
      firm_term_computed_at: new Date().toISOString(),
    };
    if (COMMIT) await rest('PATCH', `sales_transactions?sale_id=eq.${w.sale_id}`, patch);
  }
  console.log(COMMIT ? '[revert] COMMITTED.' : '[revert] DRY RUN — no writes.');
}

(async function main() {
  if (REVERT) return doRevert();

  // (1) master term-bearing candidate rows
  const master = JSON.parse(readFileSync(MASTER, 'utf8')).rows
    .map((r, i) => ({ i, state: String(r.state || '').toUpperCase().trim(), date: r.sale_date ? new Date(r.sale_date).getTime() : null,
      price: Number(r.sold_price), cap: normCap(r.sold_cap), term: normTerm(r.term_years) }))
    .filter(r => r.term != null && /^[A-Z]{2}$/.test(r.state) && r.date != null && r.price > 0);
  console.log(`[t1] ${master.length} master term-bearing rows | lock-mode=${LOCK_MODE} | cap-tol=${(CAP_TOL * 10000).toFixed(0)}bp | mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);

  // (2) property -> state, then market sales with original (untouched) source cap
  const props = await pageAll(off => `properties?select=property_id,state&order=property_id&limit=1000&offset=${off}`);
  const pstate = new Map(props.map(p => [p.property_id, (p.state || '').toUpperCase().trim()]));
  const sales = (await pageAll(off => `sales_transactions?select=sale_id,property_id,sale_date,sold_price,stated_cap_rate,cap_rate,firm_term_years_at_sale,firm_term_locked,firm_term_source,transaction_type,exclude_from_market_metrics&sold_price=gt.0&order=sale_id&limit=1000&offset=${off}`))
    .filter(s => s.sale_date && !s.exclude_from_market_metrics && (s.transaction_type == null || ['Investment', 'Resale'].includes(s.transaction_type)))
    .map(s => ({ sale_id: s.sale_id, state: pstate.get(s.property_id) || null, t: new Date(s.sale_date).getTime(), price: Number(s.sold_price),
      src_cap: s.stated_cap_rate != null ? Number(s.stated_cap_rate) : (s.cap_rate != null ? Number(s.cap_rate) : null),
      cur_term: s.firm_term_years_at_sale != null ? Number(s.firm_term_years_at_sale) : null,
      locked: !!s.firm_term_locked, source: s.firm_term_source, sale_date: s.sale_date }));
  console.log(`[t1] ${props.length} properties, ${sales.length} market sales loaded`);

  // index sales by state for a bounded scan
  const byState = new Map();
  for (const s of sales) { if (!s.state) continue; if (!byState.has(s.state)) byState.set(s.state, []); byState.get(s.state).push(s); }

  const usedSale = new Set();
  const plan = [];
  const c = { matched: 0, nocap_skipped: 0, no_match: 0, locked: 0, term_agrees: 0, backfill_null: 0, backfill_override: 0, sale_taken: 0 };

  // best identity match per master row (closest cap, then price, then date)
  for (const m of master) {
    const cands = (byState.get(m.state) || []).filter(s =>
      Math.abs(s.t - m.date) <= DAY_TOL * DAY && Math.abs(s.price - m.price) <= PRICE_TOL * m.price);
    if (!cands.length) { c.no_match++; continue; }
    const scored = cands.map(s => {
      const capDiff = (m.cap != null && s.src_cap != null) ? Math.abs(s.src_cap - m.cap) : null;
      return { s, capDiff, priceDiff: Math.abs(s.price - m.price), dayDiff: Math.abs(s.t - m.date) };
    }).sort((a, b) =>
      (a.capDiff ?? 1) - (b.capDiff ?? 1) || a.priceDiff - b.priceDiff || a.dayDiff - b.dayDiff);

    // identity gate: require cap agreement <= tol, unless --allow-nocap and master/our cap absent
    const best = scored.find(x => (x.capDiff != null && x.capDiff <= CAP_TOL) || (ALLOW_NOCAP && x.capDiff == null));
    if (!best) { (m.cap == null ? c.nocap_skipped++ : c.no_match++); continue; }
    if (usedSale.has(best.s.sale_id)) { c.sale_taken++; continue; }
    usedSale.add(best.s.sale_id);
    c.matched++;
    const S = best.s;
    if (S.locked) { c.locked++; plan.push({ i: m.i, sale_id: S.sale_id, action: 'SKIP_LOCKED' }); continue; }
    const isNull = S.cur_term == null;
    const isOverride = !isNull && Math.abs(S.cur_term - m.term) > TERM_TOL;
    if (!isNull && !isOverride) { c.term_agrees++; continue; }
    const klass = isNull ? 'NULL_FILL' : 'OVERRIDE';
    const lock = LOCK_MODE === 'all' ? true : (LOCK_MODE === 'overrides' ? isOverride : false);
    if (isNull) c.backfill_null++; else c.backfill_override++;
    const exp = new Date(S.t + m.term * 365.25 * DAY).toISOString().slice(0, 10);
    const patch = { firm_term_years_at_sale: Number(m.term.toFixed(4)), firm_term_expiration_at_sale: exp,
      firm_term_source: 'master_curated', firm_term_locked: lock, firm_term_computed_at: new Date().toISOString() };
    plan.push({ i: m.i, sale_id: S.sale_id, action: 'BACKFILL', class: klass, sale_date: S.sale_date,
      master_term: Number(m.term.toFixed(4)), prev_term: S.cur_term, prev_source: S.source, prev_locked: S.locked,
      cap_diff_bp: best.capDiff == null ? null : Number((best.capDiff * 10000).toFixed(1)), lock });
    if (COMMIT) await rest('PATCH', `sales_transactions?sale_id=eq.${S.sale_id}`, patch);
  }

  // per-year rollup of the writes
  const yr = {};
  for (const p of plan) { if (p.action !== 'BACKFILL') continue; const y = p.sale_date.slice(0, 4);
    yr[y] = yr[y] || { null_fill: 0, override: 0 }; yr[y][p.class === 'NULL_FILL' ? 'null_fill' : 'override']++; }

  console.log('\n[t1] SUMMARY'); console.table(c);
  console.log('\n[t1] BACKFILLS BY YEAR (null_fill / override):');
  for (const y of Object.keys(yr).sort()) console.log(`  ${y}  ${yr[y].null_fill} / ${yr[y].override}`);
  console.log('\n[t1] SAMPLE (first 20 backfills):');
  console.table(plan.filter(p => p.action === 'BACKFILL').slice(0, 20)
    .map(p => ({ sale_id: p.sale_id, date: p.sale_date, class: p.class, prev: p.prev_term, master: p.master_term, cap_bp: p.cap_diff_bp, lock: p.lock })));
  console.log(COMMIT ? '\n[t1] COMMITTED.' : '\n[t1] DRY RUN — no writes. Re-run with --commit.');
  writeFileSync(PLAN_OUT, JSON.stringify({ params: { DAY_TOL, PRICE_TOL, CAP_TOL, TERM_TOL, LOCK_MODE, ALLOW_NOCAP }, counts: c, by_year: yr, rows: plan }, null, 2));
  console.log(`[t1] plan -> ${PLAN_OUT}`);
})().catch(e => { console.error('[t1] FATAL', e); process.exit(1); });
