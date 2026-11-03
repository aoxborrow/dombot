import { describe, expect, it } from 'vitest';
import type { MarketAccountView, MarketInfo } from '../../shared/markets';
import {
  recheckAccounts,
  txtAccounts,
  txtValueOf,
} from './ownership-verification';

const account = (
  id: string,
  market: MarketAccountView['market'],
  extra: Partial<MarketAccountView> = {},
) =>
  ({
    id,
    market,
    label: id,
    enabled: true,
    configured: true,
    createdAt: 0,
    sync: null,
    ...extra,
  }) as MarketAccountView;

const catalog = [
  { id: 'afternic', capabilities: { relist: true, verifyDns: false } },
  { id: 'atom', capabilities: { relist: false, verifyDns: true } },
  { id: 'sedo', capabilities: { relist: false, verifyDns: false } },
] as unknown as Pick<MarketInfo, 'id' | 'capabilities'>[];

describe('txtAccounts', () => {
  it('offers only enabled accounts with an ID saved', () => {
    const accounts = [
      account('a', 'afternic', { verificationId: 'Abc1' }),
      account('s', 'sedo'),
      account('t', 'atom', {
        verificationId: 'de30de30de30de30de30de30de30de30de30de30',
        enabled: false,
      }),
    ];
    expect(txtAccounts(accounts).map((a) => a.id)).toEqual(['a']);
    expect(txtValueOf(accounts[0])).toBe('afternic-verification-Abc1');
  });
});

describe('recheckAccounts', () => {
  it('offers markets that can be asked to check, never Sedo', () => {
    const accounts = [
      account('a', 'afternic'),
      account('t', 'atom'),
      account('s', 'sedo'),
      account('unkeyed', 'atom', { configured: false }),
    ];
    expect(recheckAccounts(accounts, catalog).map((a) => a.id)).toEqual([
      'a',
      't',
    ]);
  });
});
