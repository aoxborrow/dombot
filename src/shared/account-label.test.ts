import { describe, expect, it } from 'vitest';
import {
  accountDisplayLabel,
  accountNumber,
  accountSuffix,
  accountTitle,
  autoLabel,
  isAutoLabel,
} from './account-label';

describe('account labels on screen', () => {
  it('reads every label DomBot assigned as a number', () => {
    expect(accountNumber('Default')).toBe(1);
    expect(accountNumber('Main')).toBe(1);
    expect(accountNumber(' main ')).toBe(1);
    expect(accountNumber(undefined)).toBe(1);
    expect(accountNumber('')).toBe(1);
    expect(accountNumber('Account 2')).toBe(2);
    expect(accountNumber('account 12')).toBe(12);
    expect(accountNumber(autoLabel(7))).toBe(7);
  });

  it('leaves a chosen nickname alone, including ones that only look similar', () => {
    for (const label of [
      'Personal',
      'Main agency',
      'Account',
      'Defaults',
      '#2',
    ])
      expect(accountNumber(label)).toBeNull();
    expect(isAutoLabel('Personal')).toBe(false);
    expect(isAutoLabel('Account 3')).toBe(true);
  });

  it('shows a number or the nickname in a column', () => {
    expect(accountDisplayLabel('Default')).toBe('#1');
    expect(accountDisplayLabel('Account 3')).toBe('#3');
    expect(accountDisplayLabel('Personal')).toBe('Personal');
    expect(accountDisplayLabel(undefined)).toBe('#1');
  });

  it('adds a number to a title only when there are siblings, and a nickname always', () => {
    expect(accountTitle('Namecheap', 'Default', false)).toBe('Namecheap');
    expect(accountTitle('Namecheap', 'Default', true)).toBe('Namecheap #1');
    expect(accountTitle('Namecheap', 'Account 2', true)).toBe('Namecheap #2');
    expect(accountTitle('Namecheap', 'Personal', false)).toBe(
      'Namecheap · Personal',
    );
    expect(accountTitle('Namecheap', 'Personal', true)).toBe(
      'Namecheap · Personal',
    );
    expect(accountSuffix('Account 2', false)).toBe('');
    expect(accountSuffix('Account 2', true)).toBe(' #2');
    expect(accountSuffix('Personal', false)).toBe(' · Personal');
  });
});
