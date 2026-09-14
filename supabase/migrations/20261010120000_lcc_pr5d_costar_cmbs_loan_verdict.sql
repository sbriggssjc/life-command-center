-- ---------------------------------------------------------------------------
-- PR5d — costar_cmbs_loan: 121 rungs for a capture arm that has never fired.
-- 2026-09-03 · LCC Opps xengecqvemvfknjvbvrq
--
-- PR5 filed this source `build_pending` on the strength of one measurement
-- ("loans.data_source holds no costar_cmbs_loan on EITHER domain"). PR5d asked
-- the three-way question that verdict left open — no scanner / keys dropped /
-- scanner unreachable — and the answer is the third, with a second gate under
-- it that PR5 could not have seen.
--
-- MEASURED 2026-09-03 (see docs/audits/PR5d_COSTAR_CMBS_LOAN_ARM_2026-09-03.md):
--
--   * The scanner EXISTS and is wired end to end. extension/content/costar.js
--     parseCmbsLoanDetail (Round 76ek.b) + parseCmbsFinancials (76ek.e) emit
--     metadata.loan_records[] / metadata.property_financials[];
--     sidebar-pipeline.js upsertLoanRecords / upsertPropertyFinancials consume
--     them and stamp costar_cmbs_loan. manifest.json matches
--     https://*.costar.com/* so the content script DOES run on the sub-page.
--     So this is NOT the PR5c `producer_never_wired` class and NOT the PR2
--     dropped-keys class.
--
--   * The arm has never fired ANYWHERE, under ANY name. Across all 2,219 rows
--     of gov.loans (1,559) + dia.loans (660):
--         costar_loan_id .......... 0
--         source_url .............. 0
--         source_url ~ /detail/lookup/[0-9]+/loan ... 0
--     Both columns are written ONLY by upsertLoanRecords, so a zero on both is
--     proof the loan sub-page has never been captured — it is not a relabelled
--     writer (the rename class was tested and refused).
--     loan_snapshots / loan_top_tenants / loan_commentary are 0 rows on BOTH
--     domains, and property_financials carries 0 costar_cmbs_loan rows
--     (gov 98,510 all NULL-source bulk import; dia 676 all om_intake).
--
--   * WHAT DOES write loans is a different code path on a different page:
--     the property page's Public-Records sale/loan history + sidebar stat
--     cards, stamped costar_sidebar (gov 1,393 / dia 358). That path derives
--     cmbs_deal_name from a lender name matching a CMBS deal-name regex, which
--     is why is_cmbs (gov 285 / dia 82) and special_servicer (110/68) look like
--     CMBS captures and are not.
--
--   * SECOND GATE, dia only: upsertLoanRecords / upsertPropertyFinancials gate
--     snapshots, top-tenants and financials on properties.track_cmbs_snapshots,
--     which is FALSE on 11,803 of 11,803 dia properties (0 true, 0 null). Those
--     27 dia rungs therefore cannot be exercised even by a captured page. The
--     dia `loans` write itself and loan_commentary are ungated (verified in
--     source), so they carry the plain verdict.
--
-- VERDICT: NOT retired. The arm is the supply side of a demand that is already
-- named and already has a built consumer with zero input — R54's is_distressed
-- ranking arm on v_loan_maturity_watch reads FALSE on 178 of 178 gov rows, and
-- every distress field is 0 across 285 gov CMBS loans / 210 properties
-- (watchlist, num_delinquent, special_servicing, modification, dscr). Only the
-- loan sub-page carries them. Backlog PR5d-a (capture) / PR5d-b (the dia flag).
--
-- ⚠️ This SUPERSEDES the mechanism in R54 Unit 3 (2026-06-20), which recorded
-- "the source rows we have don't carry the Performance-section distress data
-- ... the captures so far are the basic loan layout". The rows are not partial
-- CMBS captures; parseCmbsLoanDetail has never run, and the rows come from a
-- different scanner entirely. R54's disposition (no writer change, nothing
-- fabricated) was right; its explanation was not.
--
-- Reversal: UPDATE field_source_priority SET notes = regexp_replace(notes,
--   '^PR5d:[a-z_]+ \(2026-09-03\) - .*? \|\| ', '') WHERE notes LIKE 'PR5d:%';
--   then re-create the view without pr5d_verdict.
-- ---------------------------------------------------------------------------


-- 1. The verdicts. Split by whether the rung is ALSO behind the dia opt-in
--    flag, because "never reached" and "never reached AND gated off" are two
--    different facts with two different fixes.
CREATE TEMP TABLE _pr5d_verdict (
  target_table text NOT NULL,
  verdict      text NOT NULL,
  evidence     text NOT NULL
) ON COMMIT DROP;

INSERT INTO _pr5d_verdict (target_table, verdict, evidence) VALUES
 ('gov.loans','page_never_captured',
  'Scanner + writer wired end to end and UNGATED on gov; the CoStar loan sub-page /detail/lookup/{N}/loan has simply never been captured. Proof: costar_loan_id and source_url are 0 of 1,559 gov.loans rows, and both are written only by upsertLoanRecords. The 1,393 costar_sidebar rows come from the property page''s Public-Records sale/loan history, a different scanner.'),
 ('dia.loans','page_never_captured',
  'Same wiring; the dia loans write itself is NOT behind track_cmbs_snapshots (only snapshots/top-tenants/financials are). costar_loan_id and source_url are 0 of 660 dia.loans rows.'),
 ('gov.loan_snapshots','page_never_captured',
  'Table is 0 rows. Ungated on gov ("gov: always tracked"). Carries the DSCR that R54''s is_distressed arm needs and cannot get: v_loan_maturity_watch reads is_distressed FALSE on 178 of 178 rows.'),
 ('gov.loan_top_tenants','page_never_captured','Table is 0 rows. Ungated on gov. Rent-roll snapshot at the servicer report date.'),
 ('gov.loan_commentary','page_never_captured','Table is 0 rows. Commentary writes are ungated on BOTH domains (verified in source, unlike snapshots/top-tenants).'),
 ('dia.loan_commentary','page_never_captured','Table is 0 rows. Ungated on dia by design.'),
 ('gov.property_financials','page_never_captured',
  'The 76ek.e cmbs-financials tab has never been captured: 0 rows carry source=costar_cmbs_loan. gov''s 98,510 rows are a NULL-source March-2026 bulk import.'),
 ('dia.loan_snapshots','page_never_captured_flag_off',
  'Doubly blocked: the page is never captured AND upsertLoanRecords gates dia snapshots on properties.track_cmbs_snapshots, which is FALSE on 11,803 of 11,803 dia properties (0 true, 0 null). Capturing the page would still write nothing here.'),
 ('dia.loan_top_tenants','page_never_captured_flag_off','Same dia track_cmbs_snapshots gate as dia.loan_snapshots.'),
 ('dia.property_financials','page_never_captured_flag_off',
  'upsertPropertyFinancials returns 0 outright for dia when track_cmbs_snapshots is false — false on all 11,803 dia properties. 0 rows carry source=costar_cmbs_loan (all 676 are om_intake).');

-- 2. Stamp. Prepends, so the PR5 verdict stays readable and stays parseable:
--    'PR5d:' does not match the view's 'PR5:' / 'PR5c:' literals.
UPDATE public.field_source_priority f
   SET notes = 'PR5d:' || v.verdict || ' (2026-09-03) - ' || v.evidence
               || CASE WHEN f.notes IS NULL OR btrim(f.notes) = '' THEN '' ELSE ' || ' || f.notes END,
       updated_at = now()
  FROM _pr5d_verdict v
 WHERE f.source = 'costar_cmbs_loan'
   AND f.target_table = v.target_table
   AND COALESCE(f.notes, '') NOT LIKE 'PR5d:%';

-- 3. Positive control: every one of the 121 rungs must carry a verdict, split
--    94 / 27. A silent partial stamp is the failure mode this guards.
DO $$
DECLARE n_all int; n_plain int; n_flag int;
BEGIN
  SELECT count(*) FILTER (WHERE notes LIKE 'PR5d:%'),
         count(*) FILTER (WHERE notes LIKE 'PR5d:page_never_captured (%'),
         count(*) FILTER (WHERE notes LIKE 'PR5d:page_never_captured_flag_off (%')
    INTO n_all, n_plain, n_flag
    FROM public.field_source_priority WHERE source = 'costar_cmbs_loan';
  IF n_all <> 121 OR n_plain <> 94 OR n_flag <> 27 THEN
    RAISE EXCEPTION 'PR5d stamp mismatch: total=% (want 121), plain=% (want 94), flag_off=% (want 27)',
      n_all, n_plain, n_flag;
  END IF;
END $$;

-- 4. Surface it. Column APPENDED at the end (CREATE OR REPLACE VIEW is
--    append-only for columns — a mid-list insert raises 42P16).
CREATE OR REPLACE VIEW public.v_field_source_priority_triage AS
 SELECT id,
    target_table,
    field_name,
    source,
    priority,
    enforce_mode,
    "substring"(notes, 'PR5:([a-z_]+)'::text) AS pr5_verdict,
    notes ~~ '%PR7:orphan_column%'::text AS is_orphan_column,
    COALESCE("substring"(notes, 'PR5:([a-z_]+)'::text) = ANY (ARRAY['retire'::text, 'retired_by_decision'::text]), false) AS is_retired,
    notes,
    updated_at,
    "substring"(notes, 'PR5c:([a-z_]+)'::text) AS pr5c_verdict,
    "substring"(notes, 'PR5d:([a-z_]+)'::text) AS pr5d_verdict
   FROM field_source_priority f;
