#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #4 valuation v3: NOI ÷ cap_rate methodology
// Consolidates the multiple in-session SQL corrections into committed
// migration files. Already live on dia + gov via Supabase MCP at 2026-05-17.
// Branch: audit/04-valuation-v3
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
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260517210000_dia_next_best_action_valuation_v3.sql');
  const SQL = String.raw`-- ============================================================================
-- Item #4 valuation v3 (dia, 2026-05-17): NOI / cap_rate methodology.
--
-- Replaces v_property_value_signal with a value chain that prefers real
-- transaction prices, then NOI / TTM cap rate (broker methodology), then
-- a capped SF proxy, then heavily-discounted polluted columns.
--
-- This commit captures the FINAL state already applied to dia
-- (zqzrriwuavgrquhisnoa) via Supabase MCP. Prior in-session iterations
-- (initial $400/SF formula, then 200K SF cap, then NOI/cap, then $5M
-- rent sanity cap) are superseded by this single migration.
--
-- Audit-discovery context:
--   • current_value_estimate and last_known_rent on dia.properties are
--     polluted with dialysis-operator BUSINESS valuations (revenue × ~5×
--     EBITDA), not real estate values. Top-ranked properties showed
--     implausible $/SF (e.g. $12,363/SF on a 5,880 SF Maryland building).
--   • leases.annual_rent has the same pollution class on the same rows
--     (operator revenue loaded into rent column).
--   • $5M sanity cap filters out the polluted rent entries; real
--     dialysis NNN leases are $100K-$2M annually.
--
-- Broker methodology (per Scott): NOI / TTM cap rate from CM reports.
-- NOI for NNN dialysis ≈ active lease annual_rent. Cap rate from
-- cm_dialysis_cap_ttm_q (currently 7.85% Q1 2026).
--
-- Phase B-3 (deferred): join on (subspecialty, lease_term_remaining tier)
-- once the dia CM views publish term-sliced rates (today only 'all' subsp).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_property_value_signal AS
WITH curr_cap AS (
  -- Latest TTM weighted cap rate. Floor of 4% protects against any
  -- zero / negative edge case producing implausible valuations.
  SELECT ttm_weighted_cap_rate AS cap
  FROM public.cm_dialysis_cap_ttm_q
  WHERE subspecialty = 'all'
    AND ttm_weighted_cap_rate IS NOT NULL
    AND ttm_weighted_cap_rate > 0
  ORDER BY period_end DESC
  LIMIT 1
)
SELECT
  p.property_id,
  COALESCE(
    -- 1. Most recent real sale within 10 years
    (SELECT s.sold_price FROM public.sales_transactions s
      WHERE s.property_id = p.property_id
        AND s.sale_date  > CURRENT_DATE - interval '10 years'
        AND s.sold_price > 100000
      ORDER BY s.sale_date DESC LIMIT 1),
    -- 2. Active listing's most recent price
    (SELECT COALESCE(al.last_price, al.initial_price)
       FROM public.available_listings al
      WHERE al.property_id = p.property_id
        AND al.is_active   = true
      ORDER BY COALESCE(al.last_seen, al.listing_date) DESC LIMIT 1),
    -- 3. NOI / cap_rate — broker methodology.
    --    annual_rent capped at $5M to filter operator-revenue pollution.
    (SELECT l.annual_rent / GREATEST((SELECT cap FROM curr_cap), 0.04)
       FROM public.leases l
      WHERE l.property_id = p.property_id
        AND l.is_active   = true
        AND l.annual_rent IS NOT NULL
        AND l.annual_rent > 1000
        AND l.annual_rent < 5000000
      ORDER BY l.lease_start DESC NULLS LAST LIMIT 1),
    -- 4. SF × $400/SF, capped at 200K SF
    (LEAST(p.building_size, 200000) * 400),
    -- 5. current_value_estimate × 0.2 (polluted column)
    (p.current_value_estimate * 0.2),
    -- 6. last_known_rent × 2 (also polluted; capped at $5M)
    (LEAST(p.last_known_rent, 5000000) * 2),
    -- 7. baseline
    1000000
  )::numeric AS rev_value
FROM public.properties p;

COMMENT ON VIEW public.v_property_value_signal IS
  'Best-available real-estate value signal per dia property. Priority: recent sale > active listing > NOI/cap (broker methodology) > SF×$400 capped > polluted columns × heavy discount > $1M baseline. NOI uses active lease annual_rent (NNN) capped at $5M to filter operator-revenue pollution. Cap rate from cm_dialysis_cap_ttm_q TTM weighted (subspecialty=all, latest period).';
`;
  if (DRY) {
    report.push(['supabase/migrations/dialysis/20260517210000_dia_next_best_action_valuation_v3.sql', SQL.length, 'dry-run']);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SQL, 'utf8');
  report.push(['supabase/migrations/dialysis/20260517210000_dia_next_best_action_valuation_v3.sql', SQL.length, 'written']);
}

async function writeGovMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260517210000_gov_next_best_action_valuation_v3.sql');
  const SQL = String.raw`-- ============================================================================
-- Item #4 valuation v3 (gov, 2026-05-17): NOI / cap_rate by lease term.
--
-- Gov side mirrors the dia valuation v3 with federal-property adaptations:
--   • NOI = gross_rent - current_annual_opex (when both present),
--     else gross_rent (gross-lease approximation).
--   • Cap rate from cm_gov_cap_by_term_q matched to properties.term_remaining:
--       term_remaining >= 10 → cap_10plus
--       term_remaining 6-10  → cap_6to10
--       term_remaining < 5   → cap_less5
--       else                  → cap_outside_firm
--     Most term tiers are NULL today (only cap_outside_firm populated
--     ≈ 9.76% Q1 2026); falls back to cm_gov_cap_ttm_q TTM weighted.
--
-- This commit captures the FINAL state already applied to gov
-- (scknotsqkcheojiaewwh) via Supabase MCP.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_property_value_signal AS
WITH curr_cap_all AS (
  SELECT cap_less5, cap_6to10, cap_10plus, cap_outside_firm
  FROM public.cm_gov_cap_by_term_q
  WHERE subspecialty = 'all'
  ORDER BY period_end DESC LIMIT 1
),
curr_cap_ttm AS (
  SELECT ttm_weighted_cap_rate AS cap
  FROM public.cm_gov_cap_ttm_q
  WHERE subspecialty = 'all'
    AND ttm_weighted_cap_rate IS NOT NULL
    AND ttm_weighted_cap_rate > 0
  ORDER BY period_end DESC LIMIT 1
)
SELECT
  p.property_id,
  COALESCE(
    -- 1. Recent sale within 10 years
    (SELECT s.sold_price FROM public.sales_transactions s
      WHERE s.property_id = p.property_id
        AND s.sale_date  > CURRENT_DATE - interval '10 years'
        AND s.sold_price > 100000
      ORDER BY s.sale_date DESC LIMIT 1),
    -- 2. Active listing's most recent price
    (SELECT COALESCE(al.last_price, al.asking_price)
       FROM public.available_listings al
      WHERE al.property_id    = p.property_id
        AND al.listing_status = 'Active'
      ORDER BY COALESCE(al.last_seen_at, al.listing_date) DESC LIMIT 1),
    -- 3. NOI / cap_rate by term tier (broker methodology)
    (
      CASE
        WHEN p.gross_rent IS NULL OR p.gross_rent <= 0 THEN NULL
        ELSE
          GREATEST(p.gross_rent - COALESCE(p.current_annual_opex, 0), p.gross_rent * 0.5)
          /
          GREATEST(
            COALESCE(
              CASE
                WHEN p.term_remaining IS NULL THEN NULL
                WHEN p.term_remaining >= 10   THEN (SELECT cap_10plus FROM curr_cap_all)
                WHEN p.term_remaining >=  6   THEN (SELECT cap_6to10  FROM curr_cap_all)
                WHEN p.term_remaining <   5   THEN (SELECT cap_less5  FROM curr_cap_all)
                ELSE NULL
              END,
              (SELECT cap_outside_firm FROM curr_cap_all),
              (SELECT cap              FROM curr_cap_ttm)
            ),
            0.04
          )
      END
    ),
    -- 4. estimated_value (federal valuations are real)
    p.estimated_value,
    -- 5. gross_rent × 10 (legacy cap-rate-implied)
    (p.gross_rent * 10),
    -- 6. SF × $400/SF, capped at 500K SF
    (LEAST(p.rba, 500000) * 400),
    -- 7. baseline
    1000000
  )::numeric AS rev_value
FROM public.properties p;

COMMENT ON VIEW public.v_property_value_signal IS
  'Best-available real-estate value signal per gov property. Priority: recent sale > active listing > NOI/cap by lease-term tier (broker methodology) > estimated_value > gross_rent×10 > SF×$400 capped at 500K > $1M baseline. Tier-sliced cap rates from cm_gov_cap_by_term_q; falls back to cap_outside_firm → cm_gov_cap_ttm_q.';
`;
  if (DRY) {
    report.push(['supabase/migrations/government/20260517210000_gov_next_best_action_valuation_v3.sql', SQL.length, 'dry-run']);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SQL, 'utf8');
  report.push(['supabase/migrations/government/20260517210000_gov_next_best_action_valuation_v3.sql', SQL.length, 'written']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 4 valuation v3 — NOI ÷ cap_rate (broker methodology)
- **Status:** ✅ DONE (live on dia + gov)
- **Branch:** \`audit/04-valuation-v3\`
- **Patch:** \`audit/patches/04-next-best-action-valuation-v3/apply.mjs\`
- **Migrations applied** via Supabase MCP at 2026-05-17:
  - dia: \`20260517210000_dia_next_best_action_valuation_v3.sql\`
  - gov: \`20260517210000_gov_next_best_action_valuation_v3.sql\`

### Discovery that motivated this
Scott's input — sold 33820 Weyerhaeuser Way (Federal Way, WA) for ~$115M; v_next_best_action ranked it at $575M. Investigation found multiple polluted columns:
- \`dia.properties.current_value_estimate\` — stores dialysis-operator BUSINESS valuations (revenue × ~5× EBITDA), not real estate. Top ranked properties showed implausible $/SF ($12,363/SF on a 5,880 SF Maryland building).
- \`dia.properties.last_known_rent\` — same pollution class.
- \`dia.leases.annual_rent\` — same pollution on the same rows (operator revenue loaded into rent column).

### Fix
Per Scott's broker methodology: NOI ÷ TTM cap rate from CM reports. NOI ≈ active NNN lease annual_rent (with $5M sanity cap). Cap rate from \`cm_dialysis_cap_ttm_q\` (overall subspecialty, 7.85% Q1 2026) and \`cm_gov_cap_by_term_q\` (by lease term tier; today only cap_outside_firm populated ≈ 9.76% Q1 2026, fallback to TTM).

### Value signal priority (final)
1. Most recent sale within 10y (truth)
2. Active listing price (market signal)
3. **NOI ÷ cap_rate (broker methodology)**
4. SF × $400/SF, capped at 200K (dia) or 500K (gov)
5. estimated_value (gov) or current_value_estimate × 0.2 (dia, polluted)
6. gross_rent × 10 (gov) or last_known_rent × 2 capped (dia, polluted)
7. $1M baseline

### Coverage breakdown on dia (15,219 properties)
| Signal source | Count | Quality |
|---|---|---|
| Recent sale | 1,504 | ✅ Truth |
| Active listing | 346 | ✅ Market |
| **NOI ÷ cap_rate** | **2,920** | ✅ Broker methodology |
| SF × $400 capped | 7,031 | OK proxy |
| Polluted CVE × 0.2 | 350 | Discounted |
| Polluted rent × 2 | 13 | Marginal |
| $1M baseline | 3,055 | No signal |

**4,770 properties (31%) now have high-quality real-estate-grounded value signals** vs zero before.

### Open follow-ups
- **Discovery #4 (junk property records)**: Top 10 ranks still tied at $160M cluster — properties with garbage addresses ("property #13900", "Juru Pa Va Lley", "15 5 2 2 2 4 3 2 4") that have no usable data. Either filter from view via address-quality predicate, or investigate upstream ingestion path. **Task #25**.
- **Upstream rent/value column pollution**: The same writer path is loading operator-revenue into properties.current_value_estimate, properties.last_known_rent, AND leases.annual_rent. Worth tracing once item #5 Phase B (silent-write fix) lands more completely.
- **dia cap-rate term tiers**: \`cm_dialysis_cap_ttm_q\` only has \`subspecialty='all'\` today. When the CM pipeline adds term-tier slicing (matching gov's structure), the dia view can be extended to use it.

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
  console.log(`\n=== LCC Audit Sprint — Item #4 Valuation v3 (NOI/cap) ===`);
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
    console.log(`  ${file.padEnd(80)}  ${sign}${delta} bytes  (${note})`);
  }
  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply.\n`);
  } else {
    console.log(`\n✓ Apply complete.\n`);
  }
}
main().catch(err => { console.error(`\n❌ FAILED: ${err.message}\n`); process.exit(1); });
