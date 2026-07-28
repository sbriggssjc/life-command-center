// ============================================================================
// cadence-scan.js — Cadence Engine (Spine #4, Phase 1): the "what needs a touch" scan.
// Place in mcp/cadence-scan.js (engine deploy context).
//
//   import { makeCadenceScanRoute } from './cadence-scan.js';
//   const cadence = makeCadenceScanRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   app.get('/api/pipeline/cadence-scan',  authenticate, cadence.scan);
//   app.post('/api/pipeline/cadence-scan', authenticate, cadence.scan);
//
// Read-only. Over the IN-SCOPE open Team Briggs deals (owned OR partnership roster edge OR explicit
// include — default exclude), computes per deal: stage → regime → next-action-due, and returns the
// ranked "due / overdue / needs first touch" digest. Regime A = touch cadence; Regime B = contractual
// (surfaced, not touch-driven); Regime C = terminal (skipped). Calls+emails today; sharpens when the
// deal-email matcher (Spine #3) attributes email to deals.
// ============================================================================

import { STAGE_REGIME } from './opportunity-sync.js';

// Regime-A touch interval (days) per stage — straw-man from cadence-engine.md; single-sourced here
// until it graduates to a cadence_rules config. identified/BOV pursue faster; active listings ~14d.
const INTERVAL_DAYS = {
  identified: 7, bov: 14, ela: 14, listing_signed: 14, off_market_listing: 14,
};
const DEFAULT_A_INTERVAL = 14;
const DUE_SOON_WINDOW = 3;   // days before due_date to start flagging "due soon"

const DAY = 86400000;
function daysBetween(a, b) { return Math.floor((a - b) / DAY); }

export function makeCadenceScanRoute({ opsQuery, enc, WORKSPACE_ID }) {
  return {
    scan: async (req, res) => {
      try {
        const now = new Date();

        // 1. In-scope set — open Team Briggs deals. Scope = owner ∈ TB users OR a deal_party edge to a
        //    TB person OR metadata.team_briggs_include. Default is exclusion.
        const [tbRes, oppRes, edgeRes] = await Promise.all([
          opsQuery('GET', 'lcc_users?select=lcc_user_id&active=eq.true'),
          opsQuery('GET',
            `bd_opportunities?workspace_id=eq.${enc(WORKSPACE_ID)}&sf_opp_id=not.is.null&is_open=eq.true` +
            `&select=id,entity_id,sf_opp_id,stage,owner_user_id,amount,expected_close_date,vertical,metadata`),
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

        // 2. Last real touch (call/email) per in-scope asset — one query, reduced to latest-per-asset.
        const assetIds = [...new Set(inScope.map(d => d.entity_id).filter(Boolean))];
        const lastTouch = new Map();
        if (assetIds.length) {
          const inList = assetIds.map(x => enc(x)).join(',');
          const av = await opsQuery('GET',
            `activity_events?workspace_id=eq.${enc(WORKSPACE_ID)}&entity_id=in.(${inList})` +
            `&category=in.(call,email)&order=occurred_at.desc&select=entity_id,occurred_at,category,title&limit=5000`);
          for (const a of (av.data || [])) {
            if (a.entity_id && !lastTouch.has(a.entity_id)) lastTouch.set(a.entity_id, a); // desc → first is latest
          }
        }

        // 3. Compute per deal.
        const actionDue = [];
        const contractual = [];
        for (const d of inScope) {
          const regime = STAGE_REGIME[d.stage] || 'A';
          if (regime === 'C') continue;
          if (regime === 'B') {
            contractual.push({
              sf_opp_id: d.sf_opp_id, stage: d.stage, amount: d.amount,
              expected_close_date: d.expected_close_date,
              note: 'contractual — verify the PSA milestone timeline (deal monitor owns cadence here)',
            });
            continue;
          }
          // Regime A — touch cadence.
          const interval = INTERVAL_DAYS[d.stage] || DEFAULT_A_INTERVAL;
          const lt = lastTouch.get(d.entity_id) || null;
          let due_date = null, days_overdue = null, status;
          if (!lt) {
            status = 'no_logged_activity';   // needs a first logged deal-touch
          } else {
            const due = new Date(new Date(lt.occurred_at).getTime() + interval * DAY);
            due_date = due.toISOString().slice(0, 10);
            days_overdue = daysBetween(now, due);
            status = days_overdue > 0 ? 'overdue' : (days_overdue >= -DUE_SOON_WINDOW ? 'due_soon' : 'on_track');
          }
          actionDue.push({
            sf_opp_id: d.sf_opp_id, stage: d.stage, regime, interval_days: interval,
            last_touch_at: lt?.occurred_at || null, last_touch_category: lt?.category || null,
            due_date, days_overdue, status,
            amount: d.amount, expected_close_date: d.expected_close_date, vertical: d.vertical,
          });
        }

        // 4. Rank: overdue (most overdue first) → needs-first-touch → due-soon → on-track.
        const rank = { overdue: 0, no_logged_activity: 1, due_soon: 2, on_track: 3 };
        actionDue.sort((a, b) =>
          (rank[a.status] - rank[b.status]) || ((b.days_overdue || 0) - (a.days_overdue || 0)));

        const summary = {
          in_scope_open: inScope.length,
          regime_a: actionDue.length,
          contractual: contractual.length,
          overdue: actionDue.filter(i => i.status === 'overdue').length,
          due_soon: actionDue.filter(i => i.status === 'due_soon').length,
          needs_first_touch: actionDue.filter(i => i.status === 'no_logged_activity').length,
          on_track: actionDue.filter(i => i.status === 'on_track').length,
        };

        return res.status(200).json({
          ok: true, generated_at: now.toISOString(), summary,
          action_due: actionDue.slice(0, 100),
          contractual,
        });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    },
  };
}
