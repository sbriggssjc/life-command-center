# BD pipeline funnel — where ownership history actually locks

**Measured 2026-08-28 (Cowork), live against all three databases.**
Commissioned by Scott: *"reaudit the system to assess where the biggest backlogs or locks are —
data ingestion and processing driving forward to the next actionable step, property by property and
then owner by owner, until we have a connected history of ownership of all of our target markets
all the way back to the developer through now."*

> **Every prior audit in this arc measured QUEUED WORK.** That only ever sees the symptom. This one
> measures the **funnel** — property → owner → chain → developer → contact → next action — and asks
> where a property stops progressing.

---

## 1. The funnel (gov)

| stage | count | of live |
|---|---:|---:|
| properties | 20,492 | — |
| **live** (excl. 6,657 archived) | **13,835** | 100% |
| has a domain `true_owner` | 9,830 | 71% |
| **has an LCC owner link** | **6,362** | **46%** |
| …of which **only the current owner** | 4,845 | 76% of linked |
| **has a chain (2+ links)** | **1,517** | **11%** |
| **has 2+ HISTORICAL links** | **149** | **1.1%** |

dia, for contrast: 2,075 linked · 1,505 with a chain · 568 with 2+ historical · deepest chain **14**
(gov's deepest is 6). **dia is materially further along on chain depth than gov.**

**Owner → action** (both domains): 6,480 distinct current owners · 5,462 in `owner_contact_pivot` ·
**1,439 with an active contact (26%)** · 2,302 cadences, of which **2,276 are due (99%)**.

## 2. The locks, ranked

### ✅ Lock 1 — RESOLVED 2026-08-28 (B1). The floor is now split by consumer.

> **Shipped:** `supabase/migrations/20260828120000_lcc_b1_split_chain_value_floor.sql`.
> Writeup: [`B1_CHAIN_VALUE_FLOOR_SPLIT_2026-08-28.md`](B1_CHAIN_VALUE_FLOOR_SPLIT_2026-08-28.md).
> Canonical: [`docs/architecture/ownership-history-lane.md`](../architecture/ownership-history-lane.md).
>
> ⚠️ **Three numbers below were corrected by the build, and they change what the finding means:**
> **(1)** "1,548" is `establish_ownership_history` across BOTH domains — gov 1,501 + dia 47 — and
> `trace_ownership_to_developer` carries a further 983 below-floor skips this audit never mentioned.
> **(2)** Only the gov slice has an automated consumer: **dia has no
> `v_ownership_transitions_portfolio`**, so a dia task can never be drafted. dia and
> `trace_ownership_to_developer` keep the $500k floor — 1,030 rows held by design.
> **(3)** The re-openable set is **1,414**, not 1,548: 86 are no longer suggested by the worklist
> and 1 already had an open task.

### 🔒 Lock 1 (as originally measured) — the $500k value floor is skipping 1,548 properties, and it now gates FREE work

**1,548 of 1,766 skips** in `establish_ownership_history` are `below_value_floor` at **$500,000**
(last applied 2026-07-31). That is **five times the 314 the lane has completed.**

**This was the right decision when it was made and is the wrong one now.** The floor exists because
the lane was a **human research queue** — and nobody should hand-research a $50k property. But
since **A2 (2026-08-27)** the `agrees` bucket is **applied automatically by cron 244** from a
deterministic, record-cited draft. **No human touches it. The marginal cost of a chain is now
approximately zero.**

So a floor sized for operator attention is now suppressing work that costs nothing — and it is
suppressing precisely the *coverage* Scott asked for. **A value gate belongs on what reaches a
human, not on what a cron applies.**

⚠️ **This is not "remove the floor."** The right shape is almost certainly **two floors**: none (or
a much lower one) for the automated `agrees` path, and the existing $500k for anything that
surfaces to a person (`mismatch`, `all_guarded`). **That distinction did not exist when the floor
was set, because the automated path did not exist.**

### 🔒 Lock 2 — ~3,468 gov properties have a domain owner that never reached the entity graph

9,830 have a `true_owner`; only 6,362 carry an LCC owner link. **Nothing downstream can touch the
difference** — not the chain, not contact resolution, not cadence. This is the documented
*"asset-identity coverage is what gates owner resolution"* gate, measured at the property level.

### 🔒 Lock 3 — 74% of pivot owners have no active contact

1,439 of 5,462. Known and already routed (Tier 0, contact acquisition, the egress-blocked SOS
path); recorded here for funnel completeness rather than as a new finding.

### 🔒 Lock 4 — the cadence surface is 99% overdue

**2,276 of 2,302 cadences are due.** A surface that is entirely red carries no signal: it cannot
distinguish urgent from stale, so it trains the operator to ignore it. **This is the
badge-that-is-noise failure at the scale of a whole surface**, and it has not been audited in this
arc.

## 3. Against Scott's stated goal

*"A connected history of ownership of all of our target markets all the way back to the developer."*

> ✅ **UPDATED 2026-08-28 after B1 → B1a.** gov properties with **any** ownership history
> **1,272 → 2,173 → 2,238**; with a **chain (2+ historical links) 149 → 177 → 178**; the lane's
> completions **336 → 1,237 → 1,302** — and the operator's `human_actionable` badge did **not**
> move off **55** through either round.
> ⚠️ **`any_history` moved 7× harder than `chain_2plus`, and that is the population, not a
> shortfall** — only 210 of the 1,501 below-floor properties carry ≥2 guard-passing transitions.
> ⚠️ **B1a REFUTED the "next constraint" named below.** Merging the duplicate entities drained
> `ambiguous_entity` 126 → 57 links and completed 65 more tasks, and `chain_2plus` moved by
> **one** — because **64 of those 65 tasks carried exactly one link**. Duplicates were the
> binding constraint on chain **EXISTENCE**, never on depth.
> **Chain DEPTH is SOURCE-limited.** If the entire remaining A2-blocked residue were unblocked it
> would yield **12** more `chain_2plus` properties (ambiguous 1, no_entity 1, placeholder 8 —
> permanently blocked by design, repeat 2); and of the 132 remaining open tasks, **99 carry
> exactly one link**, 26 carry two, 7 carry three or more. New depth requires new RECORDS
> (deed/OCR capture), not more lane work.
> See `docs/audits/B1a_AMBIGUOUS_ENTITY_MERGE_2026-08-28.md` and
> `docs/architecture/ownership-history-lane.md` §3a.

**As measured: 149 of 13,835 live gov properties (1.1%) have two or more historical owner links.** The
machinery to change that is **built, proven and running** — A1 split the lane, A2 applies chains
nightly, A3/A4/A4b route the residue, and it produced **314 completions and 304 facts in one day**
after 69 days at zero.

**It is not short of machinery. It is short of population**, and the largest single reason is a
value floor that predates the automation.

> ⚠️ **That last clause was true of `any_history` and WRONG of `chain_2plus`, and B1a measured the
> difference.** Lifting the floor added **901** properties with any history and **28** with a chain;
> merging the duplicate blockers then added **65** and **1**. Depth was never floor-limited — gov's
> ownership feed mostly records ONE transition per property. The sentence stands as written for
> coverage; for depth, read §3a of the lane doc.

## 3b. 🔁 RE-EVALUATION after B1a — the funnel has a floor, and it is DOCUMENT ACQUISITION

**B1a settled the depth question, and following it one layer down settles the whole audit.**
Measured 2026-08-28 on the gov domain:

| layer | count | note |
|---|---:|---|
| live properties | 13,835 | |
| properties with **any** recorded transition | 7,059 | 16,177 transitions — avg 2.3, but most convert to one usable link |
| properties with a `deed_record` | 4,176 | 5,804 records |
| **deed records carrying a GRANTOR** | **876** | **15%** — a deed without a grantor cannot make a chain link |
| **deed DOCUMENTS on file** | **325** | of 1,176 property documents total |
| deed documents with extracted text | 291 | **the OCR/capture chain works — 90% of docs have bytes** |

**Read the last three rows together.** The document pipeline is *healthy* — 1,057 of 1,176
documents have bytes, 291 of 325 deed docs have text. **It is not broken. It is empty.**
**325 deed documents across 13,835 properties is 2.3% coverage.**

### What this means, stated plainly

**The LCC-side machinery for ownership history is now essentially complete and correct.** Across
A1→B1a it went from 0 completions in 69 days to **1,302**, added ~1,000 properties with ownership
history, routes every residue class, and holds the operator badge flat at 55 while doing it.

**The remaining constraint is not in LCC. It is that we do not have the deeds.** Chain *depth*
requires a recorded conveyance per link, and:

- gov's own feed mostly records **one transition per property** (B1a §3a: 99 of 132 remaining open
  tasks carry exactly one link);
- the deed table that would supply more carries a grantor on **876 of 5,804 rows**;
- and only **325 deed documents** exist to extract from.

~~So "a connected history of ownership back to the developer" is gated on acquiring county deed
records at scale.~~ ⛔ **WRONG — and refuted within the same hour by the very next query. See §3c.**

⚠️ **Do not read this as "the work was wasted."** The machinery had to be correct *first* — every
record we acquire now flows automatically to a written ownership fact, nightly, with guards and
reversibility. **We built the consumer before the supply**, which is the right order; the ~1,000
properties gained came from records that were already on file and previously unreachable.

## 3c. ⛔ §3b's CONCLUSION WAS WRONG. gov HAS THE RECORDS AND HAS NEVER CONSUMED THEM.

**§3b concluded "we do not have the deeds, so this is now an external-acquisition problem." That
survived exactly one more query.** The mistake was measuring the *deed* tables and stopping —
without asking the question this repo asks of every stalled lane: **which producer already holds
this, and does a consumer exist?** (`docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Class 2.)

**B4 was the thread.** dia has chain depth gov lacks (deepest 14 vs 6; 568 properties with 2+
historical links vs gov's 178). Asking *where dia's historical facts come from* answers it
immediately — `lcc_entity_portfolio_facts.ownership_source`:

| domain | source | historical facts | properties |
|---|---|---:|---:|
| **dia** | **`sales_transactions_seller_exit`** | **2,207** | **1,584** |
| dia | (null / legacy) | 536 | 416 |
| gov | `gov_ownership_chain` (the A1→B1a lane) | 1,356 | 1,302 |
| gov | `gsa_lease_diff` | 976 | 821 |
| gov | `county_deed` | 104 | 104 |
| **gov** | **`sales_transactions_seller_exit`** | **— does not exist —** | **0** |

**dia's dominant source of ownership history is its own sales table**, via a *seller-exit* feeder:
when a sale is recorded, the SELLER's ownership interval is closed out, which is a historical
ownership fact by definition. **gov has never had that feeder.**

### The size of it

gov `sales_transactions` (excluding `exclude_from_property_linking`):

- **14,645 rows across 5,321 properties**, sale dates **1970 → 2026-08**
- **9,514 carry a named `seller`**; **4,697 properties** have a named seller *with a date*
- and `ownership_history` has consumed **`data_source='sales_transaction'` — 169 rows. 1.8%.**

Anti-joined against everything `ownership_history` already records (property + normalized prior-owner
name + exact date): **3,080 net-new rows across 2,114 properties.**

**gov currently has 178 properties with a chain and 2,238 with any history. This is a
2,114-property source sitting on-box, structured, dated, and unconsumed.**

⚠️ **3,080 is a CEILING, not a forecast**, for four reasons that must be measured before it is
quoted as a result: (1) each seller must resolve to an entity by the ID-to-ID discipline, and the
A2 residue classes (`ambiguous_entity`, `placeholder`, `no_entity`) will take a share; (2) the
anti-join keys on an *exact* date, so the **A2b one-conveyance-several-dates** class will inflate
it — the same conveyance recorded by `costar_sidebar` and by a sale row is one fact, not two;
(3) `gsa_lease_diff` already covers 3,704 properties and the overlap is real; (4) a seller-exit
closes an interval — it only deepens a chain where we also know who bought.

⚠️ **The `developer` column is NOT the path to Scott's goal** — it is populated on **32 rows / 30
properties**. "Back to the developer" is reached by *extending the chain until it terminates*, not
by reading a field.

### The durable lesson

**§3b measured the tables named after the answer (`deed_records`, `property_documents`) and
concluded the data did not exist.** It was one join away from a source holding 30× more. This is
the A5 lesson — *before building a consumer, grep for who already writes the gap* — and the A2
lesson — *check whether an existing producer already minted the parties* — arriving as a
**recommendation** rather than a code review. **A conclusion of "we must acquire data" is the most
expensive conclusion available and therefore earns the highest burden of proof: enumerate every
table that could carry the fact before reaching it.**

**Deed acquisition (K10 / A1b) is not refuted — it is DEFERRED.** It stays the right answer for
the tail beyond what sales data can reach. It is simply not the *next* thing.

## 4. Recommendation

1. ✅ **DONE (B1, 2026-08-28)** — floor split by consumer; 1,414 re-opened, reversibly.
   ✅ **DONE (B1a, 2026-08-28)** — the A2-blocked `ambiguous_entity` residue merged (59 groups /
   63 losers, 126 → 57 links, +65 completions, +66 facts).
   ⚠️ **AND IT SETTLED THE QUESTION IN THE OTHER DIRECTION: stop looking for the next blocker.**
   The whole remaining residue is worth **12** `chain_2plus` properties, and 99 of 132 remaining
   tasks carry one link. `trace_ownership_to_developer` (983) and dia (516) remain gated,
   deliberately — and lifting either would add `any_history`, not depth.
2. ⭐ **NEXT — B5: give gov the seller-exit feeder dia already has.** §3c: **9,514 named sellers
   across 4,697 dated properties, 1.8% consumed, ~3,080 net-new rows / 2,114 properties as a
   ceiling.** On-box, structured, dated. **Category (a) — deterministic plumbing, no LLM, no
   acquisition.** Build it as a **new evidence source feeding the SAME A2 apply path**, never as a
   second writer; grade the ceiling against the four deflators in §3c before quoting any result.
3. **Then measure the linkage gap (Lock 2 / B2)** — ~3,468 properties. Ask *why* the owner never
   became an entity before building anything; the gov `owner_needs_salesforce` lane just taught us
   that a zero can be a key-space artifact rather than a coverage fact.
   ⚠️ **B5 will move this number** — a seller-exit feeder resolves owners — so **re-measure Lock 2
   after B5, not before.**
4. **Audit the cadence surface separately (Lock 4 / B3)** — 99% overdue is its own finding, and
   Scott named touchpoint generation as a real time sink.
5. **Deferred, not refuted: deed acquisition (K10 / A1b)** — the right answer for the tail B5
   cannot reach. Size it *after* B5, when the residual gap is known rather than assumed.

⚠️ **Re-measure before acting.** The `establish_ownership_history` worklist currently suggests
**1,834** properties and `trace_ownership_to_developer` **1,729**; both move as A2 completes chains
and re-seeds the next question. Quote your own numbers.
