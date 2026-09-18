import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { redactNativePdfText } from '../src/utils/redactor';
import type { SpatialWord } from '../src/utils/ocrEngine';

function extractAllPageStreamTexts(doc: PDFDocument): string {
  let text = '';
  for (const page of doc.getPages()) {
    const contents = (page.node as any).Contents();
    if (!contents) continue;
    const refs = contents instanceof PDFArray
      ? contents.asArray()
      : Array.isArray(contents)
      ? contents
      : [contents];
    for (const ref of refs) {
      const stream = doc.context.lookup(ref);
      if (stream instanceof PDFRawStream) {
        try {
          const decoded = decodePDFRawStream(stream).decode();
          text += new TextDecoder('latin1').decode(decoded) + '\n';
        } catch {
          text += new TextDecoder('latin1').decode(stream.getContents()) + '\n';
        }
      }
    }
  }
  const converted = text.replace(/<([0-9a-fA-F]+)>/g, (_, hex) => {
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return new TextDecoder('latin1').decode(new Uint8Array(bytes));
  });
  return text + '\n' + converted;
}

describe('redactNativePdfText', () => {
  it('does NOT redact words when forceRedact is explicitly false, even if auto-detected as PII', async () => {
    // Create a minimal PDF document with text
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    // Draw text: an email and a normal word
    page.drawText('test@example.com', { x: 50, y: 300, size: 12 });
    page.drawText('keep-me', { x: 50, y: 200, size: 12 });
    const pdfBytes = await pdfDoc.save();

    const words: SpatialWord[] = [
      {
        text: 'test@example.com',
        x: 50 * 1.5,
        y: (400 - 300 - 12) * 1.5,
        width: 100 * 1.5,
        height: 12 * 1.5,
        confidence: 100,
        pageIndex: 1,
        forceRedact: false, // User explicitly unselected this auto-detected PII!
      },
      {
        text: 'keep-me',
        x: 50 * 1.5,
        y: (400 - 200 - 12) * 1.5,
        width: 60 * 1.5,
        height: 12 * 1.5,
        confidence: 100,
        pageIndex: 1,
        forceRedact: false,
      },
    ];

    const redactedBlob = await redactNativePdfText(
      new Blob([pdfBytes], { type: 'application/pdf' }),
      words,
      ['email'], // email is active, so test@example.com WOULD be auto-detected if not for forceRedact: false
      undefined,
      [],
      '#000000'
    );

    const redactedArrayBuffer = await redactedBlob.arrayBuffer();
    const resultDoc = await PDFDocument.load(redactedArrayBuffer);
    const rawText = extractAllPageStreamTexts(resultDoc);

    expect(rawText).toContain('test@example.com');
  });

  it('redacts words when forceRedact is true', async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    page.drawText('sensitive-data', { x: 50, y: 300, size: 12 });
    const pdfBytes = await pdfDoc.save();

    const words: SpatialWord[] = [
      {
        text: 'sensitive-data',
        x: 50 * 1.5,
        y: (400 - 300 - 12) * 1.5,
        width: 100 * 1.5,
        height: 12 * 1.5,
        confidence: 100,
        pageIndex: 1,
        forceRedact: true, // User selected to redact
      },
    ];

    const redactedBlob = await redactNativePdfText(
      new Blob([pdfBytes], { type: 'application/pdf' }),
      words,
      [],
      undefined,
      [],
      '#000000'
    );

    const redactedArrayBuffer = await redactedBlob.arrayBuffer();
    const resultDoc = await PDFDocument.load(redactedArrayBuffer);
    const rawText = extractAllPageStreamTexts(resultDoc);

    // sensitive-data was scrubbed from text stream
    expect(rawText).not.toContain('sensitive-data');
  });

  it('does NOT scrub unredacted text even if another word with same text was redacted', async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    page.drawText('Jakarta', { x: 50, y: 300, size: 12 });
    page.drawText('Jakarta', { x: 50, y: 200, size: 12 });
    const pdfBytes = await pdfDoc.save();

    const words: SpatialWord[] = [
      {
        text: 'Jakarta',
        x: 50 * 1.5,
        y: (400 - 300 - 12) * 1.5,
        width: 60 * 1.5,
        height: 12 * 1.5,
        confidence: 100,
        pageIndex: 1,
        forceRedact: true,
      },
      {
        text: 'Jakarta',
        x: 50 * 1.5,
        y: (400 - 200 - 12) * 1.5,
        width: 60 * 1.5,
        height: 12 * 1.5,
        confidence: 100,
        pageIndex: 1,
        forceRedact: false, // User explicitly unselected this instance
      },
    ];

    const redactedBlob = await redactNativePdfText(
      new Blob([pdfBytes], { type: 'application/pdf' }),
      words,
      [],
      undefined,
      [],
      '#000000'
    );

    const redactedArrayBuffer = await redactedBlob.arrayBuffer();
    const resultDoc = await PDFDocument.load(redactedArrayBuffer);
    const rawText = extractAllPageStreamTexts(resultDoc);

    // Because Jakarta is kept in word 2, it must not be blindly scrubbed from the stream
    expect(rawText).toContain('Jakarta');
  });
});
