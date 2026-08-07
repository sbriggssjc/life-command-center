// api/_handlers/deal-comms-propagate-tick.js
// ============================================================================
// W7.2 — the deal-comms propagation tick (the heart of Wave 7).
// See docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md §W7.2.
//
// Route: GET|POST /api/deal-comms-propagate-tick  (X-LCC-Key auth, mounted in
//   server.js). Scheduled by pg_cron `lcc-deal-comms-propagate` (hourly :32,
//   ~15min after the W7.1 matcher :17) → lcc_cron_post.
//
// Consumes NEW deal-stamped comm activity since the last tick (the ledger
// lcc_deal_comm_propagated is the seam — the tick's OWN, per W5.2b doctrine).
// For each deal with new comms (oldest-backlog first, capped), it runs FOUR
// propagations:
//   1. Correspondence-summary refresh — LLM-authored under the no-fabrication
//      contract, is_current versioned (never update-in-place). AI down/empty ⇒
//      keep the prior row, count summary_skipped, move on.
//   2. Milestone detection — DETERMINISTIC cues write lcc_deal_milestone
//      directly (source='comms_tick'); an LLM-only candidate with no cue routes
//      to a milestone_confirm Decision-Center lane (never a direct write).
//   3. Next-step to-dos — reuses the Phase-1 deriveNextStep → lcc_advance_todos
//      path for recent INBOUND matcher-backfill comms (the existence-guard
//      dedupes; ingest dual-anchor rows already ran it, so we skip them).
//   4. Dossier + context-packet freshness — for deals with a stored dossier,
//      regenerate-on-changed-hash (the refreshed summary changes the packet
//      hash); invalidate the deal's context_packets so the next fetch rebuilds.
//
// Doctrine: LLM SUMMARIZES/PROPOSES only; every auditable write is deterministic.
// Bounded per tick (≤ DEAL_COMMS_PROPAGATE_MAX_DEALS). GATE:
// DEAL_COMMS_PROPAGATE_ENABLED (feature_flags_registry DEAL_COMMS_PROPAGATE_CRON).
// ?force=1 runs one live tick without the flag; ?dry_run=1 reports only.
// Never throws — always returns 200 with a JSON envelope.
// ============================================================================
import { opsQuery } from '../_shared/ops-db.js';
import { invokeExtractionAI } from '../_shared/ai.js';
import { deriveNextStep } from '../_shared/next-step-ai.js';
import { detectMilestoneCues } from '../_shared/deal-milestone-cues.js';
import { buildSummaryPrompt, buildIncrementalSummaryPrompt, parseSummaryResponse } from '../_shared/deal-comms-summary.js';
import {
  buildRoleIssuesPrompt, parseRoleIssuesResponse, validateRoles, applyIssueLifecycle,
  commsIndex, roleIssuesWatermark,
} from '../_shared/deal-role-issues.js';
import { buildDealPacket } from './entities-handler.js';
import { generateDossier, recordDossier } from '../_shared/dossier-generator.js';

const enc = (v) => encodeURIComponent(String(v));
const truthy = (v) => v === '1' || v === 'true' || v === true;
const dateOnly = (v) => { if (!v) return null; try { return new Date(v).toISOString().slice(0, 10); } catch { return null; } };

function maxDealsFromEnv() {
  const n = parseInt(process.env.DEAL_COMMS_PROPAGATE_MAX_DEALS || '10', 10);
  return Math.min(25, Math.max(1, Number.isFinite(n) ? n : 10));
}

// W7.2c — reply-SLA threshold in ONE constant (business days of no outbound on
// an open deal whose latest comm is inbound → a reply_overdue to-do).
function replySlaBusinessDays() {
  const n = parseInt(process.env.DEAL_COMMS_REPLY_SLA_DAYS || '3', 10);
  return Math.max(1, Number.isFinite(n) ? n : 3);
}

// invokeExtractionAI returns { data:{ response } }; tolerate other shapes.
function aiText(resp) {
  return (resp && (resp.data?.response ?? resp.text ?? resp.content ?? resp.output ?? resp.message)) ?? resp;
}

async function writeRunLog(row) {
  try {
    const r = await opsQuery('POST', 'lcc_deal_comms_propagation_run_log', row,
      { headers: { Prefer: 'return=representation' } });
    const rec = Array.isArray(r.data) ? r.data[0] : r.data;
    return rec?.run_id || null;
  } catch (_e) { return null; }
}

// Read the prior is_current summary's compression watermark (W7.2c). Absent ⇒
// first run for this deal ⇒ full-corpus path.
async function priorSummaryMeta(entityId) {
  try {
    const r = await opsQuery('GET',
      `lcc_deal_correspondence_summary?entity_id=eq.${enc(entityId)}&is_current=eq.true` +
      `&select=metadata&order=generated_at.desc&limit=1`);
    const row = (r.ok && r.data?.[0]) || null;
    const m = row?.metadata || null;
    if (m && m.compressed_block && m.compressed_through_at) {
      return {
        compressed_block: String(m.compressed_block),
        compressed_through_at: m.compressed_through_at,
        compressed_through_activity_id: m.compressed_through_activity_id || null,
      };
    }
  } catch (_e) { /* fall through to full-corpus */ }
  return null;
}

// ── Summary refresh (LLM; is_current versioned; INCREMENTAL compression) ─────
// Returns 'written' | 'skipped'. Never throws. When a prior compressed_block +
// watermark exist, only the messages newer than the watermark are fed (plus the
// compressed history) — latency/token control as threads grow.
async function refreshSummary(deal, comms) {
  const prior = await priorSummaryMeta(deal.entity_id);
  let promptComms = comms;
  let incremental = false;
  if (prior) {
    const wm = new Date(prior.compressed_through_at).getTime();
    const slice = comms.filter((c) => c.occurred_at && new Date(c.occurred_at).getTime() > wm);
    // Nothing genuinely newer than the watermark → keep the prior summary as-is
    // (the tick fired for a re-ledger/backfill; no summary work to do).
    if (!slice.length) {
      console.log(`[deal-comms-propagate-tick] summary incr entity=${deal.entity_id} slice=0/${comms.length} → keep prior`);
      return { outcome: 'skipped', candidates: [] };
    }
    promptComms = slice;
    incremental = true;
    console.log(`[deal-comms-propagate-tick] summary incr entity=${deal.entity_id} slice=${slice.length}/${comms.length}`);
  } else {
    console.log(`[deal-comms-propagate-tick] summary full entity=${deal.entity_id} corpus=${comms.length}`);
  }

  let parsed = null;
  let provider = null;
  try {
    const prompt = incremental
      ? buildIncrementalSummaryPrompt(deal, promptComms, prior.compressed_block)
      : buildSummaryPrompt(deal, comms);
    const resp = await invokeExtractionAI({ prompt, surface: 'summaries' });
    parsed = parseSummaryResponse(aiText(resp));
    provider = resp?.provider || null;
  } catch (_e) { parsed = null; }
  // No-fabrication / dead-model guard: an empty or failed summary keeps the prior
  // is_current row untouched (the tick must not stall or blank a good summary).
  if (!parsed || !parsed.summary) return { outcome: 'skipped', candidates: [] };

  // Watermark = the newest comm in the FULL corpus (the incremental slice folds
  // into the compressed history, which now covers up to here).
  let latestAt = 0;
  let latestId = null;
  for (const c of comms) {
    const t = c.occurred_at ? new Date(c.occurred_at).getTime() : 0;
    if (t >= latestAt) { latestAt = t; latestId = c.activity_id || latestId; }
  }
  const srcIds = comms.map((c) => c.activity_id).filter(Boolean).slice(0, 200);
  // The updated compressed history: the model's block if it returned one,
  // otherwise fall back to the prior block (never fabricate one from nothing).
  const compressedBlock = parsed.compressed_block || (prior && prior.compressed_block) || parsed.summary;

  // Version flip: demote prior current rows, then insert the new current row.
  await opsQuery('PATCH', `lcc_deal_correspondence_summary?entity_id=eq.${enc(deal.entity_id)}&is_current=eq.true`,
    { is_current: false }).catch(() => null);
  const ins = await opsQuery('POST', 'lcc_deal_correspondence_summary', {
    entity_id: deal.entity_id,
    summary: parsed.summary,
    topics: parsed.topics || [],
    thread_count: comms.length,
    latest_activity_at: latestAt ? new Date(latestAt).toISOString() : null,
    source: 'comms_tick',
    source_activity_ids: srcIds,
    is_current: true,
    metadata: {
      generated_by: 'w7.2_tick', ai_provider: provider,
      incremental, input_comms: promptComms.length, corpus_comms: comms.length,
      compressed_block: compressedBlock,
      compressed_through_at: latestAt ? new Date(latestAt).toISOString() : (prior?.compressed_through_at || null),
      compressed_through_activity_id: latestId || (prior?.compressed_through_activity_id || null),
    },
  }).catch((e) => ({ ok: false, error: e?.message }));

  return { outcome: ins?.ok ? 'written' : 'skipped', candidates: parsed.milestone_candidates || [] };
}

// ── Deterministic milestones + LLM-candidate confirm-lane ───────────────────
async function propagateMilestones(deal, newComms, llmCandidates, perActivity) {
  const detKeys = new Set();
  let written = 0, rolledUp = 0, candidates = 0;
  for (const c of newComms) {
    const cues = detectMilestoneCues(c.subject, c.body);
    for (const cue of cues) {
      detKeys.add(cue.key);
      const r = await opsQuery('POST', 'rpc/lcc_deal_record_milestone', {
        p_entity: deal.entity_id, p_key: cue.key, p_on: dateOnly(c.occurred_at),
        p_status: cue.status, p_summary: cue.label, p_source: 'comms_tick',
        p_detail_ref: c.activity_id,
      }).catch(() => null);
      // W7.2c: the writer now returns { outcome, id }. A new/new_round row counts
      // as written; a re-occurrence rolled into an existing row counts separately.
      const res = Array.isArray(r?.data) ? r.data[0] : r?.data;
      const outcome = (res && typeof res === 'object') ? res.outcome
        : (res === true ? 'inserted' : 'noop'); // tolerate the old boolean shape
      if (outcome === 'inserted' || outcome === 'new_round') written += 1;
      else if (outcome === 'rolled_up') rolledUp += 1;
      const a = perActivity.get(c.activity_id) || {};
      a.milestones = (a.milestones || []).concat([{ key: cue.key, outcome }]);
      perActivity.set(c.activity_id, a);
    }
  }
  // LLM-only candidates (no deterministic cue this tick) → confirm lane, never a write.
  const fallbackDate = dateOnly(newComms.reduce((mx, c) => {
    const t = c.occurred_at ? new Date(c.occurred_at).getTime() : 0; return t > mx ? t : mx;
  }, 0) || null);
  for (const cand of (llmCandidates || [])) {
    if (!cand || !cand.key || detKeys.has(cand.key)) continue;
    const on = cand.date || fallbackDate || 'na';
    const subjectRef = `mstone:${deal.entity_id}:${cand.key}:${on}`;
    // Seeded lcc_decisions lane (dedup on subject_ref; subject_entity_id left NULL
    // so multiple candidate keys for one deal don't collapse on the entity conflict key).
    await opsQuery('POST', 'rpc/lcc_open_decision', {
      p_decision_type: 'milestone_confirm',
      p_question: `Log a "${cand.label || cand.key}" milestone on ${deal.deal_name || 'this deal'}?`,
      p_context: {
        entity_id: deal.entity_id, deal_name: deal.deal_name || null,
        milestone_key: cand.key, occurred_on: cand.date || fallbackDate || null,
        label: cand.label || cand.key, confidence: cand.confidence ?? null, source: 'comms_tick',
      },
      p_subject_domain: 'lcc', p_subject_ref: subjectRef,
      p_rank_value: cand.confidence != null ? Number(cand.confidence) : null,
    }).catch(() => null);
    candidates += 1;
  }
  return { written, rolledUp, candidates };
}

// ── Reply-SLA to-dos (deterministic; the highest-ROI generator) ─────────────
// Open in-scope deals whose latest deal-stamped comm is INBOUND and > N business
// days with no outbound since → one guarded reply_overdue to-do per deal.
// Returns { generated, candidates }. Never throws. In dry mode, counts only.
async function propagateReplySla({ dry } = {}) {
  const days = replySlaBusinessDays();
  let cand = [];
  try {
    const r = await opsQuery('POST', 'rpc/lcc_deal_reply_sla_candidates',
      { p_threshold_days: days, p_limit: 200 });
    cand = Array.isArray(r.data) ? r.data : [];
  } catch (_e) { cand = []; }
  if (dry) return { generated: 0, candidates: cand.length };

  let generated = 0;
  for (const d of cand) {
    if (!d?.entity_id) continue;
    const when = dateOnly(d.last_inbound_at) || 'recently';
    const who = d.last_sender ? String(d.last_sender).slice(0, 80) : 'contact';
    const title = `Reply overdue — ${d.deal_name || 'deal'}: last inbound ${when} from ${who}`;
    const r = await opsQuery('POST', 'rpc/lcc_advance_todos', {
      p_entity_id: d.entity_id, p_channel: 'email', p_direction: 'reply_sla',
      p_context: `Last inbound ${when} from ${who}; no outbound reply in ${d.business_days} business days.`,
      p_next_action: title, p_next_type: 'reply_overdue', p_next_due_offset: days,
    }).catch(() => null);
    const created = (r && r.data && Array.isArray(r.data.created)) ? r.data.created : [];
    if (created.length) generated += 1;
  }
  return { generated, candidates: cand.length };
}

// ── Next-step to-dos (reuse Phase 1) ────────────────────────────────────────
// Only recent INBOUND matcher-backfill comms (source_type='lcc:deal_match');
// ingest dual-anchor rows already ran lcc_advance_todos at ingest.
async function propagateTodos(deal, newComms, perActivity) {
  let generated = 0, deduped = 0;
  const targets = newComms.filter((c) =>
    c.is_inbound && c.is_recent && c.source_type === 'lcc:deal_match');
  for (const c of targets) {
    let premise = 'seller';
    if (c.party_entity_id) {
      try {
        const pr = await opsQuery('POST', 'rpc/lcc_party_role',
          { p_party: c.party_entity_id, p_deal: deal.entity_id });
        const role = Array.isArray(pr.data) ? pr.data[0] : pr.data;
        if (typeof role === 'string' && role) premise = role;
      } catch (_e) { /* keep default */ }
    }
    let ns = null;
    try { ns = await deriveNextStep(c.subject, c.body || '', deal.deal_name, { invokeExtractionAI, premise }); }
    catch (_e) { ns = null; }
    const who = premise === 'broker' ? 'Broker' : premise === 'buyer' ? 'Buyer' : premise === 'other' ? 'Contact' : 'Seller';
    const r = await opsQuery('POST', 'rpc/lcc_advance_todos', {
      p_entity_id: deal.entity_id, p_activity_id: c.activity_id,
      p_party_entity_id: c.party_entity_id || null, p_channel: 'email', p_direction: 'inbound',
      p_context: c.subject ? (`${who} replied: ${String(c.subject).slice(0, 160)}`) : null,
      p_next_action: ns?.next_action ?? null, p_next_type: ns?.action_type ?? null,
      p_next_due_offset: ns?.due_offset ?? null,
    }).catch(() => null);
    const created = (r && r.data && Array.isArray(r.data.created)) ? r.data.created : [];
    if (created.length) generated += 1; else deduped += 1;
    const a = perActivity.get(c.activity_id) || {};
    a.todo = created.length ? 'generated' : 'deduped';
    perActivity.set(c.activity_id, a);
  }
  return { generated, deduped };
}

// ── W7.4 role evolution + open-issues pass (LLM PROPOSES; evidence-validated) ─
// Own seam: reads/writes lcc_deal_dossier_analysis (kind=roles|issues), versioned
// like the summary. The per-deal watermark over the comm set short-circuits an
// unchanged corpus (idempotent → 0 writes). AI failure skips this deal's pass
// entirely (never blocks the summary/cue/to-do passes; the caller isolates it).
// Returns { outcome:'written'|'skipped'|'preview', roles, issuesOpen, issuesClosed, dropped }.
// With { dry:true } it does everything EXCEPT the writes (version flip / insert /
// dropped-log) and returns the validated proposals for the dry-run report.
async function refreshRoleIssues(deal, comms, runId, { dry = false } = {}) {
  const watermark = roleIssuesWatermark(comms);

  // Prior current analysis rows (roles + issues) for this deal.
  let priorRoles = null, priorIssues = null;
  try {
    const r = await opsQuery('GET',
      `v_lcc_deal_dossier_analysis_current?entity_id=eq.${enc(deal.entity_id)}` +
      `&select=kind,payload,watermark`);
    for (const row of (r.ok && Array.isArray(r.data) ? r.data : [])) {
      if (row.kind === 'roles') priorRoles = row;
      if (row.kind === 'issues') priorIssues = row;
    }
  } catch (_e) { /* first run → full path */ }

  // Idempotency short-circuit: same corpus AND we already have current rows.
  const bothPresent = priorRoles && priorIssues;
  if (bothPresent && priorRoles.watermark === watermark && priorIssues.watermark === watermark) {
    return { outcome: 'skipped', roles: 0, issuesOpen: 0, issuesClosed: 0, dropped: 0 };
  }

  const priorOpenIssues = (priorIssues && Array.isArray(priorIssues.payload))
    ? priorIssues.payload.filter((i) => i && i.status !== 'resolved')
    : [];

  // One Ollama call. AI down/empty → skip this deal's pass (no writes).
  let parsed = null, provider = null;
  try {
    const prompt = buildRoleIssuesPrompt(deal, comms, priorOpenIssues);
    const resp = await invokeExtractionAI({ prompt, surface: 'roles' });
    parsed = parseRoleIssuesResponse(aiText(resp));
    provider = resp?.provider || null;
  } catch (_e) { parsed = null; }
  if (!parsed) return { outcome: 'skipped', roles: 0, issuesOpen: 0, issuesClosed: 0, dropped: 0 };

  const byId = commsIndex(comms);
  const { roles, dropped: roleDrops } = validateRoles(parsed.roles, byId);
  const life = applyIssueLifecycle(priorOpenIssues, parsed, byId);
  const allDropped = [...roleDrops, ...life.dropped];

  const openCount = life.issues.filter((i) => i.status !== 'resolved').length;
  const now = new Date().toISOString();
  const metaBase = { generated_by: 'w7.4_tick', ai_provider: provider, dropped: allDropped.length };

  // Dry-run: return the validated proposals for eyeballing; write nothing.
  if (dry) {
    return {
      outcome: 'preview', roles: roles.length, issuesOpen: openCount, issuesClosed: life.closed,
      dropped: allDropped.length, proposed_roles: roles, proposed_issues: life.issues,
    };
  }

  // Log dropped proposals for audit (never surfaced). Best-effort.
  if (allDropped.length) {
    await opsQuery('POST', 'lcc_deal_analysis_dropped_log',
      allDropped.map((dd) => ({ entity_id: deal.entity_id, run_id: runId || null, kind: dd.type || dd.kind || null, item: dd })),
      { headers: { Prefer: 'return=minimal' } }).catch(() => null);
  }

  // Version flip + insert per kind (mirror the summary pass).
  await opsQuery('PATCH',
    `lcc_deal_dossier_analysis?entity_id=eq.${enc(deal.entity_id)}&is_current=eq.true`,
    { is_current: false }).catch(() => null);
  await opsQuery('POST', 'lcc_deal_dossier_analysis', [
    { entity_id: deal.entity_id, kind: 'roles', payload: roles, watermark, source: 'comms_tick',
      is_current: true, generated_at: now, metadata: { ...metaBase, role_count: roles.length } },
    { entity_id: deal.entity_id, kind: 'issues', payload: life.issues, watermark, source: 'comms_tick',
      is_current: true, generated_at: now,
      metadata: { ...metaBase, open: openCount, opened: life.opened, closed: life.closed, carried: life.carried } },
  ], { headers: { Prefer: 'return=minimal' } }).catch(() => null);

  return { outcome: 'written', roles: roles.length, issuesOpen: openCount, issuesClosed: life.closed, dropped: allDropped.length };
}

// ── Dossier regenerate-on-change + context-packet invalidation ──────────────
async function refreshDossierAndPackets(deal, workspaceId) {
  let dossierRegenerated = 0, packetsRefreshed = 0;
  // Only touch deals that already have a stored deal dossier (regenerate-on-change,
  // never mint a first dossier from a tick — that stays an explicit operator action).
  try {
    const prev = await opsQuery('GET',
      `lcc_dossiers?entity_id=eq.${enc(deal.entity_id)}&dossier_type=eq.deal` +
      `&select=source_hash,version&order=version.desc&limit=1`);
    const row = (prev.ok && prev.data?.[0]) || null;
    if (row) {
      const packet = await buildDealPacket(deal.entity_id, workspaceId);
      const built = await generateDossier({ kind: 'deal', packet, entityId: deal.entity_id, title: packet.meta?.title });
      if (!row.source_hash || row.source_hash !== built.source_hash) {
        const opsUrl = process.env.OPS_SUPABASE_URL, opsKey = process.env.OPS_SUPABASE_KEY;
        const stored = await recordDossier({
          kind: 'deal', entityId: deal.entity_id, workspaceId, title: built.title, html: built.html,
          sourceHash: built.source_hash, generatedBy: null,
          metadata: { generated_via: 'w7.2_tick', analysis_ok: built.analysis?.ok || false, ai_model: built.analysis?.model || null },
          opsQuery, opsUrl, opsKey, fetchImpl: (u, o) => fetch(u, o),
        });
        if (stored?.ok) dossierRegenerated = 1;
      }
    }
  } catch (_e) { /* best-effort */ }
  // Context packets: generated-on-demand with a TTL — invalidating is enough; the
  // next fetch rebuilds via the existing context-broker path (no new generator).
  try {
    const patch = await opsQuery('PATCH',
      `context_packets?entity_id=eq.${enc(deal.entity_id)}&invalidated=eq.false`,
      { invalidated: true, invalidation_reason: 'deal_comms_tick' },
      { headers: { Prefer: 'return=representation' } });
    packetsRefreshed = Array.isArray(patch.data) ? patch.data.length : 0;
  } catch (_e) { /* best-effort */ }
  return { dossierRegenerated, packetsRefreshed };
}

async function ledgerComms(deal, newComms, perActivity) {
  if (!newComms.length) return 0;
  const rows = newComms.map((c) => ({
    activity_event_id: c.activity_id, entity_id: deal.entity_id,
    actions: perActivity.get(c.activity_id) || {},
  }));
  const r = await opsQuery('POST', 'lcc_deal_comm_propagated?on_conflict=activity_event_id', rows,
    { headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } }).catch(() => null);
  return (r && r.ok) ? newComms.length : 0;
}

export async function handleDealCommsPropagateTick(req, res) {
  const q = { ...(req.query || {}), ...(req.body || {}) };
  const force = truthy(q.force);
  const dryRun = truthy(q.dry_run);
  const triggerSource = q.source || (req.query && Object.keys(req.query).length ? 'api' : 'cron');

  const enabled = !!process.env.DEAL_COMMS_PROPAGATE_ENABLED;
  if (!enabled && !force && !dryRun) {
    return res.status(200).json({
      ok: true, skipped: 'flag_off',
      hint: 'Set DEAL_COMMS_PROPAGATE_ENABLED in Railway (feature_flags_registry: DEAL_COMMS_PROPAGATE_CRON) to enable, or call with ?force=1 (live) / ?dry_run=1 (report).',
    });
  }

  const maxDeals = maxDealsFromEnv();
  const c = {
    deals_scanned: 0, deals_processed: 0, comms_consumed: 0,
    summaries_written: 0, summary_skipped: 0,
    milestones_written: 0, milestones_rolled_up: 0, milestone_candidates: 0,
    todos_generated: 0, todos_deduped: 0, reply_overdue_generated: 0,
    roles_written: 0, issues_open: 0, issues_closed: 0, analysis_skipped: 0, analysis_dropped: 0,
    dossiers_regenerated: 0, packets_refreshed: 0,
  };
  // W7.4 role/issues pass runs only when its own flag is set (the parent tick
  // still gates the tick itself). ?force=1 also exercises it for the dry/live gate.
  const roleIssuesEnabled = !!process.env.W74_ROLE_ISSUES;
  const errors = [];

  try {
    const batchR = await opsQuery('POST', 'rpc/lcc_deal_comms_unpropagated',
      { p_max_deals: maxDeals, p_recent_days: 7, p_corpus_cap: 80 });
    const deals = Array.isArray(batchR.data) ? batchR.data : [];
    c.deals_scanned = deals.length;

    // A cron tick has no user/workspace; resolve the deal's own workspace for the
    // dossier/packet writes (fall back to the primary workspace env).
    const wsEnv = process.env.LCC_PRIMARY_WORKSPACE_ID || process.env.LCC_DEFAULT_WORKSPACE_ID || null;

    // ── DRY RUN — report only, no writes/ledger. Deterministic cue preview. ──
    if (dryRun) {
      const preview = deals.map((d) => {
        const comms = Array.isArray(d.comms) ? d.comms : [];
        const newComms = comms.filter((x) => x.is_new);
        let cueCount = 0;
        for (const x of newComms) cueCount += detectMilestoneCues(x.subject, x.body).length;
        const todoEligible = newComms.filter((x) => x.is_inbound && x.is_recent && x.source_type === 'lcc:deal_match').length;
        return {
          entity_id: d.entity_id, deal_name: d.deal_name,
          corpus: comms.length, new_comms: newComms.length,
          deterministic_cues: cueCount, todo_eligible: todoEligible,
        };
      });
      // W7.4 — role/issues dry preview (no writes). Only when the pass is
      // enabled/forced AND ?roles=1 is asked (it invokes Ollama per deal, so it's
      // opt-in). Caps to the first few comm-active deals for a readable report.
      let roleIssuesPreview = null;
      if ((roleIssuesEnabled || force) && truthy(q.roles)) {
        roleIssuesPreview = [];
        const previewDeals = deals.filter((d) => Array.isArray(d.comms) && d.comms.length)
          .slice(0, Math.min(5, Math.max(1, parseInt(q.roles_limit || '5', 10) || 5)));
        for (const d of previewDeals) {
          try {
            const ri = await refreshRoleIssues(
              { entity_id: d.entity_id, deal_name: d.deal_name },
              Array.isArray(d.comms) ? d.comms : [], null, { dry: true });
            roleIssuesPreview.push({
              entity_id: d.entity_id, deal_name: d.deal_name, outcome: ri.outcome,
              roles: ri.proposed_roles || [], issues: ri.proposed_issues || [], dropped: ri.dropped || 0,
            });
          } catch (e) {
            roleIssuesPreview.push({ entity_id: d.entity_id, deal_name: d.deal_name, error: String(e?.message || e).slice(0, 160) });
          }
        }
      }
      // Reply-SLA dry-count — how many open deals currently trip the SLA (Scott
      // sanity-checks this before the first live generation).
      const replySla = await propagateReplySla({ dry: true });
      const runId = await writeRunLog({
        trigger_source: triggerSource, dry_run: true,
        deals_scanned: deals.length, deals_processed: 0,
        comms_consumed: preview.reduce((s, p) => s + p.new_comms, 0),
        ok: true, detail: { deals: preview.slice(0, 40), reply_sla_candidates: replySla.candidates },
      });
      return res.status(200).json({
        ok: true, dry_run: true, run_id: runId, deals_scanned: deals.length,
        reply_sla_candidates: replySla.candidates, deals: preview,
        role_issues_preview: roleIssuesPreview,
      });
    }

    // ── LIVE ────────────────────────────────────────────────────────────────
    for (const d of deals) {
      const deal = { entity_id: d.entity_id, deal_name: d.deal_name };
      const comms = Array.isArray(d.comms) ? d.comms : [];
      const newComms = comms.filter((x) => x.is_new);
      const perActivity = new Map();
      let workspaceId = wsEnv;
      try {
        // 1. summary (uses full corpus)
        const sum = await refreshSummary(deal, comms);
        if (sum.outcome === 'written') c.summaries_written += 1; else c.summary_skipped += 1;
        // 2. milestones (new comms drive cues; summary surfaced llm candidates)
        const ms = await propagateMilestones(deal, newComms, sum.candidates, perActivity);
        c.milestones_written += ms.written; c.milestones_rolled_up += ms.rolledUp;
        c.milestone_candidates += ms.candidates;
        // 3. to-dos (recent inbound matcher-backfill only)
        const td = await propagateTodos(deal, newComms, perActivity);
        c.todos_generated += td.generated; c.todos_deduped += td.deduped;
        // 3.5 W7.4 — role evolution + open issues (flag-gated; isolated so a
        // failure here NEVER blocks the summary/cue/to-do passes above or the
        // dossier below). Runs before the dossier so a fresh analysis flows in.
        if (roleIssuesEnabled || force) {
          try {
            const ri = await refreshRoleIssues(deal, comms, null);
            if (ri.outcome === 'written') {
              c.roles_written += ri.roles; c.issues_open += ri.issuesOpen;
              c.issues_closed += ri.issuesClosed; c.analysis_dropped += ri.dropped;
            } else {
              c.analysis_skipped += 1;
            }
          } catch (e) {
            errors.push({ entity_id: d.entity_id, stage: 'role_issues', error: String(e?.message || e).slice(0, 200) });
          }
        }
        // 4. dossier + packets
        const dp = await refreshDossierAndPackets(deal, workspaceId);
        c.dossiers_regenerated += dp.dossierRegenerated; c.packets_refreshed += dp.packetsRefreshed;
        // ledger — mark this deal's new comms consumed (idempotent catch-up)
        c.comms_consumed += await ledgerComms(deal, newComms, perActivity);
        c.deals_processed += 1;
      } catch (e) {
        errors.push({ entity_id: d.entity_id, error: String(e?.message || e).slice(0, 200) });
      }
    }

    // Reply-SLA runs ONCE per tick over all open in-scope deals (not just the
    // new-comm batch) — a cheap query over the ledgered comms.
    try {
      const rs = await propagateReplySla({ dry: false });
      c.reply_overdue_generated += rs.generated;
    } catch (e) {
      errors.push({ stage: 'reply_sla', error: String(e?.message || e).slice(0, 200) });
    }

    const ok = errors.length === 0;
    const runId = await writeRunLog({
      trigger_source: triggerSource, dry_run: false,
      deals_scanned: c.deals_scanned, deals_processed: c.deals_processed, comms_consumed: c.comms_consumed,
      summaries_written: c.summaries_written, summary_skipped: c.summary_skipped,
      milestones_written: c.milestones_written, milestones_rolled_up: c.milestones_rolled_up,
      milestone_candidates: c.milestone_candidates,
      todos_generated: c.todos_generated, todos_deduped: c.todos_deduped,
      reply_overdue_generated: c.reply_overdue_generated,
      roles_written: c.roles_written, issues_open: c.issues_open, issues_closed: c.issues_closed,
      analysis_skipped: c.analysis_skipped, analysis_dropped: c.analysis_dropped,
      dossiers_regenerated: c.dossiers_regenerated, packets_refreshed: c.packets_refreshed,
      error_count: errors.length, ok, detail: errors.length ? { errors: errors.slice(0, 20) } : null,
    });

    console.log(`[deal-comms-propagate-tick] ok=${ok} scanned=${c.deals_scanned} processed=${c.deals_processed} ` +
      `consumed=${c.comms_consumed} summ=${c.summaries_written}/${c.summary_skipped} ` +
      `mstone=${c.milestones_written}(+${c.milestones_rolled_up}roll,+${c.milestone_candidates}cand) ` +
      `todos=${c.todos_generated}/${c.todos_deduped} replySLA=${c.reply_overdue_generated} ` +
      `roles=${c.roles_written} issues=${c.issues_open}open/${c.issues_closed}closed(skip=${c.analysis_skipped},drop=${c.analysis_dropped}) ` +
      `dossier=${c.dossiers_regenerated} packets=${c.packets_refreshed} errors=${errors.length}`);

    return res.status(200).json({ ok, run_id: runId, ...c, errors: errors.slice(0, 20) });
  } catch (e) {
    await writeRunLog({ trigger_source: triggerSource, dry_run: !!dryRun, error_count: 1, ok: false,
      detail: { error: String(e?.message || e).slice(0, 300) } });
    console.error('[deal-comms-propagate-tick] threw:', e?.message || e);
    return res.status(200).json({ ok: false, reason: 'propagate_tick_error', detail: String(e?.message || e).slice(0, 300) });
  }
}
