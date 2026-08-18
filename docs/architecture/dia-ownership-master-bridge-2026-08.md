# Dialysis Ownership MASTER as an ownership bridge — findings, 2026-08-18

**Status:** loaded (3,271 rows), property-linked (2,905), measured. **Nothing
promoted to ownership evidence.** Read §4 before acting on any number here.

**Table:** `lcc_dia_ownership_master` (P136) · **Loaders:**
`scripts/load-dia-ownership-master.mjs`, `scripts/resolve-dia-ownership-property-ids.mjs`
· **Batch tag:** `dia_ownership_master`

Companion to [`sf-note-records-ownership-bridge-2026-08.md`](sf-note-records-ownership-bridge-2026-08.md),
which records why the Salesforce note records did **not** close this gap.

---

## 1. Why this file and not the notes

The gap: **3,883 top seller prospects with no reachable contact, $2,715.9M** of
annual rent. The dia slice is **808 owners / $244.3M** across 1,135 properties.

The note records (P129–P134) failed at it twice — ~10% contact hit rate, and 0 of
236 supersession ties broken — for two structural reasons this workbook does not
share:

| | note records | ownership workbook |
|---|---|---|
| key | note *title* text | **CMS CCN** — a real join |
| role | unknowable | **already columnar** |

Because the key is a CCN, none of the name-matching traps apply: not P116
(brokerage-as-owner), not P130 (tenant aliasing), not P135 (the SPE→sponsor
token overlap that turned out to be matching the word "street").

## 2. What loaded

8,902 sheet rows → **3,271** carrying a named party (rows with a CCN and no party
are value-gated out at the door).

| column | rows | |
|---|---|---|
| `recorded_owner` | 3,078 | owner of record |
| `true_owner` | 2,374 | beneficial owner — **often a person** |
| `previous_owner` | 555 | the PRIOR owner, stated |
| `developer` | 335 | |
| `last_sale_date` | 1,050 | |

**Property link (P136b): 2,905 linked → 2,848 distinct dia properties.**
326 `no_clinic` (CCN unknown to dia), 40 `no_property` (clinic exists, carries no
property_id). Unresolved rows are stamped, not silently absent.

### The CCN keys dia perfectly and LCC barely at all

Of 3,236 workbook CCNs, only **115** resolve through
`external_identities(source_system='cms', source_type='medicare_ccn')`. LCC holds
**345** CMS identities in total against ~11.8k dia clinics — the canonical
identity scheme reserves that slot and nothing ever filled it. Hence the
cross-project resolver. **Worth fixing on its own merits**, independently of this
work.

## 3. What it reaches in the gap

**426 of the 808 dia gap owners (52.7%), $150.2M** — 332 with a beneficial owner
named, 132 with a previous owner, 91 with a developer.

## 4. ⚠️ The honest split — it is NOT "258 owners unlocked"

A person-shape test says 258 of those owners get a person-shaped name, $98.7M.
**That number is misleading and should not be quoted.** Comparing the workbook's
owner against the LCC owner (strict core) splits it four ways:

| | owners | rent | with a date |
|---|---|---|---|
| **DISAGREES with LCC** — conflict, needs a date to resolve | **228** | $102.0M | 124 |
| workbook owner **IS** the LCC owner — no new party | 49 | $38.5M | 31 |
| **LCC holds the SPE, workbook names the principal** | **40** | $12.3M | 25 |
| prose in the name field — needs cleaning | 27 | $25.2M | 13 |

**The clean unlock is 40 owners / $12.3M**, not 258. Those are the unambiguous
SPE→principal rows — `Headley Properties, LLC → James Headley`,
`SUNRISE FREMONT REAL ESTATE LLC → DR. SHAUKAT RASHID`,
`DURGA ENTERPRISES LLC → JAGDISH N MITTAL`, `SAGE HILLS MHP LLC → Craig Burrows`.

**The 228 conflicts are not errors.** They are the ownership chain again, seen
from the other end. Two live examples:

- LCC says **ExchangeRight** owns it; the workbook says `JRW Investments`, with
  `previous = Andrew Radoszewski`, sale `2021-03-18`. The workbook is a
  point-in-time research file and ExchangeRight may have bought *after* it.
- LCC says **SMBC**; the workbook says `Hamo Sahaguian`, sale `2015-07-10`.

So the workbook can be **stale relative to LCC**, and LCC can be wrong relative
to the workbook, and `last_sale_date` is the only thing that can arbitrate — on
**124 of the 228**. This is exactly the P113 prior-vs-current trap, now visible
in both directions. **No auto-write. A conflict lane, or nothing.**

**27 rows carry prose** — `"Closed account - Eli Mordechai"`. Minting that as an
entity is how a garbage party enters the graph. Cleanable, not clean.

## 5. Supersession: better than the notes, still small

| | notes (P134) | workbook |
|---|---|---|
| tied assets (all) | 236 | 236 |
| … that are dia | — | 109 |
| … present in the source | 8 | 45 |
| … with a prior owner named | 3 | 8 |
| … with a **dated** transition | **0** | **7** |

Seven is more than zero and it is still seven. The supersession ties are mostly
**gov** (127 of 236), which this dialysis workbook cannot touch by construction.
The gov equivalent — `Copy Government Master Document.xlsx`, whose Ownership
sheet already seeds the gov DB — is the file to test that against.

## 6. The SPE→principal pairs P135 said were missing

**335 pipe-delimited rows, 305 property-linked, across 302 properties.**

```
T B PROPERTIES VII LLC | Thomas Burer
1407 Se Goldtree LLC   | Venkata Parsa
Prosper Holdings, LLC  | Rex Reynolds
```

§13 of the note-records doc concludes the SPE→sponsor rollup needs "a shared
property, deed, mailing address, or Salesforce contact — with name similarity as
corroboration rather than the claim." These are better than that: a human wrote
the relationship down, and the CCN ties it to a property. This is the admissible
evidence, for dialysis.

## 7. What should happen next, in order

1. **The 40 clean SPE→principal rows** → the existing P114
   `lcc_owner_contact_propagate_review` lane, same as P134's 12. Human verdict,
   shape gate, reversible. Small and high-precision.
2. **The 335 piped pairs** → resolve into SPE→principal *relationships*, which is
   a different assertion from "who owns it" and is the durable structural win.
3. **The 228 conflicts** → a date-arbitrated review lane. Where
   `last_sale_date` post-dates LCC's evidence the workbook supersedes; where it
   pre-dates, the workbook is history. Where neither has a date (104), abstain.
4. **The 27 prose rows** → clean, then re-run 1.
5. **Not** a bulk attach of 258. §4 is why.

## 8. Two PostgREST lessons banked on the way

- **P136a** — an EXPRESSION unique index is invisible to PostgREST. Its
  `on_conflict=` takes column names only, so `Prefer: resolution=ignore-duplicates`
  silently fell back to the never-colliding serial PK and one duplicate 409'd its
  whole 500-row chunk. Ten in-file duplicates cost five hundred rows. Fix: a
  stored generated single-column `dedup_key`.
- **P136b** — Postgres evaluates **NOT NULL before ON CONFLICT**, so a
  partial-column upsert `23502`s instead of merging. The write-back is an RPC.

Both belong to the family already in CLAUDE.md: *a 409 from PostgREST rarely
means what the status code says.*
