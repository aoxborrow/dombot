import { describe, expect, it } from 'vitest';
import { autoRenewChoice } from './auto-renew';

describe('autoRenewChoice', () => {
  it('reads on and off from the registrar', () => {
    expect(autoRenewChoice({ autoRenew: true })).toBe('on');
    expect(autoRenewChoice({ autoRenew: false })).toBe('off');
  });

  it('is unknown for a name you added, whatever its flag says', () => {
    expect(autoRenewChoice({ autoRenew: false, autoRenewUnknown: true })).toBe(
      'unknown',
    );
    expect(autoRenewChoice({ autoRenew: true, autoRenewUnknown: true })).toBe(
      'unknown',
    );
  });
});
