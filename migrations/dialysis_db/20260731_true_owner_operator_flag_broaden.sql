-- Ownership accuracy (Scott, 2026-07-31): "almost every property shows the
-- operator as the true owner; the recorded deed owner looks accurate."
--
-- Root cause was TWO-fold:
--   1. DATA: v_ownership_current.true_owner_is_operator = true_owners.is_operator_
--      not_owner. The big operators (DaVita Inc., Fresenius) were already flagged,
--      but ~14 operator rows (U.S. Renal Care, Northwest/Puget Sound/Central FL
--      Kidney Centers, DCI, Fresenius Kidney Care Inc., etc.) were NULL/false, so
--      the panel presented them as real owners. Fixed below (~800 more properties).
--   2. CODE (detail.js, separate commit): the frontend merge adopted the real
--      LCC-resolved owner into `true_owner` but left `true_owner_canonical` at the
--      stale domain operator name; the ladder/header display `canonical || owner`,
--      so the operator kept showing even when the real owner (e.g. "Radar
--      Woodbridge LLC") was known. Fixed by also setting true_owner_canonical.
--
-- Breadth: 7,551 of 12,381 v_ownership_current rows had true_owner_is_operator
-- BEFORE this; the operators here add ~800 more. With both fixes, the panel shows
-- the LCC-resolved owner when we have one, else falls back to the RECORDED deed
-- owner (accurate), never the operator.
--
-- Reversal: UPDATE true_owners SET is_operator_not_owner = false WHERE true_owner_id IN (...);

update true_owners set is_operator_not_owner = true
where true_owner_id in (
  'b68972da-17c3-4f5f-bbcc-7d464083cf7f', -- U.S. Renal Care
  '7e7b470c-55f5-4640-b700-84559b4e2a63', -- Northwest Kidney Centers
  '1c111c67-80e1-40cf-ad8a-77148b47bf35', -- Fresenius Kidney Care Inc.
  '7c780ae6-056c-4960-b189-553e56be6ed5', -- Atlantic Dialysis Management Services
  'ae6f1346-d184-4709-bda6-e918c40f36cd', -- Puget Sound Kidney Centers
  '7803e22e-44bc-49f1-b704-52bb60db85c9', -- Central Florida Kidney Centers
  'c70c8f20-be7e-4d3a-9cd0-5fedad993adb', -- DCI
  '0ebb2413-98cf-44d6-b064-d5eac1a88889', -- North Central PA Dialysis Clinics
  '89e735e0-72f2-4c97-adb1-10aeaba7d774', -- DVA RENAL HEALTHCARE INC
  '21ba8901-7000-4a26-903a-94dab90714ca', -- Total Renal Care Inc
  '58fa5515-d07e-4958-9f5f-7589ef83d3b8', -- Davita Hemodialysis Center LLC
  'e48e0885-ae81-4033-8101-5a9f9f2071ad', -- Kidney Center Inc
  '3b192c57-4411-476c-b483-9959a3060c7c', -- Dialysis Clinic, Inc., Hullander
  '81659ea4-ea96-4691-a99b-3ed1dfd4ed62'  -- Fresenius Medical Care North America
)
and coalesce(is_operator_not_owner, false) = false;
