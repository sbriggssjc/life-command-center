// api/_shared/sf-list-import.js
// ============================================================================
// Salesforce "Lists" (Campaigns / CampaignMembers) ingest — pure classifiers +
// the deps-injected per-member orchestrator.
// ----------------------------------------------------------------------------
// Scott's SF "Lists" are standard Salesforce Campaigns in a hierarchy; "List
// members" are CampaignMembers. Confirmed live: `Team Briggs → Buyer Lists → GSA
// Buyer` (156 members: Nuveen, Ares, FD Stonewater, Easterly, Postal Realty
// Trust …) + seller-prospect lists named per broker ("JTS Seller Prospects",
// "KDL Seller Prospects"). Each member carries First / Last / Company / Email /
// Phone / City / State / CM Relationship / Type / Org Type / Last Activity.
//
// These lists are the richest contact source we have — segmented by product type
// (GSA / Dialysis / Drug Store / Industrial …), by side (buyer vs seller), and
// by broker. This module turns Salesforce's own curated lists into the LCC's
// outreach engine:
//   - reconcile each person by EMAIL (R39 tier) so an existing CoStar/RCA/SF
//     person is ATTACHED, never duplicated;
//   - relate the person to their Company as a person→org EDGE (never an identity
//     on the person — the SF-CONFLATION doctrine);
//   - record the list membership (product_type / side / broker) as the reusable
//     segmentation;
//   - route buyers → the P-BUYER buy-side contact pool, sellers → owner-prospect
//     (value-gated cadence) + the institution-registry seed.
//
// Reuse (never fork): ensureEntityLink (person/org mint + guards + email tier),
// contact-attach (linkPersonToEntity, stampContactOnActiveCadence →
// maybeSeedValuableCadence), contactPersonName (the SF-CONFLATION name choke
// point), normalizeInstitution (the sponsor match key). No SF writes; additive;
// reversible; never fabricate; LCC-Opps only.
// ============================================================================

import { contactPersonName } from './sf-account-link.js';
import { normalizeInstitution } from './institution-registry.js';

// ── Pure helpers ────────────────────────────────────────────────────────────

const s = (v) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * Build a tolerant field getter for ONE CampaignMember row. Salesforce "Get
 * records" carries the denormalized member fields (FirstName / LastName / Email /
 * Phone / City / State / CompanyOrAccount) for BOTH Lead- and Contact-linked
 * members, but the exact SHAPE varies by connector / flow: PascalCase top-level
 * scalars, lowercase keys, or the values nested under a `Lead` / `Contact`
 * relationship object. Read ALL of these so a Lead-linked member with real data
 * is NEVER dropped at the no-identity guard just because its fields arrived under
 * a different shape (the same defensive read as getSalesforceContactById). Pure.
 * Top-level scalars win; the nested Lead/Contact objects are a fallback.
 */
function buildMemberGetter(raw) {
  const flat = {};
  const fold = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v === null || v === undefined || typeof v === 'object') continue;
      const lk = k.toLowerCase();
      if (flat[lk] === undefined) flat[lk] = v;   // first writer wins → top-level precedence
    }
  };
  fold(raw);
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) {
      const lk = k.toLowerCase();
      if ((lk === 'lead' || lk === 'contact') && raw[k] && typeof raw[k] === 'object') fold(raw[k]);
    }
  }
  return (...spellings) => {
    for (const sp of spellings) {
      const v = flat[String(sp).toLowerCase()];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return undefined;
  };
}

/** Read a nested Salesforce relationship id (Lead.Id / Contact.Id), case-insensitively. */
function nestedRelId(raw, rel) {
  if (!raw || typeof raw !== 'object') return null;
  for (const k of Object.keys(raw)) {
    if (k.toLowerCase() === rel && raw[k] && typeof raw[k] === 'object') {
      for (const ik of Object.keys(raw[k])) {
        if (ik.toLowerCase() === 'id') return s(raw[k][ik]) || null;
      }
    }
  }
  return null;
}

/**
 * Normalize a CampaignMember (or a DOM-scraped member row) into a canonical
 * shape. Tolerant of BOTH the PA/SF connector field names (FirstName / LastName /
 * CompanyOrAccount / ContactId / LeadId / Type / Status) AND the shadow-DOM
 * scrape labels (First / Last / Company / CM Relationship / Team / Org Type /
 * Last Activity) — read case-insensitively and from nested Lead/Contact objects
 * so a Lead-linked member is read regardless of shape. Pure.
 */
export function normalizeMember(raw) {
  const g = buildMemberGetter(raw);
  const first = s(g('FirstName', 'First', 'first_name', 'first'));
  const last = s(g('LastName', 'Last', 'last_name', 'last'));
  const name = s(g('Name', 'FullName', 'name', 'full_name'));
  return {
    first,
    last,
    name,
    email: s(g('Email', 'email', 'ContactEmail')).toLowerCase() || null,
    phone: s(g('Phone', 'phone', 'MobilePhone')) || null,
    city: s(g('City', 'city', 'MailingCity')) || null,
    state: s(g('State', 'state', 'MailingState')) || null,
    company: s(g('CompanyOrAccount', 'Company', 'company', 'AccountName', 'account')) || null,
    // A CampaignMember links EITHER a Contact (ContactId) OR a Lead (LeadId),
    // and prospect/buyer/seller lists are OVERWHELMINGLY Leads. Capture BOTH
    // ids (top-level or nested) so processMember can key the SF identity on
    // whichever exists — never favour ContactId and drop the Lead path.
    sf_contact_id: s(g('ContactId', 'contact_id')) || nestedRelId(raw, 'contact'),
    sf_lead_id: s(g('LeadId', 'lead_id')) || nestedRelId(raw, 'lead'),
    // CampaignMember.Type (Sent / Responded …) vs CM Relationship (Open / Assigned).
    member_type: s(g('Type', 'member_type', 'MemberType')) || null,
    status: s(g('Status', 'CMRelationship', 'CM Relationship', 'cm_relationship')) || null,
    org_type: s(g('OrgType', 'Org Type', 'org_type')) || null,
    team: s(g('Team', 'team')) || null,
    last_activity: s(g('LastActivity', 'Last Activity', 'last_activity', 'LastActivityDate')) || null,
  };
}

/** The PERSON name — always from the CONTACT fields, never the company (the
 *  SF-CONFLATION name choke point). Returns a string or null. Pure. */
export function personNameFromMember(m) {
  return contactPersonName({ name: m.name, first: m.first, last: m.last });
}

// Product-type cues, scanned against a list's (parent + campaign) name. First
// match wins. Anchored to whole-word-ish patterns so a stray substring never
// mis-tags. Pure lookup table.
const PRODUCT_CUES = [
  [/\bgsa\b|government|federal(?:ly)?|\bva\b|social security/i, 'GSA'],
  [/dialysis|davita|fresenius|\brenal\b|us renal/i, 'Dialysis'],
  [/drug ?stores?|pharmac(?:y|ies)|walgreens|\bcvs\b|rite ?aid/i, 'Drug Store'],
  [/industrial|warehouse|distribution|logistics/i, 'Industrial'],
  [/\bbank(?:s|ing)?\b|santander|\bcredit union\b/i, 'Bank'],
  [/\bqsr\b|restaurants?|fast ?food|drive ?thru/i, 'QSR'],
  [/medical(?: office)?|\bmob\b|healthcare|clinic/i, 'Medical Office'],
  [/grocery|supermarket|grocer/i, 'Grocery'],
  [/convenience|c-?stores?|gas stations?|fuel/i, 'Convenience'],
  [/\bretail\b/i, 'Retail'],
  [/\boffice\b/i, 'Office'],
  [/entertainment|top ?golf|cinema|theat(?:er|re)/i, 'Entertainment'],
];

const SELLER_RE = /seller\s*prospect|seller\s*list|\bsellers?\b|owner\s*prospect/i;
const BUYER_RE = /\bbuyer\s*list|\bbuyers?\b|\bprincipals?\b|\bbuy[-\s]?side\b/i;

// Broker prefixes that front Team-Briggs seller-side lists ("SAB Seller
// Prospects", "SAB GSA Prospects", "KDL Seller Prospects/Industrial", …).
const BROKER_PREFIX_RE = /^\s*(SAB|KDL|NKB|JTS|DMR)\b/i;
// A name ending in "Owners" / "Owner" is a sell-side owner target list
// ("VCA Animal Hospital Owners", "Christian Brothers Owners", "DMR Urgent Care Owners").
const OWNERS_LIST_RE = /\bowners?\s*$/i;

/** Derive the product type from a list's combined name. null when no cue. Pure. */
export function deriveProductType(combined) {
  const t = s(combined);
  if (!t) return null;
  for (const [re, label] of PRODUCT_CUES) if (re.test(t)) return label;
  return null;
}

/**
 * Derive the broker prefix from a seller-list campaign name ("JTS Seller
 * Prospects" → "JTS"; "KDL Seller Prospects" → "KDL"). Returns null when the
 * remainder is empty, too long (>4 tokens), or is itself a product cue (so
 * "GSA Seller Prospects" → product, not broker). Pure.
 */
export function deriveBroker(campaignName) {
  const t = s(campaignName);
  if (!t) return null;
  // An explicit broker prefix (SAB / KDL / NKB / JTS / DMR) wins — "SAB GSA
  // Prospects" → "SAB", "KDL Seller Prospects/Industrial" → "KDL".
  const pm = t.match(BROKER_PREFIX_RE);
  if (pm) return pm[1].toUpperCase();
  // Otherwise derive a broker tag by stripping the prospect words — but ONLY
  // when a "seller"/"prospects" word is actually present, so a tenant/owner name
  // ("Christian Brothers Owners") is never mistaken for a broker.
  if (!/\b(seller|prospects?)\b/i.test(t)) return null;
  const remainder = t
    .replace(/\bseller\s*prospects?\b/ig, ' ')
    .replace(/\bseller\s*list\b/ig, ' ')
    .replace(/\bprospects?\b/ig, ' ')
    .replace(/\bsellers?\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!remainder) return null;
  if (remainder.split(' ').length > 3) return null;      // a real name, not a broker tag
  if (deriveProductType(remainder)) return null;         // "GSA" etc. is a product, not a broker
  return remainder;
}

/**
 * Classify a Salesforce List (Campaign) into { side, product_type, broker }.
 * side = 'buyer' | 'seller' | 'unknown'. Seller is tested BEFORE buyer (a
 * "* Seller Prospects" name is more specific). Pure.
 */
export function classifyList({ campaign_name, parent_name } = {}) {
  const camp = s(campaign_name);
  const parent = s(parent_name);
  const combined = `${parent} ${camp}`.trim();

  // A broker-prefixed "* Prospects" list ("SAB GSA Prospects", "NKB Prospects")
  // and any "* Owners" list are sell-side targets. Tested AFTER the explicit
  // buyer cue so "GSA Buyer" / "* Buyers" / "Buyer Lists" stay buyer.
  const brokerProspects = BROKER_PREFIX_RE.test(camp) && /\bprospects?\b/i.test(camp);
  const ownersList = OWNERS_LIST_RE.test(camp);

  let side = 'unknown';
  if (SELLER_RE.test(camp)) side = 'seller';
  else if (BUYER_RE.test(camp)) side = 'buyer';
  else if (brokerProspects || ownersList) side = 'seller';
  else if (SELLER_RE.test(parent)) side = 'seller';
  else if (BUYER_RE.test(parent)) side = 'buyer';

  const product_type = deriveProductType(combined);
  const broker = side === 'seller' ? deriveBroker(camp) : null;
  return { side, product_type, broker };
}

// ── The deps-injected per-member orchestrator ───────────────────────────────

/**
 * Process ONE CampaignMember: reconcile the person (by email — no dup), relate
 * to the company org, record the list membership, and route to the consumer.
 * Pure orchestration over injected deps so it unit-tests without touching the
 * real modules.
 *
 * listCtx: { campaign_id, campaign_name, parent_name, side, product_type,
 *            broker, workspaceId, userId }
 *
 * deps:
 *   ensureEntityLink(args)             -> { ok, entityId, resolvedByEmail, createdEntity } | { ok:false, skipped }
 *   linkPersonToEntity(args)           -> { ok }
 *   stampContactOnActiveCadence(args)  -> { ok, seeded? }
 *   recordMembership(row)              -> { ok }
 *   matchBuyerParent(orgEntityId)      -> Promise<boolean>          (buyer side)
 *   matchRegistryGap(company)          -> Promise<{match,institution_norm,institution_name,has_contact}|null> (seller side)
 *   seedInstitutionContact(args)       -> Promise<{ok,seeded}>      (seller side; flag-gated in handler)
 *
 * @returns granular per-member outcome (never throws — a bad member is skipped).
 */
export async function processMember(rawMember, listCtx, deps) {
  const m = normalizeMember(rawMember);
  const personName = personNameFromMember(m);

  // A member with neither a name nor an email is not resolvable — never mint a
  // blank person.
  if (!personName && !m.email) {
    return { outcome: 'skipped', reason: 'no_identity', side: listCtx.side };
  }

  // 1. Reconcile the PERSON (R39 email tier: an existing CoStar/RCA/SF person
  //    with the same email ATTACHES, never a duplicate). Keyed on ContactId
  //    (Contact) or LeadId (Lead) under source_system='salesforce' so the SF
  //    identity is picked up; guards reject junk.
  const externalId = m.sf_contact_id || m.sf_lead_id || undefined;
  const idType = m.sf_contact_id ? 'Contact' : (m.sf_lead_id ? 'Lead' : 'person');
  const seedFields = { name: personName || undefined, entity_type: 'person', domain: 'lcc' };
  // Pass the structured name so inferEntityType resolves a name-only Lead (no
  // email/phone) to a PERSON, not the org default.
  if (m.first) seedFields.first_name = m.first;
  if (m.last) seedFields.last_name = m.last;
  if (m.email) seedFields.email = m.email;
  if (m.phone) seedFields.phone = m.phone;

  const person = await deps.ensureEntityLink({
    workspaceId: listCtx.workspaceId,
    userId: listCtx.userId,
    sourceSystem: externalId ? 'salesforce' : undefined,
    sourceType: externalId ? idType : 'person',
    externalId,
    domain: 'lcc',
    seedFields,
    metadata: { via: 'sf_list_import', campaign_id: listCtx.campaign_id },
  });
  if (!person || !person.ok || !person.entityId) {
    return { outcome: 'guard_rejected', reason: (person && (person.skipped || person.error)) || 'no_entity', side: listCtx.side };
  }
  const personEntityId = person.entityId;

  // 2. Resolve/create the COMPANY as an ORGANIZATION entity (dedup by
  //    canonical_name → reuses an existing owner/buyer org) and relate the
  //    person to it as an edge (person → org, works_at). Never an identity on
  //    the person (SF-CONFLATION doctrine).
  let orgEntityId = null;
  if (m.company) {
    const org = await deps.ensureEntityLink({
      workspaceId: listCtx.workspaceId,
      userId: listCtx.userId,
      sourceType: 'organization',
      domain: 'lcc',
      seedFields: { name: m.company, org_type: 'company' },
      metadata: { via: 'sf_list_import' },
    });
    if (org && org.ok && org.entityId && org.entityId !== personEntityId) orgEntityId = org.entityId;
  }
  if (orgEntityId) {
    await deps.linkPersonToEntity({
      workspaceId: listCtx.workspaceId,
      entityId: orgEntityId, contactEntityId: personEntityId,
      role: 'works_at', via: 'sf_list_import',
    });
  }

  // 3. Record the list membership (the reusable segmentation).
  await deps.recordMembership({
    entity_id: personEntityId,
    campaign_id: listCtx.campaign_id,
    campaign_name: listCtx.campaign_name || null,
    parent_name: listCtx.parent_name || null,
    product_type: listCtx.product_type || null,
    side: listCtx.side,
    broker: listCtx.broker || m.team || null,
    status: m.status,
    member_type: m.member_type,
    city: m.city,
    state: m.state,
    company_name: m.company,
    org_entity_id: orgEntityId,
    sf_contact_id: m.sf_contact_id,
    sf_lead_id: m.sf_lead_id,
    last_activity: m.last_activity,
    raw: { first: m.first, last: m.last, org_type: m.org_type },
  });

  const out = {
    outcome: 'processed',
    side: listCtx.side,
    person_entity_id: personEntityId,
    org_entity_id: orgEntityId,
    resolved_by_email: !!person.resolvedByEmail,
    created_entity: !!person.createdEntity,
    buyer_parent_match: false,
    cadence_seeded: false,
    registry_seeded: false,
  };

  // 4. Route to the consumer.
  if (listCtx.side === 'buyer') {
    // The person→org edge already makes them selectable in the P-BUYER buy-side
    // contact picker (which pulls related persons of the parent). Flag when the
    // company IS a registered buyer parent. NO prospecting cadence — buyers run
    // the buy-side flow, never a prospect (R5 doctrine).
    if (orgEntityId && deps.matchBuyerParent) {
      try { out.buyer_parent_match = !!(await deps.matchBuyerParent(orgEntityId)); } catch (_e) { /* soft */ }
    }
  } else if (listCtx.side === 'seller') {
    // Owner-prospect: value-gated cadence on the OWNER org (the person is its
    // contact). Below the value floor → no seed (no low-value cadence spam).
    if (orgEntityId && deps.stampContactOnActiveCadence) {
      try {
        const stamp = await deps.stampContactOnActiveCadence({
          entityId: orgEntityId, contactEntityId: personEntityId,
          onlyContactless: true, seedIfValuable: true,
        });
        out.cadence_seeded = !!(stamp && stamp.seeded);
      } catch (_e) { /* soft */ }
    }
    // Institution-registry seed: when the seller's company IS a sponsor with
    // contactless valued SPEs and NO registry contact yet, this real curated
    // contact is exactly the one the Tier A fan-out needs. Flag-gated by the
    // handler (seedInstitutionContact absent ⇒ recorded as a candidate only).
    if (m.company && deps.matchRegistryGap && personName) {
      try {
        const gap = await deps.matchRegistryGap(m.company);
        if (gap && gap.match && !gap.has_contact) {
          out.registry_gap = gap.institution_name || m.company;
          if (deps.seedInstitutionContact) {
            const seed = await deps.seedInstitutionContact({
              institution_name: gap.institution_name || m.company,
              institution_norm: gap.institution_norm || normalizeInstitution(m.company),
              contact: { name: personName, email: m.email, phone: m.phone, title: null },
            });
            out.registry_seeded = !!(seed && seed.seeded);
          }
        }
      } catch (_e) { /* soft */ }
    }
  }

  return out;
}
