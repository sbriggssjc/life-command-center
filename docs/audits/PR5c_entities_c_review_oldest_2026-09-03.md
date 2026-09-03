# PR5c-entities-c-review + -oldest — the 15-pair plan, and the "oldest row wins" defect measured (2026-09-03)

Target LCC Opps `xengecqvemvfknjvbvrq`. **No merges performed. No `ensureEntityLink` change.**
Migration `20261013120000_lcc_entities_c_review_merge_plan.sql` (applied) adds a read-only ledger
and plan; everything in Half 2 is measurement.

Sibling reading: `docs/architecture/entity-identity-and-dedup.md` (§1 banned comparators, §4 the
arc verbatim) · `docs/audits/PR5c_entities_c_EMAIL_TIER_DOMAIN_SCOPE_2026-09-03.md`.

---

## Half 1 — the 15 genuine pairs

`v_lcc_entities_c_review_merge_plan`: **15 rows / 30 distinct endpoints / 15 distinct mailboxes**
— no entity appears in two pairs, so it is exactly one decision per mailbox. Ledger
`lcc_entities_c_pair_verdict` records all **55** blind pairs (15 `same_person`, 40
`different_parties` split `p131_document_row_label` 18 / `two_real_people_one_mailbox` 16 /
`firm_filed_as_person` 6), so the 40 are a recorded DECISION rather than residue somebody re-reads.
Neither object carries an `auto_mergeable` column (P198).

### The selection is TWO bases, and the split is the deliverable

**`initial_only_expansion` — 6 of 15, structural and reproducible.** Strip single-character tokens
(initials) from both canonical names; the residues must be identical and multi-token. It fires on
**6 of the 55 and 0 of the other 49**. It selects `Carl Verstandig` / `Carl J. Verstandig` and
correctly refuses `Income & Expenses` / `Expenses`, whose extra tokens are words rather than
initials — the clause that makes it a structural rule instead of a subset test.

**`human_read` — 9 of 15, NO RULE.** Andy/Andrew, Jim/James, Jamie/James, Nick/Nicholas,
Steve/Steven, Vince/Vincent, Ravi/Ravindra, Greg/Gregory need a nickname dictionary or a
shared-prefix test; Randy Blankstein/Blankenstein needs edit distance. Those are name-similarity
comparators, **banned for identity** here. Per the brief's own instruction the honest answer is a
recorded human read with a named reviewer, and each row carries the reason in `basis_note`.

### ⚠️ The P195 winner rule DEGENERATES on this population

`owns_assets → current_rent → portfolio_facts → external_ids → relationships → created_at → id` was
calibrated on OWNERS. These are brokers: **`owns_assets`, `current_rent` and `portfolio_facts` are
zero on all 30 endpoints** — and on **92 of the 93 endpoints across all 55 pairs**, so this is a
property of the population, not of the 15 I picked. The first three tiers are constant, and the
winner is decided entirely by `external_ids` (9 rows) then `relationships` (6).

That tie-break knows nothing about which NAME should survive. It picks `Frank Johnson` (2 ids, 1
rel, created Aug) over the older, better-connected `Frank D. Johnson` (1 id, 4 rels, Apr);
`Steve Karlson` over `Steven Karlson`; `W Greg Geiger` over `Gregory Geiger`. The plan therefore
reports the rule's answer **and names the tier that decided it** (`winner_decided_by`,
`ownership_tiers_all_zero`), and `confirm_sql` takes an explicit `(loser, winner)` so Scott can swap
the direction per row. **Do not read the winner column as a recommendation about the name.**

### ⚠️ The round trip found the reversal path is BROKEN — use `lcc_unmerge_entity`, not `lcc_p195_unmerge`

Run on the Harrison pair (the richest: 4+1 identities, 1+17 relationships, 1+1 cadences), inside a
self-rolling-back transaction, both paths:

| path | rows before | rows after | lost | new | changed |
|---|---:|---:|---:|---:|---|
| P195 wrapper (`lcc_p195_snapshot_loser` → `fold_pivot` → merge → `lcc_p195_unmerge`) | 26 | 26 | 0 | 0 | **2 edges stayed on the winner** |
| P196 path (`lcc_merge_entity` → `lcc_unmerge_entity`) | 26 | 26 | 0 | 0 | **0** |

The loser holds **three byte-identical `brokers` edges** to one counterparty
(`fb44d7cc`, `5aae123c`, `1d7e8618` — `entity_relationships` has no unique constraint on
`(from,to,type)`, P177). All 17 edges were snapshotted; on unmerge the first comes back and
**`trg_lcc_entity_rel_resolve_survivor`, a BEFORE INSERT trigger, SKIPS the other two as duplicates
of an edge the now-live loser already holds — so they never reach `ON CONFLICT (id) DO UPDATE`** and
stay on the winner. `lcc_p195_unmerge` reported `restored = 17` throughout.

**This is P196's exact finding, in the one reversal path that never got P196's fix.** P196 repaired
`lcc_unmerge_entity` (repoint survivors with `UPDATE`, INSERT only what was deleted); the P195
wrapper predates that and is now redundant anyway — `lcc_merge_entity` self-snapshots and self-logs
since P196, so the wrapper double-snapshots and double-folds. **The row COUNT is identical in both
runs**, so counting rows reads the broken path as clean; only the identity-keyed fingerprint
(`id:from>to:type`) exposes it. Filed **PR5c-entities-c-p195-unmerge**.

Residue after both probes: ledger 0, snapshots 0, tombstones 0, blind pairs 55, drift 0.

### The confirm, for Scott — one row at a time, nothing batched

`select * from v_lcc_entities_c_review_merge_plan order by basis, winner_name;` carries
`confirm_sql` and `reverse_sql` per row. Reverse any single merge with
`select * from lcc_unmerge_entity('<loser_id>');`.

---

## Half 2 — "oldest row wins": sized, and the obvious gate refuted

`api/_shared/entity-link.js:1163-1173` — the email tier fetches
`entity_type=eq.person & merged_into_entity_id=is.null & email=ilike.<addr> & order=created_at.asc
& limit=10` (+ `&domain=eq.` when the caller supplies one) and takes
`em.data.find(e => normalizeEmail(e.email) === normEmail)` — **the OLDEST exact match, with no
shape check on the resolved row.** Two nuances the brief did not state: the `.find` is over the
oldest **10** rows only, and **`if (domain)` means an inbound with no domain searches the whole
workspace**, so the tier is not always same-domain.

### 1. Population and the oldest row's shape

**193 same-domain mailboxes hold ≥2 live person entities** (496 entities; biggest group 24 —
one group larger than the `limit=10` window).

Reading all 193 oldest names rather than counting them: **26 are clearly not a single person** —
firms (`CBRE`, `Cushman & Wakefield`, `Kidder Mathews`, `Northmarq`, `SRS National Net Lease`,
`Newmark Robinson Park`, `NAI Burns Scalo`, `Fortis Net Lease`, `Horvath & Tremblay`,
`Keller Williams AdvantageUnited States`, `NextHome At The Lakes`, `UrbanAmerica II`), row labels
(`Condo`, `Debt Service`, `Taxes`, `Non Profit`, `Public`), whole sentences
(`This transaction was not financed.`, `Parties involved confirmed the transaction.`,
`Financing was used.`, `This information was confirmed by an SEC filing.`,
`This sales transaction was confirmed by the listing broker.`,
`Acreage, office building size, CAP confirmed by seller.`), a country
(`Korea, Republic of (South)`), a street (`One E Queen St`) and **UI chrome (`View Less`)**.

**⚠️ Every SQL guard we have, combined, catches 12 of those 26.** `lcc_looks_like_person` **PASSES
16 of the 26** — `Cushman & Wakefield`, `Kidder Mathews`, `NAI Burns Scalo`, `Fortis Net Lease`,
`Newmark Robinson Park`, `Non Profit`, `One E Queen St`, `View Less`,
`Parties involved confirmed the transaction.` … The hard guards
(`lcc_p131_is_document_row_label` / `lcc_is_rejected_contact_name` / `lcc_owner_name_is_junk` /
`lcc_owner_name_has_org_marker`) catch 7. That is P188's documented leak
(`Tenants In Common`, `Inco Commercial`, `Authorized Signer`) measured on a new population, and it
is the decisive input to the verdict: **the gate cannot do the job it would be built for.**

### 2. Has it already happened? — yes, and it is not confined to contested mailboxes

**80 live person entities carry a non-generic email and a junk-shaped name.** Of those:

- **30 carry a Salesforce identity** — i.e. the SF-resolve path (cron 165), which goes through this
  tier, has landed on them. Read on named rows: **21 are named `--`** (the N15c empty-key
  population) each holding a real broker's mailbox (`bobby@camelbackrea.com`, `mpalmer@aegon.com`,
  `bpickering@ngkf.com`, `bmcmanus@naihorizon.com`…); plus
  `Sr Mng Dir/Market Leader/Nat'l Dir Self-Storage` on `steven.weinstock@marcusmillichap.com`,
  `The information was verified with the seller brokers.` on `teamherrold@northmarq.com`,
  `Switzerland` on `peter.gilbertie@ubs.com`, `User` on `peter.berkowitz@davita.com`, `Unknown` on
  `aoconnell@htapartments.com`, `Daniel Chumbley, Sean Sharko, Austin Weisenbeck` (a listing TEAM —
  BR2's composite defect in the person slot) on `daniel.chumbley@marcusmillichap.com`, and
  `Don W & Yvonne E Morse` holding a *different* person's mailbox.
- **37 of the 80 are ALONE on their mailbox** and 43 are in a multi-entity contest.
- **0 of the 80 appear in `junk_entity_review`** (281 rows) and none carries
  `metadata.junk_name_flagged` (706 live). The existing junk lane has never seen this population.

⚠️ Direction, stated honestly: a Salesforce identity on a junk row is consistent with *the tier
attached a real SF contact to it* **and** with *the SF path minted it under a junk name from SF's
own data* (the 21 `--` rows are most likely the second). What the data does establish is the
landmine: these rows are live, hold real mailboxes, and are what the next inbound person on those
addresses resolves to.

The vendor-sourced side is larger and separate: `Cushman & Wakefield` carries **710** relationships,
`Public` (on Joey Agree's `jagree@agreerealty.com`) **380**, `View Less` **245**, `Horvath &
Tremblay` 48, `Non Profit` 43, `Kidder Mathews` 28, `Northmarq` (**on Scott's own
`sabriggs@northmarq.com`**) 17. Those edges are the RCA/CoStar deal-party slot minting a company as
a `person` — **C13c's `entity_type` defect, not this tier** — but they are what a future attach
would fold a real person into.

### 3. What would "prefer person-shaped" get wrong?

Run as a query only, over the same 193 groups:

| | groups |
|---|---:|
| ≥2 rows pass **every** guard we have | **171** |
| …and switching oldest → most-evidenced picks a DIFFERENT row | **139** |
| exactly one row passes | 22 |
| none passes | 0 |

So the rule's entire reach is the **22** groups where exactly one row is plausible. On the **171**
where two or more rows already pass, the gate is silent and any tiebreak is choosing between
plausible people — the Jack Minter / Creighton Stark shape — and 139 of those would change which
row wins for no reason connected to identity. And on the 26 junk-oldest mailboxes the gate catches
12 and lets 14 through.

## Verdict

**Do not build the gate. Retire the junk rows instead.**

A person-shape tiebreak is worth **12 correct exclusions of 26**, reaches only **22 of 193** groups,
is **structurally unable to help the 37 junk rows that are alone on their mailbox** (there is
nothing to prefer over them), and would re-pick the winner on 139 groups where both candidates are
plausible people. The 80 junk-named email-bearing person rows are the actual defect and they are
already a live landmine independent of any tiebreak; **0 of them are in the junk lane that exists**
(`junk_entity_review` / `metadata.junk_name_flagged`), which is the cheap, reversible fix
(`unstampMisparseMember` already clears `entities.email` + detaches the conflated identity, batch-
reversible via `junk_review_batch`). Sizing and reversibility for that sweep are **PR5c-entities-c-junk80**;
it is a bulk state change on live rows and was not run here.

## Verify on

- `select count(*) from v_lcc_entities_c_review_merge_plan;` = **15**, each with `basis` and
  `winner_decided_by`; `ownership_tiers_all_zero` true on all 15.
- `v_lcc_entities_c_review_merge_plan` has **no** `auto_mergeable` column.
- `v_lcc_entity_email_tier_blind_pairs` = **55** (nothing merged);
  `v_lcc_canonical_name_drift` = **0**.
- `v_lcc_merge_candidates where auto_mergeable` read **3,007** — re-derive, never quote
  (the doc's last figure was 3,006 on 2026-08-28 and nothing here writes to `entities`).
