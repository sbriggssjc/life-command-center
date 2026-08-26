// api/_handlers/ownership-chain-draft-tick.js
// ============================================================================
// Prompt 131 — draft the dead ownership-history research queue.
//
//   GET  → dry-run (NO writes). Honest counts: how many of the open lane rows
//          can be drafted, how many cannot, and WHY not (per-reason breakdown).
//          `?sample=N` renders N real drafts inline for human grading.
//   POST → write the drafts (flag-gated OWNERSHIP_CHAIN_DRAFT), bounded batch,
//          resumable (already-drafted subject_refs are skipped).
//
// WHAT THIS IS. `establish_ownership_history` is a never-consumed research lane
// (Dead-End playbook Class 2): 545 open, 0 lifetime completions, first queued
// 2026-06-19. P179 already gave it a CAPTURE PATH (the card's "Open ownership →"
// button routes to the property panel's Ownership tab), so the lane is answerable
// — it just asks a human to reconstruct a chain of title from scratch, per row.
// This tick turns each card into a DRAFT the operator confirms or edits.
//
// WHERE THE ANSWER COMES FROM — and why it is not the local model. Measured live
// 2026-08-26 (see the planner header for the full evidence):
//   * 544 of 545 queued properties already have gov.ownership_history rows, and
//     453 yield a clean, dated, guard-passing chain (707 links) through the P138
//     view v_ownership_transitions_portfolio. LCC simply never read it — the
//     P138–P141 feeder only ever fed `is_latest_for_property` (the CURRENT owner),
//     which is exactly the LCC-side gap (`owner_links <= 1`).
//   * The deed prose the original prompt wanted quoted DOES NOT EXIST:
//     gov.deed_records has ZERO legal_description characters across 5,804 rows.
//   * An LLM proposer for this same gap already exists and is already ON
//     (W8 U3 / W8_U3_LINK_PROPAGATION): 32 cards shipped, 27 decided — against
//     35 proposals dropped `quote_not_verbatim` (~52% hallucinated citations).
// So the draft is DETERMINISTIC and its citation is a RECORD REFERENCE
// (gov.ownership_history row id + data_source), which cannot be hallucinated.
// The local model is confined to optional role LABELLING of links it may not
// alter, behind its own flag, and the tick is fully useful with it off.
//
// DISCIPLINE. Annotation-only: writes ONLY lcc_clean_assist_proposals. It never
// writes a portfolio fact, never merges, never closes a research task. A gap in
// the chain is REPORTED ("Not on file"), never bridged. Idempotent on the store's
// UNIQUE (decision_type, subject_ref, proposal_kind, source). Reversible by
// deleting rows with source='ownership_chain_draft'.
// ============================================================================

import { createHash, randomUUID } from 'crypto';
import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import { fetchFeatureFlag, flagEnabled } from '../_shared/feature-flag.js';
import { invokeExtractionAI } from '../_shared/ai.js';
import * as OCD from '../_shared/ownership-chain-draft-planner.js';

const LANE_TYPE = 'establish_ownership_history';
const DEFAULT_BATCH = 100;
const BUDGET_MS = 45_000;
// The local-model role-labelling layer is OFF unless BOTH the draft flag and this
// one are on. Layer 1 carries the volume; Layer 2 is a nicety that must never be
// the reason a draft is missing.
const ROLE_LABEL_FLAG = 'OWNERSHIP_CHAIN_ROLE_LABELS';

function intParam(v, dflt, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(1, n));
}

// ---------------------------------------------------------------------------
// Fetch the open lane. Value-ranked (the producer already stamped rank_value =
// the owner's annual rent), highest first — the Consumption-Layer rule that the
// valued rows drain before the tail.
// ---------------------------------------------------------------------------
async function fetchOpenLaneRows(limit) {
  const r = await opsQuery('GET',
    'research_tasks?select=id,entity_id,domain,source_record_id,title,metadata,status,created_at'
    + `&research_type=eq.${LANE_TYPE}&status=in.(queued,in_progress)`
    + `&order=priority.asc,created_at.asc&limit=${limit}`);
  return (r.ok && Array.isArray(r.data)) ? r.data : [];
}

// Already-drafted subject_refs, so a re-run resumes rather than re-drafting.
async function fetchExistingDrafts() {
  const out = new Set();
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const r = await opsQuery('GET',
      'lcc_clean_assist_proposals?select=subject_ref'
      + `&source=eq.${OCD.OCD_SOURCE}&status=eq.proposed`
      + `&order=proposal_id.asc&offset=${offset}&limit=1000`, undefined, { countMode: 'none' });
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) break;
    for (const row of r.data) out.add(row.subject_ref);
    if (r.data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

// ---------------------------------------------------------------------------
// One batched read of gov transitions for the whole slice.
//
// ⚠️ PostgREST caps a response at 1000 rows regardless of `limit` (CLAUDE.md), so
// this pages at exactly 1000 and reports truncation rather than silently dropping
// links — a dropped link is a chain that reads shorter than it is, which is worse
// than no draft at all.
// ---------------------------------------------------------------------------
async function fetchTransitionsFor(domain, propertyIds) {
  const byProp = new Map();
  const errors = [];
  // `source_record_id` is TEXT on research_tasks while the domain's property_id is
  // a bigint, so a single non-numeric id would 400 the whole `in.()` chunk and
  // silently cost 60 properties their drafts. Filter them out and COUNT them
  // rather than letting one bad row take the batch down.
  const all = [...new Set(propertyIds.filter((v) => v != null && v !== '').map(String))];
  const ids = all.filter((v) => /^\d+$/.test(v));
  const skipped = all.length - ids.length;
  if (skipped) errors.push(`non_numeric_property_id_skipped:${skipped}`);
  if (!ids.length) return { byProp, errors, truncated: false };

  const cols = 'ownership_id,property_id,transfer_date,prior_owner,new_owner,prior_owner_cleaned,'
    + 'new_owner_cleaned,transfer_price,sale_price,data_source,change_type,prior_owner_is_clean,'
    + 'new_owner_is_clean,is_self_transition,is_oscillating_pair,is_name_variant,'
    + 'new_owner_had_brokerage_suffix';

  let truncated = false;
  const CHUNK = 60; // keep the in.() URL well inside header limits
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    let offset = 0;
    for (let page = 0; page < 10; page += 1) {
      const path = `v_ownership_transitions_portfolio?select=${cols}`
        + `&property_id=in.(${chunk.join(',')})`
        + `&order=property_id.asc,transfer_date.asc&offset=${offset}&limit=1000`;
      const r = await domainQuery(domain === 'dia' ? 'dialysis' : 'government', 'GET', path);
      if (!r.ok) { errors.push(`transitions_fetch_${r.status}: ${JSON.stringify(r.data).slice(0, 160)}`); break; }
      const rows = Array.isArray(r.data) ? r.data : [];
      for (const row of rows) {
        const k = String(row.property_id);
        if (!byProp.has(k)) byProp.set(k, []);
        byProp.get(k).push(row);
      }
      if (rows.length < 1000) break;
      offset += 1000;
      if (page === 9) truncated = true;
    }
  }
  return { byProp, errors, truncated };
}

// Current-owner context, so the draft can say whether the chain lands on the owner
// LCC believes holds the asset today (and flag it when it does not).
async function fetchChainContext(domain, propertyIds) {
  const ctx = new Map();
  const ids = [...new Set(propertyIds.map(String))];
  const CHUNK = 60;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const inList = '(' + chunk.map((v) => `"${v}"`).join(',') + ')';
    const r = await opsQuery('GET',
      'v_lcc_ownership_chain_completeness?select=source_property_id,current_owner_name,address,city,state,current_annual_rent'
      + `&source_domain=eq.${domain}&source_property_id=in.${encodeURIComponent(inList)}`,
      undefined, { countMode: 'none' });
    if (r.ok && Array.isArray(r.data)) {
      for (const row of r.data) {
        ctx.set(String(row.source_property_id), {
          current_owner_name: row.current_owner_name || null,
          address: [row.address, row.city, row.state].filter(Boolean).join(', ') || null,
          rank_value: Number(row.current_annual_rent) || 0,
        });
      }
    }
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Build one draft. Layer 1 always; Layer 2 (role labels) only when enabled AND
// the draft is worth labelling. A Layer-2 failure NEVER discards the Layer-1
// draft — the model is additive or it is nothing.
// ---------------------------------------------------------------------------
async function draftOne(task, transitions, ctx, opts) {
  const draft = OCD.buildChainDraft(transitions, ctx || {});
  const meta = { provider: null, model: null, tried: [], promptHash: null, labels: null };

  if (opts.roleLabels && draft.draftable && draft.links.length) {
    try {
      const prompt = OCD.buildRoleLabelPrompt(draft, ctx || {});
      meta.promptHash = createHash('sha256').update(prompt).digest('hex');
      const ai = await invokeExtractionAI({ prompt, surface: 'clean_assist' });
      meta.provider = ai?.provider || null;
      meta.model = ai?.data?.model || null;
      meta.tried = Array.isArray(ai?.tried) ? ai.tried : [];
      const parsed = OCD.parseRoleLabels(ai?.data?.response || '');
      meta.labels = OCD.applyRoleLabels(draft, parsed);
    } catch (e) {
      meta.labels = { applied: 0, dropped: 0, drop_reasons: { call_failed: 1 }, error: String(e?.message || e) };
    }
  }
  return { draft, meta };
}

async function upsertDraft(task, draft, meta, ctx, sourceRunId) {
  const subjectRef = OCD.ocdSubjectRef(task.domain, task.source_record_id);
  return opsQuery('POST',
    `lcc_clean_assist_proposals?on_conflict=decision_type,subject_ref,proposal_kind,source`,
    {
      source: OCD.OCD_SOURCE,
      source_run_id: sourceRunId,
      decision_id: null,
      decision_type: OCD.OCD_DECISION_TYPE,
      subject_ref: subjectRef,
      subject_domain: OCD.normDomain(task.domain),
      subject_property_id: task.source_record_id != null ? String(task.source_record_id) : null,
      subject_entity_id: task.entity_id || null,
      proposal_kind: OCD.OCD_KIND,
      verdict: draft.verdict,
      reason: draft.reason,
      confidence: draft.confidence,
      proposed_link: {
        research_task_id: task.id,
        draftable: draft.draftable,
        insufficient_reason: draft.insufficient_reason,
        links: draft.links,
        rejected: draft.rejected,
        continuity: draft.continuity,
        terminates_at_current_owner: draft.terminates_at_current_owner,
        draft_text: OCD.renderChainDraftText(draft, ctx || {}),
        current_owner_name: (ctx && ctx.current_owner_name) || null,
        address: (ctx && ctx.address) || null,
        role_labels: meta.labels || null,
        layer: meta.labels && meta.labels.applied ? 'deterministic+labels' : 'deterministic',
      },
      conflict_summary: draft.terminates_at_current_owner === false
        ? `Last recorded grantee is not the owner LCC shows (${(ctx && ctx.current_owner_name) || 'unknown'}).`
        : null,
      model_provider: meta.provider,
      model_name: meta.model,
      ai_tried: meta.tried || [],
      prompt_hash: meta.promptHash,
      status: 'proposed',
    },
    { headers: { Prefer: 'return=representation,resolution=merge-duplicates' } });
}

// ---------------------------------------------------------------------------
export async function handleOwnershipChainDraftTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET/POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const flag = await fetchFeatureFlag('OWNERSHIP_CHAIN_DRAFT');
  const enabled = flagEnabled('OWNERSHIP_CHAIN_DRAFT', flag);
  const roleFlag = await fetchFeatureFlag(ROLE_LABEL_FLAG);
  const roleLabels = flagEnabled(ROLE_LABEL_FLAG, roleFlag);
  const limit = intParam(req.query.limit || req.body?.limit, DEFAULT_BATCH, 500);

  const scanErrors = [];
  const existing = await fetchExistingDrafts();
  const openRows = await fetchOpenLaneRows(Math.max(limit, 600));
  const fresh = openRows.filter((t) => !existing.has(OCD.ocdSubjectRef(t.domain, t.source_record_id)));

  // Group by domain so each domain DB is queried once.
  const byDomain = new Map();
  for (const t of fresh) {
    const d = OCD.normDomain(t.domain);
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(t);
  }

  const prepared = [];
  for (const [domain, tasks] of byDomain) {
    const ids = tasks.map((t) => t.source_record_id).filter(Boolean);
    const { byProp, errors, truncated } = await fetchTransitionsFor(domain, ids);
    if (errors.length) scanErrors.push(...errors);
    if (truncated) scanErrors.push(`transitions_page_cap_hit:${domain}`);
    const ctxMap = await fetchChainContext(domain, ids);
    for (const t of tasks) {
      prepared.push({
        task: t,
        transitions: byProp.get(String(t.source_record_id)) || [],
        ctx: ctxMap.get(String(t.source_record_id)) || {},
      });
    }
  }

  // Deterministic classification of the WHOLE slice, in memory, for honest counts.
  // No LLM is spent to produce these numbers.
  const counts = { draftable: 0, insufficient: 0, by_insufficient_reason: {}, links_total: 0,
    contiguous: 0, with_gaps: 0, terminates_at_current: 0, mismatch_current_owner: 0 };
  for (const p of prepared) {
    const d = OCD.buildChainDraft(p.transitions, p.ctx);
    if (!d.draftable) {
      counts.insufficient += 1;
      counts.by_insufficient_reason[d.insufficient_reason] =
        (counts.by_insufficient_reason[d.insufficient_reason] || 0) + 1;
      continue;
    }
    counts.draftable += 1;
    counts.links_total += d.links.length;
    if (d.continuity.contiguous) counts.contiguous += 1; else counts.with_gaps += 1;
    if (d.terminates_at_current_owner === true) counts.terminates_at_current += 1;
    if (d.terminates_at_current_owner === false) counts.mismatch_current_owner += 1;
  }

  // ---- GET dry-run --------------------------------------------------------
  if (req.method === 'GET') {
    const out = {
      ok: true, mode: 'dry_run', enabled, flag_state: flag?.state || 'missing',
      role_labels_enabled: roleLabels, lane: LANE_TYPE, limit,
      open_lane_rows: openRows.length, already_drafted: existing.size, fresh: fresh.length,
      counts, scan_errors: scanErrors,
      note: 'Annotation-only, NO writes in dry-run. The chain is assembled DETERMINISTICALLY from '
        + 'gov.ownership_history via v_ownership_transitions_portfolio (P138 guards re-applied); the '
        + 'citation is a record reference, not a model quote. A gap in the chain is reported, never '
        + 'bridged. Confirming a draft stays a HUMAN action on the P179 capture path.',
    };
    const n = intParam(req.query.sample, 0, 25);
    if (n) {
      out.samples = prepared.slice(0, n).map((p) => {
        const d = OCD.buildChainDraft(p.transitions, p.ctx);
        return {
          subject_ref: OCD.ocdSubjectRef(p.task.domain, p.task.source_record_id),
          property_id: p.task.source_record_id,
          address: p.ctx.address || null,
          verdict: d.verdict, confidence: d.confidence,
          draftable: d.draftable, insufficient_reason: d.insufficient_reason,
          reason: d.reason,
          draft_text: OCD.renderChainDraftText(d, p.ctx),
          rejected: d.rejected,
        };
      });
    }
    return res.status(200).json(out);
  }

  // ---- POST apply (flag-gated) -------------------------------------------
  if (!enabled) {
    return res.status(200).json({ ok: true, skipped: 'feature_flag_off', enabled: false,
      lane: LANE_TYPE, open_lane_rows: openRows.length, fresh: fresh.length, counts });
  }

  const sourceRunId = 'p131_' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
    + '_' + randomUUID().slice(0, 8);
  const summary = { source_run_id: sourceRunId, lane: LANE_TYPE, enabled: true,
    role_labels_enabled: roleLabels, open_lane_rows: openRows.length,
    already_drafted: existing.size, fresh: fresh.length,
    written_draftable: 0, written_insufficient: 0, failed: 0,
    role_labels_applied: 0, role_labels_dropped: 0,
    budget_stopped: false, counts, scan_errors: scanErrors };

  const start = Date.now();
  for (const p of prepared.slice(0, limit)) {
    if (Date.now() - start >= BUDGET_MS) { summary.budget_stopped = true; break; }
    try {
      const { draft, meta } = await draftOne(p.task, p.transitions, p.ctx, { roleLabels });
      const w = await upsertDraft(p.task, draft, meta, p.ctx, sourceRunId);
      if (!w.ok) { summary.failed += 1; scanErrors.push(`upsert_${w.status}`); continue; }
      if (draft.draftable) summary.written_draftable += 1; else summary.written_insufficient += 1;
      if (meta.labels) {
        summary.role_labels_applied += meta.labels.applied || 0;
        summary.role_labels_dropped += meta.labels.dropped || 0;
      }
    } catch (e) {
      summary.failed += 1;
      scanErrors.push(`draft_failed:${String(e?.message || e).slice(0, 120)}`);
    }
  }

  summary.note = 'Drafts written to lcc_clean_assist_proposals (source ownership_chain_draft). '
    + 'NOTHING was written to the ownership graph and no research task was closed — a human '
    + 'confirms each draft on the P179 capture path. Reverse: delete from '
    + "lcc_clean_assist_proposals where source='ownership_chain_draft'.";
  return res.status(200).json(summary);
}

export default handleOwnershipChainDraftTick;
