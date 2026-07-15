# Claude Code (government-lease) — ORE Phase A3: expand the SOS-direct fetcher (managing member/agent + notice address)

## Why (grounded 2026-07-14, approved by Scott)

The owner **entities + names** are covered, but **notice addresses + decision-maker
names are absent** (see `OWNERSHIP_RESOLUTION_ENGINE_authoritative_source_audit_2026-07-14.md`).
Two authoritative feeds are being activated:
- **Deeds** — LIVE now: Google Document AI verified working (5/5 deeds parsed,
  grantor/grantee extracted); the `lcc-document-text-deeds` cron (*/30, limit 15) is
  draining the ~5,700 gov deeds into the promote engine.
- **SOS-direct (this prompt)** — the per-state Secretary-of-State detail fetcher
  (`src/sos_detail_fetcher.py`, FL Sunbiz + AZ eCorp PoC) fetches the actual **managing
  member / registered agent + notice address**. It is built but **not running at scale**
  (`entity_registry_records` = 8,292 rows but only 1,735 carry a manager, 0 carry a
  mailing address; `recorded_owners.mailing_address` = 0). Expanding it is the
  no-paid-API public-records feed the promote engine + reconcile engine need.

**Note (do not re-raise):** the Brave/Serper web-search proxy is **PAUSED** (decision
2026-07-14). Contact acquisition is public-records-only. SOS-direct is the intelligent
free path.

## The build

**1. Stand up the SOS fetch egress + run FL/AZ at scale.** The fetcher logic + parsers
are built and fixture-tested; what's missing is the **outbound run** against the live
SOS sites (the sandbox has no egress). Wire the run the same way the other fetchers run
(a scheduled workstation/PA job or an egress-capable edge fetcher — the SOS sites are
free, public, no API key). Backfill the empty-manager `entity_registry_records` for FL
+ AZ owners (the states already built), writing managing member/agent **and the notice
address** (extend the parser to capture the registered-agent / principal address, not
just the name). Discipline unchanged: robots/ToS, gentle rate-limit, browser UA,
**never solve a CAPTCHA**, fail-soft, public business-entity data only.

**2. Add the next free, manager-listing states.** After FL/AZ, add **CA
(bizfileonline)** then the next-highest-owner-count free states (rank by where the
contactless valued owners cluster). TX SOSDirect is PAID → stays deferred. Each new
state = a parser + candidate-select (exact-normalized-name → `exact`; >1 or none →
`ambiguous`, never guess) + block detection, mirroring FL/AZ.

**3. Feed the promote engine + owner graph.** The SOS manager + notice address flow
through the existing Unit-A sync (`gov_sync_sos_registry_managers`) → `recorded_owners`
(`manager_name`, `manager_role`, and the new mailing/notice address via the promote
engine `gov_promote_parcel_mailing_to_owner`-style path — reuse it or the same
`county_records`/`sos_registry` provenance ranks). Fill-blanks, guard-checked,
reversible, dia-parallel where dia has the equivalent.

## Boundaries / verify

- government-lease `src/sos_detail_fetcher.py` (+ the run/egress) + the owner-write
  path; additive, fill-blanks, provenance-tagged (`sos_direct`/`sos_registry`),
  reversible. No paid API. `python -m py_compile` clean; the existing
  `tests/unit/test_sos_detail_fetcher.py` (31) stay green + add per-state parser tests.
- **Verify (post-egress):** a capped FL/AZ run resolves managing members/agents +
  addresses for real empty-manager owners; `entity_registry_records` managers climb;
  `recorded_owners.manager_name` + mailing address populate for the resolved set;
  spot-check 5 against the live SOS page (no wrong-entity attach; ambiguous → skipped).

## Bottom line

The SOS-direct fetcher is built and fixture-tested — it just isn't fetching. Stand up
the egress, run FL/AZ at scale (extend the parser to capture the notice address),
expand to CA + the next free states, and feed the promote engine. Combined with the
now-live deed feed, this populates the authoritative name+address layer the reconcile
engine (Phase B) needs — free, public-records-only.
