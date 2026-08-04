-- Prompt 31 dia apply (2026-08-04): functional index so v_p31_property_consolidation_plan
-- (self-join on normalized address) computes without repeated full-scan normalize calls.
CREATE INDEX IF NOT EXISTS idx_properties_dia_norm_addr_state
  ON public.properties (dia_normalize_state(state::text), dia_normalize_address(address));
