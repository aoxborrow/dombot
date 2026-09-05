import type { ForwardValidation } from '../../lib/forwarding-input';

/** Errors in red, warnings in amber; renders nothing when both are empty. */
export function ValidationList({
  validation,
}: {
  validation: ForwardValidation;
}) {
  if (validation.errors.length === 0 && validation.warnings.length === 0)
    return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {validation.errors.map((m) => (
        <li key={m} className="text-destructive">
          {m}
        </li>
      ))}
      {validation.warnings.map((m) => (
        <li key={m} className="text-amber-600 dark:text-amber-400">
          {m}
        </li>
      ))}
    </ul>
  );
}
