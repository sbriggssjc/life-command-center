-- ============================================================================
-- FLAGS-geocode-on — Geocodio daily-usage ledger (LCC Opps)
-- Life Command Center — 2026-09-16 decision S3
--
-- The Geocodio free tier is 2,500 lookups/day, shared across BOTH domains
-- (dia + gov) since they hit the same Geocodio account. geocode-backfill.js
-- ticks per-domain, so the cap has to be tracked centrally (LCC Opps), not
-- per-domain, or two domain ticks in the same UTC day could each independently
-- believe they have the full 2,500 budget and double-spend it.
--
-- One row per UTC day. The handler increments `calls` after each Geocodio
-- attempt (hit or miss both count against the vendor's daily quota) and stops
-- routing to Geocodio for the rest of that day once `calls >= cap`. Census
-- keeps running regardless — the cap only throttles the paid/limited tier.
-- ============================================================================

CREATE TABLE IF NOT EXISTS geocode_tier_usage (
  usage_date  date PRIMARY KEY,
  tier        text NOT NULL DEFAULT 'geocodio',
  calls       integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE geocode_tier_usage IS
  'FLAGS-geocode-on (2026-09-16): per-UTC-day call counter for the Geocodio '
  'geocoding tier, shared across dia+gov since both ticks share one Geocodio '
  'account/quota. Read/incremented by api/_handlers/geocode-backfill.js. '
  'Not a general-purpose metering table — one row per day, tier is informational.';

ALTER TABLE geocode_tier_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON geocode_tier_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON geocode_tier_usage TO service_role;

DO $$
BEGIN
  ASSERT NOT has_table_privilege('anon', 'geocode_tier_usage', 'SELECT'),
    'geocode_tier_usage must not be anon-readable';
  ASSERT NOT has_table_privilege('authenticated', 'geocode_tier_usage', 'SELECT'),
    'geocode_tier_usage must not be authenticated-readable';
END $$;

-- Record the operator decision in the flag registry: Geocodio is ON (free
-- tier, capped 2,400/day so the handler never crosses Geocodio's own 2,500
-- ceiling), Google stays OFF by explicit decision (paid).
UPDATE feature_flags_registry
   SET state = 'on',
       off_since = NULL,
       notes = 'ON since 2026-09-16 (decision S3, "if it''s free, get these functions working") — '
               || 'free tier, capped at 2,400 Geocodio calls/UTC-day via geocode_tier_usage '
               || '(quota is shared across dia+gov). Census still runs first; Geocodio is the '
               || 'second-tier fallback on a Census miss.'
 WHERE flag = 'GEOCODIO_API_KEY';

UPDATE feature_flags_registry
   SET notes = notes || ' Reaffirmed OFF 2026-09-16 (decision S3): Google stays paid-and-off '
               || 'by explicit choice, not by omission — Geocodio''s free tier is preferred.'
 WHERE flag = 'GOOGLE_MAPS_API_KEY';
