// api/_handlers/sf-list-import.js
// ============================================================================
// Salesforce "Lists" (Campaigns / CampaignMembers) ingest endpoint.
// ----------------------------------------------------------------------------
// POST /api/sf-list-import  { campaign_id, campaign_name, parent_name, members:[…] }
//   GET  = dry-run  (classify the list + normalize/classify each member, NO writes)
//   POST = ingest   (reconcile each person by email, relate to the company org,
//                    record the membership, route buyers → P-BUYER pool / sellers
//                    → owner-prospect + the institution registry)
//
// A Power Automate flow queries Salesforce (Campaign + CampaignMember, direct
// fields only) and POSTs batches here — the SF-activity / by-id flow pattern.
// Feature-flagged: with `SF_LIST_IMPORT_URL` unset the PA flow simply never
// calls; the endpoint itself always works (it needs no outbound SF). The
// institution-registry SEED is separately gated by `SF_LIST_SEED_INSTITUTION`
// (default OFF — ships dark; a seller match records the candidate but does not
// write lcc_institution_contacts until Scott flips it on).
//
// No SF writes; additive; reversible; reconcile-by-email so no dup persons;
// LCC-Opps only; no dia/gov writes.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal, resolvePrimaryWorkspaceId } from '../_shared/ops-db.js';
import { ensureEntityLink, looksLikePersonName } from '../_shared/entity-link.js';
import { linkPersonToEntity, stampContactOnActiveCadence } from '../_shared/contact-attach.js';
import { normalizeInstitution } from '../_shared/institution-registry.js';
import {
  classifyList, normalizeMember, personNameFromMember, processMember,
} from '../_shared/sf-list-import.js';

const MEMBER_CAP = 500;        // hard cap per request (a list is ~150-500 members)
const BUDGET_MS = 22000;       // wall-clock budget per tick

function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch { return {}; } }
  return b;
}

// ── Production deps (wired once per request) ────────────────────────────────

function buildDeps({ workspaceId, userId, seedInstitution }) {
  return {
    ensureEntityLink,
    linkPersonToEntity,
    stampContactOnActiveCadence,

    // Upsert the membership row (one per campaign+entity; a re-ingest updates).
    async recordMembership(row) {
      const body = { ...row, source: 'sf_list_import', last_seen_at: new Date().toISOString() };
      const r = await opsQuery('POST', 'lcc_sf_list_membership?on_conflict=campaign_id,entity_id', body,
        { headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      return { ok: !!r.ok, detail: r.ok ? undefined : r.data };
    },

    // Is the company org a registered buyer parent?
    async matchBuyerParent(orgEntityId) {
      if (!orgEntityId) return false;
      const r = await opsQuery('GET',
        'lcc_buyer_parents?parent_entity_id=eq.' + pgFilterVal(orgEntityId) + '&select=parent_entity_id&limit=1',
        { countMode: 'none' });
      return !!(r.ok && Array.isArray(r.data) && r.data.length);
    },

    // Does the seller's company match an institution-registry GAP sponsor
    // (contactless valued SPEs, no registry contact yet)?
    async matchRegistryGap(company) {
      const norm = normalizeInstitution(company);
      if (!norm) return null;
      const r = await opsQuery('GET',
        'v_institution_registry_gaps?sponsor_norm=eq.' + pgFilterVal(norm)
        + '&select=sponsor_norm,institution_name,has_registry_contact&limit=1',
        { countMode: 'none' });
      const row = (r.ok && Array.isArray(r.data)) ? r.data[0] : null;
      if (!row) return { match: false };
      return {
        match: true,
        institution_norm: row.sponsor_norm,
        institution_name: row.institution_name,
        has_contact: !!row.has_registry_contact,
      };
    },

    // Seed a curated institution contact from a seller-list member (flag-gated).
    // Absent (flag off) ⇒ the caller records only the candidate, no write.
    // Guards the name (a firm entered as a person is rejected).
    seedInstitutionContact: seedInstitution
      ? async function seedInstitutionContact({ institution_name, institution_norm, contact }) {
          if (!contact || !contact.name || !looksLikePersonName(contact.name)) return { seeded: false, reason: 'not_person' };
          const norm = institution_norm || normalizeInstitution(institution_name);
          if (!norm) return { seeded: false, reason: 'no_norm' };
          // GET-first dedup: the unique index is on the EXPRESSION
          // (institution_norm, lower(contact_name)) which PostgREST's plain-column
          // on_conflict can't infer (42P10), so probe by institution_norm +
          // case-insensitive name and only INSERT when absent (idempotent).
          const exists = await opsQuery('GET',
            'lcc_institution_contacts?institution_norm=eq.' + pgFilterVal(norm)
            + '&contact_name=ilike.' + encodeURIComponent(contact.name)
            + '&select=id&limit=1', { countMode: 'none' });
          if (exists.ok && Array.isArray(exists.data) && exists.data.length) return { seeded: false, reason: 'already_present' };
          const body = {
            institution_norm: norm,
            institution_name,
            contact_name: contact.name,
            contact_email: contact.email || null,
            contact_phone: contact.phone || null,
            source: 'sf_list_referral',
            confidence: 'medium',
            note: 'Seeded from a Salesforce seller-prospect list',
          };
          const r = await opsQuery('POST', 'lcc_institution_contacts', body,
            { headers: { Prefer: 'return=minimal' } });
          return { seeded: !!r.ok, ok: !!r.ok, detail: r.ok ? undefined : r.data };
        }
      : undefined,
  };
}

// ── HTTP entrypoint ─────────────────────────────────────────────────────────

export async function handleSfListImport(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const body = readBody(req);
  const campaign_id = String(body.campaign_id || req.query.campaign_id || '').trim();
  const campaign_name = String(body.campaign_name || req.query.campaign_name || '').trim() || null;
  const parent_name = String(body.parent_name || req.query.parent_name || '').trim() || null;
  const members = Array.isArray(body.members) ? body.members : [];

  const classification = classifyList({ campaign_name, parent_name });

  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    campaign_id: campaign_id || null,
    campaign_name,
    parent_name,
    classification,
    seed_institution_enabled: !!process.env.SF_LIST_SEED_INSTITUTION,
    members_received: members.length,
    processed: 0,
    skipped: 0,
    guard_rejected: 0,
    resolved_by_email: 0,
    created_persons: 0,
    orgs_linked: 0,
    buyer_parent_matches: 0,
    cadences_seeded: 0,
    registry_gap_matches: 0,
    registry_seeded: 0,
    items: [],
  };

  // A real ingest needs a campaign id (the membership conflict key). Dry-run can
  // classify without one.
  if (!dryRun && !campaign_id) {
    return res.status(400).json({ error: 'campaign_id required for ingest', classification });
  }

  // Dry-run: classify + normalize each member, no writes.
  if (dryRun) {
    for (const raw of members.slice(0, MEMBER_CAP)) {
      const m = normalizeMember(raw);
      const name = personNameFromMember(m);
      result.items.push({
        name, email: m.email, company: m.company, city: m.city, state: m.state,
        side: classification.side, product_type: classification.product_type,
        has_identity: !!(name || m.email),
      });
      if (!(name || m.email)) result.skipped++; else result.processed++;
    }
    return res.status(200).json(result);
  }

  const workspaceId = await resolvePrimaryWorkspaceId();
  if (!workspaceId) return res.status(500).json({ error: 'no_workspace' });

  const deps = buildDeps({
    workspaceId, userId: user.id,
    seedInstitution: !!process.env.SF_LIST_SEED_INSTITUTION,
  });
  const listCtx = { campaign_id, campaign_name, parent_name, workspaceId, userId: user.id, ...classification };

  const deadline = Date.now() + BUDGET_MS;
  let anyWrite = false;
  for (const raw of members.slice(0, MEMBER_CAP)) {
    if (Date.now() > deadline) { result.budget_stopped = true; break; }
    let out;
    try {
      out = await processMember(raw, listCtx, deps);
    } catch (e) {
      out = { outcome: 'error', reason: String(e && e.message || e), side: classification.side };
    }
    if (out.outcome === 'processed') {
      result.processed++;
      anyWrite = true;
      if (out.resolved_by_email) result.resolved_by_email++;
      if (out.created_entity) result.created_persons++;
      if (out.org_entity_id) result.orgs_linked++;
      if (out.buyer_parent_match) result.buyer_parent_matches++;
      if (out.cadence_seeded) result.cadences_seeded++;
      if (out.registry_gap) result.registry_gap_matches++;
      if (out.registry_seeded) result.registry_seeded++;
    } else if (out.outcome === 'skipped') {
      result.skipped++;
    } else {
      result.guard_rejected++;
    }
    result.items.push(out);
  }

  // A cadence seed / connect makes an owner reachable — refresh the queue cache
  // so it surfaces within the request (the Slice-1 staleness hook).
  if (anyWrite && result.cadences_seeded > 0) {
    try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }
  }

  return res.status(200).json(result);
}
