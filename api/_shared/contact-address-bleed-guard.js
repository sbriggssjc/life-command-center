// api/_shared/contact-address-bleed-guard.js
//
// ADDR1 (2026-09-03): the CoStar sidebar can capture a property whose STREET
// address is really a CONTACT's own office/HQ address, not the subject
// property's. Root cause on the client: the redesigned CoStar "Contacts" tab
// renders party-designation blocks ("Sales Company", "True Owner", a buyer
// entity, …) that the property-address line-scanner
// (extension/content/costar.js::findAddressInLines) did not know to skip
// (FOREIGN_PARTY_HEADER_RE was missing "sales company"/"sales contacts"/
// "listing contacts"/"property manage(r|ment)"). Live: a Wisconsin Dells, WI
// DaVita clinic (dia property 35722) got a phantom duplicate (37491) carrying
// SRS Capital Markets' Newport Beach, CA office street under the correct
// Wisconsin Dells city/state/zip (the city/state/zip is resolved by a
// SEPARATE, earlier-in-the-page line scan, which is why only the street was
// wrong). A second live instance landed a wrong street on a REAL, distinct
// property (50990, Gary IN) rather than minting a duplicate. gov has the
// identical shape (property 9893: J.P. Morgan's "245 Park Ave, New York, NY"
// bled onto a Raton, NM property).
//
// This is the SERVER-SIDE BELT: even if a bad street reaches the pipeline,
// refuse to write it as the property address when a CONTACT captured on the
// SAME page states that exact street as ITS OWN address at a DIFFERENT
// city/state than the property. tm-misparse.js precedent
// (api/_shared/tm-misparse.js) — a single, pure, testable detector, never a
// general fuzzy-address filter.
//
// Deliberately narrow, and NEVER guesses:
//   - EXACT match on the street text (case/whitespace-insensitive) — never
//     fuzzy, per the repo's identity-matching doctrine.
//   - Fires ONLY when the contact's OWN city and/or state is present and
//     genuinely disagrees with the property's. An owner/seller genuinely
//     headquartered AT the property (contact address == property address AND
//     city/state agree — an owner-occupied or physician-owned clinic, the
//     overwhelmingly common shape: measured 12 of 13 same-address dia
//     contact/property matches) is left untouched.
//   - Never role-restricted — live hits span owner/buyer/seller/broker roles
//     (SRS's listing brokers, IRA Capital as "buyer", J.P. Morgan Asset
//     Management as a plain contact), so gating on role would miss most of
//     them.
//   - Silent (both sides blank) is never treated as a mismatch — unknown is
//     not a value (P180).

function normStreet(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normPlace(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * Find a contact on this capture whose OWN office address literally matches
 * the property's resolved street, at a different city/state.
 *
 * @param {string|null|undefined} propertyAddress
 * @param {string|null|undefined} propertyCity
 * @param {string|null|undefined} propertyState
 * @param {Array<{name?:string,address?:string,city?:string,state?:string}>|null|undefined} contacts
 * @returns {{name:string|null,address:string,city:string|null,state:string|null}|null}
 *   the offending contact record, or null when no bleed is detected.
 */
export function findContactOfficeAddressBleed(propertyAddress, propertyCity, propertyState, contacts) {
  const propAddr = normStreet(propertyAddress);
  // Too short to be a meaningful street collision — avoid false positives on
  // degenerate/partial strings.
  if (!propAddr || propAddr.length < 8) return null;
  if (!Array.isArray(contacts) || !contacts.length) return null;

  const pCity = normPlace(propertyCity);
  const pState = normPlace(propertyState);

  for (const c of contacts) {
    if (!c || !c.address) continue;
    const cAddr = normStreet(c.address);
    if (!cAddr || cAddr.length < 8) continue;
    if (cAddr !== propAddr) continue; // exact match only, never a substring/fuzzy test

    const cCity = normPlace(c.city);
    const cState = normPlace(c.state);
    if (!cCity && !cState) continue; // nothing to disagree with — never guess

    const cityMismatch = Boolean(cCity && pCity && cCity !== pCity);
    const stateMismatch = Boolean(cState && pState && cState !== pState);
    if (cityMismatch || stateMismatch) {
      return {
        name: c.name || null,
        address: c.address,
        city: c.city || null,
        state: c.state || null,
      };
    }
  }
  return null;
}
