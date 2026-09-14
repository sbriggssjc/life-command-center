import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../scripts/asset-metadata-loan-feeder.mjs';

test('asset metadata loan payload maps the 23654 JPMCC loan into dia.loans', () => {
  const loan = {
    lender_name: 'JPMCC 2019-COR4',
    originator: 'LoanCore Cap Prtnrs',
    loan_amount_dollars: 1800000,
    interest_rate_pct: 4.7,
    maturity_date_iso: '2028-07-06',
    origination_date_iso: '2018-06-08',
    ltv_pct: 57.4,
    term_months: 120,
    loan_type: '1st Mortgage',
    is_cmbs: true,
    special_servicer: 'Midland Loan Services',
    loan_status: 'Loan Status:Watchlist',
  };

  const payload = __test__.loanPayload('dia', 23654, loan);
  assert.equal(payload.property_id, 23654);
  assert.equal(payload.lender_name, 'JPMCC 2019-COR4');
  assert.equal(payload.loan_amount, 1800000);
  assert.equal(payload.current_balance, 1800000);
  assert.equal(payload.interest_rate_percent, 4.7);
  assert.equal(payload.maturity_date, '2028-07-06');
  assert.equal(payload.origination_date, '2018-06-08');
  assert.equal(payload.loan_to_value, 57.4);
  assert.equal(payload.loan_term, 120);
  assert.equal(payload.loan_type, 'Acquisition');
  assert.equal(payload.special_servicer, 'Midland Loan Services');
  assert.equal(payload.cmbs_deal_name, 'JPMCC 2019-COR4');
  assert.match(payload.notes, /Upper-bound estimate/);
});

test('asset metadata loan feeder suppresses bare brokerages as lenders', () => {
  const loan = {
    lender_name: 'Marcus & Millichap',
    loan_amount_dollars: 1000000,
    loan_status: 'active',
  };

  const verdict = __test__.lenderVerdict(loan);
  assert.equal(verdict.lender, null);
  assert.equal(verdict.suppressed, true);

  const payload = __test__.loanPayload('dia', 123, loan);
  assert.equal(payload.lender_name, undefined);
  assert.match(payload.notes, /lender_suppressed_as_brokerage/);
});

test('asset metadata loan feeder strips broker prefixes when a real lender follows', () => {
  const loan = {
    lender_name: 'Marcus & Millichap Capstar Bank',
    loan_amount_dollars: 1000000,
    loan_status: 'active',
  };

  const payload = __test__.loanPayload('dia', 123, loan);
  assert.equal(payload.lender_name, 'Capstar Bank');
});

test('asset metadata loan feeder builds a legacy dia mortgage_records row without property_id column', () => {
  const loan = {
    lender_name: 'JPMCC 2019-COR4',
    loan_amount_dollars: 1800000,
    interest_rate_pct: 4.7,
    maturity_date_iso: '2028-07-06',
    origination_date_iso: '2018-06-08',
    loan_type: '1st Mortgage',
    is_cmbs: true,
  };
  const payload = __test__.loanPayload('dia', 23654, loan);
  const mortgage = __test__.mortgageRecordPayload('dia', 23654, 'bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0', '5247 Airways', loan, payload);

  assert.equal(mortgage.lender, 'JPMCC 2019-COR4');
  assert.equal(mortgage.original_amount, 1800000);
  assert.equal(mortgage.interest_rate, 4.7);
  assert.equal(mortgage.maturity_date, '2028-07-06');
  assert.equal(mortgage.recording_date, '2018-06-08');
  assert.equal(mortgage.property_id, undefined);
  assert.equal(mortgage.raw_payload.property_id, '23654');
  assert.equal(mortgage.data_hash.length, 16);
});
