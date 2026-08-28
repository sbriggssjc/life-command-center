// api/_handlers/ownership-chain-draft-tick.js
// ============================================================================
// Prompt 131 — draft the dead ownership-history research queue.
//
//   GET  → dry-run (NO writes). Honest counts: how many of the open lane rows
//          can be drafted, how many cannot, and WHY not (per-reason breakdown).
//          `?sample=N` renders N real drafts inline for human grading.
//          `?role_labels=1&generate=1` additionally runs the OPTIONAL Layer-2
//          role-labeller over a shape-spread sample and returns every proposed
//          label next to the guard verdict it would receive — still NO writes,
//          and it does NOT require the flag (P140; mirrors the P138 analyst-take
//          `?generate=1` grading path).
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

// P140 — the dry-run grading pass. 18 sits inside the 15–20 the grade calls for
// and is spread across chain shapes rather than taken off the value-ranked head.
const GRADE_SAMPLE_DEFAULT = 18;
const GRADE_SAMPLE_MAX = 25;
// Concurrency, not a bigger timeout: 18 sequential local-model calls is minutes.
const GRADE_CONCURRENCY = 3;
// A manual grading GET is not on the pg_net 60 s leash, but it must still end.
// A truncated grade REPORTS itself (`budget_stopped`) rather than reading as a
// complete sample that happened to be small.
const GRADE_BUDGET_MS = 150_000;
// How much of the open lane the grade classifies before spreading its sample.
// Big enough that every chain shape is represented (measured live: the 453
// draftable rows are 173 priced / 133 single-link / 119 affiliate-overlap /
// 22 nominal-price / 6 multi-link), bounded so a manual GET stays cheap.
const GRADE_LANE_SCAN = 200;

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

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

// ---------------------------------------------------------------------------
// A4 RE-OPEN PASS — the sensor half of lcc_a4_retire_no_records.
//
// A4 retires the `no_records` bucket by stamping `outcome.terminal='true'`,
// which is the ONLY thing cron 144 treats as terminal. That stamp is exactly
// what would turn a retire into a delete, so it needs an inverse (P121).
//
// ⚠️ THE INVERSE CANNOT LIVE IN SQL, AND THAT WAS MEASURED, NOT ASSUMED.
// LCC Opps holds no mirror of `gov.ownership_history` — neither
// `v_ownership_chain_worklist` nor `v_lcc_ownership_chain_completeness`
// carries a per-property transition count. This tick is the ONLY reader of
// `v_ownership_transitions_portfolio` in the system, so the eye belongs here
// and reuses `fetchTransitionsFor` rather than adding a second gov fetcher
// that can drift from the one the drafts are built on.
//
// It runs BEFORE the open-lane read so a property whose records landed is
// re-queued, re-drafted and (if it now `agrees`) applied by A2 the same night
// — 06:45 draft → 06:49 apply → 06:51 retire.
// ---------------------------------------------------------------------------
async function fetchA4RetiredTasks() {
  const r = await opsQuery('GET',
    'research_tasks?select=id,domain,source_record_id'
    + `&research_type=eq.${LANE_TYPE}&status=eq.skipped`
    + '&outcome->>reason=eq.a4_no_usable_transition_on_file'
    + '&order=id.asc&limit=1000', undefined, { countMode: 'none' });
  return (r.ok && Array.isArray(r.data)) ? r.data : [];
}

// ⚠️ A RE-OPEN THAT LEAVES THE STALE DRAFT IN PLACE RE-RETIRES THE SAME NIGHT.
// `fresh` excludes any task whose subject_ref already carries a proposal, and a
// retired task still carries the `no_records` draft that got it retired. Without
// this the re-opened task is skipped by the drafter, stays classified
// `no_records`, and the 06:51 retire closes it again — a silent loop that would
// read as a working re-open. Superseding the stale proposal is what makes the
// property genuinely re-enter the lane.
async function supersedeStaleDrafts(subjectRefs) {
  let superseded = 0;
  for (const ref of subjectRefs) {
    const r = await opsQuery('PATCH',
      `lcc_clean_assist_proposals?source=eq.${OCD.OCD_SOURCE}`
      + `&status=eq.proposed&subject_ref=eq.${encodeURIComponent(ref)}`,
      { status: 'superseded' });
    if (r.ok) superseded += 1;
  }
  return superseded;
}

// ---------------------------------------------------------------------------
// A4b RE-DRAFT PASS — the eye for a guard that got LOOSER.
//
// A4b narrowed the P138 address-shaped arms in
// `gov.v_ownership_transitions_portfolio` so a street-numbered SPE
// (`EGP 17101 BROOMFIELD LLC`) is no longer disqualified by its own street
// number. A view change is live the instant it is applied — but the DRAFTS
// built from the old view are not, and `fresh` excludes any task that already
// carries a proposal. Without this pass the 11 tasks the correction unblocks
// keep their stale `all_transitions_guarded` draft FOREVER and the fix is
// invisible on every surface: the predicate is right and the lane never drains.
// Exactly the A4 stale-draft trap, from the other direction.
//
// ⚠️ IT IS DELIBERATELY NOT KEYED ON "A4b SHIPPED". A one-shot supersede is a
// chore repeated silently the next time any guard moves (P176/Class 8). The
// predicate here is the STATE — this task's draft says every transfer was
// guarded away, and the gov view now says at least one passes — so it
// self-clears, and it equally covers a property whose records simply improved.
// It re-uses `fetchTransitionsFor` + `OCD.guardTransition`, never a second copy
// of either.
//
// Runs BEFORE `fetchExistingDrafts()`, so the very same run re-drafts what it
// supersedes: 06:45 draft -> 06:49 A2 apply.
// ---------------------------------------------------------------------------
async function fetchAllGuardedTasks() {
  const r = await opsQuery('GET',
    'v_lcc_ownership_history_lane_split?select=research_task_id,domain,source_record_id'
    + '&action=eq.all_guarded&order=research_task_id.asc&limit=1000',
    undefined, { countMode: 'none' });
  return (r.ok && Array.isArray(r.data)) ? r.data : [];
}

async function runA4bRedraftPass(apply, errors) {
  const out = { guarded_checked: 0, now_has_passing_link: 0, drafts_superseded: 0 };
  const guarded = await fetchAllGuardedTasks();
  out.guarded_checked = guarded.length;
  if (!guarded.length) return out;

  const byDomain = new Map();
  for (const t of guarded) {
    if (!byDomain.has(t.domain)) byDomain.set(t.domain, []);
    byDomain.get(t.domain).push(String(t.source_record_id));
  }

  for (const [domain, propertyIds] of byDomain) {
    const { byProp, errors: fErr } = await fetchTransitionsFor(domain, propertyIds);
    for (const e of fErr) errors.push(`a4b_redraft_${e}`);
    // A fetch that returned nothing must read as "no change", never as
    // "now draftable" — an empty map supersedes nothing.
    const unblocked = propertyIds.filter((id) => {
      const ts = byProp.get(id) || [];
      return ts.some((t) => OCD.guardTransition(t) === null);
    });
    out.now_has_passing_link += unblocked.length;
    if (!unblocked.length || !apply) continue;
    out.drafts_superseded += await supersedeStaleDrafts(
      unblocked.map((id) => OCD.ocdSubjectRef(domain, id)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// A2b RE-DRAFT PASS — the eye for a DRAFTER that got smarter.
//
// A2b taught `buildChainDraft` to collapse one conveyance recorded on several
// dates. Every draft built from now on is collapsed at birth — but the drafts
// built BEFORE it are not, and `fresh` excludes any task that already carries a
// proposal. Without this pass the 14 tasks the collapse unblocks keep their
// pre-A2b draft forever: the planner is right, A2 still refuses them, and the
// fix is invisible on every surface. That is invariant #10 — the same stale-draft
// trap A4b hit, from the drafter's side rather than the guard's.
//
// ⚠️ IT IS DELIBERATELY NOT KEYED ON "A2b SHIPPED", AND THAT IS NOT PEDANTRY
// HERE — THE PRODUCER IS LIVE. `gsa_lease_diff` is dormant (newest row
// 2026-03-27, zero in 90 days), but the repeat-pair population is still GROWING:
// 323 pairs fleet-wide, 58 completed in the last 90 days, 9 in the last 30, most
// recent 2026-08-24 — because `costar_sidebar` is live (271 rows/30d) and lands a
// SECOND observation of a pair the lease-diff already recorded (91 of 323 are
// cross-source). A one-shot supersede would therefore be a chore repeated
// silently forever (P176/Class 8). The predicate is the STATE — this task is
// blocked as `repeat_transfer_unrepresentable` and the drafter now collapses it —
// so it self-clears once re-drafted and equally catches a pair whose second
// observation arrives next month. That is why A2b ships no cron of its own: the
// sweep is this pass, inside the drafter's existing 06:45 run.
//
// ⚠️ It re-runs the REAL planner rather than trusting the blocked reason, so a
// gov fetch that returns nothing supersedes NOTHING ("the fetch failed" must
// never read as "now collapsible"), and a task blocked for a reason A2b does not
// actually fix keeps its draft instead of being churned.
//
// Runs BEFORE `fetchExistingDrafts()`, so the same run re-drafts what it
// supersedes: 06:45 draft -> 06:49 A2 apply.
// ---------------------------------------------------------------------------
async function fetchRepeatBlockedTasks() {
  const r = await opsQuery('GET',
    'v_lcc_ownership_chain_apply_blocked?select=research_task_id,source_domain,source_property_id'
    + '&blocked_reason=eq.repeat_transfer_unrepresentable'
    + '&order=research_task_id.asc&limit=1000', undefined, { countMode: 'none' });
  if (!r.ok || !Array.isArray(r.data)) return [];
  // The view is one row per LINK; the unit of work is the TASK (invariant #2).
  const byRef = new Map();
  for (const row of r.data) {
    byRef.set(`${row.source_domain}|${row.source_property_id}`, {
      domain: row.source_domain, source_record_id: String(row.source_property_id),
    });
  }
  return [...byRef.values()];
}

async function runA2bRedraftPass(apply, errors) {
  const out = { repeat_blocked_checked: 0, now_collapsible: 0, links_collapsed: 0, drafts_superseded: 0 };
  const blocked = await fetchRepeatBlockedTasks();
  out.repeat_blocked_checked = blocked.length;
  if (!blocked.length) return out;

  const byDomain = new Map();
  for (const t of blocked) {
    if (!byDomain.has(t.domain)) byDomain.set(t.domain, []);
    byDomain.get(t.domain).push(String(t.source_record_id));
  }

  for (const [domain, propertyIds] of byDomain) {
    const { byProp, errors: fErr } = await fetchTransitionsFor(domain, propertyIds);
    for (const e of fErr) errors.push(`a2b_redraft_${e}`);
    const collapsible = [];
    for (const id of propertyIds) {
      const ts = byProp.get(id) || [];
      if (!ts.length) continue;
      const d = OCD.buildChainDraft(ts, {});
      if (d.draftable && d.collapsed_conveyances > 0) {
        collapsible.push(id);
        out.links_collapsed += d.collapsed_conveyances;
      }
    }
    out.now_collapsible += collapsible.length;
    if (!collapsible.length || !apply) continue;
    out.drafts_superseded += await supersedeStaleDrafts(
      collapsible.map((id) => OCD.ocdSubjectRef(domain, id)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// B5 — RE-DRAFT A TASK WHOSE SOURCE GOT DEEPER AFTER ITS DRAFT WAS BUILT.
//
// The drafter prepares from `fresh` = open AND UNDRAFTED, so a standing draft is
// never rebuilt. That is correct while the source is static and wrong the moment
// a new producer lands transitions the draft could not have seen. Measured
// 2026-08-28, the day the B5 gov sales feeder wrote 2,776 transitions: 527 of
// 579 open gov tasks already carried a draft, so without this pass B5 would have
// converted on 52 tasks and the other 527 would have kept a shallower chain
// FOREVER — the third arrival of the stale-draft trap A4b and A2b each closed
// from a different direction.
//
// Keyed on STATE, not on B5: "the planner now yields more links than this draft
// used". It therefore self-clears, needs no cron of its own, and equally catches
// the next source — a county deed drop, an OCR batch, a re-run of the sales
// feeder after new comps land — without knowing anything about it.
//
// ⚠️ It re-runs the REAL planner and supersedes ONLY on a strict increase. A gov
// fetch that returns nothing supersedes nothing: "the fetch failed" must never
// read as "the chain got shorter", which would churn a good draft into a worse
// one. Same reason A2b re-runs the planner instead of trusting a blocked reason.
//
// Runs BEFORE `fetchExistingDrafts()`, so this same run re-drafts what it
// supersedes: 06:45 draft -> 06:49 A2 apply.
// ---------------------------------------------------------------------------
const B5_REDRAFT_SCAN_CAP = 700;

async function fetchOpenDraftedTasks() {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 5; page += 1) {
    const r = await opsQuery('GET',
      'v_lcc_ownership_chain_draft_open_link_counts'
      + '?select=subject_ref,source_domain,source_property_id,standing_links'
      + `&order=research_task_id.asc&offset=${offset}&limit=1000`, undefined, { countMode: 'none' });
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) break;
    out.push(...r.data);
    if (r.data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

async function runB5RedraftPass(apply, errors) {
  const out = { open_drafted_checked: 0, scan_capped: false, now_deeper: 0,
    links_gained: 0, drafts_superseded: 0 };
  const rows = await fetchOpenDraftedTasks();
  // Bounded like every other pass here. When it comes back capped the figure we
  // report is a FLOOR, and the next run picks up where the ordering left off.
  out.scan_capped = rows.length > B5_REDRAFT_SCAN_CAP;
  if (out.scan_capped) errors.push(`b5_redraft_scan_capped:${B5_REDRAFT_SCAN_CAP}`);
  const slice = rows.slice(0, B5_REDRAFT_SCAN_CAP);
  out.open_drafted_checked = slice.length;
  if (!slice.length) return out;

  const byDomain = new Map();
  const standing = new Map();
  for (const r of slice) {
    const id = String(r.source_property_id);
    if (!byDomain.has(r.source_domain)) byDomain.set(r.source_domain, []);
    byDomain.get(r.source_domain).push(id);
    standing.set(`${r.source_domain}|${id}`, Number(r.standing_links) || 0);
  }

  for (const [domain, propertyIds] of byDomain) {
    const { byProp, errors: fErr } = await fetchTransitionsFor(domain, propertyIds);
    for (const e of fErr) errors.push(`b5_redraft_${e}`);
    const deeper = [];
    for (const id of propertyIds) {
      const ts = byProp.get(id) || [];
      if (!ts.length) continue;                       // no fetch -> no supersede
      const d = OCD.buildChainDraft(ts, {});
      if (!d.draftable) continue;                     // a draftable draft never
      const now = Array.isArray(d.links) ? d.links.length : 0;  // yields to an
      const was = standing.get(`${domain}|${id}`) || 0;         // unusable one
      if (now > was) { deeper.push(id); out.links_gained += (now - was); }
    }
    out.now_deeper += deeper.length;
    if (!deeper.length || !apply) continue;
    out.drafts_superseded += await supersedeStaleDrafts(
      deeper.map((id) => OCD.ocdSubjectRef(domain, id)));
  }
  return out;
}

async function runA4ReopenPass(apply, errors) {
  const out = { retired_checked: 0, transitions_landed: 0, reopened: 0, drafts_superseded: 0 };
  const retired = await fetchA4RetiredTasks();
  out.retired_checked = retired.length;
  if (!retired.length) return out;

  const byDomain = new Map();
  for (const t of retired) {
    if (!byDomain.has(t.domain)) byDomain.set(t.domain, []);
    byDomain.get(t.domain).push(String(t.source_record_id));
  }

  for (const [domain, propertyIds] of byDomain) {
    const { byProp, errors: fErr } = await fetchTransitionsFor(domain, propertyIds);
    for (const e of fErr) errors.push(`a4_reopen_${e}`);
    // A property is re-opened only when the gov view — the same one the drafts
    // are built from — actually returns a transition for it. "The fetch failed"
    // must never read as "records landed", so an empty map re-opens nothing.
    const landed = propertyIds.filter((id) => (byProp.get(id) || []).length > 0);
    out.transitions_landed += landed.length;
    if (!landed.length) continue;

    const r = await opsQuery('POST', 'rpc/lcc_a4_reopen_tasks', {
      p_domain: domain, p_property_ids: landed, p_dry_run: !apply,
      p_reason: 'transitions_landed',
    });
    if (!r.ok) { errors.push(`a4_reopen_rpc_${r.status}`); continue; }
    const n = Number(r.data?.tasks_reopened ?? r.data?.tasks_to_reopen ?? 0);
    out.reopened += Number.isFinite(n) ? n : 0;
    if (apply) {
      out.drafts_superseded += await supersedeStaleDrafts(
        landed.map((id) => OCD.ocdSubjectRef(domain, id)));
    }
  }
  return out;
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

// ---------------------------------------------------------------------------
// P140 — LAYER 2 DRY-RUN GRADER. Runs the role-labeller and returns what it
// proposed WITHOUT writing anything and WITHOUT requiring the flag.
//
// WHY THE FLAG IS NOT THE GATE HERE. `OWNERSHIP_CHAIN_ROLE_LABELS` is off and the
// grade is what decides whether it should be flipped; gating the grade on the
// flag would make the layer ungradeable until after it shipped. Same shape as the
// P138 analyst-take tick, whose `?generate=1` is deliberately ungated and never
// writes. The APPLY path (POST) still honours the flag exactly as before.
//
// WHY IT REPORTS THE DROPS INSTEAD OF DROPPING THEM. W8 U3 shipped 32 cards over
// this same gap while dropping 35 proposals `quote_not_verbatim` — the ~52% drop
// rate WAS the finding, and it was only visible because someone counted it. A
// grade that silently discarded the rejects would report the survivors' quality
// and call it the model's accuracy. So every proposed label comes back with its
// link, its rationale and its party-presence verdict, and a MEANINGFUL drop rate
// is the guard working, not the run failing.
//
// WHY IT PROVES IMMUTABILITY RATHER THAN ASSERTING IT. Each sample fingerprints
// its deterministic chain, runs the REAL production applier (`applyRoleLabels`)
// over a deep copy, and re-fingerprints. `chain_unchanged:false` on any row means
// Layer 2 altered a link and the flag must not be flipped — a claim in a comment
// would not have caught that.
// ---------------------------------------------------------------------------
async function gradeOneSample(entry) {
  const draft = OCD.buildChainDraft(entry.transitions, entry.ctx || {});
  const out = {
    subject_ref: OCD.ocdSubjectRef(entry.task.domain, entry.task.source_record_id),
    property_id: entry.task.source_record_id,
    address: entry.ctx.address || null,
    chain_shape: OCD.classifyChainShape(draft),
    link_count: draft.links.length,
    chain_confidence: draft.confidence,
    // The chain AS DRAFTED — the facts every label is graded against. This is the
    // deterministic Layer-1 output and the model may not touch any of it.
    chain: draft.links.map((l, i) => ({
      index: i, date: l.date, grantor: l.from, grantee: l.to, price: l.price,
      data_source: (l.citation && l.citation.data_source) || null,
      ownership_id: (l.citation && l.citation.ownership_id) || null,
      gap_before: l.gap_before === true,
    })),
  };

  const prompt = OCD.buildRoleLabelPrompt(draft, entry.ctx || {});
  out.prompt_chars = prompt.length;
  out.prompt_hash = createHash('sha256').update(prompt).digest('hex').slice(0, 16);

  let ai = null;
  try {
    ai = await invokeExtractionAI({ prompt, surface: 'clean_assist' });
  } catch (e) {
    out.model = { ok: false, error: String(e?.message || e).slice(0, 200) };
    out.grade = { rows: [], summary: null, parsed: false };
    return out;
  }

  // Which seam actually answered matters to the grade: the local box and the
  // cloud fallback are different models, so a sample rescued by cloud is NOT a
  // grade of the on-box layer the flag would turn on.
  out.model = {
    ok: !!ai?.ok, provider: ai?.provider || null, name: ai?.data?.model || null,
    tried: Array.isArray(ai?.tried) ? ai.tried : [],
    status: ai?.status ?? null,
  };
  const raw = ai?.data?.response || '';
  out.raw_response_chars = String(raw).length;
  const labels = OCD.parseRoleLabels(raw);
  if (!labels) {
    // "The model answered nothing usable" and "the model proposed no labels" are
    // different facts; the first is a parse failure, the second is an abstention.
    out.grade = { rows: [], summary: null, parsed: false };
    out.parse_failure = raw ? String(raw).slice(0, 200) : 'empty_response';
    return out;
  }

  out.grade = OCD.gradeRoleLabels(draft, labels);

  // Immutability proof, through the REAL applier on a throwaway copy.
  const before = OCD.chainFingerprint(draft);
  const copy = OCD.buildChainDraft(entry.transitions, entry.ctx || {});
  OCD.applyRoleLabels(copy, labels);
  out.chain_unchanged = OCD.chainFingerprint(copy) === before;
  out.would_render = copy.links
    .filter((l) => l.role_label)
    .map((l) => ({ date: l.date, grantor: l.from, grantee: l.to, role_label: l.role_label, role_why: l.role_why }));
  return out;
}

// Bounded worker pool. Sequential would be minutes for 18 local-model calls;
// unbounded would hammer the single on-box GPU the whole system shares.
async function runGradePool(entries, concurrency, deadlineMs) {
  const results = [];
  let next = 0;
  let stopped = false;
  const worker = async () => {
    for (;;) {
      if (Date.now() >= deadlineMs) { stopped = true; return; }
      const i = next; next += 1;
      if (i >= entries.length) return;
      try { results.push(await gradeOneSample(entries[i])); } catch (e) {
        results.push({
          subject_ref: OCD.ocdSubjectRef(entries[i].task.domain, entries[i].task.source_record_id),
          model: { ok: false, error: String(e?.message || e).slice(0, 200) },
          grade: { rows: [], summary: null, parsed: false },
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { results, budget_stopped: stopped };
}

// Roll the per-sample grades into the numbers the flip decision is actually made
// on. Deliberately keeps `party_presence_fail` separate from the other drops:
// the ask is specifically whether the party-presence guard is catching the
// hallucinated-rationale cases, and burying it inside a total would answer a
// different question.
export function summariseGrade(samples) {
  const agg = {
    samples: samples.length,
    samples_with_model_response: 0,
    samples_parse_failed: 0,
    labels_proposed: 0, labels_would_apply: 0, labels_dropped: 0,
    drop_reasons: {}, labels_by_kind: {},
    party_presence: { pass: 0, fail: 0, no_rationale: 0, unresolvable_index: 0 },
    by_chain_shape: {},
    providers: {},
    chains_altered_by_layer2: 0,
  };
  for (const s of samples) {
    if (s.model && s.model.ok) agg.samples_with_model_response += 1;
    if (s.grade && s.grade.parsed === false) agg.samples_parse_failed += 1;
    if (s.model && s.model.provider) {
      agg.providers[s.model.provider] = (agg.providers[s.model.provider] || 0) + 1;
    }
    if (s.chain_shape) agg.by_chain_shape[s.chain_shape] = (agg.by_chain_shape[s.chain_shape] || 0) + 1;
    if (s.chain_unchanged === false) agg.chains_altered_by_layer2 += 1;
    const sum = s.grade && s.grade.summary;
    if (!sum) continue;
    agg.labels_proposed += sum.proposed;
    agg.labels_would_apply += sum.would_apply;
    agg.labels_dropped += sum.dropped;
    for (const [k, v] of Object.entries(sum.drop_reasons || {})) agg.drop_reasons[k] = (agg.drop_reasons[k] || 0) + v;
    for (const [k, v] of Object.entries(sum.labels_by_kind || {})) agg.labels_by_kind[k] = (agg.labels_by_kind[k] || 0) + v;
    for (const k of Object.keys(agg.party_presence)) agg.party_presence[k] += (sum.party_presence?.[k] || 0);
  }
  agg.drop_rate = agg.labels_proposed
    ? Number((agg.labels_dropped / agg.labels_proposed).toFixed(3)) : null;
  const ppSeen = agg.party_presence.pass + agg.party_presence.fail;
  agg.party_presence_fail_rate = ppSeen ? Number((agg.party_presence.fail / ppSeen).toFixed(3)) : null;
  return agg;
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
// P133 — run log. The tick is on a nightly pg_cron schedule
// (`lcc-ownership-chain-draft`, 06:45 UTC), and a schedule with no ledger cannot
// tell a quiet night from a dropped one: pg_net records only the HTTP attempt
// and prunes `net._http_response` to ~6 hours (P123), lcc_cron_post_log records
// only that a request went out, and cron.job_run_details reports the SQL as
// successful even when the handler never answers.
//
// So the row is OPENED at request entry (status='started') and PATCHed on the
// way out. A row still reading 'started' means the handler did not come back.
// Both writes are fail-soft — observability must never be able to break the
// tick, and a run-log table that is missing (migration not yet applied) simply
// costs a log line.
// ---------------------------------------------------------------------------
const RUN_LOG = 'lcc_ownership_chain_draft_run_log';

async function openRunLog(row) {
  try {
    const r = await opsQuery('POST', RUN_LOG, row, { headers: { Prefer: 'return=representation' } });
    if (!r.ok) { console.error('[ownership-chain-draft-tick] run-log open failed', r.status, r.data); return null; }
    const rec = Array.isArray(r.data) ? r.data[0] : r.data;
    return rec?.run_id ?? null;
  } catch (e) {
    console.error('[ownership-chain-draft-tick] run-log open threw', String(e?.message || e));
    return null;
  }
}

// Close the row opened at entry. If the OPEN failed (runId null) the outcome is
// still persisted, as a fresh row, rather than losing the run entirely.
async function closeRunLog(runId, row) {
  try {
    if (runId == null) { await openRunLog(row); return; }
    const r = await opsQuery('PATCH', `${RUN_LOG}?run_id=eq.${encodeURIComponent(runId)}`,
      row, { headers: { Prefer: 'return=minimal' } });
    if (r && r.ok === false) console.error('[ownership-chain-draft-tick] run-log close failed', r.status, r.data);
  } catch (e) {
    console.error('[ownership-chain-draft-tick] run-log close threw', String(e?.message || e));
  }
}

// Group by domain so each domain DB is queried once, then attach each task's
// transitions + current-owner context. Shared by the write path (which prepares
// the UNDRAFTED slice) and the P140 grade path (which deliberately does not —
// see the note at the grade branch).
async function prepareTasks(tasks, scanErrors) {
  const byDomain = new Map();
  for (const t of tasks) {
    const d = OCD.normDomain(t.domain);
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(t);
  }
  const prepared = [];
  for (const [domain, group] of byDomain) {
    const ids = group.map((t) => t.source_record_id).filter(Boolean);
    const { byProp, errors, truncated } = await fetchTransitionsFor(domain, ids);
    if (errors.length) scanErrors.push(...errors);
    if (truncated) scanErrors.push(`transitions_page_cap_hit:${domain}`);
    const ctxMap = await fetchChainContext(domain, ids);
    for (const t of group) {
      prepared.push({
        task: t,
        transitions: byProp.get(String(t.source_record_id)) || [],
        ctx: ctxMap.get(String(t.source_record_id)) || {},
      });
    }
  }
  return prepared;
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

  // P133 — the row goes in BEFORE the work, so a run that dies mid-flight leaves
  // a 'started' row instead of nothing. GET is a dry run and is not logged.
  const isApply = req.method === 'POST';
  const startedMs = Date.now();
  const triggerSource = String(req.body?.trigger_source || req.query.trigger_source || 'api').slice(0, 32);
  const runLogId = isApply
    ? await openRunLog({
      status: 'started', trigger_source: triggerSource,
      flag_enabled: enabled, role_labels_enabled: roleLabels, batch_limit: limit,
    })
    : null;

  const scanErrors = [];
  // A4 re-open runs FIRST: a property whose gov records landed must be back in
  // the lane before this run reads it, or it waits a whole extra night.
  const a4Reopen = await runA4ReopenPass(isApply, scanErrors);
  // A4b runs after the re-open and BEFORE the existing-draft read, so a task
  // whose guard verdict is now stale is re-drafted by this same run.
  const a4bRedraft = await runA4bRedraftPass(isApply, scanErrors);
  // A2b runs last of the three, for the same reason: a task whose repeat-pair
  // draft is now stale must be re-drafted by THIS run, not the next one.
  const a2bRedraft = await runA2bRedraftPass(isApply, scanErrors);
  // B5 runs last of the four, for the same reason the other three run early: a
  // task whose draft predates newly-landed transitions must be re-drafted by
  // THIS run, not left holding a shallower chain until something else touches it.
  const b5Redraft = await runB5RedraftPass(isApply, scanErrors);
  const existing = await fetchExistingDrafts();
  const laneScanLimit = Math.max(limit, 600);
  const openRows = await fetchOpenLaneRows(laneScanLimit);
  // The open-lane read is itself bounded, so when it comes back full the backlog
  // we report is a FLOOR, not a total. Say so rather than implying we saw it all.
  const laneScanCapped = openRows.length >= laneScanLimit;
  if (laneScanCapped) scanErrors.push(`lane_scan_capped:${laneScanLimit}`);
  const fresh = openRows.filter((t) => !existing.has(OCD.ocdSubjectRef(t.domain, t.source_record_id)));

  const prepared = await prepareTasks(fresh, scanErrors);

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
      a4_reopen: a4Reopen, a4b_redraft: a4bRedraft, a2b_redraft: a2bRedraft, b5_redraft: b5Redraft, open_lane_rows: openRows.length, already_drafted: existing.size, fresh: fresh.length,
      lane_scan_capped: laneScanCapped,
      counts, scan_errors: scanErrors,
      note: 'Annotation-only, NO writes in dry-run. The chain is assembled DETERMINISTICALLY from '
        + 'gov.ownership_history via v_ownership_transitions_portfolio (P138 guards re-applied); the '
        + 'citation is a record reference, not a model quote. A gap in the chain is reported, never '
        + 'bridged. Confirming a draft stays a HUMAN action on the P179 capture path. '
        + 'Add ?role_labels=1&generate=1 to grade the optional Layer-2 role-labeller (still no writes, '
        + 'flag not required, flag not changed).',
    };
    // ---- P140 Layer-2 role-label GRADE (ungated, still no writes) ---------
    const wantGenerate = truthy(req.query.generate);
    const forceRoleLabels = truthy(req.query.role_labels);
    const gradeMode = wantGenerate && (forceRoleLabels || roleLabels);
    if (wantGenerate && !gradeMode) {
      // `generate=1` with the flag off and no `role_labels=1` is a request that
      // cannot be honoured silently — say which knob is missing rather than
      // returning a dry run that looks like it ran the model.
      out.generate_skipped = `role_labels_off: pass role_labels=1 to grade Layer 2 while ${ROLE_LABEL_FLAG} is off`;
    }
    if (gradeMode) {
      const want = intParam(req.query.sample, GRADE_SAMPLE_DEFAULT, GRADE_SAMPLE_MAX);

      // ⚠️ THE GRADE DOES NOT READ `prepared`, AND THAT IS THE WHOLE POINT.
      // `prepared` covers only the UNDRAFTED (`fresh`) slice, because that is
      // what the write path needs. Measured live 2026-08-26: all 545 open lane
      // rows already carry a draft (P131/P133 drained the lane in one pass), so
      // `fresh` is 0 and a grade wired to `prepared` would have returned
      // `sample_taken: 0` — an empty grade block that renders exactly like a
      // clean one. Layer 2 labels a chain that ALREADY EXISTS, so an
      // already-drafted row is the ideal candidate, not an excluded one.
      const gradeErrors = [];
      const gradePool = await prepareTasks(openRows.slice(0, GRADE_LANE_SCAN), gradeErrors);

      // Candidates are the DRAFTABLE rows only — a row with no chain has no link
      // to label, and sending it would grade the model on a question it was never
      // asked (and burn an on-box call to hear "no transfers").
      const candidates = [];
      for (const p of gradePool) {
        const d = OCD.buildChainDraft(p.transitions, p.ctx);
        if (!d.draftable) continue;
        candidates.push({ ...p, shape: OCD.classifyChainShape(d) });
      }
      const chosen = OCD.pickGradeSample(candidates, want);
      const { results, budget_stopped } = await runGradePool(
        chosen, GRADE_CONCURRENCY, Date.now() + GRADE_BUDGET_MS);
      // Restore the deterministic pick order (the pool finishes out of order, and
      // a grader reading a shape-spread sample should see it spread).
      const order = new Map(chosen.map((c, i) => [OCD.ocdSubjectRef(c.task.domain, c.task.source_record_id), i]));
      results.sort((a, b) => (order.get(a.subject_ref) ?? 0) - (order.get(b.subject_ref) ?? 0));

      out.role_label_grade = {
        mode: 'dry_run_grade',
        written: false,
        flag: {
          name: ROLE_LABEL_FLAG, enabled: roleLabels,
          registry_state: roleFlag?.state || 'missing',
          // Say plainly that the grade ran with the flag off, so nobody reads a
          // populated grade block as evidence the layer is live.
          forced_by_query: forceRoleLabels && !roleLabels,
        },
        // Named so nobody re-derives the grade from the write path's slice and
        // silently grades nothing once the lane is drafted.
        candidate_source: 'open_lane_including_already_drafted',
        lane_rows_scanned: Math.min(openRows.length, GRADE_LANE_SCAN),
        lane_scan_cap: GRADE_LANE_SCAN,
        draftable_candidates: candidates.length,
        not_draftable_skipped: gradePool.length - candidates.length,
        sample_requested: want,
        sample_taken: results.length,
        budget_stopped,
        scan_errors: gradeErrors,
        shape_buckets: candidates.reduce((m, c) => { m[c.shape] = (m[c.shape] || 0) + 1; return m; }, {}),
        summary: summariseGrade(results),
        samples: results,
        how_to_read: 'A DROP is the guard working, not the run failing — W8 U3 dropped ~52% of its '
          + 'proposals on this same gap and that rate was the finding. Read `party_presence_fail_rate` '
          + 'for the hallucinated-rationale cases specifically, `chains_altered_by_layer2` (must be 0 — '
          + 'it is measured by re-running the real applier over a copy and comparing chain fingerprints), '
          + 'and `providers` to confirm the on-box model answered rather than the cloud fallback. '
          + 'Grade the surviving labels against each link\u2019s own facts: an affiliate/SPE reshuffle must '
          + 'not read as an arms-length sale, and a $0/nominal transfer must not read as arms-length. '
          + 'NOTHING was written and the flag was not changed.',
      };
    }

    // `sample` doubles as the grade's size knob, so the deterministic sample
    // block is suppressed in grade mode — the grade already carries each
    // sampled chain in full, and rendering both would be one payload showing
    // two different slices of the lane under one name.
    const n = intParam(req.query.sample, 0, 25);
    if (n && !gradeMode) {
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
    // The cron is deliberately NOT gated on the flag, so this path is reachable
    // nightly. Record it: a fired-and-skipped run must be visible, or "flag off"
    // and "cron never fired" look identical on every surface.
    await closeRunLog(runLogId, {
      status: 'completed', ok: true,
      finished_at: new Date().toISOString(), duration_ms: Date.now() - startedMs,
      a4_reopen: a4Reopen, a4b_redraft: a4bRedraft, a2b_redraft: a2bRedraft, b5_redraft: b5Redraft, open_lane_rows: openRows.length, already_drafted: existing.size, fresh: fresh.length,
      written_draftable: 0, written_insufficient: 0, failed_writes: 0,
      backlog_remaining: fresh.length, capped: fresh.length > 0,
      budget_stopped: false, lane_scan_capped: laneScanCapped,
      error_count: scanErrors.length,
      detail: { skipped: 'feature_flag_off', counts, scan_errors: scanErrors },
      ...(runLogId == null
        ? { trigger_source: triggerSource, flag_enabled: false, role_labels_enabled: roleLabels, batch_limit: limit }
        : {}),
    });
    return res.status(200).json({ ok: true, skipped: 'feature_flag_off', enabled: false,
      lane: LANE_TYPE, a4_reopen: a4Reopen, a4b_redraft: a4bRedraft, a2b_redraft: a2bRedraft, b5_redraft: b5Redraft, open_lane_rows: openRows.length, fresh: fresh.length,
      lane_scan_capped: laneScanCapped, counts });
  }

  const sourceRunId = 'p131_' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
    + '_' + randomUUID().slice(0, 8);
  const summary = { source_run_id: sourceRunId, lane: LANE_TYPE, enabled: true,
    role_labels_enabled: roleLabels, a4_reopen: a4Reopen, a4b_redraft: a4bRedraft, a2b_redraft: a2bRedraft, b5_redraft: b5Redraft, open_lane_rows: openRows.length,
    already_drafted: existing.size, fresh: fresh.length,
    written_draftable: 0, written_insufficient: 0, failed: 0,
    role_labels_applied: 0, role_labels_dropped: 0,
    backlog_remaining: 0, capped: false, lane_scan_capped: laneScanCapped,
    budget_stopped: false, run_log_id: runLogId, counts, scan_errors: scanErrors };

  const start = Date.now();
  try {
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
  } catch (e) {
    // Close the row as FAILED rather than leaving it at 'started' (which means
    // "never came back"), then let withErrorHandler own the HTTP response.
    await closeRunLog(runLogId, {
      status: 'failed', ok: false,
      finished_at: new Date().toISOString(), duration_ms: Date.now() - startedMs,
      source_run_id: sourceRunId,
      a4_reopen: a4Reopen, a4b_redraft: a4bRedraft, a2b_redraft: a2bRedraft, b5_redraft: b5Redraft, open_lane_rows: openRows.length, already_drafted: existing.size, fresh: fresh.length,
      written_draftable: summary.written_draftable,
      written_insufficient: summary.written_insufficient,
      failed_writes: summary.failed,
      backlog_remaining: Math.max(0, fresh.length - summary.written_draftable - summary.written_insufficient),
      capped: true, budget_stopped: summary.budget_stopped, lane_scan_capped: laneScanCapped,
      error_count: scanErrors.length + 1,
      detail: { error: String(e?.message || e).slice(0, 400), counts, scan_errors: scanErrors.slice(0, 50) },
    });
    throw e;
  }

  // Honest caps. The tick writes at most `limit` rows a night by design, so a
  // run that leaves fresh rows undrafted is NOT "done" — it is a night that
  // finished its batch. The next run resumes (already-drafted subject_refs are
  // skipped), so a backlog drains rather than stalling; it just must not read
  // as completion. Judge the run by written_draftable, never by already_drafted
  // — that is a re-discovery tally and reads like throughput while nothing moves.
  const writtenTotal = summary.written_draftable + summary.written_insufficient;
  summary.backlog_remaining = Math.max(0, fresh.length - writtenTotal);
  summary.capped = summary.backlog_remaining > 0;

  summary.note = 'Drafts written to lcc_clean_assist_proposals (source ownership_chain_draft). '
    + 'NOTHING was written to the ownership graph and no research task was closed — a human '
    + 'confirms each draft on the P179 capture path. Reverse: delete from '
    + "lcc_clean_assist_proposals where source='ownership_chain_draft'."
    + (summary.capped
      ? ` NOT done: ${summary.backlog_remaining} fresh lane row(s) still undrafted`
        + `${laneScanCapped ? ' (a floor — the open-lane scan was itself capped)' : ''}`
        + '; the next scheduled run continues.'
      : ' Lane fully drafted as of this run.');

  await closeRunLog(runLogId, {
    status: 'completed', ok: summary.failed === 0,
    finished_at: new Date().toISOString(), duration_ms: Date.now() - startedMs,
    source_run_id: sourceRunId,
    a4_reopen: a4Reopen, a4b_redraft: a4bRedraft, a2b_redraft: a2bRedraft, b5_redraft: b5Redraft, open_lane_rows: openRows.length, already_drafted: existing.size, fresh: fresh.length,
    written_draftable: summary.written_draftable,
    written_insufficient: summary.written_insufficient,
    failed_writes: summary.failed,
    backlog_remaining: summary.backlog_remaining,
    capped: summary.capped, budget_stopped: summary.budget_stopped,
    lane_scan_capped: laneScanCapped,
    error_count: scanErrors.length,
    detail: {
      counts,
      role_labels_applied: summary.role_labels_applied,
      role_labels_dropped: summary.role_labels_dropped,
      scan_errors: scanErrors.slice(0, 50),
    },
    ...(runLogId == null
      ? { trigger_source: triggerSource, flag_enabled: true, role_labels_enabled: roleLabels, batch_limit: limit }
      : {}),
  });

  return res.status(200).json(summary);
}

export default handleOwnershipChainDraftTick;
