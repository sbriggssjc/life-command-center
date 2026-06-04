#!/usr/bin/env node
/**
 * DUP_REVIEW pass — Round 66x.2 Step 3 follow-up.
 *
 * The importer (import-master-unmatched-comps.mjs) flagged ~305 DUP_REVIEW rows:
 * a master deal whose (date,price) matched an EXISTING sale on a DIFFERENT
 * same-state property — i.e. the same transaction recorded against another
 * property record (a cross-property duplicate / property-merge candidate), with a
 * lower (CoStar/historical) cap that DILUTES the by-term cohort. This script
 * closes them out:
 *
 *   (a) CAP/TERM ADJUDICATION — for each DUP_REVIEW matched_sale_id, set the
 *       existing sale's cap + firm term to the MASTER receipt (master_curated,
 *       term locked). Master is the curated truth; this removes the dilution
 *       without inserting a twin (we update the one existing row).
 *   (b) PROPERTY MERGE — where the master deal also resolved to a candidate
 *       property (candidate_property_id) distinct from the twin's
 *       matched_property_id, merge the two records via the standard
 *       public.dia_merge_property(keep,drop) RPC (FK-rewires sales/leases,
 *       collision-dedups, deletes the drop). Survivor = the more-complete record
 *       (more sales; tiebreak lower id), mirroring dia_auto_merge's scoring.
 *       NOTE: the dia broad auto-merge path is a no-op for these (it only merges
 *       SAME-address, single-operator groups; these are different-address), so the
 *       explicit pair merge is required.
 *
 * Merges are deck-NEUTRAL (sales are repointed, not removed); (a) is the lever.
 *
 * INPUTS:
 *   --plan=plan.json        the importer's --plan-out file (has DUP_REVIEW rows
 *                           with i, matched_sale_id, matched_property_id,
 *                           candidate_property_id).
 *   --master=FILE           the same master export used for the import
 *                           (default scripts/master_sales_comps_full.json); the
 *                           row index `i` maps a DUP_REVIEW row -> master cap/term.
 * ENV: DIA_SUPABASE_URL, DIA_SUPABASE_SERVICE_KEY (or DIA_SUPABASE_KEY).
 *
 * USAGE (dry-run is the default — no writes):
 *   DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... \
 *     node scripts/dup-review-adjudicate.mjs --plan=plan.json
 *   # review, then:
 *   ... node scripts/dup-review-adjudicate.mjs --plan=plan.json --commit
 *   # adjudicate only (skip property merges): add --no-merge
 *
 * Reversible: cap/term writes carry cap_rate_source/firm_term_source='master_curated'.
 * Property merges (DROP) are NOT reversible — review the dry-run plan first.
 */
import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';

const A = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  if (!a.startsWith('--')) return [];
  const i = a.indexOf('='); return [[a.slice(2, i < 0 ? undefined : i), i < 0 ? true : a.slice(i + 1)]];
}));
const PLAN = A.plan, MASTER = A.master || 'scripts/master_sales_comps_full.json';
const COMMIT = A.commit === true || A.commit === 'true';
const NO_MERGE = A['no-merge'] === true || A['no-merge'] === 'true';
const URL = process.env.DIA_SUPABASE_URL, KEY = process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY;
if (!PLAN) { console.error('FATAL: --plan=plan.json required'); process.exit(1); }
if (!URL || !KEY) { console.error('FATAL: DIA_SUPABASE_URL and DIA_SUPABASE_SERVICE_KEY required'); process.exit(1); }

const normCap = v => { if (v == null || v === '') return null; let c = Number(v); if (!isFinite(c)) return null; if (c > 1) c /= 100; return (c >= 0.04 && c <= 0.12) ? Number(c.toFixed(5)) : null; };
const normTerm = v => (v != null && isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 60) ? Number(v) : null;

async function rest(method, path, body) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
const rpc = (fn, args) => rest('POST', `rpc/${fn}`, args);

(async function main() {
  const plan = JSON.parse(readFileSync(PLAN, 'utf8'));
  const master = JSON.parse(readFileSync(MASTER, 'utf8')).rows;
  const dups = (Array.isArray(plan) ? plan : plan.rows || []).filter(r => r.decision === 'DUP_REVIEW');
  console.log(`[dup-review] ${dups.length} DUP_REVIEW rows | mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'} | merges=${NO_MERGE ? 'OFF' : 'ON'}`);

  const out = [];
  const c = { adjudicated: 0, cap_set: 0, term_set: 0, no_master: 0, merges: 0, merge_skipped: 0, merge_failed: 0 };

  for (const d of dups) {
    const m = master[d.i];
    if (!m) { c.no_master++; out.push({ ...d, action: 'NO_MASTER_ROW' }); continue; }
    const cap = normCap(m.sold_cap), term = normTerm(m.term_years);
    // (a) adjudicate the existing matched sale to the master receipt
    const patch = {};
    if (cap != null) { patch.cap_rate = cap; patch.stated_cap_rate = cap; patch.cap_rate_final = cap; patch.cap_rate_source = 'master_curated'; patch.cap_rate_confidence = 'high'; }
    if (term != null) { patch.firm_term_years_at_sale = term; patch.firm_term_locked = true; patch.firm_term_source = 'master_curated'; }
    if (Object.keys(patch).length) {
      c.adjudicated++; if (cap != null) c.cap_set++; if (term != null) c.term_set++;
      out.push({ sale_id: d.matched_sale_id, action: 'ADJUDICATE', cap, term });
      if (COMMIT) await rest('PATCH', `sales_transactions?sale_id=eq.${d.matched_sale_id}`, patch);
    }
    // (b) merge candidate <-> matched property (different-address dup of one building)
    if (!NO_MERGE && d.candidate_property_id && d.matched_property_id && d.candidate_property_id !== d.matched_property_id) {
      try {
        // survivor = more sales (tiebreak lower id)
        const cnt = async pid => (await rest('GET', `sales_transactions?property_id=eq.${pid}&select=sale_id`)).length;
        const [na, nb] = await Promise.all([cnt(d.candidate_property_id), cnt(d.matched_property_id)]);
        const keep = (na > nb || (na === nb && d.candidate_property_id < d.matched_property_id)) ? d.candidate_property_id : d.matched_property_id;
        const drop = keep === d.candidate_property_id ? d.matched_property_id : d.candidate_property_id;
        out.push({ action: 'MERGE', keep, drop });
        if (COMMIT) { await rpc('dia_merge_property', { p_keep_id: keep, p_drop_id: drop }); }
        c.merges++;
      } catch (e) { c.merge_failed++; out.push({ action: 'MERGE_FAILED', candidate: d.candidate_property_id, matched: d.matched_property_id, error: String(e.message || e) }); }
    } else if (!NO_MERGE) { c.merge_skipped++; }
  }

  console.log('\n[dup-review] SUMMARY'); console.table(c);
  console.log(`  cap/term adjudicated: ${c.adjudicated} (cap ${c.cap_set}, term ${c.term_set}); no master row: ${c.no_master}`);
  console.log(`  property merges: ${c.merges} (skipped no-candidate: ${c.merge_skipped}, failed: ${c.merge_failed})`);
  console.log(COMMIT ? '\n[dup-review] COMMITTED.' : '\n[dup-review] DRY RUN — no writes. Re-run with --commit.');
  writeFileSync('dup_review_plan.json', JSON.stringify(out, null, 2));
  console.log('[dup-review] decisions -> dup_review_plan.json');
})().catch(e => { console.error('[dup-review] FATAL', e); process.exit(1); });
