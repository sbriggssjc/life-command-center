// ============================================================================
// P134 — OLLAMA CLEAN-ASSIST context enrichment (read-only IO).
//
// The clean-assist tick reads federated Decision Center lane rows, which carry
// IDENTIFIERS (a representative property id, a provenance id, two entity uuids)
// but not the COMPARATIVE EVIDENCE the judgement needs. This module fills
// `context` with the facts a human would actually look at, in BATCHED reads —
// never one query per card.
//
// Strictly read-only: every call here is a GET. It writes nothing, calls no
// merge/apply RPC, and touches no canonical table. Where evidence genuinely is
// not on file it leaves the field absent and the evidence gate
// (clean-assist-context.js) skips the item rather than paying an Ollama call to
// hear "insufficient evidence".
//
// A failed enrichment read is swallowed to "no evidence" — it must never break
// the tick, and an un-enriched item is skipped, not sent thin.
// ============================================================================

import { opsQuery } from './ops-db.js';
import { domainQuery } from './domain-db.js';

const DOM_LONG = { dia: 'dialysis', gov: 'government', dialysis: 'dialysis', government: 'government' };
const s = (v) => (v == null ? '' : String(v)).trim();
// Sentinel for "this field is absent" inside a value-set comparison — distinct
// from any real value, so "blank everywhere" never reads as "identical".
const NULL_TOKEN = '\u0000null';

function inList(vals) {
  return '(' + vals.map((v) => '"' + String(v).replace(/["\\]/g, '') + '"').join(',') + ')';
}

// ---------------------------------------------------------------------------
// Entry point. Mutates nothing: returns a NEW item list with enriched contexts.
// ---------------------------------------------------------------------------
export async function enrichCleanAssistItems(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return list;
  const by = (t) => list.filter((it) => it && it.decision_type === t);
  const patches = new Map();     // subject_ref -> context patch
  const collect = (m) => { for (const [k, v] of m) patches.set(k, { ...(patches.get(k) || {}), ...v }); };

  const results = await Promise.allSettled([
    enrichPropertyMerge(by('property_merge')),
    enrichProvenanceConflict(by('provenance_conflict')),
    enrichOwnerReconcile(by('owner_reconcile')),
    enrichSfLink(by('sf_link_candidate')),
    enrichIntake(by('intake_disposition')),
  ]);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value instanceof Map) collect(r.value);
    else if (r.status === 'rejected') console.warn('[clean-assist-enrich] lane enrichment failed', r.reason?.message || r.reason);
  }

  return list.map((it) => {
    const patch = patches.get(it.subject_ref);
    return patch ? { ...it, context: { ...(it.context || {}), ...patch } } : it;
  });
}

// ---------------------------------------------------------------------------
// property_merge — resolve the GROUP MEMBERS behind the representative row.
//
// The lane row is a group REPRESENTATIVE; "same building or two co-located
// records?" cannot be answered without the members side by side. The member ids
// come from `v_property_merge_lane.member_property_ids` (P134 migrations) —
// deliberately NOT re-derived here. Measured live 2026-08-26: re-fetching the
// group by (state, whitespace-collapsed address) returned 150 gov properties for
// a group the view says has 2, because the view also excludes archived rows. A
// consumer that re-derives a view's grouping drifts from it; the view is the
// only thing that knows its own predicates.
// ---------------------------------------------------------------------------

const MERGE_FIELDS = {
  dia: 'property_id,address,city,state,zip,tenant,operator,chain_canonical,medicare_id,total_chairs,'
    + 'latitude,longitude,created_at',
  gov: 'property_id,address,city,state,zip,agency,agency_full_name,lease_number,sf_leased,rba,year_built,'
    + 'gross_rent,recorded_owner_id,true_owner_id,created_at',
};

// Fields whose values differ across members are what a human decides on; fields
// that agree are the same-building evidence. Reported separately so the model
// narrates the actual discriminator instead of restating the row. A field absent
// on every member says nothing and is reported as neither.
export function splitMemberFields(members) {
  const differing = [];
  const identical = [];
  const keys = new Set();
  for (const m of members) for (const k of Object.keys(m || {})) keys.add(k);
  for (const k of keys) {
    if (k === 'property_id' || k === 'created_at') continue;
    const vals = new Set(members.map((m) => {
      const v = m ? m[k] : null;
      return v == null || v === '' ? NULL_TOKEN : String(v).toLowerCase().trim();
    }));
    if (vals.size === 1 && vals.has(NULL_TOKEN)) continue;
    if (vals.size === 1) identical.push(k);
    else differing.push(k);
  }
  return { differing_fields: differing.sort(), identical_fields: identical.sort() };
}

async function enrichPropertyMerge(items) {
  const out = new Map();
  if (!items.length) return out;
  for (const dom of ['dia', 'gov']) {
    const group = items.filter((it) => (it.context || {}).domain === dom
      && Array.isArray((it.context || {}).member_property_ids)
      && (it.context || {}).member_property_ids.length >= 2);
    if (!group.length) continue;
    const ids = [...new Set(group.flatMap((it) => it.context.member_property_ids)
      .map((v) => String(v)).filter((v) => /^\d+$/.test(v)))].slice(0, 200);
    if (!ids.length) continue;
    // ONE read per domain for the whole page — never a lookup per card.
    const r = await domainQuery(DOM_LONG[dom], 'GET',
      'properties?select=' + MERGE_FIELDS[dom] + '&property_id=in.(' + ids.join(',') + ')');
    if (!r.ok || !Array.isArray(r.data)) continue;
    const byId = new Map(r.data.map((p) => [String(p.property_id), p]));
    for (const it of group) {
      const members = it.context.member_property_ids.map((id) => byId.get(String(id))).filter(Boolean);
      if (members.length >= 2) out.set(it.subject_ref, { members, ...splitMemberFields(members) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// provenance_conflict — the missing half is the PRIORITY LADDER.
//
// The lane already carries both values, both sources and `attempted_priority`
// (the admin select just never asked for the latter). What no card carried is
// where the CURRENT source sits on the same ladder — without it "which source
// should win" is unanswerable. field_source_priority is read once for every
// (target_table, field_name) pair in the batch.
// ---------------------------------------------------------------------------
const LADDER_MAX_ROWS = 8;

async function enrichProvenanceConflict(items) {
  const out = new Map();
  const fp = items.filter((it) => (it.context || {}).kind === 'field_provenance');
  if (!fp.length) return out;
  const tables = [...new Set(fp.map((it) => s((it.context || {}).target_table)).filter(Boolean))];
  const fields = [...new Set(fp.map((it) => s((it.context || {}).field_name)).filter(Boolean))];
  if (!tables.length || !fields.length) return out;

  // One read for the whole batch (the cross product is small — a lane page is
  // ≤ a handful of table/field pairs).
  const r = await opsQuery('GET', 'field_source_priority?select=target_table,field_name,source,priority,enforce_mode,notes'
    + '&target_table=in.' + encodeURIComponent(inList(tables))
    + '&field_name=in.' + encodeURIComponent(inList(fields))
    + '&order=target_table,field_name,priority', undefined, { countMode: 'none' });
  if (!r.ok || !Array.isArray(r.data)) return out;

  const byPair = new Map();
  for (const row of r.data) {
    const k = row.target_table + '|' + row.field_name;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(row);
  }
  for (const it of fp) {
    const c = it.context || {};
    const ladder = byPair.get(s(c.target_table) + '|' + s(c.field_name)) || [];
    if (!ladder.length) continue;
    const prioOf = (src) => {
      const hit = ladder.find((row) => String(row.source).toLowerCase() === String(src || '').toLowerCase());
      return hit ? Number(hit.priority) : null;
    };
    out.set(it.subject_ref, {
      current_priority: prioOf(c.current_source),
      // attempted_priority already rides the lane row; recompute only as a fallback.
      attempted_priority: c.attempted_priority != null ? c.attempted_priority : prioOf(c.attempted_source),
      priority_ladder: ladder.slice(0, LADDER_MAX_ROWS)
        .map((row) => ({ source: row.source, priority: row.priority, enforce_mode: row.enforce_mode })),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// owner_reconcile — attach each side's own attributes so "same party?" can rest
// on shared address / geography / type instead of name resemblance alone.
//
// Only the LCC-entity seeders (`ore`, `w8_u2_ollama_pair` on lcc.entities) have
// a batched attribute source here; the gov owner-unification and
// entity_match_candidate seeders already ship their comparison facts inline, so
// they are left as they arrive rather than re-derived.
// ---------------------------------------------------------------------------
const ENTITY_FIELDS = 'id,name,entity_type,org_type,domain,email,phone,address,city,state,zip,normalized_address,'
  + 'clinics_operated_count,merged_into_entity_id';

async function enrichOwnerReconcile(items) {
  const out = new Map();
  if (!items.length) return out;
  const pairs = [];
  for (const it of items) {
    const c = it.context || {};
    const a = c.entity_id || (c.kind === 'w8_u2_ollama_pair' && c.table_name === 'entities' ? c.entity_a : null);
    const b = c.candidate_entity_id || (c.kind === 'w8_u2_ollama_pair' && c.table_name === 'entities' ? c.entity_b : null);
    if (a && b && (c.domain === 'lcc' || c.kind === 'ore' || c.table_name === 'entities')) {
      pairs.push({ ref: it.subject_ref, a: String(a), b: String(b) });
    }
  }
  if (!pairs.length) return out;
  const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))].slice(0, 200);
  const r = await opsQuery('GET', 'entities?select=' + ENTITY_FIELDS + '&id=in.' + encodeURIComponent(inList(ids)),
    undefined, { countMode: 'none' });
  if (!r.ok || !Array.isArray(r.data)) return out;
  const byId = new Map(r.data.map((e) => [String(e.id), e]));
  for (const p of pairs) {
    const a = byId.get(p.a);
    const b = byId.get(p.b);
    if (!a || !b) continue;
    out.set(p.ref, { side_a: a, side_b: b, shared_evidence: sharedEntityEvidence(a, b) });
  }
  return out;
}

// Facts the two rows genuinely share. Each is stated with the value that makes
// it checkable — an unlabelled "shared address: true" is not evidence.
export function sharedEntityEvidence(a, b) {
  const ev = [];
  const norm = (v) => s(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const addrA = norm(a.normalized_address || a.address);
  const addrB = norm(b.normalized_address || b.address);
  if (addrA && addrA === addrB) ev.push({ signal: 'shared_mailing_address', value: a.normalized_address || a.address });
  const cityA = norm(a.city) + '|' + norm(a.state);
  const cityB = norm(b.city) + '|' + norm(b.state);
  if (norm(a.city) && cityA === cityB) ev.push({ signal: 'shared_city_state', value: `${a.city}, ${a.state || ''}`.trim() });
  const emA = s(a.email).toLowerCase();
  const emB = s(b.email).toLowerCase();
  if (emA && emA === emB) ev.push({ signal: 'shared_email', value: a.email });
  else if (emA.includes('@') && emB.includes('@') && emA.split('@')[1] === emB.split('@')[1]) {
    ev.push({ signal: 'shared_email_domain', value: emA.split('@')[1] });
  }
  const phA = s(a.phone).replace(/\D/g, '');
  const phB = s(b.phone).replace(/\D/g, '');
  if (phA && phA.length >= 10 && phA === phB) ev.push({ signal: 'shared_phone', value: a.phone });
  if (s(a.entity_type) && s(a.entity_type) !== s(b.entity_type)) {
    ev.push({ signal: 'entity_type_conflict', value: `${a.entity_type} vs ${b.entity_type}` });
  }
  return ev;
}

// ---------------------------------------------------------------------------
// sf_link_candidate — the card already carries both names, the machine score and
// any conflicting SF id. What it lacked was the MATCH BASIS (which matcher
// produced the candidate) — `last_error` carries either that tag or, on the
// conflict rows, the pre-existing sf id that parseConflictExistingId lifts. No
// extra IO: the remaining evidence (strict-core comparison, similarity) is
// computed in the pure gate.
// ---------------------------------------------------------------------------
async function enrichSfLink(items) {
  const out = new Map();
  for (const it of items) {
    const c = it.context || {};
    const le = s(c.last_error);
    // A conflict row's last_error is an SF id (already lifted into
    // conflict_existing_id); anything else is the matcher/model tag.
    const basis = (!le || c.conflict_existing_id) ? null : le;
    if (basis) out.set(it.subject_ref, { match_basis: basis });
  }
  return out;
}

// ---------------------------------------------------------------------------
// intake_disposition — resolve the property the pipeline already matched, so
// "does this link?" is an address-vs-address comparison instead of a bare id.
// ---------------------------------------------------------------------------
const INTAKE_MATCH_FIELDS = {
  dialysis: 'property_id,address,city,state,zip,tenant,operator',
  government: 'property_id,address,city,state,zip,agency,lease_number',
};

async function enrichIntake(items) {
  const out = new Map();
  if (!items.length) return out;
  const wanted = items.filter((it) => {
    const c = it.context || {};
    return c.match_property_id != null && DOM_LONG[s(c.match_domain)];
  });
  if (!wanted.length) return out;
  const byDom = new Map();
  for (const it of wanted) {
    const dom = DOM_LONG[s((it.context || {}).match_domain)];
    if (!byDom.has(dom)) byDom.set(dom, []);
    byDom.get(dom).push(it);
  }
  for (const [dom, group] of byDom) {
    const ids = [...new Set(group.map((it) => String((it.context || {}).match_property_id))
      .filter((v) => /^\d+$/.test(v)))];
    if (!ids.length) continue;
    const r = await domainQuery(dom, 'GET',
      'properties?select=' + INTAKE_MATCH_FIELDS[dom] + '&property_id=in.(' + ids.join(',') + ')');
    if (!r.ok || !Array.isArray(r.data)) continue;
    const byId = new Map(r.data.map((p) => [String(p.property_id), p]));
    for (const it of group) {
      const p = byId.get(String((it.context || {}).match_property_id));
      if (p) out.set(it.subject_ref, { matched_property: { domain: dom === 'dialysis' ? 'dia' : 'gov', ...p } });
    }
  }
  return out;
}
