# P186 — Tier 0 promoter, steps 1 and 2: the view is fixed, and the bench needs your call

> **Status:** step 1 (performance) DONE and verified. Step 2 (bench review) is **this document —
> it needs Scott.** Step 3 (the promoter) is deliberately NOT built. Nothing was written to
> `owner_contact_pivot`, `entity_relationships` or any other table. The only change is the body
> of one view.
>
> Migration: `supabase/migrations/20260826234000_lcc_p186_tier0_candidates_hoist_cross_product.sql`
> (applied live to LCC Opps `xengecqvemvfknjvbvrq`).

---

## 1. Step 1 — the timeout is fixed. 58.7 s → 0.25–0.47 s (124×)

| | before | after |
|---|---|---|
| execution, real consumer shape (all output columns) | **58,694 ms** | **473 ms** (re-run: 252 ms) |
| shared buffers | 106,375 | 59,745 |
| correlated subplans | 4 | **0** |
| rows | 2,358 | 2,358 |

**Equivalence: 0 rows both directions** (`EXCEPT ALL` against `_p186_tier0_baseline`, a snapshot of
the pre-change view taken in the same session, so duplicate multiplicity is covered too). The
named rows P186 states are all preserved: Easterly → Andrew Pulliam present; Elman → Mitchell
Freeman; Trammell Crow → Aaron Thielhorn; Boyd Watterson → still zero rows, i.e. the `asset`
stoplist entry is holding and `dforsyth@assetmre.com` does not come back.

### ⚠️ The documented cause was wrong on both halves — re-measure before quoting

Prompt 186 recorded the cost as *"a `lcc_owner_known_annual_rent()` call per owner plus two
`EXISTS` per pair."* Measured against the plan:

| suspected cause | actual share of 58,694 ms |
|---|---|
| `lcc_owner_known_annual_rent()` | **191 ms — 0.3%** |
| `owner_already_has_contact` EXISTS (hashed by the planner) | **5.9 ms — 0.01%** |
| `already_linked` EXISTS (index-served) | **47 ms — 0.08%** |
| **the JOIN filter** | **~58.4 s — 99.5%** |

The real cause: `people JOIN owner_tok ON EXISTS(unnest(toks) WHERE sld LIKE tok||'%')` has **no
join key**, so the planner emits a Nested Loop with a Join Filter — `loops = 5,624,400`
(688 owners × 8,175 people), `Rows Removed by Join Filter: 5,622,042`. Worse, the token array was
rebuilt *inside* that filter (`InitPlan`, also 5,624,400 loops) instead of once per owner (795).

**Fixing the three named suspects would have bought 0.4% and left the view timing out.** This is
the playbook's Class 11 shape applied to a performance note: a plausible cause, recorded
confidently, that measurement refutes.

### The fix: a prefix match IS an equality join

Tokens are pure `[a-z]+` (`regexp_replace` strips `[^a-zA-Z ]` *before* `lower()`, so there are no
LIKE metacharacters) and every token is ≥ 5 chars. Therefore

```
EXISTS (tok ∈ toks : sld LIKE tok || '%')
  ⇔  EXISTS (k ∈ [5, length(sld)] : left(sld, k) ∈ toks)
```

Expanding each person's second-level domain into its prefixes turns the cross product into a
hash/merge join on text equality — 53,540 prefix rows against 1,042 owner tokens. **Logically
identical, not an approximation**, which is what the 0-row diff confirms. The rent function and
both EXISTS were hoisted too (small, but they were the only remaining correlated nodes).

---

## 2. Step 2 — the bench. **Read this before the promoter is built.**

The view is now fast and does exactly what it was specified to do. **That is the problem.** It is
a *recall net*, not an identity rule, and at full scale most of what it proposes is wrong.

### Coverage first: Tier 0 cannot reach half the money

| | owners | |
|---|---|---|
| owners in scope (≥ $500k rent) | 795 | |
| …with at least one candidate | 360 | |
| …with an **empty bench** | **435** | |
| owners ≥ $5M | 73 | |
| …of those, **empty bench** | **41** | **$902M of annual rent** |

**Boyd Watterson Asset Management — the single largest owner at $179.8M — has an empty bench**,
correctly: after the stoplist its only usable token is `watterson`, and no person's email domain
starts with it. That is honest abstention, not a bug, but it means the largest prospect in the
system gets nothing from this tier.

### Precision: 14 generic tokens produce more of the bench than all 143 identifying ones

| token fan-out (distinct email domains matched) | tokens | candidate people |
|---|---|---|
| 1 domain — identifying | 143 | 271 |
| 2 domains | 55 | 185 |
| 3–4 domains | 27 | 125 |
| **5+ domains — generic word** | **14** | **278** |

The 14: `north, urban, america, bridge, century, south, brook, columbia, johnson, metro, health,
stone, thomas, river`. **6% of tokens produce 39% of the bench.**

There is a second axis, and it is worse: **one token can serve many different owners.** `center`
is a token for **22** distinct owner entities, `office` for 12, `phoenix` for 8, `gateway` for 8.
A token shared across 22 owners identifies none of them.

### What that looks like on named rows — this is the part that decides it

| owner | rent | what the bench proposes | verdict |
|---|---|---|---|
| Easterly Gov Properties | $85.0M | 7 people at `easterlyreit.com` / `easterlypartners.com` incl. **Andrew Pulliam** | ✅ correct |
| Elman Investors | $29.0M | Mitchell Freeman `@elmaninvestorsinc.com` | ✅ correct |
| Prologis | $10.3M | 2 people `@prologis.com` | ✅ correct |
| **CIM Urban REIT Properties VI** | $9.7M | **17 people** at urbanrengroup, urbanflats, urbanstoryventures, urbana.partners… | ❌ none is CIM |
| **Crystal Gateway 3 Owner** | $12.2M | `gateway.net` (a 1990s consumer ISP), `gatewaywy.com`, Gateway University Research Park | ❌ all wrong |
| **Allan Bailey Johnson Group** | $12.2M | 8 unrelated Johnsons, incl. **`johnsonlexus.com`** (a car dealership) | ❌ all wrong |
| **US Postal Service** | $15.5M | Postal Realty Trust (a *different* REIT that buys USPS property) | ❌ wrong party |
| **George Washington University** | $23.8M | Gary George at **`georgesinc.com` — a poultry company** | ❌ wrong |
| **Office Properties Income Trust** | $9.0M | officecourt.com, offices230.com — one roled **"Qualifying Broker"** | ❌ wrong, and a broker |

Also visible in the raw bench, worth their own fixes: person entities named **"Authorized Signer"**,
**"Public"**, and **"This information was confirmed by an SEC filing."**; and **Andrew Pulliam
appears 4×** (2 duplicate Easterly owner entities × 2 duplicate Pulliam person entities) — both
duplicates the handoff already flagged, now confirmed.

### A lexical gate helps a lot and is still not enough

Gate tested: matching token has **≤ 2 distinct email domains AND ≤ 2 distinct owners**.
2,358 pairs → **510 kept, 1,848 dropped.**

It drops the worst cleanly — CIM Urban 17→0, Allan Bailey Johnson 9→0, NGP Phoenix 4→0, Office
Properties 5→0 — and keeps every known-good one — Easterly 8→8, Elman, Prologis, Agree, Cunningham.

**But it still passes George's Inc for GWU, Postal Realty for USPS, and 3 of Eagle River's 8.**
So no purely lexical rule makes this safe to write from. It needs a corroborating signal.

### Corroboration splits the 510 into something decidable

| tier | pairs | owners | rent | what it is |
|---|---|---|---|---|
| **A1** | **26** | **20** | **$173M** | real correspondence **and** the contact's own `company_name` matches the token |
| A2 | 8 | 6 | $6M | correspondence only |
| B1 | 165 | 106 | $290M | company name corroborates, no correspondence |
| B2 | 311 | 148 | $458M | lexical match only |

**I read all 26 A1 rows individually. 25 are unambiguously right** — Easterly→Pulliam,
Saban Capital→Daniel Goldstone (*Director, Real Estate*), Ironside Realty→Laith Hermiz (CEO) **and
Corey Ostrowski (*Director, Acquisitions*)**, Russell Construction→Kelly Young (*Director of
Government Development*), Kingsbarn→Jeff Pori, Avery Capital→3 at `averycapitalre.com`,
Woodbranch→Mike Meagher, Genesis Financial→Gregg Barton.

The one I would not ship blind: **Helena Federal Office Building LLC → Jay Belk at
`federalnatl.com` (Federal National Finance Corporation-Denver)** — matched on the generic token
`federal`, which merely happens to have low fan-out here. Plausible, unverified.

Note A1 already surfaces two **acquisitions** titles, which is the doctrine's actual pursuit
target — so the tier that is safe is also the tier that is useful.

---

## 3. What I recommend, and what I need from you

**Do not point the promoter at the view as it stands.** 2,358 rows reads like a rich bench; 1,848
of them are noise and several would put the wrong firm's employee in `owner_contact_pivot`.

Proposed three-way disposition — **your call on each:**

1. **A1 (26 pairs / 20 owners / $173M) → promoter, dry-run first.** Batch-tagged, reversible,
   named-row expectations stated before the run. Hold the Helena/`federalnatl.com` row out.
2. **A2 + B1 + B2 (476 pairs) → a human verdict lane**, never an auto-write. This is the
   Decision Center shape, not a research card.
3. **The 1,848 ungated pairs → suppressed entirely**, not shown. Surfacing georgesinc.com under
   George Washington University trains you to distrust the lane.

**Three questions I can't answer for you:**

- **Is A1's bar the right bar**, or do you want correspondence to be *required* (dropping B1's 165
  pairs / $290M from any automated path permanently)?
- **The 41 empty-bench owners at ≥$5M ($902M)** — including Boyd Watterson — are Tier 0's real
  gap. They need the Salesforce-by-email-domain path from
  `account-based-contact-intelligence.md` §3b, not a looser lexical rule. Worth doing next?
- **Municipalities and public bodies are in scope of the view** (County of Riverside, State Center
  Community College District, Arizona State Retirement System). Doctrine says they are never
  prospects — should the view exclude them outright, or keep them and gate at the promoter?

---

---

# Round 2 — Scott's decisions applied, and what measuring them found

Scott, 2026-08-26:
> *"Correspondence is not required for A1's bar. Just additional evidence of the right source or
> connection or prospect historically."*
> *"We do not want municipalities or public bodies in our scope. Good to know that they are
> owners and we want to reconcile ownership to those accounts just like others in the LCC as we
> are researching properties but for now, we do not need to even attempt to prospect those owner
> types."*
> *"Let's proceed with your recommendation on next steps by biggest unlock or impact."*

## 4. Public bodies are out of prospecting — ownership data untouched

`lcc_owner_name_is_public_body()` **already existed** and was measured before being touched: over
the 795 owners in scope it produced **zero false positives**, correctly leaving every private firm
with a governmental-sounding name alone (Government Properties Income Trust $39.7M, Easterly
$29.8M, HC Government Realty Trust, US Fed Properties Trust, Government Investment Partners).

It missed five genuine public bodies worth $18.5M. Widened conservatively (migration
`20260827001000`): **27/27 named-row expectations pass**, 42 fleet-wide flips all read individually
and confirmed. Tier 0 now excludes **14 owners / 44 pairs** — USPS, Arizona State Retirement
System, Florida DOT, Regents of the University of Colorado, State Center Community College
District, and nine cities/counties.

**⚠️ The obvious widening was the destructive one, again.** A `\muniversity\M` rule would have
caught **George Washington ($23.8M) and Georgetown ($8.0M)** — both PRIVATE non-profits and real
prospects — to gain University of Memphis and UNC Health Care ($2.1M). Not done. **Public
universities remain in scope and need your call**, because no name-based rule separates them from
private ones.

Also caught while reading the flips: **"Cottonwood Partners OBO Utah State Retirement System"** —
a private manager acting *on behalf of* a public pension, and a legitimate prospect. An `OBO` /
`on behalf of` negative guard is in the function.

**Two existing consumers change with it, deliberately:** `v_lcc_top_seller_prospects` and
`v_lcc_owner_contact_decidability`. Both want exactly this semantic, so widening the shared
function was the single-source move.

## 5. The loosened bar — and the structural limit it runs into

Evidence sources enumerated and measured over the 493 gated pairs:

| evidence | pairs | owners |
|---|---|---|
| in a **Salesforce campaign** (prospect historically) | **285** | 154 |
| has a Salesforce contact record | 257 | 141 |
| contact's `company_name` corroborates the token | 187 | 111 |
| in Scott's Outlook address book | 57 | 39 |
| real correspondence | 34 | 26 |
| **any of the above** | **308** | **156** |
| no evidence at all | 8 | 8 |

*(`already has relationship edges` covers 468/493 = 95% and is therefore not discriminating — it
means "modelled in the graph", not "connected to this owner". Excluded from the bar.)*

### ⚠️ The bar answers the wrong question, and a named row proves it

**Gary George at `georgesinc.com` — George's Inc, a poultry company — passes the company-name
test, Salesforce campaign membership AND the Salesforce contact test.** He is a real person we
have genuinely prospected. He just does not work at George Washington University.

That is the structural limit, and it is worth stating plainly:

- **"Is this person real and known to us?"** — answered well by SF membership, SF contact,
  Outlook, correspondence.
- **"Does this person work for THIS OWNER?"** — answered *only* by the lexical match, which is
  the weak part.

Evidence attests to the **person**, not to the **link**. Loosening the bar therefore increases
recall without increasing link precision.

### A refinement I tried and measurement killed

Requiring the token as a **whole word** in `company_name` looked like it would separate
"Easterly Partners" (good) from "George's Inc" (bad). It does not: the apostrophe splits
`George's Inc` into `[george, s, inc]`, so `george` **is** a whole word. 13 of 15 test cases
passed and **the two that mattered failed**. Not shipped.

### Measured precision at the loosened bar: ~76–80%

I read the top 45 pairs by owner rent individually. Roughly 9–11 are wrong — about **one in
five**. A new and fixable error class dominates them:

**GEOGRAPHIC AND GENERIC TOKENS**, which survive the fan-out gate because few domains start with
them while carrying zero owner identity:

| owner | token | matched | |
|---|---|---|---|
| USGP II **OMAHA** FBI LP | `omaha` | `omahavaccine.com` | ❌ |
| USGBF 8000 E 36th Ave **DENVER** LLC | `denver` | `denverrealestate.com` | ❌ |
| FORT **WORTH** TX I MG, LLC | `worth` | `worthsa.com` | ❌ |
| EAGLE RIVER INVESTORS – **HAWAII** | `hawaii` | `hawaii.rr.com` (a consumer ISP) | ❌ |
| 999 E STREET **TENANT** LLC | `tenant` | `tenantwisdom.com` | ❌ |
| **METRO DEVELOPERS** Inc | `developers` | `developerservices.com` | ❌ |

**Conclusion: ~80% is right for a one-click confirm lane and wrong for an unattended write.**
One in five means calling the wrong company. Recommended: build the **confirm-a-draft lane**
(the pattern this repo already uses for `lcc_clean_assist_proposals`), not a silent promoter.
Add US city/state names and the generic CRE nouns above to the stoplist first — cheap and
clearly right.

## 6. ⭐ The biggest unlock is NOT Salesforce — we already hold the people, and the rule cannot see them

The empty-bench owners were assumed to need the Salesforce-by-email-domain path from
`account-based-contact-intelligence.md` §3b. **Measured: `sf_campaign_members_at_org` is 0 for
all 41 of them.** That path yields nothing at the org level.

What is actually true is better. Probing the owners' real email domains directly:

| owner | rent | people we ALREADY hold | including |
|---|---|---|---|
| **Boyd Watterson Asset Management** | **$179.8M** | 2 | Eric Dowling, Joseph Capra `@boydwatterson.com` |
| **NGP Capital** | **$59.8M** | 3 | David Kent, Fran Cowan, Kim Phillips `@ngpv.com` |
| **Government Properties Income Trust** | **$39.7M** | 7 | `@govtrealestate.com`, `@govinvpartners.com` |
| **TIAA CREF** | $26.4M | 2 | Chris McGibbon, Michael Schwaab |
| **RMR Group** | $16.4M | **20** | **Adam D. Portnoy** (President & CEO) |
| HPI Capital | $9.4M | 2 | |
| AVG Partners | $8.9M | 1 | |
| GI Partners | $8.6M | 2 | Rick Magnuson (founder) |
| **Realty Income Corporation** | $5.8M | **12** | **Sumit Roy** (CEO) |

**≈51 people at 9 owners worth $358M, every one of them already in `entities`, none visible to
Tier 0.** Note NGP's three names are exactly the ones §3b predicted — they were never missing
from the database, only from the matching rule.

### Three structural causes, all in the token rule — verified per owner

| cause | evidence |
|---|---|
| **`length(tok) >= 5` deletes acronym firms** | NGP, RMR, TIAA, USAA, GI, HPI, AVG all yield **zero tokens**. These are precisely the institutional buyers. |
| **prefix-only matching** | Boyd Watterson's only token is `watterson`, which does **not** prefix-match `boydwatterson`. The #1 owner in the system fails on its own domain. |
| **the stoplist can consume the whole name** | "Realty Income Corporation" → realty/income/corporation all stoplisted → **zero tokens**. This is CLAUDE.md's documented `ownerCore` → empty-string failure, reappearing in a new place. |

**⚠️ And `lcc_owner_strict_core` cannot be dropped in as the fix — it SORTS its tokens.**
`lcc_owner_strict_core('Boyd Watterson Asset Management, LLC')` returns
`asset boyd management watterson` → compacted `assetboydmanagementwatterson`, which does not
contain `boydwatterson`. CLAUDE.md already warns about this for acronym matching; it applies to
domain matching identically. The next build needs an **unsorted** compacted core.

**This is the highest-value next unit of work**, and it is deliberately NOT built here — it
changes which owners enter the bench, so it deserves its own named-row gate rather than being
rushed. Specified in `docs/claude-code/prompts/187-*.md`.

---

## 7. Recommendation, revised by the measurement

1. **Do not build an unattended promoter.** At ~80% link precision it would put the wrong firm's
   employee in `owner_contact_pivot` once in five writes.
2. **Build a confirm-a-draft lane** over the ~308 evidence-backed gated pairs. One click, human
   verdict, reversible — the pattern already in use.
3. **Fix the token rule first (P187)** — acronym arm, unsorted core containment, geographic and
   generic-noun stoplist. It is worth more than the promoter: **$358M of top owners currently
   invisible**, including the largest owner in the system.

---

# Round 3 — P187 shipped the matching fix. What §6 predicted, measured.

Migration `20260827010000_lcc_p187_tier0_core_arm_and_stoplist.sql`, applied live.

| | before P187 | after |
|---|---|---|
| candidate pairs | 2,314 | **558** |
| owners with a bench | 346 | **208** |
| top-45-by-rent precision | 76–80% | **~91%** |
| empty bench ≥$5M | 41 owners / $902M | 44 owners / **$738M** |

**Now visible, exactly as §6 predicted:** Boyd Watterson ($179.8M) 2 people · RMR Group 20 incl.
**Adam Portnoy** · Realty Income 12 incl. **Sumit Roy** · TIAA-CREF · GI Partners · AVG · Cole
Capital · 14 smaller owners.

**Shipped:** `lcc_owner_domain_core()` (order-preserving, 11/11 named-row gate — the contrast
column proves `lcc_owner_strict_core` sorts to `assetboydmanagementwatterson`); Arm 2 as an
8-character core/domain prefix *equality* join (so it costs nothing); fan-out gates on both arms;
a widened stoplist covering geography, generic CRE nouns and consumer-ISP suffixes.

### Four things worth keeping from the build

0. **⚠️ AND THE GATE I DID SHIP WAS DEFECTIVE — corrected by P188, record it here.** The token
   fan-out gate was written the obvious way,
   `from owner_tok ot join people p on p.sld like ot.tok||'%'` — **the exact un-keyed cross
   product this whole document exists to describe removing**, re-created inside the gate.
   Measured live: `Rows Removed by Join Filter: 6,222,095`, 1.78 s of a 3.10 s view, invisible
   because the gate returns only 160 rows. P188 rewrote it with §1's own identity: 3,099 ms →
   1,263 ms, join-filter rows → 0, 0-row pair-set diff. **A gate that filters a join is part of
   that join.** See `P188_TIER0_CONFIRM_LANE_2026-08-26.md` §5 and playbook Class 13 lesson 5.

1. **⚠️ Measuring a gate is not shipping a gate.** §5 measured a token fan-out gate and reported
   it cut CIM Urban 17→0 and Johnson 9→0. It was only ever applied in *analysis queries* — never
   written into the view. `johnsonlexus.com` was still matching "Allan Bailey Johnson Group" until
   P187 actually shipped it.
2. **⚠️ The empty-bench count got WORSE and that is the improvement.** 41 → 44 owners, while the
   rent behind it fell $902M → $738M. All 10 newly-"empty" owners had benches that were **100%
   false positives** (avenueview, plazacorp, 17 urban\* domains, officecourt, streetviewllc,
   tenantwisdom, developerservices, denverrealestate, phoenix\*). The old figure was inflated by
   noise.
3. **⚠️ Precision is a curve — quote the band.** ~91% at the top 45 by rent; **~60–70%** down in
   the ~$2M single-property SPE band, where names are a place or a surname and little else
   ("NGP VI ESSEX VT LLC" → essexconcrete.org, "Boyd Atlanta Williams" → williamson.com). The
   confirm lane must be worked top-down.
4. **The acronym arm was built, measured and rejected.** "A 3–4 char ALL-CAPS token is an
   acronym" — but **27.6% of owner names (212 of 769) are entirely uppercase**, because that is
   the government SPE naming convention. It produced `BOYD DEL RIO GSA LLC` → **dell.com**,
   `1445 ROSS AVE LLC` → **avera.org**, `EGP DEA VISTA LLC` → de-az.com (DEA is the *tenant*).
   ~30–40% precision. Its real value sits in ~6 sponsor acronyms best handled by a small curated
   map — see prompt 188.

**Residue recorded, not patched:** GWU → `georgesinc.com` (fan-out cannot see it); "Southern SSA"
(fan-out exactly 2); one CMBS securitization trust ($2.38M, 6 pairs) — one row does not justify a
rule that would later be trusted as general.

**Next:** `docs/claude-code/prompts/188-tier0-confirm-lane-2026-08-26.md`.

---

## Housekeeping — done

- `_p186_tier0_baseline` **dropped** (equivalence diff recorded above; leaving a stale snapshot
  invites someone to trust it later — the P176 shelf-life lesson).
- The view had **no committed migration** before this. It now has two.
- Tier 0 currently stands at **2,314 rows / 346 owners** post public-body exclusion.
- **Re-run the gates after any upstream change** — a verified result has a shelf life.
