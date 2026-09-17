# RECON1 — one clinic, three property rows, five stores that never reconcile: trace DaVita Banning end to end, fix it, and specify the post-ingest reconciler

**Filed:** 2026-09-17 (Cowork), from Scott's SB note *Self Clean Triggering.docx* (SBN-12) — nine
screenshots of one dialysis clinic. **Owner:** LCC (dia intake/ingest paths in `api/`, `supabase/migrations/dialysis/`,
`test/`). **Read first:** `docs/architecture/property-identity-and-address-resolution.md` (§P10a — this
is its first concrete case), `docs/architecture/flows/closing-the-loop-overview.md`, the OWNERGAP2-harris-c
response (HCAD situs numbering — same class), backlog rows `DIA-DUP1`, `PI1–PI8`, `OWNER-WRITERS1`.

## Scott's intent, verbatim

> We want the ingestion of any data to trigger a reconciliation of the data so that we have one accurate
> view of the property and all other features. Not many different views in different places. … The
> property should no longer be in the available section when it closes.

## What is true for this one clinic (Dialysis_DB, measured 2026-09-17)

**Three `properties` rows for 6050–6090 W Ramsey St, Banning CA:**

| property_id | address | how it arrived | what it holds |
|---|---|---|---|
| **29894** | `6050-6090 W Ramsey St` (the range) | the original | operator DaVita (id 4), recorded + true owner, **2 sales, 4 leases, 2 ownership rows, 3 listings** — the real record, completeness 83 |
| 35786 | `6050 W Ramsey St` | **OM intake** 2026-09-01 (`Staged from LCC OM intake e26e414f…`, artifact type `om\|rent_roll\|lease_abstract\|marketing_brochure`) | nothing but an **active** listing at $4.75M / 5.85%, broker Scott Briggs, Crexi URL |
| 51228 | `6090 W Ramsey St` | **CoStar** (`listing_date_source = costar_days_on_market`) | nothing but an **active** listing at $4.75M, seller `Genesis Kc Development Llc`, on-market 2024-12-12; `true_owner_id` set, no recorded owner; completeness 22, pipeline stage PROSPECT |

The address-range form (`6050-6090`) is why neither intake matched: the OM said `6050`, CoStar says
`6090`, and nothing resolves a single number into a range it belongs to. (`DIA-DUP1` — `18003 Longenbaugh
Rd` vs `Dr` — and the 27 Harris situs gaps are the same class.)

**Listings on 29894:** 2022 (sold 2022-11-29, linked to sale 4980 ✓); 2024-12-05 at $2.96M / 5.24%
via SVN, marked **`sold` / off-market 2026-06-19 with no sold date and no sale** — it was not sold, it was
relisted; 2026-07-30 at $4.75M, broker Scott Briggs, **sold 2026-09-14, linked to sale 15042 ✓**. Plus
the two **active** listings on the shells — that is why *Available (152)* still shows the clinic four
days after it closed.

**Sales on 29894:** 2022 ($2.9575M, Svn, buyer `Davita Healthcare Prtnrs` ← `DaVita`, source
`salesforce`, listing 10645) — this one created an ownership transition (`sales_transactions_seller_exit`).
2026-09-14 ($4,180,180, `listing_broker = Scott Briggs`, `is_northmarq = true`, source
`salesforce_internal_comp`, **buyer and seller empty, no `sf_deal_id`, no `listing_sale_id`**) — this one
created **no ownership row** and the Overview's *Recent closed sales* shows it with **no team** while
*Omaha* the same day shows *Team Briggs*: the attribution reads a field this ingest path never fills.

**Leases on 29894 (4):** DaVita Kidney Care 2013-07-14 → 2018-07-13 (`davita_subledger`, **`is_active = true`**,
expired eight years ago, rendered "Active" with a flat $154,854 schedule); DaVita Dialysis 2015-06-28 →
2025-06-30 ($251,345, `master_import`, `is_active = false`); two superseded copies. The lease behind a
3.70% cap sale in 2026 — the one the OM's `lease_abstract` artifact carried — **is not on the property; the
artifact landed on shell 35786.** "+ Lease commencement" is the widget's top gap on both rows.

**Owner on 29894:** recorded `DaVita HealthCare Partners`; deed grantee `Davita Healthcare Prtnrs` — a
spelling variant of the same entity flagged as an **owner conflict** (`deed_newer_stale`); ownership
history "every recorded owner has an end date and nobody has been recorded since" — the 2026 buyer is
nowhere because the sale carried none.

## What to build (three parts, one round; part 3 is the spec, not the build)

**1. Trace, as a table.** For each store that names this clinic (`properties`, `available_listings`,
`sales_transactions`, `leases`, `ownership_history`, `recorded_owners`/`true_owners`, `intake_*`,
`listing_*`, the OM intake artifact, the Salesforce comp), the row(s), which ingest wrote each, and
**which join should have fired and did not** — the seven above at least. This table is the spec's
evidence; the response carries it whole.

**2. Fix this clinic, through machinery, not by hand.** In order: fold 35786 and 51228 into 29894 with
the existing property-merge path (ledgered, reversible; listings/artifacts/owners follow the survivor);
close the two shell listings as **`superseded_by_sale`** with `sale_transaction_id = 15042` and
`off_market_date = 2026-09-14`; correct the 2024 listing to **`withdrawn`/`relisted`** (it was never sold);
attach the OM's lease abstract to 29894 and, if it yields a lease, insert it with `parent_lease_id`
superseding the 2015 row and mark the 2013 row inactive (its expiration is 2018); set the 2026 sale's
team attribution from `listing_broker_id → brokers → broker_company` / `is_northmarq` (Team Briggs), and
record buyer/seller as **"not on file"** with a task to pull the deed — never a guess; treat
`Davita Healthcare Prtnrs` / `DaVita HealthCare Partners` as one entity via the existing alias/normalise
path and clear the false conflict. After: *Available* no longer lists Banning, *Recent closed sales*
shows Team Briggs, the property has one owner chain ending in "buyer not on file (2026-09-14)".

**3. Specify `reconcile_property(property_id)` — the thing Scott is asking for.** A queue-driven,
idempotent function every ingest enqueues after it writes (OM intake, CoStar listing, Salesforce comp,
deed, lease abstract, HCAD/assessor), with named rules, each with its evidence from part 1:
R1 **identity** — resolve the incoming address against existing rows *including range membership and
suffix/directional variants* before creating a property (the §P10a matcher; PI3's decision object); a
miss creates a `property_identity_review` row, not a shell. R2 **sale closes listings** — a sale on a
property closes every active listing on the property (and its aliases) as `superseded_by_sale`, linked.
R3 **sale → ownership** — every sale writes an ownership transition; buyer/seller unknown = an explicit
"not on file" row + a task, never silence. R4 **sale → attribution** — `is_northmarq` + listing broker →
team, one rule, one source. R5 **lease supersession** — a newer lease with `parent_lease_id` deactivates
the older; `is_active` can never be true past expiration. R6 **name variants are not conflicts** — the
alias/normalise check runs before an owner conflict is raised. R7 **artifacts follow the property** —
an intake artifact attached to a row that later folds moves with it. Each rule: trigger, inputs, write,
ledger, test. Say what exists today for each (the loop overview names several) and what is new. **Where a
model belongs:** only R1's fuzzy tail and lease-abstract extraction (the on-box Ollama path the repo
already has behind flags); everything else is deterministic and must be.

**4. Size the blast radius**, read-only: how many dia properties share a house-number token and street
with another row (range vs single, suffix/directional variants); how many active listings sit on
properties with a sale dated after the listing; how many leases are `is_active = true` past expiration;
how many `is_northmarq` sales carry no team. Those four numbers are RECON2's scope.

## Prohibitions

- ⛔ No guessed buyers, owners or leases; "not on file" is the honest value. ⛔ Merges only through the
  existing ledgered merge path. ⛔ No model in the deterministic rules. ⛔ Redeploy both Railway services
  and confirm `/version`; migrations in `supabase/migrations/dialysis/` here, applied via the loop.

## Reporting

The part-1 trace table; the part-2 before/after for this clinic (screens in text: Available, Recent
closed sales, Ownership, Rent Roll, Deal History); the part-3 rule list with existing/new per rule;
the four part-4 numbers. **Parked:** anything noticed out of scope, one line each. If any step was
skipped, say so.
