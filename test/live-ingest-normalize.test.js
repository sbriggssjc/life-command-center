import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import {
  normalizeLiveIngestDocument,
  normalizeLiveIngestDocuments
} from '../api/_shared/live-ingest-normalize.js';

function buildStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  entries.forEach(({ name, content }) => {
    const fileNameBuffer = Buffer.from(name, 'utf8');
    const dataBuffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'utf8');

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(fileNameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, fileNameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(fileNameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, fileNameBuffer);

    offset += localHeader.length + fileNameBuffer.length + dataBuffer.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function encodeAscii85(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  let output = '';
  for (let index = 0; index < source.length; index += 4) {
    const chunk = source.subarray(index, index + 4);
    if (chunk.length === 4 && chunk[0] === 0 && chunk[1] === 0 && chunk[2] === 0 && chunk[3] === 0) {
      output += 'z';
      continue;
    }
    const padded = Buffer.alloc(4);
    chunk.copy(padded);
    let value = padded.readUInt32BE(0);
    const chars = new Array(5);
    for (let i = 4; i >= 0; i--) {
      chars[i] = String.fromCharCode((value % 85) + 33);
      value = Math.floor(value / 85);
    }
    output += chars.slice(0, chunk.length + 1).join('');
  }
  return `<~${output}~>`;
}

function encodeRunLength(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const bytes = [];
  let index = 0;
  while (index < source.length) {
    let repeatLength = 1;
    while (
      index + repeatLength < source.length
      && source[index + repeatLength] === source[index]
      && repeatLength < 128
    ) {
      repeatLength += 1;
    }
    if (repeatLength >= 3) {
      bytes.push(257 - repeatLength, source[index]);
      index += repeatLength;
      continue;
    }
    const literalStart = index;
    index += 1;
    while (index < source.length) {
      let nextRepeatLength = 1;
      while (
        index + nextRepeatLength < source.length
        && source[index + nextRepeatLength] === source[index]
        && nextRepeatLength < 128
      ) {
        nextRepeatLength += 1;
      }
      if (nextRepeatLength >= 3 || (index - literalStart) >= 128) break;
      index += 1;
    }
    const literal = source.subarray(literalStart, index);
    bytes.push(literal.length - 1, ...literal);
  }
  bytes.push(128);
  return Buffer.from(bytes);
}

function encodePngPredictorRows(buffer, columns, filter = 0) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const rowLength = Math.max(1, columns);
  const rows = [];
  for (let offset = 0; offset < source.length; offset += rowLength) {
    const row = source.subarray(offset, Math.min(offset + rowLength, source.length));
    if (row.length < rowLength) break;
    rows.push(Buffer.concat([Buffer.from([filter]), row]));
  }
  return Buffer.concat(rows);
}

function encodePdfLzw(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const CLEAR = 256;
  const EOD = 257;
  let codeSize = 9;
  let nextCode = 258;
  let dictionary = new Map();
  const resetDictionary = () => {
    dictionary = new Map();
    for (let code = 0; code < 256; code += 1) {
      dictionary.set(String.fromCharCode(code), code);
    }
    codeSize = 9;
    nextCode = 258;
  };
  const codes = [];
  const pushCode = (value) => {
    codes.push({ value, width: codeSize });
  };
  resetDictionary();
  pushCode(CLEAR);
  let phrase = '';
  for (const byte of source) {
    const char = String.fromCharCode(byte);
    const combined = phrase + char;
    if (dictionary.has(combined)) {
      phrase = combined;
      continue;
    }
    if (phrase) pushCode(dictionary.get(phrase));
    if (nextCode < 4096) {
      dictionary.set(combined, nextCode);
      nextCode += 1;
      if (nextCode === 512) codeSize = 10;
      else if (nextCode === 1024) codeSize = 11;
      else if (nextCode === 2048) codeSize = 12;
    } else {
      pushCode(CLEAR);
      resetDictionary();
    }
    phrase = char;
  }
  if (phrase) pushCode(dictionary.get(phrase));
  pushCode(EOD);
  const bytes = [];
  let accumulator = 0;
  let bits = 0;
  codes.forEach(({ value, width }) => {
    accumulator = (accumulator << width) | value;
    bits += width;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
    accumulator &= (1 << bits) - 1;
  });
  if (bits > 0) bytes.push((accumulator << (8 - bits)) & 0xff);
  return Buffer.from(bytes);
}

describe('normalizeLiveIngestDocument', () => {
  it('strips html into readable text', () => {
    const doc = normalizeLiveIngestDocument({
      name: 'page.html',
      mime_type: 'text/html',
      text: '<html><body><h1>Deal</h1><p>Price &amp; terms</p><script>alert(1)</script></body></html>'
    });

    assert.equal(doc.source_kind, 'html');
    assert.match(doc.normalized_text, /Deal/);
    assert.match(doc.normalized_text, /Price & terms/);
    assert.doesNotMatch(doc.normalized_text, /alert/);
  });

  it('extracts headers and preferred body from raw email', () => {
    const raw = [
      'Subject: Test Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/alternative; boundary="abc123"',
      '',
      '--abc123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Plain body line',
      '--abc123',
      'Content-Type: text/html; charset="utf-8"',
      '',
      '<html><body><p>HTML body line</p></body></html>',
      '--abc123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'message.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.equal(doc.source_kind, 'email');
    assert.match(doc.normalized_text, /Subject: Test Intake/);
    assert.match(doc.normalized_text, /From: sender@example.com/);
    assert.match(doc.normalized_text, /Plain body line/);
  });

  it('summarizes attachments from multipart email', () => {
    const raw = [
      'Subject: Attachment Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="mix123"',
      '',
      '--mix123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached lease abstract.',
      '--mix123',
      'Content-Type: application/pdf; name="lease.pdf"',
      'Content-Disposition: attachment; filename="lease.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQK',
      '--mix123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.equal(doc.source_kind, 'email');
    assert.match(doc.normalized_text, /See attached lease abstract/);
    assert.match(doc.normalized_text, /Attachments:/);
    assert.match(doc.normalized_text, /lease\.pdf \(application\/pdf\)/);
    assert.equal(doc.metadata.attachment_summary.includes('lease.pdf'), true);
  });

  it('extracts readable text from text-like email attachments', () => {
    const raw = [
      'Subject: Attachment Body Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="mix456"',
      '',
      '--mix456',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Attached notes and rent roll.',
      '--mix456',
      'Content-Type: text/csv; name="rent-roll.csv"',
      'Content-Disposition: attachment; filename="rent-roll.csv"',
      '',
      'tenant,monthly_rent',
      'Alpha LLC,12000',
      '--mix456',
      'Content-Type: text/html; name="notes.html"',
      'Content-Disposition: attachment; filename="notes.html"',
      '',
      '<html><body><p>Lease starts 2026-04-01</p></body></html>',
      '--mix456--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'attachment-body.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.equal(doc.source_kind, 'email');
    assert.match(doc.normalized_text, /Attachment content excerpts:/);
    assert.match(doc.normalized_text, /rent-roll\.csv \(text\/csv\)/);
    assert.match(doc.normalized_text, /tenant,monthly_rent/);
    assert.match(doc.normalized_text, /Lease starts 2026-04-01/);
    assert.equal(doc.metadata.attachment_preview_count, 2);
  });

  it('handles nested multipart email attachments', () => {
    const raw = [
      'Subject: Nested Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="outer123"',
      '',
      '--outer123',
      'Content-Type: multipart/alternative; boundary="inner456"',
      '',
      '--inner456',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Outer message body.',
      '--inner456--',
      '--outer123',
      'Content-Type: application/json; name="payload.json"',
      'Content-Disposition: attachment; filename="payload.json"',
      '',
      '{\"status\":\"approved\",\"amount\":42}',
      '--outer123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'nested.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /Outer message body/);
    assert.match(doc.normalized_text, /payload\.json \(application\/json\)/);
    assert.match(doc.normalized_text, /"status":"approved"/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts readable text from attached pdf payloads when present', () => {
    const pdfLike = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nstream\nBT\n(Lease Rate 12500 Monthly) Tj\n(Effective Date 2026-05-01) Tj\nET\nendstream\nendobj\n', 'utf8').toString('base64');
    const raw = [
      'Subject: PDF Attachment Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdf123"',
      '',
      '--pdf123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached lease PDF.',
      '--pdf123',
      'Content-Type: application/pdf; name="lease.pdf"',
      'Content-Disposition: attachment; filename="lease.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdf123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /lease\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Attachment content excerpts:/);
    assert.match(doc.normalized_text, /Lease Rate 12500 Monthly/);
    assert.match(doc.normalized_text, /Effective Date 2026-05-01/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts readable text from pdf TJ arrays and escaped literals', () => {
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Type /Page >>',
      'stream',
      'BT',
      '[(Base Rent ) 120 (17500)] TJ',
      '(Lease\\040Start\\0402026-07-01) Tj',
      "[(Notice ) 80 (Period ) 50 (180 Days)] TJ",
      'ET',
      'endstream',
      'endobj'
    ].join('\n'), 'utf8').toString('base64');
    const raw = [
      'Subject: PDF TJ Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfTJ123"',
      '',
      '--pdfTJ123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached lease abstract.',
      '--pdfTJ123',
      'Content-Type: application/pdf; name="abstract.pdf"',
      'Content-Disposition: attachment; filename="abstract.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfTJ123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-tj-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /abstract\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Base Rent 17500/);
    assert.match(doc.normalized_text, /Lease Start 2026-07-01/);
    assert.match(doc.normalized_text, /Notice Period 180 Days/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('deduplicates repeated pdf text fragments across multiple text blocks', () => {
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Type /Page >>',
      'stream',
      'BT',
      '(Lease Abstract) Tj',
      '(Base Rent 17500) Tj',
      'ET',
      'BT',
      '(Lease Abstract) Tj',
      '(Base Rent 17500) Tj',
      '(Termination Option 2 x 5 years) Tj',
      'ET',
      'endstream',
      'endobj'
    ].join('\n'), 'utf8').toString('base64');
    const raw = [
      'Subject: PDF Dedup Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfDup123"',
      '',
      '--pdfDup123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached repeated abstract.',
      '--pdfDup123',
      'Content-Type: application/pdf; name="repeated.pdf"',
      'Content-Disposition: attachment; filename="repeated.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfDup123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-dedup-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    const repeatedMatches = doc.normalized_text.match(/Lease Abstract/g) || [];
    assert.equal(repeatedMatches.length, 1);
    assert.match(doc.normalized_text, /Base Rent 17500/);
    assert.match(doc.normalized_text, /Termination Option 2 x 5 years/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts hex-encoded pdf text across separate text blocks', () => {
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Type /Page >>',
      'stream',
      'BT',
      '<4C65617365204162737472616374> Tj',
      'ET',
      'BT',
      '[<426173652052656E7420> 40 <3139303030>] TJ',
      '<4F7074696F6E205465726D203130205965617273> Tj',
      'ET',
      'endstream',
      'endobj'
    ].join('\n'), 'utf8').toString('base64');
    const raw = [
      'Subject: PDF Hex Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfHex123"',
      '',
      '--pdfHex123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached hex-encoded abstract.',
      '--pdfHex123',
      'Content-Type: application/pdf; name="hex.pdf"',
      'Content-Disposition: attachment; filename="hex.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfHex123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-hex-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /hex\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Lease Abstract/);
    assert.match(doc.normalized_text, /Base Rent 19000/);
    assert.match(doc.normalized_text, /Option Term 10 Years/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts text from flate-compressed pdf streams', () => {
    const compressedStream = deflateSync(Buffer.from([
      'BT',
      '(Compressed Lease Summary) Tj',
      '[(Annual Rent ) 60 (210000)] TJ',
      'ET'
    ].join('\n'), 'utf8')).toString('latin1');
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Length 64 /Filter /FlateDecode >>',
      'stream',
      compressedStream,
      'endstream',
      'endobj'
    ].join('\n'), 'latin1').toString('base64');
    const raw = [
      'Subject: PDF Flate Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfFlate123"',
      '',
      '--pdfFlate123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached compressed abstract.',
      '--pdfFlate123',
      'Content-Type: application/pdf; name="compressed.pdf"',
      'Content-Disposition: attachment; filename="compressed.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfFlate123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-flate-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /compressed\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Compressed Lease Summary/);
    assert.match(doc.normalized_text, /Annual Rent 210000/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts text from ASCIIHex encoded pdf streams', () => {
    const hexStream = Buffer.from([
      'BT',
      '(Hex Filter Summary) Tj',
      '[(Monthly Rent ) 40 (18500)] TJ',
      'ET'
    ].join('\n'), 'utf8').toString('hex') + '>';
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Length 96 /Filter /ASCIIHexDecode >>',
      'stream',
      hexStream,
      'endstream',
      'endobj'
    ].join('\n'), 'latin1').toString('base64');
    const raw = [
      'Subject: PDF ASCIIHex Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfHexFilter123"',
      '',
      '--pdfHexFilter123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached hex-filter abstract.',
      '--pdfHexFilter123',
      'Content-Type: application/pdf; name="hex-filter.pdf"',
      'Content-Disposition: attachment; filename="hex-filter.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfHexFilter123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-asciihex-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /hex-filter\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Hex Filter Summary/);
    assert.match(doc.normalized_text, /Monthly Rent 18500/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts text from ASCII85 and Flate encoded pdf streams', () => {
    const flated = deflateSync(Buffer.from([
      'BT',
      '(Encoded Stream Summary) Tj',
      '<4E65742052656E74203232303030> Tj',
      'ET'
    ].join('\n'), 'utf8'));
    const ascii85Stream = encodeAscii85(flated);
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Length 96 /Filter [/ASCII85Decode /FlateDecode] >>',
      'stream',
      ascii85Stream,
      'endstream',
      'endobj'
    ].join('\n'), 'latin1').toString('base64');
    const raw = [
      'Subject: PDF ASCII85 Flate Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfA85Flate123"',
      '',
      '--pdfA85Flate123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached encoded abstract.',
      '--pdfA85Flate123',
      'Content-Type: application/pdf; name="encoded-filter.pdf"',
      'Content-Disposition: attachment; filename="encoded-filter.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfA85Flate123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-ascii85-flate-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /encoded-filter\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Encoded Stream Summary/);
    assert.match(doc.normalized_text, /Net Rent 22000/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts text from RunLength encoded pdf streams', () => {
    const runLengthStream = encodeRunLength(Buffer.from([
      'BT',
      '(RunLength Summary) Tj',
      '[(Annual Escalation ) 20 (3%)] TJ',
      'ET'
    ].join('\n'), 'utf8')).toString('latin1');
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Length 96 /Filter /RunLengthDecode >>',
      'stream',
      runLengthStream,
      'endstream',
      'endobj'
    ].join('\n'), 'latin1').toString('base64');
    const raw = [
      'Subject: PDF RunLength Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfRunLength123"',
      '',
      '--pdfRunLength123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached run-length abstract.',
      '--pdfRunLength123',
      'Content-Type: application/pdf; name="runlength.pdf"',
      'Content-Disposition: attachment; filename="runlength.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfRunLength123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-runlength-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /runlength\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /RunLength Summary/);
    assert.match(doc.normalized_text, /Annual Escalation 3%/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts text from Flate streams with PNG predictor decode params', () => {
    const predictorSource = Buffer.from([
      'BT\n(Predictor Summary) Tj\n',
      '[(Base Rent ) 20 (24000)]',
      ' TJ\nET\n'
    ].join(''), 'utf8');
    const predictorEncoded = encodePngPredictorRows(predictorSource, 2, 0);
    const compressedStream = deflateSync(predictorEncoded).toString('latin1');
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Length 128 /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 2 /Colors 1 /BitsPerComponent 8 >> >>',
      'stream',
      compressedStream,
      'endstream',
      'endobj'
    ].join('\n'), 'latin1').toString('base64');
    const raw = [
      'Subject: PDF Predictor Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfPredictor123"',
      '',
      '--pdfPredictor123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached predictor abstract.',
      '--pdfPredictor123',
      'Content-Type: application/pdf; name="predictor.pdf"',
      'Content-Disposition: attachment; filename="predictor.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfPredictor123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-predictor-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /predictor\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Predictor Summary/);
    assert.match(doc.normalized_text, /Base Rent 24000/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts text from LZW encoded pdf streams', () => {
    const lzwStream = encodePdfLzw(Buffer.from([
      'BT',
      '(LZW Summary) Tj',
      '[(Tenant Improvement ) 20 (75000)] TJ',
      'ET'
    ].join('\n'), 'utf8')).toString('latin1');
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Length 128 /Filter /LZWDecode >>',
      'stream',
      lzwStream,
      'endstream',
      'endobj'
    ].join('\n'), 'latin1').toString('base64');
    const raw = [
      'Subject: PDF LZW Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfLzw123"',
      '',
      '--pdfLzw123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached LZW abstract.',
      '--pdfLzw123',
      'Content-Type: application/pdf; name="lzw.pdf"',
      'Content-Disposition: attachment; filename="lzw.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfLzw123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-lzw-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /lzw\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /LZW Summary/);
    assert.match(doc.normalized_text, /Tenant Improvement 75000/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts text-like runs from decoded pdf streams without text operators', () => {
    const compressedStream = deflateSync(Buffer.from(
      'LEASE ABSTRACT|Base Rent 31000|Expiration 2031-12-31|Facility Dialysis Center',
      'utf8'
    )).toString('latin1');
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Length 128 /Filter /FlateDecode >>',
      'stream',
      compressedStream,
      'endstream',
      'endobj'
    ].join('\n'), 'latin1').toString('base64');
    const raw = [
      'Subject: PDF Mixed Payload Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfMixed123"',
      '',
      '--pdfMixed123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached mixed payload export.',
      '--pdfMixed123',
      'Content-Type: application/pdf; name="mixed.pdf"',
      'Content-Disposition: attachment; filename="mixed.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfMixed123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-mixed-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /mixed\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /LEASE ABSTRACT/);
    assert.match(doc.normalized_text, /Base Rent 31000/);
    assert.match(doc.normalized_text, /Expiration 2031-12-31/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts pdf document metadata when page text is sparse', () => {
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Title (Dialysis Lease Abstract) /Subject (Renewal Package) /Keywords (rent roll, amendment) >>',
      'endobj',
      '2 0 obj',
      '<< /Type /Metadata >>',
      'stream',
      '<x:xmpmeta><rdf:RDF><rdf:Description><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Operator Packet</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>',
      'endstream',
      'endobj'
    ].join('\n'), 'utf8').toString('base64');
    const raw = [
      'Subject: PDF Metadata Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfMeta123"',
      '',
      '--pdfMeta123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached metadata-heavy PDF.',
      '--pdfMeta123',
      'Content-Type: application/pdf; name="metadata.pdf"',
      'Content-Disposition: attachment; filename="metadata.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfMeta123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-metadata-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /metadata\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Title: Dialysis Lease Abstract/);
    assert.match(doc.normalized_text, /Subject: Renewal Package/);
    assert.match(doc.normalized_text, /Keywords: rent roll, amendment/);
    assert.match(doc.normalized_text, /Operator Packet/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts pdf annotation and accessibility text when present', () => {
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Type /Annot /Subtype /Text /Contents (Escalation note: verify CAM cap) /T (Analyst Review) >>',
      'endobj',
      '2 0 obj',
      '<< /Type /StructElem /Alt (Dialysis Floorplan) /ActualText (Suite B buildout) >>',
      'endobj'
    ].join('\n'), 'utf8').toString('base64');
    const raw = [
      'Subject: PDF Annotation Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfAnnot123"',
      '',
      '--pdfAnnot123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached annotated PDF.',
      '--pdfAnnot123',
      'Content-Type: application/pdf; name="annotated.pdf"',
      'Content-Disposition: attachment; filename="annotated.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfAnnot123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-annotation-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /annotated\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Annotation: Escalation note: verify CAM cap/);
    assert.match(doc.normalized_text, /Annotation Author: Analyst Review/);
    assert.match(doc.normalized_text, /Alt: Dialysis Floorplan/);
    assert.match(doc.normalized_text, /ActualText: Suite B buildout/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts embedded file labels from pdf file-spec metadata', () => {
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Type /Filespec /F (lease-summary.xlsx) /UF (lease-summary.xlsx) /Desc (Updated rent roll workbook) >>',
      'endobj'
    ].join('\n'), 'utf8').toString('base64');
    const raw = [
      'Subject: PDF Embedded File Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfFileSpec123"',
      '',
      '--pdfFileSpec123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached PDF package.',
      '--pdfFileSpec123',
      'Content-Type: application/pdf; name="package.pdf"',
      'Content-Disposition: attachment; filename="package.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfFileSpec123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-filespec-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /package\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Embedded File: lease-summary\.xlsx/);
    assert.match(doc.normalized_text, /Embedded Description: Updated rent roll workbook/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts readable text from embedded pdf payload streams when present', () => {
    const pdfLike = Buffer.from([
      '%PDF-1.4',
      '1 0 obj',
      '<< /Type /Filespec /F (rent-roll.csv) /Desc (Embedded rent roll) >>',
      'endobj',
      '2 0 obj',
      '<< /Type /EmbeddedFile /Subtype /text#2Fcsv >>',
      'stream',
      'tenant,monthly_rent',
      'Dialysis Center,42000',
      'endstream',
      'endobj'
    ].join('\n'), 'utf8').toString('base64');
    const raw = [
      'Subject: PDF Embedded Payload Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfEmbeddedPayload123"',
      '',
      '--pdfEmbeddedPayload123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached PDF bundle.',
      '--pdfEmbeddedPayload123',
      'Content-Type: application/pdf; name="bundle.pdf"',
      'Content-Disposition: attachment; filename="bundle.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfEmbeddedPayload123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-embedded-payload-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /bundle\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Embedded File: rent-roll\.csv/);
    assert.match(doc.normalized_text, /Embedded Payload: tenant,monthly_rent/);
    assert.match(doc.normalized_text, /Embedded Payload: Dialysis Center,42000/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts OOXML text from embedded pdf payload streams when present', () => {
    const embeddedDocx = buildStoredZip([
      {
        name: 'word/document.xml',
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
          '<w:body>',
          '<w:p><w:r><w:t>Embedded DOCX Amendment</w:t></w:r></w:p>',
          '<w:p><w:r><w:t>Rate reset to 27500</w:t></w:r></w:p>',
          '</w:body>',
          '</w:document>'
        ].join('')
      }
    ]);
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fvnd.openxmlformats-officedocument.wordprocessingml.document >>\nstream\n', 'latin1'),
      embeddedDocx,
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ]);
    const pdfLike = pdfBuffer.toString('base64');
    const raw = [
      'Subject: PDF Embedded DOCX Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfEmbeddedDocx123"',
      '',
      '--pdfEmbeddedDocx123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached PDF bundle with DOCX.',
      '--pdfEmbeddedDocx123',
      'Content-Type: application/pdf; name="bundle-docx.pdf"',
      'Content-Disposition: attachment; filename="bundle-docx.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdfEmbeddedDocx123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-embedded-docx-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /bundle-docx\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Embedded Payload: Embedded DOCX Amendment/);
    assert.match(doc.normalized_text, /Embedded Payload: Rate reset to 27500/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts legacy office text from embedded pdf payload streams when present', () => {
    const legacyDoc = Buffer.from([
      'Word.Document',
      'Legacy amendment summary',
      'Annual Rent 330000',
      'Notice Period 120 Days'
    ].join('\n'), 'latin1');
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fmsword >>\nstream\n', 'latin1'),
      legacyDoc,
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ]);
    const raw = [
      'Subject: PDF Embedded Legacy Office Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfEmbeddedLegacy123"',
      '',
      '--pdfEmbeddedLegacy123',
      'Content-Type: application/pdf; name="bundle-legacy.pdf"',
      'Content-Disposition: attachment; filename="bundle-legacy.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfBuffer.toString('base64'),
      '--pdfEmbeddedLegacy123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-embedded-legacy.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /bundle-legacy\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Embedded Payload: Legacy amendment summary/);
    assert.match(doc.normalized_text, /Embedded Payload: Annual Rent 330000/);
    assert.match(doc.normalized_text, /Embedded Payload: Notice Period 120 Days/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts embedded email text from pdf payload streams when present', () => {
    const embeddedEmail = [
      'Subject: Embedded Approval',
      'From: analyst@example.com',
      'To: team@example.com',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Approval granted for the amendment package.'
    ].join('\r\n');
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /EmbeddedFile /Subtype /message#2Frfc822 >>\nstream\n', 'latin1'),
      Buffer.from(embeddedEmail, 'utf8'),
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ]);
    const raw = [
      'Subject: PDF Embedded Email Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfEmbeddedEmail123"',
      '',
      '--pdfEmbeddedEmail123',
      'Content-Type: application/pdf; name="bundle-email.pdf"',
      'Content-Disposition: attachment; filename="bundle-email.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfBuffer.toString('base64'),
      '--pdfEmbeddedEmail123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-embedded-email.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /bundle-email\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Embedded Payload: Subject: Embedded Approval/);
    assert.match(doc.normalized_text, /Embedded Payload: From: analyst@example.com/);
    assert.match(doc.normalized_text, /Embedded Payload: Approval granted for the amendment package/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts generic zip text from embedded pdf payload streams when present', () => {
    const embeddedZip = buildStoredZip([
      { name: 'notes.txt', content: 'Embedded package note for renewal review' },
      { name: 'rent-roll.csv', content: 'tenant,monthly_rent\nDialysis West,51000' },
      { name: 'summary.json', content: '{"status":"approved","term":"10 years"}' }
    ]);
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fzip >>\nstream\n', 'latin1'),
      embeddedZip,
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ]);
    const raw = [
      'Subject: PDF Embedded ZIP Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfEmbeddedZip123"',
      '',
      '--pdfEmbeddedZip123',
      'Content-Type: application/pdf; name="bundle-zip.pdf"',
      'Content-Disposition: attachment; filename="bundle-zip.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfBuffer.toString('base64'),
      '--pdfEmbeddedZip123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-embedded-zip.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /bundle-zip\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Embedded Payload: notes\.txt/);
    assert.match(doc.normalized_text, /Embedded Payload: Embedded package note for renewal review/);
    assert.match(doc.normalized_text, /Embedded Payload: rent-roll\.csv/);
    assert.match(doc.normalized_text, /Embedded Payload: Dialysis West,51000/);
    assert.match(doc.normalized_text, /Embedded Payload: summary\.json/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts embedded rtf text from pdf payload streams when present', () => {
    const embeddedRtf = String.raw`{\rtf1\ansi Embedded RTF Amendment\par Base Rent 61000\par Notice Period 90 Days}`;
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Frtf >>\nstream\n', 'latin1'),
      Buffer.from(embeddedRtf, 'utf8'),
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ]);
    const raw = [
      'Subject: PDF Embedded RTF Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfEmbeddedRtf123"',
      '',
      '--pdfEmbeddedRtf123',
      'Content-Type: application/pdf; name="bundle-rtf.pdf"',
      'Content-Disposition: attachment; filename="bundle-rtf.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfBuffer.toString('base64'),
      '--pdfEmbeddedRtf123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-embedded-rtf.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /bundle-rtf\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Embedded Payload: Embedded RTF Amendment/);
    assert.match(doc.normalized_text, /Embedded Payload: Base Rent 61000/);
    assert.match(doc.normalized_text, /Embedded Payload: Notice Period 90 Days/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts embedded calendar text from pdf payload streams when present', () => {
    const embeddedIcs = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Lease Review Call',
      'DTSTART:20260414T150000Z',
      'DTEND:20260414T153000Z',
      'LOCATION:Teams',
      'DESCRIPTION:Review renewal pricing and notice dates',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fcalendar >>\nstream\n', 'latin1'),
      Buffer.from(embeddedIcs, 'utf8'),
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ]);
    const raw = [
      'Subject: PDF Embedded ICS Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfEmbeddedIcs123"',
      '',
      '--pdfEmbeddedIcs123',
      'Content-Type: application/pdf; name="bundle-ics.pdf"',
      'Content-Disposition: attachment; filename="bundle-ics.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfBuffer.toString('base64'),
      '--pdfEmbeddedIcs123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-embedded-ics.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /bundle-ics\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Embedded Payload: Lease Review Call/);
    assert.match(doc.normalized_text, /Embedded Payload: Start: 20260414T150000Z/);
    assert.match(doc.normalized_text, /Embedded Payload: Location: Teams/);
    assert.match(doc.normalized_text, /Embedded Payload: Description: Review renewal pricing and notice dates/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts embedded delimited text from pdf payload streams when present', () => {
    const embeddedTsv = [
      'tenant\tmonthly_rent\tnotice_days',
      'Dialysis North\t72000\t120',
      'Dialysis South\t68000\t90'
    ].join('\r\n');
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Ftab-separated-values >>\nstream\n', 'latin1'),
      Buffer.from(embeddedTsv, 'utf8'),
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ]);
    const raw = [
      'Subject: PDF Embedded TSV Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfEmbeddedTsv123"',
      '',
      '--pdfEmbeddedTsv123',
      'Content-Type: application/pdf; name="bundle-tsv.pdf"',
      'Content-Disposition: attachment; filename="bundle-tsv.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfBuffer.toString('base64'),
      '--pdfEmbeddedTsv123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-embedded-tsv.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /bundle-tsv\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Embedded Payload: tenant \| monthly_rent \| notice_days/);
    assert.match(doc.normalized_text, /Embedded Payload: Dialysis North \| 72000 \| 120/);
    assert.match(doc.normalized_text, /Embedded Payload: Dialysis South \| 68000 \| 90/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts embedded yaml text from pdf payload streams when present', () => {
    const embeddedYaml = [
      'status: approved',
      'tenant: Dialysis East',
      'monthly_rent: 84500',
      'notice_days: 180'
    ].join('\n');
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fx-yaml >>\nstream\n', 'latin1'),
      Buffer.from(embeddedYaml, 'utf8'),
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ]);
    const raw = [
      'Subject: PDF Embedded YAML Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfEmbeddedYaml123"',
      '',
      '--pdfEmbeddedYaml123',
      'Content-Type: application/pdf; name="bundle-yaml.pdf"',
      'Content-Disposition: attachment; filename="bundle-yaml.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfBuffer.toString('base64'),
      '--pdfEmbeddedYaml123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-embedded-yaml.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /bundle-yaml\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Embedded Payload: status: approved/);
    assert.match(doc.normalized_text, /Embedded Payload: tenant: Dialysis East/);
    assert.match(doc.normalized_text, /Embedded Payload: monthly_rent: 84500/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('returns embedded pdf images as extracted attachments for email pdf bundles', () => {
    const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /EmbeddedFile /Subtype /image#2Fpng >>\nstream\n', 'latin1'),
      imageBuffer,
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ]);
    const raw = [
      'Subject: PDF Embedded Image Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdfEmbeddedImage123"',
      '',
      '--pdfEmbeddedImage123',
      'Content-Type: application/pdf; name="bundle-image.pdf"',
      'Content-Disposition: attachment; filename="bundle-image.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfBuffer.toString('base64'),
      '--pdfEmbeddedImage123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-embedded-image.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.equal(Array.isArray(doc.extracted_attachments), true);
    assert.equal(doc.extracted_attachments.length, 1);
    assert.equal(doc.extracted_attachments[0].mime_type, 'image/png');
    assert.match(doc.extracted_attachments[0].data_url, /^data:image\/png;base64,/);
  });

  it('returns embedded pdf images as extracted attachments for direct pdf intake', () => {
    const imageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /EmbeddedFile /Subtype /image#2Fjpeg >>\nstream\n', 'latin1'),
      imageBuffer,
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ]);

    const doc = normalizeLiveIngestDocument({
      name: 'bundle-direct.pdf',
      mime_type: 'application/pdf',
      buffer_base64: pdfBuffer.toString('base64')
    });

    assert.equal(doc.source_kind, 'pdf');
    assert.equal(doc.extracted_attachments.length, 1);
    assert.equal(doc.extracted_attachments[0].mime_type, 'image/jpeg');
    assert.match(doc.extracted_attachments[0].data_url, /^data:image\/jpeg;base64,/);
  });

  it('extracts readable text from attached docx payloads when present', () => {
    const docxLike = buildStoredZip([
      {
        name: 'word/document.xml',
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
          '<w:body>',
          '<w:p><w:r><w:t>Dialysis lease amendment</w:t></w:r><w:r><w:commentReference w:id="0"/></w:r></w:p>',
          '<w:p><w:ins w:author="Alex" w:date="2026-03-20T10:00:00Z"><w:r><w:t>Inserted clause text</w:t></w:r></w:ins></w:p>',
          '<w:p><w:del w:author="Alex" w:date="2026-03-21T11:30:00Z"><w:r><w:delText>Removed legacy rate</w:delText></w:r></w:del></w:p>',
          '<w:p><w:r><w:t>Rate reset on 2026-06-01</w:t></w:r></w:p>',
          '</w:body>',
          '</w:document>'
        ].join(''),
      },
      {
        name: 'word/comments.xml',
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
          '<w:comment w:id="0"><w:p><w:r><w:t>Signed copy received</w:t></w:r></w:p></w:comment>',
          '</w:comments>'
        ].join(''),
      }
    ]).toString('base64');

    const raw = [
      'Subject: DOCX Attachment Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="docx123"',
      '',
      '--docx123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached amendment.',
      '--docx123',
      'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="amendment.docx"',
      'Content-Disposition: attachment; filename="amendment.docx"',
      'Content-Transfer-Encoding: base64',
      '',
      docxLike,
      '--docx123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'docx-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /amendment\.docx \(application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\)/);
    assert.match(doc.normalized_text, /Attachment content excerpts:/);
    assert.match(doc.normalized_text, /Dialysis lease amendment/);
    assert.match(doc.normalized_text, /\[Inserted by Alex on 2026-03-20T10:00:00Z: Inserted clause text\]/);
    assert.match(doc.normalized_text, /\[Deleted by Alex on 2026-03-21T11:30:00Z: Removed legacy rate\]/);
    assert.match(doc.normalized_text, /Rate reset on 2026-06-01/);
    assert.match(doc.normalized_text, /\[Comment: Signed copy received\]/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('returns attached email images as extracted image attachments', () => {
    const imagePayload = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).toString('base64');
    const raw = [
      'Subject: Image Attachment Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="img123"',
      '',
      '--img123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached site photo.',
      '--img123',
      'Content-Type: image/png; name="site-photo.png"',
      'Content-Disposition: attachment; filename="site-photo.png"',
      'Content-Transfer-Encoding: base64',
      '',
      imagePayload,
      '--img123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'image-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /site-photo\.png \(image\/png\)/);
    assert.equal(Array.isArray(doc.extracted_attachments), true);
    assert.equal(doc.extracted_attachments.length, 1);
    assert.equal(doc.extracted_attachments[0].kind, 'image');
    assert.equal(doc.extracted_attachments[0].mime_type, 'image/png');
    assert.match(doc.extracted_attachments[0].data_url, /^data:image\/png;base64,/);
  });

  it('extracts readable text from attached xlsx payloads when present', () => {
    const xlsxLike = buildStoredZip([
      {
        name: 'xl/workbook.xml',
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
          '<sheets><sheet name="Rent Roll" sheetId="1" r:id="rId1"/></sheets>',
          '</workbook>'
        ].join('')
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
          '</Relationships>'
        ].join('')
      },
      {
        name: 'xl/sharedStrings.xml',
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<sst>',
          '<si><t>tenant</t></si>',
          '<si><t>rent</t></si>',
          '<si><t>Alpha Clinic</t></si>',
          '</sst>'
        ].join('')
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<worksheet><sheetData>',
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>14500</v></c></row>',
          '</sheetData></worksheet>'
        ].join('')
      }
    ]).toString('base64');

    const raw = [
      'Subject: XLSX Attachment Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="xlsx123"',
      '',
      '--xlsx123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached rent roll.',
      '--xlsx123',
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="rent-roll.xlsx"',
      'Content-Disposition: attachment; filename="rent-roll.xlsx"',
      'Content-Transfer-Encoding: base64',
      '',
      xlsxLike,
      '--xlsx123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'xlsx-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /rent-roll\.xlsx \(application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\)/);
    assert.match(doc.normalized_text, /Rent Roll/);
    assert.match(doc.normalized_text, /tenant\s+rent/);
    assert.match(doc.normalized_text, /Alpha Clinic\s+14500/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts readable text from attached pptx payloads when present', () => {
    const pptxLike = buildStoredZip([
      {
        name: 'ppt/presentation.xml',
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
          '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>',
          '</p:presentation>'
        ].join('')
      },
      {
        name: 'ppt/_rels/presentation.xml.rels',
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>',
          '</Relationships>'
        ].join('')
      },
      {
        name: 'ppt/slides/slide1.xml',
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
          '<p:cSld><p:spTree><p:sp><p:txBody>',
          '<a:p><a:r><a:t>Operator update</a:t></a:r></a:p>',
          '<a:p><a:r><a:t>Renewal target rent 16500</a:t></a:r></a:p>',
          '</p:txBody></p:sp></p:spTree></p:cSld>',
          '</p:sld>'
        ].join('')
      },
      {
        name: 'ppt/notesSlides/notesSlide1.xml',
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
          '<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Discuss with landlord next week</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>',
          '</p:notes>'
        ].join('')
      }
    ]).toString('base64');

    const raw = [
      'Subject: PPTX Attachment Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pptx123"',
      '',
      '--pptx123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached deck.',
      '--pptx123',
      'Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation; name="market-deck.pptx"',
      'Content-Disposition: attachment; filename="market-deck.pptx"',
      'Content-Transfer-Encoding: base64',
      '',
      pptxLike,
      '--pptx123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pptx-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /market-deck\.pptx \(application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation\)/);
    assert.match(doc.normalized_text, /Slide 1/);
    assert.match(doc.normalized_text, /Operator update/);
    assert.match(doc.normalized_text, /Renewal target rent 16500/);
    assert.match(doc.normalized_text, /Discuss with landlord next week/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts readable text from attached legacy doc payloads when present', () => {
    const docLike = Buffer.concat([
      Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
      Buffer.from('Legacy lease memo\nTenant Alpha Clinic\nRenewal rate 18250\n', 'latin1'),
      Buffer.from('Signed copy received', 'utf16le')
    ]).toString('base64');

    const raw = [
      'Subject: DOC Attachment Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="doc123"',
      '',
      '--doc123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached legacy memo.',
      '--doc123',
      'Content-Type: application/msword; name="legacy-memo.doc"',
      'Content-Disposition: attachment; filename="legacy-memo.doc"',
      'Content-Transfer-Encoding: base64',
      '',
      docLike,
      '--doc123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'doc-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /legacy-memo\.doc \(application\/msword\)/);
    assert.match(doc.normalized_text, /Legacy Word text preview/);
    assert.match(doc.normalized_text, /Tenant Alpha Clinic/);
    assert.match(doc.normalized_text, /Renewal rate 18250/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts readable text from attached legacy xls payloads when present', () => {
    const xlsLike = Buffer.concat([
      Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
      Buffer.from('Legacy rent roll\nTenant\tRent\nAlpha Clinic\t14500\n', 'latin1'),
      Buffer.from('Beta Clinic\t16750', 'utf16le')
    ]).toString('base64');

    const raw = [
      'Subject: XLS Attachment Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="xls123"',
      '',
      '--xls123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached legacy workbook.',
      '--xls123',
      'Content-Type: application/vnd.ms-excel; name="legacy-rent-roll.xls"',
      'Content-Disposition: attachment; filename="legacy-rent-roll.xls"',
      'Content-Transfer-Encoding: base64',
      '',
      xlsLike,
      '--xls123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'xls-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /legacy-rent-roll\.xls \(application\/vnd\.ms-excel\)/);
    assert.match(doc.normalized_text, /Legacy Excel text preview/);
    assert.match(doc.normalized_text, /Tenant\s+Rent/);
    assert.match(doc.normalized_text, /Alpha Clinic/);
    assert.match(doc.normalized_text, /14500/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts readable text from attached legacy ppt payloads when present', () => {
    const pptLike = Buffer.concat([
      Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
      Buffer.from('Legacy deck overview\nOperator update\nRent target 17500\n', 'latin1'),
      Buffer.from('Discuss next committee meeting', 'utf16le')
    ]).toString('base64');

    const raw = [
      'Subject: PPT Attachment Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="ppt123"',
      '',
      '--ppt123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached legacy deck.',
      '--ppt123',
      'Content-Type: application/vnd.ms-powerpoint; name="legacy-deck.ppt"',
      'Content-Disposition: attachment; filename="legacy-deck.ppt"',
      'Content-Transfer-Encoding: base64',
      '',
      pptLike,
      '--ppt123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'ppt-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /legacy-deck\.ppt \(application\/vnd\.ms-powerpoint\)/);
    assert.match(doc.normalized_text, /Legacy PowerPoint text preview/);
    assert.match(doc.normalized_text, /Operator update/);
    assert.match(doc.normalized_text, /Rent target 17500/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });
});

describe('normalizeLiveIngestDocuments', () => {
  it('truncates and filters normalized documents', () => {
    const docs = normalizeLiveIngestDocuments([
      { name: 'one.txt', mime_type: 'text/plain', text: 'alpha' },
      null,
      { name: 'two.txt', mime_type: 'text/plain', text: '' }
    ]);

    assert.equal(docs.length, 1);
    assert.equal(docs[0].normalized_text, 'alpha');
  });
});
