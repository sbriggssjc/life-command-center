// ============================================================================
// api/_shared/html-sanitize.js — Prompt 127.
//
// A tokenizing sanitizer for STORED SIGNATURE HTML. It exists because P126's
// committed assets shipped DIRTY: signature-reply.html was 12.7 KB and carried a
// whole LinkedIn notification email, four tracking-pixel <img> tags and a broken
// cid: logo BELOW the actual signature (an over-capture from the source .eml),
// and signature-full.html carried three cid: logos plus tracking imgs.
// `loadSignatureHtml` stripped HTML comments and nothing else, so
// `appendSignature` would have stapled that onto every reply draft — invisible
// in the JSON envelope, visible only once the mail was opened. The assets are
// clean now; the loader is the single place a FUTURE dirty asset would leak, so
// the fix belongs here, not in the bytes.
//
// DOCTRINE
//  1. TOKENIZE, DO NOT PATTERN-MATCH. A regex "strip <img>" is defeated by
//     `<img/src=x>`, `<IMG\n>`, an <img> inside an attribute value, or an
//     unclosed <script>. This walks the markup with a real tokenizer that knows
//     quoted attribute values and raw-text elements, then rebuilds the output
//     from an ALLOWLIST of tags and attributes. Anything unrecognised is dropped
//     or unwrapped — never passed through.
//  2. DEGRADE, NEVER LEAK. Every failure direction ends in less signature, not
//     more content: an over-size block, a block that sanitizes to nothing, and a
//     block that cannot be parsed all return `html: null`, which
//     `appendSignature` reports as `not_configured` ("the draft needs Scott's
//     signature added by hand"). A dirty asset costs a hand-typed signature; a
//     leaked one costs a recipient seeing someone else's mail.
//  3. REUSE THE CLEANER'S BOUNDARY DEFINITIONS. The quote/forward boundaries
//     (`appendonsend`, `divRplyFwdMsg`, `gmail_quote`, `type=cite`, a `From:` /
//     `Sent:` header block, `On ... wrote:`, the `____` rule) already exist as
//     `_internals.QUOTE_BOUNDARY_TAGS` / `REPLY_MARKERS` in voice-corpus-clean.js
//     — the SAME set that cuts a quoted chain off a corpus exemplar. A second
//     private copy is the normaliser drift CLAUDE.md warns about: the two would
//     diverge and the loader would pass through something the cleaner considers
//     a quote. `MIN_LEAD_CHARS` is reused for the same reason it exists there —
//     Outlook emits an EMPTY `<div id=appendonsend>` on a freshly composed
//     message, so a boundary sitting before any real text is an artefact to
//     unwrap, not a cut that would empty the block.
//  4. REMOVAL IS OBSERVABLE. The failure mode that matters looks like success: a
//     silently-sanitized asset renders fine and hides that the stored bytes are
//     wrong. Every removal is recorded in `removed[]` and surfaced by the loader,
//     which also warns once per process per asset.
// ============================================================================

import { _internals } from './voice-corpus-clean.js';

/** A real signature is small. Anything larger is an over-capture, not a block. */
export const MAX_SIGNATURE_BYTES = 8192;
/** Bound the tokenizer's work before it starts. */
export const MAX_INPUT_BYTES = 262144;

// Elements whose CONTENT is dropped with them — none of them can appear in a
// signature, and all of them can execute, fetch, or restyle the whole message.
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'svg', 'math',
  'head', 'title', 'form', 'textarea', 'select', 'button', 'applet', 'frame',
  'frameset', 'template', 'video', 'audio', 'canvas', 'map', 'xml',
]);

// Void elements dropped outright: the tag goes, there is no content to keep.
// `img`/`link` are the two that actually shipped in the P126 assets (tracking
// pixels and a cid: logo); the rest can never belong to a signature either.
const DROP_VOID = new Set([
  'img', 'link', 'meta', 'base', 'input', 'source', 'track', 'param', 'area', 'basefont',
]);

// Elements kept. Anything else is UNWRAPPED (tag dropped, text kept) rather than
// deleted, so an unknown wrapper can never take the signature down with it.
const ALLOWED_TAGS = new Set([
  'div', 'span', 'p', 'br', 'hr', 'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'font', 'small', 'big', 'sub', 'sup', 'abbr', 'center', 'nobr', 'wbr', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

const VOID_TAGS = new Set(['br', 'hr', 'wbr', 'col']);

// Attribute ALLOWLIST — the only defence that holds against `on*=` handlers is
// refusing everything not named here (a denylist misses `onauxclick`, and an
// HTML parser will happily read an event handler out of an attribute name a
// hand-written denylist never anticipated).
const ALLOWED_ATTRS = new Set([
  'style', 'href', 'class', 'id', 'align', 'valign', 'width', 'height', 'border',
  'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'bgcolor', 'color', 'face',
  'size', 'target', 'rel', 'title', 'dir', 'lang', 'nowrap', 'span', 'start', 'type',
]);

/** URL attributes, and the only schemes a signature ever needs. */
const URL_ATTRS = new Set(['href']);
const SAFE_SCHEME = /^(?:https?:|mailto:|tel:)/i;
/** A bare fragment/relative link is inert and harmless. */
const RELATIVE_URL = /^(?:#|\/|\.{1,2}\/)/;

// Style declarations that fetch, execute, or reach outside the block.
const UNSAFE_STYLE = /(?:url\s*\(|expression\s*\(|behaviou?r\s*:|-moz-binding|@import|javascript\s*:|<)/i;

// Raw-text elements: their content is NOT markup and must be consumed whole, or
// a `<script>if (a < b)` turns the rest of the document into script-shaped soup.
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp']);

// Word's whole-document wrapper. It is a boundary only when it appears AFTER
// real text (see doctrine 3) — as the first element it wraps the signature.
const WORD_SECTION = /class\s*=\s*["']?[^"'>]*\bWordSection\d*\b/i;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function parseAttrs(src) {
  const s = String(src || '');
  const out = [];
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]*)))?/g;
  let m;
  while ((m = re.exec(s))) {
    if (!m[0]) { re.lastIndex++; continue; }
    const name = m[1].toLowerCase();
    if (!name || name === '/') continue;
    const value = m[2] !== undefined ? m[2]
      : m[3] !== undefined ? m[3]
        : m[4] !== undefined ? m[4] : '';
    out.push({ name, value });
  }
  return out;
}

/**
 * Walk HTML into tokens: {t:'text'|'start'|'end'|'comment'|'decl'|'rawtext'}.
 * Quoted attribute values are respected, so a `>` inside `title="a > b"` does
 * not end the tag; raw-text elements are consumed to their close tag.
 */
export function tokenizeHtml(html) {
  const s = String(html == null ? '' : html);
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { tokens.push({ t: 'text', raw: s.slice(i) }); break; }
    if (lt > i) tokens.push({ t: 'text', raw: s.slice(i, lt) });

    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      const stop = end < 0 ? s.length : end + 3;
      tokens.push({ t: 'comment', raw: s.slice(lt, stop) });
      i = stop; continue;
    }
    if (s.startsWith('<!', lt) || s.startsWith('<?', lt)) {
      const end = s.indexOf('>', lt);
      const stop = end < 0 ? s.length : end + 1;
      tokens.push({ t: 'decl', raw: s.slice(lt, stop) });
      i = stop; continue;
    }

    const head = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:._-]*)/.exec(s.slice(lt));
    if (!head) {                       // a literal `<` in prose — keep it escaped
      tokens.push({ t: 'text', raw: '&lt;' });
      i = lt + 1; continue;
    }

    let j = lt + head[0].length;
    let quote = null;
    while (j < s.length) {
      const c = s[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j++;
    }
    const tagEnd = Math.min(j + 1, s.length);
    const raw = s.slice(lt, tagEnd);
    const name = head[2].toLowerCase();
    const attrSrc = s.slice(lt + head[0].length, j);

    if (head[1]) tokens.push({ t: 'end', name, raw });
    else tokens.push({ t: 'start', name, raw, attrs: parseAttrs(attrSrc), selfClosing: /\/\s*$/.test(attrSrc) });
    i = tagEnd;

    if (!head[1] && RAW_TEXT.has(name)) {
      const rest = s.slice(i);
      const close = new RegExp(`</\\s*${name}\\b[^>]*>`, 'i').exec(rest);
      const contentEnd = close ? i + close.index : s.length;
      tokens.push({ t: 'rawtext', name, raw: s.slice(i, contentEnd) });
      i = close ? i + close.index + close[0].length : s.length;
      tokens.push({ t: 'end', name, raw: close ? close[0] : '' });
    }
  }
  return tokens;
}

const ENTITY = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeText(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10) || 32))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITY[n.toLowerCase()] !== undefined ? ENTITY[n.toLowerCase()] : m));
}

const BLOCKISH = new Set(['div', 'p', 'br', 'tr', 'table', 'li', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th']);

/**
 * Plain text per token, so a text-marker boundary can be mapped back to the
 * token it starts in. Block tags contribute a newline because the cleaner's
 * header markers are line-anchored (`/^\s*From:/m`).
 */
function plainTextIndex(tokens) {
  let text = '';
  const starts = [];
  for (const tok of tokens) {
    starts.push(text.length);
    if (tok.t === 'text') text += decodeText(tok.raw);
    else if ((tok.t === 'start' || tok.t === 'end') && BLOCKISH.has(tok.name)) text += '\n';
  }
  return { text, starts };
}

/** Earliest quote/forward boundary in the plain text, or -1. */
function earliestTextBoundary(text) {
  let cut = -1;
  for (const re of _internals.REPLY_MARKERS) {
    const m = text.match(re);
    if (m && m.index != null && (cut < 0 || m.index < cut)) cut = m.index;
  }
  return cut;
}

function isStructuralBoundary(raw) {
  const re = _internals.QUOTE_BOUNDARY_TAGS;
  re.lastIndex = 0;                    // it is a /g regex shared with the cleaner
  const hit = re.test(raw);
  re.lastIndex = 0;
  return hit;
}

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

function sanitizeAttrs(tok, removed) {
  const kept = [];
  for (const { name, value } of tok.attrs || []) {
    if (!ALLOWED_ATTRS.has(name)) {
      removed.push(/^on/i.test(name) ? `event-handler:${name}` : `attr:${tok.name}@${name}`);
      continue;
    }
    if (URL_ATTRS.has(name)) {
      // Strip the padding a mail client ignores before testing the scheme:
      // `java\nscript:` and `java script:` are the same URL once it renders.
      const url = decodeText(value).replace(/[\s\u0000-\u001F]/g, '');
      if (!(SAFE_SCHEME.test(url) || RELATIVE_URL.test(url))) {
        removed.push(`unsafe-url:${(url.split(':')[0] || 'empty').slice(0, 12).toLowerCase()}`);
        continue;
      }
    }
    if (name === 'style' && UNSAFE_STYLE.test(decodeText(value))) {
      removed.push('unsafe-style');
      continue;
    }
    kept.push(`${name}="${String(value).replace(/"/g, '&quot;')}"`);
  }
  return kept.length ? ` ${kept.join(' ')}` : '';
}

/**
 * Sanitize stored signature HTML.
 *
 * @param {string} html
 * @returns {{html: string|null, removed: string[], reason: string|null,
 *            inputBytes: number, outputBytes: number}}
 *   `html: null` means the input could not be reduced to a safe block — the
 *   caller must treat it as "nothing configured" and append nothing.
 */
export function sanitizeSignatureHtml(html) {
  const src = String(html == null ? '' : html);
  const inputBytes = Buffer.byteLength(src, 'utf8');
  const removed = [];
  const fail = (reason) => ({ html: null, removed, reason, inputBytes, outputBytes: 0 });

  if (!src.trim()) return { html: null, removed, reason: null, inputBytes, outputBytes: 0 };
  if (inputBytes > MAX_INPUT_BYTES) {
    removed.push('oversize-input');
    return fail(`stored signature is ${inputBytes} bytes — over the ${MAX_INPUT_BYTES}-byte parse limit`);
  }

  let tokens;
  try { tokens = tokenizeHtml(src); }
  catch (e) { removed.push('parse-error'); return fail(`stored signature could not be parsed: ${e?.message || e}`); }

  // --- boundary: cut the quoted/forwarded chain and everything after it -----
  const { text: plain, starts } = plainTextIndex(tokens);
  let cut = tokens.length;

  const textCut = earliestTextBoundary(plain);
  if (textCut >= 0) {
    removed.push('quoted-thread');
    for (let k = 0; k < tokens.length; k++) {
      const end = starts[k] + (tokens[k].t === 'text' ? decodeText(tokens[k].raw).length : 0);
      if (starts[k] >= textCut || end > textCut) { cut = k; break; }
    }
  }

  const unwrap = new Set();
  for (let k = 0; k < tokens.length && k < cut; k++) {
    const tok = tokens[k];
    if (tok.t !== 'start') continue;
    if (!isStructuralBoundary(tok.raw) && !WORD_SECTION.test(tok.raw)) continue;
    // Doctrine 3: a boundary before any real text is Outlook's empty sentinel /
    // Word's document wrapper — unwrap it, do not cut the block away.
    if (plain.slice(0, starts[k]).trim().length < _internals.MIN_LEAD_CHARS) { unwrap.add(k); continue; }
    cut = k;
    removed.push('quote-boundary-tag');
    break;
  }

  // Doctrine 4: report what was BELOW the boundary too. A cut subsumes whatever
  // it discards, so without this the warning for the exact P126 asset would read
  // `["quoted-thread"]` and never mention the four tracking pixels and the cid:
  // logo that were the reason anyone looked.
  if (cut < tokens.length) {
    for (let k = cut; k < tokens.length; k++) {
      const tok = tokens[k];
      if (tok.t !== 'start') continue;
      if (DROP_WITH_CONTENT.has(tok.name) || DROP_VOID.has(tok.name)) removed.push(`below-cut:${tok.name}`);
    }
  }

  // --- rebuild from the allowlist -------------------------------------------
  const out = [];
  const stack = [];
  let skipDepth = 0;
  let skipName = null;

  for (let k = 0; k < cut; k++) {
    const tok = tokens[k];

    if (skipDepth > 0) {
      if (tok.t === 'start' && tok.name === skipName && !tok.selfClosing) skipDepth++;
      else if (tok.t === 'end' && tok.name === skipName) skipDepth--;
      continue;
    }
    if (tok.t === 'comment') { removed.push('comment'); continue; }
    if (tok.t === 'decl' || tok.t === 'rawtext') continue;
    if (tok.t === 'text') { out.push(tok.raw); continue; }

    if (tok.t === 'end') {
      if (!ALLOWED_TAGS.has(tok.name) || VOID_TAGS.has(tok.name)) continue;
      const at = stack.lastIndexOf(tok.name);
      if (at < 0) continue;                                  // stray close — drop
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }

    // start tag
    if (DROP_WITH_CONTENT.has(tok.name)) {
      removed.push(`element:${tok.name}`);
      if (!tok.selfClosing) { skipDepth = 1; skipName = tok.name; }
      continue;
    }
    if (DROP_VOID.has(tok.name)) { removed.push(`element:${tok.name}`); continue; }
    if (unwrap.has(k)) { removed.push('quote-sentinel'); continue; }
    if (!ALLOWED_TAGS.has(tok.name)) { removed.push(`unwrapped:${tok.name}`); continue; }

    const attrs = sanitizeAttrs(tok, removed);
    if (VOID_TAGS.has(tok.name)) { out.push(`<${tok.name}${attrs}>`); continue; }
    if (tok.selfClosing) { out.push(`<${tok.name}${attrs}></${tok.name}>`); continue; }
    out.push(`<${tok.name}${attrs}>`);
    stack.push(tok.name);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);

  const clean = out.join('').trim();
  const outputBytes = Buffer.byteLength(clean, 'utf8');

  // Doctrine 2: every remaining failure ends in LESS signature, never a leak.
  if (!clean) {
    return fail('stored signature sanitized to nothing — the asset carries no signature block, only removed content');
  }
  if (outputBytes > MAX_SIGNATURE_BYTES) {
    removed.push('oversize-block');
    return fail(`sanitized signature is ${outputBytes} bytes — over the ${MAX_SIGNATURE_BYTES}-byte ceiling for a real block`);
  }
  return { html: clean, removed, reason: null, inputBytes, outputBytes };
}

export const _sanitizeInternals = {
  ALLOWED_TAGS, ALLOWED_ATTRS, DROP_WITH_CONTENT, DROP_VOID, VOID_TAGS,
  RAW_TEXT, UNSAFE_STYLE, SAFE_SCHEME, WORD_SECTION, plainTextIndex, decodeText,
};

export default { sanitizeSignatureHtml, tokenizeHtml, MAX_SIGNATURE_BYTES, MAX_INPUT_BYTES };
