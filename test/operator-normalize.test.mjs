// Tenant → operator normalization (dia). Pins the deterministic alias map
// receipts (the lock-step contract with the SQL mirror
// dia_operator_from_tenant / dia_operator_tenant_status) and the hard guard
// that a non-dialysis tenant is NEVER assigned a dialysis operator.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { deriveOperatorFromTenant, operatorForTenant, listCanonicalOperators } =
  await import('../api/_shared/operator-normalize.js');

describe('deriveOperatorFromTenant — matched families', () => {
  const cases = [
    // DaVita
    ['DaVita Kidney Care', 'DaVita'],
    ['DaVita Dialysis', 'DaVita'],
    ['DaVita', 'DaVita'],
    ['DaVita Affinity Place Dialysis', 'DaVita'],
    ['TOTAL RENAL CARE, INC.', 'DaVita'],
    ['DVA Renal Healthcare, Inc.', 'DaVita'],
    ['DVA Healthcare Renal Care, Inc.', 'DaVita'],
    ['Renal Treatment Centers-Southeast, L.P.', 'DaVita'],
    // Fresenius
    ['Fresenius Medical Care', 'Fresenius'],
    ['Fresenius Kidney Care', 'Fresenius'],
    ['Fresnius Kidney Care', 'Fresenius'],          // common typo
    ['FMC NORTH MEMPHIS', 'Fresenius'],              // the fmc(na)? fix
    ['FMCNA - PINE BLUFF', 'Fresenius'],
    ['FKC COLTON HOME', 'Fresenius'],
    ['RAI-CERES AVE-CHICO', 'Fresenius'],
    ['Bio-Medical Applications of Kentucky, Inc.', 'Fresenius'],
    ['American Access Care', 'Fresenius'],
    ['Renal Care Group', 'Fresenius'],
    ['Azura Vascular Care', 'Fresenius'],
    ['Liberty Dialysis', 'Fresenius'],
    // US Renal Care
    ['U.S. Renal Care', 'US Renal Care, Inc.'],
    ['US Renal Care', 'US Renal Care, Inc.'],
    ['USRC LOS BANOS HOME', 'US Renal Care, Inc.'],
    ['Dialysis Newco, Inc. dba DSI Renal', 'US Renal Care, Inc.'],
    // DCI
    ['DCI', 'Dialysis Clinic, Inc.'],
    ['Dialysis Clinic, Inc.', 'Dialysis Clinic, Inc.'],
    ['DCI MITYLENE PARK', 'Dialysis Clinic, Inc.'],
    // American Renal / IRC
    ['American Renal Associates', 'American Renal Associates'],
    ['Innovative Renal Care', 'American Renal Associates'],
    // Satellite
    ['Satellite Healthcare', 'Satellite Healthcare'],
    ['WellBound', 'Satellite Healthcare'],
  ];
  for (const [tenant, op] of cases) {
    it(`${tenant} → ${op}`, () => {
      const r = deriveOperatorFromTenant(tenant);
      assert.equal(r.status, 'matched');
      assert.equal(r.operator, op);
      assert.equal(operatorForTenant(tenant), op);
    });
  }
});

describe('the hard guard — non-dialysis tenants never get a dialysis operator', () => {
  const nonDialysis = [
    'Henry Ford Health System', 'Staples, Inc.', 'Planet Fitness',
    'West Virginia University Medicine', 'Vital Smiles, VIPCare',
    'DB Biologics, LLC', 'In Home Clinical & Case Worker Services',
    'Kentucky Childrens Hospital', 'complimentary hearing wellness center',
    'top-tier healthcare provider', "Macy's Retail Holdings LLC",
    'THE HERTZ CORPORATION', 'Affordable Health Care', 'seven medical tenants',
  ];
  for (const t of nonDialysis) {
    it(`${t} → no operator`, () => {
      const r = deriveOperatorFromTenant(t);
      assert.equal(r.operator, null);
      assert.equal(r.status, 'non_dialysis');
    });
  }
});

describe('residual — plausibly dialysis, unknown operator → leave NULL, report', () => {
  for (const t of ['Ameri-Tech Kidney Center', 'ELITE DIALYSIS',
                   'Dialysis Associates, LLC', 'DIALYZE DIRECT BEACHWOOD, OH',
                   'Northwest Kidney Centers', 'Mayo Dialysis - Fairmont']) {
    it(`${t} → unmatched_dialysis (no operator)`, () => {
      const r = deriveOperatorFromTenant(t);
      assert.equal(r.operator, null);
      assert.equal(r.status, 'unmatched_dialysis');
    });
  }
});

describe('edge cases', () => {
  it('null / empty / non-string → non_dialysis, no operator', () => {
    for (const v of [null, undefined, '', '  ', 42, {}]) {
      const r = deriveOperatorFromTenant(v);
      assert.equal(r.operator, null);
      assert.equal(r.status, 'non_dialysis');
    }
  });
  it('anchored — "Rainbow" never matches the RAI rule', () => {
    assert.equal(deriveOperatorFromTenant('Rainbow Childrens Clinic').operator, null);
  });
  it('canonical operator targets are the 6 known families', () => {
    assert.deepEqual(listCanonicalOperators(), [
      'DaVita', 'Fresenius', 'US Renal Care, Inc.',
      'Dialysis Clinic, Inc.', 'American Renal Associates', 'Satellite Healthcare',
    ]);
  });
});
