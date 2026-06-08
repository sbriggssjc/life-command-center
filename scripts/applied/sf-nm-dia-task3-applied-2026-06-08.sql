-- gated; run only on Scott's approval
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_source text;
UPDATE public.sales_transactions SET is_northmarq=true, is_northmarq_source='salesforce'
 WHERE sale_id IN (24,37,43,50,56,75,112,155,156,194,224,257,537,567,603,665,685,765,876,5136,5139,5197,5305,5437,5449,5905,6020,6196,6380,6386,6432,6434,6443,6719,6770,6949,8163,8219,8311,8327,8634,8747,8938,9105,9197,9249,9420,9580,9688,9689,9967,9972,10110,10151,10339,10422,10447,10502,10764,10886,11075,11488,11520,12043,12229,12232,12233,12313,12382,12450,12609,12863,12868,13137,13249,13423,13664,13771,13896,13921,13922,14013,14037,14060,14071,14102,14188,14203,14214,14450,14463,14512,14525,14560,14649,14670);
UPDATE public.sales_transactions SET is_northmarq=false, is_northmarq_source='salesforce'
 WHERE sale_id IN (817,1036,1037,1039,1047,1069,1072,1074,1076,1083,1084,1088,1094,1097,1100,1102,1115,1157,1158,4946,4980,4989,4995,5000,5003,5005,5072,5359,5489,5494,6345,6375,7976,8347);

-- APPLIED LIVE 2026-06-08 (Scott-gated). Result: adds_applied=96, removes_applied=34.
-- Post: is_northmarq=true 374 -> 436; tagged salesforce 130 (96 true / 34 false).
-- Contradiction flagged (not blocking): sale_id 8327, 13137 carry 'M&M; Glass'
--   (SF says NM-listed; DB broker says Marcus & Millichap) — left flagged, SF-authoritative.
-- Held for the complete unfiltered export: 84 null/personal-broker removes,
--   56 SJC/Briggs removes (kept flagged), 144 non-city-confirmed adds, 4 Task-4 no-match.
