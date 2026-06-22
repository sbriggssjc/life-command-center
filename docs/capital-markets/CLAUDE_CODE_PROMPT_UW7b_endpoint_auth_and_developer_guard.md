# Claude Code prompt — UW#7b: developer-resolve endpoint auth + person-name guard

> Two fixes from the UW#7 live gate (2026-06-21). The resolver logic is sound (the gov chain-walk
> view is right, 35/764 honest sizing), but the gate found (1) the worker endpoint isn't reachable
> for a gated dry-run, and (2) the build-to-suit path would write some non-developer origins.
> Receipts-first; conservative; fill-blanks; no fabrication.

## Fix 1 — endpoint auth (so the drain is gateable like the others)
`POST/GET /api/developer-chain-resolve-tick` returns **401** to the page session, while
`document-text-tick` and `lease-backfill` return 200 (the page's `X-LCC-Key` interceptor authorizes
them). Align `developer-chain-resolve-tick` to accept the **same page/user `X-LCC-Key` auth** the
other worker sub-routes use, so the gated **dry-run → verify → drain** can be driven from the app
session (not cron-only). Keep the cron path working too.

## Fix 2 — reject person-name + financier origins on the developer path
The live view sample showed build-to-suit origins that are NOT developers and would be written by
Tier A: person names like **"SEVDE MARGUERITE"** and **"Gary Brown"** (these are the original
*landowner* who sold to the developer, not the developer), and net-lease financiers like **"Capital
Lease Funding AKA VEREIT"** (a REIT). A developer is an **organization**, not an individual.
- On the developer-resolution classifier, **reject person-name origins** — reuse `looksLikePersonName`
  / require an org-shaped name (firm suffix or org token), so an individual at the chain origin is
  NOT written as `developer`. Those route to "stays queued / needs research," not a developer write.
- Confirm the existing "origin is a bank/REIT/insurer/agency → not a developer" bucket actually
  catches financiers like VEREIT / "Capital Lease Funding" (extend the reject list if not).
- Keep the placeholder ("Previous Owner") + attribution-leak guards already added.

## Gate (after the auth fix lets me run it)
- `GET /api/developer-chain-resolve-tick?domain=gov` (dry-run, now 200) returns the resolvable set,
  and I verify **every** resolved origin is a real developer ORG — no person names, no REIT/financier
  shells. The count drops from the prior 35 by however many were person/financier false positives —
  that's correct, not a regression.
- Then a capped POST drain writes `developer` (fill-blanks, provenance `chain_resolution`), task →
  completed only when written, 0 clobbers, idempotent; resolved developers appear as BD org entities.
- dia stays deferred (thin signal, no is_build_to_suit) per the original UW#7 scope.
