# Prompt 94 — W9.4: comms-harvest arm (closes the Outlook↔LCC↔SF loop, unlocks the W9.2 flip)

**Grounding:** `docs/audits/W9_CONNECTEDNESS_KICKOFF.md` (W9.4) + the LIVE W9.2 machinery
(prompt 88 — `reachability-harvest-tick`, review lane, fill-blanks writer, `comms_observed`@40
fsp rows ALREADY REGISTERED) + W7 correspondence attribution. **Design intent: W9.4 is a THIRD
ARM of the existing harvest tick, not a new unit** — extend, never fork. Landing this arm gives
the harvest real input yield, after which `W9_2_REACHABILITY_HARVEST` (still OFF) flips and one
flag runs all three arms.

**Why comms is the yield-rich source:** correspondence LCC already ingests carries (a) header
from/to/cc pairs — display name + email, deterministically bound; (b) signature blocks — the
best PHONE source anywhere in the system; (c) thread participants who are contacts-of-owners not
yet in the contact tables at all.

## Do

1. **Comms evidence index (deterministic, bounded):** from the attributed correspondence store
   (W7's activity_events/correspondence tables — ground the exact tables/columns live first),
   build a bounded name→(email, phone?, source pointer) index: header pairs (name+email exact
   from headers = deterministic class) and signature-block phones (regex phone near the sender
   name in the last N chars of body/snippet = LLM-verified class). Respect correspondence-privacy
   scoping (`docs/architecture/access-scoping-and-my-work.md`) — harvest only from
   business-attributed threads, never private-scoped rows.
2. **Route through the EXISTING two-arm split:**
   - Header name+email exactly matching a blank contact's name (normalized) → **deterministic
     proposal** (provider 'none', source pointer = message id/thread), bulk-confirmable.
   - Signature phones + fuzzy attributions → **LLM arm** with the verbatim-quote validator (the
     quote must contain the phone/email AND the name — existing dropped-log catches the rest).
   - **New-contact shape (owner has NO contact row):** where a thread participant is attributable
     to an owner entity (W7 attribution), propose CREATE-contact (name+email+source) — minted only
     via the lane, the propose-new-contact shape prompt 88 specced. Never auto.
3. **fsp/provenance:** `comms_observed`@40 rows already exist for email/phone — add any missing
   field rows for the create-contact shape in-migration; unranked view stays 0.
4. **Flip plan:** after this arm's dry-run passes review, Cowork flips
   `W9_2_REACHABILITY_HARVEST` — one flag, three arms, 04:40 cron. Batch caps per arm
   (deterministic ~100 / LLM ~15 / comms-index build bounded+cursored per the house pattern —
   and the 92/93 walk-the-pool guard applies to the new fetches).
5. **Tests:** header-pair extraction, privacy-scope exclusion, phone-regex + verbatim validator,
   create-contact-never-auto, arm routing, cursor walk.

## Acceptance

- Dry-run: per-source counts (headers/signatures/new-contact candidates) + a sampled sheet —
  deterministic header fills with message pointers, LLM phone proposals with verbatim quotes,
  create-contact proposals clearly shaped. Honest zeros where attribution is thin.
- Scott reviews → Cowork flips the W9.2 flag → nightly harvest live with all three arms.
- ROLLOUT_STATUS W9.4 row + kickoff status update; prompt to done/.

Commit with the repo Co-Authored-By + Claude-Session trailer.
