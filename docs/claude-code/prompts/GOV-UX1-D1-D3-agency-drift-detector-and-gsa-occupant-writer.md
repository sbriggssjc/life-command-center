# GOV-UX1-D1 → D2 → D3 — fix the agency-drift detector, then auto-resolve the two safe classes (**run in the `government-lease` repo**)

Backlog: `GOV-UX1-D1`, `GOV-UX1-D2`, `GOV-UX1-D3`; related: `ID3a-drift`.
Scott approved all of Q46 on 2026-09-23, in Cowork's order. The measurements and reasoning are in LCC's
`docs/audits/GOV_UX1_NAVIGATION_OWNER_VERIFICATION_2026-09-22.md` §D. The gov DB (`scknotsqkcheojiaewwh`) schema is owned by `government-lease` (I16). Write migrations there, never in LCC.

Standing doctrine: only human-in-the-loop work belongs in a priority list; anything the code can decide, the code decides **and logs**, reversibly.

## Units, in order. Each unit is dry-run → counts → apply → verify, before the next starts.

**D1: fix the detector, not the data.**
- Today `v_gap_agency_drift` compares raw `lower(trim(p.agency))` vs `lower(trim(l.tenant_agency))`, has no lease-currency filter, and never reads `agency_canonical` (ID3a's fold).
- Live 2026-09-23: 1,239 `agency_disagreement` + 45 `lease_agency_but_property_agency_null` rows. CC's 2026-09-22 count from a broader query was 1,481 / 1,644 underlying pairs: 600 superseded, 802 expired, 308 spelling-only, 654 rows / 565 properties genuinely disagreeing.
- Rewrite the check to compare canonical vs canonical (`canonicalize_agency()` on both sides), over the **current, unsuperseded** lease only.
- State the denominator: rows vs properties, and before vs after, reconciling both numbers above.
- Everything that reads this view must keep working: gov `v_next_best_action`, LCC `app.js` "Resolve agency drift", and the Home research lane. Grep both repos.

**D2: GSA → occupying agency.**
- Condition: the property's agency canonicalizes to GSA, and the single current lease names one canonical **federal** agency. Then write the occupying agency (the canonical column ID3a uses; confirm which one before writing).
- Expected ~272 (Scott's GSA-vs-DHS screenshot, 13923 Gold Cir Omaha, is one of them).
- Exclude multi-tenant properties (4), leases whose agency string doesn't canonicalize, and non-federal lessees.
- Ledger every write (property_id, before, after, lease_id, rule, batch tag) with a service-role-only restore function. Follow the LEASEJUNK1 / GOV-AVAIL1 quarantine-log pattern.
- Decide, and say why: is this a one-shot backfill plus a trigger/tick that keeps it true for new leases, or only a backfill? The doctrine favours keeping it true.

**D3: fill a blank property agency from its current lease** (~45 properties). Use the same writer, ledger and restore as D2. Fill blanks only; never overwrite a non-blank value.

## Do not touch

- `canonicalize_agency()` / the ID3a registry logic. If the ~340 unrecognised lease strings need registry rows, file them. Don't widen the canonicalizer here.
- The remaining ~720 genuine disagreements stay human (GOV-UX1 §D row 6).

## Done means

- Tests (pytest in government-lease) for each rule's include/exclude cases, plus a mutation that turns each red.
- Live before/after counts for D1–D3 in the response.
- LCC backlog rows `GOV-UX1-D1..D3` and `ID3a-drift` updated. Put the LCC doc edits on an LCC branch, or list them for Cowork.
- No LCC Railway deploy is needed unless LCC code changes. If it does, redeploy BOTH services.
