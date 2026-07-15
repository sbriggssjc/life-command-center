// api/_handlers/institution-contact.js
// ============================================================================
// ORE Tier A — institution-contact attach + fan-out worker
// (via vercel.json _route=institution-contact-tick, sub-route of operations.js).
// ----------------------------------------------------------------------------
//   GET  → dry-run (no writes): the institution-registry GAPS (which sponsor to
//          fill FIRST, value-ranked) + how many contactless owners would attach
//          RIGHT NOW from the current registry. Surfaces the highest-value manual
//          action (add ONE contact → resolve many SPEs).
//   POST → drain: over v_institution_contact_attachable (contactless valued owner
//          SPEs whose sponsor HAS a registry contact, value-ranked), attach the
//          curated contact to each — so ONE contact fans out across the sponsor's
//          whole SPE portfolio. Bounded by `limit` + a wall-clock budget.
//          POST &entity_id=<uuid> → single-owner run (the worklist "Run lookup"
//          reuse); attaches iff that owner's sponsor has a registry contact.
//
// The worker is a router + recorder over the CURATED registry — it NEVER
// fabricates a contact. An institution with no registry row is surfaced in the
// gaps view for a human to fill (a directed research task, not a guess). Reuses
// ensureEntityLink + the contact-attach helpers; reversible.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { ensureEntityLink, looksLikePersonName } from '../_shared/entity-link.js';
import { linkPersonToEntity, stampContactOnActiveCadence } from '../_shared/contact-attach.js';
import { attachInstitutionContactToOwner } from '../_shared/institution-registry.js';

const WALL_CLOCK_MS = 20000;

function buildDeps() {
  return { ensureEntityLink, linkPersonToEntity, stampContactOnActiveCadence, opsQuery, looksLikePersonName };
}

const ATTACHABLE_COLS = 'entity_id,owner_name,workspace_id,rank_value,institution_name,'
  + 'sponsor_norm,registry_contact_id,contact_name,contact_title,contact_email,contact_phone,'
  + 'contact_source,contact_confidence';

export async function handleInstitutionContactTick(req, res) {
  // Same internal-auth contract as the sibling tick workers.
  const user = await authenticate(req, res);
  if (!user) return;

  // ---- Single-owner run (worklist "Run lookup" reuse) ----------------------
  const entityId = req.query.entity_id;
  if (entityId) {
    const sel = 'v_institution_contact_attachable?select=' + ATTACHABLE_COLS
      + '&entity_id=eq.' + pgFilterVal(entityId) + '&limit=1';
    const pr = await opsQuery('GET', sel);
    const row = (pr.ok && Array.isArray(pr.data)) ? pr.data[0] : null;
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, single: true, preview: true,
        would: row ? 'attach_institution_contact' : 'no_registry_contact',
        institution: row ? row.institution_name : null });
    }
    if (!row) {
      return res.status(200).json({ ok: true, single: true, outcome: 'no_registry_contact',
        detail: 'owner sponsor has no curated institution contact (fill v_institution_registry_gaps)' });
    }
    const deps = buildDeps();
    let out;
    try { out = await attachInstitutionContactToOwner(row, deps); }
    catch (e) { out = { entity_id: entityId, outcome: 'error', error: String(e && e.message || e) }; }
    if (out.outcome === 'attached') {
      try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }
    }
    return res.status(200).json({ ok: true, single: true, ...out });
  }

  const dryRun = req.method === 'GET';
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 300);

  if (dryRun) {
    // GAPS — which institution to fill first (needs_contact) + what's attachable now.
    const gapsRes = await opsQuery('GET', 'v_institution_registry_gaps?select=institution_name,'
      + 'spe_count,total_rent,has_registry_contact,registry_contact_name&order=total_rent.desc.nullslast&limit=200');
    const gaps = (gapsRes.ok && Array.isArray(gapsRes.data)) ? gapsRes.data : [];
    const needsContact = gaps.filter((g) => !g.has_registry_contact);
    const withContact = gaps.filter((g) => g.has_registry_contact);
    const attRes = await opsQuery('GET', 'v_institution_contact_attachable?select=entity_id&limit=1000');
    const attachable = (attRes.ok && Array.isArray(attRes.data)) ? attRes.data.length : 0;
    return res.status(200).json({ ok: true, dry_run: true,
      attachable_owners: attachable,
      institutions_with_contact: withContact.length,
      institutions_needing_contact: needsContact.length,
      // The top sponsors to fill FIRST (fan-out leverage): each is one manual
      // action that resolves spe_count contactless SPEs worth total_rent.
      top_gaps: needsContact.slice(0, 15).map((g) => ({
        institution: g.institution_name, spe_count: g.spe_count, total_rent: g.total_rent })),
      top_attachable: withContact.slice(0, 10).map((g) => ({
        institution: g.institution_name, spe_count: g.spe_count, total_rent: g.total_rent,
        contact: g.registry_contact_name })),
    });
  }

  // POST → attach the curated contact to each attachable owner (fan-out).
  const r = await opsQuery('GET', 'v_institution_contact_attachable?select=' + ATTACHABLE_COLS
    + '&order=rank_value.desc.nullslast&limit=' + limit);
  if (!r.ok) return res.status(r.status || 500).json({ error: 'load_failed', detail: r.data });
  const rows = Array.isArray(r.data) ? r.data : [];

  const deps = buildDeps();
  const started = Date.now();
  const summary = { processed: 0, attached: 0, failed: 0, skipped: 0, by_institution: {}, results: [] };
  const FAIL = new Set(['guard_rejected', 'link_failed', 'patch_failed', 'error']);
  let attachedAny = false;
  for (const row of rows) {
    if (Date.now() - started > WALL_CLOCK_MS) break;
    let out;
    try { out = await attachInstitutionContactToOwner(row, deps); }
    catch (e) { out = { entity_id: row.entity_id, outcome: 'error', error: String(e && e.message || e) }; }
    summary.processed += 1;
    if (out.outcome === 'attached') {
      summary.attached += 1; attachedAny = true;
      const k = row.institution_name || row.sponsor_norm || 'unknown';
      summary.by_institution[k] = (summary.by_institution[k] || 0) + 1;
    } else if (FAIL.has(out.outcome)) summary.failed += 1;
    else summary.skipped += 1;
    if (summary.results.length < 40) summary.results.push(out);
  }

  if (attachedAny) { try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ } }
  return res.status(200).json({ ok: true, ...summary });
}
