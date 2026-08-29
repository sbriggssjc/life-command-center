# B6b-lead — restart the ownership-change lead lane, MEASURED, never blind

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B6b-lead`.
**Repo:** **government-lease** (`ingest_ownership`) + LCC only if a consumer needs wiring.
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` · `data-coherence-invariants.md` **I1/I4/I7**.
**Source:** `docs/audits/B6b_GSA_LANDLORD_CHANGE_RESTART_2026-08-28.md` §8/§9.

---

## 0. Why this one is different from every other dead producer

**Its consumer is CONFIRMED ALIVE, with a measured working record.** `prospect_leads` where
`lead_source='ownership_change'`: **7,729 leads · 2,041 worked · 208 pushed to Salesforce · 2,149
touched in the last 30 days.** Most restarts cannot say that — this is not a speculative producer,
it is one somebody actually used.

**It is dead, and correctly still alerting:** newest lead **2026-03-31**, `feed_stale` open at
**150 days**.

⚠️ **And it is a ~10,635-row FIRST WRITE gated only by `is_same_owner`, a name heuristic — not by
the deflation chain.** That combination is why B6b deliberately did **not** restart it blind.

---

## 1. The signal is real — and B6's "no lessor signal" claim is REFUTED by a probe bug

**⚠️ This is the jsonb-string trap (playbook Class 11), and it cost two rounds.** Measured live
2026-08-29:

| probe | result |
|---|---:|
| `changed_fields ? 'lessor_name'` (the naive one B6 and B6b's first probe used) | **0** |
| `(changed_fields #>> '{}')::jsonb ? 'lessor_name'` (correct) | **16,907** |
| rows where `jsonb_typeof(changed_fields) = 'string'` | **201,212 of 233,666 (86%)** |

**`changed_fields` is a jsonb STRING holding JSON text**, so the containment operator is
structurally unable to match and returns a clean, plausible zero. **A whole producer was written off
on that zero.** Correct probe above; **check `jsonb_typeof` before trusting any containment result.**

---

## 2. ⚠️ The deflation chain, measured — do NOT feed 16,907 anywhere

| stage | count | note |
|---|---:|---|
| lessor-change events (correct probe) | **16,907** | |
| − missing an old or new side | −415 | |
| **− PURE RE-SPELLING** (normalized old = normalized new) | **−7,940 (47.0%)** | ⚠️ **independently corroborates B6's 46.7% on `landlord_change_flag`** |
| **= genuine name changes** | **8,552** across **2,760 properties** | |
| **− genuine but `property_id IS NULL`** | **−3,565 (42% of genuine)** | **cannot reach a property-keyed store at all** |
| **≈ genuine AND property-linked** | **≈4,987** | **and this is still BEFORE the fan-out and oscillation guards** |

**Then two more deflators that already have implementations — reuse them, do not re-derive:**

- **A2b per-lease fan-out.** These events are keyed on `lease_number`, so **one conveyance emits one
  row per lease on the building** — maximally exposed. `collapseRepeatedConveyances` solves this class.
- **P138 flicker.** An SPE↔parent oscillation with a return leg: the DATE is real, the DIRECTION is
  not. `is_oscillating_pair` already detects it.

⚠️ **The backlog's "10,635 usable pair-events" is a PRE-DEFLATION number. Do not quote it as the
target.** And of those, only **995 arrived since the lane died** — **9,640 are historical rows the
producer left behind while it was running**, which is a different decision from resuming it.

**⚠️ THE HEURISTIC IS THE SAFETY GATE, SO MEASURE IT BEFORE TRUSTING IT.** `is_same_owner` is the
only thing standing between this and 10,635 writes. **Compare it head-to-head against the normalized
test above on all 16,907 rows and report the disagreement count and named examples.** If it is
weaker, re-spellings become fake ownership changes and fake leads. **A gate nobody has graded is not
a gate.**

---

## 3. What to do

1. **Grade `is_same_owner`** against the normalized comparison (§2). Report agreement, disagreement,
   and ~10 named rows from each disagreement direction.
2. **Run a CREDENTIALED DRY RUN** — the thing B6b could not do from the sandbox. Report the full
   funnel: raw → deflated → property-linked → would-write.
3. **Decide the historical 9,640 separately from the ongoing 995.** Resuming a producer and
   backfilling five months of residue are two decisions; **do not let one ride in on the other.**
4. **Restart with the deflation chain applied**, batch-tagged and reversible, dry-run default.
5. **Register it in B6a's producer registry** with an expected cadence and declared skips, or it
   restarts into the same blindness B6a just fixed.

## 4. ⚠️ Rules

**4a. Value-gate it before it reaches a human (Consumption Layer).** 7,729 existing leads against
2,041 ever worked is a **26% consumption rate**; adding thousands more unranked would bury the
worked ones. **Rank by owner value and cap what surfaces.**

**4b. Do not write ownership facts from this lane in this prompt.** A lead is a prospecting signal;
an ownership fact is a claim about title. **If it should also feed `ownership_history`, that is a
separate decision with the B5/A2 apply path and its guards** — and note **B5 already consumes the
sale-side signal**, so check for overlap before adding a second producer of the same fact.

**4c. ⚠️ The `ownership_history` propagation trigger nulls a real owner if a row names parties as
TEXT.** B5 found **7,567 rows already damaged** and **1,446 of 9,312** about to be, and fixed it
fill-forward. **This producer writes text parties.** If 4b is ever taken, confirm the guard, snapshot
first, positive-control both directions.

**4d. Expect the lane to stay QUIET after restart, and do not read that as failure.** The newest
lessor event is **2026-07-01** — the same ceiling as the raw GSA feed, because **GSA has not
published August** (pull ledger: 2026-08-24, `consecutive_unchanged=3`). **A correct restart
processes the backlog and then waits.**

**4e. Python, in government-lease** — every network call carries its own `timeout=`.

## 5. Verification

- **The `feed_stale` alert for `prospect_leads_ownership_change` AUTO-RESOLVES.** Read the alert
  state, **not** the run log — that is what B6a-follow-up exists for.
- **`is_same_owner`'s grade is reported**, with named disagreements.
- **The funnel is reported at every stage**, and the deflated number — not 16,907 or 10,635 — is
  what gets quoted.
- **Leads are ranked and capped**, and the existing 26% consumption rate is not made worse.
- **Nothing wrote to `ownership_history`** unless 4b was explicitly taken.
- Guards mutation-verified RED, comments stripped before matching.

## 6. Deliverable

`docs/audits/B6b_lead_OWNERSHIP_LEAD_RESTART_2026-08-29.md`, plus the **BUILD-TURN-PROTOCOL closing
checklist**: `PLANNED-BACKLOG.md` (B6b-lead), `data-coherence-invariants.md` **I4**,
`connectivity-and-open-threads.md` §4j, gov's `CLAUDE.md` if a durable footgun appears, and STATUS.

⚠️ **If the grade shows `is_same_owner` cannot separate a re-spelling from a sale, STOP and report
that.** Restarting a producer whose only gate is broken would manufacture thousands of false
ownership leads into a lane a human actually works — **strictly worse than leaving it dead.**
