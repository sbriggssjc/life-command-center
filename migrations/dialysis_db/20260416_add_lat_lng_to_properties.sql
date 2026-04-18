-- Add latitude/longitude columns for geocoding, map plotting, and proximity analysis
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric;

COMMENT ON COLUMN properties.latitude IS 'Latitude from CoStar Public Record tab';
COMMENT ON COLUMN properties.longitude IS 'Longitude from CoStar Public Record tab';
