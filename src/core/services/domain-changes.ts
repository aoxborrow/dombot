import { assertDomainName } from '../../shared/domain-name';
import {
  DomainEventType,
  localDay,
  type DomainEvent,
  type DomainEventSource,
} from '../../shared/domain-events';
import type { SettingChange } from '../../shared/domain-changes';
import { newEvent } from './domain-events';

// `changed` events (docs/storage-model.md, "Settings changes"): one per
// setting a write changed, whoever asked. applyDomainOp writes them for the
// app, bulk jobs, and MCP; the MCP-only DNS and contact writes and edits to
// imported names write their own.

/** A `changed` event (not yet saved), dated today. */
export function changeEvent(
  domainName: string,
  change: SettingChange,
  source: DomainEventSource,
  extra: Pick<DomainEvent, 'accountId' | 'importId'> = {},
  now: number = Date.now(),
): DomainEvent {
  return newEvent(
    {
      domain: assertDomainName(domainName),
      type: DomainEventType.Changed,
      source,
      date: localDay(now),
      ...extra,
      ...change,
    },
    now,
  );
}
