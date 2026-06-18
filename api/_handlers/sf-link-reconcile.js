// api/_handlers/sf-link-reconcile.js
// ============================================================================
// CONNECTIVITY #3 — reconcile the two Salesforce link stores
// ----------------------------------------------------------------------------
// The domain DBs already know ~768 owner→Salesforce ACCOUNT links the BD graph
// can't see, because the link lives on `true_owners` (dia salesforce_id / gov
// sf_account_id) but was never mirrored onto the bridged LCC owner entity. This
// worker makes the two stores agree — one canonical, BD-actionable SF Account
// link per owner — by walking each domain's Account-id true_owners, resolving
// the bridged owner entity, and:
//
//   Unit 1 — ATTACH  the SF Account identity onto the owner entity (via the
//            canonical writer ensureEntityLink) when the entity has none AND
//            the id isn't already on a different entity. The win: bridged
//            owners become routable BD targets. Reversible via the batch tag in
//            external_identities.metadata.
//   Unit 1 — COLLISION (same id already on a DIFFERENT entity) → surface as an
//            sf_link_collision decision (same owner, two entities → merge),
//            NEVER a second link, NEVER a blind merge.
//   Unit 2 — CONFLICT (the entity already has a DIFFERENT SF Account link) →
//            surface as an sf_link_conflict decision, NEVER auto-overwrite.
//   Unit 3 — DUP-SFID (one SF id on >1 domain owner → distinct entities) →
//            surface as an sf_link_collision decision (same SF account = same
//            owner → merge). Surface, don't auto-merge.
//   Unit 3 — dia Contact (003) ids carried in salesforce_id are NOT Account
//            links; they are reported as a data-quality class (count only) and
//            deferred — never forced into the Account store.
//
//   GET  → dry-run: classify + plan, report counts, write NOTHING.
//   POST → drain: capped (limit) attaches + emitted decisions; reversible.
//
// Reuses (never forks): ensureEntityLink (SF-identity writer + guards), the
// 15↔18 helper (sf-id.js, one place), lcc_open_decision (Decision Center mint),
// and the existing sf_link_* verdict machinery in admin.js.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import { ensureEntityLink } from '../_shared/entity-link.js';
import { sf15, sfIdsMatch, toSf18, classifySfId } from '../_shared/sf-id.js';

// Per-domain config: the column that carries the SF id on true_owners.
const DOMAIN_SF = {
  dia: { sfCol: 'salesforce_id' },
  gov: { sfCol: 'sf_account_id' },
};

// Decision-question copy (stored on the decision so the card reads cleanly).
const Q_CONFLICT = 'This owner entity already has a Salesforce Account link that disagrees with the domain. Which is canonical?';
const Q_COLLISION = 'This Salesforce Account is already on a different entity — same owner, two entities. Merge?';

/**
 * Pull active Account-id true_owners for a domain, with their bridged LCC owner
 * entity resolved. Returns { owners, classCounts } where owners is the Account
 * (001) set tagged with sf15/sf18 + bridge entity_id, and classCounts reports
 * the object-type split (Unit 0).
 */
async function loadDomainOwners(domain) {
  const cfg = DOMAIN_SF[domain];
  const sfCol = cfg.sfCol;
  const dr = await domainQuery(domain, 'GET',
    `true_owners?merged_into_true_owner_id=is.null&${sfCol}=not.is.null`
    + `&select=true_owner_id,name,${sfCol}&limit=2000`);
  if (!dr.ok) return { ok: false, status: dr.status, detail: dr.data };
  const rows = Array.isArray(dr.data) ? dr.data : [];

  const classCounts = { Account: 0, Contact: 0, Lead: 0, Opportunity: 0, User: 0, other: 0, invalid: 0 };
  const owners = [];
  for (const r of rows) {
    const raw = r[sfCol];
    const cls = classifySfId(raw);
    classCounts[cls.kind] = (classCounts[cls.kind] || 0) + 1;
    if (cls.kind !== 'Account') continue;     // ONLY Account ids reconcile here
    owners.push({
      true_owner_id: String(r.true_owner_id),
      name: r.name || null,
      sf_raw: raw,
      sf15: sf15(raw),
      sf18: toSf18(raw),
    });
  }

  // Resolve the bridge: external_identities(domain, true_owner, external_id=true_owner_id)
  const idMap = new Map();   // true_owner_id → entity_id
  const tids = owners.map((o) => o.true_owner_id);
  for (let i = 0; i < tids.length; i += 100) {
    const inList = tids.slice(i, i + 100).map(pgFilterVal).join(',');
    if (!inList) continue;
    const br = await opsQuery('GET', 'external_identities?source_system=eq.' + domain
      + '&source_type=eq.true_owner&external_id=in.(' + inList + ')&select=external_id,entity_id');
    if (br.ok && Array.isArray(br.data)) {
      for (const row of br.data) if (row.external_id && row.entity_id && !idMap.has(row.external_id)) idMap.set(row.external_id, row.entity_id);
    }
  }
  for (const o of owners) o.entity_id = idMap.get(o.true_owner_id) || null;

  return { ok: true, owners, classCounts };
}

/**
 * Decide the per-owner reconciliation outcome. PURE over the resolved maps so
 * it unit-tests without IO.
 *
 * Inputs (all keyed by the values described):
 *   owners        : [{ true_owner_id, name, sf15, sf18, entity_id }]
 *   entityFacts   : Map entity_id → { id, name, workspace_id }
 *   sfByEntity    : Map entity_id → existing SF Account external_id (18-char)
 *   sf18Holders   : Map sf18 → Set(entity_id) holding that SF Account id
 *
 * Returns { attaches, conflicts, collisions, dups, alreadyLinked, unbridged }.
 */
export function planSfLinkReconcile({ domain, owners, entityFacts, sfByEntity, sf18Holders }) {
  const out = { attaches: [], conflicts: [], collisions: [], dups: [], alreadyLinked: 0, unbridged: 0 };

  // Unit 3 — dup-sfid: group Account owners by their 15-char base; a base that
  // resolves to >1 DISTINCT bridged entity means two owners share one SF account
  // (same owner, two entities → merge). Pull those out FIRST so they never enter
  // the per-owner attach pass (the owner is ambiguous — we don't auto-attach).
  const byBase = new Map();
  for (const o of owners) {
    if (!o.sf15) continue;
    if (!byBase.has(o.sf15)) byBase.set(o.sf15, []);
    byBase.get(o.sf15).push(o);
  }
  const dupHandled = new Set();     // entity_ids that are part of a dup group
  for (const [base, grp] of byBase) {
    const entities = [];
    const seen = new Set();
    for (const o of grp) {
      if (o.entity_id && !seen.has(o.entity_id)) { seen.add(o.entity_id); entities.push(o); }
    }
    if (entities.length < 2) continue;   // same owner / one entity — not a dup
    for (const o of entities) dupHandled.add(o.entity_id);
    out.dups.push({
      domain, sf15: base, sf18: entities[0].sf18,
      entities: entities.map((o) => ({
        entity_id: o.entity_id,
        name: (entityFacts.get(o.entity_id) || {}).name || o.name || null,
        true_owner_id: o.true_owner_id,
      })),
      workspace_id: (entityFacts.get(entities[0].entity_id) || {}).workspace_id || null,
    });
  }

  // Per-owner attach / collision / conflict (singletons only). One outcome per
  // bridged entity — two true_owners can bridge to the SAME entity (with the
  // same SF id), and that must attach once, not twice.
  const processedEntities = new Set();
  for (const o of owners) {
    if (!o.entity_id) { out.unbridged++; continue; }
    if (dupHandled.has(o.entity_id)) continue;       // handled as a dup group
    if (processedEntities.has(o.entity_id)) continue; // already decided this entity
    processedEntities.add(o.entity_id);
    const fact = entityFacts.get(o.entity_id) || {};
    const existing = sfByEntity.get(o.entity_id) || null;

    if (existing) {
      if (sfIdsMatch(existing, o.sf18)) { out.alreadyLinked++; continue; }
      out.conflicts.push({
        domain, true_owner_id: o.true_owner_id,
        owner_entity_id: o.entity_id, owner_entity_name: fact.name || o.name || null,
        lcc_sf_id: existing, domain_sf_id: o.sf18, domain_sf_id_15: o.sf15,
        workspace_id: fact.workspace_id || null,
      });
      continue;
    }

    // No SF link on the owner entity. Collision = the id already lives on a
    // DIFFERENT entity.
    const holders = sf18Holders.get(o.sf18);
    let other = null;
    if (holders) for (const h of holders) { if (h !== o.entity_id) { other = h; break; } }
    if (other) {
      const of = entityFacts.get(other) || {};
      out.collisions.push({
        domain, true_owner_id: o.true_owner_id, sf18: o.sf18, sf15: o.sf15,
        owner_entity_id: o.entity_id, owner_entity_name: fact.name || o.name || null,
        other_entity_id: other, other_entity_name: of.name || null,
        workspace_id: fact.workspace_id || of.workspace_id || null,
      });
      continue;
    }

    // Clean attach candidate.
    out.attaches.push({
      domain, true_owner_id: o.true_owner_id, sf18: o.sf18,
      owner_entity_id: o.entity_id, owner_entity_name: fact.name || o.name || null,
      workspace_id: fact.workspace_id || null,
    });
  }
  return out;
}

// Mint a Decision-Center decision (idempotent on subject_ref). Returns the id or null.
async function openDecision({ decisionType, workspaceId, question, context, subjectEntityId, subjectDomain, subjectRef }) {
  const r = await opsQuery('POST', 'rpc/lcc_open_decision', {
    p_decision_type: decisionType, p_workspace_id: workspaceId || null,
    p_question: question || null, p_context: context || {},
    p_subject_entity_id: subjectEntityId || null, p_subject_domain: subjectDomain || null,
    p_subject_property_id: null, p_subject_ref: subjectRef, p_rank_value: null,
  });
  if (!r.ok) return null;
  if (typeof r.data === 'number') return r.data;
  if (Array.isArray(r.data) && r.data[0] != null) {
    const f = r.data[0];
    return (typeof f === 'number') ? f : (f.lcc_open_decision ?? f.id ?? null);
  }
  if (r.data && typeof r.data === 'object') return r.data.lcc_open_decision ?? r.data.id ?? null;
  return null;
}

// ── HTTP entrypoint ─────────────────────────────────────────────────────────
export async function handleSfLinkReconcileTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '25', 10)));
  const decisionLimit = Math.min(2000, Math.max(1, parseInt(req.query.decision_limit || '500', 10)));
  const domains = String(req.query.domain || 'both').toLowerCase() === 'both'
    ? ['dia', 'gov']
    : [String(req.query.domain || '').toLowerCase()].filter((d) => DOMAIN_SF[d]);
  const batchTag = 'sflink_' + new Date().toISOString().slice(0, 10) + '_' + Math.random().toString(36).slice(2, 8);
  const deadline = Date.now() + parseInt(process.env.SF_LINK_RECONCILE_BUDGET_MS || '22000', 10);

  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    batch_tag: dryRun ? null : batchTag,
    by_domain: {},
    totals: { account_ids: 0, contact_ids: 0, bridged: 0, already_linked: 0, unbridged: 0,
      attach_candidates: 0, attached: 0, conflicts: 0, collisions: 0, dups: 0,
      decisions_opened: 0, contact_id_class: 0 },
    items: [],
  };

  let anyAttach = false;

  for (const domain of domains) {
    if (!DOMAIN_SF[domain]) continue;
    const dom = { class_counts: null, bridged: 0, already_linked: 0, unbridged: 0,
      attach_candidates: 0, attached: 0, conflicts: 0, collisions: 0, dups: 0,
      decisions_opened: 0, contact_id_class: 0 };

    const loaded = await loadDomainOwners(domain);
    if (!loaded.ok) { dom.error = loaded.detail || ('load_failed:' + loaded.status); result.by_domain[domain] = dom; continue; }
    dom.class_counts = loaded.classCounts;
    dom.contact_id_class = loaded.classCounts.Contact || 0;     // Unit 3 — reported, deferred
    const owners = loaded.owners;
    dom.bridged = owners.filter((o) => o.entity_id).length;

    // Resolve the LCC facts: entity name/workspace, existing SF Account links,
    // and which entities already hold each candidate sf18 (collision detector).
    const entityIds = Array.from(new Set(owners.filter((o) => o.entity_id).map((o) => o.entity_id)));
    const sf18s = Array.from(new Set(owners.map((o) => o.sf18).filter(Boolean)));
    const entityFacts = new Map();
    const sfByEntity = new Map();
    const sf18Holders = new Map();
    for (let i = 0; i < entityIds.length; i += 100) {
      const inList = entityIds.slice(i, i + 100).map(pgFilterVal).join(',');
      if (!inList) continue;
      const er = await opsQuery('GET', 'entities?id=in.(' + inList + ')&select=id,name,workspace_id');
      if (er.ok && Array.isArray(er.data)) for (const row of er.data) entityFacts.set(row.id, row);
      const sr = await opsQuery('GET', 'external_identities?source_system=eq.salesforce&source_type=eq.Account'
        + '&entity_id=in.(' + inList + ')&select=entity_id,external_id');
      if (sr.ok && Array.isArray(sr.data)) for (const row of sr.data) if (row.entity_id && row.external_id && !sfByEntity.has(row.entity_id)) sfByEntity.set(row.entity_id, row.external_id);
    }
    for (let i = 0; i < sf18s.length; i += 80) {
      const inList = sf18s.slice(i, i + 80).map(pgFilterVal).join(',');
      if (!inList) continue;
      const hr = await opsQuery('GET', 'external_identities?source_system=eq.salesforce&source_type=eq.Account'
        + '&external_id=in.(' + inList + ')&select=entity_id,external_id');
      if (hr.ok && Array.isArray(hr.data)) for (const row of hr.data) {
        if (!row.external_id || !row.entity_id) continue;
        if (!sf18Holders.has(row.external_id)) sf18Holders.set(row.external_id, new Set());
        sf18Holders.get(row.external_id).add(row.entity_id);
      }
    }

    const plan = planSfLinkReconcile({ domain, owners, entityFacts, sfByEntity, sf18Holders });
    dom.already_linked = plan.alreadyLinked;
    dom.unbridged = plan.unbridged;
    dom.attach_candidates = plan.attaches.length;
    dom.conflicts = plan.conflicts.length;
    dom.collisions = plan.collisions.length;
    dom.dups = plan.dups.length;

    if (dryRun) {
      // Sample the planned actions (small) — write nothing.
      plan.attaches.slice(0, 5).forEach((a) => result.items.push({ domain, kind: 'attach', owner_entity_id: a.owner_entity_id, owner: a.owner_entity_name, sf: a.sf18 }));
      plan.conflicts.slice(0, 5).forEach((c) => result.items.push({ domain, kind: 'conflict', owner_entity_id: c.owner_entity_id, owner: c.owner_entity_name, lcc_sf: c.lcc_sf_id, domain_sf: c.domain_sf_id }));
      plan.collisions.slice(0, 5).forEach((c) => result.items.push({ domain, kind: 'collision', owner_entity_id: c.owner_entity_id, owner: c.owner_entity_name, other_entity_id: c.other_entity_id, sf: c.sf18 }));
      plan.dups.slice(0, 5).forEach((d) => result.items.push({ domain, kind: 'dup', sf: d.sf18, entities: d.entities.map((e) => e.entity_id) }));
      result.by_domain[domain] = dom;
      continue;
    }

    // ── Drain — Unit 1 ATTACH (the win), capped + budgeted. ──────────────────
    for (const a of plan.attaches) {
      if (dom.attached >= limit) break;
      if (Date.now() > deadline) { result.budget_stopped = true; break; }
      try {
        const link = await ensureEntityLink({
          workspaceId: a.workspace_id || null, userId: user.id,
          sourceSystem: 'salesforce', sourceType: 'Account', externalId: a.sf18,
          entityId: a.owner_entity_id,
          metadata: { via: 'sf_link_reconcile', batch_tag: batchTag, domain,
            source: 'domain_true_owner', source_true_owner_id: a.true_owner_id, domain_sf_id_15: a.sf18 ? sf15(a.sf18) : null },
        });
        if (link && link.ok) {
          dom.attached++; anyAttach = true;
          result.items.push({ domain, kind: 'attached', owner_entity_id: a.owner_entity_id, owner: a.owner_entity_name, sf: a.sf18 });
        } else {
          result.items.push({ domain, kind: 'attach_failed', owner_entity_id: a.owner_entity_id, detail: (link && (link.error || link.skipped)) || 'unknown' });
        }
      } catch (e) {
        result.items.push({ domain, kind: 'attach_error', owner_entity_id: a.owner_entity_id, detail: String(e && e.message || e) });
      }
    }

    // ── Surface conflicts (Unit 2) + collisions/dups (Unit 1/3). ─────────────
    for (const c of plan.conflicts) {
      if (dom.decisions_opened >= decisionLimit) break;
      if (Date.now() > deadline) { result.budget_stopped = true; break; }
      const id = await openDecision({
        decisionType: 'sf_link_conflict', workspaceId: c.workspace_id, question: Q_CONFLICT,
        subjectEntityId: c.owner_entity_id, subjectDomain: domain,
        subjectRef: 'sfconf:' + c.owner_entity_id,
        context: { kind: 'sf_link_conflict', domain, owner_entity_id: c.owner_entity_id,
          owner_entity_name: c.owner_entity_name, lcc_sf_id: c.lcc_sf_id,
          domain_sf_id: c.domain_sf_id, true_owner_id: c.true_owner_id },
      });
      if (id != null) dom.decisions_opened++;
    }
    for (const c of plan.collisions) {
      if (dom.decisions_opened >= decisionLimit) break;
      if (Date.now() > deadline) { result.budget_stopped = true; break; }
      const id = await openDecision({
        decisionType: 'sf_link_collision', workspaceId: c.workspace_id, question: Q_COLLISION,
        subjectEntityId: c.owner_entity_id, subjectDomain: domain,
        subjectRef: 'sfcoll:' + c.owner_entity_id,
        context: { kind: 'collision', domain, sf_account_id: c.sf18,
          entities: [
            { entity_id: c.owner_entity_id, name: c.owner_entity_name, source: 'domain_owner' },
            { entity_id: c.other_entity_id, name: c.other_entity_name, source: 'sf_linked' },
          ] },
      });
      if (id != null) dom.decisions_opened++;
    }
    for (const d of plan.dups) {
      if (dom.decisions_opened >= decisionLimit) break;
      if (Date.now() > deadline) { result.budget_stopped = true; break; }
      const id = await openDecision({
        decisionType: 'sf_link_collision', workspaceId: d.workspace_id, question: Q_COLLISION,
        subjectEntityId: d.entities[0].entity_id, subjectDomain: domain,
        subjectRef: 'sfdup:' + domain + ':' + d.sf15,
        context: { kind: 'dup_sfid', domain, sf_account_id: d.sf18,
          entities: d.entities.map((e) => ({ entity_id: e.entity_id, name: e.name, source: 'domain_owner' })) },
      });
      if (id != null) dom.decisions_opened++;
    }

    result.by_domain[domain] = dom;
  }

  // Roll up totals.
  for (const d of Object.values(result.by_domain)) {
    const cc = d.class_counts || {};
    result.totals.account_ids += cc.Account || 0;
    result.totals.contact_ids += cc.Contact || 0;
    result.totals.bridged += d.bridged || 0;
    result.totals.already_linked += d.already_linked || 0;
    result.totals.unbridged += d.unbridged || 0;
    result.totals.attach_candidates += d.attach_candidates || 0;
    result.totals.attached += d.attached || 0;
    result.totals.conflicts += d.conflicts || 0;
    result.totals.collisions += d.collisions || 0;
    result.totals.dups += d.dups || 0;
    result.totals.decisions_opened += d.decisions_opened || 0;
    result.totals.contact_id_class += d.contact_id_class || 0;
  }

  // Attaching an SF Account identity makes the owner "connected" (R6) → it can
  // leave P0.4. Refresh the queue cache so that lands within the request.
  if (anyAttach) {
    try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }
  }

  return res.status(200).json(result);
}
