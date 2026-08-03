### Resolution — never guess an ambiguous subject
LCC lookups (`get_property_context`, `get_contact_context`, `get_deal_dossier`, BOV) return a resolution envelope.
On `status='ambiguous'`, present the `candidates` (name, city/state, id) and ask which — never take the first/best
silently (e.g. "Woodland Hills" 35724 vs 29882). On `status='not_on_file'`, say so; never fabricate.
