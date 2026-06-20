// api/_shared/manual-research-worklist.js
// ============================================================================
// CONTACT-SELECTION Slice 4 — the manual-research worklist (the "when automation
// can't resolve" path, Scott's amendment 2026-06-20)
// ----------------------------------------------------------------------------
// Every owner the enrichment chain (cross-ref → deed → SOS → address → web)
// can't crack lands here — NOT silently dropped, NOT guess-filled. A
// `research_tasks` row carries ALL the breadcrumbs so Scott resolves it in
// seconds, not from scratch: owner name, inferred state, notice address, the
// candidate bench tried + WHY each was rejected, the owner's property links, and
// 2–3 pre-built Google query strings. A hand-found contact attaches via the SAME
// `ensureEntityLink` + pivot path, so a manual resolution flows into NBT
// identically to an automated one.
//
// Idempotent: one OPEN manual task per owner (the producer pre-checks). Reuses
// the research_tasks shape the Decision Center already uses (createResearchTask).
// ============================================================================

export const MANUAL_RESEARCH_TYPE = 'owner_contact_manual';

function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

/**
 * 2–3 ready-to-paste Google queries for the owner. Pure.
 * @param {{owner_name, owner_state?, notice_address?, notice_city?}} row
 * @returns {string[]}
 */
export function buildGoogleQueries(row = {}) {
  const owner = clean(row.owner_name);
  const st = clean(row.owner_state);
  const addr = clean(row.notice_address);
  const out = [];
  if (owner) {
    out.push(`"${owner}"${st ? ' ' + st : ''} manager OR "managing member"`);
    out.push(`"${owner}"${st ? ' ' + st : ''} registered agent OR officer`);
  }
  if (addr) out.push(`${addr} resident OR owner`);
  return out;
}

/**
 * Build the research_tasks payload for an unresolvable owner. Pure — the caller
 * supplies the workspace/created_by + writes it.
 *
 * @param row {entity_id, owner_name, domain?, workspace_id?, owner_state?, notice_address?, notice_city?}
 * @param ctx {tried?: [{method, reason}], bench?: [{name, reason}], property_links?: string[], enrichment_action?}
 */
export function buildManualResearchTask(row = {}, ctx = {}) {
  const owner = clean(row.owner_name) || '(unknown owner)';
  const queries = buildGoogleQueries(row);
  const tried = Array.isArray(ctx.tried) ? ctx.tried : [];
  const bench = Array.isArray(ctx.bench) ? ctx.bench : [];
  const lines = [];
  lines.push(`Find a reachable decision-maker for "${owner}".`);
  if (row.owner_state) lines.push(`Inferred state: ${clean(row.owner_state)}`);
  if (row.notice_address) lines.push(`Notice/registered address: ${clean(row.notice_address)}`);
  if (tried.length) lines.push(`Automation tried: ${tried.map((t) => `${t.method} (${t.reason})`).join('; ')}.`);
  if (bench.length) lines.push(`Bench rejected: ${bench.map((b) => `${b.name} — ${b.reason}`).join('; ')}.`);
  if (queries.length) { lines.push('Pre-built searches:'); for (const q of queries) lines.push(`  • ${q}`); }
  lines.push('When found: open the owner and attach the contact (it flows into the cadence/NBT automatically).');
  return {
    research_type: MANUAL_RESEARCH_TYPE,
    title: `Find a contact for ${owner}`,
    instructions: lines.join('\n'),
    entity_id: row.entity_id || null,
    domain: row.domain || 'lcc',
    priority: 50,
    source_record_id: row.entity_id ? String(row.entity_id) : null,
    source_table: 'owner_contact_pivot',
    metadata: {
      kind: 'owner_contact_manual',
      owner_name: owner,
      inferred_state: clean(row.owner_state) || null,
      notice_address: clean(row.notice_address) || null,
      enrichment_action: ctx.enrichment_action || row.enrichment_action || null,
      tried, bench,
      property_links: Array.isArray(ctx.property_links) ? ctx.property_links : [],
      google_queries: queries,
    },
  };
}

/**
 * Idempotent producer over injected deps:
 *   deps.findOpenTask(entityId) -> [row,…]   (open MANUAL_RESEARCH_TYPE rows)
 *   deps.createTask(payload)    -> {ok, data}
 *   deps.resolveWorkspace(row)  -> workspaceId (optional; research_tasks.workspace_id NOT NULL)
 *   deps.actorId                -> created_by (optional)
 * Returns { check(row), queue(row, ctx) }.
 */
export function buildManualResearchProducer(deps = {}) {
  async function check(row) {
    if (!row || !row.entity_id || typeof deps.findOpenTask !== 'function') return { open: false };
    try { const rows = await deps.findOpenTask(row.entity_id); return { open: Array.isArray(rows) && rows.length > 0, row: rows && rows[0] }; }
    catch (_e) { return { open: false }; }
  }
  async function queue(row, ctx) {
    const existing = await check(row);
    if (existing.open) return { ok: true, existed: true, taskId: existing.row && existing.row.id };
    const payload = buildManualResearchTask(row, ctx);
    if (typeof deps.resolveWorkspace === 'function' && !payload.workspace_id) {
      try { payload.workspace_id = await deps.resolveWorkspace(row); } catch (_e) { /* surfaced by the insert */ }
    }
    if (deps.actorId) payload.created_by = deps.actorId;
    payload.status = 'queued';
    if (typeof deps.createTask !== 'function') return { ok: false, reason: 'no_producer' };
    const res = await deps.createTask(payload);
    return { ok: !!(res && res.ok), existed: false, detail: res && res.ok ? undefined : (res && res.data) };
  }
  return { check, queue };
}
