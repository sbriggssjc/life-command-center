#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #6 Phase A: Data Completeness rail on detail.js.
//
// User-visible companion to the Next Best Action rail. Adds a horizontal rail
// at the top of every unified property detail panel showing:
//   - A completeness score (0-100) and band (excellent/good/fair/poor)
//   - Clickable chips for the top missing high-value fields, sorted by weight
//   - Click chip -> switches to the tab where that field lives, so the broker
//     can fill the gap inline without hunting through tabs
//
// Server-side calibration: both dia + gov get a v_property_completeness view
// that computes the score with domain-specific weights. The view returns:
//   - property_id (pk)
//   - completeness_score (integer 0-100)
//   - completeness_band (text: 'excellent' | 'good' | 'fair' | 'poor')
//   - missing_fields (jsonb array: [{ key, label, weight, tab }, ...])
//
// Score weights reflect underwriting impact, calibrated to live data:
//
//   Dia (15,219 properties, 0% star_rating/qip — dropped):
//     recorded_owner 14, anchor_rent 12, tenant/operator 10, cms_link 9,
//     building_size 8, lease_commencement 7, latest_sale_price 6,
//     total_chairs 6, lease_bump_pct 5, ttm_revenue 5, patient_count 5,
//     parcel_number 5, year_built 4, latest_deed_date 4   = 100
//
//   Gov (17,448 properties, 0% lease_structure — dropped):
//     recorded_owner 14, gross_rent 11, noi 11, agency 10, lease_number 10,
//     lease_expiration 9, rba 8, lease_commencement 7, term_remaining 5,
//     latest_sale_price 5, year_built 4, federal_employee_count 3,
//     is_build_to_suit 3                                   = 100
//
// This is Phase A. Phase B (deferred) will add a persisted completeness_score
// column on properties + a nightly cron refresh + a "Sort by completeness"
// option on list views + completeness-band weighting in the NBA queue.
//
// Closes B-2 (no inline completeness signal) and the broker-side half of
// B-15 (no way to rank records by completeness — list-sort half deferred).
//
// Edits:
//   - supabase/migrations/dialysis/20260517230000_dia_v_property_completeness.sql
//   - supabase/migrations/government/20260517230000_gov_v_property_completeness.sql
//   - index.html        widget mount between detailTabs and detailBody
//   - styles.css        .completeness-rail / .cr-chip styles
//   - detail.js         fetch view + render rail + click-to-tab handler
//   - AUDIT_PROGRESS.md closeout
//
// Branch: audit/06-completeness-rail
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
function toEol(s, eol) {
  return s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
}
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0; let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
async function replaceUnique(path, oldStr, newStr, report, label) {
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const oldN = toEol(oldStr, eol);
  const newN = toEol(newStr, eol);
  const occ = countOccurrences(original, oldN);
  if (occ === 0) throw new Error(label + ': anchor not found in ' + path);
  if (occ > 1)  throw new Error(label + ': anchor matched ' + occ + ' times in ' + path + ' (must be unique)');
  if (oldN === newN) {
    report.push([label, 0, 'no changes']);
    return;
  }
  // Function callback so JS does NOT expand replacement patterns ('$&', etc.)
  const updated = original.replace(oldN, () => newN);
  const delta = updated.length - original.length;
  report.push([label + ' (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function writeFileEnsuringDir(path, content, report, label) {
  if (DRY) {
    report.push([label, content.length, 'dry-run']);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  report.push([label, content.length, 'written']);
}

// ─── dia migration: v_property_completeness ───
async function writeDiaCompletenessMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260517230000_dia_v_property_completeness.sql');
  const SQL = `-- ============================================================================
-- Item #6 Phase A (dia, 2026-05-17): v_property_completeness
-- Per-property completeness score driving the detail-panel completeness rail.
--
-- Weights (sum = 100):
--   recorded_owner       14
--   anchor_rent          12
--   tenant_or_operator   10
--   cms_link              9
--   building_size         8
--   lease_commencement    7
--   latest_sale_price     6
--   total_chairs          6
--   lease_bump_pct        5
--   ttm_revenue           5
--   latest_patient_count  5
--   parcel_number         5
--   year_built            4
--   latest_deed_date      4
--
-- Score bands:
--   90-100  excellent
--   70-89   good
--   40-69   fair
--   <40     poor
-- ============================================================================
CREATE OR REPLACE VIEW public.v_property_completeness AS
WITH spec AS (
  SELECT
    p.property_id,
    -- Boolean field-presence flags
    (p.recorded_owner_id IS NOT NULL
       OR NULLIF(trim(coalesce(p.recorded_owner_name, '')), '') IS NOT NULL) AS has_recorded_owner,
    (NULLIF(trim(coalesce(p.operator, p.tenant::text, p.chain_canonical, '')), '') IS NOT NULL) AS has_tenant_or_operator,
    (p.anchor_rent IS NOT NULL AND p.anchor_rent > 0)               AS has_anchor_rent,
    (p.building_size IS NOT NULL AND p.building_size > 0)           AS has_building_size,
    (NULLIF(trim(coalesce(p.medicare_id, p.linked_medicare_facility_id, '')), '') IS NOT NULL) AS has_cms_link,
    (p.latest_sale_price IS NOT NULL AND p.latest_sale_price > 0)   AS has_latest_sale_price,
    (p.latest_deed_date IS NOT NULL)                                 AS has_latest_deed_date,
    (p.lease_commencement IS NOT NULL)                               AS has_lease_commencement,
    (p.lease_bump_pct IS NOT NULL)                                   AS has_lease_bump_pct,
    (p.total_chairs IS NOT NULL AND p.total_chairs > 0)              AS has_total_chairs,
    (p.year_built IS NOT NULL AND p.year_built > 1800)               AS has_year_built,
    (p.ttm_revenue IS NOT NULL AND p.ttm_revenue > 0)                AS has_ttm_revenue,
    (p.latest_patient_count IS NOT NULL AND p.latest_patient_count > 0) AS has_patient_count,
    (NULLIF(trim(coalesce(p.parcel_number, '')), '') IS NOT NULL)    AS has_parcel_number
  FROM public.properties p
),
scored AS (
  SELECT
    property_id,
    (CASE WHEN has_recorded_owner       THEN 14 ELSE 0 END
   + CASE WHEN has_anchor_rent           THEN 12 ELSE 0 END
   + CASE WHEN has_tenant_or_operator    THEN 10 ELSE 0 END
   + CASE WHEN has_cms_link              THEN  9 ELSE 0 END
   + CASE WHEN has_building_size         THEN  8 ELSE 0 END
   + CASE WHEN has_lease_commencement    THEN  7 ELSE 0 END
   + CASE WHEN has_latest_sale_price     THEN  6 ELSE 0 END
   + CASE WHEN has_total_chairs          THEN  6 ELSE 0 END
   + CASE WHEN has_lease_bump_pct        THEN  5 ELSE 0 END
   + CASE WHEN has_ttm_revenue           THEN  5 ELSE 0 END
   + CASE WHEN has_patient_count         THEN  5 ELSE 0 END
   + CASE WHEN has_parcel_number         THEN  5 ELSE 0 END
   + CASE WHEN has_year_built            THEN  4 ELSE 0 END
   + CASE WHEN has_latest_deed_date      THEN  4 ELSE 0 END) AS completeness_score,
    -- Missing-field list, sorted by weight DESC, as JSONB array.
    jsonb_strip_nulls(jsonb_build_array(
      CASE WHEN NOT has_recorded_owner    THEN jsonb_build_object('key','recorded_owner','label','Recorded owner','weight',14,'tab','Ownership & CRM') END,
      CASE WHEN NOT has_anchor_rent       THEN jsonb_build_object('key','anchor_rent','label','Anchor rent','weight',12,'tab','Rent Roll') END,
      CASE WHEN NOT has_tenant_or_operator THEN jsonb_build_object('key','tenant_or_operator','label','Tenant / operator','weight',10,'tab','Operations') END,
      CASE WHEN NOT has_cms_link          THEN jsonb_build_object('key','cms_link','label','CMS link (CCN)','weight',9,'tab','Operations') END,
      CASE WHEN NOT has_building_size     THEN jsonb_build_object('key','building_size','label','Building size (SF)','weight',8,'tab','Overview') END,
      CASE WHEN NOT has_lease_commencement THEN jsonb_build_object('key','lease_commencement','label','Lease commencement','weight',7,'tab','Rent Roll') END,
      CASE WHEN NOT has_latest_sale_price THEN jsonb_build_object('key','latest_sale_price','label','Latest sale price','weight',6,'tab','Deal History') END,
      CASE WHEN NOT has_total_chairs      THEN jsonb_build_object('key','total_chairs','label','Total chairs','weight',6,'tab','Operations') END,
      CASE WHEN NOT has_lease_bump_pct    THEN jsonb_build_object('key','lease_bump_pct','label','Rent escalation %','weight',5,'tab','Rent Roll') END,
      CASE WHEN NOT has_ttm_revenue       THEN jsonb_build_object('key','ttm_revenue','label','TTM revenue','weight',5,'tab','Operations') END,
      CASE WHEN NOT has_patient_count     THEN jsonb_build_object('key','patient_count','label','Latest patient count','weight',5,'tab','Operations') END,
      CASE WHEN NOT has_parcel_number     THEN jsonb_build_object('key','parcel_number','label','Parcel number','weight',5,'tab','Overview') END,
      CASE WHEN NOT has_year_built        THEN jsonb_build_object('key','year_built','label','Year built','weight',4,'tab','Overview') END,
      CASE WHEN NOT has_latest_deed_date  THEN jsonb_build_object('key','latest_deed_date','label','Latest deed date','weight',4,'tab','Deal History') END
    )) AS missing_fields_raw
  FROM spec
)
SELECT
  property_id,
  completeness_score,
  CASE
    WHEN completeness_score >= 90 THEN 'excellent'
    WHEN completeness_score >= 70 THEN 'good'
    WHEN completeness_score >= 40 THEN 'fair'
    ELSE 'poor'
  END AS completeness_band,
  COALESCE(
    (SELECT jsonb_agg(elem ORDER BY (elem->>'weight')::int DESC)
       FROM jsonb_array_elements(missing_fields_raw) elem),
    '[]'::jsonb
  ) AS missing_fields
FROM scored;

COMMENT ON VIEW public.v_property_completeness IS
  'Item #6 Phase A: per-property completeness score (0-100) + missing high-value fields. '
  'Powers the completeness rail on detail.js. Server-side calibration of the same weights.';
`;
  await writeFileEnsuringDir(path, SQL, report,
    'supabase/migrations/dialysis/20260517230000_dia_v_property_completeness.sql');
}

// ─── gov migration: v_property_completeness ───
async function writeGovCompletenessMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260517230000_gov_v_property_completeness.sql');
  const SQL = `-- ============================================================================
-- Item #6 Phase A (gov, 2026-05-17): v_property_completeness
-- Government mirror of the dia completeness view.
--
-- Weights (sum = 100):
--   recorded_owner          14
--   gross_rent              11
--   noi                     11
--   agency                  10
--   lease_number            10
--   lease_expiration         9
--   rba                      8
--   lease_commencement       7
--   term_remaining           5
--   latest_sale_price        5
--   year_built               4
--   federal_employee_count   3
--   is_build_to_suit         3
--
-- (lease_structure dropped — 0% populated in current data.)
-- ============================================================================
CREATE OR REPLACE VIEW public.v_property_completeness AS
WITH spec AS (
  SELECT
    p.property_id,
    (p.recorded_owner_id IS NOT NULL)                                AS has_recorded_owner,
    (p.gross_rent IS NOT NULL AND p.gross_rent > 0)                  AS has_gross_rent,
    (p.noi IS NOT NULL)                                              AS has_noi,
    (NULLIF(trim(coalesce(p.agency_canonical, p.agency_full_name, p.agency, '')), '') IS NOT NULL) AS has_agency,
    (NULLIF(trim(coalesce(p.lease_number, '')), '') IS NOT NULL)     AS has_lease_number,
    (p.lease_expiration IS NOT NULL)                                 AS has_lease_expiration,
    (p.rba IS NOT NULL AND p.rba > 0)                                AS has_rba,
    (p.lease_commencement IS NOT NULL)                               AS has_lease_commencement,
    (p.term_remaining IS NOT NULL)                                   AS has_term_remaining,
    (p.latest_sale_price IS NOT NULL AND p.latest_sale_price > 0)    AS has_latest_sale_price,
    (p.year_built IS NOT NULL AND p.year_built > 1800)               AS has_year_built,
    (p.federal_employee_count IS NOT NULL AND p.federal_employee_count > 0) AS has_federal_employee_count,
    (p.is_build_to_suit IS NOT NULL)                                 AS has_is_build_to_suit
  FROM public.properties p
),
scored AS (
  SELECT
    property_id,
    (CASE WHEN has_recorded_owner         THEN 14 ELSE 0 END
   + CASE WHEN has_gross_rent              THEN 11 ELSE 0 END
   + CASE WHEN has_noi                     THEN 11 ELSE 0 END
   + CASE WHEN has_agency                  THEN 10 ELSE 0 END
   + CASE WHEN has_lease_number            THEN 10 ELSE 0 END
   + CASE WHEN has_lease_expiration        THEN  9 ELSE 0 END
   + CASE WHEN has_rba                     THEN  8 ELSE 0 END
   + CASE WHEN has_lease_commencement      THEN  7 ELSE 0 END
   + CASE WHEN has_term_remaining          THEN  5 ELSE 0 END
   + CASE WHEN has_latest_sale_price       THEN  5 ELSE 0 END
   + CASE WHEN has_year_built              THEN  4 ELSE 0 END
   + CASE WHEN has_federal_employee_count  THEN  3 ELSE 0 END
   + CASE WHEN has_is_build_to_suit        THEN  3 ELSE 0 END) AS completeness_score,
    jsonb_strip_nulls(jsonb_build_array(
      CASE WHEN NOT has_recorded_owner        THEN jsonb_build_object('key','recorded_owner','label','Recorded owner','weight',14,'tab','Ownership & CRM') END,
      CASE WHEN NOT has_gross_rent            THEN jsonb_build_object('key','gross_rent','label','Gross rent','weight',11,'tab','Rent Roll') END,
      CASE WHEN NOT has_noi                   THEN jsonb_build_object('key','noi','label','NOI','weight',11,'tab','Rent Roll') END,
      CASE WHEN NOT has_agency                THEN jsonb_build_object('key','agency','label','Tenant agency','weight',10,'tab','Overview') END,
      CASE WHEN NOT has_lease_number          THEN jsonb_build_object('key','lease_number','label','GSA / DACA lease #','weight',10,'tab','Overview') END,
      CASE WHEN NOT has_lease_expiration      THEN jsonb_build_object('key','lease_expiration','label','Lease expiration','weight',9,'tab','Rent Roll') END,
      CASE WHEN NOT has_rba                   THEN jsonb_build_object('key','rba','label','Rentable Building Area','weight',8,'tab','Overview') END,
      CASE WHEN NOT has_lease_commencement    THEN jsonb_build_object('key','lease_commencement','label','Lease commencement','weight',7,'tab','Rent Roll') END,
      CASE WHEN NOT has_term_remaining        THEN jsonb_build_object('key','term_remaining','label','Term remaining','weight',5,'tab','Rent Roll') END,
      CASE WHEN NOT has_latest_sale_price     THEN jsonb_build_object('key','latest_sale_price','label','Latest sale price','weight',5,'tab','Deal History') END,
      CASE WHEN NOT has_year_built            THEN jsonb_build_object('key','year_built','label','Year built','weight',4,'tab','Overview') END,
      CASE WHEN NOT has_federal_employee_count THEN jsonb_build_object('key','federal_employee_count','label','Federal headcount','weight',3,'tab','Operations') END,
      CASE WHEN NOT has_is_build_to_suit      THEN jsonb_build_object('key','is_build_to_suit','label','Build-to-suit flag','weight',3,'tab','Overview') END
    )) AS missing_fields_raw
  FROM spec
)
SELECT
  property_id,
  completeness_score,
  CASE
    WHEN completeness_score >= 90 THEN 'excellent'
    WHEN completeness_score >= 70 THEN 'good'
    WHEN completeness_score >= 40 THEN 'fair'
    ELSE 'poor'
  END AS completeness_band,
  COALESCE(
    (SELECT jsonb_agg(elem ORDER BY (elem->>'weight')::int DESC)
       FROM jsonb_array_elements(missing_fields_raw) elem),
    '[]'::jsonb
  ) AS missing_fields
FROM scored;

COMMENT ON VIEW public.v_property_completeness IS
  'Item #6 Phase A: per-property completeness score (0-100) + missing high-value fields. '
  'Powers the completeness rail on detail.js. Server-side calibration of the same weights.';
`;
  await writeFileEnsuringDir(path, SQL, report,
    'supabase/migrations/government/20260517230000_gov_v_property_completeness.sql');
}

// ─── index.html: insert completeness rail mount between tabs and body ───
async function patchIndexHtml(report) {
  const path = resolve(REPO_ROOT, 'index.html');
  if (!await fileExists(path)) throw new Error('index.html not found.');

  const ANCHOR = `  <div class="detail-tabs" id="detailTabs"></div>
  <div class="detail-body" id="detailBody"></div>`;

  const REPLACE = `  <div class="detail-tabs" id="detailTabs"></div>
  <div class="completeness-rail" id="detailCompletenessRail" style="display:none"></div>
  <div class="detail-body" id="detailBody"></div>`;

  await replaceUnique(path, ANCHOR, REPLACE, report, 'index.html (completeness rail mount)');
}

// ─── styles.css: insert completeness rail styles ───
async function patchStylesCss(report) {
  const path = resolve(REPO_ROOT, 'styles.css');
  if (!await fileExists(path)) throw new Error('styles.css not found.');

  // Anchor immediately after the NBA block landed by Item #4 Phase C.
  const ANCHOR = `@media (max-width: 720px) {
  .nba-row { grid-template-columns: 28px 48px 1fr auto; gap: 8px; padding: 7px 8px; }
  .nba-action { font-size: 10px; }
  .nba-value { font-size: 12px; }
}`;
  const CR_CSS = `

/* Data Completeness rail — detail panel (Item #6 Phase A, 2026-05-17) */
.completeness-rail { background: var(--s1); border-bottom: 1px solid var(--border); padding: 8px 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cr-summary { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text2); }
.cr-score { font-size: 16px; font-weight: 800; color: var(--text1); line-height: 1; }
.cr-score-band { font-size: 9px; font-weight: 800; letter-spacing: 0.4px; padding: 2px 6px; border-radius: 999px; border: 1px solid transparent; text-transform: uppercase; }
.cr-band-excellent { background: color-mix(in srgb, var(--green, #22c55e) 18%, transparent); color: var(--green, #22c55e); border-color: color-mix(in srgb, var(--green, #22c55e) 45%, transparent); }
.cr-band-good      { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.cr-band-fair      { background: color-mix(in srgb, var(--yellow, #eab308) 18%, transparent); color: var(--yellow, #eab308); border-color: color-mix(in srgb, var(--yellow, #eab308) 45%, transparent); }
.cr-band-poor      { background: color-mix(in srgb, var(--red, #ef4444) 18%, transparent); color: var(--red, #ef4444); border-color: color-mix(in srgb, var(--red, #ef4444) 45%, transparent); }
.cr-label { font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
.cr-chips { display: inline-flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 0; }
.cr-chip { font-size: 11px; padding: 4px 9px; border: 1px dashed var(--border); background: var(--s2); color: var(--text2); border-radius: 999px; cursor: pointer; transition: border-color 0.15s, color 0.15s, background 0.15s; }
.cr-chip:hover { color: var(--accent); border-color: var(--accent); border-style: solid; background: color-mix(in srgb, var(--accent) 8%, var(--s2)); }
.cr-chip-weight { display: inline-block; margin-left: 4px; padding: 0 4px; font-size: 9px; font-weight: 800; color: var(--text3); border-radius: 4px; }
.cr-empty { font-size: 11px; color: var(--text3); font-style: italic; }
@media (max-width: 720px) {
  .completeness-rail { padding: 6px 10px; gap: 6px; }
  .cr-chip { font-size: 10px; padding: 3px 7px; }
}`;
  const REPLACE = ANCHOR + CR_CSS;
  await replaceUnique(path, ANCHOR, REPLACE, report, 'styles.css (.completeness-rail block)');
}

// ─── detail.js: fetch view + render rail + click-to-tab + cache hooks ───
async function patchDetailJs(report) {
  const path = resolve(REPO_ROOT, 'detail.js');
  if (!await fileExists(path)) throw new Error('detail.js not found.');

  // 1. Add fetch into the parallel Promise.all (line ~215). Use a sentinel
  // append: tack the completeness query onto the promises array right after
  // the dia anchor_rent / building extras query.
  await replaceUnique(path,
    `    if (db === 'dia' && propFilter) {
      promises.push(diaQuery('properties',
        'property_id,medicare_id,linked_medicare_facility_id,' +
        'anchor_rent,anchor_rent_date,anchor_rent_source,lease_commencement,' +
        'lease_bump_pct,lease_bump_interval_mo,' +
        // Site/building fields fed into the client-deliverable Operations
        // export. v_property_detail exposes year_built/building_type but
        // not building_size/land_area/lot_sf/year_renovated, so we pull
        // them straight from the table.
        'building_size,year_built,year_renovated,land_area,lot_sf,building_type',
        { filter: propFilter, limit: 1 }
      ));
    } else {
      promises.push(Promise.resolve([]));
    }

    const settled = await Promise.allSettled(promises);`,
    `    if (db === 'dia' && propFilter) {
      promises.push(diaQuery('properties',
        'property_id,medicare_id,linked_medicare_facility_id,' +
        'anchor_rent,anchor_rent_date,anchor_rent_source,lease_commencement,' +
        'lease_bump_pct,lease_bump_interval_mo,' +
        // Site/building fields fed into the client-deliverable Operations
        // export. v_property_detail exposes year_built/building_type but
        // not building_size/land_area/lot_sf/year_renovated, so we pull
        // them straight from the table.
        'building_size,year_built,year_renovated,land_area,lot_sf,building_type',
        { filter: propFilter, limit: 1 }
      ));
    } else {
      promises.push(Promise.resolve([]));
    }

    // Completeness — pulls v_property_completeness for the rail at the top
    // of the detail panel (Item #6 Phase A, 2026-05-17). Best-effort: never
    // blocks the detail render if the view fetch fails.
    if (propFilter) {
      promises.push(qFn('v_property_completeness', '*', { filter: propFilter, limit: 1 }));
    } else {
      promises.push(Promise.resolve([]));
    }

    const settled = await Promise.allSettled(promises);`,
    report, 'detail.js (Promise.all completeness fetch)');

  // 2. Add safeExtract index for completeness + thread it onto _udCache. Anchor
  // on the propertyCmsRow extraction since it's the last existing safeExtract.
  await replaceUnique(path,
    `    const propertyCmsRow = safeExtract(5)[0] || null;`,
    `    const propertyCmsRow = safeExtract(5)[0] || null;
    // Index 6 is the completeness view (Item #6 Phase A). May be empty if
    // the view fetch failed or this is a fallback-only render.
    const completenessRow = safeExtract(6)[0] || null;`,
    report, 'detail.js (completeness extraction)');

  // 3. Attach completeness to _udCache. Anchor on the _setUdCache call after
  // mergedProperty is built (line ~358 area).
  await replaceUnique(path,
    `    _setUdCache({ db, ids, property: mergedProperty, leases, ownership, chain, rankings, fallback, entityMeta, _fallbackOnly: allEmpty });`,
    `    _setUdCache({ db, ids, property: mergedProperty, leases, ownership, chain, rankings, fallback, entityMeta, completeness: completenessRow, _fallbackOnly: allEmpty });
    // Render the data completeness rail at the top of the detail panel.
    // Best-effort: never throws upward (Item #6 Phase A, 2026-05-17).
    try { _udRenderCompletenessRail(); } catch (e) { console.warn('completeness rail render failed', e); }`,
    report, 'detail.js (_setUdCache completeness + rail render call)');

  // 4. Append the completeness rail renderer + handler. Insert at the bottom of
  // the file, right before any final IIFE/registration. Use the end of file
  // as the anchor — look for a known late symbol. We'll anchor on the existing
  // _udRenderTab dispatcher.
  await replaceUnique(path,
    `function _udRenderTab(tab) {`,
    `// ============================================================================
// Data Completeness rail — Item #6 Phase A (2026-05-17)
// Reads _udCache.completeness ({ completeness_score, completeness_band,
// missing_fields: [{key,label,weight,tab}, ...] }) and renders the rail.
// Click a chip -> switches the active tab to where that field lives.
// ============================================================================
function _udRenderCompletenessRail() {
  const rail = document.getElementById('detailCompletenessRail');
  if (!rail) return;
  const cmp = _udCache && _udCache.completeness;
  if (!cmp || cmp.completeness_score == null) {
    rail.style.display = 'none';
    rail.innerHTML = '';
    return;
  }
  const score = Math.max(0, Math.min(100, Number(cmp.completeness_score) || 0));
  const band = String(cmp.completeness_band || 'poor').toLowerCase();
  let missing = Array.isArray(cmp.missing_fields) ? cmp.missing_fields : [];
  // Defensive: if Postgres returned the jsonb as a string for any reason,
  // try to parse it. (PostgREST normally returns it as a native array.)
  if (!Array.isArray(cmp.missing_fields) && typeof cmp.missing_fields === 'string') {
    try { missing = JSON.parse(cmp.missing_fields) || []; } catch (_) { missing = []; }
  }
  // Top 6 highest-weight missing fields (already weight-sorted by the view).
  const top = missing.slice(0, 6);

  const parts = [];
  parts.push('<div class="cr-summary">');
  parts.push(  '<span class="cr-label">Completeness</span>');
  parts.push(  '<span class="cr-score">' + score + '</span>');
  parts.push(  '<span class="cr-score-band cr-band-' + esc(band) + '">' + esc(band) + '</span>');
  parts.push('</div>');

  if (top.length === 0) {
    parts.push('<div class="cr-empty">All high-value fields populated</div>');
  } else {
    parts.push('<div class="cr-chips">');
    top.forEach(f => {
      const key = String(f.key || '');
      const label = String(f.label || key);
      const weight = Number(f.weight) || 0;
      const tab = String(f.tab || 'Overview');
      parts.push('<span class="cr-chip" title="Missing — +' + weight + ' if filled. Opens ' + esc(tab) + ' tab." onclick="_udCompletenessChipClick(&quot;' + esc(key) + '&quot;, &quot;' + esc(tab) + '&quot;)">'
        + '+ ' + esc(label)
        + '<span class="cr-chip-weight">+' + weight + '</span>'
        + '</span>');
    });
    if (missing.length > top.length) {
      parts.push('<span class="cr-empty">+' + (missing.length - top.length) + ' more</span>');
    }
    parts.push('</div>');
  }

  rail.innerHTML = parts.join('');
  rail.style.display = '';
}
window._udRenderCompletenessRail = _udRenderCompletenessRail;

function _udCompletenessChipClick(fieldKey, tab) {
  // Switch to the target tab so the broker can fill the gap inline. Future
  // enhancement: focus the specific input inside the rendered tab.
  if (typeof switchUnifiedTab === 'function' && tab) {
    switchUnifiedTab(tab);
  }
  // Telemetry hook reserved — not wired in Phase A.
  console.debug('[Completeness] chip click', fieldKey, '-> tab', tab);
}
window._udCompletenessChipClick = _udCompletenessChipClick;

// Hide the rail when the panel closes so the next open starts clean.
(function _udWireCompletenessRailClose() {
  if (window._udCompletenessRailWired) return;
  window._udCompletenessRailWired = true;
  const origClose = window.closeDetail;
  if (typeof origClose === 'function') {
    window.closeDetail = function () {
      const rail = document.getElementById('detailCompletenessRail');
      if (rail) { rail.style.display = 'none'; rail.innerHTML = ''; }
      return origClose.apply(this, arguments);
    };
  }
})();

function _udRenderTab(tab) {`,
    report, 'detail.js (completeness rail renderer + handler)');
}

// ─── AUDIT_PROGRESS.md: append closeout entry ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 6 Phase A — Data Completeness rail on detail.js
- **Status:** ✅ DONE (Phase A) / ⏸️ DEFERRED (Phase B: persisted column + list sort + NBA integration)
- **Branch:** \`audit/06-completeness-rail\`
- **Patch:** \`audit/patches/06-completeness-rail/apply.mjs\`
- **Closes:** B-2 (no inline completeness signal) + broker-side half of B-15. The list-sort half of B-15 ships in Phase B.

### What this adds
- Two new views: \`v_property_completeness\` on dia + gov. Each returns:
  \`property_id\`, \`completeness_score\` (0-100), \`completeness_band\` (excellent/good/fair/poor), \`missing_fields\` (JSONB array of \`{ key, label, weight, tab }\` sorted by weight DESC).
- Detail panel renders a horizontal rail directly under the tab bar showing the score, band chip, and the top 6 highest-weight missing fields as clickable chips.
- Click a chip → switches to the tab where that field lives, so Scott can fill the gap inline without hunting through the panel.
- Rail auto-hides when the detail panel closes; opens fresh on every property load.

### Calibrated weights

Dia (15,219 properties; star_rating + qip_total_performance_score 0% populated and dropped from the spec):
\`\`\`
recorded_owner       14   anchor_rent          12   tenant_or_operator   10
cms_link              9   building_size         8   lease_commencement    7
latest_sale_price     6   total_chairs          6   lease_bump_pct        5
ttm_revenue           5   latest_patient_count  5   parcel_number         5
year_built            4   latest_deed_date      4
\`\`\`

Gov (17,448 properties; lease_structure 0% populated, dropped):
\`\`\`
recorded_owner          14   gross_rent              11   noi                     11
agency                  10   lease_number            10   lease_expiration         9
rba                      8   lease_commencement       7   term_remaining           5
latest_sale_price        5   year_built               4   federal_employee_count   3
is_build_to_suit         3
\`\`\`

### Files changed
- \`supabase/migrations/dialysis/20260517230000_dia_v_property_completeness.sql\`
- \`supabase/migrations/government/20260517230000_gov_v_property_completeness.sql\`
- \`index.html\` — completeness rail mount between detailTabs and detailBody
- \`styles.css\` — \`.completeness-rail\` + \`.cr-chip\` styles
- \`detail.js\` — fetch into parallel Promise.all, attach to \`_udCache\`, renderer + chip click handler, close-detail hook
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. \`grep -c "v_property_completeness" detail.js\` → 1+
2. \`grep -c "_udRenderCompletenessRail" detail.js\` → 3+ (definition + window export + call site)
3. \`grep -c "completeness-rail" index.html\` → 1
4. \`grep -c "completeness_score" supabase/migrations/dialysis/20260517230000_*.sql\` → 5+
5. Smoke: open a dia property with NO recorded owner and a gov property without an NOI; rail visible with score + chips; click a chip → correct tab activates.

### Deferred to Phase B
- Persisted \`completeness_score\` + \`completeness_band\` columns on properties (refreshed via trigger or nightly cron).
- "Sort by completeness" option on dia + gov list views (the half of B-15 not closed by this patch).
- Completeness-band weighting in \`v_next_best_action\` so "almost-complete underwriting candidates" rank higher.
- Field-level focus (chip click → scroll to + focus the specific input within the rendered tab).

`);

  const preflightAnchor = N('\n# Sprint preflight — 2026-05-17\n');
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, () => appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }

  if (c === original) {
    report.push(['AUDIT_PROGRESS.md', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Audit Sprint — Item #6 Phase A (Data Completeness rail) ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await writeDiaCompletenessMigration(report);
  await writeGovCompletenessMigration(report);
  await patchIndexHtml(report);
  await patchStylesCss(report);
  await patchDetailJs(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(85) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) {
    console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  } else {
    console.log('\n✓ Apply complete.\n');
  }
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
