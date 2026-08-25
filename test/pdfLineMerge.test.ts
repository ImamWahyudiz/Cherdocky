import { describe, it, expect } from 'vitest';
import { mergePdfItemsIntoLines, type RawTextItem } from '~/utils/pdfLineMerge';

function item(str: string, x: number, baselineY: number, width: number, fontHeight = 20): RawTextItem {
  return { str, x, baselineY, width, fontHeight };
}

describe('mergePdfItemsIntoLines', () => {
  it('rejoins kerning-split fragments of one word without spaces', () => {
    const lines = mergePdfItemsIntoLines([
      item('ja', 100, 200, 14),
      item('lan', 114, 200, 18),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].str).toBe('jalan');
    expect(lines[0].x).toBe(100);
    // width spans from first fragment start to last fragment end
    expect(lines[0].width).toBe(32);
  });

  it('inserts a space for visible gaps within a line', () => {
    const lines = mergePdfItemsIntoLines([
      item('Jalan', 100, 200, 40),
      item('Kenanga', 150, 200, 60),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].str).toBe('Jalan Kenanga');
  });

  it('keeps separate lines apart by baseline tolerance', () => {
    const lines = mergePdfItemsIntoLines([
      item('baris', 100, 200, 30),
      item('dua', 100, 230, 24),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.str)).toEqual(['baris', 'dua']);
  });

  it('does not merge words across a column gap on the same baseline', () => {
    const lines = mergePdfItemsIntoLines([
      item('Nama', 100, 200, 35),
      item('Alamat', 400, 200, 45),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].str).toBe('Nama Alamat');
    // column distance preserved in total width
    expect(lines[0].width).toBe(345);
  });

  it('drops whitespace-only items', () => {
    const lines = mergePdfItemsIntoLines([
      item(' ', 100, 200, 8),
      item('kata', 108, 200, 26),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].str).toBe('kata');
  });

  it('returns empty for no input', () => {
    expect(mergePdfItemsIntoLines([])).toEqual([]);
  });
});
