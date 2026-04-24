#!/usr/bin/env node
// ============================================================================
// scripts/retry-stuck-intakes.mjs
//
// Recovery for Bug A (2026-04-24): Copilot intake path races
// processIntakeExtraction against a 7s timeout. When the AI extractor runs
// long (8-9s), the extraction row gets written BUT the matcher call after
// it is killed when Vercel terminates the isolate at the 10s hard limit.
//
// Effect in DB:
//   - staged_intake_extractions row exists
//   - staged_intake_matches row does NOT exist
//   - staged_intake_items.status is stuck at 'review_required'
//
// This script re-POSTs the stuck intakes to /api/intake-extract, which has
// its own fresh 10s budget. processIntakeExtraction is idempotent for
// extractions (upsert) and harmless-to-dupe for matches (query uses latest).
//
// Usage:
//   node scripts/retry-stuck-intakes.mjs                  # dry run, 14 days
//   node scripts/retry-stuck-intakes.mjs --apply
//   node scripts/retry-stuck-intakes.mjs --apply --days 7
//   node scripts/retry-stuck-intakes.mjs --apply --ids abc123,def456
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const DAYS = (() => {
  const i = argv.indexOf('--days');
  if (i === -1) return 14;
  const n = parseInt(argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
})();
const EXPLICIT_IDS = (() => {
  const i = argv.indexOf('--ids');
  if (i === -1) return null;
  return String(argv[i + 1] || '').split(',').map(s => s.trim()).filter(Boolean);
})();

const OPS_URL     = env.OPS_SUPABASE_URL;
const OPS_KEY     = env.OPS_SUPABASE_KEY;
const LCC_API_KEY = env.LCC_API_KEY;
const LCC_APP_URL = env.LCC_APP_URL || env.LCC_BASE_URL || 'https://life-command-center.vercel.app';

if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS_SUPABASE_URL / OPS_SUPABASE_KEY'); process.exit(1); }
if (APPLY && !LCC_API_KEY) { console.error('Missing LCC_API_KEY (needed to POST to /api/intake-extract)'); process.exit(1); }

// Normalize base URL: accept bare host or full URL
const BASE = LCC_APP_URL.startsWith('http') ? LCC_APP_URL : `https://${LCC_APP_URL}`;

async function ops(method, path, body) {
  const res = await fetch(`${OPS_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: OPS_KEY,
      Authorization: `Bearer ${OPS_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'count=exact',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function postExtract(intakeId) {
  const url = `${BASE}/api/intake-extract?intake_id=${encodeURIComponent(intakeId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-LCC-Key': LCC_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ intake_id: intakeId }),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function findStuck() {
  if (EXPLICIT_IDS) {
    console.log(`[retry-stuck-intakes] Using --ids override: ${EXPLICIT_IDS.join(', ')}`);
    const rows = [];
    for (const id of EXPLICIT_IDS) {
      const r = await ops('GET', `staged_intake_items?intake_id=eq.${encodeURIComponent(id)}&select=intake_id,status,created_at`);
      if (r.ok && r.data?.length) rows.push(r.data[0]);
    }
    return rows;
  }

  const sinceIso = new Date(Date.now() - DAYS * 86400000).toISOString();
  console.log(`[retry-stuck-intakes] Finding stuck intakes since ${sinceIso}`);

  const list = await ops('GET',
    `staged_intake_items?created_at=gte.${encodeURIComponent(sinceIso)}` +
    `&status=eq.review_required` +
    `&select=intake_id,status,created_at` +
    `&order=created_at.desc&limit=100`
  );
  if (!list.ok) { console.error('fetch failed', list.status, list.data); process.exit(1); }

  const stuck = [];
  for (const r of list.data || []) {
    // has extraction?
    const ex = await ops('GET',
      `staged_intake_extractions?intake_id=eq.${encodeURIComponent(r.intake_id)}` +
      `&select=document_type,extraction_snapshot&limit=1`
    );
    const hasExtraction = ex.ok && ex.data?.length > 0;
    if (!hasExtraction) continue;  // no extraction → different bug, not this one

    const snap = ex.data[0]?.extraction_snapshot || {};
    const docType = ex.data[0]?.document_type || snap.document_type;
    // Only retry real deal docs with address/tenant data — skip signature noise + unknown junk
    if (!['om', 'flyer', 'lease_abstract', 'rent_roll', 'marketing_brochure'].includes(docType)) continue;
    if (!snap.address && !snap.tenant_name) continue;

    // Match row present?
    const mt = await ops('GET',
      `staged_intake_matches?intake_id=eq.${encodeURIComponent(r.intake_id)}` +
      `&select=decision,domain,property_id&order=created_at.desc&limit=1`
    );
    const hasMatch = mt.ok && mt.data?.length > 0;
    const match = hasMatch ? mt.data[0] : null;

    // Promotion row present?
    const pr = await ops('GET',
      `staged_intake_promotions?intake_id=eq.${encodeURIComponent(r.intake_id)}&select=entity_id&limit=1`
    );
    const hasPromotion = pr.ok && pr.data?.length > 0;

    // Classify the drop-out:
    //   - no match row + good extraction → Bug A (matcher killed by 10s cap)
    //   - auto_matched but no promotion row → Bug B (promoter killed by 10s cap)
    let dropOut = null;
    if (!hasMatch)                                  dropOut = 'no_match_row';
    else if (match.decision === 'auto_matched' && !hasPromotion) dropOut = 'matched_not_promoted';
    else continue;  // needs_review or already promoted — don't touch

    stuck.push({
      ...r,
      docType,
      address: snap.address,
      state: snap.state,
      tenant: snap.tenant_name,
      dropOut,
    });
  }
  return stuck;
}

async function main() {
  console.log(`[retry-stuck-intakes] apply=${APPLY} base=${BASE}`);
  const stuck = await findStuck();
  console.log(`\nFound ${stuck.length} stuck intakes (extracted, no match row):\n`);

  for (const s of stuck) {
    console.log(`  ${s.intake_id.slice(0, 8)}…  [${s.dropOut.padEnd(22)}]  ${s.docType}  ${s.address || '—'} ${s.state || ''}  ${s.tenant || '—'}`);
  }

  if (!APPLY) {
    console.log('\n[retry-stuck-intakes] Dry run — re-run with --apply to POST /api/intake-extract');
    return;
  }

  console.log('\n[retry-stuck-intakes] Retrying...\n');
  const results = { ok: 0, err: 0 };
  for (const s of stuck) {
    process.stdout.write(`  ${s.intake_id.slice(0, 8)}…  `);
    const r = await postExtract(s.intake_id);
    if (r.ok) {
      results.ok++;
      const match = r.data?.match_result || null;
      const prom  = r.data?.promotion_result || null;
      const reused = r.data?.extraction_count === 0 ? 'cached' : 'fresh';
      if (prom?.ok) {
        console.log(`ok  [${reused}]  match=${match?.status}/${match?.reason}/${match?.confidence}  prom=yes`);
      } else {
        const why = prom?.skipped || prom?.error || 'no_prom_result';
        console.log(`ok  [${reused}]  match=${match?.status}/${match?.reason}/${match?.confidence}  prom=SKIP(${why})`);
        if (prom && Object.keys(prom).length > 2) {
          // Print full JSON without truncation — the actual failure detail
          // from PostgREST lives deep in the response and truncation hides it.
          console.log(`     prom=${JSON.stringify(prom, null, 2)}`);
        }
      }
    } else {
      results.err++;
      console.log(`err status=${r.status}  ${JSON.stringify(r.data).slice(0, 200)}`);
    }
    // 300ms between requests — don't hammer the endpoint, AI extractions are expensive
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n[retry-stuck-intakes] done', results);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
