# ENTC — two entity-hygiene fixes: retire the 80 junk-named person entities (junk80), and fix or retire `lcc_p195_unmerge` (p195-unmerge)

**Repo: `life-command-center`.** Target **LCC Opps `xengecqvemvfknjvbvrq`**. Two halves, one topic.
Half B is small and sharp; Half A is a reversible sweep whose retirement PATH you must choose from
the existing machinery and justify — never a hard delete.

**Read first:** `docs/architecture/entity-identity-and-dedup.md` (§1–§3, §5) → backlog
**PR5c-entities-c-junk80** and **PR5c-entities-c-p195-unmerge** →
`docs/audits/PR5c_entities_c_review_oldest_2026-09-03.md` (the 26/193 read, the 80-row census, the
fingerprint round trip) → `CLAUDE.md` § "TrafficMetrix table-as-contact-list misparse" (the
`junk_entity_review` / `unstampMisparseMember` machinery — a DIFFERENT class, whose path you must
evaluate rather than assume) and § P176 (closing an item is not closing a lane — **find the seed
predicate**).

## Half A — junk80

The 80: live person-typed entities whose name fails the junk guards (vendor party-slot labels,
P131 document row labels — `Income & Expenses`, `--`, etc.) and which hold a non-generic email.
30 carry a Salesforce identity (21 named `--`); 37 are alone on their mailbox; **0 in
`junk_entity_review`, 0 carry `metadata.junk_name_flagged`** — invisible to both existing lanes.

1. **Re-derive the 80 with a stated predicate** and freeze it as a view
   (`v_lcc_entities_c_junk80`), with per-row: name, email, SF identity, edges, portfolio facts,
   pivot rows, whether anything downstream reads it (owner_contact_pivot.active_contact,
   cadences, Tier 0 cards). A row something POINTS AT is a repoint question, not a retire.
2. **Find the producers** — what minted them (RCA/CoStar party slots? P131? sidebar?) and does it
   still run? A retire without the producer gate is P176's chore-repeated-forever. If the producer
   is live, gate it in the same change (refuse a junk-shaped name + email combination at the mint,
   through the existing shared guards — no new name regex).
3. **Choose the retirement path from what exists** and say why: (a) route into
   `junk_entity_review` as a new `reason` (human-confirm, existing verdict machinery, existing
   reversibility) — but check the verdict path's effects fit this class
   (`unstampMisparseMember` clears email + detaches identities, which IS what these need if the
   email belongs to a real person elsewhere); or (b) soft-retire directly
   (`metadata.junk_name_flagged` + tombstone pattern) with a batch tag. **Bias to (a)** unless the
   census shows a reason not to — these hold real emails that the email tier can attach an inbound
   person to, so clearing the email/identity is the harm-stopping half.
4. **The 30 with SF identities and any row with inbound references get the review lane
   regardless** — never bulk-retired.
5. Verify: the email tier's exposure falls — re-run the audit's Q1 (26 junk-oldest mailboxes) and
   the 37-alone count after the sweep's dry run; both should go to ~0 **in the dry-run's
   projection**, quoted before any apply. Reversible by batch tag; nothing hard-deleted.

## Half B — p195-unmerge

`lcc_p195_unmerge` re-INSERTs snapshotted rows; `trg_lcc_entity_rel_resolve_survivor`
(BEFORE INSERT) silently skips a row that duplicates one the winner already holds, so byte-identical
edges strand while the function reports `restored`. `lcc_unmerge_entity` (P196) handles it (UPDATE
surviving rows, INSERT only the deleted).

1. **Decide fix vs retire, and say why.** The honest question: does `lcc_p195_unmerge` have any
   caller or any capability `lcc_unmerge_entity` lacks? Grep callers (code + crons + docs). If it
   is a strict subset → **retire it**: make its body delegate to `lcc_unmerge_entity` (or raise
   with a pointer), so the broken path cannot be reached — a second unmerge implementation is the
   normaliser-drift class. If it has a real distinct capability, fix the re-insert to the P196
   pattern (UPDATE survivors, INSERT deleted) instead.
2. **Prove with the fingerprint round trip** (the audit's method — identity-keyed, never
   count-keyed) on the same Harrison pair, rolled back: 0 lost / 0 stranded / 0 changed through
   the surviving path.
3. Guard: a test that runs the round trip shape (or asserts the delegation), mutation-verified.

## Verify on

- junk80: the census view · producer named + gated or shown dead · path chosen with the reason ·
  dry-run projection (Q1 26 → ~0, alone-37 → ~0) · 0 hard deletes · SF/inbound rows in review not
  bulk.
- p195-unmerge: caller census · the decision · fingerprint round trip 0/0/0 · guard RED on mutation.
- Drift 0; blind pairs re-measured (some of the 55 contain junk rows — say how many the sweep
  removes); `v_lcc_entities_c_review_merge_plan` unaffected (the 15 are real people).

## What NOT to do

- No hard deletes; no new name-shape regex (use the existing shared guards); no merges; no touch of
  `ensureEntityLink` (the tier fix is done; the gate was refused); do not run the sweep's apply if
  the dry run surprises — report instead.

## Report back

The 80-row census with downstream references · producers + gates · the path and its reason ·
dry-run projection · the p195-unmerge decision + round trip · blind-pairs delta · anything that
outranks this.
