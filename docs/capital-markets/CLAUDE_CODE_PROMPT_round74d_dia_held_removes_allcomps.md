# Claude Code prompt — Round 74d: finish the dia de-contamination (all-comps re-check + held removes)

> Closes the dia `is_northmarq` cleanup. R74c v3 left ~211 dia sales as **held
> removes** — currently `is_northmarq=true` but matched NO Internal Comp in the
> 1:1 pass. They were held (not stripped) pending the safeguard below. dia is
> still over-flagged (429 vs the ~262 Internal-Sold / ~199 listing authoritative
> set); these held rows are the gap. gov is done (66→129); dia #20 median already
> at 6.40% ≈ deck.

## The safeguard CC itself flagged — build it FIRST

The 1:1 matcher starved real NM comps (8327 Youngstown↔Austintown, 13137 Ripley)
into the remove bucket. Before stripping anything, add an **all-comps re-check**:
for every held-removal candidate, test it against **ALL** `sf_internal_comp_export`
Internal-Sold comps (not just the 1:1 winner) using the established tolerant gate
+ ≤25mi geocoded proximity + city/tenant confirm. Any candidate that matches ANY
comp is **not** a false positive — keep it (and side-reconcile via the Comp's
`Direct_Co_Broke__c`, routing `Co-Broke (Buyer)` → `is_northmarq_buyside`).

## Then classify the held set (dry-run → my gate → commit)

Partition the ~211 held `is_northmarq=true`-but-comp-unmatched dia sales:

1. **NM/SJC/Briggs listing-broker (≈75)** → **KEEP** (the guard: an explicit NM
   listing-broker string IS NM-listed by Scott's rule, Comp record or not). No write.
2. **Matches a comp under the all-comps re-check** → **KEEP** + side-reconcile
   (these are the starved-but-real comps; report how many surface — expect a few).
3. **null / individual-name / garbage broker AND matches no comp (≈137 minus #2)**
   → **propose `is_northmarq=false`**, tag `is_northmarq_source='salesforce_comp'`.
   These are the R23 broker-string false-positives. Spot-check sample: confirm
   none carry an NM token or a comp match.

## Guardrails

- Dry-run plan JSON: per-bucket counts, the all-comps re-check surfacers (bucket
  2), 30-row sample of the proposed removes (with broker string + "matched no comp"
  proof), and the post-strip dia `is_northmarq` count + #20 listing median (must
  stay ≈ 6.40%). → my independent verification → commit.
- **Flag-column + provenance only.** No price/term/cap writes. Idempotent.
- Never strip a row whose `listing_broker` matches the NM/SJC/Briggs token, and
  never strip a row that matches any Internal comp — both are the doctrine guards.
- Do NOT touch gov (done) or the dia rows already source-tagged this round.

## After this lands

Two small gated slices remain for a final polish round (NOT this prompt):
Task 4 (import the Internal-Sold comps that match no DB sale — the genuinely
missing NM deals, dia + gov, count + $ volume first), and Task 6c (dia
listing_date backfill for the ~222 over-stamp rows + stop the future-off_market
writer). Then the merge → Railway redeploy → fresh-export verification closeout.
