import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Domain,
  DomainTransferOut,
  RegistrarMeta,
} from '../../../shared/ipc';

// What the store holds; the component reads it through the selector.
const state = {
  registrars: null as RegistrarMeta[] | null,
  mutating: {} as Record<string, boolean>,
  transfersOut: {} as Record<string, DomainTransferOut | null>,
  applyDomainOp: vi.fn(),
  loadTransferOut: vi.fn(),
};
vi.mock('../../store/app', () => ({
  useAppStore: (select: (s: typeof state) => unknown) => select(state),
}));
const { SaleApproveTransfer } = await import('./SaleApproveTransfer');

const domain = (patch: Partial<Domain> = {}): Domain => ({
  registrar: 'dynadot',
  domainName: 'sold.com',
  status: 'active',
  createdDate: null,
  expirationDate: null,
  renewalDate: null,
  autoRenew: true,
  locked: false,
  privacy: false,
  nameservers: [],
  syncedAt: new Date(0),
  deleted: false,
  source: 'registrar',
  ...patch,
});
const html = (d: Domain = domain()) =>
  renderToStaticMarkup(createElement(SaleApproveTransfer, { domain: d }));

const DYNADOT = {
  name: 'dynadot',
  displayName: 'Dynadot',
  features: ['getTransferOut', 'approveTransferOut'],
} as unknown as RegistrarMeta;
const transfer = (
  patch: Partial<DomainTransferOut> = {},
): DomainTransferOut => ({
  status: 'pending',
  rawStatus: 'Waiting For Approval',
  requestedAt: '2026-10-29T12:00:00.000Z',
  expiresAt: '2026-11-03T12:00:00.000Z',
  completedAt: null,
  ...patch,
});

beforeEach(() => {
  state.registrars = [DYNADOT];
  state.mutating = {};
  state.transfersOut = {};
});

describe('SaleApproveTransfer', () => {
  it('offers Approve transfer while the registrar holds a request', () => {
    state.transfersOut = { 'dynadot:sold.com': transfer() };
    const out = html();
    expect(out).toContain('>Approve transfer</button>');
    expect(out).not.toContain('disabled=""');
    expect(out).toContain('left alone, Dynadot lets it go on 2026-11-0');
  });

  it('shows nothing before the read, or with no request', () => {
    expect(html()).toBe('');
    state.transfersOut = { 'dynadot:sold.com': null };
    expect(html()).toBe('');
  });

  it('shows nothing once the request is answered or done', () => {
    for (const status of ['approved', 'completed', 'rejected'] as const) {
      state.transfersOut = { 'dynadot:sold.com': transfer({ status }) };
      expect(html()).toBe('');
    }
  });

  it('shows nothing where the registrar can’t report a transfer-out', () => {
    state.registrars = [
      { name: 'porkbun', features: [] } as unknown as RegistrarMeta,
    ];
    state.transfersOut = { 'porkbun:sold.com': transfer() };
    expect(html(domain({ registrar: 'porkbun' }))).toBe('');
  });

  it('waits while another write on the name runs', () => {
    state.transfersOut = { 'dynadot:sold.com': transfer() };
    state.mutating = { 'dynadot:sold.com': true };
    expect(html()).toContain('disabled=""');
  });
});
