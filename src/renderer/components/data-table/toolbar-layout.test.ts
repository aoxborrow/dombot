import { describe, expect, it } from 'vitest';
import { toolbarLayout, type ToolbarWidths } from './toolbar-layout';

// A switch of 300, a search of 100, three chips of 100 and a square add
// button of 36, 10 apart: 300 + 100 + 300 + 36 + 5 × 10 = 786 on one line.
const base: ToolbarWidths = {
  width: 1000,
  gap: 10,
  switch: 300,
  search: 100,
  chips: [
    { key: 'registrar', width: 100, ifRoom: false },
    { key: 'price', width: 100, ifRoom: true },
    { key: 'expires', width: 100, ifRoom: true },
  ],
  add: 36,
};
const at = (width: number, patch: Partial<ToolbarWidths> = {}) => {
  const out = toolbarLayout({ ...base, ...patch, width });
  return { switchAbove: out.switchAbove, hidden: [...out.hidden] };
};

describe('toolbarLayout', () => {
  it('keeps everything on one line while it fits', () => {
    expect(at(786)).toEqual({ switchAbove: false, hidden: [] });
  });

  it('drops the if-room chips, last first, before moving the switch', () => {
    expect(at(785)).toEqual({ switchAbove: false, hidden: ['expires'] });
    expect(at(676)).toEqual({ switchAbove: false, hidden: ['expires'] });
    expect(at(675)).toEqual({
      switchAbove: false,
      hidden: ['price', 'expires'],
    });
  });

  it('then puts the switch above, the if-room chips back where they fit', () => {
    // Without the switch: 100 + 300 + 36 + 4 × 10 = 476 with every chip.
    expect(at(565)).toEqual({ switchAbove: true, hidden: [] });
    expect(at(475)).toEqual({ switchAbove: true, hidden: ['expires'] });
    expect(at(300)).toEqual({
      switchAbove: true,
      hidden: ['price', 'expires'],
    });
  });

  it('brings if-room chips back in order, a later one never before', () => {
    // Price is wider than Expires: once Price doesn't fit, neither shows.
    const chips = [
      { key: 'registrar', width: 100, ifRoom: false },
      { key: 'price', width: 200, ifRoom: true },
      { key: 'expires', width: 50, ifRoom: true },
    ];
    expect(at(400, { chips })).toEqual({
      switchAbove: true,
      hidden: ['price', 'expires'],
    });
  });

  it('with no switch, leaves out if-room chips and lets the rest wrap', () => {
    expect(at(475, { switch: 0 })).toEqual({
      switchAbove: false,
      hidden: ['expires'],
    });
    expect(at(200, { switch: 0 })).toEqual({
      switchAbove: false,
      hidden: ['price', 'expires'],
    });
  });

  it('on a phone, where the search has a line, fits chips beside the add button', () => {
    // 300 + 36 + 3 × 10 = 366 for every chip on their line.
    expect(at(366, { search: null })).toEqual({
      switchAbove: true,
      hidden: [],
    });
    expect(at(300, { search: null })).toEqual({
      switchAbove: true,
      hidden: ['expires'],
    });
  });

  it('moves the switch for a lone filter that doesn’t fit beside it', () => {
    const chips = [{ key: 'registrar', width: 224, ifRoom: false }];
    // 300 + 100 + 224 + 36 + 30 = 690.
    expect(at(690, { chips }).switchAbove).toBe(false);
    expect(at(689, { chips }).switchAbove).toBe(true);
  });
});
