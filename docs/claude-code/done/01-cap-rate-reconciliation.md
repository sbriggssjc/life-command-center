# Prompt 01 — Cap-rate reconciliation (property 35724)
- Priority: **P0** (live data is currently wrong)
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/living-deal-dossier-and-systems-connection.md` §3, deal dossier v2
- Response file: `../responses/01-cap-rate-reconciliation.response.md`

## Prompt (copy/paste to Claude Code)
```
Property 35724 (dialysis DB) closed at our OM asking: listing 14879 shows initial_price $15,729,896 with
initial_cap_rate/current_cap_rate 0.0600, status sold. In-place lease rent (live lease 25390) is $943,794, and
$943,794 / $15,729,896 = exactly 6.00%. But sales_transactions sale_id 14832 stores calculated_cap_rate 0.0646
/ cap_rate_final 0.06461 and rent_at_sale $1,016,362.91 (= $943,794 x 1.025^3), i.e. the "2.5% Annually"
escalation was applied ahead of the actual schedule. Reconcile to the truth everywhere: set rent_at_sale =
$943,794 and the cap to 6.00% on sales_transactions 14832 (and the listing 14879 cap_rate field 0.0646), then
FIX the root cause — review the lease amendments + our OM to correct the rent-schedule anchor/dates on lease
25390 so the escalation engine stops projecting current rent ahead of the actual in-place rent. Add a guard/test
that a closed deal's cap reconciles to our OM asking cap when we were the listing broker. Verify the deal dossier
and every surface now shows 6.00%.
```

## Verify
sales_transactions 14832 shows rent_at_sale $943,794 and cap 6.00%; listing 14879 cap_rate = 0.0600; the lease
rent schedule anchor matches the OM; the deal dossier renders 6.00%.
