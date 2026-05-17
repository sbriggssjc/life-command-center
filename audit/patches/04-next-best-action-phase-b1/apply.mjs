#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #4 Phase B-1: gov mirror of v_next_best_action
// Branch: audit/04-next-best-action-phase-b1
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

async function writeMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260517200000_gov_next_best_action_views_phase_b1.sql');
  const SQL = String.raw`-- ============================================================================
-- Item #4 Phase B-1 (2026-05-17): gov mirror of v_next_best_action.
--
-- Same row shape as dia.v_next_best_action so a single UI consumer can
-- render both domains.
--
-- Gov-vs-dia adaptations (different domain model):
--   • No medicare_clinics → no v_gap_chain_drift (federal agencies aren't
--     a chain in CMS sense).
--   • properties.tenant → properties.agency.
--   • current_value_estimate → estimated_value.
--   • last_known_rent → gross_rent.
--   • leases.tenant → leases.tenant_agency.
--   • leases has neither is_active nor status — use DISTINCT to dedupe
--     multi-lease properties.
--   • available_listings: is_active → listing_status='Active';
--     last_seen → last_seen_at.
--
-- 5 gap sources on gov:
--   1. missing_recorded_owner (~9,816)
--   2. llc_research_pending    (~220)
--   3. agency_drift            (~842 — disagreement + property-null)
--   4. orphan_sale_owner       (~2,362 in last 5 years)
--   5. stale_active_listing    (~0 today; verification cron keeps fresh)
--
-- Already applied to gov (scknotsqkcheojiaewwh) via Supabase MCP at
-- 2026-05-17. This file commits the migration to the repo.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_gap_agency_drift AS
SELECT DISTINCT
  p.property_id,
  p.agency                                                  AS prop_agency,
  p.agency_canonical                                        AS prop_agency_canonical,
  l.tenant_agency                                           AS lease_tenant_agency,
  l.tenant_agency_full                                      AS lease_tenant_agency_full,
  p.estimated_value                                         AS property_value,
  CASE
    WHEN p.agency IS NULL                                          THEN 'lease_agency_but_property_agency_null'
    WHEN lower(trim(p.agency)) = lower(trim(l.tenant_agency))      THEN NULL
    WHEN lower(trim(p.agency)) LIKE '%' || lower(trim(l.tenant_agency)) || '%'
      OR lower(trim(l.tenant_agency)) LIKE '%' || lower(trim(p.agency)) || '%' THEN NULL
    ELSE 'agency_disagreement'
  END                                                       AS drift_kind
FROM public.properties p
JOIN public.leases l ON l.property_id = p.property_id
WHERE l.tenant_agency IS NOT NULL
  AND length(trim(l.tenant_agency)) > 1;

COMMENT ON VIEW public.v_gap_agency_drift IS
  'Gov: properties.agency vs leases.tenant_agency disagreement (audit A-7 gov side adapted to federal agency model).';

CREATE OR REPLACE VIEW public.v_gap_orphan_sale_owner AS
SELECT
  s.sale_id, s.property_id,
  p.recorded_owner_id                                       AS property_recorded_owner_id,
  ro.name                                                   AS owner_name,
  s.sale_date, s.sold_price,
  p.estimated_value                                         AS property_value
FROM public.sales_transactions s
JOIN public.properties p           ON p.property_id          = s.property_id
LEFT JOIN public.recorded_owners ro ON ro.recorded_owner_id  = p.recorded_owner_id
WHERE s.recorded_owner_id IS NULL
  AND p.recorded_owner_id IS NOT NULL
  AND s.sale_date > (CURRENT_DATE - interval '5 years');

COMMENT ON VIEW public.v_gap_orphan_sale_owner IS
  'Gov sales captured before the property had a known owner. Now writable since Discovery #1 added sales_transactions.recorded_owner_id to gov.';

CREATE OR REPLACE VIEW public.v_next_best_action AS
WITH gaps AS (
  -- 1. missing_recorded_owner
  SELECT
    'missing_recorded_owner'::text                            AS gap_type,
    CASE
      WHEN COALESCE(p.estimated_value, p.gross_rent * 10, 0) >= 10000000 THEN 'critical'::text
      WHEN COALESCE(p.estimated_value, p.gross_rent * 10, 0) >=  5000000 THEN 'high'::text
      WHEN COALESCE(p.estimated_value, p.gross_rent * 10, 0) >=  1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    p.property_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    p.property_id                                             AS property_id,
    COALESCE(p.address, 'property #' || p.property_id::text)  AS gap_label,
    'Research recorded owner for ' || COALESCE(p.address, 'property #' || p.property_id::text) AS suggested_action,
    (COALESCE(p.estimated_value, p.gross_rent * 10, 1000000)::numeric) * 2.0 AS gap_value,
    COALESCE(p.updated_at, now())                             AS first_seen_at
  FROM public.properties p
  WHERE p.recorded_owner_id IS NULL

  UNION ALL

  -- 2. llc_research_pending
  SELECT
    'llc_research_pending'::text                              AS gap_type,
    CASE
      WHEN COALESCE(p.estimated_value, p.gross_rent * 10, 0) >= 10000000 THEN 'high'::text
      WHEN COALESCE(p.estimated_value, p.gross_rent * 10, 0) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    q.queue_id::text                                          AS gap_pk,
    q.recorded_owner_id::text                                 AS entity_pk,
    q.property_id                                             AS property_id,
    q.search_name                                             AS gap_label,
    'Research LLC manager/agent for ' || q.search_name        AS suggested_action,
    COALESCE(p.estimated_value, p.gross_rent * 10, 1000000)::numeric AS gap_value,
    q.created_at                                              AS first_seen_at
  FROM public.llc_research_queue q
  LEFT JOIN public.properties p ON p.property_id = q.property_id
  WHERE q.status = 'queued'

  UNION ALL

  -- 3. agency_drift (gov-specific)
  SELECT
    ('agency_drift:' || drift_kind)::text                     AS gap_type,
    CASE
      WHEN COALESCE(property_value, 0) >= 10000000 THEN 'high'::text
      WHEN COALESCE(property_value, 0) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    property_id::text                                         AS gap_pk,
    NULL::text                                                AS entity_pk,
    property_id                                               AS property_id,
    COALESCE(prop_agency, '(no property agency)') || ' vs Lease:' || lease_tenant_agency AS gap_label,
    CASE drift_kind
      WHEN 'lease_agency_but_property_agency_null' THEN 'Back-fill properties.agency from lease tenant: ' || lease_tenant_agency
      WHEN 'agency_disagreement'                   THEN 'Resolve agency drift: property says "' || prop_agency || '", lease says "' || lease_tenant_agency || '"'
      ELSE 'Verify agency record'
    END                                                       AS suggested_action,
    (COALESCE(property_value, 1000000)::numeric) * 1.3        AS gap_value,
    now()                                                     AS first_seen_at
  FROM public.v_gap_agency_drift
  WHERE drift_kind IS NOT NULL

  UNION ALL

  -- 4. orphan_sale_owner
  SELECT
    'orphan_sale_owner'::text                                 AS gap_type,
    CASE
      WHEN COALESCE(sold_price, property_value, 0) >= 5000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    sale_id::text                                             AS gap_pk,
    property_recorded_owner_id::text                          AS entity_pk,
    property_id                                               AS property_id,
    'Sale ' || sale_date::text || ' missing owner backlink'   AS gap_label,
    'Back-link sale to recorded_owner: ' || COALESCE(owner_name, '(unknown)') AS suggested_action,
    (COALESCE(sold_price, property_value, 1000000)::numeric) * 0.8 AS gap_value,
    sale_date::timestamptz                                    AS first_seen_at
  FROM public.v_gap_orphan_sale_owner

  UNION ALL

  -- 5. stale_active_listing
  SELECT
    'stale_active_listing'::text                              AS gap_type,
    CASE
      WHEN COALESCE(al.last_price, al.asking_price, p.estimated_value, 0) >= 5000000 THEN 'high'::text
      WHEN COALESCE(al.last_price, al.asking_price, p.estimated_value, 0) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    al.listing_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    al.property_id                                            AS property_id,
    COALESCE(p.address, 'listing #' || al.listing_id::text) || ' (last seen ' ||
      to_char(COALESCE(al.last_seen_at, al.listing_date), 'YYYY-MM-DD') || ')' AS gap_label,
    'Re-verify listing status'                                AS suggested_action,
    COALESCE(al.last_price, al.asking_price, p.estimated_value, 1000000)::numeric AS gap_value,
    COALESCE(al.last_seen_at, al.listing_date, now())         AS first_seen_at
  FROM public.available_listings al
  LEFT JOIN public.properties p ON p.property_id = al.property_id
  WHERE al.listing_status = 'Active'
    AND COALESCE(al.last_seen_at, al.listing_date) < (now() - interval '90 days')
)
SELECT
  ROW_NUMBER() OVER (ORDER BY gap_value DESC NULLS LAST, first_seen_at ASC) AS rank,
  gap_type, gap_severity, gap_pk, entity_pk, property_id,
  gap_label, suggested_action, gap_value, first_seen_at
FROM gaps;

COMMENT ON VIEW public.v_next_best_action IS
  'Gov mirror of dia.v_next_best_action. Same row shape so a single UI consumer can render both domains. Phase B-1 of audit item #4.';
`;
  if (DRY) {
    report.push(['supabase/migrations/government/20260517200000_gov_next_best_action_views_phase_b1.sql', SQL.length, 'dry-run (would create)']);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SQL, 'utf8');
  report.push(['supabase/migrations/government/20260517200000_gov_next_best_action_views_phase_b1.sql', SQL.length, 'written']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 4 Phase B-1 — gov mirror of v_next_best_action
- **Status:** 🟨 IN PROGRESS (gov mirror landed; Phase B-2 = backend endpoint + LCC Opps view; Phase C = Home rail UI)
- **Branch:** \`audit/04-next-best-action-phase-b1\`
- **Patch:** \`audit/patches/04-next-best-action-phase-b1/apply.mjs\`
- **Migration applied** to gov (\`scknotsqkcheojiaewwh\`) at 2026-05-17 via Supabase MCP. 3 views live (v_gap_agency_drift + v_gap_orphan_sale_owner + v_next_best_action).

### What landed
| View | Rows live |
|---|---|
| \`v_gap_agency_drift\` | ~842 (796 disagreement + 46 property-agency-null) |
| \`v_gap_orphan_sale_owner\` | ~2,362 (last 5 years; previously impossible to write — Discovery #1 unblocked) |
| \`v_next_best_action\` | ~13,240 unified ranked rows |

### Gap distribution on gov
| gap_type | Count | Max value |
|---|---|---|
| missing_recorded_owner | 9,816 | $967M |
| orphan_sale_owner | 2,362 | $319M |
| agency_drift:agency_disagreement | 796 | $1.3M |
| llc_research_pending | 220 | $347M |
| agency_drift:lease_agency_but_property_agency_null | 46 | $1.3M |

### Notes vs dia
Federal property values dwarf dialysis clinic values — a single missing-recorded-owner gap on a $967M federal property outranks 200+ medium-value dia gaps. The unified rank order is dominated by these top federal properties when both views are merged at the application layer (Phase B-2 endpoint).

Skipped vs dia:
- \`v_gap_chain_drift\` — no medicare_clinics analog on gov.
- \`v_gap_lease_tenant_drift\` — folded into the broader \`v_gap_agency_drift\`.

### Phase B-2 (next)
LCC Opps view + backend endpoint that fans out to dia + gov + LCC Opps, merges + re-ranks by gap_value, returns top N. ~150 lines of JS.

### Phase C (after that)
Home rail UI in app.js — replaces the wrong-table Research pulse-card (B-13) with the live merged top-20 ranked gaps.

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
  console.log(`\n=== LCC Audit Sprint — Item #4 Phase B-1: v_next_best_action (gov) ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN (no writes)' : 'APPLY (will write files)'}\n`);
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}.`);
  }
  const report = [];
  await writeMigration(report);
  await updateAuditProgress(report);
  console.log(`--- ${DRY ? 'DRY-RUN' : 'APPLY'} SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(80)}  ${sign}${delta} bytes  (${note})`);
  }
  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply.\n`);
    console.log(`  node audit/patches/04-next-best-action-phase-b1/apply.mjs --apply\n`);
  } else {
    console.log(`\n✓ Apply complete.\n`);
    console.log(`  git add -A && git commit -F audit/patches/04-next-best-action-phase-b1/COMMIT_MSG.txt\n`);
  }
}
main().catch(err => { console.error(`\n❌ FAILED: ${err.message}\n`); process.exit(1); });
