// api/_shared/salesforce-sync.js
// ============================================================================
// Reusable Salesforce sync primitive. Call this any time LCC creates, merges,
// or links a canonical record that could plausibly have a twin in Salesforce:
//
//   - ensureEntityLink() after a new entity is created
//   - unified_contacts inserts / merges
//   - true_owner + recorded_owner linking
//   - broker contact resolution
//
// The helper is best-effort and NEVER throws. If Salesforce isn't configured
// (no SF_LOOKUP_WEBHOOK_URL), if the lookup times out, or if the PA flow
// returns an error, we log and return { ok:false, reason:'…' } — the caller
// carries on with its primary work.
//
// Mechanics:
//   1. Decide what kind of lookup to run (org → Account by name, person → Contact by email).
//   2. Run the lookup via the existing Power Automate proxy in salesforce.js.
//   3. If a match is found:
//        a) Upsert an external_identities row (source_system='salesforce',
//           source_type='Account'|'Contact', external_id=<SF Id>) so the LCC
//           entity graph shows the link.
//        b) Merge metadata.salesforce = {account_id,contact_id,matched_at,score}
//           on the entity row for easy surfacing in the sidebar.
//   4. Return { ok:true, matched:true, sf_id, sf_url, score }.
//      If no match: { ok:true, matched:false, reason:'no_good_match' }.
//
// Every side effect is gated on a match — we never touch LCC DB on lookup
// failure, so this is safe to call liberally (idempotent in both directions).
// ============================================================================

import {
  isSalesforceConfigured,
  findSalesforceAccountByName,
  findSalesforceContactByEmail,
} from './salesforce.js';
import { opsQuery, pgFilterVal } from './ops-db.js';

const INSTANCE_URL = process.env.SF_INSTANCE_URL || ''; // optional: for building deep links

function buildSfDeepLink(kind, sfId) {
  if (!INSTANCE_URL || !sfId) return null;
  const base = INSTANCE_URL.replace(/\/+$/, '');
  return `${base}/lightning/r/${kind}/${sfId}/view`;
}

/**
 * Write SF linkage onto an LCC entity (external_identities + metadata merge).
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string} args.entityId
 * @param {'Account'|'Contact'} args.kind
 * @param {string} args.sfId
 * @param {string=} args.sfName
 * @param {number=} args.score
 * @param {string=} args.accountId - companion account id when kind='Contact'
 */
async function writeEntitySalesforceLink({ workspaceId, entityId, kind, sfId, sfName, score, accountId }) {
  const now = new Date().toISOString();

  // 1) external_identities upsert (idempotent on workspace/source_system/source_type/external_id).
  const externalUrl = buildSfDeepLink(kind, sfId);
  const identityRes = await opsQuery('POST',
    'external_identities?on_conflict=workspace_id,source_system,source_type,external_id',
    {
      workspace_id: workspaceId,
      entity_id:    entityId,
      source_system: 'salesforce',
      source_type:  kind,
      external_id:  sfId,
      external_url: externalUrl,
      metadata:     {
        sf_name:    sfName || null,
        sf_score:   typeof score === 'number' ? score : null,
        sf_account: accountId || null,
        synced_via: 'salesforce-sync.v1',
      },
      last_synced_at: now,
    },
    { 'Prefer': 'return=representation,resolution=merge-duplicates' }
  );

  // 2) Merge into entities.metadata.salesforce — keeps the sidebar one hop
  //    away from an SF deep link without having to scan external_identities.
  //
  // We PATCH with a JSONB merge: pull current metadata, layer salesforce on
  // top, write back. The read-modify-write is 1 round trip each; both happen
  // post-entity-create so PostgREST's row-lock is very brief.
  try {
    const entityRead = await opsQuery('GET',
      `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}&select=metadata&limit=1`
    );
    if (entityRead.ok && entityRead.data?.length) {
      const existing = entityRead.data[0].metadata || {};
      const merged = {
        ...existing,
        salesforce: {
          ...(existing.salesforce || {}),
          [kind === 'Account' ? 'account_id' : 'contact_id']: sfId,
          [kind === 'Account' ? 'account_name' : 'contact_name']: sfName || null,
          [kind === 'Account' ? 'account_score' : 'contact_score']: score ?? null,
          ...(kind === 'Contact' && accountId ? { account_id: existing.salesforce?.account_id || accountId } : {}),
          last_synced_at: now,
        },
      };
      await opsQuery('PATCH',
        `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}`,
        { metadata: merged }
      );
    }
  } catch (err) {
    console.warn('[salesforce-sync] metadata merge failed (non-fatal):', err?.message || err);
  }

  return { ok: identityRes.ok, externalUrl };
}

/**
 * Primary entry point — hook this into any spot where LCC creates/merges/links
 * a canonical record. Safe to call even when SF isn't configured (no-ops).
 *
 * @param {object} args
 * @param {string}  args.workspaceId
 * @param {string=} args.entityId       - LCC entity UUID (optional; if absent,
 *                                        we look up by name+workspace)
 * @param {'person'|'organization'|'asset'=} args.entityType
 * @param {string=} args.name           - Preferred for org lookups
 * @param {string=} args.email          - Preferred for person lookups
 * @param {string=} args.reason         - Short note ('contact_merge', 'owner_link', …) for logs
 * @returns {Promise<{ok:boolean, matched?:boolean, kind?:string, sf_id?:string, sf_url?:string, score?:number, reason?:string}>}
 */
export async function syncSalesforceForEntity({ workspaceId, entityId, entityType, name, email, reason }) {
  if (!isSalesforceConfigured()) {
    return { ok: false, reason: 'sf_not_configured' };
  }
  if (!workspaceId) {
    return { ok: false, reason: 'no_workspace' };
  }

  // Decide which lookup to run. Persons prefer email; orgs use name.
  const isPerson = entityType === 'person' || (!entityType && !!email);
  try {
    if (isPerson) {
      if (!email) return { ok: true, matched: false, reason: 'no_email' };
      const lookup = await findSalesforceContactByEmail(email);
      if (!lookup.ok)      return { ok: false, reason: lookup.reason || 'sf_lookup_failed' };
      if (!lookup.contact) return { ok: true, matched: false, reason: lookup.reason || 'no_match' };

      const c = lookup.contact;
      if (entityId) {
        await writeEntitySalesforceLink({
          workspaceId, entityId,
          kind: 'Contact',
          sfId: c.Id,
          sfName: c.Name || null,
          accountId: c.AccountId || null,
        });
        // Also record a companion Account link when the contact carries one.
        if (c.AccountId) {
          await writeEntitySalesforceLink({
            workspaceId, entityId,
            kind: 'Account',
            sfId: c.AccountId,
            sfName: c.Account?.Name || null,
          });
        }
      }
      console.log(`[salesforce-sync] matched person via email (${reason || 'n/a'})`, {
        entityId, email, sf_contact_id: c.Id
      });
      return {
        ok: true,
        matched: true,
        kind: 'Contact',
        sf_id: c.Id,
        sf_url: buildSfDeepLink('Contact', c.Id),
      };
    }

    // Organization / asset path — lookup by name.
    if (!name) return { ok: true, matched: false, reason: 'no_name' };
    const lookup = await findSalesforceAccountByName(name);
    if (!lookup.ok)      return { ok: false, reason: lookup.reason || 'sf_lookup_failed' };
    if (!lookup.account) return { ok: true, matched: false, reason: lookup.reason || 'no_match' };

    const a = lookup.account;
    if (entityId) {
      await writeEntitySalesforceLink({
        workspaceId, entityId,
        kind: 'Account',
        sfId: a.Id,
        sfName: a.Name || null,
        score: lookup.score,
      });
    }
    console.log(`[salesforce-sync] matched org via name (${reason || 'n/a'})`, {
      entityId, name, sf_account_id: a.Id, score: lookup.score
    });
    return {
      ok: true,
      matched: true,
      kind: 'Account',
      sf_id: a.Id,
      sf_url: buildSfDeepLink('Account', a.Id),
      score: lookup.score,
    };
  } catch (err) {
    console.warn('[salesforce-sync] exception (non-fatal):', err?.message || err);
    return { ok: false, reason: 'exception', detail: err?.message || String(err) };
  }
}

/**
 * Thin wrapper for rows in domain tables that already carry sf_account_id /
 * sf_contact_id / sf_last_synced columns (gov.contacts, gov.true_owners,
 * dia.contacts, lcc_opps.unified_contacts). Keeps the "look up then PATCH
 * sf_* columns" dance in one place so callers don't re-implement it.
 *
 * Callers still decide which table/URL to PATCH — this helper just does the
 * SF lookup and normalizes the response. Returns null on no match.
 *
 * @param {object} args
 * @param {'person'|'organization'} args.kind
 * @param {string=} args.name
 * @param {string=} args.email
 * @param {string=} args.reason
 */
export async function lookupSalesforceIds({ kind, name, email, reason }) {
  if (!isSalesforceConfigured()) return null;
  try {
    if (kind === 'person' && email) {
      const r = await findSalesforceContactByEmail(email);
      if (r.ok && r.contact) {
        return {
          sf_contact_id: r.contact.Id,
          sf_account_id: r.contact.AccountId || null,
          sf_name:       r.contact.Name || null,
          reason,
        };
      }
    } else if (kind === 'organization' && name) {
      const r = await findSalesforceAccountByName(name);
      if (r.ok && r.account) {
        return {
          sf_account_id: r.account.Id,
          sf_name:       r.account.Name || null,
          score:         r.score,
          reason,
        };
      }
    }
  } catch (err) {
    console.warn('[salesforce-sync.lookupSalesforceIds] exception:', err?.message || err);
  }
  return null;
}
