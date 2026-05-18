#!/usr/bin/env node
// ============================================================================
// LCC Fresh Audit — Finding A-1: backfill orphan sale recorded_owner_id.
//
// Diagnosis (verified 2026-05-18 via MCP):
//   Gov: 6,865 sales had recorded_owner_id=NULL while the linked
//        property's recorded_owner_id WAS populated. Of those, 3,466
//        are the most-recent sale per property (safe to attribute to
//        the property's current owner). The other 3,399 are earlier
//        sales — the buyer at sale-time was a different entity than
//        today's owner (the property changed hands since), so a naive
//        backfill would mis-attribute history.
//
//   Dia: same shape — 1,022 orphan sales, 676 safe, 346 unsafe.
//
//   The cross-check also showed 64 (gov) + 807 (dia) sales where the
//   recorded_owner was already set AND disagreeing with the property's
//   current owner — these are correctly preserved as historical buyers
//   and were untouched.
//
// Migration (single UPDATE per DB, restricted to most-recent orphan):
//
//   WITH ranked AS (
//     SELECT s.sale_id, s.property_id, p.recorded_owner_id AS prop_owner,
//            row_number() OVER (PARTITION BY s.property_id
//                               ORDER BY s.sale_date DESC NULLS LAST,
//                                        s.sale_id DESC) AS rn
//       FROM sales_transactions s
//       JOIN properties p ON p.property_id = s.property_id
//      WHERE s.recorded_owner_id IS NULL
//        AND p.recorded_owner_id IS NOT NULL
//   )
//   UPDATE sales_transactions s
//      SET recorded_owner_id = r.prop_owner,
//          updated_at = now()
//     FROM ranked r
//    WHERE r.rn = 1 AND s.sale_id = r.sale_id;
//
// Verified effect on the NBA queue:
//   Gov orphan_sale_owner: 2,373 → 1,029  (−1,344 closed, −414 excellent-band)
//   Dia orphan_sale_owner:   283 →    31  (−252 closed, −32 excellent-band)
//   Total NBA gap reduction: 1,596 rows.
//
// Both migrations already applied via Supabase MCP at 2026-05-18.
// This patch commits the .sql files for repo provenance + updates
// AUDIT_PROGRESS.md.
//
// Branch: audit/fresh-A1-orphan-sale-owner-backfill
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

const SHARED_SQL = `-- Restrict to most-recent orphan sale per property. The property's
-- recorded_owner_id only safely attributes to the LATEST transaction;
-- earlier orphan sales had different buyers (the property has changed
-- hands since) and stay as legit orphan_sale_owner NBA gaps until they
-- can be resolved via ownership_history.
WITH ranked AS (
  SELECT s.sale_id,
         s.property_id,
         p.recorded_owner_id AS prop_owner,
         row_number() OVER (
           PARTITION BY s.property_id
           ORDER BY s.sale_date DESC NULLS LAST, s.sale_id DESC
         ) AS rn
    FROM public.sales_transactions s
    JOIN public.properties p ON p.property_id = s.property_id
   WHERE s.recorded_owner_id IS NULL
     AND p.recorded_owner_id IS NOT NULL
)
UPDATE public.sales_transactions s
   SET recorded_owner_id = r.prop_owner,
       updated_at = now()
  FROM ranked r
 WHERE r.rn = 1
   AND s.sale_id = r.sale_id;`;

const DIA_SQL = `-- ============================================================================
-- Fresh audit A-1 (dia, 2026-05-18): backfill recorded_owner_id on the
-- most-recent orphan sale per property using properties.recorded_owner_id.
--
-- Verified safety counts (before):
--   safe_most_recent_orphan   676
--   unsafe_earlier_sales      346  (left untouched)
--   single_sale_only          436  (subset of safe)
--   already_set_and_disagreeing 807 (preserved — historical buyers)
--
-- Effect on NBA queue:
--   orphan_sale_owner: 283 → 31  (-252 closed, -32 excellent-band)
-- ============================================================================
${SHARED_SQL}`;

const GOV_SQL = `-- ============================================================================
-- Fresh audit A-1 (gov, 2026-05-18): backfill recorded_owner_id on the
-- most-recent orphan sale per property using properties.recorded_owner_id.
--
-- Verified safety counts (before):
--   safe_most_recent_orphan  3,466
--   unsafe_earlier_sales     3,399  (left untouched)
--   single_sale_only         1,987  (subset of safe)
--   already_set_and_disagreeing  64 (preserved — historical buyers)
--
-- Effect on NBA queue:
--   orphan_sale_owner: 2,373 → 1,029  (-1,344 closed, -414 excellent-band)
-- ============================================================================
${SHARED_SQL}`;

async function writeDiaMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260518100000_dia_backfill_orphan_sale_owners.sql');
  await writeFileEnsuringDir(path, DIA_SQL, report,
    'supabase/migrations/dialysis/20260518100000_dia_backfill_orphan_sale_owners.sql');
}

async function writeGovMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260518100000_gov_backfill_orphan_sale_owners.sql');
  await writeFileEnsuringDir(path, GOV_SQL, report,
    'supabase/migrations/government/20260518100000_gov_backfill_orphan_sale_owners.sql');
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

---
# Fresh audit — 2026-05-18

Triggered after the original Top-10 sprint closed. Surveyed
ingest_write_failures, client_errors, the NBA queue gap distribution
on both DBs, and the persisted-completeness column rollout. Five
findings; ranked by leverage.

## Finding A-1 ✅ — 4,142 orphan sale owner backlinks auto-fixed
- **Status:** ✅ DONE — backfill applied to both DBs via MCP at 2026-05-18.
- **Branch:** \`audit/fresh-A1-orphan-sale-owner-backfill\`
- **Patch:** \`audit/patches/fresh-A1-orphan-sale-owner-backfill/apply.mjs\`

### Diagnosis
The NBA queue's \`orphan_sale_owner\` gap was the second-largest category. Drill-in showed 7,887 sales (gov: 6,865 / dia: 1,022) had \`recorded_owner_id = NULL\` while the linked property's \`recorded_owner_id\` WAS populated. The naive UPDATE would have backfilled all 7,887, but the safety check showed only **4,142 are the most-recent sale per property** (the rest were earlier sales where the buyer was a different entity that has since been replaced — naive backfill would corrupt historical attribution).

### Fix
Single UPDATE per DB restricted to \`row_number() OVER (PARTITION BY property_id ORDER BY sale_date DESC) = 1\` on the orphan set.

### Effect on NBA queue
| DB | Before | After | Closed |
|---|---:|---:|---:|
| Gov orphan_sale_owner | 2,373 | 1,029 | **−1,344** (of which **−414 excellent-band**) |
| Dia orphan_sale_owner | 283 | 31 | **−252** (of which **−32 excellent-band**) |
| **Total** | **2,656** | **1,060** | **−1,596** |

The remaining 1,060 are either earlier sales (need ownership_history resolution — not in scope here) or sales on properties that don't have a recorded_owner_id yet (Item #3 Phase C territory).

### Files changed
- \`supabase/migrations/dialysis/20260518100000_dia_backfill_orphan_sale_owners.sql\`
- \`supabase/migrations/government/20260518100000_gov_backfill_orphan_sale_owners.sql\`
- \`AUDIT_PROGRESS.md\` — this fresh-audit log

## Remaining fresh-audit findings (queued)

### Finding A-2 — 269 sales_transactions 409 dedupe conflicts (24h)
- Item #5 Phase A instrumentation has captured 269 silent 409 conflicts on \`sales_transactions\` over the past 24h. Discovery #2 captured this but the dedupe migration was deferred. Need to ship it. **Priority: high.**

### Finding A-3 — 579 unlabeled 400 errors (instrumentation gap)
- 579 ingest_write_failures rows in last 24h have \`label = null\`. Means writers aren't passing labels to \`domainQuery\`. Need to grep for unlabeled calls + add labels. **Priority: medium** (investigative).

### Finding A-4 — 54 upsertDomainLoans:financing 400 errors (24h)
- Discovery #1 expanded the loans CHECK constraint, but 54 writes/day still being rejected. Either a new loan_type emerged that needs the CHECK extended, OR the writer is hitting a different constraint (NOT NULL on a column it's not sending). **Priority: medium.**

### Finding A-5 — gov agency_drift:agency_disagreement (807 cases, 204 excellent) needs a review UI
- 204 excellent-band properties have agency disagreement between \`properties.agency\` and the lease record. Each is a quick human judgment call. Adapt the LLC Research widget pattern (just shipped in #2B) — ~30-50 lines. **Priority: medium.**

## Phase C punch list (carried forward)
| Item | Description | Effort |
|---|---|---|
| #3 Phase C | External enrichment pipeline for 13,131 NULL-owner properties (SoS / county / commercial API) | Multi-week |
| #8 Phase B | Per-action inline workflows on next-action bar (open SoS direct, multi-step sequences) | Small |
| Sort/chip helper adoption per tab | Sales / Listings / Portfolio / Prospects / Ops / Loans | Small per tab |
| pushProvenance gating sweep | Adopt the gating pattern across the remaining ~30 call sites | Medium |
| client_errors consumption | Migrate ~50 ad-hoc \`console.warn + showToast\` to \`lccReportError\` | Medium |
| ingest_write_failures admin dashboard | Settings widget showing recent failure rates | Small |

`);

  // Append at the very end (no preflight anchor to insert before in the
  // post-sprint state of the doc).
  c = c + appendBlock;

  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Fresh Audit A-1 — orphan sale owner backfill ===');
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
