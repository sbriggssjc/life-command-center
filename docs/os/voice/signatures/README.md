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
- The HTML comment header of each file is **stripped at load time** and never reaches a recipient.
- Editing a file ships it on the next Railway redeploy. `DRAFT_ASSIST_SIGNATURE_REPLY_HTML` /
  `DRAFT_ASSIST_SIGNATURE_FULL_HTML` (or the shared `DRAFT_ASSIST_SIGNATURE_HTML`) override it without one.
  Delete or blank a file and draft-assist appends **nothing** and reports `signature.status =
  "not_configured"` — it never falls back to a guess.

## Provenance + the trim that mattered

Both files are Scott's own `.eml` extractions (committed to `main` 2026-08-25), used verbatim except:

- **`signature-reply.html` was trimmed 9,641 → 1,546 bytes.** The extraction ran past the block and carried
  the QUOTED MESSAGE below it — an Outlook `divRplyFwdMsg` boundary, a whole LinkedIn notification email
  ("Brandon Sherrill recently posted…", 2026-08-24) and its **four tracking `<img>` tags**. Appending that
  untrimmed would have pasted a third party's LinkedIn post and four tracking pixels into every reply Scott
  sends. The block ends after the `sabriggs@northmarq.com` line; everything after is dropped.
- **`signature-full.html` lost its logo cell** (see below). Its extraction was otherwise already clean.

Both were cross-checked against LCC Opps `email_bodies.body_html` and are byte-consistent with his live block.

## `northmarq-logo.png`

The 4,221-byte logo his real full block references as `<img src="cid:bc8c8e3e-…">`. A `cid:` points at an
attachment part of the message it was copied from, so it cannot ship in a generated draft — the whole `<td>`
was removed (not just the `<img>`: that cell carries the blue `border-right` divider, so stripping only the
image leaves a stray floating rule).

**To restore it — a deliberate decision, not a default.** `server.js` serves the repo root via
`express.static`, so the file is reachable at
`https://<the-Railway-host>/docs/os/voice/signatures/northmarq-logo.png`. Re-add the cell with that `https://`
src, or set `DRAFT_ASSIST_SIGNATURE_FULL_HTML` to override without a redeploy. Accept two consequences first:
every recipient's mail client then fetches an image from the LCC app on open (a read receipt for us, a
tracking beacon for them), and if that host is renamed or sleeps, every already-sent email shows a broken
logo forever.
