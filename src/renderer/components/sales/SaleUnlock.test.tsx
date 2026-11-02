import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Domain, RegistrarMeta } from '../../../shared/ipc';

// What the store holds; the hook reads it through the selector.
const state = {
  registrars: null as RegistrarMeta[] | null,
  mutating: {} as Record<string, boolean>,
  applyDomainOp: vi.fn(),
};
vi.mock('../../store/app', () => ({
  useAppStore: (select: (s: typeof state) => unknown) => select(state),
}));
// A static render can't click, so this seeds the button's own Unlocking state.
let clicked = false;
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: (init: unknown) => [clicked || init, vi.fn()] };
});
const { SaleUnlock, waitsForUnlock } = await import('./SaleUnlock');

const domain = (patch: Partial<Domain> = {}): Domain => ({
  registrar: 'dynadot',
  domainName: 'sold.com',
  status: 'active',
  createdDate: null,
  expirationDate: null,
  renewalDate: null,
  autoRenew: true,
  locked: true,
  privacy: false,
  nameservers: [],
  syncedAt: new Date(0),
  deleted: false,
  source: 'registrar',
  ...patch,
});
const html = (d: Domain) =>
  renderToStaticMarkup(createElement(SaleUnlock, { domain: d }));

beforeEach(() => {
  state.registrars = null;
  state.mutating = {};
  clicked = false;
});

describe('SaleUnlock', () => {
  it('offers Unlock on a locked name', () => {
    const out = html(domain());
    expect(out).toContain('>Unlock</button>');
    expect(out).not.toContain('disabled=""');
  });

  it('reads Unlocked, disabled, once the name is unlocked', () => {
    const out = html(domain({ locked: false }));
    expect(out).toContain('>Unlocked</button>');
    expect(out).toContain('disabled=""');
  });

  it('is disabled, with the reason, where the API can’t unlock', () => {
    state.registrars = [
      { name: 'porkbun', features: [] } as unknown as RegistrarMeta,
    ];
    const out = html(domain({ registrar: 'porkbun' }));
    expect(out).toContain('disabled=""');
    expect(out).toContain(
      'Porkbun’s API can’t change this after registration.',
    );
  });

  it('reads Unlocking… while its own write runs', () => {
    clicked = true;
    state.mutating = { 'dynadot:sold.com': true };
    const out = html(domain());
    expect(out).toContain('Unlocking…');
    expect(out).toContain('disabled=""');
  });

  it('waits, without reading Unlocking…, while another write runs', () => {
    state.mutating = { 'dynadot:sold.com': true };
    const out = html(domain());
    expect(out).toContain('>Unlock</button>');
    expect(out).toContain('disabled=""');
  });

  it('stays Unlocked while another write on the name runs', () => {
    state.mutating = { 'dynadot:sold.com': true };
    const out = html(domain({ locked: false }));
    expect(out).toContain('>Unlocked</button>');
    expect(out).not.toContain('Unlocking…');
  });
});

describe('waitsForUnlock', () => {
  const dynadot = {
    name: 'dynadot',
    features: [],
  } as unknown as RegistrarMeta;
  const porkbun = {
    name: 'porkbun',
    features: [],
  } as unknown as RegistrarMeta;

  it('holds the next steps while DomBot can unlock a locked name', () => {
    expect(waitsForUnlock(domain(), [dynadot])).toBe(true);
    expect(waitsForUnlock(domain({ locked: false }), [dynadot])).toBe(false);
  });

  it('doesn’t hold them where the API can’t unlock, or the name is unknown', () => {
    expect(waitsForUnlock(domain({ registrar: 'porkbun' }), [porkbun])).toBe(
      false,
    );
    expect(waitsForUnlock(undefined, [dynadot])).toBe(false);
  });
});
