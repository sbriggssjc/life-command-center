# Prompt 93 — two micros: donor-handoff treadmill + the Aug-10 unstamped bulk path

## A. Donor handoff scans the same window nightly (4th walk-the-pool instance)

**Grounding (live):** `sf-donor-handoff-tick` succeeded 3 nights straight but stamped 14 on night
one and **0 since** (gov stuck 19, dia 15). Its scan window is a fixed slice (dry-run showed 480
blank contacts of 10,542 scanned) with no cursor — after night one exhausted that window's unique
matches, it re-scans the same slice forever. Same class as prompts 83/84/92.

**Do:** keyset cursor (or scanned-marker) so nightly runs walk the full blank-contact pool;
surface cursor + `windows_wrapped` in the response; on wrap, restart (new links from re-score can
create matches in previously-scanned windows — a full wrap cycle is the re-check). If prompt 92
shipped the shared "tick must exclude/advance past its own output" structural helper, extend it
here; if it didn't, BUILD it now and apply to all four instances (junk scan, hygiene scan, sf
assist, donor) — this class must stop recurring.

## B. The Aug-10 bulk extraction path bypasses the provider stamp

**Grounding (live):** daily stamp coverage post-82: Aug 9 1/1, **Aug 10 9/72** (a 72-row burst,
63 unstamped), Aug 11 11/13. Prompt 82's write-site re-assertion covers `processIntakeExtraction`,
but the Aug-10 burst came through a path that doesn't hit it (candidates: the SF file-discovery
drain worker, a re-extract/backfill sweep, an edge-function writer). W5.3's re-grade addendum
(2026-08-11, in the W5_3 report) validates the hardened prompt but needs complete attribution.

**Do:** identify the Aug-10 burst's writer (raw_payload/channel forensics on those 63 rows), route
it through `ensureProviderStamp`, extend the 82 structural guard to cover it (the guard passed
while this path escaped — find why: different repo? edge fn? dynamic write?). Also re-check the
`sold_*` key drift seen on 2/4 stamped OM rows while in there (the no-sale-keys rule may need a
strip at the same write site).

Acceptance: donor coverage resumes climbing (or honestly reports pool-exhausted-until-wrap);
next bulk extraction burst stamps 100%; structural guard covers the discovered path.
Commit with the repo trailer.
