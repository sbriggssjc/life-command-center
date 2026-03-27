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
      'application/msword',
      'application/json',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/xml',
      'application/xhtml+xml',
      'message/rfc822'
    ].includes(value);
}

function isImageMime(mime = '') {
  return ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(String(mime || '').toLowerCase());
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

function extractDocxRevisionMetaFromAttrs(attrsText = '') {
  const author = String(attrsText.match(/(?:w:author|author)="([^"]+)"/)?.[1] || '').trim();
  const date = String(attrsText.match(/(?:w:date|date)="([^"]+)"/)?.[1] || '').trim();
  const bits = [];
  if (author) bits.push(`by ${author}`);
  if (date) bits.push(`on ${date}`);
  return bits.length ? ` ${bits.join(' ')}` : '';
}

function extractDocxFragmentText(fragmentXml = '', commentsMap = {}, revisionContext = '', depth = 0) {
  if (!fragmentXml || depth > 6) return '';
  const commentIds = Array.from(String(fragmentXml || '').matchAll(/<w:commentReference\b[^>]*?(?:w:id|id)="([^"]+)"[^>]*\/>/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);
  const revised = String(fragmentXml || '').replace(/<w:(ins|del)\b([^>]*)>([\s\S]*?)<\/w:\1>/g, (_, type, attrs, inner) => {
    const innerText = extractDocxFragmentText(inner, commentsMap, type, depth + 1);
    if (!innerText) return ' ';
    const label = type === 'ins' ? 'Inserted' : 'Deleted';
    return ` [${label}${extractDocxRevisionMetaFromAttrs(attrs)}: ${innerText}] `;
  });
  const text = decodeHtmlEntities(
    revised
      .replace(/<w:delText\b[^>]*>([\s\S]*?)<\/w:delText>/g, (_, value) => revisionContext === 'del' ? ` ${value} ` : ` [Deleted: ${value}] `)
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

function extractDocxParagraphTextFromXml(paragraphXml = '', commentsMap = {}) {
  return extractDocxFragmentText(paragraphXml, commentsMap);
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

function extractLegacyOfficeStringsFromBuffer(buffer, label = 'office') {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) return '';
  const ascii = extractLegacyOfficeLinesFromText(
    buffer
      .toString('latin1')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, ' '),
    label
  );
  let utf16Text = '';
  let current = '';
  for (let index = 0; index + 1 < buffer.length; index += 2) {
    const code = buffer.readUInt16LE(index);
    if (code === 9) {
      current += '\t';
      continue;
    }
    if (code === 10 || code === 13) {
      if (current.trim()) utf16Text += `${current}\n`;
      current = '';
      continue;
    }
    if (code >= 32 && code <= 126) {
      current += String.fromCharCode(code);
      continue;
    }
    if (current.trim()) utf16Text += `${current}\n`;
    current = '';
  }
  if (current.trim()) utf16Text += current;
  const utf16Lines = extractLegacyOfficeLinesFromText(utf16Text, label);
  const merged = Array.from(new Set([...ascii, ...utf16Lines]))
    .filter((line) => isUsefulLegacyOfficeLine(line, label))
    .slice(0, 120);
  if (!merged.length) return '';
  const header = label === 'xls'
    ? 'Legacy Excel text preview'
    : label === 'ppt'
      ? 'Legacy PowerPoint text preview'
      : 'Legacy Word text preview';
  return `${header}\n${merged.join('\n')}`.trim();
}

function extractLegacyOfficeLinesFromText(text = '', label = 'office') {
  return Array.from(new Set(
    String(text || '')
      .split(/\r?\n+/)
      .map((line) => normalizeLegacyOfficePreviewLine(line, label))
      .filter((line) => isUsefulLegacyOfficeLine(line, label))
  ));
}

function normalizeLegacyOfficePreviewLine(line = '', label = 'office') {
  const raw = String(line || '')
    .replace(/[^\S\r\n\t]+/g, ' ')
    .replace(/ ?\t ?/g, '\t')
    .trim();
  if (label === 'xls') {
    return raw
      .split('\t')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\t');
  }
  return collapseWhitespace(raw);
}

function isUsefulLegacyOfficeLine(line = '', label = 'office') {
  const value = String(line || '').trim();
  if (value.length < 4) return false;
  if (!/[A-Za-z]{3,}/.test(value)) return false;
  if (/^[A-Z0-9_\/\\.-]{12,}$/.test(value)) return false;
  if (/^(root entry|objectpool|compobj|summaryinformation|documentsummaryinformation)$/i.test(value)) return false;
  if (label === 'xls') {
    return value.includes('\t') || /[A-Za-z]{3,}.*\d{2,}/.test(value) || /\d{2,}.*[A-Za-z]{3,}/.test(value);
  }
  return true;
}

function isLegacyDocPart(part) {
  const mime = String(part?.contentType?.mime || '').toLowerCase();
  const filename = getAttachmentFilename(part).toLowerCase();
  return mime === 'application/msword'
    || filename.endsWith('.doc');
}

function extractXlsxSharedStringsFromXml(xmlText = '') {
  return Array.from(String(xmlText || '').matchAll(/<si\b[\s\S]*?>([\s\S]*?)<\/si>/g))
    .map((match) => decodeHtmlEntities((match[1] || '').replace(/<[^>]+>/g, '')))
    .map((value) => collapseWhitespace(value))
    .filter(Boolean);
}

function extractXlsxRelationshipMap(xmlText = '') {
  const map = new Map();
  for (const match of String(xmlText || '').matchAll(/<Relationship\b[\s\S]*?\bId="([^"]+)"[\s\S]*?\bTarget="([^"]+)"[\s\S]*?\/>/g)) {
    const id = String(match[1] || '').trim();
    const target = String(match[2] || '').trim().replace(/^\/+/, '');
    if (!id || !target) continue;
    map.set(id, target.startsWith('xl/') ? target : `xl/${target.replace(/^(\.\.\/)+/, '')}`);
  }
  return map;
}

function extractXlsxSheetRowsFromXml(xmlText = '', sharedStrings = []) {
  return Array.from(String(xmlText || '').matchAll(/<row\b[\s\S]*?>([\s\S]*?)<\/row>/g))
    .map((rowMatch) => {
      const rowXml = String(rowMatch[1] || '');
      const cells = Array.from(rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)).map((cellMatch) => {
        const attrs = String(cellMatch[1] || '');
        const cellXml = String(cellMatch[2] || '');
        const type = attrs.match(/\bt="([^"]+)"/)?.[1] || '';
        if (type === 'inlineStr') {
          return collapseWhitespace(decodeHtmlEntities(cellXml.replace(/<[^>]+>/g, '')));
        }
        const rawValue = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] || '';
        if (type === 's') {
          const idx = parseInt(rawValue, 10);
          return Number.isNaN(idx) ? '' : (sharedStrings[idx] || '');
        }
        return collapseWhitespace(decodeHtmlEntities(rawValue));
      }).filter(Boolean);
      return cells.join('\t').trim();
    })
    .filter(Boolean);
}

function extractXlsxTextFromBuffer(buffer) {
  const entries = extractZipEntries(buffer, [
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/sharedStrings.xml'
  ]);
  if (!entries.get('xl/workbook.xml')) return '';
  const workbookXml = entries.get('xl/workbook.xml')?.toString('utf8') || '';
  const relMap = extractXlsxRelationshipMap(entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '');
  const sharedStrings = extractXlsxSharedStringsFromXml(entries.get('xl/sharedStrings.xml')?.toString('utf8') || '');
  const sheets = Array.from(workbookXml.matchAll(/<sheet\b[\s\S]*?\bname="([^"]+)"[\s\S]*?\br:id="([^"]+)"[\s\S]*?\/>/g))
    .map((match, index) => ({
      name: String(match[1] || '').trim() || `Sheet ${index + 1}`,
      path: relMap.get(String(match[2] || '').trim()) || `xl/worksheets/sheet${index + 1}.xml`
    }));
  const wantedSheetPaths = sheets.map((sheet) => sheet.path).slice(0, 6);
  const sheetEntries = extractZipEntries(buffer, wantedSheetPaths);
  const outputs = sheets.slice(0, 6).map((sheet) => {
    const rows = extractXlsxSheetRowsFromXml(sheetEntries.get(sheet.path)?.toString('utf8') || '', sharedStrings);
    return rows.length ? `${sheet.name}\n${rows.join('\n')}` : '';
  }).filter(Boolean);
  return outputs.join('\n\n').trim();
}

function isXlsxPart(part) {
  const mime = String(part?.contentType?.mime || '').toLowerCase();
  const filename = getAttachmentFilename(part).toLowerCase();
  return mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || filename.endsWith('.xlsx');
}

function isLegacyXlsPart(part) {
  const mime = String(part?.contentType?.mime || '').toLowerCase();
  const filename = getAttachmentFilename(part).toLowerCase();
  return mime === 'application/vnd.ms-excel'
    || filename.endsWith('.xls');
}

function isLegacyPptPart(part) {
  const mime = String(part?.contentType?.mime || '').toLowerCase();
  const filename = getAttachmentFilename(part).toLowerCase();
  return mime === 'application/vnd.ms-powerpoint'
    || filename.endsWith('.ppt');
}

function extractPptxRelationshipMap(xmlText = '', basePrefix = 'ppt/') {
  const map = new Map();
  for (const match of String(xmlText || '').matchAll(/<Relationship\b[\s\S]*?\bId="([^"]+)"[\s\S]*?\bTarget="([^"]+)"[\s\S]*?\/>/g)) {
    const id = String(match[1] || '').trim();
    const target = String(match[2] || '').trim().replace(/^\/+/, '');
    if (!id || !target) continue;
    map.set(id, target.startsWith(basePrefix) ? target : `${basePrefix}${target.replace(/^(\.\.\/)+/, '')}`);
  }
  return map;
}

function extractPptxTextFromXml(xmlText = '') {
  return Array.from(String(xmlText || '').matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g))
    .map((match) => decodeHtmlEntities(match[1] || ''))
    .map((value) => collapseWhitespace(value))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractPptxTextFromBuffer(buffer) {
  const entries = extractZipEntries(buffer, [
    'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels'
  ]);
  if (!entries.get('ppt/presentation.xml')) return '';
  const presentationXml = entries.get('ppt/presentation.xml')?.toString('utf8') || '';
  const relMap = extractPptxRelationshipMap(entries.get('ppt/_rels/presentation.xml.rels')?.toString('utf8') || '');
  const slides = Array.from(presentationXml.matchAll(/<p:sldId\b[\s\S]*?\br:id="([^"]+)"[\s\S]*?\/>/g))
    .map((match, index) => ({
      name: `Slide ${index + 1}`,
      path: relMap.get(String(match[1] || '').trim()) || `ppt/slides/slide${index + 1}.xml`,
      notesPath: `ppt/notesSlides/notesSlide${index + 1}.xml`
    }));
  const wantedPaths = slides.slice(0, 10).flatMap((slide) => [slide.path, slide.notesPath]);
  const slideEntries = extractZipEntries(buffer, wantedPaths);
  const outputs = slides.slice(0, 10).map((slide) => {
    const slideText = extractPptxTextFromXml(slideEntries.get(slide.path)?.toString('utf8') || '');
    const notesText = extractPptxTextFromXml(slideEntries.get(slide.notesPath)?.toString('utf8') || '');
    const combined = [
      slideText ? `${slide.name}\n${slideText}` : '',
      notesText ? `Notes\n${notesText}` : ''
    ].filter(Boolean).join('\n');
    return combined.trim();
  }).filter(Boolean);
  return outputs.join('\n\n').trim();
}

function isPptxPart(part) {
  const mime = String(part?.contentType?.mime || '').toLowerCase();
  const filename = getAttachmentFilename(part).toLowerCase();
  return mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    || filename.endsWith('.pptx');
}

function extractPdfTextPreviewFromBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) return '';
  const latin = buffer.toString('latin1');
  const operatorText = extractPdfOperatorText(latin);
  if (operatorText) return operatorText.slice(0, 4000);
  const asciiRuns = latin.match(/[A-Za-z0-9][A-Za-z0-9 ,.:;()/%$#&@'"_-]{20,}/g) || [];
  const filtered = dedupePdfPreviewLines(asciiRuns
    .map((text) => collapseWhitespace(text))
    .filter((text) => /[A-Za-z]{4,}/.test(text))
    .filter((text) => !/^endobj|stream|endstream|xref|trailer/i.test(text)));
  return collapseWhitespace(filtered.join('\n')).slice(0, 4000);
}

function extractPdfOperatorText(latin = '') {
  const lines = [];
  const textBlocks = Array.from(String(latin || '').matchAll(/BT([\s\S]*?)ET/g)).map((match) => match[1] || '');
  textBlocks.forEach((block) => {
    const normalized = String(block)
      .replace(/\]\s*TJ/g, '] TJ')
      .replace(/\)\s*Tj/g, ') Tj')
      .replace(/\)\s*'/g, ") '")
      .replace(/\)\s*"/g, ') "')
      .replace(/>\s*Tj/g, '> Tj')
      .replace(/>\s*TJ/g, '> TJ');
    Array.from(normalized.matchAll(/\[((?:\s*\([^)]*\)\s*-?\d*\s*)+)\]\s*TJ/g)).forEach((match) => {
      const fragments = Array.from(String(match[1] || '').matchAll(/\(([^)]*)\)/g))
        .map((part) => decodePdfLiteralString(part[1] || ''))
        .map((part) => collapseWhitespace(part))
        .filter(Boolean);
      if (fragments.length) lines.push(fragments.join(' '));
    });
    Array.from(normalized.matchAll(/\[((?:\s*<[^>]+>\s*-?\d*\s*)+)\]\s*TJ/g)).forEach((match) => {
      const fragments = Array.from(String(match[1] || '').matchAll(/<([^>]+)>/g))
        .map((part) => decodePdfHexString(part[1] || ''))
        .map((part) => collapseWhitespace(part))
        .filter(Boolean);
      if (fragments.length) lines.push(fragments.join(' '));
    });
    Array.from(normalized.matchAll(/\(([^)]*)\)\s*(?:Tj|'|")/g)).forEach((match) => {
      const text = collapseWhitespace(decodePdfLiteralString(match[1] || ''));
      if (text) lines.push(text);
    });
    Array.from(normalized.matchAll(/<([^>]+)>\s*(?:Tj|')/g)).forEach((match) => {
      const text = collapseWhitespace(decodePdfHexString(match[1] || ''));
      if (text) lines.push(text);
    });
  });
  const merged = dedupePdfPreviewLines(lines
    .map((line) => collapseWhitespace(line))
    .filter((line) => /[A-Za-z]{3,}/.test(line) && line.length >= 4)
    .filter((line) => !/^(BT|ET|Tj|TJ|Tm|Tf)$/i.test(line)));
  return merged.join('\n').trim();
}

function dedupePdfPreviewLines(lines = []) {
  const sorted = (Array.isArray(lines) ? lines : [])
    .map((line) => collapseWhitespace(line))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const kept = [];
  sorted.forEach((line) => {
    const normalized = line.toLowerCase();
    const duplicate = kept.some((existing) => {
      const compare = existing.toLowerCase();
      return compare === normalized
        || compare.includes(normalized)
        || normalized.includes(compare);
    });
    if (!duplicate) kept.push(line);
  });
  return kept.sort((a, b) => a.localeCompare(b));
}

function decodePdfLiteralString(text = '') {
  return String(text || '')
    .replace(/\\([nrtbf()\\])/g, (_, code) => {
      if (code === 'n' || code === 'r') return '\n';
      if (code === 't') return '\t';
      if (code === 'b' || code === 'f') return ' ';
      return code;
    })
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\\r?\n/g, '')
    .trim();
}

function decodePdfHexString(text = '') {
  const clean = String(text || '').replace(/[^0-9A-Fa-f]/g, '');
  const padded = clean.length % 2 ? `${clean}0` : clean;
  let output = '';
  for (let index = 0; index < padded.length; index += 2) {
    const code = parseInt(padded.slice(index, index + 2), 16);
    if (!Number.isFinite(code)) continue;
    output += code >= 32 || code === 9 || code === 10 || code === 13 ? String.fromCharCode(code) : ' ';
  }
  return output.trim();
}

function extractAttachmentPreview(part) {
  if (!part) return '';
  const mime = String(part.contentType?.mime || '').toLowerCase();
  if (isTextLikeMime(mime)) {
    if (isLegacyDocPart(part)) {
      return extractLegacyOfficeStringsFromBuffer(part.body_buffer, 'doc').slice(0, 4000);
    }
    if (isDocxPart(part)) {
      return extractDocxTextFromBuffer(part.body_buffer).slice(0, 4000);
    }
    if (isLegacyXlsPart(part)) {
      return extractLegacyOfficeStringsFromBuffer(part.body_buffer, 'xls').slice(0, 4000);
    }
    if (isXlsxPart(part)) {
      return extractXlsxTextFromBuffer(part.body_buffer).slice(0, 4000);
    }
    if (isLegacyPptPart(part)) {
      return extractLegacyOfficeStringsFromBuffer(part.body_buffer, 'ppt').slice(0, 4000);
    }
    if (isPptxPart(part)) {
      return extractPptxTextFromBuffer(part.body_buffer).slice(0, 4000);
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
    return { textParts: [], attachments: [], imageAttachments: [] };
  }

  const mime = String(part.contentType?.mime || '').toLowerCase();
  if (mime.startsWith('multipart/')) {
    const boundary = part.contentType?.params?.boundary;
    if (!boundary) return { textParts: [], attachments: [], imageAttachments: [] };
    return splitMultipartBody(part.body, boundary)
      .map(parseMimePart)
      .filter(Boolean)
      .reduce((acc, child) => {
        const childInsights = collectMimeInsights(child, depth + 1);
        acc.textParts.push(...childInsights.textParts);
        acc.attachments.push(...childInsights.attachments);
        acc.imageAttachments.push(...childInsights.imageAttachments);
        return acc;
      }, { textParts: [], attachments: [], imageAttachments: [] });
  }

  if (isAttachmentPart(part)) {
    const preview = extractAttachmentPreview(part);
    const imageAttachment = isImageMime(mime) && part.body_buffer?.length
      ? {
          kind: 'image',
          name: getAttachmentFilename(part),
          mime_type: mime,
          data_url: `data:${mime};base64,${part.body_buffer.toString('base64')}`
        }
      : null;
    return {
      textParts: [],
      attachments: [{
        summary: summarizeAttachmentPart(part),
        preview
      }],
      imageAttachments: imageAttachment ? [imageAttachment] : []
    };
  }

  const text = normalizeMimeTextPart(part);
  return {
    textParts: text ? [text] : [],
    attachments: [],
    imageAttachments: []
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
  let extractedAttachments = [];

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
    if (insights.imageAttachments.length) {
      extractedAttachments = insights.imageAttachments.slice(0, 3);
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
    },
    extracted_attachments: extractedAttachments
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
      metadata: email.metadata || {},
      extracted_attachments: Array.isArray(email.extracted_attachments) ? email.extracted_attachments : []
    };
  }

  return {
    name,
    mime_type: mimeType || 'text/plain',
    source_kind: 'text',
    normalized_text: collapseWhitespace(text),
    metadata: {},
    extracted_attachments: []
  };
}

export function normalizeLiveIngestDocuments(docs = []) {
  return (Array.isArray(docs) ? docs : [])
    .filter((doc) => doc && typeof doc === 'object')
    .slice(0, 6)
    .map((doc) => normalizeLiveIngestDocument(doc))
    .map((doc) => ({
      ...doc,
      normalized_text: String(doc.normalized_text || '').slice(0, 30000),
      extracted_attachments: (Array.isArray(doc.extracted_attachments) ? doc.extracted_attachments : [])
        .filter((item) => item && item.kind === 'image' && item.data_url)
        .slice(0, 3)
    }))
    .filter((doc) => doc.normalized_text);
}
