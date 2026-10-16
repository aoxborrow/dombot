import { z } from 'zod';
import { toCurrencyCode } from './currencies';
import { parseCanonicalAmount } from './money';

export const salesDetailsSchema = z
  .object({
    currency: z
      .string()
      .refine((s) => toCurrencyCode(s) === s, 'Choose a currency'),
    marketplace: z.string().trim().max(100),
    payment: z.enum(['unconfirmed', 'paid', 'installments']),
    received: z.string().max(40).nullable(),
    fees: z.string().max(40).nullable(),
    renewalCost: z.string().max(40).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ['received', 'fees', 'renewalCost'] as const) {
      if (value[key] === null) continue;
      try {
        const parsed = parseCanonicalAmount(value[key], value.currency);
        if (
          parsed !== null &&
          (!Number.isFinite(Number(parsed)) || Number(parsed) > 1e12)
        )
          throw new Error('Amount is too large');
        if (parsed === null) throw new Error('Enter an amount or leave blank');
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: err instanceof Error ? err.message : 'Invalid amount',
        });
      }
    }
  });

/** Financial facts for one sale event. Null means unknown, not zero. */
export type SalesDetails = z.infer<typeof salesDetailsSchema>;
