import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Domain, RegistrarMeta } from '../../../shared/ipc';

const state = { registrars: null, loadMarkets: vi.fn() };
vi.mock('../../store/app', () => ({
  useAppStore: (select: (s: typeof state) => unknown) => select(state),
}));
const { SaleAuthCode, pastedAuthCodeFrom } = await import('./SaleAuthCode');

const html = (props: {
  pasteFrom?: string | null;
  waitingOn?: string | null;
}) =>
  renderToStaticMarkup(
    createElement(SaleAuthCode, {
      accountId: 'afternic',
      saleId: 's1',
      name: 'sold.com',
      ...props,
    }),
  );

describe('SaleAuthCode', () => {
  it('offers Send auth code where DomBot gets the code', () => {
    const out = html({});
    expect(out).toContain('>Send auth code</button>');
    expect(out).not.toContain('<input');
  });

  it('takes the code pasted in, from the start, where it can’t', () => {
    const out = html({ pasteFrom: 'Namecheap' });
    expect(out).toContain('<input');
    expect(out).toContain('>Send</button>');
    // On while the box is empty, so the box reads as the step.
    expect(out).not.toContain('disabled=""');
    expect(out).toContain('placeholder="Paste auth code"');
    expect(out).not.toContain('Send auth code');
    expect(out).toContain(
      'Paste the auth code from Namecheap to send it to the market',
    );
  });

  it('names no registrar when no one account holds the name', () => {
    expect(html({ pasteFrom: '' })).toContain(
      'Paste the auth code to send it to the market',
    );
  });

  it('waits, disabled with the reason, for Unlock', () => {
    const waitingOn = 'Unlock the name first';
    const out = html({ pasteFrom: 'Namecheap', waitingOn });
    expect(out).toContain(`title="${waitingOn}"`);
    expect(out).toMatch(/<input[^>]*disabled=""/);
    expect(html({ waitingOn })).toContain('disabled=""');
  });
});

describe('pastedAuthCodeFrom', () => {
  const meta = (name: string, displayName: string, features: string[]) =>
    ({ name, displayName, features }) as unknown as RegistrarMeta;
  const registrars = [
    meta('dynadot', 'Dynadot', ['getAuthCode']),
    meta('namecheap', 'Namecheap', []),
  ];
  const at = (registrar: string) => ({ registrar }) as Domain;

  it('is null where the registrar gives the code out', () => {
    expect(pastedAuthCodeFrom(at('dynadot'), registrars)).toBeNull();
  });

  it('names the registrar where its API doesn’t', () => {
    expect(pastedAuthCodeFrom(at('namecheap'), registrars)).toBe('Namecheap');
  });

  it('is empty when no one account holds the name', () => {
    expect(pastedAuthCodeFrom(undefined, registrars)).toBe('');
    expect(pastedAuthCodeFrom(null, registrars)).toBe('');
  });
});
