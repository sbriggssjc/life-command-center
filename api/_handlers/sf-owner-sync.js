// api/_handlers/sf-owner-sync.js
// ============================================================================
// SF owner sync — the durable, backwards+forwards owner-capture worker.
// ----------------------------------------------------------------------------
// Backwards (backfill): gathers every deal entity's Salesforce Id already stamped
// on entities/unified_contacts, splits Account (001) vs Opportunity (006), pulls
// each batch's owner via the PA flow (getSalesforceOwnersByIds), and writes the
// owner into lcc_entity_owner_override via rpc/lcc_apply_owner_backfill. Manual
// LCC overrides are preserved by the RPC.
//
// Forwards (keep-fresh): the same worker on a weekly pg_cron re-pulls owners, so
// a reassignment in Salesforce propagates to My Day automatically. Single-deal
// linking is handled separately by lcc_set_entity_owner_from_sf in sf-account-link.
//
// Route:  POST /api/sf-owner-sync   (admin _route='sf-owner-sync')
//   ?dry=1      — resolve + report coverage, do NOT write overrides
//   ?limit=N    — cap deals processed (default all)
// Feature-gated on SF_LOOKUP_WEBHOOK_URL (isSalesforceConfigured). Never throws.
// ============================================================================
import { opsQuery } from '../_shared/ops-db.js';
import { isSalesforceConfigured, getSalesforceOwnersByIds } from '../_shared/salesforce.js';

const BATCH = 150; // keep SOQL IN() + URL length safe

// SF Id key-prefix → sObject. 001=Account, 006=Opportunity.
function sobjectForId(sfId) {
  const p = String(sfId || '').slice(0, 3);
  if (p === '006') return 'Opportunity';
  return 'Account'; // 001 and anything else we treat as Account
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Distinct SF Ids stamped on priority-queue deals, via the purpose-built RPC
// (read-only, no arbitrary SQL). The apply RPC re-resolves entity matches itself.
async function gatherDealSfIds(limit) {
  const r = await opsQuery('POST', 'rpc/lcc_deal_sf_ids', {
    p_limit: limit && limit > 0 ? Number(limit) : null,
  }).catch(() => null);
  if (r?.data && Array.isArray(r.data)) return r.data.map((x) => x.sf_id).filter(Boolean);
  return null;
}

export async function handleSfOwnerSync(req, res) {
  try {
    if (!isSalesforceConfigured()) {
      return res.status(200).json({ ok: false, reason: 'sf_not_configured' });
    }
    const dry = String(req.query?.dry || '') === '1';
    const limit = req.query?.limit ? Number(req.query.limit) : null;

    const sfIds = await gatherDealSfIds(limit);
    if (!sfIds) {
      return res.status(200).json({
        ok: false,
        reason: 'gather_failed',
        hint: 'gatherDealSfIds needs a select path — see the SQL-gather note in this file.',
      });
    }
    if (!sfIds.length) return res.status(200).json({ ok: true, sf_ids: 0, note: 'no linked deals' });

    // Split by sObject and query owners in batches.
    const byObj = { Account: [], Opportunity: [] };
    for (const id of sfIds) byObj[sobjectForId(id)].push(id);

    const ownerMap = []; // [{sf_id, sf_owner_id, owner_name}]
    const errors = [];
    for (const sobject of ['Account', 'Opportunity']) {
      for (const batch of chunk(byObj[sobject], BATCH)) {
        const r = await getSalesforceOwnersByIds(batch, sobject);
        if (!r.ok) { errors.push({ sobject, reason: r.reason, detail: r.detail || null }); continue; }
        for (const o of r.owners) ownerMap.push(o);
      }
    }

    const resolved = ownerMap.filter((o) => o.sf_owner_id || o.owner_name).length;
    if (dry) {
      return res.status(200).json({
        ok: true, dry: true, sf_ids: sfIds.length,
        accounts: byObj.Account.length, opportunities: byObj.Opportunity.length,
        owners_returned: ownerMap.length, owners_resolved: resolved, errors,
      });
    }

    // Apply through the DB sink (maps owner → lcc_user, preserves manual overrides).
    const apply = await opsQuery('POST', 'rpc/lcc_apply_owner_backfill', {
      p_map: ownerMap, p_set_by: 'sf_owner_backfill',
    }).catch((e) => ({ error: String(e?.message || e) }));

    return res.status(200).json({
      ok: true, sf_ids: sfIds.length,
      accounts: byObj.Account.length, opportunities: byObj.Opportunity.length,
      owners_returned: ownerMap.length, applied: apply?.data ?? apply, errors,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'sf_owner_sync_error', detail: String(e?.message || e).slice(0, 300) });
  }
}
