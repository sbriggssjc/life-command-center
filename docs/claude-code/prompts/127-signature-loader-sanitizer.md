# Prompt 127 — Sanitize the signature at load time (a dirty asset must never reach a draft)

**Status:** DRAFT 2026-08-24 (Cowork-caught during the P126 live reconcile)

Grounding: `api/_shared/email-signature.js` (`loadSignatureHtml` → today only `stripHtmlComments` + `.trim()`),
`docs/os/voice/signatures/signature-reply.html` / `signature-full.html` (the runtime assets), the P124/125
save path. Doctrine: "the failure that matters looks like success"; never let un-vetted content reach a
recipient.

## What happened (measured 2026-08-24)

The committed signature assets draft-assist reads at runtime were **dirty**: `signature-reply.html` was 12.7 KB
and carried a **LinkedIn notification email + 4 tracking-pixel `<img>` tags + a broken `cid:` logo** *below*
the actual signature (an over-capture from the source `.eml`); `signature-full.html` carried 3 `cid:` logos +
tracking imgs. `loadSignatureHtml` only strips HTML comments, so `appendSignature` would have stapled a
LinkedIn email and tracking pixels onto **every reply draft** — invisible in the JSON envelope, visible only
when the mail was opened. P126's own tests passed because they ran against CC's trimmed branch copies, not the
bytes that actually merged. **Cowork hand-authored clean, balanced replacements** (reply 1.7 KB / full 5.1 KB,
0 `<img>`, 0 LinkedIn/quote leak, phone+email+address+tagline intact, branded fonts/colors) — but the loader
is still the single point where a future dirty asset leaks.

## The ask

1. **Sanitize in `loadSignatureHtml` (defense-in-depth, the real fix).** Before returning signature HTML:
   strip `<img>`, `<script>`, `<link>`, `<style>`, `<iframe>`, and any `on*=`/`javascript:` handlers; drop
   anything at/after an Outlook quote or forward boundary (`id="appendonsend"`, `divRplyFwdMsg`, a
   `From:`/`Sent:` header block, `WordSection`); keep only the signature block's safe styled markup. A dirty
   asset must degrade to a clean signature, never leak. Comments already stripped — keep that.
2. **Bound + assert size/shape.** Reject/trim absurd inputs (a real signature is < ~8 KB); log a warning when
   sanitize removes content so a dirty asset is *observable*, not silent.
3. **Re-verify the committed assets** with an HTML parser (not regex): both are well-formed, balanced,
   `<img>`-free, contain the exact contact facts (918 794-9787 / sabriggs@northmarq.com / the Tulsa address on
   FULL only), and render as the branded block. Keep Cowork's hand-authored files if clean; otherwise
   re-extract from `email_bodies.body_html` with a parser and the same guarantees.
4. **Test the leak directly:** feed a deliberately dirty asset (LinkedIn email + tracking `<img>` appended)
   through `loadSignatureHtml`/`appendSignature` and assert the output has no `<img>`, no `linkedin`, no quoted
   header — i.e., the exact bytes that shipped in P126 would now be neutralized.

## Close-out
- Handler change ships on the Railway redeploy of merged `main` → `npm run verify:deploy`. Update STATUS + the
  draft-assist design/signature docs. Until this ships, the safety rests only on the assets being clean (they
  are now), so it's worth shipping before broad draft-assist use.
