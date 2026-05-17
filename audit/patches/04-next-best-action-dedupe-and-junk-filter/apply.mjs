#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #4 v3.2: dedupe by address + filter junk
// Closes Discovery #4 (junk records) + Discovery #5 (duplicate property
// records at same address). Migrations already live on dia + gov via
// Supabase MCP at 2026-05-17. This patch commits the .sql to repo.
// Branch: audit/04-dedupe-and-junk-filter
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
  const lf = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function writeDiaMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260517220000_dia_next_best_action_dedupe_and_junk_filter.sql');
  const SQL = String.raw`-- ============================================================================
-- Item #4 v3.2 (dia, 2026-05-17): dedupe missing_recorded_owner by address
-- + filter junk-address phantom records.
--
-- Closes Discovery #4 (junk records) + Discovery #5 (duplicates at same
-- address). Both surfaced by the v3 NOI/cap fix when the top of the
-- ranked queue exposed:
--   • Garbage addresses ("property #13900", "Juru Pa Va Lley",
--     "15 5 2 2 2 4 3 2 4", "License: Fl") — phantom records.
--   • 7 distinct property_ids all at "6120 S. Yale Ave., Ste. 300"
--     (Tulsa) — same physical property, 7 queue rows wasting time.
--
-- Address quality predicate:
--   • IS NOT NULL and >= 8 chars after trim
--   • Starts with a digit (real US street addresses begin with a number)
--   • NOT pure digits + whitespace
--   • NOT starting with "property #" placeholder
--
-- Dedupe: PARTITION BY lower(trim(address)), lower(trim(city)), state.
-- Keep smallest property_id per group. Surface dup_count > 1 inline in
-- gap_label so Scott sees "[N dup records]" at a glance, and the
-- suggested_action prompts him to consolidate first.
--
-- Result on dia: missing_recorded_owner dropped 13,338 → 10,115 rows.
-- ============================================================================
CREATE OR REPLACE VIEW public.v_next_best_action AS
WITH gaps AS (
  -- 1. missing_recorded_owner (deduped + junk-filtered)
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
    COALESCE(v.rev_value, 1000000)::numeric * 2.0             AS gap_value,
    COALESCE(dedup.updated_at, now())                         AS first_seen_at
  FROM (
    SELECT
      p.*,
      count(*)     OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state) AS dup_count,
      row_number() OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state ORDER BY p.property_id) AS rn
    FROM public.properties p
    WHERE p.recorded_owner_id IS NULL
      AND p.address           IS NOT NULL
      AND length(trim(p.address)) >= 8
      AND p.address ~  '^\d'
      AND p.address !~ '^[\d\s]+$'
      AND p.address NOT ILIKE 'property #%'
  ) dedup
  LEFT JOIN public.v_property_value_signal v ON v.property_id = dedup.property_id
  WHERE dedup.rn = 1

  UNION ALL

  SELECT
    'llc_research_pending'::text                              AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    q.queue_id::text                                          AS gap_pk,
    q.recorded_owner_id::text                                 AS entity_pk,
    q.property_id                                             AS property_id,
    q.search_name                                             AS gap_label,
    'Research LLC manager/agent for ' || q.search_name        AS suggested_action,
    COALESCE(v.rev_value, 1000000)::numeric                   AS gap_value,
    q.created_at                                              AS first_seen_at
  FROM public.llc_research_queue q
  LEFT JOIN public.v_property_value_signal v ON v.property_id = q.property_id
  WHERE q.status = 'queued'

  UNION ALL

  SELECT
    ('cms_chain_drift:' || g.drift_kind)::text                AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    g.property_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    g.property_id                                             AS property_id,
    COALESCE(g.prop_tenant, '(no property tenant)') || ' vs CMS:' || g.cms_chain AS gap_label,
    CASE g.drift_kind
      WHEN 'cms_chain_but_property_tenant_null' THEN 'Back-fill property tenant from CMS chain: ' || g.cms_chain
      WHEN 'operator_transition_candidate'      THEN 'Verify operator transition: property says "' || g.prop_tenant || '", CMS says "' || g.cms_chain || '"'
      ELSE 'Resolve chain drift between property + CMS'
    END                                                       AS suggested_action,
    COALESCE(v.rev_value, 1000000)::numeric * 1.5             AS gap_value,
    now()                                                     AS first_seen_at
  FROM public.v_gap_chain_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id
  WHERE g.drift_kind IS NOT NULL

  UNION ALL

  SELECT
    'lease_tenant_drift'::text                                AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, g.annual_rent * 10, 0) >= 5000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, g.annual_rent * 10, 0) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    g.lease_id::text                                          AS gap_pk,
    NULL::text                                                AS entity_pk,
    g.property_id                                             AS property_id,
    'Lease:' || g.lease_tenant || ' vs Property:' || COALESCE(g.prop_tenant, '(null)') AS gap_label,
    'Back-fill properties.tenant from active lease tenant'    AS suggested_action,
    COALESCE(v.rev_value, g.annual_rent * 10, 1000000)::numeric * 1.2 AS gap_value,
    now()                                                     AS first_seen_at
  FROM public.v_gap_lease_tenant_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

  UNION ALL

  SELECT
    'orphan_sale_owner'::text                                 AS gap_type,
    CASE
      WHEN COALESCE(g.sold_price, v.rev_value, 0) >= 5000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    g.sale_id::text                                           AS gap_pk,
    g.property_recorded_owner_id::text                        AS entity_pk,
    g.property_id                                             AS property_id,
    'Sale ' || g.sale_date::text || ' missing owner backlink' AS gap_label,
    'Back-link sale to recorded_owner: ' || COALESCE(g.owner_name, '(unknown)') AS suggested_action,
    (COALESCE(g.sold_price, v.rev_value, 1000000)::numeric) * 0.8 AS gap_value,
    g.sale_date::timestamptz                                  AS first_seen_at
  FROM public.v_gap_orphan_sale_owner g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

  UNION ALL

  SELECT
    'stale_active_listing'::text                              AS gap_type,
    CASE
      WHEN COALESCE(al.last_price, al.initial_price, v.rev_value, 0) >= 5000000 THEN 'high'::text
      WHEN COALESCE(al.last_price, al.initial_price, v.rev_value, 0) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    al.listing_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    al.property_id                                            AS property_id,
    COALESCE(p.address, 'listing #' || al.listing_id::text) || ' (last seen ' ||
      to_char(COALESCE(al.last_seen, al.listing_date), 'YYYY-MM-DD') || ')' AS gap_label,
    'Re-verify listing status'                                AS suggested_action,
    COALESCE(al.last_price, al.initial_price, v.rev_value, 1000000)::numeric AS gap_value,
    COALESCE(al.last_seen, al.listing_date, now())            AS first_seen_at
  FROM public.available_listings al
  LEFT JOIN public.properties p ON p.property_id = al.property_id
  LEFT JOIN public.v_property_value_signal v ON v.property_id = al.property_id
  WHERE al.is_active = true
    AND COALESCE(al.last_seen, al.listing_date) < (now() - interval '90 days')
)
SELECT
  ROW_NUMBER() OVER (ORDER BY gap_value DESC NULLS LAST, first_seen_at ASC) AS rank,
  gap_type, gap_severity, gap_pk, entity_pk, property_id,
  gap_label, suggested_action, gap_value, first_seen_at
FROM gaps;
`;
  if (DRY) {
    report.push(['supabase/migrations/dialysis/20260517220000_dia_next_best_action_dedupe_and_junk_filter.sql', SQL.length, 'dry-run']);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SQL, 'utf8');
  report.push(['supabase/migrations/dialysis/20260517220000_dia_next_best_action_dedupe_and_junk_filter.sql', SQL.length, 'written']);
}

async function writeGovMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260517220000_gov_next_best_action_dedupe_and_junk_filter.sql');
  const SQL = String.raw`-- ============================================================================
-- Item #4 v3.2 (gov, 2026-05-17): dedupe + junk filter (gov mirror).
-- Same approach as dia. Surfaces dup_count inline in gap_label.
-- Example output from production: "6120 S. Yale Ave., Ste. 300 [7 dup records]"
-- ============================================================================
CREATE OR REPLACE VIEW public.v_next_best_action AS
WITH gaps AS (
  -- 1. missing_recorded_owner (deduped + junk-filtered)
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
    COALESCE(v.rev_value, 1000000)::numeric * 2.0             AS gap_value,
    COALESCE(dedup.updated_at, now())                         AS first_seen_at
  FROM (
    SELECT
      p.*,
      count(*)     OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state) AS dup_count,
      row_number() OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state ORDER BY p.property_id) AS rn
    FROM public.properties p
    WHERE p.recorded_owner_id IS NULL
      AND p.address           IS NOT NULL
      AND length(trim(p.address)) >= 8
      AND p.address ~  '^\d'
      AND p.address !~ '^[\d\s]+$'
      AND p.address NOT ILIKE 'property #%'
  ) dedup
  LEFT JOIN public.v_property_value_signal v ON v.property_id = dedup.property_id
  WHERE dedup.rn = 1

  UNION ALL

  SELECT
    'llc_research_pending'::text                              AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    q.queue_id::text                                          AS gap_pk,
    q.recorded_owner_id::text                                 AS entity_pk,
    q.property_id                                             AS property_id,
    q.search_name                                             AS gap_label,
    'Research LLC manager/agent for ' || q.search_name        AS suggested_action,
    COALESCE(v.rev_value, 1000000)::numeric                   AS gap_value,
    q.created_at                                              AS first_seen_at
  FROM public.llc_research_queue q
  LEFT JOIN public.v_property_value_signal v ON v.property_id = q.property_id
  WHERE q.status = 'queued'

  UNION ALL

  SELECT
    ('agency_drift:' || g.drift_kind)::text                   AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    g.property_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    g.property_id                                             AS property_id,
    COALESCE(g.prop_agency, '(no property agency)') || ' vs Lease:' || g.lease_tenant_agency AS gap_label,
    CASE g.drift_kind
      WHEN 'lease_agency_but_property_agency_null' THEN 'Back-fill properties.agency from lease tenant: ' || g.lease_tenant_agency
      WHEN 'agency_disagreement'                   THEN 'Resolve agency drift: property says "' || g.prop_agency || '", lease says "' || g.lease_tenant_agency || '"'
      ELSE 'Verify agency record'
    END                                                       AS suggested_action,
    COALESCE(v.rev_value, 1000000)::numeric * 1.3             AS gap_value,
    now()                                                     AS first_seen_at
  FROM public.v_gap_agency_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id
  WHERE g.drift_kind IS NOT NULL

  UNION ALL

  SELECT
    'orphan_sale_owner'::text                                 AS gap_type,
    CASE
      WHEN COALESCE(g.sold_price, v.rev_value, 0) >= 5000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    g.sale_id::text                                           AS gap_pk,
    g.property_recorded_owner_id::text                        AS entity_pk,
    g.property_id                                             AS property_id,
    'Sale ' || g.sale_date::text || ' missing owner backlink' AS gap_label,
    'Back-link sale to recorded_owner: ' || COALESCE(g.owner_name, '(unknown)') AS suggested_action,
    (COALESCE(g.sold_price, v.rev_value, 1000000)::numeric) * 0.8 AS gap_value,
    g.sale_date::timestamptz                                  AS first_seen_at
  FROM public.v_gap_orphan_sale_owner g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

  UNION ALL

  SELECT
    'stale_active_listing'::text                              AS gap_type,
    CASE
      WHEN COALESCE(al.last_price, al.asking_price, v.rev_value, 0) >= 5000000 THEN 'high'::text
      WHEN COALESCE(al.last_price, al.asking_price, v.rev_value, 0) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    al.listing_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    al.property_id                                            AS property_id,
    COALESCE(p.address, 'listing #' || al.listing_id::text) || ' (last seen ' ||
      to_char(COALESCE(al.last_seen_at, al.listing_date), 'YYYY-MM-DD') || ')' AS gap_label,
    'Re-verify listing status'                                AS suggested_action,
    COALESCE(al.last_price, al.asking_price, v.rev_value, 1000000)::numeric AS gap_value,
    COALESCE(al.last_seen_at, al.listing_date, now())         AS first_seen_at
  FROM public.available_listings al
  LEFT JOIN public.properties p ON p.property_id = al.property_id
  LEFT JOIN public.v_property_value_signal v ON v.property_id = al.property_id
  WHERE al.listing_status = 'Active'
    AND COALESCE(al.last_seen_at, al.listing_date) < (now() - interval '90 days')
)
SELECT
  ROW_NUMBER() OVER (ORDER BY gap_value DESC NULLS LAST, first_seen_at ASC) AS rank,
  gap_type, gap_severity, gap_pk, entity_pk, property_id,
  gap_label, suggested_action, gap_value, first_seen_at
FROM gaps;
`;
  if (DRY) {
    report.push(['supabase/migrations/government/20260517220000_gov_next_best_action_dedupe_and_junk_filter.sql', SQL.length, 'dry-run']);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SQL, 'utf8');
  report.push(['supabase/migrations/government/20260517220000_gov_next_best_action_dedupe_and_junk_filter.sql', SQL.length, 'written']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 4 v3.2 — dedupe + junk filter on missing_recorded_owner
- **Status:** ✅ DONE (live on dia + gov)
- **Branch:** \`audit/04-dedupe-and-junk-filter\`
- **Patch:** \`audit/patches/04-next-best-action-dedupe-and-junk-filter/apply.mjs\`
- **Closes:** Discovery #4 (junk property records) + Discovery #5 (duplicate property records at same address) — both surfaced by the v3 NOI/cap fix.

### Cleanup applied to v_next_best_action.missing_recorded_owner
- **Address quality predicate:** must be NOT NULL, ≥ 8 chars after trim, start with a digit, not pure digits + whitespace, not start with "property #".
- **Dedupe:** PARTITION BY \`lower(trim(address)), lower(trim(city)), state\` → keep smallest property_id per group. Surface \`[N dup records]\` inline in gap_label so duplicates are visible at a glance. Suggested action prompts consolidation first.

### Impact (dia)
- missing_recorded_owner: 13,338 → **10,115 rows** (−3,223; junk + dedupe).
- Top 15 dia entries now all real street addresses; no phantom records visible at the top.

### Impact (gov)
- Top 15 dominated by real federal addresses + 1 explicit duplicate notation: \`6120 S. Yale Ave., Ste. 300 [7 dup records]\`.

### Edge cases remaining (smaller follow-ups)
- "**2 locations**" still passes the filter — starts with "2", >8 chars. Would need a street-suffix predicate (\`address ~ '\\b(St|Rd|Ave|Blvd|Dr|Hwy|Way|Pkwy|Ln|Ct|Pl)\\b'\`) to catch.
- Two distinct ranks for "6120 S. Yale Ave., Ste. 300" remain (property_ids 16458 and 16451) because subtle city/state variations in some records keep them in separate partition groups. A more aggressive dedupe could normalize on address only.
- These two edge cases were small enough to defer; the major signal cleanup is in.

`);

  const preflightAnchor = N(`\n# Sprint preflight — 2026-05-17\n`);
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }

  if (c === original) {
    report.push(['AUDIT_PROGRESS.md', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`AUDIT_PROGRESS.md (${eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log(`\n=== LCC Audit Sprint — Item #4 v3.2 (dedupe + junk filter) ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN' : 'APPLY'}\n`);
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}.`);
  }
  const report = [];
  await writeDiaMigration(report);
  await writeGovMigration(report);
  await updateAuditProgress(report);
  console.log(`--- ${DRY ? 'DRY-RUN' : 'APPLY'} SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(95)}  ${sign}${delta} bytes  (${note})`);
  }
  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply.\n`);
  } else {
    console.log(`\n✓ Apply complete.\n`);
  }
}
main().catch(err => { console.error(`\n❌ FAILED: ${err.message}\n`); process.exit(1); });
