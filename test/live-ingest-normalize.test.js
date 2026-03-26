import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
