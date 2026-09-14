-- ===========================================================================
-- P122 -- make the dormant inbound SF Opportunity sync VISIBLE
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- ===========================================================================
-- Chasing "why is bd_opportunities.amount NULL fleet-wide" ended in two
-- findings. The second is an inert capability that looks exactly like a healthy
-- quiet pipeline -- the failure mode feature_flags_registry exists for.
--
-- GROUNDED (live):
--   bd_opportunities .......... 614 rows, 45 open, 226 closed_won
--   ... with sf_opp_id ........ 607
--   ... with amount ........... 0        <-- every row, since 2026-06-03
--
-- FINDING 1 -- not a sync bug. These opportunities are OUTBOUND: LCC originates
-- them from property_flow leads and PUSHES to Salesforce (admin.js stores the
-- returned Id as sf_opp_id). `amount` is empty because LCC never had a deal
-- value to write, not because a sync drops it. Deriving one from rent or price
-- would be fabrication, so nothing is backfilled here.
--
-- FINDING 2 -- the genuinely dormant piece. The INBOUND path exists and would
-- carry Amount: api/bridges.js registers sync object `sf.opportunities` -> job
-- `salesforce.opportunity.upsert`, and the handler explicitly maps
-- `amount: p.Amount ?? null`. It has NEVER run -- 0 opportunities in
-- entities.metadata.salesforce.opportunities[] across the entire table. The gate
-- is the Power-Automate flow that would POST them; there is no env var, so
-- nothing anywhere reported it as "off". It read as a pipeline with nothing to
-- say.
--
-- Registering it means the daily briefing's "Dormant Capabilities" section
-- prints it (fetchDormantCapabilities -> renderDormantCapabilities), so the gap
-- is visible instead of being re-derived from NULLs a year later.
-- Verified: off_since 2026-06-03 = 75 days, so it clears the >30d print gate.
--
-- ALSO RECORDED HERE (the reason this matters beyond tidiness): milestone_confirm
-- was deliberately NOT value-ranked. Measured 38 of 40 rows would land on the
-- same flat $5,000 open-opportunity tier -- because deal amounts do not exist --
-- replacing a genuinely useful 0.5-1.0 extraction-confidence rank with noise.
-- A low-confidence AI-extracted milestone is exactly what a human should check
-- first. Re-evaluate once this flag flips to 'on' and real amounts land.
--
-- NOT DONE ON PURPOSE: no amount backfill; no attempt to reconcile SF-side
-- Amounts, which needs the PA flow to exist first.
-- REVERSAL: DELETE FROM feature_flags_registry WHERE flag='SF_OPPORTUNITY_INBOUND_SYNC';
-- ===========================================================================

INSERT INTO feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'SF_OPPORTUNITY_INBOUND_SYNC',
  'Inbound Salesforce Opportunity sync (sf.opportunities -> salesforce.opportunity.upsert). The ONLY path that would carry SF Amount / StageName / CloseDate into LCC.',
  'api/bridges.js SYNC_OBJECTS + api/_shared/bridge-handlers-salesforce.js::handleSalesforceOpportunityUpsert',
  NULL,   -- gated by the Power-Automate flow, not an env var
  'off',
  '2026-06-03',
  'scott',
  'Consequence while off: bd_opportunities.amount is NULL on all 614 rows, so every deal in the BD spine is value-blind. That is why P121 lcc_decision_entity_value can only give an open opportunity a flat tier instead of its real size, and why the milestone_confirm lane was NOT value-ranked (38 of 40 rows would land on the same $5k tier). Handler already maps p.Amount; only the PA flow is missing.'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose    = EXCLUDED.purpose,
  surface    = EXCLUDED.surface,
  state      = EXCLUDED.state,
  off_since  = COALESCE(feature_flags_registry.off_since, EXCLUDED.off_since),
  notes      = EXCLUDED.notes;
