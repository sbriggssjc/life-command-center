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

  const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
  let extracted = '';

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = splitMultipartBody(bodyText, boundary);
    const preferredPart = parts
      .map((part) => {
        const match = part.match(/\r?\n\r?\n/);
        if (!match) return null;
        const partHeaders = parseHeaders(part.slice(0, match.index));
        const partBody = part.slice(match.index + match[0].length);
        return {
          headers: partHeaders,
          body: decodeTransferEncoding(partBody, partHeaders['content-transfer-encoding'] || '')
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aHtml = /text\/html/i.test(a.headers['content-type'] || '') ? 1 : 0;
        const bHtml = /text\/html/i.test(b.headers['content-type'] || '') ? 1 : 0;
        return aHtml - bHtml;
      })[0];

    if (preferredPart) {
      extracted = /text\/html/i.test(preferredPart.headers['content-type'] || '')
        ? stripHtml(preferredPart.body)
        : collapseWhitespace(preferredPart.body);
    }
  }

  if (!extracted) {
    const decodedBody = decodeTransferEncoding(bodyText, transferEncoding);
    extracted = /text\/html/i.test(contentType) ? stripHtml(decodedBody) : collapseWhitespace(decodedBody);
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
    normalized_text: collapseWhitespace([headerSummary, extracted].filter(Boolean).join('\n\n')),
    metadata
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
