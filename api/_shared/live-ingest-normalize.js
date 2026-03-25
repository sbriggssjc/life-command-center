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

function decodeTransferEncoding(body = '', encoding = '') {
  const mode = String(encoding || '').toLowerCase().trim();
  if (mode === 'base64') {
    try {
      return Buffer.from(String(body).replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      return String(body);
    }
  }
  if (mode === 'quoted-printable') {
    return decodeQuotedPrintable(body);
  }
  return String(body);
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
  return {
    headers,
    contentType,
    disposition,
    body: decodeTransferEncoding(bodyText, headers['content-transfer-encoding'] || '')
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

function extractAttachmentPreview(part) {
  if (!part || !isTextLikeMime(part.contentType?.mime || '')) return '';
  return normalizeMimeTextPart(part).slice(0, 4000);
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

  const rootPart = {
    headers,
    contentType: parseContentTypeParts(contentType),
    disposition: parseContentTypeParts(headers['content-disposition'] || ''),
    body: decodeTransferEncoding(bodyText, transferEncoding)
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
      attachment_preview_count: attachmentPreviews ? (attachmentPreviews.match(/\n\n/g)?.length || 0) + 1 : 0
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
