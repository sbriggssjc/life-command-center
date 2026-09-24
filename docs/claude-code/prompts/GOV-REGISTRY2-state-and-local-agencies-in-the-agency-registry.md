# GOV-REGISTRY2 — state, county and municipal agencies in the ID3a agency registry

Backlog: `GOV-REGISTRY2`, which absorbs `GOV-AVAIL2-state-registry`, `SIDEBAR-AGENCY-OVERWRITE-hhsc` and `GOV-CU1-fca`. Source: Cowork round 76 (2026-09-24). This is one topic: the registry has no way to name a state or local agency without losing the state, so the gov Available list shows those tenants as "unresolved".

## Measured (Cowork, gov `scknotsqkcheojiaewwh`, live)

- **Available list: 470 listings.**

| `government_type` | listings | with no `agency_id` |
|---|---|---|
| Federal | 331 | 51 |
| State | 63 | 59 |
| Municipal | 14 | 14 |
| **NULL** | **62** | 58 |

- **Non-junk gov properties: 13,878.** 5,848 have an agency but no `agency_id`. Of the 1,308 State/Municipal/County/Local properties, 933 are unresolved.
- **Concrete misses:**
  - Saginaw 16297, "Saginaw County Community Mental Health Authority" (Municipal);
  - "Tennessee Department of Human Services" (Jellico 16334);
  - "Florida Department of Corrections".
- **A wrong hit (`SIDEBAR-AGENCY-OVERWRITE-hhsc`):** `gov_resolve_agency('Health & Human Services Commission')` returns federal **HHS**, but on 33519 it's the Texas HHSC.
- **`GOV-CU1-fca`:** Farm Credit Administration has no rule. The SF router doesn't send "National Credit Union Administration" to gov.
- **Registry design:** the `ST-*` rows in `government_agencies` are generic ("Department of Corrections") and carry no state (GOV-AVAIL2 finding).

## Ask

1. **Decide the model and say why.** Options: per-state registry rows (code + state + level), or a jurisdiction (state/county/city) plus level column on `government_agencies`, with the generic `ST-*` rows as types. Read ID3a's design (`CURRENT-STATE.md` "Government agency identity") first and extend it; don't build a second registry. Keep `canonicalize_agency()` / `gov_resolve_agency()` the single resolver.
2. **Resolve with jurisdiction.** A state- or local-qualified string resolves only with the property's state (and county/city where the name carries one). "Health & Human Services Commission" on a TX property → the Texas HHSC, never federal HHS. Gate federal aliases on `government_type`/state where a state twin exists. Sweep the live `agency_id=HHS` rows for this collision.
3. **Promote through the existing ID3a writer path**, logged, only where the evidence is unambiguous: the Available list first, then the rest. Add FCA and NCUA (and make the SF router's `GOV_SIGNALS` see NCUA). Report before/after, for Available and overall, by `government_type`.
4. **The 62 Available listings with NULL `government_type`:** why are they untyped? Type them where the resolved agency makes it certain; otherwise report. No guessing.
5. **Display:** a resolved state or local agency shows its short name with the jurisdiction ("TN DHS", "Saginaw Co. CMH") and the full name on hover, through GOV-AVAIL2's `gov_display_*` functions. Don't add a parallel display path.

Tests: TX HHSC ≠ federal HHS; state-qualified strings resolve with the state; Saginaw resolves to the county authority; FCA and NCUA resolve federal; a generic "Department of Corrections" with no state stays unresolved. Each needs a mutation that turns it red.

## Done means

- The four backlog rows (`GOV-REGISTRY2` new; the three absorbed rows point at it) updated with evidence.
- Gov migrations recorded in government-lease (I16).
- Cache busters bumped if the JS changes. Deploy = redeploy BOTH Railway services if LCC code changes.
- Scott eyeballs Gov › Available: the State and Municipal rows should read as named agencies.
