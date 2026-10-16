import {
  salesDetailsSchema,
  type SalesDetails,
} from '../../shared/sales-details';
import { DomainEventType } from '../../shared/domain-events';
import { getEvent, listEvents } from './domain-events';
import { salesDetailsStore } from './sales-details-store';

export function getSalesDetails(): Record<string, SalesDetails> {
  const sales = new Set(
    listEvents()
      .filter((e) => e.type === DomainEventType.Sold)
      .map((e) => e.id),
  );
  return Object.fromEntries(
    Object.entries(salesDetailsStore.all()).filter(([id]) => sales.has(id)),
  );
}

export function setSalesDetails(id: string, input: SalesDetails): void {
  const event = getEvent(id);
  if (!event || event.type !== DomainEventType.Sold)
    throw new Error('Sale no longer exists. Refresh and try again.');
  const value = salesDetailsSchema.parse(input);
  if (event.currency && value.currency !== event.currency)
    throw new Error('Use the sale currency for receipts and costs.');
  if (
    value.payment === 'paid' &&
    (event.amount == null ||
      value.received === null ||
      Number(value.received) !== Number(event.amount))
  ) {
    throw new Error(
      'Fully paid requires receipts equal to the gross sale value.',
    );
  }
  void salesDetailsStore.set(id, value);
}
