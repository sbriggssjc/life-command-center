> **📍 CANONICAL PAGE: [`docs/architecture/connectivity-and-open-threads.md`](../architecture/connectivity-and-open-threads.md) §4l.**
> Measurement only — **nothing was written.** Predecessors: C2 §2 (the original finding) ·
> C2e / C2e-T2a (the mints that caused the change).

# C2b — the Salesforce bridge self-healed, and the residue is not an owner problem

**Measured live 2026-08-28 on LCC Opps (`xengecqvemvfknjvbvrq`), after the T1 + T2a mints.**

> ## The one-line finding
>
> **No bridge code was written and the bridge doubled.** SF-linked people reaching a resolved
> property owner went **669 → 1,486 (6.8% → 15.2%, +122%)** purely because the far bank was built.
> **And the remaining gap is not a bridge problem at all**: of the 7,646 still unconnected, only
> **8.5% work at a company that is a property owner in our domains.** The other 91.5% are at
> brokerages, vendors, tenants, lenders and service firms — the general Salesforce book, which was
> never going to connect to a property owner because those companies do not own our properties.

---

## 1. The bridge, before and after — same query, two dates

| | C2 (2026-08-28, pre-mint) | **now (post T1 + T2a)** |
|---|---:|---:|
| SF-linked people in LCC | 9,793 | 9,796 |
| …with an email | 9,491 | 9,494 |
| …carrying a relationship edge | 9,129 (93%) | 9,132 (93%) |
| **…reaching a RESOLVED property owner** | **669 (6.8%)** | **1,486 (15.2%)** |
| …serving as an active contact | 1,036 | 1,036 |

**C2's stated cause was right and its remedy was right.** C2 said the bridge had *"no far bank —
only 4,065 property→owner rows exist for 32,289 properties."* Resolved owner rows are now **8,636**
over **5,992 distinct owners**, and the connection count moved **+817 with no code**. This is the
cleanest confirmation in the arc that hop 3 was the binding constraint.

## 2. ⚠️ The residue is 91.5% NOT-AN-OWNER — minting cannot reach it

Of the **7,646** SF people who carry an edge but reach no resolved owner:

| | |
|---|---:|
| distinct organizations they are edged to | **6,816** |
| …that carry a `dia\|gov` **`true_owner`** identity | **489 (7.2%)** |
| people at those owner-orgs | **652 (8.5%)** |
| **people at orgs that are NOT domain owners** | **6,994 (91.5%)** |

**That 91.5% is the correct answer, not a defect.** The Salesforce book is a brokerage's book —
brokers, vendors, tenants, lenders, counsel, service providers. Those people are edged to their
employer via the `works_at` Salesforce-account edge (the bare-SF signal **P112** disqualified as a
BD signal and **P161** gated out of reachability), and their employer does not own our properties.
**No amount of asset minting or org↔owner reconciliation will connect them, and none should.**

⚠️ **This retires the framing that opened the topic.** Scott's *"8–10k Salesforce opportunities…
that are not yet connected"* is, measured, **~652 people at 489 owner-orgs** — not 8–10k. The rest
are correctly unconnected.

## 3. ⚠️ And it settles T2b: minting the bottom tranche would connect **74 orgs**

| | |
|---|---:|
| unresolved owner-orgs behind the residue | **489** |
| …that appear in `v_lcc_c2e_asset_mint_plan` (the T2b population) | **74** |
| T2b plan owners in total | 2,054 |

**Only 74 of the 489 are reachable by minting T2b at all** — 3.6% of that tranche's owners. The
other **415 owner-orgs are anchored and still unresolved for some reason OTHER than a missing asset
entity**, which is a different gap and the one actually worth sizing.

**Combined with C2e-T2a's own finding** (contactability collapses to 3.7% in the T2b band), the case
for T2b is now weak on both axes measured independently: it adds few contactable owners *and* it
closes little of the Salesforce residue. **Recommendation: do not run T2b now.** It remains safe —
the graph cost is settled — so it can be revisited if the ranked queue ever runs dry.

## 4. The actionable slice — 489 orgs / 652 people

These are companies that **are** property owners in gov or dia, that **have** Salesforce people
attached, and whose properties are **not** resolved to them in `lcc_property_owner`. That is the
real remaining bridge population, and it is small and specific enough to work.

**⚠️ Not diagnosed here — why those 489 are unresolved.** Candidate causes, in the order worth
testing: their properties carry an asset entity but `lcc_reconcile_property_owner` scored below the
0.55 gate (the documented 876-asset supersession class); the owner is a **dia operator** in the
owner slot (P113); or the org is anchored from one domain while its properties sit in the other.
**Do not assume — the C2 arc has three instrument errors on record from assuming.**

## 5. What was NOT measured

- **Why the 489 are unresolved** (§4) — the next question, deliberately unanswered.
- **Whether any of the 6,994 non-owner people are worth keeping** for a different purpose. They are
  correctly out of *owner* scope; `account-based-contact-intelligence.md` treats broker↔buyer
  history as real market intelligence, so "not an owner contact" is not "delete".
- **dia specifically.** The split was measured fleet-wide, not per domain.
- **Whether a connected SF person converts to a call.** Reachability is a proxy, not evidence — the
  same caveat C2a and C2e both carry.
