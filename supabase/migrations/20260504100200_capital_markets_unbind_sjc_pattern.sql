-- Capital Markets Phase 1 follow-up: unbind %SJC% pattern (LCC Opps copy).
--
-- During Phase 1 spot-checks we found that 2 real 2025 NM deals
-- (2025-03-17 SSA $4.65M and 2025-05-07 DHS $20M) showed listing_broker
-- = 'SJC; Briggs' in CoStar but were going unattributed under the
-- 2024-12-31 era cap. Investigation showed:
--
--   1. The %SJC% pattern catches the WHOLE Stan Johnson team:
--      Brett, Corriston, Duff, Gibson, Hellwig, Pardue, Rutonno,
--      Steele, plus Briggs. All real Northmarq producers.
--   2. CoStar broker metadata uses the legacy "SJC; <producer>" naming
--      for years post-acquisition (their data hasn't caught up to the
--      2022 rebrand).
--   3. Across 5,926 gov sales rows there are zero false positives —
--      every "SJC" appearance is the firm Stan Johnson Co. / Northmarq.
--
-- Conclusion: %SJC% should be unbounded (effective_until = NULL).
-- %Briggs% stays era-capped at 2024-12-31 to avoid Briggs Freeman
-- (Texas brokerage) false positives — SJC catches the same NM deals
-- via the 'SJC; Briggs' co-occurrence anyway.
--
-- This UPDATE is the SAME change applied in-place to the gov DB by
-- 20260504_capital_markets_phase_1_followups.sql; both DBs need it
-- to keep the master copy + domain mirrors in sync.

update public.cm_nm_broker_patterns
set effective_until = null,
    notes = 'Common abbreviation in CoStar exports for Stan Johnson Company (the firm Northmarq acquired in 2022). After acquisition, CoStar broker metadata still uses ''SJC; <producer>'' for years (samples: ''SJC; Briggs'', ''SJC; Brett'', ''SJC; Corriston'', ''SJC; Duff'', ''SJC; Gibson'', ''SJC; Hellwig'', ''SJC; Pardue'', ''SJC; Rutonno'', ''SJC; Steele'') — these are real Northmarq deals where the firm name in CoStar lags the actual rebrand. effective_until set to NULL (unbounded) to capture them. SJC is distinctive enough that we have seen no false positives across 5,926 gov sales rows.'
where match_pattern = '%SJC%';
