// api/_handlers/sf-seller-owner.js
// ============================================================================
// SF-seller property-owner feeder — resolves the PROPERTY owner for OUR OWN
// listings from the deal's Salesforce Account (our client/seller), which the
// relationship graph doesn't carry (our open listings have ~0 owns/purchases
// edges — see docs/architecture/property-owner-subsystem.md). Feeds the SAME
// property-owner subsystem built there — no new reconciler.
//
// Route: POST /api/sf-seller-owner  (admin _route='sf-seller-owner')
//   Receiver mode — body { mappings:[{ deal_entity_id, account_id, account_name,
//                          observed_at? }] } → resolve account org + record + reconcile.
//                   Testable now (supply a mapping); no connector needed.
//   Worker mode   — no body: sweep open deals (sf_opp_id, no property owner yet) →
//                   getSalesforceOpportunityAccounts (SF flow op 'opportunities_by_ids')
//                   → resolve + record + reconcile. Inert until that flow op exists.
//
// REUSES: ensureEntityLink (account→org entity, the R4-A choke point),
//   lcc_record_property_owner_evidence + lcc_reconcile_property_owner (subsystem),
//   getSalesforceOpportunityAccounts (salesforce.js). Additive · reversible · never throws.
// ============================================================================
import { opsQuery, resolvePrimaryWorkspaceId } from '../_shared/ops-db.js';
import { ensureEntityLink } from '../_shared/entity-link.js';
import { toSf18 } from '../_shared/sf-id.js';
import { getSalesforceOpportunityAccounts, isSalesforceConfigured } from '../_shared/salesforce.js';

const SYS = 'b0000000-0000-0000-0000-000000000001';
const WS_FALLBACK = 'a0000000-0000-0000-0000-000000000001';
// sf_seller = the deal's Salesforce Opportunity Account: a broker-entered CRM hint,
// NOT truth (doctrine: SF is one reconcilable source, never automatically accurate).
// Weight 3.5 sits on the authority ladder BELOW manual (8) / deed_recorded (6) /
// rel_purchase (4) — so a recorded purchase transfers ownership on a close and any
// higher-authority source wins — while still resolving our own listings when it is
// the only evidence. Keep in sync with migration 20260818310000.
const SF_SELLER_WEIGHT = 3.5;

async function recordSellerOwner(dealEntityId, accountId, accountName, ws, observedAt) {
  if (!dealEntityId || !accountId) return { ok: false, reason: 'missing_input' };
  const acct18 = toSf18(accountId) || String(accountId).trim();
  // Resolve/create the SF Account as an ORGANIZATION entity (identity on the org) —
  // the same path relatePersonToSfAccount uses, so accounts collapse to one org.
  let orgLink = null;
  try {
    orgLink = await ensureEntityLink({
      workspaceId: ws, userId: SYS,
      sourceSystem: 'salesforce', sourceType: 'Account', externalId: acct18,
      seedFields: { name: accountName || null, org_type: 'company' },
      metadata: { via: 'sf_seller_owner', source: 'opportunity_account' },
    });
  } catch (_e) { orgLink = null; }
  if (!orgLink || !orgLink.ok || !orgLink.entityId) {
    return { ok: false, reason: (orgLink && (orgLink.skipped || orgLink.error)) || 'org_link_failed' };
  }
  if (orgLink.entityId === dealEntityId) return { ok: false, reason: 'org_is_asset' };

  try {
    await opsQuery('POST', 'rpc/lcc_record_property_owner_evidence', {
      p_entity_id: dealEntityId, p_candidate: orgLink.entityId, p_source: 'sf_seller',
      p_weight: SF_SELLER_WEIGHT, p_observed_at: observedAt || new Date().toISOString(),
      p_detail: { account_id: acct18, account_name: accountName || null },
    });
    const rc = await opsQuery('POST', 'rpc/lcc_reconcile_property_owner', { p_entity_id: dealEntityId });
    const packet = Array.isArray(rc?.data) ? rc.data[0] : rc?.data;
    return { ok: true, org_entity_id: orgLink.entityId, wrote: !!packet?.wrote, owner_name: packet?.owner_name };
  } catch (e) {
    return { ok: false, reason: 'record_error', detail: String(e?.message || e).slice(0, 200) };
  }
}

export async function handleSfSellerOwner(req, res) {
  try {
    const ws = (await resolvePrimaryWorkspaceId({ opsQuery }).catch(() => null)) || WS_FALLBACK;
    const body = req.body || {};

    // Receiver mode — caller supplies opp→account mappings.
    if (Array.isArray(body.mappings) && body.mappings.length) {
      let resolved = 0; const errors = [];
      for (const m of body.mappings) {
        const r = await recordSellerOwner(m.deal_entity_id, m.account_id, m.account_name, ws, m.observed_at);
        if (r.ok && r.wrote) resolved++; else errors.push({ deal_entity_id: m.deal_entity_id, reason: r.reason });
      }
      return res.status(200).json({ ok: true, mode: 'receiver', resolved, errors });
    }

    // Worker mode — sweep open deals lacking a property owner, look up their Account.
    if (!isSalesforceConfigured()) {
      return res.status(200).json({
        ok: false, reason: 'sf_not_configured',
        hint: "Set SF_LOOKUP_WEBHOOK_URL and add the 'opportunities_by_ids' flow op. Receiver mode works now.",
      });
    }
    const limit = req.query?.limit ? Number(req.query.limit) : 200;
    // Open deals with an sf_opp_id and no property owner yet.
    const deals = await opsQuery('GET',
      'bd_opportunities?select=entity_id,sf_opp_id&is_open=is.true&entity_id=not.is.null&sf_opp_id=not.is.null&limit=' + limit)
      .catch(() => null);
    const rows = (deals?.data || []).filter((d) => d.entity_id && d.sf_opp_id);
    // Filter to those without a resolved property owner.
    const need = [];
    for (const d of rows) {
      const po = await opsQuery('GET', `lcc_property_owner?entity_id=eq.${d.entity_id}&select=entity_id&limit=1`).catch(() => null);
      if (!(po?.data && po.data[0])) need.push(d);
    }
    if (!need.length) return res.status(200).json({ ok: true, mode: 'worker', deals_needing: 0, resolved: 0 });

    const oppToDeal = new Map(need.map((d) => [String(d.sf_opp_id).trim(), d.entity_id]));
    const lookup = await getSalesforceOpportunityAccounts([...oppToDeal.keys()]);
    if (!lookup.ok) return res.status(200).json({ ok: false, mode: 'worker', reason: lookup.reason, detail: lookup.detail });

    let resolved = 0; const errors = [];
    for (const a of (lookup.accounts || [])) {
      const dealEntityId = oppToDeal.get(String(a.opp_id).trim());
      if (!dealEntityId) continue;
      const r = await recordSellerOwner(dealEntityId, a.account_id, a.account_name, ws);
      if (r.ok && r.wrote) resolved++; else errors.push({ deal_entity_id: dealEntityId, reason: r.reason });
    }
    return res.status(200).json({ ok: true, mode: 'worker', deals_needing: need.length, accounts: (lookup.accounts || []).length, resolved, errors });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'sf_seller_owner_error', detail: String(e?.message || e).slice(0, 300) });
  }
}
