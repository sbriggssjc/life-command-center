// C13g — the entity_type capture-path producer.
//
// C13c measured that ~1,950 entities are person-typed organizations, traced
// to the RCA/CoStar transaction-party "contact" slot: 115 of 142 sampled sit
// on `rca/contact`, 32 on `costar/contact`. The mechanism: RCA's owner-party
// capture sends no `contact.type` at all, and the backend's
// `contactEntityType()` fallback was a narrow LLC/INC/CORP/LTD/LP/LLP/
// PARTNERS/GROUP/ASSOCIATES/ADVISORS-only regex — missing Trust, Holdings,
// Properties, Capital, Realty, Company/Co, REIT and every other real org
// marker that the ALREADY-GRADED `hasFirmSuffix()` guard (entity-link.js)
// already covers. This guard pins the fix: `contactEntityType` must route
// through the shared guard, not a second, narrower copy.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contactEntityType } from '../api/_handlers/sidebar-pipeline.js';

const SRC = readFileSync(new URL('../api/_handlers/sidebar-pipeline.js', import.meta.url), 'utf8');

describe('C13g — contactEntityType widened org-marker coverage', () => {
  it('classifies a Trust-suffixed name (no explicit type) as organization', () => {
    assert.equal(contactEntityType({ name: 'Boyd Watterson Asset Management Trust' }), 'organization');
  });

  it('classifies a Holdings-suffixed name as organization', () => {
    assert.equal(contactEntityType({ name: 'NGP VI Falls Church VA Holdings' }), 'organization');
  });

  it('classifies a Properties-suffixed name as organization', () => {
    assert.equal(contactEntityType({ name: 'Easterly Government Properties' }), 'organization');
  });

  it('classifies a Capital-suffixed name as organization', () => {
    assert.equal(contactEntityType({ name: 'NGP Capital' }), 'organization');
  });

  it('classifies a Realty-suffixed name as organization', () => {
    assert.equal(contactEntityType({ name: 'Trammell Crow Realty' }), 'organization');
  });

  it('classifies a bare Company/Co name as organization', () => {
    assert.equal(contactEntityType({ name: 'Trammell Crow Co' }), 'organization');
  });

  it('still classifies a real two-token individual name as person', () => {
    assert.equal(contactEntityType({ name: 'Martin Starr' }), 'person');
    assert.equal(contactEntityType({ name: 'Sarita Mutscher' }), 'person');
  });

  it('an explicit vendor-supplied type still wins over the name heuristic', () => {
    assert.equal(contactEntityType({ name: 'Gary George', type: 'organization' }), 'organization');
    assert.equal(contactEntityType({ name: 'ACME LLC', type: 'person' }), 'person');
  });

  it('the LLC/INC/CORP/LTD/LP/LLP-only shape stays covered (no regression)', () => {
    assert.equal(contactEntityType({ name: 'ACME LLC' }), 'organization');
    assert.equal(contactEntityType({ name: 'Widget Corp' }), 'organization');
  });

  it('routes through the shared hasFirmSuffix guard, not a second inline regex', () => {
    const fnMatch = SRC.match(/export function contactEntityType\([\s\S]*?\n}\n/);
    assert.ok(fnMatch, 'contactEntityType function body not found');
    const body = fnMatch[0];
    assert.match(body, /hasFirmSuffix\(/, 'must call the shared hasFirmSuffix guard');
    // The old narrow inline alternation must be gone — its presence would
    // mean a SECOND, drifting copy of the org-marker list exists.
    assert.doesNotMatch(
      body,
      /LLC\|INC\|CORP\|LTD\|LP\|LLP\|PARTNERS\|GROUP\|ASSOCIATES\|ADVISORS/i,
      'must not restore the narrow inline org-marker regex'
    );
  });
});
