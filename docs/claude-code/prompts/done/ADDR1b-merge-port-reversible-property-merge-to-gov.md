# ADDR1b-merge — gov's only property merge is a HARD DELETE; port dia's reversible one before any gov dedup

**Repo: `life-command-center`.** Target **gov `scknotsqkcheojiaewwh`**, modelled on
**dia `zqzrriwuavgrquhisnoa`**. **A safety prerequisite, not cleanup.** gov has 13,837 properties, a
phantom-property class seen twice this week on dia, and no way to merge one without destroying data.
Until this lands, gov's only safe disposition for a phantom is quarantine.

**Read first:** **`docs/architecture/costar-sidebar-capture-pipeline.md`** (the producer, and §2's
arc — the phantom class is a CoStar-capture artifact, so gov is exposed to it too) → backlog
**ADDR1b-merge**, **ADDR1b** → the dia source of truth: `dia_merge_property_reversible` /
`dia_unmerge_property` / `dia_property_merge_backup`, and the `property_twin` Decision Center lane
they feed (`CLAUDE.md` § "dia property address twins") → `CLAUDE.md` § P196 (what made the ENTITY
merge reversible, and the trap that nearly made the reversal a lie).

## The measured problem

Confirmed live 2026-09-04:
- **`gov_merge_property_reversible` does not exist.**
- **`gov_merge_property` exists and is a hard delete with no snapshot.**
- dia's `dia_merge_property_reversible` walks every FK to `properties`, repoints each, snapshots the
  dropped row, and is reversed by `dia_unmerge_property(backup_id)`.

**It has earned its keep twice in one week.** 37491 → 35722 brought home 1 sale + 3 listings;
**37503 → 38953 brought home 1 sale, 1 listing, 7 leases, 1 deed record and 1 property doc.** I could
only see the sale and listing before the merge — the seven leases were invisible. **A hard delete
would have destroyed them silently.**

## Build

1. **Read `dia_merge_property_reversible` and enumerate what it does**, then enumerate gov's FKs to
   `properties` independently (`pg_constraint`, not the dia list — the schemas differ: gov has
   leases, deeds and GSA-specific tables dia does not, and lacks some dia has). **The FK census is
   the whole job; a merge that misses one FK strands rows exactly as the entity-merge path did
   before P160.** Report the two FK sets side by side and say which gov tables are new.
2. **Port the shape, not the text.** `gov_merge_property_reversible(keep_id, drop_id, batch_tag)` +
   `gov_unmerge_property(backup_id)` + `gov_property_merge_backup`. Match dia's semantics:
   snapshot BEFORE any mutation; repoint every FK; return a per-table count of what moved; never
   hard-delete without the snapshot.
3. ⚠️ **Two traps P196 paid for on the ENTITY merge — check both here:**
   - **A `BEFORE INSERT` trigger that SKIPS a row silently defeats `ON CONFLICT DO UPDATE`.** If gov
     has survivor-resolution or dedup triggers on any repointed table, a restore may report
     `restored` while stranding rows. **Repoint a surviving row with `UPDATE`; INSERT only what was
     deleted.**
   - **Verify the round trip with an identity-keyed FINGERPRINT, never a row count.** `lcc_p195_unmerge`
     reported success while stranding byte-identical edges, and the row count was identical in both
     runs — only the fingerprint exposed it.
4. **Run the round trip on a real gov pair, rolled back**: merge → unmerge → compare fingerprints.
   **0 lost / 0 stranded / 0 changed.** A reversal path that has never been exercised is a claim.
5. **Do not merge anything for real in this prompt.** Property 9893 is already quarantined and is
   fine where it is; re-dispositioning it is a separate call once the machinery exists and is proven.

## Then, only if the above is green

Say whether gov should also get the **`property_twin` review lane** dia has (the geospatial
address-twin detector + human-confirm merge). **Size it — do not build it**: how many gov properties
would a dia-equivalent twin detector surface? If the number is small, say so and stop; a review lane
with three rows is not worth a Decision Center surface.

## Verify on

- The two FK sets side by side, with gov's additions named.
- `gov_merge_property_reversible` / `gov_unmerge_property` / `gov_property_merge_backup` exist, with
  per-table move counts returned.
- The rolled-back round trip: fingerprint identical, 0 stranded.
- **`gov_merge_property` (the destructive one) is dealt with** — either deleted, or made to raise
  with a pointer to the reversible one. **Leaving a hard-delete merge callable beside a safe one is
  how the wrong one gets used** (the `lcc_p195_unmerge` shape). Say which you chose and why.
- `npm test` unchanged.

## What NOT to do

- Do not merge any real gov property. Do not re-disposition 9893. Do not port dia's FK list without
  re-deriving gov's. Do not build the twin lane — size it only.

## Report back

The FK comparison · the functions with their move counts · the fingerprint round trip · what
happened to `gov_merge_property` · the twin-lane sizing · anything that outranks this.
