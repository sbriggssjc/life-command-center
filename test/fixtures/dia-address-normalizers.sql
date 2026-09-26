-- Live dia definitions, read 2026-09-26 (pg_get_functiondef on zqzrriwuavgrquhisnoa), for tests that
-- need the real address keys without a database. Refresh from live if either function changes.
CREATE OR REPLACE FUNCTION public.dia_normalize_address(addr text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  t text := lower(coalesce(addr, ''));
begin
  t := regexp_replace(t, '[.,;:]', '', 'g');
  t := regexp_replace(t, '\s+', ' ', 'g');
  t := regexp_replace(t, '\mnortheast\M', 'ne', 'g');
  t := regexp_replace(t, '\mnorthwest\M', 'nw', 'g');
  t := regexp_replace(t, '\msoutheast\M', 'se', 'g');
  t := regexp_replace(t, '\msouthwest\M', 'sw', 'g');
  t := regexp_replace(t, '\mnorth\M', 'n', 'g');
  t := regexp_replace(t, '\msouth\M', 's', 'g');
  t := regexp_replace(t, '\meast\M', 'e', 'g');
  t := regexp_replace(t, '\mwest\M', 'w', 'g');
  t := regexp_replace(t, '\mboulevard\M', 'blvd', 'g');
  t := regexp_replace(t, '\mavenue\M', 'ave', 'g');
  t := regexp_replace(t, '\mstreet\M', 'st', 'g');
  t := regexp_replace(t, '\mdrive\M', 'dr', 'g');
  t := regexp_replace(t, '\mroad\M', 'rd', 'g');
  t := regexp_replace(t, '\mhighway\M', 'hwy', 'g');
  t := regexp_replace(t, '\mlane\M', 'ln', 'g');
  t := regexp_replace(t, '\mcourt\M', 'ct', 'g');
  t := regexp_replace(t, '\mcircle\M', 'cir', 'g');
  t := regexp_replace(t, '\mparkway\M', 'pkwy', 'g');
  t := regexp_replace(t, '\mplace\M', 'pl', 'g');
  t := regexp_replace(t, '\mplaza\M', 'plz', 'g');
  t := regexp_replace(t, '\msquare\M', 'sq', 'g');
  t := regexp_replace(t, '\mterrace\M', 'ter', 'g');
  t := regexp_replace(t, '\mtrail\M', 'trl', 'g');
  t := regexp_replace(t, '\malley\M', 'aly', 'g');
  t := regexp_replace(t, '\mexpressway\M', 'expy', 'g');
  t := regexp_replace(t, '\mfreeway\M', 'fwy', 'g');
  t := regexp_replace(t, '\mturnpike\M', 'tpke', 'g');
  t := regexp_replace(t, '\mcenter\M', 'ctr', 'g');
  t := regexp_replace(t, '\msuite\M', 'ste', 'g');
  t := regexp_replace(t, '\mapartment\M', 'apt', 'g');
  t := regexp_replace(t, '\mbuilding\M', 'bldg', 'g');
  t := regexp_replace(t, '\mfloor\M', 'fl', 'g');
  t := regexp_replace(t, '\mroom\M', 'rm', 'g');
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  return t;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dia_recon2_street_twin_key(addr text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select nullif(trim(regexp_replace(regexp_replace(regexp_replace(dia_normalize_address(addr),
    '\s+(ste|suite|unit|bldg|building|fl|floor|#)\.?\s*\S*\s*$', '', 'i'),
    '\y(north|south|east|west|ne|nw|se|sw|n|s|e|w|bypass|byp)\y', '', 'gi'),
    '\s+', ' ', 'g')), '');
$function$;
