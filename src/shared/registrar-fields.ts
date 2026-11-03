// Which registrar credential fields must be filled in, shared by the Settings
// form (asterisks, the Save button) and main (the check before saving), and
// what the Optional ones unlock.

import { Feature } from '@aoxborrow/registrar-client';
import type { RegistrarConfigField, RegistrarName } from './ipc';

/**
 * Extended features an account can use only once every Optional setting is
 * filled in. GoDaddy's URL forwarding and transfers out go through its v2
 * customer API, which needs them.
 */
export const OPTIONAL_SETTINGS_FEATURES: Partial<
  Record<RegistrarName, readonly string[]>
> = {
  godaddy: [
    Feature.GetDomainForwarding,
    Feature.SetDomainForwarding,
    Feature.GetTransferOut,
    Feature.ApproveTransferOut,
    Feature.RejectTransferOut,
  ],
};

type Values = Record<string, string | undefined>;

const filled = (values: Values, name: string) => Boolean(values[name]?.trim());

/**
 * True when `field` must be filled in, given the values entered so far: a
 * required field always, and an Optional-section field once any field in that
 * section has a value, since those settings only work together.
 */
export function isFieldRequired(
  field: RegistrarConfigField,
  fields: readonly RegistrarConfigField[],
  values: Values,
): boolean {
  if (field.required) return true;
  return (
    field.section === 'optional' &&
    fields.some((f) => f.section === 'optional' && filled(values, f.name))
  );
}

/** The first Optional-section field left blank while others in the section
 *  are filled in, or undefined when the section is complete or empty. */
export function missingOptionalField(
  fields: readonly RegistrarConfigField[],
  values: Values,
): RegistrarConfigField | undefined {
  return fields.find(
    (f) =>
      f.section === 'optional' &&
      !filled(values, f.name) &&
      isFieldRequired(f, fields, values),
  );
}
