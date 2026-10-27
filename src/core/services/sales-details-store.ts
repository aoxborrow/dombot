import { Namespace } from '../storage/namespace';
import {
  salesDetailsSchema,
  type SalesDetails,
} from '../../shared/sales-details';

export const SALES_DETAILS_NAMESPACE = 'sale-details';
export const salesDetailsStore = new Namespace<SalesDetails>(
  SALES_DETAILS_NAMESPACE,
);

export function cleanSalesDetails(
  key: string,
  value: unknown,
): SalesDetails | null {
  if (!key || key.length > 80) return null;
  const result = salesDetailsSchema.safeParse(value);
  return result.success ? result.data : null;
}
