# Salesforce note records as an ownership bridge — findings, 2026-08-17

**Status:** staged, measured, matcher shipped. **Scott's validation (§11) reframed what this dataset IS — read §11 before using it.** Out-of-scope sectors
parked for the swim-lane expansion (§5).

**Table:** `lcc_sf_note_property_assertion` (P129) · **Loader:**
`scripts/load-sf-note-assertions.mjs` · **Batch tag:** `notes_2024`

---

## 1. What this is and why it exists

LCC could rank the top seller prospects in gov + dia (P127) but **3,883 of them
had no reachable contact**, holding **$2.72B** of annual rent. The
`owner_contact_pivot` looked like a bridge — 3,492 of those owners have a row —
but it is a **research queue, not a contact store**: 102 named contacts, 17
resolving to an entity, **zero emails or phones**, with `enrichment_action`
values like `find_person_at_manager` and `address_reverse_lookup`. There was no
shortcut there.

> **📌 COUNT UPDATED 2026-08-20 — now 4,120 prospects / $3,771.9M, and NOT directly comparable to the
> 3,883 / $2.72B above.** The figure moved because the *composition* of `v_lcc_top_seller_prospects`
> changed, not because the backlog simply grew: **P150a/P154** removed merged-away tombstones (an entity
> that had already been merged into a survivor was still being ranked as its own prospect), **P151**
> removed public bodies, and **P152** removed agents. Treat the two numbers as different populations —
> do not subtract them to infer progress or regression.

Scott's legacy Salesforce practice is the real bridge: one note per property,
titled `Tenant - City, State`, body carrying address / tenant / prior sales /
lease term / cap rates, tagged to the parties connected to that property.

## 2. What was loaded

| | rows | distinct parties | distinct titles | parsed |
|---|---|---|---|---|
| Contact notes | 19,563 | **12,200** contacts | — | 88.6% |
| Company notes | 14,434 | **9,164** accounts | — | 84.4% |
| **Total** | **33,997** | **21,364** | **11,199** | **29,518 (86.8%)** |

Authored by the team over years: Scott 6,143 · David Read 5,432 ·
Nate Berwaldt 4,614 · Kelly Largent 2,024 · Jake Schooley 1,352.

A 600-id random sample says **~69% of the contacts are unknown to LCC** —
roughly **8,400 parties**, more than the 9,877 Salesforce contacts LCC holds
today, and unlike those, each is tied to a named property by someone who knew
the deal.

## 3. What the table deliberately does NOT assert

**Role.** The export carries the note *title* only, never the body. A row
therefore says "this party is connected to this property" and nothing about
whether they own it. Scott: tagged to *"any current or prior owner, developer and
sometimes brokers in the sale of the property but most often is just the notes on
the contact's specific ownership."* One title ends `- Seller`, proving role
sometimes hides in the text.

Promoting these straight into `lcc_property_owner_evidence` would assert
ownership for brokered and former-owner rows — the **P116 brokerage-as-owner**
trap and the **P113 prior-vs-current** problem, at 19,563-row scale. So the table
is lossless and uninterpreted; resolution happens in separate reviewable passes.

## 4. Matching results — 23.7%, and why

| | |
|---|---|
| distinct city/state in notes that exist in LCC | **2,624 of 3,332 (78.8%)** |
| titles matched on tenant + city + state | **2,251 of 9,511 (23.7%)** |
| candidate pairs | 6,121 (**2.7 properties per matched title** — still ambiguous) |

**Geography overlaps strongly; tenant vocabulary does not.** Three distinct
causes, and only the first is a matching problem:

**(a) Team shorthand vs source vocabulary** — the aliasable set, ranked by note
rows unlocked:

| token | rows | means |
|---|---|---|
| `DVA` | 1,018 | DaVita |
| `FMC` | 797 | Fresenius Medical Care |
| `SSA` | 634 | Social Security Administration |
| `USDA` | 522 | |
| `USPS` | 243 | |
| `FPUC` | 188 | |
| `BLM` | 147 | |
| `ICE` | 80 | |

**(b) Not tenant names at all — property-type codes.** `MULTI` is the single
largest token (**1,262 rows, 96 variants**) with the real agency in parentheses:
`Multi (CBP)`, `Multi (ATF)`, `Multi (AOC)`. `ASC` has **313 variants**. `MOB`
another 109. These need the parenthetical *promoted* to tenant, not aliased.

**(c) Modifiers on every tenant** — `- MT` (multi-tenant), `(Leasehold)`,
`(Condo)`, `(ST)`, `- SOLD`. Normalisation must strip these before any match.

## 5. Sector split — ~30% is out of scope by design, not by failure

Of the unmatched note rows:

| sector | rows | share | status |
|---|---|---|---|
| OTHER | 5,807 | 27.8% | mixed |
| **GOVERNMENT (in scope)** | **5,493** | **26.3%** | fixable by §4 |
| **DIALYSIS (in scope)** | **2,635** | **12.6%** | fixable by §4 |
| ASC / surgery | 2,364 | 11.3% | **parked → swim lane** |
| dental | 1,761 | 8.4% | **parked** |
| urgent care | 1,074 | 5.1% | **parked → swim lane** |
| multi-tenant / type code | 735 | 3.5% | see §4(b) |
| veterinary | 575 | 2.8% | **parked** |
| plasma | 459 | 2.2% | **parked → swim lane** |

**~6,200 rows describe sectors LCC does not track.** Those are not matcher
failures — the properties are not in dia+gov inventory. Chasing them with better
string matching would be chasing inventory LCC was never given.

**8,128 rows (39%) are in-scope gov + dialysis** that still missed. That is the
addressable set.

## 6. Alignment with the planned swim-lane expansion

The parked sectors map onto lanes already under evaluation in
[`HEALTHCARE-SWIM-LANE-EVALUATION-MATRIX-v0.1.md`](HEALTHCARE-SWIM-LANE-EVALUATION-MATRIX-v0.1.md)
and [`OUTPATIENT-HEALTHCARE-LANE-PACK-SPEC-v0.1.md`](OUTPATIENT-HEALTHCARE-LANE-PACK-SPEC-v0.1.md):

| note sector | rows | planned lane |
|---|---|---|
| ASC / surgery | 2,364 | **Ambulatory surgery** — the active ASC-first staging checkpoint |
| urgent care | 1,074 | **Urgent care** |
| plasma | 459 | **Plasma adjacency test** |
| dental | 1,761 | *not currently in the matrix* |
| veterinary | 575 | *not currently in the matrix* |

**Why this matters to that work:** the matrix records that "Phase A1–A4 is
complete against **synthetic** data." These note records are *real commercial
evidence from Team Briggs' own book* — named properties, named parties, dated,
authored by the brokers. For the urgent-care lane in particular, the matrix flags
the risk as "small leased suites and weak site-level economics"; 1,074 note rows
across real pursued contacts is direct evidence on whether that risk holds.

Dental (1,761) and veterinary (575) are **larger in the notes than plasma (459)**,
which *is* in the pilot plan. That is worth weighing when the lane cohort is next
revisited — not as a recommendation, but because the evidence exists and did not
before.

**Nothing here authorises a lane.** The matrix's hard gates and staging contracts
are unchanged; this is one additional evidence input for when they are evaluated.

## 7. How to pick this back up

```sql
-- everything staged
select * from lcc_sf_note_property_assertion where batch_tag='notes_2024' limit 20;

-- the addressable in-scope miss (§5)
-- and the alias candidates ranked by rows unlocked (§4a)
```

Open threads, in the order they matter:

1. ~~Normaliser + alias map~~ — **done, see §8.** In-scope match 38.2% → **61.0%**.
2. **Role determination** — never promote to ownership evidence without it (§3).
3. **Disambiguation** — 2.7 candidate properties per matched title.
4. **Note body export** — would allow address matching instead of tenant.
   Deliberately *not* requested yet: the in-scope miss is mostly vocabulary, and
   address matching would also drag in the out-of-scope 30%.
5. **~8,400 unknown parties** — valuable as BD contacts regardless of whether
   their property ever resolves.

---

## 8. The tenant-class matcher (P130) — and the wrong turn that produced it

**Result: in-scope match 38.2% → 61.0%, +1,045 tuples, 0 lost.**

**My first attempt was a net loss dressed as a gain.** I built a normaliser that
stripped modifiers and mapped team shorthand to full names — `DVA → DAVITA`,
`VA → VETERANS AFFAIRS`. It scored 37.9% → 40.9%, which looks like progress. It
was not: **+654 newly matched, −514 broken.** Net +3 points.

The cause was an assumption I never checked: I aliased toward the *full* name
without looking at what LCC actually stores. It stores **both, inconsistently**:

| class | LCC spellings, all live |
|---|---|
| DaVita | `DAVITA KIDNEY CARE` (1,777) · `DAVITA` (262) |
| GSA | `GENERAL SERVICES ADMINISTRATION` (1,299) · `GSA` (171) · `GENERAL SERVICES ADMINISTRATION GSA` (160) |
| SSA | `SSA` (725) · `GSA SOCIAL SECURITY ADMIN` (150) |
| VA | `VA` (212) · `US DEPARTMENT OF VETERANS AFFAIRS` (133) · `VETERANS AFFAIRS` (130) |

Mapping to any single canonical form therefore **breaks every row using the other
form**. That is what the 514 losses were.

**The fix is an equivalence CLASS applied to BOTH sides**, not a one-way alias.
`lcc_tenant_class()` collapses every spelling — note-side shorthand and LCC-side
verbosity alike — onto one token, and a match is "same class". Zero losses,
because nothing is rewritten toward one vocabulary; both are folded into a
neutral one.

It also promotes the parenthetical on the type codes: `Multi (CBP) → CBP`,
`MOB (SSA) → SSA`, which is what makes the 1,262-row `MULTI` token usable.

**The general lesson, worth keeping:** a normalisation that improves a headline
number can still be destroying matches underneath it. The before/after must count
**newly matched and lost separately** — a single percentage would have shown
"+3 points, ship it" and hidden 514 regressions.

### Remaining gap after P130

39% of in-scope tuples still miss. The residue is long-tail agency naming on the
gov side — `LSC SOUTHEAST LEASED FIELD OFFICE`, `MICHIGAN SERVICE CENTER`,
`PITTSBURGH FIELD OFFICE PA` — which are GSA sub-tenancies LCC records by office
name while the notes record them by agency. That needs the note *body* (address)
rather than more classes, which is the §7 item 4 decision.

---

## 9. P131 — the payoff: named leads for owners we could not reach

> **▶ Forward reference:** the "named lead" concept introduced here and in §10 was promoted to a first-class
> pursuit state by **P158/P158a (2026-08-20)** — `NAMED LEAD — find their line` in
> `v_lcc_top_seller_prospects`, surfaced by `v_lcc_named_lead_worklist` (61 owners / $121.5M), deliberately
> **not** counted as reachable (P112) and auto-retiring once the contact gains an email or phone. Details at
> the end of §10 ("Where the pursuit funnel now stands").

**1,137 of the 3,883 unreachable top prospects (29%) now have a named lead**,
covering **$1,014,108,088** of annual rent. 2,645 candidate parties, 1,711 of
them people, ~2.3 per owner.

`v_lcc_note_contact_leads`, split by how ambiguous the property match is:

| strength | owners | candidates | people | rent |
|---|---|---|---|---|
| **unambiguous** (1 property shares tenant/city/state) | 412 | 937 | 650 | $335.6M |
| likely (≤3) | 304 | 848 | 555 | $308.7M |
| ambiguous (>3) | 478 | 1,087 | 675 | **$666.9M** |

**The biggest rent sits in the weakest bucket.** That is precisely where a single
blended confidence score would have been most misleading — it would have averaged
$666.9M of shaky matches together with $335.6M of solid ones and produced a
number that felt fine. The bucket is exposed instead of averaged away, and the
collision count (`properties_sharing_tenant_city_state`) is on every row.

**A row is a research lead, not evidence.** It says "your team wrote a note about
this party on a property matching this owner's asset." It does not say they own
it — the export has no role (§3) — and it does not prove the property is the same
building, because the join averages 2.7 properties per title. Nothing here may be
promoted into `lcc_property_owner_evidence`.

**Start with the 412 unambiguous owners / 650 named people.** That is the
shortest path from "$2.72B we can rank but not reach" to a call.

---

## 10. P132 — 294 owners we can call today (review lane)

Narrowing P131's leads to what is actionable now:

| | |
|---|---|
| unambiguous leads that are people | 650 across 412 owners |
| already an LCC entity | 436 |
| **with an email or phone on file** | **424** |
| **owners immediately reachable** | **294** — **$265,633,776** |
| candidates needing an SF fetch | 214 |

`v_lcc_note_lead_attach_review`: 685 proposal rows, 294 owners, 424 people,
665 with an email, **zero non-person-shaped candidates**, notes written
2019-12-06 → 2023-11-30.

**It is a review lane, not an auto-attach.** Attaching a person to an owner
asserts who speaks for that company. P111 measured what automating that does: of
101 rows in the owner-contact propagate lane, 77 were organization-shaped and
dominated by transaction counterparties — confirming them writes another
company's switchboard onto the owner. The standing rule is *"never wire a single
confirm button to it."*

This lane is weaker still, carrying **two** independent uncertainties: role is
unknown (§3), and the property match is tenant-class + city + state rather than
an address. So each row carries the note title, its authors, when it was last
written and how many notes exist on that party — a 2019 note from a departed
analyst is a different proposition from a 2023 note by the deal lead, and the
reviewer can see which they have.

### Where the pursuit funnel now stands

| | owners | rent |
|---|---|---|
| pursuing (on cadence) | 198 + 312 seeded (P128) | — |
| **reachable today via a note lead, pending review** | **294** | **$265.6M** |
| named lead, weaker match or needs SF fetch | 843 | $748.5M |
| still dark — no lead, no contact | ~2,746 | ~$1.7B |

> **▶ FORWARD REFERENCE — P158/P158a (2026-08-20) made "named lead" a first-class pursuit state.** The
> concept built across §9–§10 and tabulated above is no longer an ad-hoc review cohort: `NAMED LEAD — find
> their line` is now its own state in **`v_lcc_top_seller_prospects`**, surfaced by the dedicated worklist
> view **`v_lcc_named_lead_worklist`** — **61 owners / $121.5M**. Two properties of that state matter when
> reading the funnel above: (1) it is **deliberately NOT counted as reachable**, per P112 — a cadence for a
> party with no contact method can never advance and would only age into "overdue", so a named lead is a
> research target, not an outreach target; and (2) it **auto-retires from the lane** the moment the contact
> gains an email or phone, so the count is self-draining rather than a static backlog.

---

## 11. Scott's validation — the leads are an OWNERSHIP CHAIN, not a contact list

**This section supersedes the optimistic framing in §9–10.** Scott reviewed the
10-row sample. The verdict:

| owner | candidate | Scott's read |
|---|---|---|
| Government Properties Income Trust | Lee Elman | **prior owner** — a private individual who owns gov properties; both likely owned it, different groups |
| RMR (REIT) | Marvin Romanek | developer or private individual, **not RMR** |
| **UIRC** (private fund) | **Bismarck Brackett** | ✅ **correct** |
| Government Properties Income Trust | Breck Hines | private, **not** GPIT — "earlier or later in the ownership history" |
| GPT Properties Trust | Bryant Martin | same Montgomery note, different party |
| Office Properties Income Trust | Breck Hines | same as above |
| **Gardner-Tanenbaum** | **Richard Tanenbaum** | ✅ not disputed |
| Gardner Tanenbaum Holdings | Gregg S Barton | **Genesis Financial is a different private fund** — similar structure and focus |
| Egp 5425 Salt Lake LLC | Scott Ozymy | **EGP 5425 is an SPE for Easterly REIT**; KDC is the developer |
| ExchangeRight (REIT) | George Hart | **the nephrologist who owned it previously** |

**1 clearly correct, maybe 2. I estimated 30–50%; the truth is 10–20%.** My guess
was optimistic and the pattern I proposed as the discriminator ("owner-matching
email domain = good") is right but *far* rarer than I implied.

Measured across the whole lane: the domain rule confirms **16 of 293 owners
(5.5%)**, covering $50.3M. Precise, and tiny.

### What the data actually is

Scott described nearly every miss as *"prior owner"*, *"earlier or later in the
ownership history"*. **These notes are an ownership-CHAIN record, not a contact
list.** Team Briggs wrote a note each time a party touched a property, across
years — so one property accumulates the developer, the prior owner, the current
owner and sometimes the broker.

That is a different asset, and a more interesting one than "who do I call":

- it is exactly what `lcc_property_owner_supersession_review` needs — the
  supersession tier exists because a building sold three times yields three
  near-equal candidates, and it currently abstains on 360 ties for want of
  ordering evidence. **Note dates give a partial ordering.**
- it explains entity fragmentation independently of any name-matching heuristic.

### Entity facts learned, worth recording

- **`Egp 5425 Salt Lake LLC` is an SPE for Easterly REIT** — an SPE→parent edge
  LCC does not hold.
- The `Government Properties Income Trust` / `GPT Properties Trust` /
  `Office Properties Income Trust` cluster appears against the same Jackson, MS
  note — a probable merge/parent group.
- Party TYPE matters and LCC does not model it: REIT vs private fund vs SPE vs
  individual vs developer vs operator. Scott distinguishes these instantly and
  the distinction drives whether a contact is reachable at all.

### Revised recommendation

1. **Attach only the 16 domain-confirmed.** High precision, small, safe.
2. **Do NOT work the other 277 as contacts.** ~90% would be a prior owner,
   developer, broker or tenant — the P111 failure mode, confirmed empirically
   rather than feared.
3. **Re-point the remainder at the supersession problem**, where "prior owner
   with a date" is the signal rather than the noise.
4. **Ollama fits here** (Scott's suggestion) on the P106 pattern — deterministic
   layer first (the domain rule), model scores only the residue, annotation-only,
   never attaches. But it should be pointed at *ordering the ownership chain*,
   not at guessing today's contact.

> ⚠️ **§12 corrects items 1 and 3 above.** The "16 domain-confirmed" figure was
> produced by a broken test and item 3 does not survive measurement. Read §12
> before acting on this list.

---

## 12. P134 — two corrections to §11, both against my own work (2026-08-18)

**§11 was written from measurements I did not check hard enough. Both of its
actionable items were wrong.**

### Correction 1 — my "domain-confirmed" set contained the row Scott rejected first

§11 recommended attaching **16 owners / $50.3M** whose SF contact email domain
matched the owner. I measured that with a naive substring test:

```sql
owner_core like '%' || email_root || '%'
```

`me.com` is Apple's consumer mail. Its root, `me`, is a substring of
`governmentincomeproperties` — the strict core of **Government Properties Income
Trust**. So the set's single largest row, **$31M, Lee Elman**, was "confirmed" by
a rule that had matched the letters `me` inside the word `income`.

That is the **exact row Scott rejected first**, with the exact explanation that
Lee Elman is a private individual and GPIT is a REIT. My discriminator endorsed
it. A second row, COARRA Washington Investments / John Neal, came through the
same `me.com` hole.

**Corrected rule — `lcc_email_domain_confirms_owner(email, owner_name)`**, now
the single source so the seed and the view cannot drift:

1. free-mail domains are never corroboration (`me`, `gmail`, `yahoo`, …)
2. the domain root must be ≥ 4 chars — which kills `me` and `aol` on its own
3. the root must **equal a token** of the owner's strict core, or be a **prefix
   extension of the whole core** (`stoltzfusm` ~ `stoltzfus`,
   `alteradevco` ~ `alteradev`). **No substring containment.**

Live gate: **14/14** — accepts all eleven real pairs, refuses both `me.com` rows
and a `gmail.com` control.

| | §11 claimed | P134 measured |
|---|---|---|
| owners | 16 | **11** |
| annual rent | $50.3M | **$17.6M** |
| top row | Lee Elman, $31M | *rejected* |

`lcc_owner_strict_core` is the deliberate choice — `lcc_normalize_entity_name`
and `dup-pair-planner.ownerCore` are both **banned for identity** (CLAUDE.md),
and this is an identity question.

### Correction 2 — the notes cannot order the ownership chain either

§11's most appealing idea was item 3: notes carry dates, supersession abstains
for want of ordering, therefore notes break the ties. Measured against
`v_lcc_owner_supersession_review`:

| | |
|---|---|
| assets tied on winning date | **236** |
| … with city + tenant to match on | 183 |
| … with **any** tied owner named in a note | **8** |
| … with **two** tied owners named | **3** |
| … with two owners at **distinct dates** | **0** |

**Zero ties are breakable.** The note parties and the tied owner entities barely
intersect — the ties are dominated by SPE-named owners that no note ever names.

My first pass at this measured 0 for a different reason and I nearly reported it:
I joined on `lcc_sf_note_property_assertion.entity_id` and `resolved_property_id`,
both of which are **NULL on all 33,997 rows** — P130 resolves matches live in a
view and never wrote back to the table. Re-measuring through the real matching
path (tenant class + city + state, then strict-core name equality) gives the same
answer honestly rather than by accident. Recorded on the view comment so it is
not re-attempted.

### What shipped

| | |
|---|---|
| `lcc_email_domain_confirms_owner()` | the corrected rule, single-sourced |
| `lcc_p134_seed_note_domain_confirmed()` | dry-run default, idempotent, reversible |
| `v_lcc_note_lead_attach_review` | `+ domain_confirmed`, `+ disposition` (appended) |

**12 proposals seeded, 11 owner entities, 8 people, $17.6M — into the existing
P114 lane, not a new writer.** P114 already re-runs the shape gate server-side,
mints via `ensureEntityLink`, links via `linkPersonToEntity`, ledgers the edge id
for reversal, and offers a terminal reject. Forking a second writer for 12 rows
would have duplicated all of it.

**`entity_relationships` rows written: 0.** These are proposals; the verdict is
Scott's. The remaining 672 rows / 289 owners / $262.3M keep their evidence and
carry a `disposition` saying plainly they are not workable as contacts.

### A duplicate found on the way

`Altera Dev` exists **twice** — `32a45073…` typed `person`, `cef1fa5f…` typed
`organization`. Both matched Terry Quinn. Identical names, so
`v_lcc_merge_candidates` should already group them. Two more mistypings in this
set of eleven: `UIRC` is typed `person`, `Pete Dienna` is typed `organization`.
Independent evidence for Scott's §11 point that **party type is undermodelled**.

### What I would not do next

Chase the 672. The base rate is measured, the domain rule is the only cheap
discriminator, and it clears 11. Anything further needs the **note bodies**
(§7 item 4) — which carry the address, the dated sale and the role — not more
string matching on titles.

---

## 13. The SPE→sponsor rollup does not survive either (2026-08-18)

With the note path closed at 11, the obvious next lever came from Scott's own
§11 observation — *"Egp 5425 Salt Lake LLC is an SPE for Easterly REIT"*. If
single-asset SPEs roll up to a sponsor we can already reach, one contact unlocks
many assets. The gap it would attack is **3,883 owners / $2,715.9M**.

Measured by token-subset containment (every token of a reachable entity's strict
core appears in the SPE's core, SPE strictly longer), plus a stoplist:

> **631 gap owners / $451.3M / 214 sponsors** — 16% of the gap.

**Then I looked at the rows, and every top sponsor was a common noun:**

| "sponsor" | core | SPEs | what it actually matched |
|---|---|---|---|
| Q Street Ltd | `street` | 79 | `10 Weybosset Street, LLC` |
| Owner | `owner` | 72 | `1201 Elm Street Owner LLC` |
| Government | `government` | 10 | `Eagle County Government` |
| Plaza Corp | `plaza` | 48 | `300 F. Ogawa Plaza LP` |
| Bank | `bank` | 34 | `Agfirst Farm Credit Bank` |

### Why tuning cannot fix it

The natural repair is to replace the hand-maintained stoplist with a
**measurement** — token document frequency, so common nouns fall out on their
own. It does not separate them:

| token | df | | token | df |
|---|---|---|---|---|
| `street` | 136 | | **`uirc`** | **39** |
| `plaza` | 78 | | `gateway` | 26 |
| `owner` | 75 | | `state` | 24 |
| `bank` | 48 | | `government` | 20 |

**`uirc` — a genuine prolific sponsor — is MORE frequent than `gateway`,
`state`, `government` and `atlanta`, all of which are noise.** That is not a
threshold problem. A sponsor is frequent *because* it is prolific, which is the
same signal as a street being frequent because it is a street. No cutoff
separates them, so no amount of tuning rescues the heuristic.

### What would make it admissible

A shared **property, deed, mailing address, or Salesforce contact** between SPE
and sponsor — with name similarity as corroboration rather than the claim. The
mailing-address route is already known input-starved (gov
`recorded_owners.mailing_address` = 4 rows; ORE Phase A1 documents why). So this
needs new evidence, not a better string rule.

**Not built. The 631 / $451.3M figure is retracted; it is noise.**

→ **P136 (`lcc_dia_ownership_master`) supplies exactly that missing evidence for
dialysis: 335 hand-written `SPE | principal` pairs, keyed on CCN.**
