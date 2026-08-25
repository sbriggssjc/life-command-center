// ============================================================================
// api/_shared/email-signature.js — Prompt 126.
//
// Appends Scott's canonical signature block to a generated draft so a saved
// draft is SEND-READY. Before this, draft-assist ended at the model's sign-off
// ("…Thanks.") with no name/title/company/phone, so every draft needed the block
// hand-added — which defeats the point of the surface.
//
// TWO VARIANTS, selected the way Scott actually signs:
//   reply (in_reply_to != '') → docs/os/voice/signatures/signature-reply.html
//                               the COMPACT block; self-contained, no logo.
//   new   (in_reply_to == '') → docs/os/voice/signatures/signature-full.html
//                               the FULL block: service line, address, tagline,
//                               northmarq.com.
//   ambiguous                 → the REPLY block (the conservative default: it
//                               asserts strictly less and is never wrong to send).
//
// DOCTRINE
//  1. NEVER FABRICATE — AND NEVER RE-TYPE — A CONTACT DETAIL. Both blocks are
//     stored assets lifted VERBATIM from Scott's own sent mail; nothing here is
//     transcribed from a doc. There is deliberately no runtime "parse his
//     signature out of sent mail" path either: the corpus carries several
//     historical variants (a Stan Johnson era block, a Team Briggs block), so
//     parsing at request time would silently pick a stale title or wrong direct
//     line. Nothing configured ⇒ append NOTHING and SAY SO
//     (`status: 'not_configured'`) — never a guessed block.
//  2. NEVER DOUBLE-SIGN. Detection reuses `SIGNATURE_ANCHORS` from
//     voice-corpus-clean.js — the SAME marker set the corpus cleaner uses to cut
//     a signature off an exemplar. A second private copy of "what a signature
//     looks like" is precisely the normaliser drift CLAUDE.md warns about: the
//     two would diverge and the cleaner would then strip something the appender
//     does not recognise. Its failure direction is deliberately CONSERVATIVE — a
//     false positive skips the append (Scott adds it himself, the pre-P126 status
//     quo), whereas a false negative ships a doubly-signed draft.
//  3. ABOVE THE QUOTE, BY CONSTRUCTION. The block is appended to the END of the
//     body html LCC hands the flow. The reply branch of
//     flow-lcc-create-outlook-draft.json composes the draft as
//     `concat(triggerBody()?['body_html'], <the createReply-seeded quote>)`, so
//     "end of our html" IS "above the quoted thread". A test pins that order.
//  4. NO `cid:` AND NO REMOTE IMAGE. A `cid:` logo reference points at an
//     attachment part of the message it was copied from; a generated draft has no
//     such part, so it renders broken on every send. signature-full.html
//     therefore ships the styled text without the <img> (see its header for how
//     to restore the logo deliberately).
//  5. It does not poison the voice corpus. A sent draft comes back through
//     `cleanEmailBody`, whose SIGNATURE_ANCHORS cut these exact blocks — the same
//     set used for detection here — so an appended signature can never be learned
//     back as prose.
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { _internals } from './voice-corpus-clean.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIG_DIR = path.resolve(__dirname, '..', '..', 'docs', 'os', 'voice', 'signatures');

/** The stored assets, by variant. */
export const SIGNATURE_ASSETS = {
  reply: path.join(SIG_DIR, 'signature-reply.html'),
  full: path.join(SIG_DIR, 'signature-full.html'),
};

/**
 * Env overrides (ops escape hatch). A variant-specific var wins over the shared
 * one, which in turn wins over the committed asset.
 */
export const SIGNATURE_ENV_VARS = {
  reply: 'DRAFT_ASSIST_SIGNATURE_REPLY_HTML',
  full: 'DRAFT_ASSIST_SIGNATURE_FULL_HTML',
  shared: 'DRAFT_ASSIST_SIGNATURE_HTML',
};

export const VARIANTS = ['reply', 'full'];

// Cache per variant. `undefined` = not read yet.
const _assetCache = {};

/** Reset the module cache. Test seam only. */
export function _resetSignatureCache() {
  for (const k of Object.keys(_assetCache)) delete _assetCache[k];
}

/** Strip the provenance comment block — it must never reach a recipient. */
function stripHtmlComments(html) {
  return String(html || '').replace(/<!--[\s\S]*?-->/g, '');
}

function envValue(name) {
  return String(process.env[name] == null ? '' : process.env[name]).trim();
}

/**
 * Resolve which variant a draft should carry.
 *
 * Mirrors the flow's own branch condition (`in_reply_to` non-empty ⇒ it creates a
 * draft REPLY), so the block can never disagree with the shape of the draft that
 * is actually created. Anything indeterminate falls to 'reply'.
 */
export function signatureVariantFor({ inReplyTo, isReply } = {}) {
  if (typeof isReply === 'boolean') return isReply ? 'reply' : 'full';
  if (inReplyTo === undefined || inReplyTo === null) return 'reply';   // ambiguous
  return String(inReplyTo).trim() ? 'reply' : 'full';
}

/**
 * Load the canonical signature HTML for a variant.
 * @returns {{html: string|null, source: 'env'|'env_shared'|'asset'|'none', variant: string}}
 */
export function loadSignatureHtml(variant = 'reply') {
  const v = VARIANTS.includes(variant) ? variant : 'reply';

  const specific = envValue(SIGNATURE_ENV_VARS[v]);
  if (specific) return { html: stripHtmlComments(specific).trim(), source: 'env', variant: v };

  const shared = envValue(SIGNATURE_ENV_VARS.shared);
  if (shared) return { html: stripHtmlComments(shared).trim(), source: 'env_shared', variant: v };

  if (_assetCache[v] === undefined) {
    try { _assetCache[v] = readFileSync(SIGNATURE_ASSETS[v], 'utf8'); }
    catch { _assetCache[v] = ''; }   // a missing asset is "not configured", not a crash
  }
  const html = stripHtmlComments(_assetCache[v]).trim();
  return html ? { html, source: 'asset', variant: v } : { html: null, source: 'none', variant: v };
}

/**
 * Does this text ALREADY carry a signature block?
 *
 * Runs on the model's PLAIN body (the anchors are text regexes), so call it
 * before HTML-escaping. See doctrine 2 on why this reuses the cleaner's anchors.
 */
export function hasSignature(text) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return false;
  return _internals.SIGNATURE_ANCHORS.some((re) => re.test(s));
}

/**
 * Append the signature to a draft body.
 *
 * @param {string} bodyHtml   The draft body, ALREADY rendered/escaped to HTML.
 * @param {Object} [opts]
 * @param {string} [opts.plainBody]  The unescaped body, used for the
 *                                   already-signed check. Defaults to bodyHtml.
 * @param {string} [opts.inReplyTo]  The message id the draft replies to (''/absent
 *                                   ⇒ a new thread ⇒ the FULL block).
 * @param {boolean} [opts.isReply]   Explicit variant selector; wins over inReplyTo.
 * @param {string|null} [opts.signatureHtml]  Override the configured block.
 *   `undefined` (the production call) loads from config; an explicit `null`/`''`
 *   means "nothing configured" and is how the not_configured branch is exercised
 *   without moving a committed asset out from under a test run.
 * @returns {{html:string, status:'appended'|'already_present'|'not_configured',
 *            source:string, variant:string, note:string}}
 */
export function appendSignature(bodyHtml, { plainBody, inReplyTo, isReply, signatureHtml } = {}) {
  const base = String(bodyHtml == null ? '' : bodyHtml);
  const probe = plainBody == null ? base : plainBody;
  const variant = signatureVariantFor({ inReplyTo, isReply });

  if (hasSignature(probe)) {
    return {
      html: base,
      status: 'already_present',
      source: 'none',
      variant,
      note: 'The generated draft already carries a signature block — appended nothing so the draft is not doubly signed.',
    };
  }

  const override = signatureHtml !== undefined;
  const { html: sig, source } = override
    ? { html: String(signatureHtml || '').trim() || null, source: 'override' }
    : loadSignatureHtml(variant);

  if (!sig) {
    return {
      html: base,
      status: 'not_configured',
      source: 'none',
      variant,
      note: `No stored ${variant} signature is configured (${SIGNATURE_ENV_VARS[variant]}/${SIGNATURE_ENV_VARS.shared} unset and ${path.basename(SIGNATURE_ASSETS[variant] || '')} missing or empty) — appended NOTHING rather than inventing contact details. The draft needs Scott's signature added by hand.`,
    };
  }

  // One blank line between the sign-off and the block, mirroring Outlook.
  return {
    html: `${base}<div><br></div>${sig}`,
    status: 'appended',
    source,
    variant,
    note: `${variant === 'reply' ? 'Compact reply' : 'Full new-email'} signature appended once, below the sign-off and above any quoted thread (source: ${source}).`,
  };
}

export default {
  loadSignatureHtml, hasSignature, appendSignature, signatureVariantFor,
  SIGNATURE_ASSETS, SIGNATURE_ENV_VARS, VARIANTS,
};
