# Prompt 136 — W9_2_REACHABILITY_HARVEST is ON but stuck on 120 unresolvable targets

## Finding (Cowork production-health pass + diagnostic POST, 2026-08-26)
`reachability_harvest_review`: **16 rows ever, 0 in the last 11 days** (last write 2026-08-15), while the
unreachable pool is ~15k (dia 4,258 + gov 10,670). Cron `reachability-harvest-tick` (jobid 212,
`40 4 * * *`) **is active** — so it fires nightly and produces nothing. A bounded diagnostic `POST
/api/reachability-harvest-tick limit=5` shows why:

```
pool_counts.targets      = { dia:60, gov:60, total:120 }         ← only 120 owners targeted per run
pool_counts.deterministic= { candidates:240, donors_found:0, no_donor:240 }
pool_counts.llm          = { candidates:240, with_evidence:0, fresh:0 }
pool_counts.comms        = { header_fills:0, signature_evidence:0, create_contact:0 }
evidence_sources         = { intake:5000, comms_names:4305 }      ← evidence EXISTS, in volume
comms_scan               = { scanned:8000, harvestable:7926, header_name_pairs:4305,
                             signature_phones:2042, participants:14978 }
```

**This is a stall, NOT source exhaustion.** There are 5,000 intake records, 4,305 comms name-pairs and
2,042 signature phones available — but the run targets a **fixed 120-owner window** and, for those exact
120, finds `donors_found:0 / with_evidence:0`. Those 120 aren't marked as "checked, no evidence," so the
same 120 are re-selected every night, produce 0, and the harvest never advances to the thousands of other
unreachable owners — including the ones that DO have matchable evidence. Same class as the P135 property-twin
fixed-window stall (and the general Dead-End "producer that re-checks the same residue" pattern).

## Root cause
Target selection picks the top-120 unreachable owners by its ranking and then asks "is there evidence for
these?" (answer: no), instead of picking unreachable owners **that have matching evidence**. And a target
that yields no evidence is not recorded, so it can never fall out of the window.

## Ask — make the target window ADVANCE, and prefer targets that can actually be resolved
Two complementary fixes (do both):

1. **Mark no-evidence targets so they drop out of the window** (a "scored marker" like the LLM arm already
   uses for processed rows). A target checked and found to have no donor/evidence gets a dated marker;
   subsequent runs exclude it (with a periodic re-check window, e.g. re-eligible after N days in case new
   intake/comms evidence lands). This alone unsticks the cursor so run N+1 sees a fresh 120.
2. **Select targets by an evidence JOIN, not blind unreachability rank.** Prefer unreachable owners that
   have a candidate donor in the evidence pool (a matching `intake` snapshot / `comms` header-name /
   signature phone / SF contact). Targeting owners with available evidence is what turns the ~7,926
   harvestable comms rows into actual proposals instead of 0.

Keep every existing guard: verbatim-quote validation (ARM 2), fanout/brokerage suppression, the
`create_contact` proposal-only path (human mints the contact, never auto), the score budget, and
annotation-only writes to `reachability_harvest_review`.

## Honest counts
Report `targets_selected`, `targets_with_evidence`, `targets_marked_no_evidence`, and `remaining_untargeted`
so a genuinely quiet night (evidence pool truly drained) is distinguishable from a stuck window. Today the
tell was `targets:120` fixed with a 15k pool behind it.

## Guard
Add a test asserting that when the top-window targets all yield no evidence, the NEXT run selects a
DIFFERENT target set (window advances) — the exact silent stall found here. Mirror the P135 guard shape.

## Verify
- After deploy, a `POST` shows `targets_with_evidence > 0` and `proposed > 0` on a pool this size; over a
  few nightly runs `reachability_harvest_review` climbs past 16 and `last_7d > 0`. Assert on the
  proposal-count DELTA, not the flag.
- Still annotation-only; `create_contact` stays a human verdict.

## Deploy
JS-only (Railway redeploy) unless a marker table/column is added (then additive migration first). Commit
with the repo trailer. Companion to P135 — the two stalled assists are the only ones lacking an advancing
cursor/marker; the other 7 are healthy (see `docs/os/LOCAL-MODEL-LEVERAGE-MAP.md` §2 production-health table).
