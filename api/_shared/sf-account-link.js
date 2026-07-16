// api/_shared/sf-account-link.js
// ============================================================================
// SF-CONFLATION Unit C + B — the SF-Account modeling choke point
// ----------------------------------------------------------------------------
// Doctrine (Scott, 2026-07-16 — ORE_SF_AS_SOURCE_AUDIT): LCC is the source of
// truth; Salesforce is a useful-but-not-highest-accuracy source. When SF gives
// us a conflated record for one party, the LCC resolves it ON THE LCC SIDE —
// bind the most-accurate SF record and demote the rest — never touching SF.
//
// Two modeling errors this module fixes at the mint (Unit C), and the
// autonomous binding it applies (Unit B):
//
//   C1 — never let an SF ACCOUNT NAME become a PERSON's name. The person name
//        always derives from the CONTACT fields (name/first/last). See
//        contactPersonName(); the SF-contact mint (defaultResolveOrCreateSfContact)
//        never passes account_name into the entity name.
//   C2 — relate a person to their SF Account as an ORG EDGE, not by stamping a
//        `salesforce/Account` external-identity ON the person. syncSalesforceForEntity
//        used to stamp the companion Account identity on the person (the source of
//        the 559 `salesforce/Account`-on-person rows, Capra's rel_count=0). Now:
//        resolve/create the SF Account as an ORGANIZATION entity (the account
//        identity lives on the ORG) and write an `associated_with` edge
//        person→org — so the graph RELATES the person to Boyd rather than TAGGING
//        the person AS Boyd. The account id is kept in the person's
//        metadata.sf_account for provenance.
//   B  — email-domain-authoritative binding. When the SF Account name DISAGREES
//        with the person's email-domain firm (Dowling @boydwatterson.com on
//        account "Arbor Realty Trust"), do NOT bind that account. Bind a
//        confident email-domain org instead (autonomous), else surface the
//        existing sf_contact_account_mismatch Decision-Center lane (the fallback
//        for genuine ambiguity), recording the disagreeing account as demoted.
//
// No SF writes anywhere. Additive · reversible · guarded · never fabricate.
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';
import {
  ensureEntityLink,
  normalizeEmail,
  isGenericInboxEmail,
} from './entity-link.js';
import { linkPersonToEntity } from './contact-attach.js';
import { toSf18 } from './sf-id.js';

// Free personal-mail domains carry NO firm signal, so account agreement can't be
// judged against them (a broker with a gmail address is not "wrong account").
export const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com',
  'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'comcast.net',
  'protonmail.com', 'proton.me', 'gmx.com', 'att.net', 'sbcglobal.net', 'verizon.net',
]);

// Collapse a name/label to a comparable alnum core ("Boyd Watterson" → "boydwatterson").
export function orgCore(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

/**
 * Unit-3 detector (pure). An SF Contact whose EMAIL DOMAIN org-token contradicts
 * its SF ACCOUNT name is a Salesforce-side data-quality error (Eric Dowling
 * `edowling@boydwatterson.com` filed under account "Arbor Realty Trust"). LCC
 * flags it — it does NOT inherit the wrong account.
 *
 * Conservative — returns `mismatch:true` ONLY when BOTH signals are strong:
 *   - the email domain is a real firm domain (non-generic inbox, non-personal),
 *     distinctive second-level label ≥ 4 chars (boydwatterson.com → "boydwatterson");
 *   - the account name collapses to ≥ 4 alnum chars;
 *   - NEITHER core contains the other (no agreement).
 * Any weak / agreeing / generic case ⇒ `mismatch:false`.
 *
 * Single source of truth for the SF-account/email-domain agreement signal —
 * re-exported from sf-activity-ingest.js for the existing importers.
 */
export function sfContactAccountMismatch({ email, accountName } = {}) {
  const e = normalizeEmail(email);
  if (!e || isGenericInboxEmail(e)) return { mismatch: false };
  const domain = (e.split('@')[1] || '').trim();
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) return { mismatch: false };
  const acct = String(accountName || '').trim();
  if (!acct) return { mismatch: false };
  const labels = domain.split('.');
  const domainLabel = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  const domainCore = orgCore(domainLabel);
  if (domainCore.length < 4) return { mismatch: false };
  const acctCore = orgCore(acct);
  if (acctCore.length < 4) return { mismatch: false };
  if (acctCore.includes(domainCore) || domainCore.includes(acctCore)) {
    return { mismatch: false, domain_label: domainLabel, account_name: acct };
  }
  return { mismatch: true, email_domain: domain, domain_label: domainLabel, account_name: acct };
}

/**
 * Unit C1 — the PERSON name always comes from the CONTACT fields, never the SF
 * account name. Prefer a plausible-person `name`; else first+last; else the raw
 * `name`. (A caller must NOT pass an account name in as `name` — this function
 * has no access to the account name by design.)
 * Returns the derived name string, or null when nothing usable is present.
 */
export function contactPersonName({ name, first, last } = {}) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const f = clean(first), l = clean(last), n = clean(name);
  // Prefer the STRUCTURED first+last — the contact's own name fields — over a
  // free-text `name` that could be contaminated by a firm / account string (the
  // "Boyd Watterson Global on Eric Dowling" bleed). When only `name` is present
  // it is the SF Contact's own name (a Contact object's Name is the person).
  if (f && l) return `${f} ${l}`;
  if (n) return n;
  return f || l || null;
}

/**
 * Unit B — email-domain-authoritative binding decision (pure). Given a person's
 * email + a candidate SF account name, decide whether to bind that account:
 *   { bind:'account' } — agrees OR cannot be judged (personal/generic/no-email):
 *                        the account is the best signal we have.
 *   { bind:'none', mismatch:true } — the account DISAGREES with the email domain
 *                        (the wrong-account case): do NOT bind it.
 * Never bind when there is no account name to work with.
 */
export function accountBindingDecision({ email, accountName } = {}) {
  const acct = String(accountName || '').trim();
  if (!acct) return { bind: 'none', mismatch: false, reason: 'no_account_name' };
  const mm = sfContactAccountMismatch({ email, accountName: acct });
  if (mm.mismatch) return { bind: 'none', mismatch: true, email_domain: mm.email_domain };
  return { bind: 'account', mismatch: false };
}

// Merge sf_account provenance into a person entity's metadata (read-modify-write,
// never clobbers other metadata). Best-effort. `demotedId` optionally appends a
// disagreeing account id to metadata.sf_account.demoted.
async function mergePersonSfAccountMeta(entityId, { accountId, accountName, batchTag, demotedId } = {}) {
  try {
    const read = await opsQuery('GET', `entities?id=eq.${pgFilterVal(entityId)}&select=metadata&limit=1`);
    if (!read.ok || !Array.isArray(read.data) || !read.data.length) return false;
    const existing = read.data[0].metadata || {};
    const prev = (existing.sf_account && typeof existing.sf_account === 'object') ? existing.sf_account : {};
    const demoted = Array.isArray(prev.demoted) ? prev.demoted.slice() : [];
    if (demotedId && !demoted.includes(demotedId)) demoted.push(demotedId);
    const sf_account = {
      ...prev,
      ...(accountId ? { id: accountId } : {}),
      ...(accountName ? { name: accountName } : {}),
      ...(batchTag ? { via: batchTag } : {}),
      ...(demoted.length ? { demoted } : {}),
      updated_at: undefined, // stay deterministic — the ledger carries the time
    };
    delete sf_account.updated_at;
    const merged = { ...existing, sf_account };
    const upd = await opsQuery('PATCH', `entities?id=eq.${pgFilterVal(entityId)}`, { metadata: merged });
    return !!upd.ok;
  } catch (_e) { return false; }
}

// Conservative email-domain org lookup (Unit B disagree path). Returns the org
// entity id ONLY when EXACTLY ONE non-tombstoned organization's canonical/name
// core equals the email-domain core — else null (→ the mismatch lane). Never
// creates an org here (we have no confident name), never guesses on ambiguity.
async function findUniqueEmailDomainOrg({ email, workspaceId }) {
  const e = normalizeEmail(email);
  if (!e || isGenericInboxEmail(e)) return null;
  const domain = (e.split('@')[1] || '').trim();
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) return null;
  const labels = domain.split('.');
  const core = orgCore(labels.length >= 2 ? labels[labels.length - 2] : labels[0]);
  if (core.length < 4) return null;
  try {
    // Cheap prefilter: orgs whose name starts with the domain-label's first token.
    const like = encodeURIComponent(`${core.slice(0, 4)}%`);
    let path = `entities?entity_type=eq.organization&merged_into_entity_id=is.null`
      + `&name=ilike.${like}&select=id,name,canonical_name&limit=50`;
    if (workspaceId) path += `&workspace_id=eq.${pgFilterVal(workspaceId)}`;
    const r = await opsQuery('GET', path);
    if (!r.ok || !Array.isArray(r.data)) return null;
    const hits = r.data.filter((o) => orgCore(o.name) === core || orgCore(o.canonical_name) === core);
    const distinct = Array.from(new Set(hits.map((o) => o.id)));
    return distinct.length === 1 ? distinct[0] : null;
  } catch (_e) { return null; }
}

/**
 * Unit C2 + B — relate a PERSON to their Salesforce Account as an ORG EDGE (never
 * stamp `salesforce/Account` on the person). Best-effort; never throws.
 *
 * Behaviour:
 *   - Always record provenance on the person (metadata.sf_account = {id,name}).
 *   - No accountName ⇒ we cannot mint a well-named org → provenance only, no bind
 *     (and, crucially, NO account identity on the person). Return bound:'none'.
 *   - Account AGREES with the email domain (or can't be judged) ⇒ resolve/create
 *     the SF Account as an ORGANIZATION entity (identity on the ORG) + person→org
 *     `associated_with` edge. Return bound:'account_org'.
 *   - Account DISAGREES (wrong-account) ⇒ do NOT bind it. If a unique email-domain
 *     org exists, bind person→that org and record the account as demoted; else
 *     return needs_lane:true (the mismatch lane is the fallback).
 *
 * @returns {Promise<{ok:boolean, bound:'account_org'|'email_domain_org'|'none',
 *   orgEntityId?:string, needs_lane?:boolean, reason?:string, demoted?:string[]}>}
 */
export async function relatePersonToSfAccount({
  workspaceId, userId, personEntityId, personEmail, accountId, accountName, domain,
  via = 'sf_account_link', deps = {},
}) {
  if (!personEntityId || !accountId) return { ok: false, bound: 'none', reason: 'missing_input' };
  const ensureLink = deps.ensureEntityLink || ensureEntityLink;
  const linkPerson = deps.linkPersonToEntity || linkPersonToEntity;
  const mergeMeta  = deps.mergePersonSfAccountMeta || mergePersonSfAccountMeta;
  const findOrg    = deps.findUniqueEmailDomainOrg || findUniqueEmailDomainOrg;

  const acctId18 = toSf18(accountId) || String(accountId).trim();
  const acctName = (typeof accountName === 'string' ? accountName.trim() : '') || null;

  // Provenance always (never lose the linkage even when we don't bind an org).
  await mergeMeta(personEntityId, { accountId: acctId18, accountName: acctName, batchTag: via });

  // No name ⇒ cannot mint a good org. Never stamp the account identity on the
  // person. Keep the provenance and stop.
  if (!acctName) return { ok: true, bound: 'none', reason: 'no_account_name' };

  const decision = accountBindingDecision({ email: personEmail, accountName: acctName });

  if (decision.bind === 'account') {
    // Resolve/create the SF Account ORG entity — the `salesforce/Account` identity
    // lands on the ORG, not the person — then relate the person to it.
    const orgLink = await ensureLink({
      workspaceId, userId,
      sourceSystem: 'salesforce', sourceType: 'Account', externalId: acctId18,
      domain,
      seedFields: { name: acctName, org_type: 'company', domain },
      metadata: { via, source: 'sf_account_of_contact' },
    });
    if (orgLink && orgLink.ok && orgLink.entityId) {
      if (orgLink.entityId === personEntityId) {
        // Degenerate (the account resolved to the person itself) — never self-link.
        return { ok: true, bound: 'none', reason: 'org_is_person' };
      }
      await linkPerson({
        workspaceId, entityId: orgLink.entityId, contactEntityId: personEntityId,
        role: 'works_at', via,
      });
      return { ok: true, bound: 'account_org', orgEntityId: orgLink.entityId };
    }
    return { ok: false, bound: 'none', reason: (orgLink && (orgLink.skipped || orgLink.error)) || 'org_link_failed' };
  }

  // DISAGREE — the SF account is the wrong company. Never bind it. Record it as
  // demoted; bind a confident email-domain org if one exists, else the lane.
  await mergeMeta(personEntityId, { demotedId: acctId18 });
  const emailOrgId = await findOrg({ email: personEmail, workspaceId });
  if (emailOrgId && emailOrgId !== personEntityId) {
    await linkPerson({
      workspaceId, entityId: emailOrgId, contactEntityId: personEntityId,
      role: 'works_at', via: via + ':email_domain',
    });
    return { ok: true, bound: 'email_domain_org', orgEntityId: emailOrgId, demoted: [acctId18] };
  }
  return { ok: true, bound: 'none', needs_lane: true, reason: 'account_email_mismatch', demoted: [acctId18] };
}
