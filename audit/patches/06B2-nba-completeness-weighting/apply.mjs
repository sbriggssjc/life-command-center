#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #6 Phase B-2: NBA queue completeness weighting.
//
// Phase B-1 (shipped earlier) persisted completeness_score + completeness_band
// to the properties table on both dia + gov, with a nightly refresh cron.
// Phase B-2 puts that cache to work: v_next_best_action now multiplies
// gap_value by a completeness factor so "near-finished" records rank higher.
//
// Multiplier table (applied to the existing per-gap-type gap_value):
//   excellent (90+)   → 1.50x
//   good      (70-89) → 1.25x
//   fair      (40-69) → 1.00x  (neutral — no change from previous behavior)
//   poor      (<40)   → 0.80x
//   NULL band          → 1.00x  (defensive)
//
// Why this matters: today's queue ranks two $5M missing_recorded_owner gaps
// identically. After this patch, the 75%-complete one ranks above the
// 30%-complete one because closing its single remaining gap unlocks a
// near-finished underwriting (the 30%-complete one has 5+ other gaps and
// closing this one doesn't make it usable).
//
// Verified live (2026-05-17) — gov top 5 after this patch:
//   #1 $990M missing_recorded_owner (fair-band, raw=$990M)
//   #2 $778M agency_drift            (excellent, raw=$519M, +1.5x)
//   #3 $569M llc_research_pending    (excellent, raw=$379M, +1.5x)
//   #4 $479M orphan_sale_owner       (excellent, raw=$319M, +1.5x)
//   #5 $479M orphan_sale_owner       (excellent, raw=$319M, +1.5x)
//
// API surface changes:
//   • gap_value is now the WEIGHTED value (rank reflects this).
//   • New column raw_gap_value preserves the pre-weighting figure.
//   • New columns completeness_band + completeness_score exposed for UI hints.
//   • Existing /api/admin?_route=next-best-action cross-domain merge picks up
//     the weighting automatically (it sorts by gap_value DESC, no code change).
//   • NBA Home rail (renders gap_value as the deal value) continues to work.
//
// Both migrations already applied via MCP. This patch commits the .sql files
// for repo provenance + updates AUDIT_PROGRESS.md.
//
// Branch: audit/06B2-nba-completeness-weighting
// ============================================================================

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf   = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
function toEol(s, eol) { return s.replace(/\r\n/g, '\n').replace(/\n/g, eol); }
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}
async function writeFileEnsuringDir(path, content, report, label) {
  if (DRY) { report.push([label, content.length, 'dry-run']); return; }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  report.push([label, content.length, 'written']);
}

const DIA_MIGRATION = String.raw`-- ============================================================================
-- Item #6 Phase B-2 (dia, 2026-05-17): completeness-weighted NBA queue.
--
-- Multiplies the existing per-gap-type gap_value by a completeness factor
-- so "near-finished" records' open gaps rank higher than same-dollar gaps
-- on mostly-empty records.
--
-- Multipliers (CASE on properties.completeness_band):
--   excellent → 1.50x   good → 1.25x   fair → 1.00x   poor → 0.80x   NULL → 1.00x
--
-- API surface:
--   • gap_value         — now the weighted value (rank reflects this)
--   • raw_gap_value     — pre-weighting (preserved for transparency)
--   • completeness_band — exposed for UI hints
--   • completeness_score— precise score for sort tiebreaks
-- ============================================================================
CREATE OR REPLACE VIEW public.v_next_best_action AS
WITH gaps AS (
  SELECT
    'missing_recorded_owner'::text                            AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'critical'::text
      WHEN COALESCE(v.rev_value, 0) >=  5000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0) >=  1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    dedup.property_id::text                                   AS gap_pk,
    NULL::text                                                AS entity_pk,
    dedup.property_id                                         AS property_id,
    dedup.address ||
      CASE WHEN dedup.dup_count > 1
        THEN ' [' || dedup.dup_count || ' dup records]'
        ELSE '' END                                           AS gap_label,
    'Research recorded owner for ' || dedup.address ||
      CASE WHEN dedup.dup_count > 1
        THEN ' (consolidate ' || dedup.dup_count || ' duplicate property records first)'
        ELSE '' END                                           AS suggested_action,
    COALESCE(v.rev_value, 1000000)::numeric * 2.0             AS raw_gap_value,
    COALESCE(dedup.updated_at, now())                         AS first_seen_at
  FROM (
    SELECT p.*,
      count(*)     OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state) AS dup_count,
      row_number() OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state ORDER BY p.property_id) AS rn
    FROM public.properties p
    WHERE p.recorded_owner_id IS NULL
      AND p.address IS NOT NULL AND length(trim(p.address)) >= 8
      AND p.address ~  '^\d' AND p.address !~ '^[\d\s]+$'
      AND p.address NOT ILIKE 'property #%'
  ) dedup
  LEFT JOIN public.v_property_value_signal v ON v.property_id = dedup.property_id
  WHERE dedup.rn = 1

  UNION ALL

  SELECT 'llc_research_pending'::text,
    CASE WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high' WHEN COALESCE(v.rev_value, 0) >= 3000000 THEN 'medium' ELSE 'low' END,
    q.queue_id::text, q.recorded_owner_id::text, q.property_id, q.search_name,
    'Research LLC manager/agent for ' || q.search_name,
    COALESCE(v.rev_value, 1000000)::numeric, q.created_at
  FROM public.llc_research_queue q
  LEFT JOIN public.v_property_value_signal v ON v.property_id = q.property_id
  WHERE q.status = 'queued'

  UNION ALL

  SELECT ('cms_chain_drift:' || g.drift_kind)::text,
    CASE WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high' WHEN COALESCE(v.rev_value, 0) >= 3000000 THEN 'medium' ELSE 'low' END,
    g.property_id::text, NULL::text, g.property_id,
    COALESCE(g.prop_tenant, '(no property tenant)') || ' vs CMS:' || g.cms_chain,
    CASE g.drift_kind
      WHEN 'cms_chain_but_property_tenant_null' THEN 'Back-fill property tenant from CMS chain: ' || g.cms_chain
      WHEN 'operator_transition_candidate'      THEN 'Verify operator transition: property says "' || g.prop_tenant || '", CMS says "' || g.cms_chain || '"'
      ELSE 'Resolve chain drift between property + CMS'
    END,
    COALESCE(v.rev_value, 1000000)::numeric * 1.5, now()
  FROM public.v_gap_chain_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id
  WHERE g.drift_kind IS NOT NULL

  UNION ALL

  SELECT 'lease_tenant_drift'::text,
    CASE WHEN COALESCE(v.rev_value, g.annual_rent * 10, 0) >= 5000000 THEN 'high'
         WHEN COALESCE(v.rev_value, g.annual_rent * 10, 0) >= 1000000 THEN 'medium' ELSE 'low' END,
    g.lease_id::text, NULL::text, g.property_id,
    'Lease:' || g.lease_tenant || ' vs Property:' || COALESCE(g.prop_tenant, '(null)'),
    'Back-fill properties.tenant from active lease tenant',
    COALESCE(v.rev_value, g.annual_rent * 10, 1000000)::numeric * 1.2, now()
  FROM public.v_gap_lease_tenant_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

  UNION ALL

  SELECT 'orphan_sale_owner'::text,
    CASE WHEN COALESCE(g.sold_price, v.rev_value, 0) >= 5000000 THEN 'medium' ELSE 'low' END,
    g.sale_id::text, g.property_recorded_owner_id::text, g.property_id,
    'Sale ' || g.sale_date::text || ' missing owner backlink',
    'Back-link sale to recorded_owner: ' || COALESCE(g.owner_name, '(unknown)'),
    (COALESCE(g.sold_price, v.rev_value, 1000000)::numeric) * 0.8,
    g.sale_date::timestamptz
  FROM public.v_gap_orphan_sale_owner g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

  UNION ALL

  SELECT 'stale_active_listing'::text,
    CASE WHEN COALESCE(al.last_price, al.initial_price, v.rev_value, 0) >= 5000000 THEN 'high'
         WHEN COALESCE(al.last_price, al.initial_price, v.rev_value, 0) >= 1000000 THEN 'medium' ELSE 'low' END,
    al.listing_id::text, NULL::text, al.property_id,
    COALESCE(p.address, 'listing #' || al.listing_id::text) || ' (last seen ' ||
      to_char(COALESCE(al.last_seen, al.listing_date), 'YYYY-MM-DD') || ')',
    'Re-verify listing status',
    COALESCE(al.last_price, al.initial_price, v.rev_value, 1000000)::numeric,
    COALESCE(al.last_seen, al.listing_date, now())
  FROM public.available_listings al
  LEFT JOIN public.properties p ON p.property_id = al.property_id
  LEFT JOIN public.v_property_value_signal v ON v.property_id = al.property_id
  WHERE al.is_active = true AND COALESCE(al.last_seen, al.listing_date) < (now() - interval '90 days')
),
weighted AS (
  SELECT g.*, p.completeness_band, p.completeness_score,
    (g.raw_gap_value * CASE p.completeness_band
       WHEN 'excellent' THEN 1.50 WHEN 'good' THEN 1.25
       WHEN 'fair' THEN 1.00 WHEN 'poor' THEN 0.80 ELSE 1.00 END)::numeric AS weighted_gap_value
  FROM gaps g LEFT JOIN public.properties p ON p.property_id = g.property_id
)
SELECT
  ROW_NUMBER() OVER (ORDER BY weighted_gap_value DESC NULLS LAST, first_seen_at ASC) AS rank,
  gap_type, gap_severity, gap_pk, entity_pk, property_id,
  gap_label, suggested_action,
  weighted_gap_value AS gap_value,
  first_seen_at,
  raw_gap_value,
  completeness_band,
  completeness_score
FROM weighted;

COMMENT ON VIEW public.v_next_best_action IS
  'Item #6 Phase B-2 (2026-05-17): completeness-weighted NBA queue. '
  'gap_value is now completeness-weighted (excellent 1.5x, good 1.25x, '
  'fair 1.0x, poor 0.8x). raw_gap_value preserves pre-weighting figure. '
  'Ranking uses weighted_gap_value DESC.';
`;

const GOV_MIGRATION = String.raw`-- ============================================================================
-- Item #6 Phase B-2 (gov, 2026-05-17): completeness-weighted NBA queue.
-- Gov mirror of dia. Differences from dia source views:
--   • cms_chain_drift  → agency_drift   (different drift surface on gov)
--   • lease_tenant_drift not present in gov
--   • available_listings filters by listing_status='Active' (not is_active)
--   • available_listings uses asking_price (not initial_price) + last_seen_at
-- ============================================================================
CREATE OR REPLACE VIEW public.v_next_best_action AS
WITH gaps AS (
  SELECT
    'missing_recorded_owner'::text                            AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'critical'::text
      WHEN COALESCE(v.rev_value, 0) >=  5000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0) >=  1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    dedup.property_id::text                                   AS gap_pk,
    NULL::text                                                AS entity_pk,
    dedup.property_id                                         AS property_id,
    dedup.address ||
      CASE WHEN dedup.dup_count > 1
        THEN ' [' || dedup.dup_count || ' dup records]'
        ELSE '' END                                           AS gap_label,
    'Research recorded owner for ' || dedup.address ||
      CASE WHEN dedup.dup_count > 1
        THEN ' (consolidate ' || dedup.dup_count || ' duplicate property records first)'
        ELSE '' END                                           AS suggested_action,
    COALESCE(v.rev_value, 1000000)::numeric * 2.0             AS raw_gap_value,
    COALESCE(dedup.updated_at, now())                         AS first_seen_at
  FROM (
    SELECT p.*,
      count(*)     OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state) AS dup_count,
      row_number() OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state ORDER BY p.property_id) AS rn
    FROM public.properties p
    WHERE p.recorded_owner_id IS NULL
      AND p.address IS NOT NULL AND length(trim(p.address)) >= 8
      AND p.address ~  '^\d' AND p.address !~ '^[\d\s]+$'
      AND p.address NOT ILIKE 'property #%'
  ) dedup
  LEFT JOIN public.v_property_value_signal v ON v.property_id = dedup.property_id
  WHERE dedup.rn = 1

  UNION ALL

  SELECT 'llc_research_pending'::text,
    CASE WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high' WHEN COALESCE(v.rev_value, 0) >= 3000000 THEN 'medium' ELSE 'low' END,
    q.queue_id::text, q.recorded_owner_id::text, q.property_id, q.search_name,
    'Research LLC manager/agent for ' || q.search_name,
    COALESCE(v.rev_value, 1000000)::numeric, q.created_at
  FROM public.llc_research_queue q
  LEFT JOIN public.v_property_value_signal v ON v.property_id = q.property_id
  WHERE q.status = 'queued'

  UNION ALL

  SELECT ('agency_drift:' || g.drift_kind)::text,
    CASE WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high' WHEN COALESCE(v.rev_value, 0) >= 3000000 THEN 'medium' ELSE 'low' END,
    g.property_id::text, NULL::text, g.property_id,
    COALESCE(g.prop_agency, '(no property agency)') || ' vs Lease:' || g.lease_tenant_agency,
    CASE g.drift_kind
      WHEN 'lease_agency_but_property_agency_null' THEN 'Back-fill properties.agency from lease tenant: ' || g.lease_tenant_agency
      WHEN 'agency_disagreement' THEN 'Resolve agency drift: property says "' || g.prop_agency || '", lease says "' || g.lease_tenant_agency || '"'
      ELSE 'Verify agency record'
    END,
    COALESCE(v.rev_value, 1000000)::numeric * 1.3, now()
  FROM public.v_gap_agency_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id
  WHERE g.drift_kind IS NOT NULL

  UNION ALL

  SELECT 'orphan_sale_owner'::text,
    CASE WHEN COALESCE(g.sold_price, v.rev_value, 0) >= 5000000 THEN 'medium' ELSE 'low' END,
    g.sale_id::text, g.property_recorded_owner_id::text, g.property_id,
    'Sale ' || g.sale_date::text || ' missing owner backlink',
    'Back-link sale to recorded_owner: ' || COALESCE(g.owner_name, '(unknown)'),
    (COALESCE(g.sold_price, v.rev_value, 1000000)::numeric) * 0.8,
    g.sale_date::timestamptz
  FROM public.v_gap_orphan_sale_owner g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

  UNION ALL

  SELECT 'stale_active_listing'::text,
    CASE WHEN COALESCE(al.last_price, al.asking_price, v.rev_value, 0) >= 5000000 THEN 'high'
         WHEN COALESCE(al.last_price, al.asking_price, v.rev_value, 0) >= 1000000 THEN 'medium' ELSE 'low' END,
    al.listing_id::text, NULL::text, al.property_id,
    COALESCE(p.address, 'listing #' || al.listing_id::text) || ' (last seen ' ||
      to_char(COALESCE(al.last_seen_at, al.listing_date::timestamptz), 'YYYY-MM-DD') || ')',
    'Re-verify listing status',
    COALESCE(al.last_price, al.asking_price, v.rev_value, 1000000)::numeric,
    COALESCE(al.last_seen_at, al.listing_date::timestamptz, now())
  FROM public.available_listings al
  LEFT JOIN public.properties p ON p.property_id = al.property_id
  LEFT JOIN public.v_property_value_signal v ON v.property_id = al.property_id
  WHERE al.listing_status = 'Active' AND COALESCE(al.last_seen_at, al.listing_date::timestamptz) < (now() - interval '90 days')
),
weighted AS (
  SELECT g.*, p.completeness_band, p.completeness_score,
    (g.raw_gap_value * CASE p.completeness_band
       WHEN 'excellent' THEN 1.50 WHEN 'good' THEN 1.25
       WHEN 'fair' THEN 1.00 WHEN 'poor' THEN 0.80 ELSE 1.00 END)::numeric AS weighted_gap_value
  FROM gaps g LEFT JOIN public.properties p ON p.property_id = g.property_id
)
SELECT
  ROW_NUMBER() OVER (ORDER BY weighted_gap_value DESC NULLS LAST, first_seen_at ASC) AS rank,
  gap_type, gap_severity, gap_pk, entity_pk, property_id,
  gap_label, suggested_action,
  weighted_gap_value AS gap_value,
  first_seen_at,
  raw_gap_value,
  completeness_band,
  completeness_score
FROM weighted;

COMMENT ON VIEW public.v_next_best_action IS
  'Item #6 Phase B-2 (2026-05-17): completeness-weighted NBA queue. '
  'Gov mirror of dia. gap_value is completeness-weighted (excellent 1.5x, '
  'good 1.25x, fair 1.0x, poor 0.8x). raw_gap_value preserves pre-weighting figure.';
`;

async function writeDiaMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260517280000_dia_nba_completeness_weighting.sql');
  await writeFileEnsuringDir(path, DIA_MIGRATION, report,
    'supabase/migrations/dialysis/20260517280000_dia_nba_completeness_weighting.sql');
}

async function writeGovMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260517280000_gov_nba_completeness_weighting.sql');
  await writeFileEnsuringDir(path, GOV_MIGRATION, report,
    'supabase/migrations/government/20260517280000_gov_nba_completeness_weighting.sql');
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 6 Phase B-2 — NBA queue completeness weighting
- **Status:** ✅ DONE (B-2 of 3). B-3 (list-sort UI) queued as follow-up.
- **Branch:** \`audit/06B2-nba-completeness-weighting\`
- **Patch:** \`audit/patches/06B2-nba-completeness-weighting/apply.mjs\`
- **Closes:** the NBA-weighting half of B-15.

### What this adds
The \`v_next_best_action\` view on both dia + gov now multiplies the per-gap-type \`gap_value\` by a completeness factor sourced from the persisted \`properties.completeness_band\` column (Phase B-1).

| Band | Multiplier | Rationale |
|---|---|---|
| excellent (90+) | 1.50x | Closing this gap finishes the underwriting |
| good (70–89)    | 1.25x | Closing this gap brings it close to done |
| fair (40–69)    | 1.00x | Neutral (unchanged from previous behavior) |
| poor (<40)      | 0.80x | Many other gaps remain; less leverage |
| NULL band       | 1.00x | Defensive (any property without persisted band) |

### API surface changes
- \`gap_value\` is now the **weighted** value. Ranking + sorting reflect this.
- New column \`raw_gap_value\` preserves the pre-weighting figure for transparency.
- New column \`completeness_band\` exposed so the UI can render a band chip.
- New column \`completeness_score\` exposed for precise sort tiebreaks.
- Existing \`/api/admin?_route=next-best-action\` cross-domain merge sorts by \`gap_value\` DESC → picks up the weighting automatically with **zero code change**.
- NBA Home rail (renders \`gap_value\` as the deal value) continues to work.

### Live verification (gov top 5 after this patch)
\`\`\`
#1 missing_recorded_owner   fair       weighted=$990M   raw=$990M  1.0x
#2 agency_drift:disagreement excellent weighted=$778M   raw=$519M  +1.5x
#3 llc_research_pending     excellent  weighted=$569M   raw=$379M  +1.5x
#4 orphan_sale_owner        excellent  weighted=$479M   raw=$319M  +1.5x
#5 orphan_sale_owner        excellent  weighted=$479M   raw=$319M  +1.5x
\`\`\`
The $990M raw outlier (fair-band) stays #1, but the rest of the top 5 are all **excellent-band** properties that got promoted by the 1.5x multiplier — exactly the desired effect.

### Files changed
- \`supabase/migrations/dialysis/20260517280000_dia_nba_completeness_weighting.sql\` (already applied via MCP)
- \`supabase/migrations/government/20260517280000_gov_nba_completeness_weighting.sql\` (already applied via MCP)
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification queries
\`\`\`sql
-- Confirm the new columns are exposed
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='v_next_best_action'
 ORDER BY ordinal_position;
-- Should include: gap_value, raw_gap_value, completeness_band, completeness_score

-- Spot-check the weighting math
SELECT rank, completeness_band, gap_value::bigint AS weighted, raw_gap_value::bigint AS raw,
       round((gap_value / NULLIF(raw_gap_value,0))::numeric, 2) AS multiplier
  FROM public.v_next_best_action ORDER BY rank LIMIT 15;
-- multiplier column should show 0.80 / 1.00 / 1.25 / 1.50 depending on band.
\`\`\`

### Phase B-3 follow-up (the last piece of Item #6 Phase B)
- "Sort by: Value · Date · Completeness" toggle on dia + gov list views, with localStorage persistence keyed by table.
- Completeness-band chip visible inline in list rows.
- Now cheap because the persisted column from B-1 is indexed.

`);

  const preflightAnchor = N('\n# Sprint preflight — 2026-05-17\n');
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, () => appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }
  if (c === original) { report.push(['AUDIT_PROGRESS.md', 0, 'no changes']); return; }
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Audit Sprint — Item #6 Phase B-2 (NBA completeness weighting) ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await writeDiaMigration(report);
  await writeGovMigration(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(85) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
