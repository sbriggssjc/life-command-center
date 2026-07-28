# Deal-Email Matcher — recall v2 design (A5)

_2026-07-28. Break-out design note. A6 confirmed the matcher IS the roster mechanism (no SF party source), so
recall matters. This specs the recall upgrade — and records a validation that killed the naive version before
it shipped._

## What's NOT buildable (data missing)
The original A5 signals don't exist in LCC data yet:
- **Asset `address`** is null for ~20/21 in-scope deals → no address matching.
- **Escrow # / OM-PSA reference** aren't stored per deal → no id matching.
Populating asset addresses from the SF Opportunity is now catalog item **A5b** (unlocks address matching later).

## The real recall gap (measured)
Current matcher requires the **full tenant segment AND city**, both verbatim. Two failure modes, both real:
1. **Suffix noise.** "Innovative Renal Care **MOB**" never appears verbatim; emails say "Innovative Renal Care".
   Stripping generic suffixes (MOB, Dialysis, Clinic, Center, Urgent Care, Health, Portfolio N, MOB…) → the core
   tenant "Innovative Renal Care" matches **8 emails**.
2. **City omission.** Those 8 emails mention **zero** "Milwaukee" — the thread uses a suburb / omits the city.
   Requiring city drops the entire deal's correspondence. (8 emails mention "innovative renal"; 0 also say
   "milwaukee".)

## The validation that killed the naive fix
Tempting rule: "if the tenant is unique among in-scope deals, match tenant-alone (skip city)." **Measured — it's
catastrophic:**

| tenant | unique in scope? | tenant-alone matches | tenant+city |
|---|---|---|---|
| **DaVita** (Zapata) | yes | **1,051** | 3 |
| **Fresenius** (Rome) | yes | **506** | 15 |
| Innovative Renal Care | yes | 8 | 0 |
| Archbold Medical Center | yes | 8 | 2 |
| Concentra Urgent Care | yes | 6 | 2 |

"Unique in scope" ≠ "safe" — DaVita/Fresenius are national operators whose name is in hundreds of unrelated
emails. Tenant-alone there would mis-attribute ~1,000 emails to one deal. **The discriminator is frequency, not
uniqueness.**

## Recall v2 rule (precision-first, frequency-adaptive)
For each in-scope open deal:
1. **Core tenant** = tenant segment with generic suffixes stripped (fixes "…MOB").
2. Count `N` = outlook emails matching the core tenant alone.
3. **If `N` is small (≤ threshold, start ~25) AND the core tenant is unique among in-scope deals** →
   **tenant-alone** match (recovers city-omitted threads like IRC's 8).
4. **Else** (high-frequency operator like DaVita/Fresenius, or tenant shared by ≥2 in-scope deals) →
   **require tenant + city** (today's behavior — preserves precision / disambiguates the 3 DaVita Dialysis deals).
5. Keep all existing precision guards (min lengths, tenant≠city, idempotent writes).

Net: recovers the distinctive single-location deals (IRC, Archbold, Concentra, Action Behavior…) without loosening
anything for the operators where loosening is dangerous.

## Build plan
- Add the above to `mcp/deal-email-matcher.js` as the candidate-selection stage, plus a **`?dry_run=1`** mode
  that returns per-deal `{core_tenant, N, mode: 'tenant_alone'|'tenant_city', would_attribute}` **without
  writing**, so precision is validated on real data before the live run. Threshold tunable via query param.
- Ship behind the dry-run: review the would-attribute set for the newly-recalled deals, then run live.

## Status
Design validated on live data (the table above). Not yet built — this is the next matcher build, and it carries
its own dry-run validation gate because it touches the precision profile Scott validated on BUILD 04.
