# Response — 02 Connect the deal spine (SF Opportunity + Outlook + Sharefile)

**Branch:** `claude/deal-spine-sf-outlook-sharefile-yjemsf` · **DB:** LCC Opps `xengecqvemvfknjvbvrq`

## What shipped

Prompt 02 depends on prompt 06 (the deal-spine schema). **06 had not been built**, so I built it first,
then wired 02 on top and reconciled property 35724 / entity `d118b3a1` from real sourced data.

### 1. Deal-spine schema (prompt 06 foundation) — `20260820120000_lcc_deal_spine.sql` (applied live)
New, idempotent, additive, reversible (DROP to revert). All keyed to the deal/asset entity:

- `lcc_deal_commission` — commission/ELA terms + stage (`bov_proposed`/`ela_negotiated`/`ela_executed`/`loi`/`closed`), direct & co-broker pct, split, fee, executed date, source doc.
- `lcc_deal_milestone` — chronological milestones (`prospecting…close`) with date, `past/now/next` status, summary, source, `detail_ref` for double-click, canonical `sort_order`.
- `lcc_deal_diligence` — vendor tracker (survey/PCA/Phase I/appraisal/…), ordered/site-visit/ETA/completed dates, `lender_required`.
- `lcc_deal_correspondence_summary` (+ `v_..._current`) — rolling per-deal summary with topics/thread-count, links back to `activity_events` for detail.
- `lcc_deal_document` — deal-room/SF/Sharefile docs with `reconciled` status.
- `lcc_deal_conflict` — **surfaced, never auto-resolved** reconciliations (`values[] {v,source}`, open/resolved/dismissed).
- `lcc_deal_parties(entity)` — party graph w/ side + role + effective dates, reading `entity_relationships` as the role-history store (requirement #4 — no new table needed).
- `lcc_deal_spine(entity)` — one-call read model returning all spine sections for `buildDealPacket`.

### 2. Connection / assembly (prompt 02) — `entities-handler.js` `buildDealPacket`
Rewritten to assemble the tagged deal packet per `deal-surface-packet-and-layout.md`:
`commission / milestones / diligence / documents / parties (by side/role) / conflicts /
correspondence_summary / connected_sources / stage / sf_opportunity_id`.

**Reconciliation discipline enforced in code:** a `brokers` edge sourced from CoStar/`dia_contact`
is labelled `third_party` and flagged **"unverified role"** while a `listing_broker` conflict is open —
it never stands as our verified role. `connected_sources` exposes the live gaps (Salesforce
`no_opportunity`, Outlook/Sharefile `not_linked`).

`dossier-generator.js` `renderDealSections` extended to render every new section (each prints
**"Not on file"** when absent — no fabrication). +1 unit test (9/9 pass; existing 8 still green).

### 3. 35724 reconciled from real, sourced data only (no fabrication)
- **Milestones (3):** OM received 2026-06-04, listing doc 2026-06-08 (from `activity_events`), **closed 2026-07-24 at $15,729,896 / 6.00%** (from the reconciled dia sale 14832).
- **Document (1):** the Offering Memorandum (from OM intake).
- **Correspondence summary (1):** rollup of the 4 `activity_events`, explicitly noting no Outlook/Sharefile linked yet.
- **Conflict (1, open):** `listing_broker` — CoStar says *Chris Bodnar (CBRE Inc.)*; our own role is **unverified** (`is_northmarq=false`, no SF Opportunity). Surfaced for human resolution.
- Commission & diligence intentionally **empty → "Not on file"** (no ELA / no diligence linked).

`lcc_deal_spine('d118b3a1…')` now returns all of the above; the render path is unit-tested.

## Honest gaps (require live connectors — NOT reachable from this environment)
- **Salesforce Opportunity:** there is **no** SF Opportunity for this closed deal and no live SF API here.
  I did **not** fabricate an `sf_deal_id`, and I did **not** auto-create a real SF Opportunity (an
  outward, hard-to-reverse write) without your go-ahead. Next step (your call): enqueue an
  `sf_sync_queue` Opportunity-create, then stamp `dia.sales_transactions.sf_deal_id` + a
  `bd_opportunities` row on the return path. `connected_sources.salesforce = no_opportunity` today.
- **Outlook:** no cleanly-isolated deal thread is linked (the entity has 4 intake activities;
  `email_bodies` matches are Fresenius-broad, not deal-specific). Directional thread linking +
  role inference needs the Outlook connector to land the thread onto the entity.
- **Sharefile/deal room:** `sharepoint_documents` is empty; the OM is the only linked doc (via intake).
  Roster/ELA/LOI/PSA extraction needs the deal-room connector.

The **durable mechanism is complete and live**; realizing the SF/Outlook/Sharefile fill is gated on
those connectors — consistent with this repo's "build the mechanism, credential realizes the value" doctrine.

## Verify
- `SELECT public.lcc_deal_spine('d118b3a1-ec3b-4e44-aca8-5f76c754ae7a')` → commission `[]`, milestones (3),
  diligence `[]`, documents (1), correspondence_summary (populated), conflicts (1 open listing_broker).
- `node --test test/dossier-generator.test.mjs` → 9/9 pass (incl. the deal-spine render test).

## Note (from Supabase advisor)
The new spine tables inherit the repo's existing pattern (RLS not yet enabled on several `lcc_*` tables,
service-role access). The advisor flags 21 such tables; enabling RLS without policies would block all
access — left for your RLS workstream, not auto-applied.
