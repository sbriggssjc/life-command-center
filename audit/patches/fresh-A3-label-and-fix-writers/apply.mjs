#!/usr/bin/env node
// ============================================================================
// LCC Fresh Audit — Finding A-3: label + fix unlabeled writer 4xx loop.
//
// 24h breakdown of label=null failures (from ingest_write_failures):
//   sales_transactions  409  264  → already labeled by A-2 (deploys soon)
//   sf_comps_staging    400  178  → schema drift: writer sends columns
//                                     that don't exist (address/sale_price/
//                                     sale_date/buyer_name/seller_name/
//                                     square_feet). This patch rewrites
//                                     the writer's column map.
//   rpc/lcc_record_     400  150  → CHECK rejected 'inferred_active'
//   listing_check                   value. Already fixed via the
//                                     lvh_check_result_check expansion
//                                     (this patch commits the .sql files
//                                     for repo provenance + labels the
//                                     RPC call sites for future telemetry).
//   leases              400   98  → gov_reject_dateless_active_lease trigger
//                                     correctly blocks active leases with
//                                     both dates NULL. Writer now skips
//                                     this case (matches trigger intent).
//   loans               400   94  → already fixed by A-4 (CHECK allow NULL
//                                     + mapLoanStatus normalizer).
//
// Net: 178 + 98 + 150 = 426 daily silent 4xx failures resolved by this
// patch (plus 264 + 94 from prior patches A-2 + A-4 once they deploy).
//
// Branch: audit/fresh-A3-label-and-fix-writers
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
  if (occ > 1)  throw new Error(label + ': anchor matched ' + occ + ' times in ' + path);
  if (oldN === newN) { report.push([label, 0, 'no changes']); return; }
  const updated = original.replace(oldN, () => newN);
  const delta = updated.length - original.length;
  report.push([label + ' (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}
async function writeFileEnsuringDir(path, content, report, label) {
  if (DRY) { report.push([label, content.length, 'dry-run']); return; }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  report.push([label, content.length, 'written']);
}

// ─── SQL migrations (already applied via MCP, committed for repo provenance) ─
async function writeDiaMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260518120000_dia_lvh_check_add_inferred_active.sql');
  const SQL = `-- Fresh audit A-3 (dia, 2026-05-18): expand listing_verification_history
-- check_result CHECK to include 'inferred_active'. The timer-driven
-- auto-scrape path records "still listed by inference (no sale evidence
-- in 3y window)" as a distinct outcome from "still_available" (which
-- implies the scraper actually saw the listing live). 150 silent 4xx/24h.
ALTER TABLE public.listing_verification_history DROP CONSTRAINT IF EXISTS lvh_check_result_check;
ALTER TABLE public.listing_verification_history
  ADD CONSTRAINT lvh_check_result_check
  CHECK (check_result = ANY (ARRAY[
    'still_available'::text,
    'price_changed'::text,
    'off_market'::text,
    'sold'::text,
    'unreachable'::text,
    'manual_review_needed'::text,
    'inferred_active'::text
  ]));`;
  await writeFileEnsuringDir(path, SQL, report,
    'supabase/migrations/dialysis/20260518120000_dia_lvh_check_add_inferred_active.sql');
}
async function writeGovMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260518120000_gov_lvh_check_add_inferred_active.sql');
  const SQL = `-- Gov mirror — idempotent (only fires if the CHECK exists on gov).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid WHERE t.relname='listing_verification_history' AND c.conname='lvh_check_result_check') THEN
    ALTER TABLE public.listing_verification_history DROP CONSTRAINT lvh_check_result_check;
    ALTER TABLE public.listing_verification_history
      ADD CONSTRAINT lvh_check_result_check
      CHECK (check_result = ANY (ARRAY[
        'still_available'::text,
        'price_changed'::text,
        'off_market'::text,
        'sold'::text,
        'unreachable'::text,
        'manual_review_needed'::text,
        'inferred_active'::text
      ]));
  END IF;
END $$;`;
  await writeFileEnsuringDir(path, SQL, report,
    'supabase/migrations/government/20260518120000_gov_lvh_check_add_inferred_active.sql');
}

// ─── api/_handlers/sidebar-pipeline.js: 2 fixes ───
async function patchSidebarPipeline(report) {
  const path = resolve(REPO_ROOT, 'api', '_handlers', 'sidebar-pipeline.js');
  if (!await fileExists(path)) throw new Error('sidebar-pipeline.js not found.');

  // 1. Rewrite the autoStageGovComp writer to use the real sf_comps_staging
  //    schema (verified via MCP). Old columns (address/sale_price/sale_date/
  //    buyer_name/seller_name/square_feet/sync_status) don't exist; new map
  //    uses street/sold_price/sold_date/building_sf + raw_row JSONB for
  //    buyer/seller info that has no dedicated column.
  await replaceUnique(path,
    `  await domainQuery('government', 'POST', 'sf_comps_staging', {
    address:        entity.address || null,
    city:           entity.city    || null,
    state:          entity.state   || null,
    sale_date:      saleDate,
    sale_price:     parseCurrency(mostRecentSale.sale_price),
    cap_rate:       parseCapRateDecimal(mostRecentSale.cap_rate),
    buyer_name:     cleanSalesPartyValue(buyerContact?.name || mostRecentSale.buyer),
    seller_name:    cleanSalesPartyValue(sellerContact?.name || mostRecentSale.seller),
    square_feet:    parseSF(metadata.square_footage),
    property_id:    propertyId,
    data_source:    'costar_sidebar',
    sync_status:    'pending',
    created_at:     new Date().toISOString(),
  });`,
    `  // Fresh audit A-3 (2026-05-18): rewritten to match the real
  // sf_comps_staging schema. The old payload (address/sale_price/
  // sale_date/buyer_name/seller_name/square_feet/sync_status) didn't
  // match any columns — PostgREST 400'd every write with PGRST204
  // "Could not find the 'address' column" (178 silent 4xx/24h).
  // Real columns: street/sold_price/sold_date/building_sf/...
  // Buyer + seller names stash in raw_row (jsonb) since the table
  // has no dedicated columns for them.
  await domainQuery('government', 'POST', 'sf_comps_staging', {
    street:             entity.address || null,
    city:               entity.city    || null,
    state:              entity.state   || null,
    sold_date:          saleDate,
    sold_price:         parseCurrency(mostRecentSale.sale_price),
    sold_cap_rate:      parseCapRateDecimal(mostRecentSale.cap_rate),
    building_sf:        parseSF(metadata.square_footage),
    linked_property_id: propertyId,
    source_system:      'costar_sidebar',
    process_status:     'pending',
    raw_row: {
      buyer_name:  cleanSalesPartyValue(buyerContact?.name || mostRecentSale.buyer),
      seller_name: cleanSalesPartyValue(sellerContact?.name || mostRecentSale.seller),
    },
  }, { label: 'autoStageGovComp' });`,
    report, 'sidebar-pipeline.js (A-3: sf_comps_staging rewrite)');

  // 2. Gov leases: skip dateless active writes (gov_reject_dateless_active_lease
  //    trigger correctly rejects these). Add a label so any future failures
  //    surface with caller context.
  await replaceUnique(path,
    `    const payload = {
      property_id:        propertyId,
      lease_number:       leaseNumber,
      tenant_agency:      tenantAgency,
      tenant_agency_full: tenantAgency,
      government_type:    govType,
      commencement_date:  commence,
      expiration_date:    expire,
      // Per-tenant SF when surfaced by the page; falls back to null so
      // the column doesn't get clobbered by an aggregate value.
      annual_rent:        annualRent,
      rent_psf:           rentPsf,
      expense_structure:  expense,
      renewal_options:    renewal,
      data_source:        'costar_sidebar',
      updated_at:         new Date().toISOString(),
    };

    if (existing.ok && existing.data?.length) {
      const leaseId = existing.data[0].lease_id;
      await domainPatch('government',
        \`leases?lease_id=eq.\${leaseId}\`,
        payload,
        'upsertGovernmentLeases:refresh'
      );`,
    `    const payload = {
      property_id:        propertyId,
      lease_number:       leaseNumber,
      tenant_agency:      tenantAgency,
      tenant_agency_full: tenantAgency,
      government_type:    govType,
      commencement_date:  commence,
      expiration_date:    expire,
      // Per-tenant SF when surfaced by the page; falls back to null so
      // the column doesn't get clobbered by an aggregate value.
      annual_rent:        annualRent,
      rent_psf:           rentPsf,
      expense_structure:  expense,
      renewal_options:    renewal,
      data_source:        'costar_sidebar',
      updated_at:         new Date().toISOString(),
    };

    // Fresh audit A-3 (2026-05-18): the gov_reject_dateless_active_lease
    // trigger correctly blocks active-lease writes with both dates NULL
    // (98 silent 4xx/24h). Honor the trigger's intent by skipping the
    // write up-front. Existing leases (UPDATE branch below) are fine — the
    // trigger only rejects new active rows lacking both dates.
    if (!existing.ok || !existing.data?.length) {
      if (!commence && !expire) {
        console.log('[upsertGovernmentLeases] skipped dateless active lease ' +
          'property=' + propertyId + ' tenant_agency=' + JSON.stringify(tenantAgency) +
          ' — both dates NULL; gov_reject_dateless_active_lease would reject.');
        continue;
      }
    }

    if (existing.ok && existing.data?.length) {
      const leaseId = existing.data[0].lease_id;
      await domainPatch('government',
        \`leases?lease_id=eq.\${leaseId}\`,
        payload,
        'upsertGovernmentLeases:refresh'
      );`,
    report, 'sidebar-pipeline.js (A-3: leases dateless skip)');

  // 3. Add label to the gov leases POST (single anchor, 4 lines away from the
  //    patch above — uses the line immediately preceding the POST).
  await replaceUnique(path,
    `    const r = await domainQuery('government', 'POST', 'leases', payload);
    if (r.ok) {
      const created = Array.isArray(r.data) ? r.data[0] : r.data;
      const newLeaseId = created?.lease_id || null;
      console.log(\`[upsertGovernmentLeases] inserted costar_sidebar lease \``,
    `    const r = await domainQuery('government', 'POST', 'leases', payload,
      { label: 'upsertGovernmentLeases:insert' });
    if (r.ok) {
      const created = Array.isArray(r.data) ? r.data[0] : r.data;
      const newLeaseId = created?.lease_id || null;
      console.log(\`[upsertGovernmentLeases] inserted costar_sidebar lease \``,
    report, 'sidebar-pipeline.js (A-3: gov leases POST label)');
}

// ─── api/admin.js: 2 RPC labels for lcc_record_listing_check ───
async function patchAdminJs(report) {
  const path = resolve(REPO_ROOT, 'api', 'admin.js');
  if (!await fileExists(path)) throw new Error('api/admin.js not found.');

  // Call site #1 (auto-scrape sweep, around line 530)
  await replaceUnique(path,
    `        const rpcRes = await domainQuery(dom, 'POST', 'rpc/lcc_record_listing_check', {
          p_listing_id: l.listing_id,
          p_method: 'auto_scrape',
          p_check_result: checkResult,`,
    `        const rpcRes = await domainQuery(dom, 'POST', 'rpc/lcc_record_listing_check', {
          p_listing_id: l.listing_id,
          p_method: 'auto_scrape',
          p_check_result: checkResult,
          // Fresh audit A-3 (2026-05-18): label inserted via opts below`,
    report, 'admin.js (A-3: comment marker for auto-scrape RPC)');

  // We'll use a different anchor strategy — find the closing of each RPC
  // call and add the label opts param. Find the unique closing pattern.
  // Each RPC call ends with: }); — but that's ambiguous. Use the line
  // BEFORE the closing brace for uniqueness.

  await replaceUnique(path,
    `          p_off_market_reason: offMarketReason,
          p_notes: notes,
          p_verified_by: user.id || null,
        });`,
    `          p_off_market_reason: offMarketReason,
          p_notes: notes,
          p_verified_by: user.id || null,
        }, { label: 'autoScrapeListings:recordCheck' });`,
    report, 'admin.js (A-3: auto-scrape RPC label)');

  // Call site #2 (availability-promotion-sweep, around line 741)
  await replaceUnique(path,
    `          p_off_market_reason: 'sold',
          p_effective_at: best.sale_date,
          p_notes: \`availability-promotion-sweep: matched sales_transactions sale_id=\${best.sale_id} on \${best.sale_date} (was unverified_assumed_off)\`,
          p_verified_by: user.id || null,
        });`,
    `          p_off_market_reason: 'sold',
          p_effective_at: best.sale_date,
          p_notes: \`availability-promotion-sweep: matched sales_transactions sale_id=\${best.sale_id} on \${best.sale_date} (was unverified_assumed_off)\`,
          p_verified_by: user.id || null,
        }, { label: 'availabilityPromotionSweep:recordCheck' });`,
    report, 'admin.js (A-3: availability-promotion RPC label)');
}

// ─── api/_handlers/entities-handler.js: 1 RPC label ───
async function patchEntitiesHandler(report) {
  const path = resolve(REPO_ROOT, 'api', '_handlers', 'entities-handler.js');
  if (!await fileExists(path)) throw new Error('entities-handler.js not found.');

  await replaceUnique(path,
    `          const rpcRes = await domainQuery(domain, 'POST', 'rpc/lcc_record_listing_check', {
            p_listing_id: l.listing_id,
            p_method: method,
            p_check_result: check_result,
            p_asking_price: asking_price != null ? Number(asking_price) : null,
            p_cap_rate: cap_rate != null ? Number(cap_rate) : null,
            p_source_url: source_url || null,
            p_off_market_reason: off_market_reason || null,
            p_notes: notes || null,
            p_verified_by: user.id || null,`,
    `          const rpcRes = await domainQuery(domain, 'POST', 'rpc/lcc_record_listing_check', {
            p_listing_id: l.listing_id,
            p_method: method,
            p_check_result: check_result,
            p_asking_price: asking_price != null ? Number(asking_price) : null,
            p_cap_rate: cap_rate != null ? Number(cap_rate) : null,
            p_source_url: source_url || null,
            p_off_market_reason: off_market_reason || null,
            p_notes: notes || null,
            p_verified_by: user.id || null,`,
    report, 'entities-handler.js (A-3: noop — anchor verifies)');

  // The actual label add — use the closing }); as the anchor target.
  await replaceUnique(path,
    `            p_off_market_reason: off_market_reason || null,
            p_notes: notes || null,
            p_verified_by: user.id || null,
          });`,
    `            p_off_market_reason: off_market_reason || null,
            p_notes: notes || null,
            p_verified_by: user.id || null,
          }, { label: 'entitiesHandler:recordListingCheck' });`,
    report, 'entities-handler.js (A-3: entities-handler RPC label)');
}

// ─── AUDIT_PROGRESS.md ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Fresh audit A-3 ✅ — label + fix unlabeled writer 4xx loop
- **Status:** ✅ DONE.
- **Branch:** \`audit/fresh-A3-label-and-fix-writers\`
- **Patch:** \`audit/patches/fresh-A3-label-and-fix-writers/apply.mjs\`

### Diagnosis
579 ingest_write_failures rows over 24h had \`label = null\`. Per-path breakdown:
| Path | Status | n | Root cause |
|---|---|---:|---|
| sales_transactions | 409 | 264 | unlabeled POST that gets recovered. Labeled in A-2. |
| sf_comps_staging | 400 | 178 | schema drift — writer sends columns that don't exist. |
| rpc/lcc_record_listing_check | 400 | 150 | CHECK rejected \`'inferred_active'\`. |
| leases | 400 | 98 | \`gov_reject_dateless_active_lease\` trigger blocks active-with-dates-NULL. |
| loans | 400 | 94 | NULL status + unparseable CoStar text. Fixed in A-4. |

### Three fixes in this patch (resolves 426 of 579 daily failures)

**1. sf_comps_staging writer rewrite (178/24h → 0)**
Real schema (verified via MCP) has \`street/sold_price/sold_date/building_sf/source_system/process_status/raw_row\`. Old writer sent \`address/sale_price/sale_date/buyer_name/seller_name/square_feet/sync_status\` — every column wrong. Rewritten the writer's column map. Buyer + seller names (no dedicated columns) stash in the \`raw_row\` jsonb. Label \`autoStageGovComp\`.

**2. gov leases dateless-active skip (98/24h → 0)**
The \`gov_reject_dateless_active_lease\` trigger correctly rejects new active leases with both \`commencement_date\` and \`expiration_date\` NULL. Writer now short-circuits with a console.log before the POST when both dates are missing. Honor the trigger's intent without 4xx'ing the log. Label \`upsertGovernmentLeases:insert\` on the genuine POST.

**3. rpc/lcc_record_listing_check (150/24h → 0)**
The auto-scrape path writes \`check_result='inferred_active'\` to \`listing_verification_history\` when the timer expires without sale evidence. The CHECK only allowed 6 values. Expanded the CHECK on both dia + gov to include \`'inferred_active'\` (applied via MCP at 2026-05-18). Plus added labels to 3 RPC call sites (\`autoScrapeListings:recordCheck\`, \`availabilityPromotionSweep:recordCheck\`, \`entitiesHandler:recordListingCheck\`) for future telemetry.

### Files changed
- \`supabase/migrations/dialysis/20260518120000_dia_lvh_check_add_inferred_active.sql\` (already applied via MCP)
- \`supabase/migrations/government/20260518120000_gov_lvh_check_add_inferred_active.sql\` (already applied via MCP)
- \`api/_handlers/sidebar-pipeline.js\` — sf_comps_staging rewrite + leases dateless skip + label
- \`api/admin.js\` — 2 RPC labels (auto-scrape + availability-promotion)
- \`api/_handlers/entities-handler.js\` — 1 RPC label
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification (post-deploy)
1. \`grep -c "autoStageGovComp" api/_handlers/sidebar-pipeline.js\` → 1+
2. \`grep -c "upsertGovernmentLeases:insert" api/_handlers/sidebar-pipeline.js\` → 1+
3. \`grep -c "recordCheck" api/admin.js api/_handlers/entities-handler.js\` → 3+
4. After a few hours of traffic, on LCC Opps:
   \`\`\`sql
   SELECT path, http_status, count(*)
     FROM public.ingest_write_failures
    WHERE occurred_at > now() - interval '1 hour'
      AND label IS NULL
    GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10;
   -- Expected: sf_comps_staging / leases / rpc/lcc_record_listing_check
   --           drop out of the top-N.
   \`\`\`

### Fresh-audit punch list after this patch
- A-1 ✅ orphan sale backfill (1,596 NBA gaps closed)
- A-2 ✅ sales POST labeled
- **A-3 ✅** label + fix unlabeled writers (426/24h closed)
- A-4 ✅ loans status normalized + CHECK loosened
- A-5 📋 agency-drift review UI (last one)

`);
  c = c + appendBlock;
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Fresh Audit A-3 — label + fix unlabeled writers ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await writeDiaMigration(report);
  await writeGovMigration(report);
  await patchSidebarPipeline(report);
  await patchAdminJs(report);
  await patchEntitiesHandler(report);
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
