# C13c — `one_off_owner` rests on `entity_type`, which is wrong in both directions

**Read first:** `docs/architecture/owner-role-classification.md` — **§7 (the shipped state), §8 (the
`user_owner` confirmations)** · Dead-End playbook **Class 34** (an edge count is an observation
count — the same round's other correction) · `CLAUDE.md` on `lcc_looks_like_person`'s documented
two-capitalised-tokens false positive, and **P181** (an escalation must carry the worker's
confidence, and the surface must gate on it).

**One view change on LCC Opps.** No new table, no cron, no consumer repointed.

---

## 1. The measurement — read on named rows, not on a rate

`one_off_owner` = **142** entities, and the arm's only evidence is `entities.entity_type = 'person'`.
**28 fail `lcc_looks_like_person`, and reading them shows the type column is wrong in BOTH
directions:**

**Organizations wrongly typed `person`** — ranked by rent, and the top one is the finding:

| name | rent |
|---|---:|
| **Jamestown** — an institutional investment manager | **$22,801,678** |
| SkyREM · Deoworks · Protea Primewest · Everbank · Gofsco | $1.48M → $605k |
| **AEI NET Lease Portfolio XIII D** — a fund portfolio, in its own name | $294k |
| Alexandria · Brixmor · AvalonBay · BREIT · LaSalle · MIT · Komatsu · EJME | (no rent on file) |

**Genuine individuals the name test REJECTS** (so the guard is no fix): `Maslow Robert C & Michele C`
($654k) · `Anil M & Rajeshkumar K Khatri` ($454k) · `Richard S Coulter & Camilla M Coulter` ·
`John a Bruzzone Sr Fam Ptshp` · `Rubinfeld Family` · `Separovich/Domich` · `Chad Schnabel (GA)` ·
`Nafez Harmouche (TX)` · `Neeta` · `Guy` · `Joan` · `Buddy`.

⚠️ **`&` is a married couple, not a firm (P158a) — do not "fix" this with a name rule.** Every
name-based owner classifier measured in this arc landed ~25% raw, 7%, or 4-of-6 guarded, and
`lcc_owner_name_has_org_marker` catches **0 of 142** here.

## 2. ✅ There IS a discriminating recorded fact, and it was positive-controlled

**A `salesforce/Contact` external identity.** Measured over the 142:

| | |
|---|---:|
| carry `salesforce/Contact` | **13** |
| carry `salesforce/Account` | **0** |
| in the contact hub | 13 |
| `works_at` edges, either direction | **0** |
| name carries an org marker | **0** |

**Read on named rows, all 13: Martin Starr · Denis Rodger · Bill Weitzenkorn · Ryan Gaylord · Brian
Revis · Jim Glickman · Jay Morris · Molly Huang · Sarita Mutscher · Michael P Brown · Justin
Kaufmann · Pinakinl & Rajendrabhai J Patel — 12 unmistakable individuals.** The one miss is
**`Law Offices`**, which `lcc_looks_like_person` wrongly passes (the documented two-capitalised-
tokens false positive).

⚠️ **The positive control is the important half: ZERO of the institutional names carry one.** Not
Jamestown, not BREIT, not AvalonBay, not Brixmor, not Alexandria, not MIT. **The signal separates
the population it needs to separate** — which is why it is worth building on and a name test is not.

## 3. What to build — a confidence split, NOT a deletion

⚠️ **Do NOT drop the 129 uncorroborated rows.** 142 → 13 would discard `Maslow Robert C & Michele C`
and every other genuine individual who simply is not in Salesforce. **And do not keep asserting all
142 either** — that is what puts a $22.8M institutional manager on a one-off-individual lane.

**Split the EVIDENCE, and let the surface gate on it.** The view already makes `evidence_arm`
mandatory on every row; use it:

- **`one_off_owner` corroborated** — `entity_type='person'` **AND** a `salesforce/Contact` identity.
  **13 today.**
- **`one_off_owner` uncorroborated** — `entity_type='person'` only. **129 today**, and the label
  must say on its face that the only evidence is a column measured to be unreliable.

This is **P181 applied one layer down**: *when a worker escalates its residue, the escalation must
carry the worker's confidence, and the surface must gate on it.* A genuine judgement call and a
worthless one must not wear the same label.

**Also surface the known-wrong set explicitly.** The ~15 named institutional owners above are not
"low confidence" — they are **wrong**, and they are identifiable today by name on a list a human has
now read. Route them to `v_lcc_entity_role_ambiguity` with a reason naming the defect
(`entity_type_contradicted_by_named_review`), so they stop being emitted as individuals.
⚠️ **Do not encode that list as a name stoplist in the classifier** — record it as reviewed rows,
the `lcc_entity_role_confirmation` pattern §8 just used for `user_owner`.

## 4. ⚠️ What this must NOT do

- **No name-based repair of `entity_type`.** §1 measures why. **`&` is a married couple.**
- **Do not "fix" `entities.entity_type` itself in this unit.** It is written by other producers and
  read by other consumers; correcting it fleet-wide is a separate, larger change with its own blast
  radius. ⚠️ **Size it and file it — do not start it here.**
- **Do not touch `investor_owner`.** Those same institutional entities are correctly `investor_owner`
  and must stay so; only their **`one_off_owner`** claim is false.
- **Do not change P0.4, the deal bands, or the prospecting brief.** No consumer is repointed.
- ⚠️ **`Law Offices` is in the corroborated 13 and is not an individual.** Report it; do not add a
  special case for it. One known false positive in 13, named, beats a rule nobody has graded.

## 5. Predicted deltas — assert against these

| | today | expected |
|---|---:|---:|
| `one_off_owner` total | **142** | **142 — unchanged in COUNT** |
| …corroborated | — | **13** |
| …uncorroborated | — | **129** |
| rows routed to ambiguity as contradicted | 0 | **~15, named** |
| `investor_owner` · `former_owner` · `repeat_buyer` · `developer` | 6,447 · 3,786 · 385 · 718 | **unchanged** |
| `user_owner` | **10** | **10 — unchanged** |
| P0.4 | 555 | **555** |

⚠️ **If any other arm moves, stop** — this touches one arm's evidence, nothing else.

## 6. Report back

- The corroborated / uncorroborated split, and **the named list you routed to ambiguity**.
- ⚠️ **Read 10 named rows from the UNCORROBORATED 129** and say plainly how many look like genuine
  individuals. **That rate is the honest quality of the arm** and nobody has measured it — the 28
  that fail the name test are not a random sample of the 129.
- **Size the `entities.entity_type` defect fleet-wide** (how many organizations are typed `person`
  and vice versa, by rent) and **file it — do not fix it.**
- Whether `salesforce/Contact` coverage is growing or static; a corroboration that only ever reaches
  9% is a ceiling worth stating.
