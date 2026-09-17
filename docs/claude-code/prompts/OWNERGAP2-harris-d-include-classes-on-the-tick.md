# OWNERGAP2-harris-d — expose `include_classes` on the resolve tick so the staged C2 accounts can resolve (S5 = (a)), and require the situs to match exactly

**Filed:** 2026-09-16 (Cowork), from decision **S5** (Scott: "go with your recommendation; we want
accuracy and truth — and the parcel we find must be the parcel at the county"). **Owner:** LCC
(`api/_handlers/ownergap2-owner-resolve-tick.js`, `api/_shared/ownergap2-harris-pdata-match.js`).
**Read first:** `prompts/done/OWNERGAP2-harris-c-…md` + response (PR #2541: the `includeClasses`
option exists on the matcher and the loader; nothing passes it from the route).

## State

- The stage now holds **98,804** rows for 2026: F1 68,811 + F2 2,465 + **C2 27,528** (Cowork re-ran
  the merged loader with `--include-classes C2` on 2026-09-16; 0 rows without an owner).
- The matcher treats a C2 row as `untyped` unless `includeClasses` contains `C2`; the route never sets
  it, so a live dry run cannot admit them.
- The two targets: `380 E Little York Rd` → acct `0222430000049` (C2, `380 LITTLE YORK LLC`);
  `10311 S Post Oak Rd` → acct `0440360000028` (C2, `LUEL PARTNERSHIP LTD`). `380 E Little York`
  also has a C2 sibling on the same street number? — check; if two C2 accounts share the situs, refuse.

## What to build

1. **`include_classes=C2` query parameter on the tick** (comma list, upper-cased, validated against a
   small allow-list `C2` for now), threaded to `resolveHarrisFromPdata({ includeClasses })`. Default
   unchanged (F1/F2). The response echoes `include_classes` so the ledger citation can carry it —
   add it to the citation JSON (`source_query` already names the account; add `state_class`).
2. **Exact-situs rule for admitted classes:** a C2 row resolves only on the `exact` arm (house number
   equal, street equal after the harris-b normalisation, suffix agreeing when both present). Range and
   containment arms are for F1/F2 only. Scott's parcel concern is the reason: a vacant-lot account
   next door must not be taken for the clinic's parcel.
3. **Tests:** the parameter parses and validates; a C2 row resolves on exact and refuses on a range
   match; F1/F2 behaviour byte-identical with the parameter absent; the citation carries `state_class`.
4. Cowork runs the live dry run with `include_classes=C2` (expect 2 resolved of the 29 still open),
   Scott reads, Cowork applies.

## Prohibitions

- ⛔ No nearest-number matching; the 27 situs-gap properties stay refused until §P10a gives them a
  parcel discriminator. ⛔ No change to the loader. ⛔ Redeploy both Railway services and confirm `/version`.
