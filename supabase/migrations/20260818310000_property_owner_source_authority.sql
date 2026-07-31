-- ============================================================================
-- Property-owner SOURCE AUTHORITY ladder (doctrine: Salesforce is a SOURCE, not
-- truth -- LCC reconciles against it, never treats it as automatically accurate).
-- See docs/architecture/property-owner-subsystem.md.
-- ----------------------------------------------------------------------------
-- Evidence weights encode authority (recency decay still applies on top):
--   manual         8.0  -- human-verified / curated pin (e.g. Genesis KC title entity)
--   deed_recorded  6.0  -- county deed / public record
--   rel_purchase   4.0  -- a recorded purchase transaction (title transferred)
--   sf_seller      3.5  -- the deal's Salesforce Opportunity Account (broker-entered CRM
--                         data -- a hint, NOT truth). LOWERED from 4.5 so a recorded
--                         purchase overrides it and higher-authority sources win; still
--                         resolves our own listings when it's the only evidence.
--   rel_owns       3.0  -- an ownership-graph edge
-- ============================================================================

update public.lcc_property_owner_evidence set weight = 3.5, updated_at = now()
  where source = 'sf_seller' and weight <> 3.5;

-- Manual pin -- the human-authority override. Records manual evidence (weight 8)
-- so a verified owner (e.g. Genesis KC Development for a confirmed DaVita
-- sale-leaseback) beats sf_seller and everything else, then reconciles.
create or replace function public.lcc_pin_property_owner(
  p_entity_id uuid, p_owner_entity_id uuid, p_note text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_entity_id is null or p_owner_entity_id is null then
    return jsonb_build_object('ok',false,'reason','missing_input');
  end if;
  perform public.lcc_record_property_owner_evidence(
    p_entity_id, p_owner_entity_id, 'manual', 8.0, now(),
    jsonb_build_object('note', p_note, 'pinned', true));
  return public.lcc_reconcile_property_owner(p_entity_id);
end $function$;

grant execute on function public.lcc_pin_property_owner(uuid,uuid,text) to anon, authenticated, service_role;

comment on function public.lcc_pin_property_owner(uuid,uuid,text) is
'Human-authority property-owner pin: records manual evidence (weight 8) so a verified owner beats sf_seller / graph, then reconciles. Reversible (delete the manual evidence row + re-reconcile).';

-- Re-reconcile every deal touched by sf_seller so the lowered weight + any
-- higher-authority evidence take effect.
select public.lcc_reconcile_property_owner(t.entity_id)
from (select distinct entity_id from public.lcc_property_owner_evidence where source = 'sf_seller') t;
