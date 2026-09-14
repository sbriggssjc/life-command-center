// ============================================================================
// LCC Assistant — Broker→Owner mis-attribution guard
// Pure, DOM-free reconciliation over the assembled `contacts[]` array. Loaded as
// a content script before costar.js (manifest order); also importable from Node
// for unit tests. Publishes `globalThis.__lccBrokerOwnerReconcile`.
//
// WHY
//   CoStar's for-sale summary renders the listing-broker contact card adjacent
//   to the owner panel, and the redesigned "Contacts" tab prints the role label
//   AFTER the name ("Bradley Veo Timmons" then "True Owner"), so the DOM/text
//   extractors slot the listing broker's email/phone — and sometimes the broker
//   person itself — into the "Current/True Owner" rows. Observed live
//   (3710 FM 1889, Robstown TX): a Newmark broker's `…@nmrk.com` email + phone
//   attributed to three separate "Current Owner" rows (Leighton Hopkins, the
//   "Associate" title line, and the "Newmark" firm), so the sidebar showed the
//   broker as the owner.
//
// RULE — an owner is never reachable at a brokerage inbox:
//   1. Drop an owner-role row whose email IS a captured broker's (or a national-
//      brokerage inbox domain) — that row is the broker-card bleed, not an owner.
//   2. Strip a broker's email/phone off any owner row that keeps its own
//      identity, so a real owner never carries the broker's reach.
//   Broker rows themselves are untouched; a contact carrying BOTH a broker role
//   and an owner role keeps the broker role (the representative-role picker in
//   costar.js already ranks broker above owner) and is left alone.
// ============================================================================

(function () {
  'use strict';

  // National-brokerage inbox domains — a fallback for a leaked broker email
  // whose matching broker contact carried no email of its own (so the cross-
  // reference set below is empty). Extend conservatively; a false positive only
  // costs an owner an email, never fabricates one.
  const BROKERAGE_EMAIL_DOMAIN_RE =
    /@(?:nmrk|newmark|cbre|jll|colliers|cushwake|cushmanwakefield|marcusmillichap|matthews|avisonyoung|kellerwilliams|kw|svn|naiop)\.[a-z.]{2,}$/i;
  const OWNER_ROLE_RE  = /^(?:owner|true_owner|recorded_owner|current_owner)$/i;
  const BROKER_ROLE_RE = /^(?:listing_broker|buyer_broker)$/i;

  function rolesOf(c) {
    if (Array.isArray(c.roles) && c.roles.length) return c.roles;
    return c.role ? [c.role] : [];
  }
  function normEmail(e) {
    return (typeof e === 'string' ? e.trim().toLowerCase() : '');
  }
  function phone10(p) {
    return String(p == null ? '' : p).replace(/\D/g, '').slice(-10);
  }

  // Collect the normalized emails + last-10-digit phones of every captured
  // listing/buyer broker contact.
  function collectBrokerContactInfo(contacts) {
    const emails = new Set();
    const phones = new Set();
    for (const c of contacts) {
      if (!c || !rolesOf(c).some((r) => BROKER_ROLE_RE.test(r))) continue;
      const e = normEmail(c.email);
      if (e) emails.add(e);
      const ps = Array.isArray(c.phones) ? c.phones : (c.phone ? [c.phone] : []);
      for (const p of ps) {
        const d = phone10(p);
        if (d.length >= 7) phones.add(d);
      }
    }
    return { emails, phones };
  }

  function isBrokerEmail(email, brokerInfo) {
    if (!email) return false;
    if (brokerInfo.emails.has(email)) return true;
    return BROKERAGE_EMAIL_DOMAIN_RE.test(email);
  }

  // Returns a NEW array with broker-attributed owner rows dropped and broker
  // reach stripped from surviving owner rows. Never mutates role/name of a
  // legitimate owner; only removes broker-owned email/phone.
  function reconcileBrokerOwnerAttribution(contacts) {
    if (!Array.isArray(contacts) || contacts.length === 0) return contacts;
    const brokerInfo = collectBrokerContactInfo(contacts);
    if (brokerInfo.emails.size === 0 && brokerInfo.phones.size === 0) {
      // No broker reach captured — the domain fallback can still fire, so keep
      // going (a leaked brokerage-domain email with no broker contact).
    }
    const out = [];
    for (const c of contacts) {
      if (!c) continue;
      const roles = rolesOf(c);
      const isOwner  = roles.some((r) => OWNER_ROLE_RE.test(r));
      const isBroker = roles.some((r) => BROKER_ROLE_RE.test(r));
      if (isOwner && !isBroker) {
        const e = normEmail(c.email);
        if (isBrokerEmail(e, brokerInfo)) {
          // The whole "owner" row is the broker-card bleed — drop it.
          continue;
        }
        // Owner kept: strip a broker phone/email that leaked onto it.
        const cleaned = { ...c };
        if (Array.isArray(cleaned.phones) && cleaned.phones.length) {
          cleaned.phones = cleaned.phones.filter((p) => !brokerInfo.phones.has(phone10(p)));
          if (!cleaned.phones.length) delete cleaned.phones;
        }
        if (cleaned.phone && brokerInfo.phones.has(phone10(cleaned.phone))) {
          delete cleaned.phone;
        }
        out.push(cleaned);
        continue;
      }
      out.push(c);
    }
    return out;
  }

  const api = {
    reconcileBrokerOwnerAttribution,
    collectBrokerContactInfo,
    isBrokerEmail,
    BROKERAGE_EMAIL_DOMAIN_RE,
  };

  if (typeof globalThis !== 'undefined') globalThis.__lccBrokerOwnerReconcile = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
