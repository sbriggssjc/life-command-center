# GOVDUP1-a — one Salesforce property, 154 gov rows: find the writer and give it a dedupe key

> **The producer names itself in a child row.** GOVDUP1 retired 154 empty husks at
> `1085 Route 4 E, Rutland` and recorded *"producer NOT FOUND"* after correctly ruling out the SF
> promotion worker, the CoStar sidebar and `auto_apply_property_links.py`. Every one of those 154
> carries a `pending_updates` row reading `field_name='_new_property'`,
> `reason='Salesforce auto-created property — verify accuracy and check for duplicates'`, and **one
> shared `sf_property_id = a068W00000FbBqwQAF`** with a different `staging_id` each time.

**Repo:** `life-command-center` · **Domain:** gov (`scknotsqkcheojiaewwh`), plus wherever the writer
lives (LCC repo `api/`, an edge function, or a PA flow — **finding that is Unit 1**)
**Canonical page:** `docs/architecture/gov-property-duplicates.md` (§Unit 1 already carries the
correction; extend it, do not start a new page).

---

## 0. Standing rules

- **Nothing is deleted.** The 8 live rows are retired the way GOVDUP1 retired the 154 —
  `status='archived'` with a logged, reversible batch tag.
- **The dedupe fix comes BEFORE the cleanup.** A one-shot retire of a recurring producer is a chore
  you repeat silently forever (P176) — and **this class has already been cleaned once, in June, and
  recurred.** GOVDUP1 repeated it a third time. **Do not make it four.**
- Counts are dated **2026-09-05**; re-measure and say if yours differ.

---

## 1. Size (live, 2026-09-05)

| | |
|---|---:|
| `pending_updates` rows with `field_name='_new_property'` | **808** |
| distinct `sf_property_id` behind them | **125** |
| still `status='pending'` | **220** |
| created in the last 30 days | **15** |
| newest | **2026-08-26** |
| SF properties that fanned out (>1 gov row) | **53**, into **736** rows |
| of those, still live (not archived) | **8** |

**A 6.5× fan-out.** The June cleanup (`junk_backfill_archived_2026-06-09`) archived the 2026-05-17
batch; GOVDUP1 archived the 154. **8 remain live and the producer fired 11 days before GOVDUP1 ran.**

---

## 2. Unit 1 — find the writer, and do not repeat the search that failed

⚠️ **A `data_source`-keyed hunt structurally cannot find this producer, because it does not wear one
label.** Property **39064** (`700 technology dr`, Charleston WV, `data_source='costar_sidebar'`,
created 08-24) and **39128** (`700 Technology Dr`, South Charleston WV,
`data_source='unknown_writer'`, 08-25) are **the same Salesforce property minted twice, one day
apart, under two different sources** — and that pair is in the GOVDUP1 review lane right now. So the
husks and the duplicate pairs are **two symptoms of one producer**.

**The invariant is `pending_updates.field_name = '_new_property'` + `source_context->>'sf_property_id'`.**
Search on that, not on `data_source`, not on the address.

Already ruled out on structural grounds by GOVDUP1 — **do not re-walk these**: the SF promotion
worker / `sf_staging_dedup_prune()` (no INSERT path into `gov.properties`), the CoStar sidebar
(always stamps a real `data_source`), `auto_apply_property_links.py` (fills `property_id` on an
existing row, never inserts a property).

⚠️ **gov `CLAUDE.md` §15 says `_new_property` is a documented pseudo-field that is OUT OF SCOPE for
R-auto-apply.** Something is applying it anyway. **That contradiction is the lead, not a reason to
stop** — either a second applier exists, or the doc is stale. Say which.

Where to look beyond `api/`: Supabase **edge functions** on all three projects, **pg_cron** jobs
(`cron.job` command text — a job that posts to a handler is invisible to a repo grep), the
government-lease repo's Python, and **Power Automate flows** (a PA flow writing via PostgREST leaves
no trace in either repo — the P194 lesson: *grep for the producer in the CLIENTS, not just the repo
that used to own it*).

**Name the writer, or state plainly what you ruled out and what you could not see.** An honest
"not found, and here is the enumeration" is an acceptable Unit 1 outcome; a repeat of the same
`data_source` search is not.

## 3. Unit 2 — the dedupe key

Whatever writes `_new_property` must not mint a second gov property for an `sf_property_id` it has
already minted one for. Options, in preference order — **pick one and justify it**:

1. a **unique index** on the identity (`external_identities`-style, or a column on `properties`),
   so the collision is impossible rather than merely checked;
2. a lookup before insert, **keyed on `sf_property_id`, not on the address** — the address is
   exactly what varies (`700 technology dr` vs `700 Technology Dr`, Charleston vs South Charleston).

⚠️ **A `staging_id`-keyed dedupe is what it already has and is precisely the defect** — each staging
row carries a new `staging_id`, so uniqueness on that guarantees a fresh mint every time. **Read the
existing key before replacing it.**

⚠️ **The 220 rows still `status='pending'` are a second question.** They point at properties, some
now archived. Ask what consumes `pending_updates` and whether an archived parent can be re-activated
through one — **that is how a retired husk comes back to life.**

## 4. Unit 3 — the 8 live rows, and the 154 orphaned queue rows

- Retire the 8 the GOVDUP1 way (archive + logged batch tag), **but read them first**: two
  (`39064`/`39128`) are a genuine duplicate PAIR in the review lane, so the right disposition may be
  a **merge** (now safe — MERGE1 shipped the fold) rather than a retire. **Decide per row.**
- **GOVDUP1-c is in scope here:** the 154 `pending_updates` rows from the husk retire are all still
  `status='pending'` against archived properties. Resolve them with a reason naming the retire batch
  — never delete — and confirm nothing re-activates the parent.

---

## 5. Out of scope

- **No merges of the wider GOVDUP1 lane.** That lane is human-verdict and separate; only the
  `39064`/`39128` pair is in play here because it is this producer's output.
- **No changes to Salesforce.** LCC's SF surface is a read-only PA proxy (C1) — the fix is on our
  side of the boundary.
- **No new `data_source` value** to label this writer. Labelling it makes the census prettier and
  fixes nothing; the dedupe key is the fix.

## 6. Deliverables

1. The writer, named — or an enumeration of what was searched and what could not be seen.
2. The dedupe, with the chosen key justified against the two rejected options.
3. The 8 live rows dispositioned per row (retire vs merge), reversibly.
4. The 154 orphaned `pending_updates` resolved with a reason, plus an answer to *can a pending
   update re-activate an archived property?*
5. Guard, **mutation-verified N/N with survivors named** — and if you run no mutation pass, say so
   rather than reporting the test count as the mutation count (this has happened three times).

## 7. Verify on

- **`select count(*) from pending_updates where field_name='_new_property' and created_at > <today>`
  staying flat** after the dedupe ships — that is the producer being fixed. The 808 historical rows
  are history, not a backlog.
- **Distinct `sf_property_id` with >1 live gov property = 0.**
- The review lane's group count moving only by the `39064`/`39128` pair if you merge it.
