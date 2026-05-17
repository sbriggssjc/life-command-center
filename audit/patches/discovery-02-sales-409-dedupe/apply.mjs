#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Discovery patch #2: sales_transactions 409 dedupe recovery
// Surfaced by item #5 instrumentation: 26+ silent 409s per gov sidebar capture
// on the uq_st_property_date_price partial unique index.
// Branch: audit/discovery-02-sales-409-dedupe
// ============================================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

class EditError extends Error {
  constructor(label, msg) { super(`[${label}] ${msg}`); this.label = label; }
}
function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
function toEol(s, eol) { return s.replace(/\r\n/g, '\n').replace(/\n/g, eol); }
function expectUnique(content, anchor, label) {
  const n = content.split(anchor).length - 1;
  if (n === 0) throw new EditError(label, 'anchor NOT FOUND.');
  if (n > 1)   throw new EditError(label, `anchor matched ${n} times.`);
}
function makeApplier(originalContent) {
  const eol = detectEol(originalContent);
  let content = originalContent;
  return {
    eol, get content(){return content;},
    E(label, before, after) {
      const b = toEol(before, eol);
      const a = toEol(after, eol);
      expectUnique(content, b, label);
      content = content.replace(b, a);
    },
  };
}
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

// ============================================================================
// FILE 1: api/_handlers/sidebar-pipeline.js
// ----------------------------------------------------------------------------
// In upsertDomainSales's "Create new" branch (line ~4710), wrap the POST
// in defensive 409-recovery logic. On 409 against uq_st_property_date_price:
//   1. Look up the conflicting row by EXACT (property_id, sale_date, sold_price)
//   2. PATCH the existing row with our refreshed data
//   3. Continue the same post-write flow (close listings, link brokers, provenance)
// On non-409 errors, the original silent-failure behavior is preserved
// (item #5 instrumentation captures them).
// ============================================================================
async function patchSidebarPipeline(report) {
  const path = resolve(REPO_ROOT, 'api', '_handlers', 'sidebar-pipeline.js');
  const original = await readFile(path, 'utf8');
  const ctx = makeApplier(original);

  ctx.E('sidebar.salesPost.409-recovery',
`    } else {
      // Create new
      const result = await domainQuery(domain, 'POST', 'sales_transactions', saleData);
      if (result.ok) {
        count++;
        // Create BD alert for new dialysis sale capture (gov uses sf_comps_staging)
        if (domain === 'dialysis') {
          await createSaleAlert(propertyId, saleData);
        }
        // Close any still-active listings for this property on a new sale.
        // The POST uses Prefer: return=representation (see domain-db.js) so
        // result.data is the inserted row(s) — grab sale_id off it to stamp
        // onto the dialysis listing row as sale_transaction_id.
        const inserted = Array.isArray(result.data) ? result.data[0] : result.data;
        const newSaleId = inserted?.sale_id ?? null;
        await closeActiveListingsOnSale(
          domain, propertyId, datePart, saleData.sold_price, newSaleId
        );
        // Link brokers from text fields to sale_brokers table
        await linkSaleBrokers(domain, newSaleId, saleData);
        // Phase 2.2.b: record per-row provenance for the new sale
        if (newSaleId) {
          pushProvenance(provCollect, 'sales_transactions', newSaleId, {
            sale_date:        saleData.sale_date,
            sold_price:       saleData.sold_price,
            buyer_name:       saleData.buyer_name || saleData.buyer || null,
            seller_name:      saleData.seller_name || saleData.seller || null,
            stated_cap_rate:  saleData.stated_cap_rate ?? null,
            sold_cap_rate:    saleData.sold_cap_rate ?? null,
            listing_broker:   saleData.listing_broker || null,
            procuring_broker: saleData.procuring_broker || saleData.purchasing_broker || null,
            transaction_type: saleData.transaction_type || null,
          });
        }
      }
    }`,
`    } else {
      // Create new
      const result = await domainQuery(domain, 'POST', 'sales_transactions', saleData);

      // Discovery patch #2 (audit/discovery-02-sales-409-dedupe, 2026-05-17):
      // defensive 409 recovery against uq_st_property_date_price partial
      // unique index on (property_id, sale_date, sold_price). The upstream
      // lookup uses fuzzy match (price ±5%, date ±14d); when an exact-match
      // row already exists from another writer (deed parser, RCA capture)
      // the lookup misses but the unique index still rejects. Pre-patch
      // observed: 26+ silent 409s per gov sidebar capture.
      let recoveredSaleId = null;
      if (!result.ok
          && result.status === 409
          && /uq_st_property_date_price/.test(JSON.stringify(result.data || {}))) {
        const exactLookup = await domainQuery(domain, 'GET',
          \`sales_transactions?property_id=eq.\${propertyId}\` +
          \`&sale_date=eq.\${encodeURIComponent(saleData.sale_date)}\` +
          \`&sold_price=eq.\${saleData.sold_price}\` +
          \`&select=sale_id&limit=1\`
        );
        if (exactLookup.ok && exactLookup.data?.length) {
          recoveredSaleId = exactLookup.data[0].sale_id;
          // PATCH the existing row with our refreshed payload. Force an
          // updated_at bump so the audit trail reflects this re-ingest.
          const patchData = { ...saleData, updated_at: new Date().toISOString() };
          // Same field-priority gate as the upstream-lookup PATCH branch,
          // so a fuzzy-miss recovery doesn't bypass curated data protection.
          const filteredRecoveryPatch = await filterByFieldPriority({
            targetDb:    domain === 'dialysis' ? 'dia_db' : 'gov_db',
            targetTable: domain === 'dialysis' ? 'dia.sales_transactions' : 'gov.sales_transactions',
            recordPk:    recoveredSaleId,
            source:      metadata._intake_promoted ? 'om_extraction' : 'costar_sidebar',
            confidence:  metadata._intake_promoted ? 0.7 : 0.6,
            fields:      patchData,
          }).catch(() => patchData);
          await domainPatch(domain,
            \`sales_transactions?sale_id=eq.\${recoveredSaleId}\`,
            filteredRecoveryPatch,
            'upsertDomainSales:409Recovery'
          );
          console.log(\`[upsertDomainSales:409Recovery] recovered sale \${recoveredSaleId} for property=\${propertyId} date=\${saleData.sale_date} price=\${saleData.sold_price}\`);
        }
      }

      if (result.ok || recoveredSaleId) {
        count++;
        // Determine the sale_id to use for the post-write flow:
        //   • result.ok       → freshly inserted, sale_id from response
        //   • recoveredSaleId → 409 recovery, sale_id from exact lookup
        const inserted = result.ok
          ? (Array.isArray(result.data) ? result.data[0] : result.data)
          : null;
        const newSaleId = inserted?.sale_id ?? recoveredSaleId ?? null;

        // Create BD alert for new dialysis sale capture (gov uses sf_comps_staging).
        // Only on a TRUE insert — 409 recovery means we already knew about this sale.
        if (domain === 'dialysis' && result.ok) {
          await createSaleAlert(propertyId, saleData);
        }
        // Close any still-active listings for this property on a new sale.
        await closeActiveListingsOnSale(
          domain, propertyId, datePart, saleData.sold_price, newSaleId
        );
        // Link brokers from text fields to sale_brokers table
        await linkSaleBrokers(domain, newSaleId, saleData);
        // Phase 2.2.b: record per-row provenance for the sale (insert or recovery)
        if (newSaleId) {
          pushProvenance(provCollect, 'sales_transactions', newSaleId, {
            sale_date:        saleData.sale_date,
            sold_price:       saleData.sold_price,
            buyer_name:       saleData.buyer_name || saleData.buyer || null,
            seller_name:      saleData.seller_name || saleData.seller || null,
            stated_cap_rate:  saleData.stated_cap_rate ?? null,
            sold_cap_rate:    saleData.sold_cap_rate ?? null,
            listing_broker:   saleData.listing_broker || null,
            procuring_broker: saleData.procuring_broker || saleData.purchasing_broker || null,
            transaction_type: saleData.transaction_type || null,
            cap_rate_noi_source_table: saleData.cap_rate_noi_source_table || null,
            cap_rate_noi_source_id:    saleData.cap_rate_noi_source_id ?? null,
            cap_rate_quality:          saleData.cap_rate_quality || null,
          });
        }
      }
    }`);

  const c = ctx.content;
  if (c === original) {
    report.push(['sidebar-pipeline.js', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`api/_handlers/sidebar-pipeline.js (${ctx.eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

// ============================================================================
// FILE 2: AUDIT_PROGRESS.md
// ============================================================================
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  let c = original;

  const appendBlock = N(`

## Discovery patch #2 — sales_transactions 409 dedupe recovery (2026-05-17)
- **Trigger:** After Discovery #1 silenced the schema-drift failures, the residual silent-failure pattern visible in \`v_ingest_write_failures_by_label\` was 26+ HTTP 409s per gov sidebar capture against the \`uq_st_property_date_price\` partial unique index.
- **Branch:** \`audit/discovery-02-sales-409-dedupe\`
- **Patch:** \`audit/patches/discovery-02-sales-409-dedupe/apply.mjs\`

### What was failing
The \`uq_st_property_date_price\` partial unique index on \`gov.sales_transactions\` enforces uniqueness on \`(property_id, sale_date, sold_price) WHERE sale_date IS NOT NULL AND exclude_from_market_metrics IS NOT TRUE\`. \`upsertDomainSales\`'s upstream lookup uses fuzzy match (\`price ±5%\` AND \`date ±14d\`), which misses cases where another writer (deed parser, RCA capture, sidebar-pipeline-from-prior-version) inserted an exact-match row. The POST then 409s against the unique index and the work is silently dropped.

### Fix
Defensive 409 recovery at the POST call site (\`api/_handlers/sidebar-pipeline.js:4711\`):
1. On 409 whose error_detail mentions \`uq_st_property_date_price\`, GET the existing row by EXACT \`(property_id, sale_date, sold_price)\`.
2. PATCH the row with the refreshed payload (gated through the same \`filterByFieldPriority\` as the normal upstream-lookup branch).
3. Continue the same post-write flow (close listings, link brokers, push provenance) using the recovered sale_id.
4. Skip the dialysis \`createSaleAlert\` call on recovery (it's a re-ingest, not a new sale signal).

The unique-index error message string is matched conservatively so future schema-renames don't accidentally trigger recovery on different conflicts.

### Verification (post-deploy)
\`\`\`sql
-- On LCC Opps: 409 count should drop after next gov sidebar capture
SELECT label, http_status, count(*) AS n
FROM v_ingest_write_failures_recent
WHERE http_status = 409
  AND occurred_at > now() - interval '15 minutes'
GROUP BY label, http_status
ORDER BY n DESC;

-- A new label 'upsertDomainSales:409Recovery' may appear in Vercel logs
-- (console.log) confirming the recovery path is firing successfully.
\`\`\`

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
  console.log(`\n=== LCC Audit Sprint — Discovery #2: sales 409 dedupe ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN (no writes)' : 'APPLY (will write files)'}\n`);
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}.`);
  }
  const report = [];
  await patchSidebarPipeline(report);
  await updateAuditProgress(report);
  console.log(`--- ${DRY ? 'DRY-RUN' : 'APPLY'} SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(70)}  ${sign}${delta} bytes  (${note})`);
  }
  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply.\n`);
    console.log(`  node audit/patches/discovery-02-sales-409-dedupe/apply.mjs --apply\n`);
  } else {
    console.log(`\n✓ Apply complete.\n`);
    console.log(`  git add -A && git commit -F audit/patches/discovery-02-sales-409-dedupe/COMMIT_MSG.txt\n`);
  }
}
main().catch(err => { console.error(`\n❌ FAILED: ${err.message}\n`); process.exit(1); });
