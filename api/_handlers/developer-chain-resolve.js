// api/_handlers/developer-chain-resolve.js
// ============================================================================
// UW#7 — developer resolution from the ownership chain (worker)
// ----------------------------------------------------------------------------
// Closes the R6/R8 `trace_ownership_to_developer` research tasks (1,252 queued;
// 764 gov) by RESOLVING the original developer from the ownership chain — the
// chain-to-developer doctrine's payoff. Receipts-first, conservative, never
// fabricate.
//
//   GET  → dry-run: reproduce the HONEST sizing (per-bucket counts over the WHOLE
//          queued set) — what WOULD resolve vs defer vs is-not-a-developer. NO writes.
//   POST → drain: a capped (`limit`, default 25) + wall-clock-budgeted batch.
//
// Why a gov-side view (v_developer_chain_candidate) drives this: the LCC
// chain-completeness view reads the owner-facts MIRROR, so its
// "earliest_known_owner" is the current true owner, not the genuine first owner.
// The authoritative chain lives in gov.ownership_history; the gov view walks it
// and hands us {earliest_owner, owner_links, is_build_to_suit, cur_true_owner_name,
// current_developer}. This worker does the developer-vs-not JUDGMENT (reusing the
// shared entity guards) and the writes.
//
// Resolution tiers (only these auto-write; everything else stays queued, honest):
//   A  bts_origin       is_build_to_suit -> the original owner IS the developer by
//                        construction (confidence 0.85) — the strongest, safest signal.
//   B  developer_keyword the origin name carries an explicit development cue
//                        ("Development"/"Construction"/"Builders"/... or a known
//                        developer brand) at a genuine multi-link chain origin (0.7).
//
// Deferred / not-resolved (stays QUEUED — UW#6 deed deep-parse or human research,
// re-attempted on a cadence via the metadata guard, never re-hammered):
//   no_chain               owner_links<=1 -> nothing to trace (UW#6 extends the chain first)
//   origin_equals_current  earliest == current true owner -> no real trace
//   origin_not_developer   bank/lender/REIT/insurer/agency at origin -> an acquisition/
//                          foreclosure, genuinely NOT a developer
//   ambiguous_generic_org  a generic "Associates/Partners/Holdings/LLC" origin we can't
//                          honestly call a developer without UW#6 / a human
//
// Writes (resolved only): gov.properties.developer (fill-blanks, provenance-gated
// source='chain_resolution'), an LCC `organization` developer entity (BD spine,
// deduped by name so a repeat developer = ONE relationship), a best-effort
// developer->asset `developed` edge, and the task -> 'completed'. Reversible,
// idempotent (re-run resolves 0), conservative. dia is a documented follow-up:
// dia.properties has no is_build_to_suit and its ownership_history is
// owner_id/start_date-shaped with operator-dominated true_owners — the developer
// signal is thin (gov is the volume).
// ============================================================================

import crypto from 'node:crypto';
import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import {
  ensureEntityLink,
  isJunkEntityName,
} from '../_shared/entity-link.js';
import { shouldWriteField } from '../_shared/field-priority-guard.js';

const WALL_CLOCK_MS = 20000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
// A not-resolved task stays QUEUED but isn't re-classified every tick — re-attempt
// no sooner than this (UW#6 may have extended its chain in the meantime).
const REATTEMPT_DAYS = 7;
const VIEW_CHUNK = 150;

const VIEW_COLS =
  'property_id,is_build_to_suit,current_developer,cur_true_owner_name,owner_links,earliest_owner,earliest_start';

// --- developer-vs-not classification regexes (the JS judgment) ---------------
// Reject classes: the origin is genuinely NOT a developer.
const BANK_LENDER_RE =
  /\b(bank|banc|national association|wells fargo|fannie mae|freddie mac|fnma|fhlmc|mortgage|savings|credit union|jpmorgan|citibank|u\.?s\.? bank|trust company|lender|insurance)\b/i;
const REIT_TRUST_RE =
  /\b(properties trust|realty trust|income trust|realty income|reit|real estate investment trust)\b/i;
const FEDERAL_AGENCY_RE =
  /\b(united states|u\.?\s?s\.?\s?a\.?|general services|federal government|department of)\b/i;
// Capture-junk shapes a real owner name never carries ($ amounts, CMBS codes,
// CoStar attribution leakage).
const JUNK_SHAPE_RE = /[$]|\(\$|\bapprox\b|\bcmbs\b|\bbbcms\b|\balloc(?:'d|ated)?\b|private\/other/i;
// Placeholder / role-only "owner" strings the chain carries when the real owner
// is unknown ("Previous Owner", "Seller", "Various", "Unknown") — NOT a developer
// name. Must be rejected even on the BTS-by-construction path. Anchored ^...$ so a
// real name containing a role word ("Chandler Property", "Mermelstein Development")
// is NOT caught.
const PLACEHOLDER_OWNER_RE =
  /^(previous|prior|current|former|original|new|unknown|undisclosed|various|multiple|the)?\s*(owner|owners|seller|sellers|buyer|grantor|grantee|landlord|lessor|lessee|borrower|trustee|n\/?a|na|tbd|none|undisclosed|unknown|various|other|private)\.?$/i;

// Accept classes: an explicit development entity at the chain origin.
const DEV_KEYWORD_RE =
  /\b(development|developers|develpment|construction|builders|homebuilders|home builders|communities)\b/i;
// A small, curated list of unambiguous developer brands seen at gov chain origins.
const DEV_BRAND_RE =
  /\b(ryan compan|opus group|hines|trammell|panattoni|duke realty|liberty property|seefried|gilbane|boyer compan|ambrose property|acquest|founders properties|benderson|griffin partners|highwoods|conor commercial)\b/i;

/** Trim + collapse whitespace + strip trailing separators. Stores what the
 *  county record says (no fabrication / re-casing). */
export function cleanDeveloperName(raw) {
  if (raw == null) return '';
  return String(raw).replace(/\s+/g, ' ').replace(/[\s,.;:–-]+$/, '').trim();
}

/**
 * Pure classifier. Given the gov-view chain facts for ONE property, decide whether
 * its chain origin is a developer we can honestly write.
 * @returns {{resolve:boolean, tier?:string, confidence?:number, developer_name?:string, reason:string}}
 */
export function classifyDeveloperOrigin(candidate) {
  const c = candidate || {};
  const curDev = cleanDeveloperName(c.current_developer);
  if (curDev) return { resolve: false, reason: 'already_resolved' };

  const origin = cleanDeveloperName(c.earliest_owner);
  const links = Number(c.owner_links || 0);
  if (!origin || links <= 1) return { resolve: false, reason: 'no_chain' };

  const curOwner = cleanDeveloperName(c.cur_true_owner_name);
  if (curOwner && origin.toLowerCase() === curOwner.toLowerCase()) {
    return { resolve: false, reason: 'origin_equals_current' };
  }

  // Shared entity guard (defense in depth — the same guard ensureEntityLink
  // applies at the mint boundary). Structural garbage (embedded phone/email/
  // panel-header bleed) is never a developer. Federal/agency names are caught by
  // FEDERAL_AGENCY_RE below (origin_not_developer).
  if (isJunkEntityName(origin) || PLACEHOLDER_OWNER_RE.test(origin)) {
    return { resolve: false, reason: 'guard_rejected' };
  }

  if (BANK_LENDER_RE.test(origin) || REIT_TRUST_RE.test(origin) ||
      FEDERAL_AGENCY_RE.test(origin) || JUNK_SHAPE_RE.test(origin)) {
    return { resolve: false, reason: 'origin_not_developer' };
  }

  // Tier A — build-to-suit: the original owner IS the developer by construction.
  if (c.is_build_to_suit === true) {
    return { resolve: true, tier: 'bts_origin', confidence: 0.85, developer_name: origin, reason: 'bts_origin' };
  }

  // Tier B — explicit development entity at a genuine chain origin.
  if (DEV_KEYWORD_RE.test(origin) || DEV_BRAND_RE.test(origin)) {
    return { resolve: true, tier: 'developer_keyword', confidence: 0.7, developer_name: origin, reason: 'developer_keyword' };
  }

  // A generic org we cannot honestly call a developer — leave for UW#6 / a human.
  return { resolve: false, reason: 'ambiguous_generic_org' };
}

// ---------------------------------------------------------------------------
// Per-row processor (deps-injected for unit testing).
// deps: { ensureEntityLink, shouldWriteField, domainQuery, opsQuery, runId, now }
// ---------------------------------------------------------------------------
export async function processChainResolveRow(task, candidate, deps) {
  const propertyId = String(task.source_record_id);
  const cls = classifyDeveloperOrigin(candidate);
  if (!cls.resolve) {
    return { property_id: propertyId, outcome: 'not_resolved', reason: cls.reason };
  }

  const developerName = cls.developer_name;

  // 1) BD spine: mint/dedupe the developer as an LCC organization entity. Deduped
  //    by canonical_name + domain (no novel external_identities source — the R15
  //    CRE pattern), so a repeat developer across properties = ONE entity. The
  //    same junk/implausible guards apply; a rejected name aborts the write too.
  const link = await deps.ensureEntityLink({
    workspaceId: task.workspace_id,
    sourceType: 'developer',
    domain: 'gov',
    seedFields: { name: developerName, org_type: 'developer', domain: 'gov' },
    metadata: { via: 'developer_chain_resolve', source_property_id: propertyId, tier: cls.tier },
  });
  if (!link || !link.ok) {
    return { property_id: propertyId, outcome: 'not_resolved', reason: 'entity_guard_rejected', detail: link?.skipped };
  }
  const developerEntityId = link.entityId;

  // 2) Provenance gate (records to LCC field_provenance, source='chain_resolution').
  const gate = await deps.shouldWriteField({
    targetDb: 'gov_db',
    targetTable: 'gov.properties',
    recordPk: propertyId,
    fieldName: 'developer',
    value: developerName,
    source: 'chain_resolution',
    sourceRunId: deps.runId,
    confidence: cls.confidence,
  });
  if (!gate.write) {
    return { property_id: propertyId, outcome: 'blocked_by_provenance', reason: gate.reason, developer_entity_id: developerEntityId };
  }

  // 3) Write the developer name — FILL-BLANKS at the DB (developer IS NULL), so a
  //    curated value is never clobbered and a concurrent write is a no-op.
  const patch = await deps.domainQuery(
    'government', 'PATCH',
    `properties?property_id=eq.${encodeURIComponent(propertyId)}&developer=is.null`,
    { developer: developerName },
  );
  if (!patch.ok) {
    return { property_id: propertyId, outcome: 'write_failed', reason: `gov PATCH ${patch.status}`, developer_entity_id: developerEntityId };
  }
  const wrote = Array.isArray(patch.data) ? patch.data.length > 0 : !!patch.data;
  if (!wrote) {
    // Row already had a developer (filled between fetch and write). Treat as
    // resolved-elsewhere; close the task honestly.
    await completeTask(task, { developer: developerName, developer_entity_id: developerEntityId, tier: cls.tier, confidence: cls.confidence, note: 'already_filled' }, deps);
    return { property_id: propertyId, outcome: 'already_resolved', developer: developerName };
  }

  // 4) Best-effort BD edge: developer --developed--> property asset entity, so the
  //    developer surfaces in the entity graph. No asset entity? skip (R15 posture:
  //    a bare developer entity is fine; it earns queue surfacing later).
  let edge = false;
  try {
    edge = await linkDeveloperToAsset(developerEntityId, task, deps);
  } catch (_e) { /* never fail the resolution on the edge */ }

  // 5) Close the task — ONLY now that a developer is actually written.
  await completeTask(task, { developer: developerName, developer_entity_id: developerEntityId, tier: cls.tier, confidence: cls.confidence, edge }, deps);

  return { property_id: propertyId, outcome: 'resolved', developer: developerName, tier: cls.tier, developer_entity_id: developerEntityId, edge };
}

async function completeTask(task, outcome, deps) {
  await deps.opsQuery('PATCH', `research_tasks?id=eq.${task.id}`, {
    status: 'completed',
    completed_at: deps.now,
    outcome: { source: 'chain_resolution', resolved_at: deps.now, ...outcome },
  });
}

// Stamp a not-resolved task so it isn't re-classified every tick — but stays
// QUEUED (honest; UW#6 may extend its chain). Merges into existing metadata.
async function markAttempted(task, reason, deps) {
  const meta = { ...(task.metadata || {}), chain_resolve: { attempted_at: deps.now, reason, run_id: deps.runId } };
  await deps.opsQuery('PATCH', `research_tasks?id=eq.${task.id}`, { metadata: meta });
}

async function linkDeveloperToAsset(developerEntityId, task, deps) {
  const propertyId = String(task.source_record_id);
  // Resolve the property's asset entity (gov, asset, <property_id>).
  const r = await deps.opsQuery('GET',
    `external_identities?source_system=eq.gov&source_type=eq.asset&external_id=eq.${encodeURIComponent(propertyId)}&select=entity_id&limit=1`);
  const assetEntityId = r.ok && Array.isArray(r.data) && r.data[0]?.entity_id;
  if (!assetEntityId || assetEntityId === developerEntityId) return false;

  // Dedup-guard: one developed edge per (developer, asset).
  const ex = await deps.opsQuery('GET',
    `entity_relationships?from_entity_id=eq.${developerEntityId}&to_entity_id=eq.${assetEntityId}&relationship_type=eq.developed&select=id&limit=1`);
  if (ex.ok && Array.isArray(ex.data) && ex.data.length) return true;

  const ins = await deps.opsQuery('POST', 'entity_relationships', {
    workspace_id: task.workspace_id,
    from_entity_id: developerEntityId,
    to_entity_id: assetEntityId,
    relationship_type: 'developed',
    metadata: { via: 'developer_chain_resolve', source_property_id: propertyId },
  });
  return ins.ok;
}

// ---------------------------------------------------------------------------
// Read the gov chain-candidate view for a set of property ids (chunked).
// ---------------------------------------------------------------------------
async function readCandidates(propertyIds) {
  const byId = new Map();
  for (let i = 0; i < propertyIds.length; i += VIEW_CHUNK) {
    const chunk = propertyIds.slice(i, i + VIEW_CHUNK);
    const inList = chunk.map((x) => encodeURIComponent(x)).join(',');
    const r = await domainQuery('government', 'GET',
      `v_developer_chain_candidate?property_id=in.(${inList})&select=${VIEW_COLS}`);
    if (r.ok && Array.isArray(r.data)) {
      for (const row of r.data) byId.set(String(row.property_id), row);
    }
  }
  return byId;
}

function tally(tasks, byId) {
  const buckets = {
    resolved_bts_origin: 0,
    resolved_developer_keyword: 0,
    ambiguous_generic_org: 0,
    origin_not_developer: 0,
    origin_equals_current: 0,
    no_chain: 0,
    guard_rejected: 0,
    already_resolved: 0,
  };
  const sample = [];
  for (const t of tasks) {
    const cand = byId.get(String(t.source_record_id));
    const cls = classifyDeveloperOrigin(cand);
    const key = cls.resolve ? `resolved_${cls.tier}` : cls.reason;
    if (key in buckets) buckets[key] += 1;
    if (cls.resolve && sample.length < 15) {
      sample.push({ property_id: String(t.source_record_id), developer: cls.developer_name, tier: cls.tier, confidence: cls.confidence });
    }
  }
  const resolvable = buckets.resolved_bts_origin + buckets.resolved_developer_keyword;
  return { buckets, resolvable, sample };
}

// ---------------------------------------------------------------------------
// Handler.
// ---------------------------------------------------------------------------
export async function handleDeveloperChainResolveTick(req, res) {
  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error || 'unauthorized' });

  const domain = String(req.query.domain || 'gov').toLowerCase();
  if (domain !== 'gov') {
    // dia is a documented follow-up (no is_build_to_suit; owner-id chain shape).
    return res.status(200).json({ ok: true, domain, note: 'UW#7 resolves gov only; dia chain support deferred', resolved: 0 });
  }

  const dryRun = req.method === 'GET';
  const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);

  // All queued gov tasks (small — ~764). Lightweight columns.
  const q = await opsQuery('GET',
    'research_tasks?research_type=eq.trace_ownership_to_developer&status=eq.queued&domain=eq.gov'
    + '&select=id,source_record_id,entity_id,workspace_id,metadata,priority&order=priority.desc&limit=2000');
  if (!q.ok) return res.status(q.status || 500).json({ error: 'task_load_failed', detail: q.data });
  const allTasks = Array.isArray(q.data) ? q.data : [];

  if (dryRun) {
    // Reproduce the honest sizing over the WHOLE queued set (read the view for all).
    const ids = allTasks.map((t) => String(t.source_record_id));
    const byId = await readCandidates(ids);
    const { buckets, resolvable, sample } = tally(allTasks, byId);
    return res.status(200).json({
      ok: true, dry_run: true, domain: 'gov',
      total_queued: allTasks.length,
      resolvable,
      by_bucket: buckets,
      sample,
      note: 'resolvable = bts_origin + developer_keyword; everything else stays queued (honest).',
    });
  }

  // DRAIN — capped + budgeted. Skip tasks re-attempted within REATTEMPT_DAYS so
  // the unresolvable backlog isn't re-hammered; never-attempted go first.
  const cutoff = Date.now() - REATTEMPT_DAYS * 24 * 3600 * 1000;
  const eligible = allTasks
    .filter((t) => {
      const at = t.metadata?.chain_resolve?.attempted_at;
      return !at || new Date(at).getTime() < cutoff;
    })
    .sort((a, b) => {
      const aa = a.metadata?.chain_resolve?.attempted_at ? new Date(a.metadata.chain_resolve.attempted_at).getTime() : 0;
      const ba = b.metadata?.chain_resolve?.attempted_at ? new Date(b.metadata.chain_resolve.attempted_at).getTime() : 0;
      if (aa !== ba) return aa - ba;                       // oldest-attempted (0 = never) first
      return (b.priority || 0) - (a.priority || 0);        // then by value
    })
    .slice(0, limit);

  const ids = eligible.map((t) => String(t.source_record_id));
  const byId = await readCandidates(ids);

  const deps = {
    ensureEntityLink, shouldWriteField, domainQuery, opsQuery,
    runId: crypto.randomUUID(),
    now: new Date().toISOString(),
  };

  const started = Date.now();
  const summary = { ok: true, domain: 'gov', processed: 0, resolved: 0, not_resolved: 0, errors: 0, results: [] };
  for (const t of eligible) {
    if (Date.now() - started > WALL_CLOCK_MS) break;
    let out;
    try {
      out = await processChainResolveRow(t, byId.get(String(t.source_record_id)), deps);
    } catch (e) {
      summary.errors += 1;
      summary.results.push({ property_id: String(t.source_record_id), outcome: 'error', error: String(e?.message || e) });
      continue;
    }
    summary.processed += 1;
    if (out.outcome === 'resolved' || out.outcome === 'already_resolved') summary.resolved += 1;
    else {
      summary.not_resolved += 1;
      // Keep the task QUEUED (honest) but stamp it so it isn't re-classified every tick.
      try { await markAttempted(t, out.reason || out.outcome, deps); } catch (_e) { /* soft */ }
    }
    summary.results.push(out);
  }

  return res.status(200).json(summary);
}
