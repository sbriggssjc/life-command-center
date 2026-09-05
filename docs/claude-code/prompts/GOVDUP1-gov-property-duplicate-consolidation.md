# GOVDUP1 — gov property duplicates: three classes, one import, and a reversibility limit

> **This prompt replaces the planned `ADDR1c-twin-lane`.** That plan assumed the dia
> `property_twin` lane could be ported to gov. **The measurement refutes the premise** — the gov
> population is not co-located clinics, the producer is not the CoStar sidebar, and gov's merge
> machinery is materially weaker than dia's. Read §1 before assuming any dia precedent transfers.

**Repo:** `life-command-center` · **Domain:** gov (`scknotsqkcheojiaewwh`)
**Depends on (both shipped):** `ADDR1b-merge` (reversible merge on gov) · `SEC1-property`
(`gov_merge_property_reversible` / `gov_unmerge_property` locked to `service_role`)
**Canonical pages to update:** `docs/architecture/costar-sidebar-capture-pipeline.md` (only to say
this is NOT that producer), and a **new** canonical page for the gov property-duplicate class.

---

## 0. Standing rules for this prompt

- **Nothing merges without a human verdict in this unit.** Build the surface and the classifier;
  execute **zero** merges. A batch, if any, is a separate decision after Scott reads the lane.
- **Assert on the state delta, never on a tally.** Every count below is dated 2026-09-05 and is a
  **hypothesis to re-measure**, not an input. If your number differs from mine, yours wins — say so
  and say why.
- **Read named rows before quoting any rate.** Every wrong conclusion in this arc came from an
  aggregate that looked plausible.
- Guards strip comments **then** blank string literals before matching (OCR1c ordering).

---

## 1. What was measured, and why the dia precedent does not transfer

**Live 2026-09-05, gov `properties`, non-archived, address ≥ 8 chars.** ⚠️ **The population depends
entirely on the key, and both numbers are correct:**

| key | groups | properties |
|---|---:|---:|
| `regexp_replace(lower(address),'[^a-z0-9]','','g')` + state — **use this one** | **399** | **953** |
| `lower(trim(address))` + state (exact string) | 132 | 419 |

The 267-group / 534-property difference is **punctuation and spacing only, same city, same state** —
`1000 Terminal Dr` / `1000 Terminal Dr.` (Macon GA), `1000 Wilson Blvd` / `1000 Wilson Blvd,`
(Arlington VA), `100 NE Loop 410` / `100 N.e. Loop 410` (San Antonio TX), `103 Mbl Bank Dr` /
`103 M B L Bank Dr` (Minden LA). **These are the highest-precision subset in the whole population**,
and the exact-string key cannot see a single one of them. Take the normalized key.

| # | class | groups | properties | producer | disposition |
|---|---|---:|---:|---|---|
| **A** | empty-husk fan-out | 1 | **154** | `unknown_writer` | **not a merge question** — bulk retire |
| **B** | punctuation-only variants | 267 | 534 | `excel_master` | merge; highest precision |
| **C** | city-variant, exact address | 3 + 128 | 265 | `excel_master` (one import) | merge, human verdict |

Three facts that each kill a piece of the ported-lane plan:

1. **The producer is a single spreadsheet import, not a capture.** `excel_master`, **9,633 rows, all
   created 2026-03-05**, one run. This is not an ADDR/CoStar continuation and must not be filed
   under that arc. Class A's producer is `data_source = 'unknown_writer'` (225 rows total, 154 of
   them this one address) — **whoever writes that is unidentified and finding it is part of the
   job.**
2. **`co-located ≠ twin` is the wrong risk here.** dia's lane exists because a Fresenius and a
   DaVita share a plaza. gov's equivalent — two agencies in one federal building — **is what a merge
   FIXES**, not what it breaks: `1120 E 80th St, MN` carries `MN/WI SERVICE CENTER` on one row and
   `DHS` on the other, and those belong as two *leases* on *one* property. **122 of 128 pairs have
   BOTH members carrying real attachments** (lease/sale/document/owner), so the operation is
   consolidation of split history, never deletion of an empty shadow.
3. 🚨 **gov `properties` has NO `merged_into_property_id`.** `gov_merge_property_apply`
   **hard-DELETEs** the dropped row; reversibility lives entirely in `gov_property_merge_backup`.
   Two consequences you must carry:
   - dia's lane and every consumer that filters `merged_into_property_id is null` has **no gov
     analogue** — a merged gov property simply ceases to exist. Any view you write must not pretend
     otherwise.
   - `gov_merge_property_apply` **DELETEs colliding child rows** on `unique_violation`
     (`*_deleted_on_collision` in `rewired`). The backup snapshots child **ids**, not child **rows**,
     so those are gone. ✅ **`gov_unmerge_property` is already honest about this** — it reports
     `<table>.<col>_lost` per table plus an explicit `note`. **Do not "improve" that away**, and
     **read `_lost` on every round trip** (a partial restore that reads as clean is the P196/ENTC
     failure).

---

## 2. ⚠️ Two measurement traps I hit while sizing this, and you must not repeat

### 2a. The key decides the population — state which key, always

I first re-measured on the exact-string key, got **132 groups**, and was one sentence from
publishing that my earlier **399** figure "did not reproduce." It reproduces exactly; the two
numbers answer different questions, and the *larger* one is the one that matters because the extra
267 groups are the cleanest duplicates in the set. **Never report a duplicate-population count
without the key that produced it** — and when a re-measurement disagrees with an earlier one, check
whether the two used the same key before concluding either is wrong.

### 2b. `lpad('',5,'0')` is `'00000'`, not NULL

Sizing zip agreement across the 128 pairs, I first wrote:

```sql
nullif(left(lpad(regexp_replace(coalesce(zip_code,''),'[^0-9]','','g'),5,'0'),5),'')
```

An **empty** `zip_code` becomes `''` → `lpad('',5,'0')` = **`'00000'`** → not null. So a missing zip
counted as a *present, disagreeing* zip. Result: **46 agree / 82 differ / 0 missing** — a completely
plausible number, and wrong. Corrected by requiring ≥ 4 digits **before** padding:

**42 agree / 15 differ / 71 missing on one member.**

Same family as PR1a's retracted roundness statistic (which measured zeros) and P157/P182: *a
comparator structurally unable to express the question returns a plausible number instead of an
error.* **Every predicate you write in this unit gets a positive control.**

---

## 3. Units

### Unit 1 — identify the `unknown_writer` producer, then dispose of class A (154 rows)

`1085 Route 4 E`, Rutland, **`state` NULL**, `zip_code` `'5701'` (VT 05701 with the leading zero
stripped), `data_source = 'unknown_writer'`, created 2026-07-31 → 2026-08-06, and across all 154:
**0 owners, 0 leases, 0 sales, 0 documents.** Pure husks.

1. **Find the writer.** `unknown_writer` is a fallback label — grep for what assigns it and what
   reaches that path without a real `data_source`. The leading-zero-stripped zip and the NULL state
   are fingerprints: something read a spreadsheet column as a number. **Name the producer or state
   plainly that you could not, and say what you ruled out.**
2. **Prove the husks are unreferenced** — not just the four tables I checked. Enumerate **every** FK
   to `public.properties` and count references per husk id. A husk with a reference is not a husk.
3. **Disposition is retire, not merge** — there is nothing to consolidate. Use whatever the gov
   archive convention already is (`status`); **do not delete**, and **do not** reach for
   `gov_merge_property_reversible` for 153 empty rows (154 backup rows to undo one import bug is the
   wrong tool). Keep one row as the survivor **only if** the address is a real gov property — check
   before assuming; if none of the 154 is real, all 154 retire.
4. **Ask what re-creates them tomorrow** (P176). The newest is 2026-08-26, so the producer is
   plausibly still live. A one-shot retire of a recurring producer is a chore repeated forever.

### Unit 2 — classify classes B + C into a review lane (no writes)

**Key = normalized address + state (§1). Classes B and C go in the SAME lane** — they differ only in
whether the source strings happened to match byte-for-byte, which is not a fact about the buildings.
Carry `address_match = 'exact' | 'punctuation_only'` as a field so the difference stays visible and
so B's much higher expected precision can be read off the lane rather than assumed.

⚠️ **The corroboration figures below were measured on the 128 exact-string pairs only.**
**Re-measure them across all 399** before quoting any of them; class B is same-city by construction,
so its distribution will not look like class C's.

Build `v_gov_property_duplicate_review` on gov. One row per **group**, carrying every member with
the evidence a human needs to decide in seconds — the C11 lesson: *naming a candidate without saying
why is what makes a legible surface dangerous.*

Per member, at minimum: `property_id`, `city`, `zip_code`, `data_source`, `created_at`, lease count,
sale count, document count, whether `true_owner_id` is set, and the distinct `tenant_agency` list.

Per group, a `corroboration` breakdown — **each as its own field, never one blended score**:

| signal | live | notes |
|---|---|---|
| `zip_agrees` | 42 | strongest single signal |
| `zip_differs` | **15** | ⚠️ contains BOTH real dupes with one bad zip AND at least one must-never-merge |
| `zip_missing_on_one` | 71 | **missing ≠ disagreeing** — keep the three states distinct (P180) |
| `agency_agrees` | 17 | `Essington`/`Lester` both `DELAWARE VALLEY FIELD OFFICE` — decisive when present |
| `agency_differs` | 19 | two agencies in one building; **not a rejection** — see §1.2 |
| `agency_missing_on_one` | 92 | the common case |
| `same_city_string` | 22 | the rest differ in city |

**⚠️ Do NOT gate on city-string similarity.** 106 of 128 groups differ in city, and the difference
takes three shapes, only one of which is a spelling variant:

- spelling / abbreviation — `St Louis` / `Saint Louis`, `Linthicum Heights` / `Linthicum Hghts`
- county-qualified form — `Lexington-Fayette` / `Lexington`, `New York-Kings` / `Brooklyn`
- **genuinely different municipality names for one location** — `Essington` / `Lester` (PA),
  `Sweet Water` / `Miami` (FL), `Hollywood` / `Miramar` (FL), `Greece` / `Rochester` (NY)

A string-similarity test **rejects the third shape**, which is real duplicates. The city is context
for the human; it is not the discriminator. (Same class as ADDR1a's refusal to widen a regex, and
the standing ban on fuzzy name matching for identity.)

**Read these 15 zip-disagreeing groups by name and say which are which** — they are the
false-positive frontier and the lane's precision claim rests on them:

```
10701 lambert international blvd MO   8107 St Louis 63145      ++  8253 Saint Louis 63103
1120 e 80th st MN                      253 Bloomington 55420    ++  7926 Minneapolis 55450
11232 nw 20th st FL                   3661 Sweet Water 33172    ++  4075 Miami 33132
11606 city hall promenade FL          3675 Hollywood 33025      ++  4103 Miramar 33027
12819 country pl dr MO                8216 Saint Joseph 64503   ++ 36823 Country Club 64505
1370 lockland ave NC                  8844 Winston-Salem 27103  ++  9055 Winston Salem 27101
3141 beaumont centre cir KY           6076 Lexington-Fayette 40513 ++ 6100 Lexington 40511
4050 w ridge rd NY                   10112 Greece 14626         ++ 10518 Rochester 14618
4130 faber pl dr SC                  12321 North Charleston 29418 ++ 16085 Charleston 29405
445 etna st MN                        7892 St Paul 55101        ++  8002 Saint Paul 55106
4616 west howard lane TX             32790 AUSTIN 78758         ++ 32805 AUSTIN 78728
500 tanca st PR                      12036 San Juan 00902       ++ 12103 San Juan, San Juan 90237
5135 camino al norte NV               9929 North Las Vegas 89031 ++  9991 Las Vegas 89169
602 n. staples TX                    32990 CORPUS CHRISTI 78401 ++ 33172 CORPUS CHRISTI 78405
international airport TX             13329 Brownsville 78521    ++ 13833 Corpus Christi 78406
```

🚨 **`international airport` is not an address — it is a placeholder, and those two are different
airports in different cities.** A group whose address is a placeholder or non-specific string
must be **excluded from the lane by construction**, not left for a human to catch. Note
`500 tanca st` carries `90237` in Puerto Rico, which is not a PR zip at all — *a disagreeing zip can
mean one of them is simply wrong*, which is why the signal informs and does not decide.

The lane's `verdict_hint` may say `merge` / `review` / `do_not_merge`, but **every group requires a
human verdict.** Nothing auto-merges — gov's merge is a hard delete with partial-restore
reversibility, which is a strictly higher bar than dia's soft tombstone.

### Unit 3 — prove the round trip on this population before any batch

P195's rule: **run the reversal before the batch, on the population it will run against.** Pick one
class-C pair where both members carry attachments, and in a **rolled-back** transaction:

1. fingerprint every child row by identity (not by count — **a row COUNT is identical in both runs**
   and only an identity-keyed fingerprint exposes a stranded or lost child, per ENTC)
2. `gov_merge_property_reversible(keep, drop, 'govdup1_roundtrip_probe')`
3. `gov_unmerge_property(backup_id)`
4. re-fingerprint; assert **0 lost / 0 changed / 0 stranded**, and **report `_lost` per table
   verbatim** even when zero

If any table reports a loss, **say so and stop** — that bounds what a batch may safely touch, and it
is a real possibility here because `gov_merge_property_apply` dedup-deletes colliding sales and
child rows. Report the measured result, not the intended one.

---

## 4. Out of scope — say so, do not do it

- **No merges executed.** Not even the "obvious" `St Louis` / `Saint Louis` pairs.
- **No city normalization on `properties`.** Rewriting `Lexington-Fayette` → `Lexington` is a
  separate decision with its own consumers, and it would destroy the county-qualified form which is
  real information from the source.
- **No port of dia's `dia_find_property_twins`.** It has no gov analogue and §1 says why.
- **No fuzzy address matching beyond the punctuation strip.** Stripping non-alphanumerics is a
  normalization; abbreviation expansion (`St` ↔ `Street`, `N` ↔ `North`) is a *judgement* and would
  need its own precision measurement on named rows. Size it if you like, build it here only if the
  measurement earns it — and say which.
- **3+-member groups get read, not assumed.** On the exact key there are three, and they are not one
  shape: `Saint George`/`St George`/`St. George` UT and `Saint Paul`/`St Paul`/`St. Paul` MN are
  city-spelling variants, but `500 East Mann Road` TX has **`LAREDO` on all three members** — an
  identical city string, so it is a different question and may be a different defect. Re-enumerate
  on the normalized key, which will find more.

---

## 5. Deliverables

1. `v_gov_property_duplicate_review` + its classifier, committed as a gov migration **carrying the
   whole view body** (P194: a second copy that is correct beats no copy at all).
2. The Unit 1 producer finding — named, or an explicit statement of what was ruled out.
3. The 15 named zip-disagreeing groups adjudicated in prose.
4. The Unit 3 round-trip result, `_lost` reported per table.
5. A guard `test/govdup1-property-duplicate-review.test.mjs`, **mutation-verified**: report
   `N/N mutations RED` and name any that survived. Assertions must pin *substance*, not a token that
   legitimately appears elsewhere (four of my guards in UX-T1a-gates were defeated exactly that way,
   and the mutation pass found them, not reading them).
6. A new canonical page `docs/architecture/gov-property-duplicates.md`, and a one-line pointer from
   `costar-sidebar-capture-pipeline.md` stating this class is **not** that producer.

## 6. Verify on

- The lane's **class decomposition** (A/B/C group and property counts) **with the key named**, never
  the total — 953 would read identically if every group were misclassified, and 132 vs 399 is a key
  choice rather than a disagreement (§2a).
- `gov_property_merge_backup` row count **unchanged** at the end of this unit (nothing merged).
- The three corroboration states counted separately, with `zip_missing_on_one` ≠ `zip_differs`.
