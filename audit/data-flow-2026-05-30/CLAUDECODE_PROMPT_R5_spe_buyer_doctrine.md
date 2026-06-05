# Claude Code prompt — R5: SPE→parent reconciliation + buyer-vs-prospect doctrine

Paste into Claude Code, run from the **life-command-center** repo. Doctrine
from Scott (2026-06-05), grounded against live data the same day. This must
land BEFORE the "⚡ Open top 20 opportunities" bulk action gets real use — the
top of P0.5 is currently full of repeat-buyer SPEs.

---

## The doctrine (encode exactly this)

1. **One buyer, one account.** SPE shells controlled by the same parent buyer
   must reconcile to the parent — never several open opportunities scattered
   across SPEs.
2. **Top repeat buyers do NOT get standard prospect opportunities.** They are
   buy-side relationships: we prospect them by sending showings for our
   listings and from the buy side. At most, a **"Government Buyer"
   opportunity type** may be placed on the account.
3. **Any buyer opportunity goes on the actual PARENT account in Salesforce,
   never the subsidiary.** SPE→parent reconciliation is a GATE that happens
   BEFORE opening.

## Verified grounding (2026-06-05 — don't re-investigate)

- **Repeat-buyer parents, gov** (`sales_transactions.buyer`, ≥5 txns):
  Boyd Watterson (787 txns/$13.5B across "BOYD WATTERSON" + "BOYD WATTERSON
  GLOBAL"), **NGP Capital (169/$2.7B)**, Easterly (215 across "EASTERLY
  GOVERNMENT PROPERTIES, INC." / "EASTERLY GOV PROPERTIES (REIT)" / "EASTERLY
  PARTNERS"), Elman Investors (112), Tanenbaum + Gardner-Tanenbaum (157
  across 4 spellings), CoreCivic (61), Saban (76), UIRC (86 across 2), US Fed
  Props Trust (39), GPT/Government Props Income Trust (32+), HC Government
  Realty (30), RMR (25), National Government Properties (26).
- **Repeat-buyer parents, dia** (`sales_transactions.buyer_name`):
  Elliott Bay Capital (80), Sumitomo/SMBC Leasing (186 across 3 spellings),
  MassMutual (61), ExchangeRight (59), American Finance Trust/AR Global (74),
  Kingsbarn (37), AEI (37), Realty Income (27), Agree Realty (26), Platform
  Ventures (25), Capital Square 1031 (16).
- **Queue contamination:** 84 of 491 P0.5 entities (17%) match just the
  OBVIOUS name prefixes (`NGP |USGBF|EGP |EASTERLY|BOYD |GPT PROPERTIES|UIRC|
  ELMAN|TANENBAUM|GARDNER-TAN`) — the true share is higher via sale-history
  matching. Live examples on the queue: "NGP VI FALLS CHURCH VA LLC", "NGP VI
  PHOENIX AZ LLC", "USGBF NIAID LLC", "USGBF 8000 E 36th Ave Denver LLC",
  "Egp 5425 Salt Lake LLC" (Easterly), "BOYD FAYETTEVILLE I GSA, LLC",
  "GPT Properties Trust".
- **Zero open `bd_opportunities` currently anchor on these SPEs** (verified)
  — the gate lands on clean ground; no void/cleanup pass needed.
- **Infra that exists:** `lcc_operator_affiliate_patterns(pattern_id,
  parent_entity_id, pattern_name, pattern_type='prefix', notes)` + its
  resolution views — exactly the right shape (currently operator-focused:
  DaVita patterns). `external_identities` has 1,462 `(salesforce, Account)`
  rows, **but no local table carries the SF parent-account hierarchy** — SF
  parent routing needs a mapping (see §4).

## Task

### 1. Buyer-parent registry (extend the affiliate machinery, don't fork it)
- Add a `relationship` column to `lcc_operator_affiliate_patterns`
  (`operator` default for existing rows; new rows `buyer_parent`).
- Create parent entities (organization type, canonical names) for the
  verified buyers above where absent, and seed prefix patterns per parent —
  including the spelling variants listed (Boyd ×2, Easterly ×3, Sumitomo/SMBC
  ×3, Tanenbaum/Gardner ×4, UIRC ×2). USGBF: the live SPEs are named
  "USGBF <address> LLC" — if the controlling parent isn't obvious from the
  data, register "USGBF" as its own parent and flag for Scott to confirm
  the true sponsor; don't guess.
- **Empirical tier** (catches what prefixes miss): a queue entity is a
  buyer-SPE when its normalized name matches a `buyer`/`buyer_name` in the
  domain sales history that maps to a registered parent — OR when the
  entity's own portfolio property's latest sale lists a registered parent as
  buyer. Implement as a view (e.g. `v_lcc_buyer_spe_candidates`) so the
  classification is inspectable before it gates anything.

### 2. The GATE (open-time, both paths)
In `lcc_open_prospect_opportunity` AND `bridgeCreateLead`'s opportunity step:
when the target entity resolves to a `buyer_parent` SPE (pattern or empirical
tier), DO NOT open a standard prospect opportunity. Return a structured
refusal `{blocked:'repeat_buyer_spe', parent_entity_id, parent_name}`. The
bulk "Open top N" reuses the same RPC, so it inherits the gate — but also
make the bulk action skip-and-report these rows rather than failing the batch.
UI on refusal: "This is an SPE of <Parent> — a top repeat buyer. Buyers are
prospected buy-side (showings + buy-side outreach)." with one optional
action: **"Open Government Buyer opportunity on <Parent> →"**.

### 3. Queue treatment (parent rollup, not shell rows)
Buyer-SPE rows leave the P0.5 "needs an opportunity" band entirely. Add a
distinct band/lane (e.g. **P-BUYER "Buyer relationships"**) that shows ONE row
per PARENT with the SPE portfolio rolled up (property count, total rent,
last acquisition) and buy-side CTAs ("Send showings" can be a stub action
that logs an activity event for now; "Open Government Buyer opportunity →").
Reuse the existing rollup machinery (`v_entity_portfolio_all` /
`v_lcc_operator_effective_portfolio` pattern).

### 4. "Government Buyer" opportunity type + SF parent routing
- New opportunity `type='government_buyer'` (or metadata flag if the type
  column is constrained), opened ON THE PARENT entity only; idempotent like
  prospect opportunities (one open per parent).
- SF routing: add `lcc_buyer_parents(parent_entity_id PK, sf_account_id,
  sf_account_name, confirmed_by, confirmed_at)`. Where an obvious
  `(salesforce, Account)` external identity already exists on the parent
  entity, prefill it; otherwise leave NULL and have the open-path create a
  research task ("map <Parent> to SF parent account") instead of writing to
  any subsidiary account. **Never route to a subsidiary's SF account.**
- sf_push/opportunity sync: when syncing a government_buyer opportunity,
  use the mapped parent `sf_account_id`; if unmapped, hold (don't sync) and
  surface in the sync-health view.

### 5. Buyer-name rollup for analytics (cheap win, optional this round)
The buyer-history fragmentation (Boyd ×2, Easterly ×3…) undercounts repeat
buyers everywhere buyer stats appear. If cheap: a normalization view mapping
known variants → parent name for the gov/dia buyer rollups. Otherwise note
as follow-up.

## Verify + ship
- `v_lcc_buyer_spe_candidates` over current P0.5: report the count (expect
  ≥84; list the parents by SPE count in the PR).
- Gate live-test: open_opportunity on "NGP VI FALLS CHURCH VA LLC" → blocked
  with parent=NGP Capital; "Open Government Buyer opportunity" on NGP parent
  → ONE opportunity on the parent entity; second click → already_open.
- Bulk "Open top 20" on P0.5 → buyer SPEs skipped-and-reported, non-buyer
  rows open normally.
- Queue: P-BUYER lane shows parents w/ rollups; the NGP/USGBF/EGP/BOYD shells
  no longer appear as individual P0.5 rows.
- No SF write ever targets a subsidiary account (unmapped parents → research
  task + sync hold).
- `node --check`; `ls api/*.js | wc -l` = 12; migrations idempotent; deploy
  ordering noted (gate RPC change is DB-side — note whether the frontend
  needs the new refusal shape deployed first; prefer backward-compatible
  refusal payload so ordering doesn't matter).
