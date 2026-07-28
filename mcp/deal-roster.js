// ============================================================================
// deal-roster.js — Deal Roster (Spine #2), Slice A: Team Briggs team membership.
// Place in mcp/deal-roster.js (engine deploy context).
//
//   import { makeDealRosterRoute } from './deal-roster.js';
//   const roster = makeDealRosterRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   app.post('/api/pipeline/ingest-deal-parties', authenticate, roster.ingestParties);
//
// Body:  { "parties": [ <raw SF Deal-Team-Member (OpportunityTeamMember) rows> ] }
//   row: { OpportunityId, UserId, TeamMemberRole }
//
// Writes entity_relationships 'deal_party' edges (from = deal-asset, to = the Team Briggs person)
// so the backbone can tell OWNED and PARTNERSHIP Team Briggs deals apart from everyone else's.
// Scope rule downstream:  a deal is Team-Briggs if  owner_user_id ∈ TB users  OR  it has a
// deal_party edge to a TB person  OR  metadata.team_briggs_include. Default = exclude.
//
// This slice only writes edges for Team Briggs users (the PA flow pre-filters OTM by UserId), so
// the write set is tiny. External contact roles (OpportunityContactRole → seller/buyer/etc.) are
// Slice B — they feed the dossier + deal-email matcher and land later.
// ============================================================================

const REL = 'deal_party';

function normParty(d) {
  d = d || {};
  return {
    sf_opp_id: d.sf_opp_id ?? d.OpportunityId ?? d.opportunity_id ?? null,
    sf_user_id: d.sf_user_id ?? d.UserId ?? null,
    team_role: d.team_role ?? d.TeamMemberRole ?? d.Role ?? null,
  };
}

function slug(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }

// SF OpportunityContactRole (relabeled "Deal Contact Role"): external deal parties.
function normContact(d) {
  d = d || {};
  return {
    sf_opp_id: d.sf_opp_id ?? d.OpportunityId ?? d.opportunity_id ?? null,
    sf_contact_id: d.sf_contact_id ?? d.ContactId ?? null,
    role: d.role ?? d.Role ?? null,
    is_primary: d.is_primary ?? d.IsPrimary ?? null,
  };
}

export function makeDealRosterRoute({ opsQuery, enc, WORKSPACE_ID }) {
  // Resolve Team Briggs users once per request: SF owner id -> person entity id.
  // lcc_users.display_name matches the person entity name exactly for all four.
  async function loadTbMap() {
    const map = {};
    const u = await opsQuery('GET',
      'lcc_users?select=lcc_user_id,display_name,salesforce_owner_id&active=eq.true');
    for (const row of (u.data || [])) {
      if (!row.salesforce_owner_id || !row.display_name) continue;
      const e = await opsQuery('GET',
        `entities?entity_type=eq.person&name=eq.${enc(row.display_name)}&select=id&limit=1`);
      const pid = e.data?.[0]?.id;
      if (pid) map[row.salesforce_owner_id] = { person_id: pid, name: row.display_name };
    }
    return map;
  }

  // Preload the backbone deals once (sf_opp_id -> asset entity_id) so a firm-wide OpportunityContactRole
  // pull is filtered IN MEMORY — no per-row deal lookup, non-backbone contacts skipped for free.
  async function loadDealMap() {
    const map = {};
    const d = await opsQuery('GET',
      `bd_opportunities?workspace_id=eq.${enc(WORKSPACE_ID)}&sf_opp_id=not.is.null&select=sf_opp_id,entity_id&limit=5000`);
    for (const r of (d.data || [])) if (r.sf_opp_id && r.entity_id) map[r.sf_opp_id] = r.entity_id;
    return map;
  }

  return {
    ingestParties: async (req, res) => {
      const body = req.body || {};
      const rows = Array.isArray(body) ? body : (body.parties || body.value || []);
      if (!Array.isArray(rows)) {
        return res.status(400).json({ ok: false, error: 'expected { parties: [ ... ] }' });
      }

      const tbMap = await loadTbMap();
      if (!Object.keys(tbMap).length) {
        return res.status(500).json({ ok: false, error: 'no Team Briggs users resolved to person entities' });
      }

      const dealCache = new Map();       // sf_opp_id -> asset entity_id | null
      const touched = new Set();
      const summary = {
        total: rows.length, tb_members: 0, edges_created: 0, edges_existing: 0,
        deals_touched: 0, skipped_non_tb: 0, skipped_no_deal: 0, errors: [],
      };

      for (const raw of rows) {
        try {
          const p = normParty(raw);
          const tb = p.sf_user_id ? tbMap[p.sf_user_id] : null;
          if (!tb) { summary.skipped_non_tb++; continue; }
          summary.tb_members++;

          // Resolve the deal-asset entity (cached per opportunity).
          let assetId = dealCache.get(p.sf_opp_id);
          if (assetId === undefined) {
            const d = await opsQuery('GET',
              `bd_opportunities?workspace_id=eq.${enc(WORKSPACE_ID)}&sf_opp_id=eq.${enc(p.sf_opp_id)}&select=entity_id&limit=1`);
            assetId = d.data?.[0]?.entity_id || null;
            dealCache.set(p.sf_opp_id, assetId);
          }
          if (!assetId) { summary.skipped_no_deal++; continue; }

          // Idempotent: check-then-insert (no unique constraint on entity_relationships).
          const ex = await opsQuery('GET',
            `entity_relationships?workspace_id=eq.${enc(WORKSPACE_ID)}&from_entity_id=eq.${enc(assetId)}` +
            `&to_entity_id=eq.${enc(tb.person_id)}&relationship_type=eq.${REL}&select=id&limit=1`);
          if (ex.data?.[0]?.id) { summary.edges_existing++; touched.add(p.sf_opp_id); continue; }

          const ins = await opsQuery('POST', 'entity_relationships', {
            workspace_id: WORKSPACE_ID, from_entity_id: assetId, to_entity_id: tb.person_id,
            relationship_type: REL,
            metadata: {
              role: 'our_broker', sf_team_role: p.team_role || null,
              sf_user_id: p.sf_user_id, tb_user: tb.name, source: 'sf_opp_team',
            },
          });
          if (ins.ok === false) {
            if (summary.errors.length < 50) summary.errors.push({ sf_opp_id: p.sf_opp_id, sf_user_id: p.sf_user_id, detail: ins.data });
            continue;
          }
          summary.edges_created++; touched.add(p.sf_opp_id);
        } catch (e) {
          if (summary.errors.length < 50) summary.errors.push({ error: String(e?.message || e) });
        }
      }
      summary.deals_touched = touched.size;
      return res.status(200).json({ ok: true, ...summary });
    },

    // Slice B — external contact roles (seller / buyer / counsel / escrow / …). Resolves the SF contact
    // to its person entity via unified_contacts and writes deal_party edges (deal-asset → person). These
    // give the deal-email matcher (Spine #3) its "is a deal party on this thread" signal.
    ingestContactRoles: async (req, res) => {
      const body = req.body || {};
      const rows = Array.isArray(body) ? body : (body.parties || body.contacts || body.value || []);
      if (!Array.isArray(rows)) {
        return res.status(400).json({ ok: false, error: 'expected { parties: [ ... ] }' });
      }
      const dealMap = await loadDealMap();   // sf_opp_id -> asset entity_id (backbone only), preloaded once
      const contactCache = new Map();        // sf_contact_id -> person entity_id | null
      const touched = new Set();
      const summary = {
        total: rows.length, resolved: 0, edges_created: 0, edges_existing: 0,
        deals_touched: 0, skipped_no_deal: 0, skipped_no_contact: 0, errors: [],
      };
      for (const raw of rows) {
        try {
          const c = normContact(raw);
          if (!c.sf_opp_id || !c.sf_contact_id) { summary.skipped_no_contact++; continue; }
          const assetId = dealMap[c.sf_opp_id];
          if (!assetId) { summary.skipped_no_deal++; continue; }
          let personId = contactCache.get(c.sf_contact_id);
          if (personId === undefined) {
            // SF ids come 15- OR 18-char; unified_contacts stores mostly 15. Match on the 15-char prefix
            // (a stored 18-char value also starts with the same 15), and require a resolved entity.
            const cid15 = String(c.sf_contact_id).slice(0, 15);
            const u = await opsQuery('GET',
              `unified_contacts?sf_contact_id=like.${enc(cid15 + '*')}&entity_id=not.is.null&select=entity_id&limit=1`);
            personId = u.data?.[0]?.entity_id || null; contactCache.set(c.sf_contact_id, personId);
          }
          if (!personId) { summary.skipped_no_contact++; continue; }
          summary.resolved++;
          const ex = await opsQuery('GET',
            `entity_relationships?workspace_id=eq.${enc(WORKSPACE_ID)}&from_entity_id=eq.${enc(assetId)}` +
            `&to_entity_id=eq.${enc(personId)}&relationship_type=eq.${REL}&select=id&limit=1`);
          if (ex.data?.[0]?.id) { summary.edges_existing++; touched.add(c.sf_opp_id); continue; }
          const ins = await opsQuery('POST', 'entity_relationships', {
            workspace_id: WORKSPACE_ID, from_entity_id: assetId, to_entity_id: personId,
            relationship_type: REL,
            metadata: {
              role: slug(c.role) || 'contact', sf_role: c.role || null,
              is_primary: c.is_primary === true || c.is_primary === 'true' || null,
              sf_contact_id: c.sf_contact_id, source: 'sf_opp_contact',
            },
          });
          if (ins.ok === false) {
            if (summary.errors.length < 50) summary.errors.push({ sf_opp_id: c.sf_opp_id, sf_contact_id: c.sf_contact_id, detail: ins.data });
            continue;
          }
          summary.edges_created++; touched.add(c.sf_opp_id);
        } catch (e) {
          if (summary.errors.length < 50) summary.errors.push({ error: String(e?.message || e) });
        }
      }
      summary.deals_touched = touched.size;
      return res.status(200).json({ ok: true, ...summary });
    },
  };
}
