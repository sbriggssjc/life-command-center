# Prompt 102 — W9.6: correspondence → owner-LLC attribution (close the 2.5% comms-to-owner gap)

**Grounding (read first):** `docs/audits/W9_CONNECTEDNESS_KICKOFF.md`, prompt 96's second finding
(`docs/audits/W9_4_display_name_capture_2026-08-12.md` §"Second starvation finding" — the design
note for THIS unit), W9.5 baseline (correspondence→owner-LLC = **2.5%, 6/241**), W7 attribution,
the property→true_owner join, the W8/W9 house pattern. This is the last major INTERNAL linkage gap
— it connects the INBOX to the OWNER GRAPH, the reverse direction of your Outlook↔LCC bridge.

**The gap (grounded):** `activity_events` correspondence is stamped with the deal / party /
property entity the resolver found (`entity_id`, `bd_opportunity_id`) — brokers, buyers, seller
contacts. Those are PARTIES, not the owning LLC. So an email about a property doesn't surface
against the owner you're trying to reach. Prompt 96 confirmed: preserving names does NOT fix this —
it's a distinct linkage problem.

## Two attribution paths (deterministic-first, per the house pattern)

1. **Path A — property→owner bridge (deterministic):** a correspondence row tied to a PROPERTY (via
   `bd_opportunity_id` → deal's property, or an entity that resolves to an asset) → attribute the
   thread to that property's `true_owner` via the property→owner join (the ORE graph / domain
   owner tables). This is arithmetic where the property link exists — propose an owner-attribution
   edge (correspondence ↔ true_owner) with the join as evidence. Value-gate by owner portfolio rank.
2. **Path B — correspondent-is-owner-person (LLM-verbatim, thinner):** a correspondent whose name/
   email resolves to a person ALREADY tied to a true_owner entity (via external_identities /
   the resolver) → attribute the thread to that owner. U3-pattern verbatim evidence (the name/email
   match), lane confirm. Never guess a bridge on a shared-token name (the naming-core false-bridge
   risk from W9.1 — reject-in-lane class).

## Mechanics (house pattern)

Tick `/api/comms-owner-attribution-tick` (GET dry-run `?score=1&n=`, POST flag-gated), flag
`W9_6_COMMS_OWNER_ATTRIBUTION` OFF in-migration, nightly cron staggered after the chain (~5:05 UTC),
windowed+cursored, per-path counts + loud errors, budget floors, batched joins. Proposals → the
owner-contact worklist / a `comms_owner_attribution_review` lane (extend before forking; 75 guard).
Confirm → deterministic writer stamps the correspondence↔owner attribution (provenance
`comms_owner_bridge`, fsp row in-migration; reversible ledger). **Feeds two things:** (a) the owner
now has correspondence history when you open their record; (b) the reachability harvest's
create-contact arm gains owner-linked threads it couldn't see before (the arms compound). Metric:
correspondence→owner-LLC % (the W9.5 link this raises from 2.5%) → U4.

## Tests

Path-A join correctness, Path-B verbatim + false-bridge guard, attribution-never-auto, cursor walk,
fsp registration, read-only-until-verdict guard.

## Acceptance

- Dry-run: per-path counts + a sampled sheet (Path-A property-bridge attributions with the join
  shown; Path-B person-match with verbatim evidence). Honest zeros where thin.
- Scott reviews → Cowork flips. The W9.5 correspondence→owner pct rises measurably next run.
- ROLLOUT_STATUS W9.6 row; kickoff status; prompt to done/.

Commit with the repo Co-Authored-By + Claude-Session trailer.
