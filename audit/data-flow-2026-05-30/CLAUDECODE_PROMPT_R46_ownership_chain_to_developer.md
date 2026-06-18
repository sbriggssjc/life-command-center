# Claude Code — R46: resolve ownership chains to the original developer (populate + direct research)

## Why (audit live 2026-06-18 — see AUDIT_ownership_chain_to_developer_2026-06-18.md)
gov ownership chains are ~1% complete (33/3,020); $1.88B of incomplete-chain rent. Three
compounding gaps (deed→ownership_history propagation is NOT the problem — verified only 31
props / 137 transfers unpropagated via the working `parcel_owner_xref` bridge):
1. **Developer endpoint essentially unknown** — only **17 of 12,465** active gov props have
   `developer`, so chains with history still can't complete.
2. **2,167 buyer-owned props have zero ownership history** — county deeds were never ingested
   for them (not a propagation gap).
3. **Research pipeline covers ~3%** — 113 `trace_ownership_to_developer` tasks for ~3,534
   incomplete chains, 106 queued/unworked.

## Unit 1 — populate `developer` from sources we already have (the highest-leverage fix)
Wire `properties.developer` (gov; dia where applicable) from, in priority order, with
field-provenance + fill-blanks-only (never clobber a curated developer):
- **Excel master DEVELOPER column** (`ingest_excel_master`) — confirm it's mapped/written;
  17/12k suggests it's dropped or the source is sparse. If the master carries it, propagate.
- **OM extraction** — the OM intake extractor captures developer (BTS deals state it);
  promote `developer` to `properties.developer` on a blank (like the R-series tenant
  back-write).
- **Earliest construction-era deed grantee** as a CANDIDATE (not auto-confirmed) — the first
  conveyance grantee on a property's deed chain is often the developer; surface for confirm.
This alone completes many chains that already have owner history. Re-run the chain-completeness
view after; expect `developer_named` to jump well above 8/72.

## Unit 2 — generate value-ranked research tasks for ALL incomplete chains, split by gap type
Replace the ~113-task trickle: `lcc_generate_chain_research_tasks` should cover every
incomplete chain, **ranked by $ rent**, tagged by what's actually missing:
- `establish_ownership_history` — the 2,167 no-history props → directed county-deed lookup
  (reuse the R26 county-recorder portal links; the operator pulls the deed history).
- `trace_ownership_to_developer` — has history, missing the developer endpoint.
- `confirm_developer` — a deed-grantee/OM candidate exists, needs human confirm.
Bounded per tick but not capped at a sliver; idempotent (don't re-create an open task for the
same property+gap).

## Unit 3 — surface as a value-ranked "ownership chain" Decision Center lane
A `v_ownership_chain_worklist` (gov+dia) over the incomplete chains joined to value, ranked by
$ rent, rendered as a Decision Center lane (reuse the existing lane pattern) with per-row
verdicts: **set_developer** (writes `properties.developer`, fill-blanks, provenance →
re-resolves the chain), **set_prior_owner** (adds an `ownership_history` segment),
**research** (spawns the directed task), **mark_unresolvable** (developer genuinely unknowable
— stops re-asking). Resolving a row propagates to the chain view + entity graph (R6/R40) and
drops it out.

## Unit 4 — small propagation cleanup
Propagate the 31 deed-linked props with no `ownership_history` + the 137 deed transfers not
reflected → write the grantor→grantee segments into `ownership_history` (via the
`parcel_owner_xref` bridge), reversible/idempotent.

## Guards / house rules
Fill-blanks-only on `developer` (never clobber curated); field-provenance on every write;
reuse the R6 chain view + R26 county links + R40 propagation; value-ranked; idempotent
research-task generation (no dupes — reuse the R21 dedup discipline). ≤12 `api/*.js`;
`node --check`/`py_compile`; suite green. Domain-aware (gov is the big gap; dia is healthier —
apply the same but expect fewer). Apply DB live after a dry-run; the developer backfill is a
fill-blanks correction (no published-CM number depends on `developer`), so low gating — but
report the before/after developer-coverage count.

## Bottom line
The chain-to-developer completes when (a) the developer endpoint is populated from sources we
already have, (b) the 2,167 no-history props get directed county-deed research, and (c) the
research pipeline covers all incomplete chains, value-ranked and workable. Then it keeps
completing automatically as new deeds/OMs are ingested — the connected, self-improving
ownership graph.
