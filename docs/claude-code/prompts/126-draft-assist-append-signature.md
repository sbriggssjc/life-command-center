# Prompt 126 — draft-assist should append Scott's standard email signature block

**Status:** DRAFT 2026-08-21 (Cowork; observed on the first live threaded draft-assist saves)

Grounding: `api/draft-assist.js` (generates `body_html` + a short sign-off), `api/_shared/outlook-draft.js`
(seam → PA flow), `BRIGGS-WRITING-VOICE.md` v3, the voice corpus (Scott's sent emails consistently carry his
block: *"Best regards, Scott Briggs · Senior Vice President · Northmarq · D (9…) …"*). Doctrine: never fabricate
contact details; save-not-send; honest about what's grounded.

## The gap (live 2026-08-21)

The first real threaded draft-assist saves are correct on voice, grounding, and threading — but the draft body
ends at the sign-off (e.g. "…Thanks.") with **no signature block**: no name/title/company/phone. So the draft
isn't send-ready as-is; Scott would hand-add his signature every time, which defeats the point.

## The ask

1. **Append Scott's canonical signature block to the generated `body_html`**, once, below the sign-off, so a
   saved draft is send-ready. It should render as his normal Outlook signature.
2. **Source it conservatively — never fabricate.** Prefer a single stored/configurable canonical signature
   (an asset or a `feature_flags_registry`/config value Scott confirms once) over parsing it out of sent mail
   (which varies and would risk a wrong phone/title). If a stored signature isn't configured, append nothing
   and say so in the response (`signature: "not_configured"`) rather than inventing one. Contact details
   (direct line, title) must be exact or absent.
3. **Don't double-sign.** draft-assist already emits a sign-off line ("Best regards,"/"Thanks."). The block
   goes AFTER it, exactly once — detect and avoid appending if a signature is already present.
4. **Preserve threading + quote.** The signature goes at the end of Scott's NEW text, ABOVE the quoted thread
   history that the reply draft carries (P125/v6) — never below the quote.
5. **Verify:** a saved reply ends with Scott's real signature block once, the quoted thread remains beneath it,
   `threaded=true`, nothing fabricated, Sent empty.

## Canonical signatures (provided by Scott 2026-08-21 — use these verbatim, do not fabricate)

Context-aware: **replies get the compact block, new/cold emails get the full block** (matches Scott's actual
practice). The Northmarq logo image is Outlook-side; render the text form (no cid/hosted image needed).

**Reply (compact) — for `in_reply_to != ''` / `external_follow_up` / `internal_coordination` / `loi_offer`:**
```
Scott Briggs
Senior Vice President · Northmarq
D  (918) 794-9787  |  E  sabriggs@northmarq.com
```

**New email (full) — for `in_reply_to == ''` / `cold_bd_outreach` / `listing_announcement`:**
```
Scott Briggs
Senior Vice President
Commercial Investment Sales
D  (918) 794-9787
E  sabriggs@northmarq.com
A  6120 S. Yale Ave., Ste. 300, Tulsa, OK 74136
Commercial Real Estate | Debt + Equity | Investment Sales | Loan Servicing | Fund Management
northmarq.com
```

These are now "configured" per item 2 — append the matching block; never invent contact details, and if the
purpose→block mapping is ambiguous, default to the compact reply block.

## Close-out
- Handler change ships on the Railway redeploy of merged `main` → `npm run verify:deploy`. If a stored
  signature asset/config is added, register it. Update STATUS + the draft-assist design doc. Provide the
  canonical signature text for Scott to confirm before it's the default.
