// api/_shared/fl-sos-enrich-link.js
// ============================================================================
// FL SOS enrich -> compare -> link engine (2026-05-31)
//
// Authority model:
//   * recorded ownership = authoritative for who owns the real estate.
//   * SOS registration (sos_fl_entities mirror on LCC Opps) = authoritative for
//     that entity's own agent/officers/managers.
//   * unified_contacts (LCC/SF graph) = the relationship structure to link into.
//
// One-way + exact-match-only. Only confirmed-FL recorded owners are eligible
// (recorded_owners.state='FL' OR filing_state='FL'). Strong multi-signal links
// auto-apply; weak links land in v_recorded_owner_link_review for a human.
//
// Reads the mirror via opsQuery (LCC Opps); reads/writes gov via domainQuery.
// ============================================================================
import { opsQuery } from './ops-db.js';
import { domainQuery } from './domain-db.js';
import { authenticate } from './auth.js';

const DOM = 'government'; // FL engine is gov-side for now (dia extends later)

// Mirror the ingest + adapter normalization exactly so name_norm lines up.
function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/[.,'"]/g, '')
    .replace(/\b(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|lp|llp|ltd|limited|trust|holdings|partners|partnership)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
// Address/name comparison normalizer (looser — for signal matching).
function normLoose(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
const pgv = (s) => encodeURIComponent(String(s));

// ── STAGE 1: enrich confirmed-FL recorded owners from the Sunbiz mirror ──────
async function enrichFlOwners({ limit = 100, dryRun = false }) {
  const out = { scanned: 0, enriched: 0, no_match: 0, skipped: 0, errors: 0 };

  // Eligible = confirmed FL owner (state or filing_state FL), not yet enriched,
  // with a name to match. filing_state is sparse today so state='FL' carries it.
  const filter =
    `or=(state.eq.FL,filing_state.eq.FL)&sos_enriched_at=is.null&name=not.is.null` +
    `&select=recorded_owner_id,name,state,filing_state&limit=${limit}`;
  const q = await domainQuery(DOM, 'GET', `recorded_owners?${filter}`);
  if (!q.ok) return { ...out, error: { stage: 'list', detail: q.data } };
  const owners = Array.isArray(q.data) ? q.data : [];
  out.scanned = owners.length;
  if (dryRun) return { ...out, sample: owners.slice(0, 10).map(o => ({ id: o.recorded_owner_id, name: o.name })) };

  for (const o of owners) {
    try {
      const nn = normName(o.name);
      if (!nn || nn.length < 3) { out.skipped++; continue; }
      // Exact normalized match against the FL mirror, prefer Active.
      const m = await opsQuery('GET',
        `sos_fl_entities?name_norm=eq.${pgv(nn)}&order=status.asc&limit=2` +
        `&select=corp_number,corp_name,status,file_date,ra_name,ra_address,ra_city,ra_state,ra_zip,officer1_title,officer1_name`);
      const rows = (m.ok && Array.isArray(m.data)) ? m.data : [];
      if (rows.length === 0) {
        await domainQuery(DOM, 'PATCH', `recorded_owners?recorded_owner_id=eq.${pgv(o.recorded_owner_id)}`,
          { sos_enriched_at: new Date().toISOString(), sos_enrich_source: 'sos_fl', sos_match_kind: 'none' });
        out.no_match++; continue;
      }
      const best = rows.find(r => (r.status || '').toUpperCase() === 'A') || rows[0];
      const raAddr = [best.ra_address, best.ra_city, best.ra_state, best.ra_zip].filter(Boolean).join(', ') || null;
      // Write back: fill the entity-authority fields. filing_state asserted FL
      // only on a confirmed match (so it always means 'verified vs FL registry').
      await domainQuery(DOM, 'PATCH', `recorded_owners?recorded_owner_id=eq.${pgv(o.recorded_owner_id)}`, {
        filing_state:             'FL',
        filing_id:                best.corp_number || null,
        filing_status:            best.status === 'A' ? 'Active' : (best.status === 'I' ? 'Inactive' : best.status),
        filing_date:              best.file_date || null,
        registered_agent_name:    best.ra_name || null,
        registered_agent_address: raAddr,
        manager_name:             best.officer1_name || null,
        sos_enriched_at:          new Date().toISOString(),
        sos_enrich_source:        'sos_fl',
        sos_match_corp_number:    best.corp_number || null,
        sos_match_kind:           'exact',
      });
      out.enriched++;
    } catch (e) { out.errors++; }
  }
  return out;
}

// ── STAGE 2+3: compare enriched owners to unified_contacts, link strong ──────
async function compareAndLink({ limit = 100, dryRun = false }) {
  const out = { scanned: 0, candidates: 0, auto_linked: 0, review_queued: 0, errors: 0 };

  // Owners enriched this cycle that aren't yet compared (no link row + matched).
  const q = await domainQuery(DOM, 'GET',
    `recorded_owners?sos_match_kind=eq.exact&select=recorded_owner_id,name,registered_agent_name,registered_agent_address,manager_name&limit=${limit}`);
  if (!q.ok) return { ...out, error: { stage: 'list', detail: q.data } };
  const owners = Array.isArray(q.data) ? q.data : [];
  out.scanned = owners.length;

  for (const o of owners) {
    try {
      // Build the comparison keys from the SOS-authoritative fields.
      const keys = [];
      if (o.manager_name) keys.push({ signal: 'officer_name', val: normLoose(o.manager_name) });
      if (o.registered_agent_name) keys.push({ signal: 'registered_agent_name', val: normLoose(o.registered_agent_name) });
      if (o.name) keys.push({ signal: 'owner_name', val: normLoose(o.name) });
      const matchable = keys.filter(k => k.val && k.val.length >= 4);
      if (matchable.length === 0) continue;

      // Find unified_contacts whose full_name or company_name coincides with any key.
      // Exact (normalized) coincidence only — no fuzzy, per the precision rule.
      const hitsByContact = new Map();
      for (const k of matchable) {
        const r = await domainQuery(DOM, 'GET',
          `unified_contacts?select=unified_id,full_name,company_name,sf_account_id,sf_contact_id` +
          `&or=(full_name.ilike.${pgv(k.val)},company_name.ilike.${pgv(k.val)})&limit=10`);
        const contacts = (r.ok && Array.isArray(r.data)) ? r.data : [];
        for (const c of contacts) {
          // Confirm the coincidence survives normalization on the contact side too.
          const cn = normLoose(c.full_name), cc = normLoose(c.company_name);
          if (cn === k.val || cc === k.val) {
            if (!hitsByContact.has(c.unified_id)) hitsByContact.set(c.unified_id, { contact: c, signals: new Set(), ownerEqCompany: false });
            const hh = hitsByContact.get(c.unified_id);
            hh.signals.add(k.signal);
            // Entity-identity flag: the OWNER name itself equals this contact's
            // COMPANY name (not just a shared person/agent name). That is the
            // recorded owner *being* the CRM company — a strong link on its own.
            if (k.signal === 'owner_name' && cc === k.val) hh.ownerEqCompany = true;
          }
        }
      }

      for (const [unifiedId, hit] of hitsByContact) {
        const signals = [...hit.signals];
        const signalCount = signals.length;
        // STRONG when EITHER: (a) 2+ distinct signals coincide (agent AND owner,
        // officer AND agent, etc.), OR (b) the recorded owner name exactly equals
        // the contact's company name (entity identity — the owner IS the CRM
        // company, not just a shared person/agent name). Officer/agent-only,
        // single-signal matches stay weak -> human review.
        const strength = (signalCount >= 2 || hit.ownerEqCompany) ? 'strong' : 'weak';
        out.candidates++;
        if (dryRun) continue;

        const row = {
          recorded_owner_id: o.recorded_owner_id,
          unified_id: unifiedId,
          sf_account_id: hit.contact.sf_account_id || null,
          sf_contact_id: hit.contact.sf_contact_id || null,
          match_signals: signals,
          signal_count: signalCount,
          match_strength: strength,
          evidence: { owner_name: o.name, agent: o.registered_agent_name, officer: o.manager_name,
                      contact_name: hit.contact.full_name, contact_company: hit.contact.company_name },
          link_status: strength === 'strong' ? 'auto_linked' : 'proposed',
          decided_by: strength === 'strong' ? 'engine:auto' : null,
          decided_at: strength === 'strong' ? new Date().toISOString() : null,
        };
        const ins = await domainQuery(DOM, 'POST',
          'recorded_owner_contact_links?on_conflict=recorded_owner_id,unified_id',
          row, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
        if (ins.ok) { if (strength === 'strong') out.auto_linked++; else out.review_queued++; }
        else out.errors++;
      }
    } catch (e) { out.errors++; }
  }
  return out;
}

// ── Handler: GET = dry-run, POST = apply. ?stage=enrich|link|both ────────────
export async function handleFlSosEnrichLink(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  const dryRun = req.method === 'GET';
  const stage = String(req.query.stage || 'both');
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10)));
  const result = { mode: dryRun ? 'dry_run' : 'apply', stage };
  try {
    if (stage === 'enrich' || stage === 'both') result.enrich = await enrichFlOwners({ limit, dryRun });
    if (stage === 'link' || stage === 'both')   result.link   = await compareAndLink({ limit, dryRun });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: 'fl-sos-enrich-link failed', detail: e?.message });
  }
}
