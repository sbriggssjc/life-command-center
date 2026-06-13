# Claude Code — R15 Phase 2b: fix CRE owner backfill (post-deploy verification found 3 blockers)

## Status (grounded live 2026-06-13, after Phase 2 deployed)
Phase 2 deployed; I applied the migration + ran the backfill drain. Result: owner
backfill nets almost nothing, for FOUR reasons — one already fixed, three for you:

### (0) FIXED LIVE by Cowork — `chk_entities_domain` didn't allow `'cre'`
Every CRE owner mint was failing at the entities INSERT with 23514 ("Failed to
create canonical entity" → `owner_rejected`, no skip reason). The constraint allowed
only `dia/gov/lcc`. (The Phase-1 note's claim that `entities.domain='cre'` had no
CHECK was wrong.) Migration `20260718132000_lcc_entities_domain_allow_cre` widened it
to include `'cre'` — applied live. After that, the AI path mints owners
(owner_set=2: Lexington Realty Trust, HUB Group Trucking). **Add this migration to
the repo for parity** (it's already live on LCC Opps). The three below are code.

### (1) Cross-domain entity reuse — the overlap view stays 0 without it (the payoff)
The newly-minted CRE owners are BRAND-NEW `domain='cre'` entities even though the
same real-world owner already exists in another domain:
- `HUB Group Trucking, Inc.` (new, cre, canonical `hub trucking`) vs existing
  `Hub Group` (gov, canonical `hub`).
- `Lexington Realty Trust` (new, cre, canonical `lexington realty trust`) vs existing
  `Lexington Realty` (null-domain, canonical `lexington realty`).
So `v_lcc_cre_cross_asset_owners` returns 0 — the CRE owner_entity_id never equals
the dia/gov portfolio owner's entity_id. AND we're now minting duplicate entities for
one real owner. `ensureCreOwnerEntity` resolves only within `domain='cre'` (the
dedup lookup forces `&domain=eq.cre`), so it can't reuse a gov/dia/null owner.
Fix: when resolving a CRE owner, look up an existing entity by canonical_name
**across ALL domains** and REUSE it (link the CRE property to that existing
entity_id) instead of minting a `cre` duplicate. That reuse IS the cross-asset link
— it's what lights up the overlap view. Note exact-canonical won't catch the two
examples above (`hub`≠`hub trucking`, `lexington realty`≠`lexington realty trust`),
so use the existing fuzzy/normalized matcher (the same one `lcc_apply_fuzzy_merges` /
the merge-candidate machinery uses) for org names; on a confident match reuse, else
mint a new `cre` entity. Keep it conservative — a wrong reuse merges two real owners,
so require a high match score for cross-domain reuse.

### (2) The AI pulls the TENANT, not the owner
`HUB Group Trucking, Inc.` is the building's TENANT (the trucking operator), not the
property owner. The pdf_ai_fallback prompt isn't distinguishing owner/seller/landlord
from tenant/occupant. Tighten the owner-extraction prompt to ask specifically for the
property's OWNER / SELLER / LANDLORD (the fee owner or disposition seller), and to
return null rather than guess when only a tenant is identifiable. Add the
tenant-vs-owner distinction explicitly (the tenant is often the building's brand/name
— exactly what the folder is named after — so "the folder tenant_brand" is a strong
NEGATIVE signal for the owner).

### (3) Master-sheet label scan finds nothing (6/6) — diagnose the real format
The dominant doc type is the Briggs master sheet (xlsx), and the label scan returned
`no_owner_found` on all 6 it read (fetch succeeded — `fetch_failed=0` — so the file
was read; no owner label matched). Two possibilities, and you must DIAGNOSE which:
- (a) the owner IS in the master sheet but under a label/layout the scan misses, or
- (b) Briggs master sheets are underwriting models that DON'T carry the owner at all.
Add a temporary diagnostic (a `?debug=labels` mode on the worker, or a one-off script
using the existing `SHAREPOINT_FETCH_URL` read-back) that dumps the master sheet's
non-empty cells / labels for 2-3 real files (e.g. the Vervent and a DaVita-anchored
master). THEN: if (a), extend the label set / adjacency to match; if (b), document it
and have the worker prefer the OM/BOV for owner and leave master-only properties
owner-pending (don't keep re-scanning a sheet that structurally has no owner — mark
it so it isn't retried every tick).

## Don't break / boundaries
- dia/gov pipelines unchanged. Cross-domain REUSE must not rewrite a dia/gov entity's
  domain — it links the CRE property to the existing entity, full stop.
- Conservative reuse: high match-score threshold; on doubt, mint a new cre entity
  rather than wrongly merge two owners.
- Still no scoring/underwriting.

## Tests / house rules
≤12 `api/*.js`; `node --check`; full suite green. Tests: cross-domain reuse (a CRE
owner whose fuzzy-canonical matches an existing gov org → reuses that entity_id, no
new cre row; a genuinely-new owner → mints cre); owner prompt rejects a tenant-only
doc; the label-scan diagnostic mode returns cell labels. Re-applying the constraint
migration is a no-op (already live).

## After deploy (Cowork verifies live)
- Re-run the backfill; CRE owners reuse existing gov/dia entities where they match;
  `v_lcc_cre_cross_asset_owners` returns the first REAL cross-asset owners (a CRE
  owner that also holds dia/gov assets, unified). That's the payoff.
- Master-sheet owners populate (if the owner is in the sheet) or are documented as
  not-present (if not), with no per-tick re-scan churn.
- Spot-check HUB Group: the owner should resolve to the real fee owner, not the
  trucking tenant.
