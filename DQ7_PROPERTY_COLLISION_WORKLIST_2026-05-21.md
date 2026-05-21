# DQ-7 Property Address-Collision Review Worklist

**Date:** 2026-05-21
**Source:** `public.v_property_address_collisions` (live view on dia + gov — re-export anytime)
**Purpose:** adjudicate the remaining same-address property groups left after the automated DQ-7 cleanup. Decide, per group: **MERGE** (true duplicate → pick survivor, repoint children, flag the rest) or **KEEP BOTH** (legitimately distinct records).

> The 23 obvious sparse duplicates were already merged automatically (gov 4 + dia 19). What remains needs human judgment.

How to use: for each row, put a decision in the **Decision** column — `MERGE -> <survivor pid>`, `KEEP BOTH`, or `INVESTIGATE`. Sparse rows (one side blank tenant) are the safest merges; two distinct operators usually means a multi-tenant medical building or a relocation (keep both, or supersede the older).

---

## A. Dialysis — 87 groups (the actionable set)

### A1. Sparse-row duplicates — one row has a blank tenant (high-confidence MERGE into the named row)

| norm_addr | ST | property_ids | tenants | Decision |
|-----------|----|--------------|---------|----------|
| 10002rockawayblvd | NY | 23132; 31172 | DaVita Ozone Park Dialysis \| (none) | |
| 10241lewisclarkblvd | MO | 26986; 31060 | DaVita Chambers Dialysis \| (none) | |
| 11801guybrewerblvd | NY | 31173; 39545 | DaVita Kidney Care \| (none) | |
| 21bpoliquindr | NH | 27139; 2216137 | Fresenius MC Of Mount Washington Valley \| (none) | |
| 241261durhamave | NJ | 27250; 31136 | DaVita Durham Corners Dialysis \| (none) | |
| 256broadway | NY | 27401; 27610; 36566 | DaVita Huntington On Broadway \| Fmc Huntington Station \| (none) | |
| 310shighlandave | OK | 28226; 31239; 35802 | Fmcna - Heritage Park \| Fresenius MC \| (none) | |
| 315557northlincolnave | IL | 30852; 39521 | DaVita Kidney Care \| (none) | |
| 330arkansasst100 | KS | 25873; 33576 | DaVita Kidney Care \| (none) | |
| 38453851eloop820s | TX | 31385; 39770 | DaVita Kidney Care \| (none) | |
| 404scrapost | MI | 26619; 28721; 36457 | DaVita Mt Pleasant \| Dci East Cooper \| (none) | |
| 4635binzenglemanrd | TX | 31428; 1671890 | Fresenius MC \| (none) | |
| 802806julesst | MO | 31058; 31059; 31073; 2075912 | DaVita Kidney Care \| (none) | |
| 926emcdowellrd | AZ | 22472; 35294 | DaVita Evergreen Park Dialysis \| (none) | |
| barnsofficecentersuite206 | NY | 31164; 39547 | DaVita Kidney Care \| (none) | |
| crossway11suite106 | VA | 31446; 39585 | DaVita Kidney Care \| (none) | |
| lloydlnroute42 | NY | 27427; 31168 | DaVita Catskill Dialysis Center \| (none) | |

### A2. Same operator, name/case variant (likely MERGE)

| norm_addr | ST | property_ids | tenants | Decision |
|-----------|----|--------------|---------|----------|
| 30goldenlandct | CA | 39654; 150036 | DaVita Kidney Care (both) | |
| 3046northernblvd | NY | 22590; 32220 | DaVita Long Island City Dialysis \| DaVita LONG ISLAND CITY DIALYSIS | |
| 413bus59 | TX | 31354; 35210 | DaVita \| DaVita Inc. | |
| 6508ejoliverblvd | AL | 23820; 33731 | Fmc Fairfield (Steel City) \| FMC FAIRFIELD (STEEL CITY) | |
| 1800fm157 | TX | 37779; 2769211 | U.S. Renal Care \| US Renal Care | |
| 5729bryantirvinrd | TX | 30400; 37776 | U.S. Renal Care \| US Renal Care | |
| 2924generaldegaulledr | LA | 32210; 2216195 | DaVita Dialysis \| DaVita Kidney Care | |
| 7921queensblvd | NY | 37224; 37492 | DaVita Dialysis \| DaVita Kidney Care | |
| 21910sconduitave | NY | 22049; 2962399 | DaVita Conduit Avenue \| DaVita Kidney Care | |
| 12606westparkdr | TX | 23550; 35303 | DaVita Dairy Ashford \| DaVita Kidney Care | |
| 1020n14thst | TX | 29078; 42066 | DaVita Golden Triangle \| DaVita Kidney Care | |
| 190westsidedr | GA | 22383; 24969 | DaVita Douglas Dialysis \| DaVita Douglas Home Dialysis | |
| 11801guyrbrewerblvd | NY | 27458; 38408 | DaVita Kidney Care \| DaVita Queens Dialysis Center | |
| 1500pollittdr | NJ | 27280; 38299 | DaVita Kidney Care \| DaVita Radburn Dialysis | |
| 1600centreparkdr | NC | 27655; 38297 | DaVita Asheville Kidney Center \| DaVita Kidney Care | |
| 201swlst | OR | 28285; 28330 | DaVita Kidney Care \| DaVita Redwood Dialysis | |
| 5shawscove | CT | 24529; 37711 | DaVita Kidney Care \| DaVita New London Dialysis | |
| 608610wynnewoodvillage | TX | 29242; 39693 | DaVita Kidney Care \| DaVita UT Southwestern-Oakcliff | |
| n54w6135millst | WI | 29778; 38651 | DaVita Cedarburg \| DaVita Kidney Care | |
| n87w17301mainst | WI | 29772; 31510 | DaVita Dialysis (MT) \| DaVita Menomonee Falls | |
| w175n11056stonewooddr | WI | 29042; 29820 | DaVita Dialysis \| DaVita Mequon Road | |
| 32steubenvillepike | PA | 22667; 31263; 37761 | DaVita \| DaVita Dialysis \| Fkc Sandy River | |

### A3. Two distinct operators / hospital / junk (INVESTIGATE — multi-tenant building vs relocation vs duplicate)

| norm_addr | ST | property_ids | tenants | Decision |
|-----------|----|--------------|---------|----------|
| 3001healthcareway | CA | 30125; 37601 | DaVita Archway Of Modesto \| **"minimal expense exposure due"** (junk tenant — clean) | |
| 100madisonave | NJ | 27251; 27267 | DaVita Renal Center Of Morristown \| Fmc East Morris | |
| 1010wareagledr | TN | 28548; 37741 | Fresenius MC \| Ncpdc Lewisburg | |
| 10120calumetavesuite102 | IN | 22987; 25658 | DaVita Comprehensive Renal Care - Munster \| Munster Dialysis Center | |
| 1013whitehorseave | NJ | 27198; 27300 | DaVita Renal Center Of Hamilton \| Fmc Hamilton Square | |
| 103abjacksrd | SC | 28843; 35740 | Clinton Dialysis Clinic \| Innovative Renal Care | |
| 1117arlingtonaven | FL | 30488; 39931 | DaVita Kidney Care \| St Petersburg Kidney Care | |
| 1250northmeadowpkwy | GA | 25017; 25018 | DaVita North Fulton \| Fresenius MC - Condo | |
| 1635mineralspringave | RI | 28691; 28692 | DaVita North Providence \| Fmc Nna Of Providence | |
| 16451ushwy49 | MS | 26852; 39932 | Fresenius MC \| Rcg Belzoni | |
| 1661industrialpkwywest | CA | 24120; 30038 | DaVita Hayward Mission Hills \| Kaiser Hospital ESRD PD Unit | |
| 1670capitalstsuite900 | IL | 22503; 23402 | Fresenius Kidney Care South Elgin \| Home Dialysis Svcs - Fox Valley | |
| 1739lexingtonaven | MN | 26690; 26756 | DaVita Larpenteur Ave \| Fmc Dialysis - Roseville | |
| 1859wtayloruimccmc794room1003 | IL | 22978; 25466 | Dialysis - U of Illinois Hospital \| Fmc - Austin Community Kidney | |
| 2010nstatest | MS | 26788; 39947 | Fresenius MC \| Rcg Clarksdale | |
| 20244thavesouthsuite100 | AL | 23799; 34002 | DaVita \| FMC Birmingham Metro | |
| 204rossblvd | KS | 25858; 37726 | Fresenius MC \| Renal Care Group - Dodge City | |
| 205bbellemeadept | MS | 22548; 38985 | Fkc Dogwood \| Fresenius Kidney Care | |
| 221fm3009 | TX | 22265; 2445681 | Fkc Schertz \| Fresenius MC | |
| 2400lucyleepkwysuiteed | MO | 26918; 31044 | DaVita Kidney Care \| Fmc - Poplar Bluff | |
| 2880wairlinehwy | LA | 23431; 26141 | DaVita Kidney Care \| Fmcna - Laplace | |
| 3020childrenswaymc5115 | CA | 22942; 24393 | Childrens Hospital Of San Diego \| DaVita San Ysidro | |
| 3251southwhiterdsuite10 | CA | 22700; 24418 | Satellite Healthcare Evergreen \| Wellbound Of San Jose | |
| 3280poncedeleon | FL | 24668; 24881 | Bma - Metropolitan Miami \| DaVita Florida Renal Center | |
| 35michiganstnemc83 | MI | 23045; 26540 | DaVita Pdi-Grand Rapids East \| Devos Childrens Hosp | |
| 419villagedr | PA | 28447; 28582 | DaVita Carlisle Regional \| Fkc Cumberland County | |
| 4564francislewisblvd | NY | 27406; 38402 | DaVita Kidney Care \| Fms-Bayside Dialysis Center | |
| 46360gratiotave | MI | 26577; 26656; 2776955 | DaVita Kidney Care \| DaVita Partridge Creek \| Fmc - Chesterfield | |
| 4775ngreenbayave | WI | 31513; 37744 | American Renal Associates \| Innovative Renal Care | |
| 500alamoanablvdsuite7302 | HI | 23397; 25281 | Liberty Dialysis-Hawaii Ala Moana \| Usrc Kapahulu | |
| 515pecandr | TN | 26914; 28926 | DaVita Bolivar \| Fmc - Bolivar | |
| 537stonecrestpkwy | TN | 25109; 28987 | DaVita Smyrna \| Fresenius MC Highlands | |
| 5435aldinemailroute | TX | 29104; 37762 | Codale Electric Supply \| Fresenius MC North Houston | |
| 5601desotoavearea247 | CA | 22936; 23284 | DaVita Warner Center \| Kaiser Foundation Hospital - Woodland Hills | |
| 5623wtouhyave | IL | 25376; 25518 | DaVita Big Oaks \| Fmc - Niles | |
| 5815us301hwy | NC | 27691; 32300 | Fmc Four Oaks \| Fresenius MC | |
| 5route45 | NJ | 27164; 35529 | Fmc Salem Dialysis \| Fresenius MC | |
| 6040freshpondrd | NY | 22583; 39126 | Fms-Queens Kidney Care \| Fresenius MC | |
| 6116sportsvillagerd | TX | 23294; 1841309 | DaVita Kidney Care \| Fresenius Kidney Care North Frisco | |
| 611electricave | PA | 26195; 28419; 3456679 | DaVita \| DaVita Lewistown \| Fmc Lewiston Auburn | |
| 6120southyaleavesuite300 | — | 37538; 37544; 37553; 37557 | DaVita \| Fresenius Kidney Care | |
| 6120syaleaveste300 | — | 37524; 37528; 37552; 37556 | DaVita \| Fresenius MC \| U.S. Renal Care | |
| 7800nw23rdst | OK | 22104; 28200 | DaVita Northwest Bethany \| Physicians Choice Dialysis | |
| 7professionaldr | IL | 25356; 39919 | Fmc - Southwest Illinois \| Fresenius MC | |
| 816dukeave | GA | 22390; 25133 | DaVita Downtown Warner Robins \| Fmc Svcs Of Houston County | |
| 846parkcentreway | ID | 25292; 25305 | DaVita Kidney Care \| Liberty Dialysis - Nampa | |
| 8803nmeridianst | IN | 23421; 37464 | DaVita Home Dialysis Of Indianapolis \| Indiana University Health | |
| 9076kingstonrd | LA | 26074; 37753 | Fmcna - Southwest Shreveport \| Fresenius MC | |

> Note: the two `6120 S Yale Ave Ste 300` entries (Tulsa, OK) overlap each other AND normalize differently ("southyaleave" vs "syaleave") — that whole address is one real medical building with several operators and should be reconciled together (8 property_ids across the two groups).

---

## B. Government — 217 groups (lower urgency; uniform pattern)

**Finding:** essentially all 217 gov groups are **two property rows at one building carrying two different `lease_number`s** — the classic GSA pattern where a lease renewal/replacement (or a second agency suite) creates a new `properties` row. These are **NOT data-entry duplicates**; they reflect the one-property-per-lease model. The typical signature is an older row with a blank/`(none)` agency label + a newer row with the named field office (e.g. lease `LMN00420` + `LMN01032` at 4300 Glumack Dr, MN).

**Recommended handling:** treat as a data-modeling decision, not a cleanup. For each, decide whether to (a) **keep both** per-lease rows (current model), or (b) mark the expired-lease row `superseded` once its lease has lapsed. This is better done as a rule (supersede a gov property row when its `lease_expiration` < today AND a newer lease exists at the same normalized address) than by hand.

**Full list:** query the live view rather than transcribing 217 rows —
```sql
SELECT norm_addr, state, property_ids, lease_numbers, agencies
FROM public.v_property_address_collisions   -- gov project scknotsqkcheojiaewwh
ORDER BY norm_addr;
```

**Representative examples:**

| norm_addr | ST | property_ids | lease_numbers | agencies |
|-----------|----|--------------|---------------|----------|
| 4300glumackdr | MN | 188; 7906; 7934 | LMN00420; LMN01032; LMN19316 | (none); MN/WI Service Center |
| 1001 Liberty Ave, Pittsburgh | PA | 11676; 11892 | LPA00016; LPA09322 | (none); Pittsburgh Field Office |
| 101 W Broadway, San Diego | CA | 1583; 2212 | LCA00190; LCA02095 | (none); San Diego Field Office |
| 104nmainst | FL | 3822; 4292 | LFL01632; LFL46138 | (none); FBI |
| 10718srobertsrd | IL | 5592; 23431 | (none); LIL16895 | GSA - Social Security Admin; SSA |
| 1086troyschenectadyrd | NY | 10339; 23413 | (none); LNY22954 | GSA; USCIS |
| 111greencourtrd | VA | 14219; 14742 | LVA00324; LVA00539 | (none); DEA |
| 1batterymarchpark | MA | 6661; 6800 | LMA00188; LMA04482 | (none); Boston Service Center |
| 220w2ndst | MI | 248; 7834 | LMI00090; LMI16288 | FBI; Michigan Service Center |
| 5410fredericksburgrd | TX | 12995; 13614 | LTX00521; LTX16847 | San Antonio Field Office; VA |

---

## Suggested order of work
1. **Dialysis A1 (sparse, 17 groups)** — quickest, safest merges.
2. **Dialysis A2 (name variants, 22 groups)** — confirm operator identity, then merge.
3. **Dialysis A3 (distinct operators, ~48 groups)** — investigate; many are real multi-tenant buildings (keep both) or relocations (supersede older). Fix the one junk tenant at `3001 Healthcare Way`.
4. **Government (217)** — implement the supersede-on-expired-lease rule rather than manual review.

*Backed by the live `v_property_address_collisions` views (dia + gov). Re-run them after any merges to confirm the group count drops.*
