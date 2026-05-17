#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #4 Phase B-2: cross-domain endpoint for v_next_best_action
// Branch: audit/04-next-best-action-phase-b2
// Closes: the cross-domain merge half of B-1.
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
// FILE 1: api/admin.js
//   (a) Add `case 'next-best-action': return handleNextBestAction(req, res);`
//       to the route dispatcher.
//   (b) Append the handler function near the end of the file (before the
//       stripNullsLocal helper that lives at the bottom).
// ============================================================================
async function patchAdminJs(report) {
  const path = resolve(REPO_ROOT, 'api', 'admin.js');
  const original = await readFile(path, 'utf8');
  const ctx = makeApplier(original);

  // (a) Add to dispatcher
  ctx.E('admin.dispatcher.next-best-action',
`    case 'llc-research-tick':       return handleLlcResearchTick(req, res);
    default:
      return res.status(400).json({ error: 'Unknown admin route' });`,
`    case 'llc-research-tick':       return handleLlcResearchTick(req, res);
    case 'next-best-action':        return handleNextBestAction(req, res);
    default:
      return res.status(400).json({ error: 'Unknown admin route' });`);

  // (b) Append the handler before the stripNullsLocal helper at the bottom
  ctx.E('admin.handler-insertion-point',
`// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
`// ============================================================================
// NEXT-BEST-ACTION (Item #4 Phase B-2, 2026-05-17)
// ============================================================================
//
// GET /api/admin?_route=next-best-action
//   Query params:
//     domain      'dia' | 'gov' | 'both'   (default 'both')
//     limit       1-500                     (default 50)
//     offset      >= 0                      (default 0)
//     severity    'critical'|'high'|'medium'|'low'  (optional filter)
//     gap_type    exact match               (optional filter, e.g. 'missing_recorded_owner')
//
// Fans out in parallel to dia.v_next_best_action + gov.v_next_best_action,
// merges, globally re-ranks by gap_value DESC, applies offset + limit, and
// returns the unified ranked list tagged with source_domain per row.
//
// This is the cross-domain merge layer for the v_next_best_action surface
// built in Phase A (dia) + Phase B-1 (gov). The Phase C Home rail UI in
// app.js will call this single endpoint to render the merged queue.
//
// Closes the cross-domain merge half of audit finding B-1.
// Phase C (Home rail UI) and Phase B-3 (LCC Opps view for provenance
// conflicts + inbox triage + health alerts) are queued as follow-ups.
// ============================================================================
async function handleNextBestAction(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const domainParam = String(req.query.domain || 'both').toLowerCase();
  if (!['dia', 'gov', 'both'].includes(domainParam)) {
    return res.status(400).json({ error: "domain must be 'dia', 'gov', or 'both'" });
  }
  const limit  = Math.min(500, Math.max(1, parseInt(req.query.limit  || '50', 10)));
  const offset = Math.max(0,                parseInt(req.query.offset || '0', 10));
  const severityFilter = req.query.severity ? String(req.query.severity) : null;
  const gapTypeFilter  = req.query.gap_type ? String(req.query.gap_type) : null;
  if (severityFilter && !['critical','high','medium','low'].includes(severityFilter)) {
    return res.status(400).json({ error: "severity must be 'critical', 'high', 'medium', or 'low'" });
  }

  const targets = domainParam === 'both'
    ? ['dialysis', 'government']
    : domainParam === 'dia' ? ['dialysis'] : ['government'];

  // Fetch enough headroom from each domain so global re-rank can produce
  // an accurate offset+limit slice. We pull (offset + limit + 50) from each
  // side so the merged top-N is correct even when one domain dominates.
  const fetchLimit = Math.min(500, offset + limit + 50);

  const fanOutResults = await Promise.all(targets.map(async (dom) => {
    let path = 'v_next_best_action?select=*'
             + '&order=gap_value.desc.nullslast,first_seen_at.asc'
             + '&limit=' + fetchLimit;
    if (severityFilter) path += '&gap_severity=eq.' + encodeURIComponent(severityFilter);
    if (gapTypeFilter)  path += '&gap_type=eq.'      + encodeURIComponent(gapTypeFilter);

    const r = await domainQuery(dom, 'GET', path);
    if (!r.ok) {
      console.error('[next-best-action] ' + dom + ' query failed:', r.status, r.data);
      return { domain: dom, ok: false, rows: [], status: r.status, error: r.data };
    }
    const rows = Array.isArray(r.data) ? r.data : [];
    return {
      domain: dom,
      ok: true,
      rows: rows.map(row => ({ ...row, source_domain: dom })),
    };
  }));

  // Merge + global re-rank by gap_value DESC, tiebreak first_seen_at ASC
  const merged = [];
  for (const { rows } of fanOutResults) {
    for (const row of rows) merged.push(row);
  }
  merged.sort((a, b) => {
    const av = Number(a.gap_value) || 0;
    const bv = Number(b.gap_value) || 0;
    if (av !== bv) return bv - av;
    return String(a.first_seen_at || '').localeCompare(String(b.first_seen_at || ''));
  });

  const items = merged.slice(offset, offset + limit).map((row, idx) => ({
    rank: offset + idx + 1,
    ...row,
  }));

  const byDomain = {};
  for (const r of fanOutResults) {
    byDomain[r.domain] = r.ok
      ? { ok: true, fetched: r.rows.length }
      : { ok: false, status: r.status, error: r.error };
  }

  return res.status(200).json({
    ok:            true,
    total_merged:  merged.length,
    returned:      items.length,
    limit, offset,
    severity:      severityFilter,
    gap_type:      gapTypeFilter,
    by_domain:     byDomain,
    items,
  });
}

// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`);

  const c = ctx.content;
  if (c === original) {
    report.push(['admin.js', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`api/admin.js (${ctx.eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
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

## Closeout — item 4 Phase B-2 — cross-domain endpoint for v_next_best_action
- **Status:** 🟨 IN PROGRESS (B-2 landed; B-3 = LCC Opps view, deferred; C = Home rail UI, deferred)
- **Branch:** \`audit/04-next-best-action-phase-b2\`
- **Patch:** \`audit/patches/04-next-best-action-phase-b2/apply.mjs\`
- **Files changed:**
  - \`api/admin.js\` — adds \`case 'next-best-action'\` to the route dispatcher; new \`handleNextBestAction(req, res)\` function (~80 lines) that fans out to dia + gov in parallel via \`domainQuery\`, merges, globally re-ranks by gap_value DESC (tiebreak first_seen_at ASC), applies offset + limit, returns tagged with source_domain.

### Endpoint contract
\`\`\`
GET /api/admin?_route=next-best-action
  ?domain=both|dia|gov          (default 'both')
  &limit=50                      (1-500, default 50)
  &offset=0                      (default 0)
  &severity=critical|high|medium|low   (optional)
  &gap_type=missing_recorded_owner     (optional exact match)

Response:
{
  "ok": true,
  "total_merged": 34219,
  "returned": 50,
  "limit": 50, "offset": 0,
  "severity": null, "gap_type": null,
  "by_domain": { "dialysis": { "ok": true, "fetched": 100 }, "government": { "ok": true, "fetched": 100 } },
  "items": [
    {
      "rank": 1,
      "gap_type": "missing_recorded_owner",
      "gap_severity": "critical",
      "property_id": 12345,
      "gap_label": "1234 Federal Plaza",
      "suggested_action": "Research recorded owner for 1234 Federal Plaza",
      "gap_value": 966854484,
      "first_seen_at": "2026-05-17T...",
      "source_domain": "government"
    },
    ...
  ]
}
\`\`\`

### Verification (post-deploy, requires LCC_API_KEY)
\`\`\`bash
# Top 10 unified gaps across both domains
curl -H "X-LCC-Key: \$LCC_API_KEY" \\
  "https://tranquil-delight-production-633f.up.railway.app/api/admin?_route=next-best-action&limit=10"

# Just critical gaps
curl -H "X-LCC-Key: \$LCC_API_KEY" \\
  "https://tranquil-delight-production-633f.up.railway.app/api/admin?_route=next-best-action&severity=critical&limit=20"

# Just CMS chain transitions on dia
curl -H "X-LCC-Key: \$LCC_API_KEY" \\
  "https://tranquil-delight-production-633f.up.railway.app/api/admin?_route=next-best-action&domain=dia&gap_type=cms_chain_drift:operator_transition_candidate&limit=20"
\`\`\`

### Phase B-3 (deferred)
Build \`v_next_best_action_ops\` on LCC Opps surfacing:
- \`v_field_provenance_conflicts\` (Phase 3 of provenance system)
- \`v_field_provenance_unranked\` (schema-drift detector)
- \`inbox_items\` with \`source_type\` IN ('new_contact_qualify', 'listing_bd_trigger', 'provenance_conflict')
- \`lcc_health_alerts\` (unresolved)
- \`v_ingest_write_failures_recent\` (last 24h)

Then extend handleNextBestAction to also fetch from LCC Opps via opsQuery.

### Phase C (deferred)
Home rail UI in \`app.js\` calling \`/api/admin?_route=next-best-action\`, rendering the merged top-20 with click-through to property_id detail or entity_pk detail. Replaces the wrong-table Research pulse-card (audit B-13).

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
  console.log(`\n=== LCC Audit Sprint — Item #4 Phase B-2: cross-domain endpoint ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN (no writes)' : 'APPLY (will write files)'}\n`);
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}.`);
  }
  const report = [];
  await patchAdminJs(report);
  await updateAuditProgress(report);
  console.log(`--- ${DRY ? 'DRY-RUN' : 'APPLY'} SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(60)}  ${sign}${delta} bytes  (${note})`);
  }
  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply.\n`);
    console.log(`  node audit/patches/04-next-best-action-phase-b2/apply.mjs --apply\n`);
  } else {
    console.log(`\n✓ Apply complete.\n`);
    console.log(`  node -c api/admin.js`);
    console.log(`  git add -A && git commit -F audit/patches/04-next-best-action-phase-b2/COMMIT_MSG.txt\n`);
  }
}
main().catch(err => { console.error(`\n❌ FAILED: ${err.message}\n`); process.exit(1); });
