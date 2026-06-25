// Gap Memo 2026-06-23, Topic 1 — state-government tenant classification.
//
// The CoStar sidebar classifier (classifyDomain / GOV_TENANT_PATTERNS) was
// federal-centric; a State-of-Texas leased sale ("TX Health and Human
// Services") returned no_domain. These tests lock in coverage of real state
// agency names (drawn from the Texas Facilities Commission "Agency Report")
// AND guard against false-positiving private/retail tenants.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyDomain, GOV_TENANT_PATTERNS } from '../api/_handlers/sidebar-pipeline.js';

// Real distinct agencies from the TFC Agency Report that previously MISSED.
const STATE_AGENCIES_THAT_MUST_CLASSIFY_GOV = [
  'TX Health and Human Services',            // the trigger case (tenant on the CoStar page)
  'HEALTH & HUMAN SERVICES COMMISSION',      // 319 leases
  'TEXAS DEPT OF CRIMINAL JUSTICE',          // 96
  'PARKS AND WILDLIFE DEPARTMENT',           // 50
  'COMPTROLLER OF PUBLIC ACCOUNTS',          // 45
  'TEXAS COMM. ON ENVIRONMENTAL QUALITY',    // 34
  'TEXAS LOTTERY COMMISSION',                // 15
  'GENERAL LAND OFFICE',                     // 15
  'TEXAS DEPT. OF LICENSING & REGULATION',   // 11
  'RAILROAD COMMISSION',                     // 9
  'TEXAS ANIMAL HEALTH COMMISSION',          // 8
  'SOIL & WATER CONSERVATION BOARD',         // 8
  'TEXAS EDUCATION AGENCY',                  // 7
  'STATE OFC OF ADMINISTRATIVE HEARINGS',    // 6
  'TEXAS WATER DEVELOPMENT BOARD',           // 5
  'TEXAS JUVENILE JUSTICE DEPARTMENT',       // 3
  'STATE SECURITIES BOARD',                  // 3
  'BOARD OF PLUMBING EXAMINERS',             // 1
  'TEXAS WORKFORCE COMMISSION',              // 1
  'TX DEPT OF HOUSING & COMM AFFAIRS',       // 1
  'TEXAS ALCOHOLIC BEVERAGE COMMISSION',     // 1
  "Children's Protective Services",          // CPS — live capture 2026-06-23 (Sherman TX)
  "Texas Children's Protective",             // CPS — CoStar truncates the TENANTS panel (no "Services"); live capture 2026-06-25 (Lubbock TX 1622 10th St)
  'Child Protective Services',               // CPS
  'Adult Protective Services',               // APS
  'Parole Supervision',                      // TX Dept of Criminal Justice, Parole Division — live capture 2026-06-23 (Haltom City)
];

// Agencies that already classified (federal vocabulary) — must STILL classify.
const ALREADY_COVERED = [
  'DEPARTMENT OF FAMILY AND PROTECTIVE SERVICES',
  'DEPARTMENT OF STATE HEALTH SERVICES',
  'OFFICE OF THE ATTORNEY GENERAL',
  'TEXAS DEPARTMENT OF TRANSPORTATION',
  'Social Security Administration',
  'GSA',
];

// Private / retail / multifamily tenants the additions must NOT false-positive
// into government (the anchoring guardrail — Topic 1 design constraint).
const PRIVATE_TENANTS_THAT_MUST_NOT_BE_GOV = [
  'Macy\'s Department Store',
  'Nordstrom',
  'Workforce Housing Apartments',          // "workforce housing" is a CRE term, not a gov agency
  'Dollar General',
  'Starbucks',
  'First National Bank',
  'AutoZone',
  'Planet Fitness',
  'Texas Roadhouse',                       // "Texas" + restaurant, not a state agency
  'Conservation Realty Group',             // "conservation" without board/district/commission
  'Allied Protective Services',            // private security firm — "protective services" w/o child/adult/family anchor
  'Parolee Apparel LLC',                   // "parolee" != "parole" — word-boundary anchor must not catch it
];

function classifyByTenant(tenant) {
  return classifyDomain({ tenant_name: tenant }, {});
}

describe('Topic 1 — state-government tenant classification', () => {
  it('classifies every previously-missed TX state agency as government', () => {
    const misses = STATE_AGENCIES_THAT_MUST_CLASSIFY_GOV.filter(
      (a) => classifyByTenant(a) !== 'government',
    );
    assert.deepEqual(misses, [], `these state agencies still miss: ${JSON.stringify(misses)}`);
  });

  it('still classifies the agencies that already worked (no regression)', () => {
    for (const a of ALREADY_COVERED) {
      assert.equal(classifyByTenant(a), 'government', `regressed: ${a}`);
    }
  });

  it('does NOT misclassify private/retail/multifamily tenants as government', () => {
    const falsePositives = PRIVATE_TENANTS_THAT_MUST_NOT_BE_GOV.filter(
      (t) => classifyByTenant(t) === 'government',
    );
    assert.deepEqual(falsePositives, [], `false positives: ${JSON.stringify(falsePositives)}`);
  });

  it('the trigger case (TX Health and Human Services) classifies government', () => {
    assert.equal(
      classifyDomain(
        { tenant_name: 'TX Health and Human Services', asset_type: 'Office', property_type: 'Office' },
        {},
      ),
      'government',
    );
  });

  it('GOV_TENANT_PATTERNS are all anchored (no unbounded bare keywords)', () => {
    // Every pattern uses a word boundary or anchor — guards against a future
    // bare keyword (e.g. /department/) sneaking in and matching "department store".
    for (const rx of GOV_TENANT_PATTERNS) {
      assert.ok(/\\b|\^|\$/.test(rx.source), `unanchored pattern: ${rx}`);
    }
  });

  // Sale Comps page (/Comp/NNN/): the gov tenant lives ONLY in the comp's
  // Sale Notes, which the parser nests at sales_history[].sale_notes_raw —
  // NOT top-level metadata.sale_notes_raw. classifyDomain must read it.
  // Live capture 2026-06-23 (3411 Horal, San Antonio — sold private→private,
  // tenant = TX Health and Human Services Commission named only in Sale Notes).
  it('classifies a gov-leased SALE COMP when the agency is only in sales_history[].sale_notes_raw', () => {
    const horal = {
      asset_type: 'Office', property_type: 'Office',
      sales_history: [{
        sale_date: '2025-05-29',
        sale_notes_raw: 'A private individual sold this 20,248 square foot office building to Foresight Asset Management for an undisclosed price. At time of sale, this property was fully leased by the Texas Health And Human Services Commission.',
      }],
    };
    assert.equal(classifyDomain(horal, {}), 'government');
  });

  it('does NOT classify a genuinely-private SALE COMP (no gov tenant in the sale notes)', () => {
    const priv = {
      asset_type: 'Office', property_type: 'Office',
      sales_history: [{ sale_date: '2025-05-29', sale_notes_raw: 'A private investor sold this office building to a regional buyer for an undisclosed price.' }],
    };
    assert.equal(classifyDomain(priv, {}), null);
  });
});
