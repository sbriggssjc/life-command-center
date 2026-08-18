# Salesforce note records as an ownership bridge — findings, 2026-08-17

**Status:** staged, measured, tenant-class matcher shipped (P130). Out-of-scope sectors
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
