import { inflateRawSync } from 'node:zlib';

function decodeHtmlEntities(text = '') {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

function collapseWhitespace(text = '') {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtml(html = '') {
  return collapseWhitespace(
    decodeHtmlEntities(
      String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function decodeQuotedPrintable(text = '') {
  return String(text)
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeTransferEncodingToBuffer(body = '', encoding = '') {
  const raw = String(body || '');
  const mode = String(encoding || '').toLowerCase().trim();
  if (mode === 'base64') {
    try {
      return Buffer.from(raw.replace(/\s+/g, ''), 'base64');
    } catch {
      return Buffer.from(raw, 'utf8');
    }
  }
  if (mode === 'quoted-printable') {
    return Buffer.from(decodeQuotedPrintable(raw), 'utf8');
  }
  return Buffer.from(raw, 'utf8');
}

function decodeTransferEncoding(body = '', encoding = '') {
  return decodeTransferEncodingToBuffer(body, encoding).toString('utf8');
}

function parseHeaders(headerText = '') {
  const lines = String(headerText).split(/\r?\n/);
  const headers = {};
  let currentKey = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^\s/.test(line) && currentKey) {
      headers[currentKey] = `${headers[currentKey]} ${line.trim()}`.trim();
      continue;
    }
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    currentKey = line.slice(0, idx).trim().toLowerCase();
    headers[currentKey] = line.slice(idx + 1).trim();
  }
  return headers;
}

function splitMultipartBody(body = '', boundary = '') {
  const marker = `--${boundary}`;
  return String(body)
    .split(marker)
    .map((part) => part.replace(/^--\s*$/, '').trim())
    .filter((part) => part && part !== '--');
}

function parseContentTypeParts(contentType = '') {
  const [typePart, ...rest] = String(contentType || '').split(';');
  const params = {};
  rest.forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim().replace(/^"|"$/g, '');
    params[key] = value;
  });
  return {
    mime: typePart.trim().toLowerCase(),
    params
  };
}

function parseMimePart(part = '') {
  const match = String(part).match(/\r?\n\r?\n/);
  if (!match) return null;
  const headerText = part.slice(0, match.index);
  const bodyText = part.slice(match.index + match[0].length);
  const headers = parseHeaders(headerText);
  const contentType = parseContentTypeParts(headers['content-type'] || 'text/plain');
  const disposition = parseContentTypeParts(headers['content-disposition'] || '');
  const bodyBuffer = decodeTransferEncodingToBuffer(bodyText, headers['content-transfer-encoding'] || '');
  return {
    headers,
    contentType,
    disposition,
    body: bodyBuffer.toString('utf8'),
    body_buffer: bodyBuffer
  };
}

function isAttachmentPart(part) {
  if (!part) return false;
  const disposition = String(part.disposition?.mime || '').toLowerCase();
  return disposition === 'attachment'
    || !!part.disposition?.params?.filename
    || !!part.contentType?.params?.name;
}

function getAttachmentFilename(part) {
  return part?.disposition?.params?.filename
    || part?.contentType?.params?.name
    || part?.headers?.['x-attachment-id']
    || 'unnamed attachment';
}

function isTextLikeMime(mime = '') {
  const value = String(mime || '').toLowerCase();
  return value.startsWith('text/')
    || [
      'application/json',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/xml',
      'application/xhtml+xml',
      'message/rfc822'
    ].includes(value);
}

function normalizeMimeTextPart(part) {
  if (!part) return '';
  if (part.contentType.mime === 'text/html') return stripHtml(part.body);
  if (part.contentType.mime === 'text/plain') return collapseWhitespace(part.body);
  if (part.contentType.mime === 'text/csv') return collapseWhitespace(part.body);
  if (part.contentType.mime === 'application/json' || part.contentType.mime === 'application/xml' || part.contentType.mime === 'application/xhtml+xml') {
    return collapseWhitespace(part.body);
  }
  if (part.contentType.mime === 'message/rfc822') {
    return normalizeEmailText(part.body).normalized_text;
  }
  return '';
}

function summarizeAttachmentPart(part) {
  const filename = getAttachmentFilename(part);
  return `${filename} (${part.contentType.mime || 'application/octet-stream'})`;
}

function findZipCentralDirectoryOffset(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

function extractZipEntries(buffer, wantedNames = []) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 22) return new Map();
  const wanted = new Set((Array.isArray(wantedNames) ? wantedNames : []).map((name) => String(name || '')));
  const entries = new Map();
  const eocdOffset = findZipCentralDirectoryOffset(buffer);
  if (eocdOffset === -1) return entries;
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = directoryOffset;
  for (let index = 0; index < entryCount && offset + 46 <= buffer.length; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    offset += 46 + fileNameLength + extraLength + commentLength;
    if (wanted.size && !wanted.has(fileName)) continue;
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataOffset > buffer.length || dataEnd > buffer.length) continue;
    const data = buffer.slice(dataOffset, dataEnd);
    try {
      const content = compression === 8 ? inflateRawSync(data) : compression === 0 ? data : null;
      if (content) entries.set(fileName, content);
    } catch {
      // Skip unreadable entries and continue with the rest.
    }
  }
  return entries;
}

function extractDocxParagraphTextFromXml(paragraphXml = '', commentsMap = {}) {
  const commentIds = Array.from(paragraphXml.matchAll(/<w:commentReference\b[^>]*?(?:w:id|id)="([^"]+)"[^>]*\/>/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);
  const text = decodeHtmlEntities(
    paragraphXml
      .replace(/<w:delText\b[^>]*>([\s\S]*?)<\/w:delText>/g, (_, value) => ` [Deleted: ${value}] `)
      .replace(/<w:(?:tab)\b[^>]*\/>/g, '\t')
      .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
      .replace(/<\/w:(?:p|tr|tc)>/g, '\n')
      .replace(/<[^>]+>/g, '')
  );
  const comments = Array.from(new Set(commentIds))
    .map((id) => commentsMap[id])
    .filter(Boolean)
    .map((value) => `[Comment: ${value}]`);
  return collapseWhitespace([text, ...comments].filter(Boolean).join(' '));
}

function buildDocxCommentsMapFromXml(xmlText = '') {
  const map = {};
  for (const match of String(xmlText || '').matchAll(/<w:comment\b[\s\S]*?(?:w:id|id)="([^"]+)"[\s\S]*?>([\s\S]*?)<\/w:comment>/g)) {
    const id = String(match[1] || '').trim();
    const body = String(match[2] || '');
    if (!id) continue;
    const paragraphs = Array.from(body.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
      .map((paragraph) => extractDocxParagraphTextFromXml(paragraph[0], {}))
      .filter(Boolean);
    map[id] = paragraphs.join(' ').trim();
  }
  return map;
}

function extractDocxNotesFromXml(xmlText = '', label = 'Notes') {
  const notes = Array.from(String(xmlText || '').matchAll(/<w:(?:footnote|endnote)\b[\s\S]*?(?:w:id|id)="([^"]+)"[\s\S]*?>([\s\S]*?)<\/w:(?:footnote|endnote)>/g))
    .filter((match) => !['-1', '0'].includes(String(match[1] || '').trim()))
    .map((match) => {
      const paragraphs = Array.from(String(match[2] || '').matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
        .map((paragraph) => extractDocxParagraphTextFromXml(paragraph[0], {}))
        .filter(Boolean);
      return paragraphs.join(' ').trim();
    })
    .filter(Boolean);
  return notes.length ? `${label}:\n${notes.join('\n')}` : '';
}

function extractDocxTextFromBuffer(buffer) {
  const entries = extractZipEntries(buffer, [
    'word/document.xml',
    'word/comments.xml',
    'word/footnotes.xml',
    'word/endnotes.xml'
  ]);
  const documentXml = entries.get('word/document.xml')?.toString('utf8') || '';
  if (!documentXml) return '';
  const commentsMap = buildDocxCommentsMapFromXml(entries.get('word/comments.xml')?.toString('utf8') || '');
  const paragraphs = Array.from(documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
    .map((paragraph) => extractDocxParagraphTextFromXml(paragraph[0], commentsMap))
    .filter(Boolean);
  const footnotes = extractDocxNotesFromXml(entries.get('word/footnotes.xml')?.toString('utf8') || '', 'Footnotes');
  const endnotes = extractDocxNotesFromXml(entries.get('word/endnotes.xml')?.toString('utf8') || '', 'Endnotes');
  return [paragraphs.join('\n'), footnotes, endnotes].filter(Boolean).join('\n\n').trim();
}

function isDocxPart(part) {
  const mime = String(part?.contentType?.mime || '').toLowerCase();
  const filename = getAttachmentFilename(part).toLowerCase();
  return mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || filename.endsWith('.docx');
}

function extractPdfTextPreviewFromBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) return '';
  const latin = buffer.toString('latin1');
  const parenStrings = Array.from(latin.matchAll(/\(([^()\\]{6,})\)/g))
    .map((match) => match[1])
    .map((text) => text.replace(/\\([nrtbf()\\])/g, ' '))
    .map((text) => collapseWhitespace(text))
    .filter((text) => /[A-Za-z]{3,}/.test(text));
  if (parenStrings.length) {
    return collapseWhitespace(parenStrings.join(' ')).slice(0, 4000);
  }
  const asciiRuns = latin.match(/[A-Za-z0-9][A-Za-z0-9 ,.:;()/%$#&@'"_-]{20,}/g) || [];
  const filtered = asciiRuns
    .map((text) => collapseWhitespace(text))
    .filter((text) => /[A-Za-z]{4,}/.test(text))
    .filter((text) => !/^endobj|stream|endstream|xref|trailer/i.test(text));
  return collapseWhitespace(filtered.join(' ')).slice(0, 4000);
}

function extractAttachmentPreview(part) {
  if (!part) return '';
  const mime = String(part.contentType?.mime || '').toLowerCase();
  if (isTextLikeMime(mime)) {
    if (isDocxPart(part)) {
      return extractDocxTextFromBuffer(part.body_buffer).slice(0, 4000);
    }
    return normalizeMimeTextPart(part).slice(0, 4000);
  }
  if (mime === 'application/pdf') {
    return extractPdfTextPreviewFromBuffer(part.body_buffer);
  }
  return '';
}

function collectMimeInsights(part, depth = 0) {
  if (!part || depth > 6) {
    return { textParts: [], attachments: [] };
  }

  const mime = String(part.contentType?.mime || '').toLowerCase();
  if (mime.startsWith('multipart/')) {
    const boundary = part.contentType?.params?.boundary;
    if (!boundary) return { textParts: [], attachments: [] };
    return splitMultipartBody(part.body, boundary)
      .map(parseMimePart)
      .filter(Boolean)
      .reduce((acc, child) => {
        const childInsights = collectMimeInsights(child, depth + 1);
        acc.textParts.push(...childInsights.textParts);
        acc.attachments.push(...childInsights.attachments);
        return acc;
      }, { textParts: [], attachments: [] });
  }

  if (isAttachmentPart(part)) {
    const preview = extractAttachmentPreview(part);
    return {
      textParts: [],
      attachments: [{
        summary: summarizeAttachmentPart(part),
        preview
      }]
    };
  }

  const text = normalizeMimeTextPart(part);
  return {
    textParts: text ? [text] : [],
    attachments: []
  };
}

function normalizeEmailText(text = '') {
  const raw = String(text || '');
  const sepMatch = raw.match(/\r?\n\r?\n/);
  if (!sepMatch) {
    return { normalized_text: collapseWhitespace(raw), metadata: {} };
  }

  const splitIndex = sepMatch.index;
  const headerText = raw.slice(0, splitIndex);
  const bodyText = raw.slice(splitIndex + sepMatch[0].length);
  const headers = parseHeaders(headerText);
  const contentType = headers['content-type'] || 'text/plain';
  const transferEncoding = headers['content-transfer-encoding'] || '';
  let extracted = '';
  let attachmentSummary = '';
  let attachmentPreviews = '';
  let attachmentPreviewCount = 0;

  const rootPart = {
    headers,
    contentType: parseContentTypeParts(contentType),
    disposition: parseContentTypeParts(headers['content-disposition'] || ''),
    body: decodeTransferEncoding(bodyText, transferEncoding),
    body_buffer: decodeTransferEncodingToBuffer(bodyText, transferEncoding)
  };

  if (rootPart.contentType.mime.startsWith('multipart/')) {
    const insights = collectMimeInsights(rootPart);
    if (insights.textParts.length) {
      extracted = insights.textParts.join('\n\n');
    }
    if (insights.attachments.length) {
      attachmentSummary = `Attachments:\n${insights.attachments.map((item) => `- ${item.summary}`).join('\n')}`;
      const previews = insights.attachments
        .filter((item) => item.preview)
        .map((item) => `${item.summary}\n${item.preview}`);
      if (previews.length) {
        attachmentPreviewCount = previews.length;
        attachmentPreviews = `Attachment content excerpts:\n\n${previews.join('\n\n')}`;
      }
    }
  }

  if (!extracted) {
    extracted = /text\/html/i.test(contentType) ? stripHtml(rootPart.body) : collapseWhitespace(rootPart.body);
  }

  const metadata = {
    subject: headers.subject || null,
    from: headers.from || null,
    to: headers.to || null,
    date: headers.date || null
  };
  const headerSummary = [
    metadata.subject ? `Subject: ${metadata.subject}` : null,
    metadata.from ? `From: ${metadata.from}` : null,
    metadata.to ? `To: ${metadata.to}` : null,
    metadata.date ? `Date: ${metadata.date}` : null
  ].filter(Boolean).join('\n');

  return {
    normalized_text: collapseWhitespace([headerSummary, extracted, attachmentSummary, attachmentPreviews].filter(Boolean).join('\n\n')),
    metadata: {
      ...metadata,
      attachment_summary: attachmentSummary || null,
      attachment_preview_count: attachmentPreviewCount
    }
  };
}

export function normalizeLiveIngestDocument(doc = {}) {
  const name = String(doc.name || 'document');
  const mimeType = String(doc.mime_type || '').toLowerCase();
  const text = String(doc.text || '');
  const lowerName = name.toLowerCase();

  if (mimeType.includes('html') || lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
    return {
      name,
      mime_type: mimeType || 'text/html',
      source_kind: 'html',
      normalized_text: stripHtml(text),
      metadata: {}
    };
  }

  if (mimeType === 'message/rfc822' || lowerName.endsWith('.eml')) {
    const email = normalizeEmailText(text);
    return {
      name,
      mime_type: mimeType || 'message/rfc822',
      source_kind: 'email',
      normalized_text: email.normalized_text,
      metadata: email.metadata || {}
    };
  }

  return {
    name,
    mime_type: mimeType || 'text/plain',
    source_kind: 'text',
    normalized_text: collapseWhitespace(text),
    metadata: {}
  };
}

export function normalizeLiveIngestDocuments(docs = []) {
  return (Array.isArray(docs) ? docs : [])
    .filter((doc) => doc && typeof doc === 'object')
    .slice(0, 6)
    .map((doc) => normalizeLiveIngestDocument(doc))
    .map((doc) => ({
      ...doc,
      normalized_text: String(doc.normalized_text || '').slice(0, 30000)
    }))
    .filter((doc) => doc.normalized_text);
}
