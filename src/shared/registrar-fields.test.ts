import { describe, expect, it } from 'vitest';
import type { RegistrarConfigField } from './ipc';
import { isFieldRequired, missingOptionalField } from './registrar-fields';

const field = (
  name: string,
  extra: Partial<RegistrarConfigField> = {},
): RegistrarConfigField => ({
  name,
  label: name,
  type: 'text',
  required: false,
  ...extra,
});
const FIELDS = [
  field('apiToken', { required: true }),
  field('note'),
  field('customerId', { section: 'optional' }),
  field('apiKey', { section: 'optional' }),
  field('apiSecret', { section: 'optional' }),
];
const [token, note, customerId, apiKey] = FIELDS;

describe('isFieldRequired', () => {
  it('requires a required field, and nothing else while the Optional section is empty', () => {
    expect(isFieldRequired(token, FIELDS, {})).toBe(true);
    expect(isFieldRequired(note, FIELDS, { note: 'x' })).toBe(false);
    expect(isFieldRequired(customerId, FIELDS, { apiToken: 'pat' })).toBe(
      false,
    );
  });

  it('requires the whole Optional section once any of it has a value', () => {
    const values = { apiToken: 'pat', apiKey: 'key' };
    expect(isFieldRequired(customerId, FIELDS, values)).toBe(true);
    expect(isFieldRequired(apiKey, FIELDS, values)).toBe(true);
    // A field outside the section stays optional.
    expect(isFieldRequired(note, FIELDS, values)).toBe(false);
  });

  it('ignores whitespace-only values', () => {
    expect(isFieldRequired(customerId, FIELDS, { apiKey: '  ' })).toBe(false);
  });
});

describe('missingOptionalField', () => {
  it('is undefined when the section is empty or complete', () => {
    expect(missingOptionalField(FIELDS, { apiToken: 'pat' })).toBeUndefined();
    expect(
      missingOptionalField(FIELDS, {
        customerId: '123456789',
        apiKey: 'key',
        apiSecret: 'secret',
      }),
    ).toBeUndefined();
  });

  it('names the first blank field of a part-filled section', () => {
    expect(missingOptionalField(FIELDS, { apiSecret: 'secret' })?.name).toBe(
      'customerId',
    );
    expect(
      missingOptionalField(FIELDS, { customerId: '123456789', apiKey: 'key' })
        ?.name,
    ).toBe('apiSecret');
  });
});
