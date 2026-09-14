> **📍 CANONICAL PAGE: [`docs/architecture/connectivity-and-open-threads.md`](../architecture/connectivity-and-open-threads.md) §4m.**
> **Diagnosis only — nothing was written.** Predecessor:
> [`C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md`](C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md).

# C2g — why 489 anchored owner-orgs are unresolved. Both leading hypotheses were wrong.

**Measured live 2026-08-28 on LCC Opps, gov and dia.**

> ## The one-line finding
>
> **It is not a scoring problem and it is not the operator trap.** **444 of 489 (91%) have never
> been proposed as an owner candidate at all** — no row in `lcc_property_owner_evidence` names
> them — so the 0.55 confidence gate never got the chance to reject them. And
> **`true_owner_is_operator` is 0 across all 489**, so P113 is not involved either. The residue is
> three different populations, and only one is a genuine feeder defect: **79 gov owner-orgs whose
> properties DO carry an asset entity and still produced no evidence.**

---

## 1. Both prior hypotheses, tested and refuted

| hypothesis | prediction | measured | verdict |
|---|---|---|---|
| `lcc_reconcile_property_owner`'s **0.55 confidence gate** (CLAUDE.md documents 876 assets with evidence still "Unresolved") | most of the 489 score 0.33–0.50 and are rejected | **444 of 489 were NEVER a candidate** — 45 ever appear in `lcc_property_owner_evidence` | ❌ **refuted** — the gate never saw them |
| **P113 operator-in-the-owner-slot** | dia-heavy residue is operators | **`true_owner_is_operator` = 0** for all 489 | ❌ **refuted** |

**Both were reasonable and both were wrong.** They were the two documented causes closest to hand,
which is exactly why they needed testing rather than adopting — this arc already carries three
instrument errors from assuming.

## 2. The residue is three populations, not one

| | orgs | what it is | lever |
|---|---:|---|---|
| **dia — no property in the mirror** | **248 of 271** | anchored as a `true_owner` but `lcc_property_owner_facts` holds no property for them | not a resolution gap — they own nothing we track |
| **gov — property, but NO asset entity** | **74 of 222** | the documented gate: *a property with no asset identity cannot carry owner evidence* | **minting** — and these are **exactly the 74 that overlap the T2b plan** |
| **gov — property WITH an asset entity, still no evidence** | **79 of 222** | ⚠️ **the genuine feeder defect** — everything the feeder needs is present and it produced nothing | **diagnose `lcc_ingest_domain_owner_evidence`** |
| gov — no property in the mirror | 69 of 222 | same as the dia case | — |

**The 74 reconciles exactly with C2b's independent count** of owner-orgs appearing in
`v_lcc_c2e_asset_mint_plan`. Two different queries, same number — a useful cross-check that the
key space is sound.

⚠️ **Instrument control (Class 11).** The `true_owner_effective_id::text = external_id` join was
verified before any conclusion: **19,851 of 20,123** facts carrying an effective id match a gov or
dia `true_owner` anchor (9,602 + 10,249). The key space works; the zeros above are facts, not
artifacts.

## 3. ⚠️ What this says about T2b — a third independent reading, same answer

T2b would mint the **74**. It would not touch the 79 (already minted), the 248 (own nothing here) or
the 69. **Three separate measurements now converge**: contactability collapses to 3.7% (T2a);
only 74 of 489 unresolved owner-orgs are reachable by it (C2b); and those same 74 are the only
slice of this residue it addresses (C2g). **T2b remains safe and remains low-value.**

## 4. The actionable finding — 79 gov owner-orgs the feeder should have resolved

These have a property, that property has an asset entity, the owner is anchored — and
`lcc_property_owner_evidence` still names them **zero times**. Only **17 of 222** gov orgs here have
ever been a candidate, so roughly **62 of the 79** are silent.

**Not diagnosed here, deliberately.** Candidate causes to test, in order:

1. **`lcc_ingest_domain_owner_evidence` is fill-blanks and batch-capped** — cron 225 runs 400/run
   daily. Are these simply behind the cap, or genuinely skipped? *(The T1 and T2a runs both had to
   drive it explicitly for exactly this reason.)*
2. **The ambiguity lane** — `lcc_domain_owner_ambiguous` exists for candidates the feeder refuses to
   guess on. Check whether these 79 are parked there, which would make them *correct* abstentions
   rather than a defect.
3. **A guard** — brokerage/junk/placeholder name guards sit on the owner-writing path and each has
   fired on real firms before (P116's 42 brokerage-as-owner rows; A2's placeholder prefixes).

⚠️ **Read the guard verdicts before calling any of this a bug.** In this arc every "silent
producer" that looked like a defect turned out, at least in part, to be a guard doing its job.

## 5. What was NOT measured

- **Why the 79 are silent** (§4) — the next question.
- **Whether the 248 dia / 69 gov orgs matter at all.** An owner anchored from a domain but holding
  no property in the mirror may be a stale anchor, a merged-away duplicate's residue, or an owner
  whose properties are archived. **Unsized.**
- **Value.** No rent figure is attached to any of these 489 — they were selected by *Salesforce
  attachment*, not by portfolio value, so this population is not ranked and should not be quoted as
  a dollar opportunity.
