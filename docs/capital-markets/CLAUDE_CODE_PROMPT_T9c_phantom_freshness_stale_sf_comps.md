# Claude Code prompt — T9c: stop phantom-freshness on SF-recovered comps + close the stale no-live-signal listings

> The other half of the zombie problem (T9b fixed the sold-property half). T9b couldn't touch these because
> they have NO sale. Grounded: 163 dia "active" listings are **T4c SF-recovered comps** (on-market 2017-2024,
> median DOM ~6.4yr) kept "current" ONLY by a phantom `last_seen` the SF harvest stamped — not a real
> on-market check. They anchor the T9 sticky asking-cap quartiles. **Scott chose the structural fix (no SF
> round-trip):** stop the phantom freshness + close them at their last genuine signal, reversibly. dia
> `zqzrriwuavgrquhisnoa`. Reversible (backup); no fabricated *entry* dates; EXIT-side only. ≤12 api/*.js.

## Receipts (grounded live 2026-06-26, dia `available_listings`)
- **337** listings have `on_market_date_source='sf_on_market_date'` (the T4c recovery). **ALL 337** carry
  `last_seen` = 2026-05-17 … 06-23 — i.e. the **SF harvest stamped `last_seen` on every one**, though only
  **1** has a URL and only **1** was ever `url_last_checked`. `last_seen` ≠ `last_verified_at` (1/337 equal),
  so `last_seen` is the harvest's phantom touch, NOT a feed/URL check.
- **163** of them are `status='active'` + `off_market_date IS NULL`, `data_source IS NULL`, no URL, never
  url-checked, on-market 2017-2024. **164 carry a cap rate** → they anchor the asking-cap quartiles (the T9
  stickiness; T9b's sold-close couldn't reach them — no sale). **11** leak into the canonical 2026-03 count
  (122); the other 152 are excluded only because their **fake `listing_date` > 2026-03** already fails the
  date gate.
- **The currency gate is what they fool:** `cm_dialysis_active_listings_m` treats a listing as current when
  `COALESCE(last_seen, url_last_checked, last_verified_at, listing_date) >= period_end - 120 days`. The
  phantom `last_seen` (and, for the others, the fake `listing_date`) satisfies it → 2017-2024 comps pass as
  "on the market now."

## Unit 1 — stop the phantom freshness (prevent recurrence)
The SF on-market harvest / apply path (whatever sets `on_market_date` + `on_market_date_source='sf_on_market_date'`
on dia `available_listings` — trace it; likely the T4c sync/apply, LCC-side or dia-side) must **NOT write
`last_seen` or `last_verified_at`**. Those columns are reserved for GENUINE availability signals (a live feed
capture / a URL probe) — recovering a historical entry date is not a current on-market verification. Remove
that stamping from the harvest. Then **clear the phantom `last_seen`** on the existing SF-recovered rows where
it was set by the harvest and there is no genuine capture (no URL, `url_last_checked` IS NULL, `data_source`
IS NULL), so the currency gate stops treating them as current. (Back up prior values first.)

## Unit 2 — close the stale no-live-signal SF comps (the 163)
Close every listing that is `status='active'`, `off_market_date IS NULL`,
`on_market_date_source IN ('sf_on_market_date','unestablished_historical')`, has **no live signal** (no
`listing_url`/`url`, `url_last_checked IS NULL`, `data_source IS NULL`), and is on-market beyond a
market-typical max DOM. Set `off_market_date` to:
- a **real** signal where one exists — a clean market sale on the property (`off_market_reason='sold'`,
  off_market_date = the sale date), else
- an **inferred** date = `on_market_date` + a market-typical max-DOM cap (derive it from the data — e.g. the
  p90 of genuinely-closed dia listing DOM, or 18 months; pick one and state it), **never in the future**,
  `off_market_reason='withdrawn_inferred_stale'`, with a `notes` flag that the date is inferred. Set
  `status='off_market'` (or `withdrawn`).
- **Preserve anything genuinely current:** do NOT close a listing that has a real URL check, a real feed
  `last_seen`, a live `data_source` capture, or a plausibly-current short DOM. The target is specifically the
  no-live-signal historical SF comps. Report the count closed and the count preserved.
- Do NOT touch `on_market_date` / its source (T4c entry side) — only `off_market_date`/`status`/`off_market_reason`.
- Back up prior (status, off_market_date, off_market_reason, last_seen, notes) to a `t9c_*` table for revert.

## Unit 3 — verify (report before/after)
- **0** no-live-signal SF comps remain `status='active'` + `off_market_date IS NULL` on-market beyond the cap.
- **Asking-cap quartiles** (`cm_dialysis_asking_cap_quartiles_active_m`) — report the pool size + quartile
  values before/after; the T9 stickiness should finally ease (the 164 cap-anchors leave the recent pool).
- **Canonical available count** (`cm_dialysis_active_listings_m` @ 2026-03) — report before/after (expect
  ~122 → ~111 as the 11 leakers drop); confirm the remaining set is genuinely current.
- **Active-pool DOM median** — should fall further from ~1,331d.
- Confirm no genuinely-current listing was closed (spot-check the preserved set).

## Gate
- Harvest no longer stamps `last_seen`/`last_verified_at` (Unit 1); phantom `last_seen` cleared on the
  affected rows; 163-class closed with real-or-inferred dates (flagged); genuinely-current listings preserved.
- Before/after reported (quartiles, canonical count, DOM). Reversible (`t9c_*` backup). No fabricated entry
  dates; inferred exit dates flagged. dia only; EXIT-side only; ≤12 api/*.js.

## Boundaries / surfaced
- EXIT-side only — `on_market_date` and the T4c recovery are untouched; `listing_date` stays raw/audit.
- **Surfaced latent issue (note, don't necessarily fix here):** the canonical currency proxy trusts
  `listing_date`, which can carry a fake `capture_date_fallback` (2026-06) — so a fake `listing_date` is a
  second way a stale comp can pass the gate. Closing the rows (Unit 2) neutralizes the current set; if you
  want belt-and-suspenders, consider keying the currency proxy on `on_market_date` (authoritative) rather
  than `listing_date`/`last_seen`, but that's a broader view change — flag it for Scott rather than bundling.
