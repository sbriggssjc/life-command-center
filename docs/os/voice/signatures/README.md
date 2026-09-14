# Scott Briggs — canonical email signature assets

These files are the **single stored source** `/api/draft-assist` appends to a generated draft
(`api/_shared/email-signature.js`, Prompt 126). They are **configuration, not generated content**.

| File | Used when | Contents |
|---|---|---|
| `signature-reply.html` | `in_reply_to != ''` — the draft is a REPLY | Compact block: name · title · Northmarq · D/E line. Self-contained, **no logo, no `cid:`**. |
| `signature-full.html` | `in_reply_to == ''` — a NEW thread | Full block: name, title, Commercial Investment Sales, D/E/A rows (incl. the Tulsa address), service-line tagline, northmarq.com. |

Ambiguous ⇒ the **reply** block (it asserts strictly less and is never wrong to send).

## Rules

- **Never re-type these, and never fabricate a detail.** Both were extracted **verbatim** from Scott's own
  top-posted signature in LCC Opps `email_bodies.body_html` (2026-08-25) — the same bytes an `.eml`
  extraction yields. A contact detail must be exact or absent.
- **Never add a `cid:` or remote `<img>`.** A `cid:` reference points at an attachment part of the message it
  was copied from; a generated draft has no such part, so it renders broken on every send. A `data:` URI is
  not a substitute (Outlook desktop blocks them). To use the Northmarq logo, host it at a stable public
  `https://` URL and add the `<img>` deliberately — noting that a remote image turns every send into a read
  receipt for the recipient.
- **The address belongs to the FULL block only.** Measured over Scott's 592 signature-bearing sent messages of
  the last 120 days, the top-posted **reply** block carries the street address **0 times**. Do not "fix" the
  reply block by adding it — `docs/os/skills/offer-submission-SKILL.md` describes the offer-submission block,
  which is the full one.
- **The loader SANITIZES these files — it does not trust them (Prompt 127).** `loadSignatureHtml` runs every
  source (both env overrides included; there is no trusted branch) through
  `api/_shared/html-sanitize.js::sanitizeSignatureHtml`, a tokenizing sanitizer that rebuilds the block from a
  tag/attribute **allowlist**: `<script>`/`<style>`/`<iframe>`/`<form>`/`<svg>` go with their content, `<img>`
  and `<link>` go outright, `on*=` handlers and any non-`http(s)`/`mailto:`/`tel:` URL are dropped, `url(` /
  `@import` / `expression(` styles are dropped, and everything at or after a quote boundary (`appendonsend`,
  `divRplyFwdMsg`, `gmail_quote`, `WordSection`, a `From:`/`Sent:` header, `On … wrote:`) is cut. This exists
  because the assets P126 merged were **not clean** — `signature-reply.html` shipped at 12.7 KB carrying a
  whole LinkedIn notification email, four tracking pixels and a broken `cid:` logo below the real block, and
  the loader would have stapled all of it onto every reply draft. The rules above are now enforced, not just
  documented — but they are still the rules: **keep these files clean anyway.** The sanitizer is the net, not
  the standard.
- **It fails toward LESS signature, and it says so.** A block that cannot be made safe — over
  `MAX_SIGNATURE_BYTES` (8 KB) after cleaning, or nothing but removable content — returns nothing, so
  draft-assist reports `signature.status = "not_configured"` and appends **nothing**. Every removal is
  reported on the dry run as `signature.sanitized_removed` (and `sanitize_rejected`) and warned once per
  process on stderr. **`sanitized_removed: []` is the only healthy value** — anything else means these bytes
  are dirty and the draft is clean only because the loader caught it.
- The HTML comment header of each file is **stripped at load time** and never reaches a recipient.
- Editing a file ships it on the next Railway redeploy. `DRAFT_ASSIST_SIGNATURE_REPLY_HTML` /
  `DRAFT_ASSIST_SIGNATURE_FULL_HTML` (or the shared `DRAFT_ASSIST_SIGNATURE_HTML`) override it without one.
  Delete or blank a file and draft-assist appends **nothing** and reports `signature.status =
  "not_configured"` — it never falls back to a guess.

## Not stored here

`northmarq-logo.png` — the 4,221-byte logo referenced by his real full block. It is a `cid:` attachment part,
not something `email_bodies` retains, so it is not in this directory. It is only needed if the logo question
above is answered yes.
