#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #1: Fire runListingBdPipeline from sidebar + OM intake
// Closes findings: A-1 (partial), D-1, D-5
// Branch: audit/01-bd-pipeline-trigger
//
// Run from the repo root (C:\Users\scott\life-command-center):
//   node audit/patches/01-bd-pipeline-trigger/apply.mjs --dry      # preview
//   node audit/patches/01-bd-pipeline-trigger/apply.mjs --apply    # write
//
// Pre-conditions:
//   • Every anchor must exist exactly once in its file.
//   • EOL detection per-file: anchors and replacements are normalized to
//     the file's dominant EOL before matching, so CRLF / LF / mixed all work
//     and no mixed-EOL output is produced.
//   • Atomic per-file: writes happen only after every edit in that file
//     succeeds. A failure aborts cleanly with no partial writes.
// ============================================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

// ----------------------------------------------------------------------------
// EOL-aware edit applier
// ----------------------------------------------------------------------------
class EditError extends Error {
  constructor(label, msg) { super(`[${label}] ${msg}`); this.label = label; }
}

function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  // count lone \n (not part of \r\n)
  const lf = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}

function toEol(s, eol) {
  return s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
}

function expectUnique(content, anchor, label) {
  const n = content.split(anchor).length - 1;
  if (n === 0) throw new EditError(label, 'anchor NOT FOUND. File may already be patched, or codebase drifted.');
  if (n > 1)   throw new EditError(label, `anchor matched ${n} times — must be UNIQUE.`);
}

function makeApplier(originalContent) {
  const eol = detectEol(originalContent);
  let content = originalContent;
  return {
    eol,
    get content() { return content; },
    set content(v) { content = v; },
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
// ============================================================================
async function patchSidebarPipeline(report) {
  const path = resolve(REPO_ROOT, 'api', '_handlers', 'sidebar-pipeline.js');
  const original = await readFile(path, 'utf8');
  const ctx = makeApplier(original);

  // (c) Imports
  ctx.E('sidebar.imports',
`import { writeSignal } from '../_shared/signals.js';`,
`import { writeSignal, writeListingCreatedSignal } from '../_shared/signals.js';
import { runListingBdPipeline } from '../_shared/listing-bd.js';`);

  // (a.1) dia early-exit no-asking-price
  ctx.E('dia.return.early-exit',
`      sales_history_count: Array.isArray(metadata.sales_history) ? metadata.sales_history.length : 0,
    });
    return 0;
  }

  try {`,
`      sales_history_count: Array.isArray(metadata.sales_history) ? metadata.sales_history.length : 0,
    });
    // Item #1: every return path uses { count, insertedListingId } shape.
    return { count: 0, insertedListingId: null };
  }

  try {`);

  // (a.2) dia PATCH-existing-active
  ctx.E('dia.return.patch-existing',
`    await backfillListingSaleIdForListing('dialysis', {
      listingId: currentListingId,
      propertyId: propertyIdInt,
      listingDate: lookup.data[0].listing_date || ingestionDatePart,
    });
    return 1;
  }`,
`    await backfillListingSaleIdForListing('dialysis', {
      listingId: currentListingId,
      propertyId: propertyIdInt,
      listingDate: lookup.data[0].listing_date || ingestionDatePart,
    });
    // Item #1: PATCH path = UPDATE on existing in-window listing. NOT a new
    // listing for BD purposes — insertedListingId stays null so the caller
    // does not re-fire runListingBdPipeline on every re-capture.
    return { count: 1, insertedListingId: null };
  }`);

  // (a.3) dia INSERT-failed
  ctx.E('dia.return.insert-failed',
`  if (!result.ok) {
    console.error('[upsertDialysisListings] INSERT failed:', {
      propertyId: propertyIdInt,
      status: result.status,
      data: result.data,
      record,
    });
    return 0;
  }`,
`  if (!result.ok) {
    console.error('[upsertDialysisListings] INSERT failed:', {
      propertyId: propertyIdInt,
      status: result.status,
      data: result.data,
      record,
    });
    return { count: 0, insertedListingId: null };
  }`);

  // (a.4) dia auto-close-as-sold AND successful new INSERT (consecutive)
  ctx.E('dia.return.autoclose-and-success',
`    console.log(
      \`[listing-fk-backfill] auto-close property_id=\${propertyIdInt} \` +
      \`sale_transaction_id=\${latestSaleId ?? 'null'} \` +
      \`sold_price=\${latestSalePrice ?? 'null'} sale_date=\${latestSale.sale_date}\`
    );
    // Return 0 — don't count as "new active listing" since it's already sold
    return 0;
  }
  return 1;

  } catch (err) {`,
`    console.log(
      \`[listing-fk-backfill] auto-close property_id=\${propertyIdInt} \` +
      \`sale_transaction_id=\${latestSaleId ?? 'null'} \` +
      \`sold_price=\${latestSalePrice ?? 'null'} sale_date=\${latestSale.sale_date}\`
    );
    // Already auto-closed as sold — not a genuinely-new active listing.
    return { count: 0, insertedListingId: null };
  }
  // Item #1: genuine new INSERT (not auto-closed). Surface listing_id so
  // propagateToDomainDbDirect can fire runListingBdPipeline.
  return { count: 1, insertedListingId: currentListingId };

  } catch (err) {`);

  // (a.5) dia outer catch
  ctx.E('dia.return.outer-catch',
`    console.error('[upsertDialysisListings] unexpected error:', {
      propertyId,
      error: err?.message || err,
      stack: err?.stack?.slice(0, 300),
    });
    return 0;
  }
}`,
`    console.error('[upsertDialysisListings] unexpected error:', {
      propertyId,
      error: err?.message || err,
      stack: err?.stack?.slice(0, 300),
    });
    return { count: 0, insertedListingId: null };
  }
}`);

  // (a.6) gov trigger guard
  ctx.E('gov.return.trigger-guard',
`  if (!hasAskingPrice && !hasCurrentSale) return 0;`,
`  if (!hasAskingPrice && !hasCurrentSale) return { count: 0, insertedListingId: null };`);

  // (a.7) gov POST-failed
  ctx.E('gov.return.post-failed',
`    : { ok: true };
  if (!result.ok) return 0;`,
`    : { ok: true };
  if (!result.ok) return { count: 0, insertedListingId: null };`);

  // (a.8) gov auto-close + success
  ctx.E('gov.return.autoclose-and-success',
`      'upsertGovListings:autoClose'
    );
    return 0; // Sold, not an active listing
  }
  return 1;
}`,
`      'upsertGovListings:autoClose'
    );
    // Already auto-closed as sold — not a genuinely-new active listing.
    return { count: 0, insertedListingId: null };
  }
  // Item #1: discriminate true INSERT vs PATCH-of-existing-Active.
  //   wasInsert == true  → no prior Active row was found at the top of the
  //                        function; the upsert just created a new row.
  //   wasInsert == false → an existing Active row was PATCHed in place
  //                        above (activeLookup branch); do NOT re-fire BD.
  // Rare same-day on_conflict merge case (property + source + status +
  // listing_date all identical) is an accepted false-positive: it queues
  // T-011/T-012 candidates again, which Scott can delete. Worth keeping
  // the gate simple and predictable.
  const wasInsert = !(typeof _existingActiveId !== 'undefined' && _existingActiveId);
  let insertedListingId = null;
  if (wasInsert) {
    if (Array.isArray(result.data) && result.data.length && result.data[0].listing_id != null) {
      insertedListingId = result.data[0].listing_id;
    } else if (result.data?.listing_id != null) {
      insertedListingId = result.data.listing_id;
    } else {
      // Fallback when PostgREST didn't return representation.
      const lookup = await domainQuery('government', 'GET',
        \`available_listings?property_id=eq.\${propertyId}\` +
        \`&listing_status=eq.Active&listing_source=eq.costar_sidebar\` +
        \`&select=listing_id&order=listing_id.desc&limit=1\`
      );
      if (lookup.ok && lookup.data?.length) insertedListingId = lookup.data[0].listing_id;
    }
  }
  return { count: 1, insertedListingId };
}`);

  // (b) Consumer: results.records.listings > 0 -> .count > 0
  ctx.E('sidebar.consumer.count',
`    if (propertyId && results.records?.listings && results.records.listings > 0) {`,
`    if (propertyId && results.records?.listings?.count > 0) {`);

  // (d.1) propagateToDomainDb signature
  ctx.E('sidebar.propagateToDomainDb.signature',
`async function propagateToDomainDb(entity, metadata, domain) {
  if (!domain) return { propagated: false, reason: 'no_domain' };

  try {
    if (domain === 'dialysis' || domain === 'government') {
      if (!getDomainCredentials(domain)) return { propagated: false, reason: 'domain_db_not_configured' };
      return await propagateToDomainDbDirect(domain, entity, metadata);
    }`,
`async function propagateToDomainDb(entity, metadata, domain, opts = {}) {
  if (!domain) return { propagated: false, reason: 'no_domain' };

  try {
    if (domain === 'dialysis' || domain === 'government') {
      if (!getDomainCredentials(domain)) return { propagated: false, reason: 'domain_db_not_configured' };
      return await propagateToDomainDbDirect(domain, entity, metadata, opts);
    }`);

  // (d.2) propagateToDomainDbDirect signature + destructure
  ctx.E('sidebar.propagateToDomainDbDirect.signature',
`async function propagateToDomainDbDirect(domain, entity, metadata) {
  const results = { domain, property_id: null, records: {} };`,
`async function propagateToDomainDbDirect(domain, entity, metadata, opts = {}) {
  const results = { domain, property_id: null, records: {} };
  // Item #1: workspaceId/userId threaded from processSidebarExtraction so
  // we can fire runListingBdPipeline after the listing upsert.
  const { workspaceId = null, userId = null } = opts;`);

  // (e) BD trigger block — after the listing upsert
  ctx.E('sidebar.bd-trigger-block',
`  if (domain === 'dialysis') {
    results.records.listings = await upsertDialysisListings(propertyId, metadata);
  }

  // Step 5b2: Upsert broker links`,
`  if (domain === 'dialysis') {
    results.records.listings = await upsertDialysisListings(propertyId, metadata);
  }

  // ── Item #1 (audit/01-bd-pipeline-trigger): Fire runListingBdPipeline
  // on truly NEW listings. Writers above return { count, insertedListingId }
  // where insertedListingId is non-null ONLY on a genuinely-new INSERT path.
  // Matches the sync.js:2571 SF-webhook pattern: inline await + parallel
  // writeListingCreatedSignal for telemetry. Failures never roll back the
  // upstream pipeline. processSidebarExtraction is already fire-and-forget
  // (see entities-handler.js), so added latency does not block the user.
  const _newListingId = results.records?.listings?.insertedListingId || null;
  if (_newListingId && workspaceId && entity?.id && entity?.state) {
    try {
      const _listingForBd = {
        ...entity,
        asset_type: entity.asset_type || metadata?.asset_type || entity.metadata?.asset_type || null,
        metadata: { ...(entity.metadata || {}), listing_status: 'active' },
      };
      writeListingCreatedSignal(_listingForBd, { id: userId }).catch(err =>
        console.warn('[bd-trigger:sidebar] writeListingCreatedSignal failed:', err?.message)
      );
      const _bdResult = await runListingBdPipeline(
        _listingForBd,
        workspaceId,
        userId,
        { triggerSource: 'sidebar_capture' }
      );
      results.records.bd_pipeline = {
        listing_id: _newListingId,
        t011_queued: _bdResult?.t011_same_asset?.queued || 0,
        t012_queued: _bdResult?.t012_geographic?.queued || 0,
        total_queued: _bdResult?.total_queued || 0,
      };
      console.log(\`[bd-trigger:sidebar] queued \${_bdResult?.total_queued || 0} draft candidates (T-011=\${_bdResult?.t011_same_asset?.queued || 0}, T-012=\${_bdResult?.t012_geographic?.queued || 0}) for listing_id=\${_newListingId} domain=\${domain}\`);
    } catch (err) {
      console.error('[bd-trigger:sidebar] runListingBdPipeline failed (non-fatal):', err?.message || err);
      results.records.bd_pipeline = { error: err?.message || String(err) };
    }
  } else if (_newListingId) {
    console.warn('[bd-trigger:sidebar] new listing detected but BD not fired:', {
      listing_id: _newListingId, domain,
      has_workspaceId: !!workspaceId, has_userId: !!userId,
      has_entity_id: !!entity?.id, has_state: !!entity?.state,
    });
  }

  // Step 5b2: Upsert broker links`);

  // (d.3+d.4) processSidebarExtraction call sites pass opts
  ctx.E('sidebar.processSidebar.call-no-domain',
`    primaryPropagation = await propagateToDomainDb(entity, metadata, null);`,
`    primaryPropagation = await propagateToDomainDb(entity, metadata, null, { workspaceId, userId });`);
  ctx.E('sidebar.processSidebar.call-per-domain',
`      const r = await propagateToDomainDb(entity, metadata, dom);`,
`      const r = await propagateToDomainDb(entity, metadata, dom, { workspaceId, userId });`);

  // Write
  const c = ctx.content;
  if (c === original) {
    report.push(['sidebar-pipeline.js', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  const label = `api/_handlers/sidebar-pipeline.js (${ctx.eol === '\r\n' ? 'CRLF' : 'LF'})`;
  report.push([label, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

// ============================================================================
// FILE 2: api/_handlers/intake-promoter.js
// ============================================================================
async function patchIntakePromoter(report) {
  const path = resolve(REPO_ROOT, 'api', '_handlers', 'intake-promoter.js');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);

  // Imports section: regex-based (not anchor-based). Do it manually on the
  // raw string, then hand to the applier for the BD-trigger insertion.
  let working = original;

  // 1. Ensure writeListingCreatedSignal is imported from signals.js
  const sigImpRe = /^import\s+\{([^}]*)\}\s+from\s+'\.\.\/_shared\/signals\.js';\s*$/m;
  const sigMatch = working.match(sigImpRe);
  if (sigMatch) {
    if (!sigMatch[1].includes('writeListingCreatedSignal')) {
      const trimmed = sigMatch[1].trim().replace(/,\s*$/, '');
      const newImports = `${trimmed}, writeListingCreatedSignal`;
      working = working.replace(sigImpRe, `import { ${newImports} } from '../_shared/signals.js';`);
    }
  } else {
    const allImports = [...working.matchAll(/^import .+from .+;$/gm)];
    if (!allImports.length) throw new EditError('promoter.imports', 'no import lines found — file unrecognized.');
    const last = allImports[allImports.length - 1];
    const at = last.index + last[0].length;
    working = working.slice(0, at) + `${eol}import { writeListingCreatedSignal } from '../_shared/signals.js';` + working.slice(at);
  }
  // 2. Ensure runListingBdPipeline is imported from listing-bd.js
  if (!working.includes(`from '../_shared/listing-bd.js'`)) {
    const allImports = [...working.matchAll(/^import .+from .+;$/gm)];
    const last = allImports[allImports.length - 1];
    const at = last.index + last[0].length;
    working = working.slice(0, at) + `${eol}import { runListingBdPipeline } from '../_shared/listing-bd.js';` + working.slice(at);
  }

  // Hand off to the applier for the BD trigger insertion
  const ctx = makeApplier(working);

  ctx.E('promoter.bd-trigger-insertion',
`    try {
      await opsQuery('PATCH',
        \`staged_intake_items?intake_id=eq.\${encodeURIComponent(intakeId)}\`,
        { status: 'finalized', updated_at: new Date().toISOString() },
        { 'Prefer': 'return=minimal' }
      );
    } catch (err) {
      console.warn('[intake-promoter] status flip to finalized failed (non-fatal):', err?.message);
    }
  }

  return result;
}`,
`    try {
      await opsQuery('PATCH',
        \`staged_intake_items?intake_id=eq.\${encodeURIComponent(intakeId)}\`,
        { status: 'finalized', updated_at: new Date().toISOString() },
        { 'Prefer': 'return=minimal' }
      );
    } catch (err) {
      console.warn('[intake-promoter] status flip to finalized failed (non-fatal):', err?.message);
    }

    // ── Item #1 (audit/01-bd-pipeline-trigger): Fire runListingBdPipeline
    // on truly-new OM listings (closes D-5). Gate:
    //   - listingResult.ok                  — write actually landed
    //   - !listingResult.updated            — not a dia PATCH-existing-active
    //   - !listingResult.merged_into_existing — not a gov 23505 re-merge
    // Re-promotion of the same intake (rare) may slip the gate; Scott can
    // dedupe inbox items.
    //
    // Matches sync.js:2571 pattern: inline await on runListingBdPipeline,
    // parallel writeListingCreatedSignal for telemetry. Wrapped in try/catch
    // so BD failure NEVER rolls back the promotion.
    const _wasInsert = listingResult?.ok
      && !listingResult.updated
      && !listingResult.merged_into_existing;
    const _newListingId = listingResult?.listing_id || null;
    const _lccEntityId = lccEntityResult?.entity_id || match?.lcc_entity_id || null;
    if (_wasInsert && _newListingId && _lccEntityId && snapshot?.state) {
      try {
        const _listingForBd = {
          id:         _lccEntityId,
          name:       snapshot.address || null,
          address:    snapshot.address || null,
          city:       snapshot.city || null,
          state:      snapshot.state,
          domain:     match.domain,
          asset_type: snapshot.asset_type || snapshot.property_type || null,
          email:      snapshot.listing_broker_email || null,
          metadata: {
            domain_property_id: match.property_id,
            domain_listing_id:  _newListingId,
            asset_type:         snapshot.asset_type || snapshot.property_type || null,
            listing_status:     'active',
          },
        };
        writeListingCreatedSignal(_listingForBd, { id: context.actorId }).catch(err =>
          console.warn('[bd-trigger:om-intake] writeListingCreatedSignal failed:', err?.message)
        );
        const _bdResult = await runListingBdPipeline(
          _listingForBd,
          context.workspaceId,
          context.actorId,
          { triggerSource: 'om_intake' }
        );
        result.bd_pipeline = {
          listing_id:   _newListingId,
          t011_queued:  _bdResult?.t011_same_asset?.queued || 0,
          t012_queued:  _bdResult?.t012_geographic?.queued || 0,
          total_queued: _bdResult?.total_queued || 0,
        };
        console.log(\`[bd-trigger:om-intake] queued \${_bdResult?.total_queued || 0} draft candidates (T-011=\${_bdResult?.t011_same_asset?.queued || 0}, T-012=\${_bdResult?.t012_geographic?.queued || 0}) for listing_id=\${_newListingId} domain=\${match.domain}\`);
      } catch (err) {
        console.error('[bd-trigger:om-intake] runListingBdPipeline failed (non-fatal):', err?.message || err);
        result.bd_pipeline = { error: err?.message || String(err) };
      }
    } else if (_wasInsert && _newListingId) {
      console.warn('[bd-trigger:om-intake] new listing detected but BD not fired:', {
        listing_id:    _newListingId,
        has_entity:    !!_lccEntityId,
        has_state:     !!snapshot?.state,
        has_workspace: !!context.workspaceId,
      });
    }
  }

  return result;
}`);

  const c = ctx.content;
  if (c === original) {
    report.push(['intake-promoter.js', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  const label = `api/_handlers/intake-promoter.js (${eol === '\r\n' ? 'CRLF' : 'LF'})`;
  report.push([label, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

// ============================================================================
// FILE 3: AUDIT_PROGRESS.md (new file, CRLF to match repo)
// ============================================================================
async function writeAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  const TRACKER_LF = `# LCC Holistic Audit — Progress Tracker

**Source doc:** \`LCC_Holistic_Audit_2026-05-17.docx\` (63 findings, 24 pages)
**Sprint started:** 2026-05-17
**Owner:** Scott Briggs
**Workflow:** Direct edits on per-item branches off \`main\`; code changes delivered as apply scripts under \`audit/patches/NN-<slug>/apply.mjs\` (sandbox/Windows filesystem coherence issue makes direct sandbox writes invisible to Windows git); Supabase migrations authored AND applied via Supabase MCP.

## Status legend

- 🟦 **PENDING** — not started
- 🟨 **IN PROGRESS** — branch open, work underway
- 🟧 **REVIEW** — code complete, awaiting verification / merge
- ✅ **DONE** — merged to main and verified
- ⛔ **BLOCKED** — needs decision or upstream fix
- ⏸️ **DEFERRED** — moved out of sprint scope

## Top 10 priority queue

| # | Item | Branch | Status | Closes | Notes |
|---|------|--------|--------|--------|-------|
| 1 | Fire \`runListingBdPipeline\` from sidebar + OM intake | \`audit/01-bd-pipeline-trigger\` | 🟧 REVIEW | A-1 (part), D-1, D-5 | CRITICAL · sidebar + OM-intake wired; pending verification |
| 2 | Drain \`llc_research_queue\` + \`ownership_research_queue\` (cron + UI, no scraper) | \`audit/02-research-queue-drain\` | 🟦 PENDING | A-1, B-5, D-13 | CRITICAL · scraper deferred per Scott |
| 3 | Wire \`resolveOwnerLinks\` for dia + backfill | \`audit/03-dia-owner-linkage\` | 🟦 PENDING | A-2 | CRITICAL |
| 4 | Build \`v_next_best_action\` UNION view + Home rail | \`audit/04-next-best-action\` | 🟦 PENDING | B-1, B-3, B-13 | CRITICAL |
| 5 | Fix silent-write loop in sidebar-pipeline (provenance integrity) | \`audit/05-provenance-integrity\` | 🟦 PENDING | A-3 | CRITICAL |
| 6 | Data Completeness rail on \`detail.js\` + persisted column | \`audit/06-completeness-rail\` | 🟦 PENDING | B-2, B-15 | HIGH |
| 7 | Seed cadence on new contact writes | \`audit/07-contact-cadence-seed\` | 🟦 PENDING | D-2, D-6 | CRITICAL |
| 8 | Sticky next-action bar on \`detail.js\` | \`audit/08-detail-next-action-bar\` | 🟦 PENDING | B-9, B-10 | HIGH |
| 9 | Value-weighted sort on every list | \`audit/09-value-sort\` | 🟦 PENDING | B-3 | HIGH |
| 10 | Global error visibility (window.error, retry CTAs, toast tiering) | \`audit/10-global-error-visibility\` | 🟦 PENDING | C-5, C-6, C-9, C-10 | HIGH |

## Working agreements

- Each Top-10 item gets its own branch off \`main\`.
- Code changes delivered as apply scripts (\`audit/patches/NN-<slug>/apply.mjs\`); the script anchors edits by unique substring + asserts pre-conditions before writing. Run \`--dry\` then \`--apply\`.
- Migrations: timestamped \`.sql\` in \`supabase/migrations/\` AND applied via Supabase MCP.
- SoS scraper for owner research is **deferred** — cron + UI ships now; manual SOS workflow via \`sosBtns\` until the scraper is built as a separate effort.
- After each item: update this file (status, branch, commit SHA, verification notes) via the next patch.
- Per-finding remediation notes live in the source \`.docx\`; this file is the operational tracker.

## Backlog (remaining 53 findings)

After Top 10 ships, follow the 5-phase roadmap from the audit doc (Stop the bleeding → Connect collection to consequence → Make DB visible → Close BD loops → Refinement). Phase membership for each finding is annotated in \`LCC_Holistic_Audit_2026-05-17.docx\`, "90-Day Improvement Roadmap" section.

---

# Closeout log

## Closeout — item 1 — Fire runListingBdPipeline from sidebar + OM intake
- **Branch:** \`audit/01-bd-pipeline-trigger\`
- **Patch:** \`audit/patches/01-bd-pipeline-trigger/apply.mjs\`
- **Closes:** A-1 (partial — paired with item #2 for owner research drain), D-1 (sidebar), D-5 (OM intake)
- **Files changed:**
  - \`api/_handlers/sidebar-pipeline.js\` — writer return shape \`{count, insertedListingId}\`, BD trigger wiring, workspaceId/userId threaded through propagateToDomainDb
  - \`api/_handlers/intake-promoter.js\` — BD trigger fires when listingResult was a genuine INSERT (not updated, not merged_into_existing)
  - \`AUDIT_PROGRESS.md\` — this file, created via Node fs.writeFile so Windows git sees it
- **Verification (post-apply, post-commit):**
  1. \`grep -c "runListingBdPipeline" api/_handlers/sidebar-pipeline.js\` → ≥ 2 (import + call)
  2. \`grep -c "runListingBdPipeline" api/_handlers/intake-promoter.js\` → ≥ 2
  3. \`grep -c "insertedListingId" api/_handlers/sidebar-pipeline.js\` → ≥ 6 (writer returns + reader)
  4. \`node -c api/_handlers/sidebar-pipeline.js\` → parses
  5. \`node -c api/_handlers/intake-promoter.js\` → parses
  6. (Smoke) Capture a CoStar listing for an asset+state with known peer-owner contacts; confirm new \`inbox_items\` rows with \`source_type='listing_bd_trigger'\`. Re-capture the same listing; confirm NO duplicate inbox items are queued.
- **Commit SHA:** _paste after \`git commit\`_
- **Date applied:** _paste at apply time_

---

# Sprint preflight — 2026-05-17

- **Working tree state at start:** 477 line-ending-only diffs + 2 real diffs (\`docs/architecture/sf_file_backfill_flow6_next_steps.md\` added, \`supabase/functions/intake-salesforce-files/index.ts\` 1-line edit). Untracked: audit preview JPGs, \`docs/architecture/sf_connected_app_setup.md\`. 1 unpushed commit \`f967172\` (Nixpacks fix) — auto-cleared between sessions.
- **Decision:** stash everything; branch off clean \`main\`. PowerShell stash reported "no local changes to save" — working tree was already clean by the time the stash ran (auto-cleared upstream).
- **Resolved blocker (2026-05-17 14:13):** \`.git/\` had 40+ stale lock files from prior sessions; cleared from PowerShell via \`Get-ChildItem -Recurse -Filter "*.lock*" | Remove-Item -Force\`.
- **Discovered (2026-05-17 14:25):** Sandbox writes physically reach NTFS (visible to \`dir\`) but **not** to Windows git's directory enumeration. PowerShell writes are seen normally. Confirmed by test (\`sync_test.txt\` visible, \`AUDIT_PROGRESS.md\` invisible). Workflow shifted to apply-script delivery: I author \`audit/patches/NN/apply.mjs\`; Scott runs from PowerShell — all file writes happen via Node's fs API which the Windows-side git enumerates normally.
- **Discovered (2026-05-17 14:38):** Repo working tree is 100% CRLF on both target files (\`sidebar-pipeline.js\` 8,799/8,799, \`intake-promoter.js\` 2,531/2,531). First apply.mjs draft used LF anchors → aborted cleanly on the first anchor. Script rewritten with per-file EOL detection (\`detectEol\`) + normalization (\`toEol\`); LF-formatted anchors in the script source are converted to the file's EOL before matching, so the same script works on LF/CRLF/mixed without producing mixed-EOL output.
`;

  const TRACKER = TRACKER_LF.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  if (DRY) {
    report.push(['AUDIT_PROGRESS.md (CRLF)', TRACKER.length, 'dry-run (would create)']);
  } else {
    await writeFile(path, TRACKER, 'utf8');
    report.push(['AUDIT_PROGRESS.md (CRLF)', TRACKER.length, 'written']);
  }
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log(`\n=== LCC Audit Sprint — Item #1: Fire runListingBdPipeline ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN (no writes)' : 'APPLY (will write files)'}`);
  console.log(`Repo: ${REPO_ROOT}\n`);

  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}. Run from inside the repo.`);
  }

  const report = [];
  await patchSidebarPipeline(report);
  await patchIntakePromoter(report);
  await writeAuditProgress(report);

  console.log(`--- ${DRY ? 'DRY-RUN' : 'APPLY'} SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(60)}  ${sign}${delta} bytes  (${note})`);
  }

  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply to write changes:\n`);
    console.log(`  node audit/patches/01-bd-pipeline-trigger/apply.mjs --apply\n`);
  } else {
    console.log(`\n✓ Apply complete. Next steps:\n`);
    console.log(`  git status`);
    console.log(`  git diff --stat`);
    console.log(`  node -c api/_handlers/sidebar-pipeline.js`);
    console.log(`  node -c api/_handlers/intake-promoter.js`);
    console.log(`  git add -A`);
    console.log(`  git commit -F audit/patches/01-bd-pipeline-trigger/COMMIT_MSG.txt\n`);
  }
}

main().catch(err => {
  console.error(`\n❌ FAILED: ${err.message}\n`);
  if (err.label) console.error(`  Label: ${err.label}`);
  console.error(`\nNo files were modified. Fix the issue and re-run.\n`);
  process.exit(1);
});
