> **📍 CANONICAL PAGE: [`docs/architecture/connectivity-and-open-threads.md`](../architecture/connectivity-and-open-threads.md) §4n.**
> **Diagnosis only — nothing written.** Predecessor:
> [`C2g_UNRESOLVED_OWNER_ORGS_2026-08-28.md`](C2g_UNRESOLVED_OWNER_ORGS_2026-08-28.md).

# C2h — the "silent feeder" resolved every one of them. It is the sponsor↔SPE gap.

**Measured live 2026-08-28 on LCC Opps.**

> ## The one-line finding
>
> **C2g called these 79 "the genuine feeder defect." They are not a defect at all.** Every one of
> their properties **is** resolved in `lcc_property_owner` — the feeder resolved the **SPE that holds
> title**, which is the correct recorded owner, while the Salesforce person works for the
> **sponsor**. Both sides are right. **The missing thing is the sponsor→SPE link**, and the
> machinery for it already exists: `lcc_owner_sponsor_domain` (P190) and A3's
> `lcc_ownership_sponsor_family`.

---

## 1. Every hypothesis about a silent producer was wrong — including mine

| tested | result |
|---|---|
| brokerage guard | **2 of 79** |
| placeholder guard | **0** |
| not-prospected (public body / university) | **0** |
| ever a candidate in `lcc_property_owner_evidence` | 5 of 79 |
| **their properties resolved to SOMEONE** | **79 of 79 — all of them** |

⚠️ **`prop_resolved_to_someone` equalled `props_with_asset` on every single row.** That one column
turned a "silent feeder" into "the feeder answered a different question than I was asking." C2g's
§4 framing — *"everything the feeder needs is present and it produced nothing"* — was wrong, and it
was wrong because it never checked whether the property had resolved **to someone else**.

⚠️ **`lcc_looks_like_person` returned true for 40 of 79 and is NOT a census** — it has the
documented `CITY OF SALEM` / `BROOME COUNTY` false positive (A3/P196). It was not used to conclude
anything.

## 2. What the 79 actually are — read on named rows

| SF person's employer *(a gov `true_owner`)* | LCC resolved owner *(the title holder)* | reading |
|---|---|---|
| **Avery Capital** | **AC** ORLANDO SPV LLC | sponsor → its SPE |
| **Ball Ventures** | **BV**GC PARCEL C, LLC | sponsor → its SPE |
| **Browman Development Co.** | **BDC** Livermore L.P. | sponsor → its SPE |
| **Carmel Partners** | **CP** VI Van Gordon, LLC | sponsor → its SPE |
| Corporate Office Properties Trust | REDSTONE GATEWAY 100, LLC | COPT's Redstone Gateway JV |
| Ailani North Dixie | Jacksonville Fl Iii **FGF**, LLC | a known sponsor family |
| 4 LEMNAH LLC | Lemnah Drive LLC | same name family |

**The SPE initials are the sponsor's initials.** This is the same shape A3 measured on the ownership
lane (32 of 74 `mismatch` chains were sponsor↔SPE) and P188/P196 met on the Tier 0 lane. It is the
single most recurrent pattern in this entire arc.

### The split, measured

| | pairs |
|---|---:|
| **genuinely different names — sponsor↔SPE and similar** | **69** |
| same canonical key — **true duplicate entities** | **8** |
| share an 8-char core opening — probable duplicates | **2** |

## 3. Real data-quality residue, found while reading

Small, and worth fixing on its own terms:

- **`Casa De Chupita` → resolved owner `Undisclosed`, confidence 0.57.** A **placeholder won the
  resolution.** `lcc_is_placeholder_owner_name` does not list `Undisclosed`; A2 added anchored
  prefixes for `Previous Owner*` but this string is not covered.
- **`Chiapelone Trust` → `BGC-Havasu Project LLC by Newmark Knight Frank`.** **Brokerage pollution
  inside the resolved owner name** — the P116 class, and gov's `gov_strip_brokerage_suffix` exists
  precisely to strip a `by <brokerage>` suffix rather than reject the owner.
- **`Consilium Investment Management` → `Easterly Gov Properties (REIT)`** and
  **`Carosella Properties` → `WMC Properties`** — unexplained, `relationship_graph` at confidence
  1.00. Worth reading individually before trusting either.

## 4. What to do — and what NOT to build

**Do not build a sponsor→SPE matcher.** Two exist and both are human-confirmed by design:
`lcc_owner_sponsor_domain` (P190, 8 curated entries) and `lcc_ownership_sponsor_family` (A3, keyed
`(sponsor entity, token)`). ⚠️ **A3 measured a lexical sponsor detector at ~25% precision raw**, and
P196 measured the same class at 4-of-6 even *with* three guards — the reason both surfaces are
confirm-only. **A third detector is the normaliser drift this repo has paid for repeatedly.**

The proportionate step is to **feed these 69 into the existing sponsor-confirm surfaces as
candidates** — they arrive with unusually strong evidence, because the sponsor is independently
attested as a gov `true_owner` *and* carries Salesforce people, which is more than either existing
surface normally has. **Sizing that is the next question; it is not sized here.**

## 5. What was NOT measured

- **Whether the 69 sponsor→SPE links are individually correct.** Initials matching is suggestive,
  not proof — `A3` rejected exactly this kind of inference at 25% precision when based on the name
  alone. **Each needs the same human confirm the existing surfaces require.**
- **The 8 duplicate pairs** — they belong to the N3a/P189 wording-difference class and were not
  merged here.
- **Value.** This population was selected by *Salesforce attachment*, not portfolio value. No dollar
  figure should be attached to it.
- **dia.** gov only.
