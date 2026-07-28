// ============================================================================
// deal-email-matcher.js — Deal-Email Matcher (Spine #3), v1: strong-signal-primary.
// Place in mcp/deal-email-matcher.js (engine deploy context).
//
//   import { makeDealEmailMatcherRoute } from './deal-email-matcher.js';
//   const matcher = makeDealEmailMatcherRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   app.post('/api/pipeline/match-deal-emails', authenticate, matcher.match);
//
// TB deals have no structured SF party roster (see deal-party-roster-source.md), so this attributes
// the Outlook emails (which resolve to PERSON entities) to DEALS by STRONG SIGNALS — the deal's tenant
// AND city both present in the email subject/body. Precision-first: city-alone over-attributes badly
// (validated), tenant+city is tight. On a match it:
//   1. writes a deal-attributed activity_events row on the ASSET (so the dossier + cadence-scan see it),
//      idempotent by (entity_id, external_id);
//   2. writes the email's person as an 'email_derived' deal_party edge — the roster self-builds.
// Scope = in-scope open Team Briggs deals (owned OR partnership OR explicit include).
// ============================================================================

const SYSTEM_ACTOR = 'b0000000-0000-0000-0000-000000000001';
const REL = 'deal_party';
const CAND_LIMIT = 800;   // per-deal candidate cap (tenant hits); city filter runs in memory

function tokensFor(name, city) {
  const tenant = String(name || '').split(/\s+-\s+/)[0].replace(/\(.*\)/g, '').trim();
  const cityBase = String(city || '').replace(/\(.*\)/g, '').trim();
  return { tenant, cityBase };
}

export function makeDealEmailMatcherRoute({ opsQuery, enc, WORKSPACE_ID }) {
  return {
    match: async (req, res) => {
      try {
        // 1. In-scope open deals (same scope rule as cadence-scan).
        const [tbRes, oppRes, edgeRes] = await Promise.all([
          opsQuery('GET', 'lcc_users?select=lcc_user_id&active=eq.true'),
          opsQuery('GET',
            `bd_opportunities?workspace_id=eq.${enc(WORKSPACE_ID)}&sf_opp_id=not.is.null&is_open=eq.true` +
            `&select=entity_id,sf_opp_id,owner_user_id,metadata`),
          opsQuery('GET',
            `entity_relationships?workspace_id=eq.${enc(WORKSPACE_ID)}&relationship_type=eq.deal_party` +
            `&metadata->>source=eq.sf_opp_team&select=from_entity_id`),
        ]);
        const tbUsers = new Set((tbRes.data || []).map(r => r.lcc_user_id));
        const tbTeamAssets = new Set((edgeRes.data || []).map(r => r.from_entity_id));
        const inScope = (oppRes.data || []).filter(d =>
          (d.owner_user_id && tbUsers.has(d.owner_user_id)) ||
          tbTeamAssets.has(d.entity_id) ||
          d.metadata?.team_briggs_include === true);

        // 2. Entity name/city for each in-scope deal.
        const ids = [...new Set(inScope.map(d => d.entity_id).filter(Boolean))];
        const nameById = new Map();
        if (ids.length) {
          const er = await opsQuery('GET',
            `entities?id=in.(${ids.map(x => enc(x)).join(',')})&select=id,name,city,state`);
          for (const e of (er.data || [])) nameById.set(e.id, e);
        }

        const summary = {
          deals_scanned: 0, deals_with_matches: 0, emails_attributed: 0,
          already_attributed: 0, roster_edges: 0, skipped_thin_tokens: 0, errors: [],
        };

        for (const d of inScope) {
          const e = nameById.get(d.entity_id);
          if (!e) { summary.skipped_thin_tokens++; continue; }
          const { tenant, cityBase } = tokensFor(e.name, e.city);
          // Precision guard: need a distinctive tenant and a city, and tenant must not just be the city.
          if (tenant.length < 4 || cityBase.length < 3 || tenant.toLowerCase() === cityBase.toLowerCase()) {
            summary.skipped_thin_tokens++; continue;
          }
          summary.deals_scanned++;

          // Candidate emails that mention the tenant; city filter applied in memory.
          const cand = await opsQuery('GET',
            `activity_events?source_type=eq.outlook` +
            `&or=(title.ilike.${enc('*' + tenant + '*')},body.ilike.${enc('*' + tenant + '*')})` +
            `&select=id,entity_id,title,body,occurred_at,external_id,domain&limit=${CAND_LIMIT}`);
          const cl = cityBase.toLowerCase();
          const matches = (cand.data || []).filter(m =>
            `${m.title || ''} ${m.body || ''}`.toLowerCase().includes(cl));
          if (matches.length) summary.deals_with_matches++;

          for (const m of matches) {
            const key = m.external_id || m.id;   // idempotency key for the deal-attributed row
            try {
              // 2a. Deal-attributed activity row on the asset (idempotent by entity_id + external_id).
              const ex = await opsQuery('GET',
                `activity_events?entity_id=eq.${enc(d.entity_id)}&external_id=eq.${enc(key)}&category=eq.email&select=id&limit=1`);
              if (ex.data?.[0]?.id) {
                summary.already_attributed++;
              } else {
                const ins = await opsQuery('POST', 'activity_events', {
                  workspace_id: WORKSPACE_ID, actor_id: SYSTEM_ACTOR, entity_id: d.entity_id,
                  category: 'email', title: m.title || null, body: m.body || null,
                  occurred_at: m.occurred_at || null, external_id: key,
                  source_type: 'lcc:deal_match', domain: m.domain || null,
                  metadata: { matched_by: 'tenant+city', tenant, city: cityBase,
                              source_email_id: m.id, source_entity_id: m.entity_id },
                });
                if (ins.ok === false) {
                  if (summary.errors.length < 50) summary.errors.push({ sf_opp_id: d.sf_opp_id, detail: ins.data });
                } else {
                  summary.emails_attributed++;
                }
              }
              // 2b. Email-derived roster edge (deal -> the email's person).
              if (m.entity_id && m.entity_id !== d.entity_id) {
                const exr = await opsQuery('GET',
                  `entity_relationships?workspace_id=eq.${enc(WORKSPACE_ID)}&from_entity_id=eq.${enc(d.entity_id)}` +
                  `&to_entity_id=eq.${enc(m.entity_id)}&relationship_type=eq.${REL}&select=id&limit=1`);
                if (!exr.data?.[0]?.id) {
                  const insr = await opsQuery('POST', 'entity_relationships', {
                    workspace_id: WORKSPACE_ID, from_entity_id: d.entity_id, to_entity_id: m.entity_id,
                    relationship_type: REL, metadata: { role: 'correspondent', source: 'email_derived' },
                  });
                  if (insr.ok !== false) summary.roster_edges++;
                }
              }
            } catch (inner) {
              if (summary.errors.length < 50) summary.errors.push({ sf_opp_id: d.sf_opp_id, error: String(inner?.message || inner) });
            }
          }
        }

        return res.status(200).json({ ok: true, ...summary });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    },
  };
}
