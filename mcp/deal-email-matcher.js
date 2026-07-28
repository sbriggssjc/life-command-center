// ============================================================================
// deal-email-matcher.js — Deal-Email Matcher (Spine #3), v2.1: core-tenant + city, precise.
// Place in mcp/deal-email-matcher.js (engine deploy context).
//
//   import { makeDealEmailMatcherRoute } from './deal-email-matcher.js';
//   const matcher = makeDealEmailMatcherRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   app.post('/api/pipeline/match-deal-emails', authenticate, matcher.match);
//
// TB deals have no structured SF party roster (see deal-party-roster-source.md), so this attributes
// Outlook emails (which resolve to PERSON entities) to DEALS by STRONG SIGNAL: the deal's tenant AND city.
//
// HISTORY. v2 tried a "tenant-alone when distinctive" recall mode; the dry-run refuted it — same-operator,
// different-property mail (Innovative Renal Care *Arvada CO* vs the Milwaukee deal; DaVita-Anchored *SF/CT* vs
// Springfield IL; Action Behavior *Fort Worth* vs Duncanville) was mis-attributed. **City is load-bearing** —
// dropping it breaks precision. So v2.1 keeps city REQUIRED and instead banks the two safe wins the dry-run
// surfaced (see matcher-recall-design.md):
//   1. CORE TENANT — strip generic descriptors (MOB/Dialysis/Center/Care/…) so "DaVita in Queens" matches the
//      "DaVita Dialysis - Queens" deal (v1 required "DaVita Dialysis" verbatim and missed it). City still required.
//   2. WORD-BOUNDARY match — "Essentia" no longer matches "Essential"; substring FPs gone.
//   3. DIGEST EXCLUSION — the weekly pipeline email lists every deal, so it self-attributed; skip LCC-generated
//      cadence mail (body marker "LCC cadence engine").
//   * ?dry_run=1 (query or body) reports per-deal {core_tenant, would_attribute, sample_titles} and WRITES NOTHING.
//
// On a live match it (unchanged): (1) writes a deal-attributed activity_events row on the ASSET, idempotent by
// (entity_id, external_id); (2) writes the email's person as an 'email_derived' deal_party edge.
// Scope = in-scope open Team Briggs deals (owned OR partnership OR explicit include).
// ============================================================================

const SYSTEM_ACTOR = 'b0000000-0000-0000-0000-000000000001';
const REL = 'deal_party';
const CAND_LIMIT = 1200;   // per-deal candidate cap (core-tenant substring hits); word+city filter in memory
const DIGEST_MARKER = 'lcc cadence engine';   // footer of the engine-composed pipeline digest — never a real deal email

function tenantSegment(name) {
  return String(name || '').split(/\s+-\s+/)[0].replace(/\(.*\)/g, '').trim();
}
function cityBaseOf(city) {
  return String(city || '').replace(/\(.*\)/g, '').trim();
}
const GENERIC = new Set([
  'mob', 'dialysis', 'clinic', 'clinics', 'center', 'centers', 'health', 'group', 'urgent',
  'care', 'medical', 'portfolio', 'anchored', 'inc', 'llc', 'the', 'ii', 'iii', 'iv', 'i',
  'trust', 'company', 'co', 'corp', 'lp', 'ltd', 'associates', 'partners',
]);
function coreTenantOf(tenantSeg) {
  const words = String(tenantSeg || '').replace(/[&/]/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter(w => {
    const bare = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!bare) return false;
    if (GENERIC.has(bare)) return false;
    if (/^\d+$/.test(bare)) return false;
    return true;
  });
  const core = kept.join(' ').trim();
  return core.length >= 4 ? core : tenantSeg;   // fall back rather than strip to noise
}
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word (bounded) presence test, case-insensitive. Fixes "Essentia" ⊂ "Essential".
function hasWord(text, term) {
  const t = String(term || '').trim();
  if (!t) return false;
  try { return new RegExp('\\b' + reEsc(t.toLowerCase()) + '\\b').test(text); }
  catch { return text.includes(t.toLowerCase()); }
}

export function makeDealEmailMatcherRoute({ opsQuery, enc, WORKSPACE_ID }) {
  return {
    match: async (req, res) => {
      try {
        const q = { ...(req.query || {}), ...(req.body || {}) };
        const dryRun = q.dry_run === 1 || q.dry_run === '1' || q.dry_run === true || q.dry_run === 'true';

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
          version: 'v2.1', dry_run: dryRun,
          deals_scanned: 0, deals_with_matches: 0, emails_attributed: 0,
          already_attributed: 0, roster_edges: 0, skipped_thin_tokens: 0,
          digest_excluded: 0, errors: [],
        };
        const dryDeals = [];

        for (const d of inScope) {
          const e = nameById.get(d.entity_id);
          if (!e) { summary.skipped_thin_tokens++; continue; }
          const core = coreTenantOf(tenantSegment(e.name));
          const cityBase = cityBaseOf(e.city);
          const coreL = core.toLowerCase();
          const cl = cityBase.toLowerCase();
          // Precision guard: need a distinctive core and a city, and the core must not just be the city.
          if (core.length < 4 || cityBase.length < 3 || coreL === cl) {
            summary.skipped_thin_tokens++; continue;
          }
          summary.deals_scanned++;

          // Candidate emails mentioning the CORE tenant (broad substring); word+city+digest filters in memory.
          const cand = await opsQuery('GET',
            `activity_events?source_type=eq.outlook` +
            `&or=(title.ilike.${enc('*' + core + '*')},body.ilike.${enc('*' + core + '*')})` +
            `&select=id,entity_id,title,body,occurred_at,external_id,domain&limit=${CAND_LIMIT}`);
          const matches = [];
          for (const m of (cand.data || [])) {
            const hay = `${m.title || ''} ${m.body || ''}`.toLowerCase();
            if (hay.includes(DIGEST_MARKER)) { summary.digest_excluded++; continue; }   // self-referential digest
            if (hasWord(hay, coreL) && hasWord(hay, cl)) matches.push(m);               // tenant (word) AND city
          }
          if (matches.length) summary.deals_with_matches++;

          if (dryRun) {
            dryDeals.push({
              sf_opp_id: d.sf_opp_id, deal: e.name, core_tenant: core, city: cityBase,
              would_attribute: matches.length,
              sample_titles: matches.slice(0, 5).map(m => (m.title || '').slice(0, 90)),
            });
            continue;   // never write in dry-run
          }

          for (const m of matches) {
            const key = m.external_id || m.id;   // idempotency key for the deal-attributed row
            try {
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
                  metadata: { matched_by: 'core_tenant+city', core_tenant: core, city: cityBase,
                              source_email_id: m.id, source_entity_id: m.entity_id },
                });
                if (ins.ok === false) {
                  if (summary.errors.length < 50) summary.errors.push({ sf_opp_id: d.sf_opp_id, detail: ins.data });
                } else {
                  summary.emails_attributed++;
                }
              }
              // Email-derived roster edge (deal -> the email's person).
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

        if (dryRun) {
          dryDeals.sort((a, b) => (b.would_attribute || 0) - (a.would_attribute || 0));
          return res.status(200).json({ ok: true, ...summary, deals: dryDeals });
        }
        return res.status(200).json({ ok: true, ...summary });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    },
  };
}
