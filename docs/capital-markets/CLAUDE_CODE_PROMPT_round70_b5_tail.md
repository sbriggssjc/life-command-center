# Claude Code prompt — Round 70 resume: B5 tail + terminated heuristic (receipts-first)

> Fresh-session resume of Round 70 Layer B (prior session: PR #1083, ~11 commits —
> Layer A, D6, D10+clamp, B2, the over-stamping chain, G17 verdict, D7=B2 all
> landed and verified). Same discipline: one receipts table + verdict per item;
> fix only with receipts; view changes live with before/after; bulk writes
> dry-run → verification gate. Layer C (formatting) is a separate session.

```
1. G27 — gov NM line: per-quarter n of NM vs non-NM sold-with-cap; verdict:
   thin-vs-construction. (7b added +15 NM flags; the n>=3 gate renders what it
   can — determine if anything renderable is still dropped.)
2. G29 — gov rent-by-year-built 2017+: per-year-built n of leases with rent;
   fixable propagation vs genuine-sparse. (The 9999-sentinel + n>=8 gate from
   Task 6 already landed; this is about the 2017+ vintages specifically.)
3. D13 — dia pre-2010 mechanical movement: per-year n of pre-2010 sales feeding
   the series; if the "mechanical" look is interpolation/smoothing over n<5,
   gate or annotate — do not fabricate.
4. D11/D12/G37 — the three remaining "data gaps" notes: identify each chart
   (June-6 doc images 11/12/37), one receipts table each, fix-or-document.
5. Terminated snapshot-disappearance heuristic (A3 tail): detect gsa_snapshots
   leases that vanish before lease_expiration (true early terminations, vs the
   firm-term termination_date field). Per-period n table FIRST; only then
   propose the view change for the Lease Renewal/Termination charts (deck
   target magnitude: ~3 true terminations TTM at 2024-Q2 vs 5-yr avg 107).

Per-item: before/after at Dec-2025 in the PR (continue #1083 or a fresh PR if
that one merges first).
```
