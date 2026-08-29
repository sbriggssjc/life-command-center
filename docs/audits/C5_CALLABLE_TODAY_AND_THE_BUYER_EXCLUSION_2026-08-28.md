> **📍 CANONICAL PAGE: [`docs/architecture/connectivity-and-open-threads.md`](../architecture/connectivity-and-open-threads.md) §4p.**
> **Diagnosis only — nothing written.** Follows
> [`C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md`](C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md), which found
> the gate. This answers **C4e** (the `buyer` exclusion) and produces the callable list C4a implied.

# C5 — 1,924 owners carry a deal-timing signal and cannot be seen; the `buyer` exclusion is the larger half

**Measured live 2026-08-28 on LCC Opps.**

> ## The two findings
>
> **1. `buyer` is the bigger exclusion, and it is wrong on named rows.** **578 owners typed `buyer`
> hold a gov property with a lease expiring inside 24 months, carrying $410.4M** — more than the
> `unknown` population C4 focused on. And they are not mislabelled: **Boyd Watterson (45 gov assets),
> Prologis, RMR Group, HC Government Realty Trust** genuinely are buyers. **They are also, right now,
> the owner of a building whose lease is running out.** The gate asks the entity for one global
> identity when **ownership is a per-asset fact the join has already established.**
>
> **2. 173 owners have a gov lease expiring within 90 days and are invisible to the queue.** 14 of
> them are contactable today. **Boyd Watterson's is 2026-08-31 — three days from this measurement.**

---

## 1. The invisible population

Owners holding a current gov property with an attributes row and a P1/P2/P3 signal, whose role
excludes them from every band:

| | owners |
|---|---:|
| **carry a deal-timing signal and are invisible** | **1,924** |
| …typed `buyer` | **1,052** |
| …typed `unknown` | 871 |
| **…contactable today** | **224** |
| …contactable and `buyer` | 68 |
| …contactable and `unknown` | 156 |

⚠️ **C4 reported "56 contactable" and that was P1-only and `unknown`-only.** Across all three
deal-timing bands and both excluded roles it is **224**. C4's number was correctly scoped and
easily misread as the total; **224 is the figure to quote.**

## 2. ⚠️ The `buyer` exclusion — C4e, answered

C4e asked whether excluding `buyer` was defensible on the grounds that a buyer is a demand-side
party while these bands are seller-side triggers. **On named rows it is not:**

| owner | role | gov assets | signal | top asset rent | contact |
|---|---|---:|---|---:|---|
| **Boyd Watterson Asset Management** | `buyer` | **45** | lease expiry **2026-08-31** | $18.9M | Eric Dowling |
| Gba Associates LP | `buyer` | 1 | lease expiry 2026-12-04 | $27.2M | Vincent Forte |
| Prologis, L.P. | `buyer` | 3 | lease expiry 2027-07-31 | $8.8M | Jeff Behm |
| RMR Group | `buyer` | 5 | lease expiry 2027-04-11 | $3.3M | Jenkin Cagwin |
| HC Government Realty Trust | `buyer` | 6 | lease expiry 2027-01-11 | $1.5M | David Lucas |

**Every one of these labels is correct** — they are buyers, and this is the account-based
prospecting doctrine's core population. **They are simultaneously the current owner of a building
whose lease is expiring**, which is the definition of a seller prospect on that asset.

**The defect is a category error, not a bad label.** `entities.owner_role` is a *party-level
identity*; the bands ask a *per-asset question*. The CTE has already joined
`lcc_entity_portfolio_facts` on `is_current = true` — **it is already holding the per-asset fact and
then discards it in favour of the entity's global label.** A REIT is permanently a buyer and
permanently ineligible, no matter how many gov buildings it owns or how soon their leases run out.

⚠️ **This does NOT mean prospect them as sellers in a buyer's tone.** The
`account-based-contact-intelligence.md` doctrine is explicit — acquisitions vs disposition are
different contacts and different pitches, and the buy-side relationship is the funnel *into* the
disposition conversation. **The finding is that the band should fire; the bucket it fires into is
C4a's doctrine question.**

## 3. Urgency — the part that is time-sensitive

| gov leases expiring, owner invisible to the queue | |
|---|---:|
| rows within **90 days** | 197 |
| owners within 90 days | **173** |
| …**contactable today** | **14** |
| owners within 180 days, contactable | **28** |

**Boyd Watterson: 2026-08-31, three days out, 45 gov assets, contact confirmed (Eric Dowling), and
not on any surface.** ⚠️ **Not verified here:** whether that specific lease is renewing, already
extended, or terminal — the attributes row states an expiration date, not an outcome. **Read the
asset before acting on the date.**

## 4. The callable list — 224 owners, top 25 by rent

All are invisible to the queue today. `unknown` and `buyer` both shown; contact is the confirmed
`owner_contact_pivot` active contact.

| owner | role | signal | assets | top asset rent | contact |
|---|---|---|---:|---:|---|
| Gba Associates LP | buyer | P1 2026-12-04 | 1 | $27,163,370 | Vincent Forte |
| USAA Real Estate | unknown | P1 2027-09-30 | 2 | $26,661,955 | Joseph Capra |
| Trammell Crow Co | unknown | P3 ten-year | 1 | $24,146,509 | Thomas Finan |
| GIC Real Estate | unknown | P1 2028-04-30 | 1 | $22,298,666 | Adam Gallistel |
| **Boyd Watterson Asset Mgmt** | buyer | **P1 2026-08-31** | **45** | $18,894,842 | Eric Dowling |
| The Durst Organization | unknown | P3 ten-year | 1 | $10,015,885 | Durst Family |
| NGP Capital | unknown | P1 2028-06-30 | 3 | $9,883,377 | Fran Cowan |
| Cambridge Holdings | unknown | P3 ten-year | 1 | $9,318,640 | Constance MacOn |
| Prologis, L.P. | buyer | P1 2027-07-31 | 3 | $8,754,720 | Jeff Behm |
| GI Partners | unknown | P3 ten-year | 1 | $8,620,434 | David Boehle |
| Easterly Gov Properties (REIT) | unknown | P1 2026-10-20 | 19 | $8,106,829 | Alison Bernard |
| GI TC 801 Follin Lane, LLC | buyer | P3 ten-year | 1 | $6,598,526 | Rick Magnuson |
| Cunningham Development Co | unknown | P1 2027-09-24 | 2 | $6,072,956 | Michael Cunningham |
| Parsada Ventures | unknown | P1 2027-03-11 | 1 | $4,216,266 | Robert Parsekian |
| RMR Group | buyer | P1 2027-04-11 | 5 | $3,307,954 | Jenkin Cagwin |
| Elman Investors | unknown | P1 2026-09-30 | 6 | $3,106,230 | Mitchell Freeman |
| Houston TX I FGF, LLC | buyer | P1 2027-05-31 | 1 | $3,074,817 | Kevin Mitchell |
| Gardner Tanenbaum Holdings | unknown | P1 2027-04-11 | 10 | $2,769,209 | Becky Tanenbaum-Mallace |
| TEP Houston DHS, LLC | buyer | P2 firm-term | 1 | $2,694,281 | Richard Hill |
| US Global Business Fund | buyer | P3 ten-year | 1 | $2,570,000 | Jason Koehne |
| HPI Capital | unknown | P3 ten-year | 1 | $2,045,426 | Kent Lance |
| Woodbranch Lafayette VA LLC | unknown | P3 ten-year | 1 | $1,729,952 | Lisa Chargois |
| Adams Realty LLC | buyer | P1 2027-03-31 | 1 | $1,535,845 | Steven Ross |
| HC Government Realty Trust | buyer | P1 2027-01-11 | 6 | $1,530,085 | David Lucas |
| Sell-Well Holdings, LLC | unknown | P1 2028-03-16 | 4 | $1,107,853 | Brand Hartsell |

⚠️ **`rent` is the TOP ASSET per owner, not portfolio rent** — Boyd holds 45 gov assets, so its
$18.9M is one building. Do not sum this column.

**These are the same names the Tier 0 arc spent twelve rounds resolving** — Boyd Watterson, Easterly,
NGP, RMR, Gardner Tanenbaum, GI Partners. **The contacts were confirmed. The signal existed. The two
were never connected**, because the role gate sat between them.

## 5. What this changes about the recommendation

C4 recommended sequencing the widening behind reachability. That still holds, and C5 sharpens it:

1. **The per-asset fix is narrower and better founded than widening to `unknown`.** The bands ask a
   question the CTE has already answered per asset (`is_current = true`). Treating current holding
   as sufficient for a seller-side signal needs no new classifier and no doctrine call — it is the
   join that is already there. **`buyer` alone is 578 owners / $410.4M.**
2. **224 owners are callable the day it ships**, 28 of them inside 180 days.
3. **C4a is still Scott's** — what promotes an owner out of `unknown` *and which bucket the call
   goes into* is doctrine, and §2's caveat matters: firing the band is not the same as choosing the
   pitch.

## 5b. ⚠️ C5b answered — and it corrects §5's "narrower" framing

§5 called the per-asset fix "narrower and better founded than widening to `unknown`." **Better
founded: yes. Narrower on its own: no.** P5 and P8 were untested when §5 was written; measured, the
naive per-asset rule is a **20× flood**, not a narrow fix.

| band | today | per-asset, all roles |
|---|---:|---:|
| P1 `lease_expiry_24mo` | 74 | 1,215 |
| P5 `aged_building_value_add` | 58 | **1,681** |
| P8 `agency_active_solicitations` | 76 | **1,497** |
| **all five bands** | **226 rows** | **4,506 rows / 3,622 owners** |

⚠️ **`aged_props` is NOT gov-scoped** — it joins `lcc_entity_portfolio_facts` with no
`source_domain` filter, so **P5 covers dia too** (26 → 565 dia rows). Any change to the role gate
that touches P5 is a cross-domain change. Nothing else in this arc has been.

**P5 is 83% of the flood and is the weakest signal in the set** — "built 25+ years ago, not
renovated in 15" describes a large share of the portfolio and implies no timing. It should keep the
role gate.

### The design that actually works: per-asset **plus** the reachability precondition

| band | today | per-asset + reachable |
|---|---:|---:|
| P1 `lease_expiry_24mo` | 74 | **149** |
| P2 `firm_term_ending_24mo` | 32 | **95** |
| P3 `ten_year_window` | 62 | **163** |
| P8 `agency_active_solicitations` | 76 | **213** |
| **total** | **244 rows** | **497 rows / 303 owners** |

**~2×, not 14× — and every emitted row is callable.** Reachability is not a nice-to-have here; it
is what converts a flood into a call list. Without it the same change emits 3,235 rows over 2,719
owners of whom **only 11% can be contacted** — the P112 failure at scale.

**P5 unchanged, dia untouched.** This is the recommended build.

## 6. What was NOT measured

- **Whether any named lease is actually terminal.** The attributes row carries a date, not an
  outcome — renewal, extension and holdover all look identical here. ⚠️ **Read the asset before
  acting on any date in §3 or §4.**
- **Whether the 224 contacts are the right person at each firm.** `owner_contact_pivot` says a
  contact is active, not that they are the disposition decision-maker
  (`account-based-contact-intelligence.md` §"the pursuit target is the acquisitions contact").
- **dia.** gov only — `gov_owner_props` is gov-scoped.
- **Portfolio rent.** Only top-asset rent per owner was pulled; the $410.4M `buyer` figure is a sum
  over qualifying gov assets, a different basis. **Do not mix the two.**
- **P-BUYER.** P5 and P8 are now measured (§5b); P-BUYER is not.
- **dia's deal-timing equivalent.** P5 is cross-domain but was excluded from the recommendation;
  no dia band was sized.
