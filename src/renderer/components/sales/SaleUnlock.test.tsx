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
const { SaleUnlock } = await import('./SaleUnlock');

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
});

describe('SaleUnlock', () => {
  it('offers Unlock on a locked name', () => {
    const out = html(domain());
    expect(out).toContain('>Unlock</button>');
    expect(out).not.toContain('disabled=""');
  });

  it('shows nothing once the name is unlocked', () => {
    expect(html(domain({ locked: false }))).toBe('');
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

  it('reads Unlocking… while the registrar is asked', () => {
    state.mutating = { 'dynadot:sold.com': true };
    const out = html(domain());
    expect(out).toContain('Unlocking…');
    expect(out).toContain('disabled=""');
  });
});
