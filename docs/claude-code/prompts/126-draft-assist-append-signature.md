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

## Canonical signatures — use the REAL branded HTML assets (not plain text)

Scott's signature is branded HTML (Futura PT font, Northmarq blue `rgb(0,61,165)`, styled D/E/A layout), NOT
plain text — extracted verbatim from his own sent `.eml`s and saved to the repo:

- **`docs/os/voice/signatures/signature-reply.html`** — the COMPACT reply signature. **Self-contained, NO logo
  image** (no `cid:`), so it renders correctly appended to any generated draft with zero image dependency.
  ⚠️ This file was extracted with a loose lower boundary (~9.7 KB) — **trim it to the signature block only**
  (ends after the `sabriggs@northmarq.com` line; drop any trailing quoted content) before using.
- **`docs/os/voice/signatures/signature-full.html`** — the FULL new-email signature. Branded, and it carries
  the Northmarq **logo as a `cid:` inline image** — that reference BREAKS in a generated draft. To use it,
  host `docs/os/voice/signatures/northmarq-logo.png` at a stable public URL and replace the `cid:…` `src` with
  that `https://` URL; if no host is available, strip the `<img>` and keep the styled text.
- **`docs/os/voice/signatures/northmarq-logo.png`** — the logo bytes (4.2 KB) for hosting.

**Rule (matches Scott's practice):** replies (`in_reply_to != ''` — external_follow_up / internal_coordination
/ loi_offer) → **signature-reply.html**; new/cold (`in_reply_to == ''` — cold_bd_outreach /
listing_announcement) → **signature-full.html**. Ambiguous → default to the reply block. Store the chosen HTML
as an asset/config draft-assist reads; append it verbatim (item 3: once, above the quote). Never re-type or
fabricate the contact details — the phone/address/title must come from these files exactly.

## Close-out
- Handler change ships on the Railway redeploy of merged `main` → `npm run verify:deploy`. If a stored
  signature asset/config is added, register it. Update STATUS + the draft-assist design doc. Provide the
  canonical signature text for Scott to confirm before it's the default.
