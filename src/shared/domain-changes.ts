import {
  DomainSetting,
  type DomainEvent,
  type SettingValue,
} from './domain-events';
import { expandTemplate } from './domain-ops';
import type { DomainOp, EmailForward, UrlForwardInput } from './ipc';

// Settings changes in the event log (docs/storage-model.md, "Settings
// changes"): what a write changed, worked out from the op and what DomBot
// knew of the name before it, and how Activity says it. Pure: main builds the
// events, the renderer describes them.

/** A setting change, before it's an event. */
export interface SettingChange {
  setting: DomainSetting;
  /** Absent when DomBot didn't know the value. */
  before?: SettingValue;
  after: SettingValue;
}

/** What DomBot knew of a name's settings before a write; absent is unknown. */
export interface KnownSettings {
  autoRenew?: boolean;
  privacy?: boolean;
  lock?: boolean;
  nameservers?: string[];
}

export const SETTING_LABEL: Record<DomainSetting, string> = {
  autoRenew: 'Auto-renew',
  privacy: 'Privacy',
  lock: 'Lock',
  nameservers: 'Nameservers',
  urlForwarding: 'URL forwarding',
  emailForwarding: 'Email forwarding',
  dns: 'DNS',
  contacts: 'Contacts',
};

/** The order the Activity filter lists them: the table's columns, then the rest. */
export const SETTING_ORDER: DomainSetting[] = [
  DomainSetting.AutoRenew,
  DomainSetting.Privacy,
  DomainSetting.Lock,
  DomainSetting.Nameservers,
  DomainSetting.UrlForwarding,
  DomainSetting.EmailForwarding,
  DomainSetting.Dns,
  DomainSetting.Contacts,
];

/** Nameservers as compared and stored: trimmed, lowercase, no root dot. */
function nameserver(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

function sameValue(a: SettingValue, b: SettingValue): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  // Lists compare as sets: a registrar may hand nameservers back reordered.
  const set = (list: string[]) => [...new Set(list)].sort().join('\n');
  return set(a) === set(b);
}

/** A change, or null when DomBot knew the value and it's the same. */
function changeOf(
  setting: DomainSetting,
  before: SettingValue | undefined,
  after: SettingValue,
): SettingChange | null {
  if (before !== undefined && sameValue(before, after)) return null;
  return before === undefined ? { setting, after } : { setting, before, after };
}

/** "@ → https://example.com (permanent)", for the event log. */
export function urlForwardLine(f: UrlForwardInput): string {
  return `${f.host} → ${f.url} (${f.type})`;
}

/** "info → you@example.com", for the event log. */
export function emailForwardLine(f: EmailForward): string {
  return `${f.alias} → ${f.forwardTo}`;
}

/**
 * The setting an op changes on `domainName`, given what DomBot knew before;
 * null for an op that changes no setting (a renewal writes `renewed`, an auth
 * code is a read) or one that left a known value as it was. Forwarding is a
 * full replace whose old rules DomBot doesn't keep, so it never has a
 * `before`.
 */
export function opChange(
  op: DomainOp,
  domainName: string,
  known: KnownSettings,
): SettingChange | null {
  switch (op.kind) {
    case 'autoRenew':
      return changeOf(DomainSetting.AutoRenew, known.autoRenew, op.enabled);
    case 'privacy':
      return changeOf(DomainSetting.Privacy, known.privacy, op.enabled);
    case 'lock':
      return changeOf(DomainSetting.Lock, known.lock, op.locked);
    case 'nameservers':
      return changeOf(
        DomainSetting.Nameservers,
        known.nameservers?.map(nameserver),
        op.nameservers.map(nameserver),
      );
    case 'urlForwarding':
      return changeOf(
        DomainSetting.UrlForwarding,
        undefined,
        op.forwards.map((f) =>
          urlForwardLine({ ...f, url: expandTemplate(f.url, domainName) }),
        ),
      );
    case 'emailForwarding':
      return changeOf(
        DomainSetting.EmailForwarding,
        undefined,
        op.forwards.map((f) =>
          emailForwardLine({
            ...f,
            forwardTo: expandTemplate(f.forwardTo, domainName),
          }),
        ),
      );
    case 'authCode':
    case 'renew':
      return null;
  }
}

/** The change an imported name's edit makes to its auto-renew, if any. */
export function importedAutoRenewChange(
  before: boolean | null | undefined,
  after: boolean | null | undefined,
): SettingChange | null {
  // Cleared to "not set" isn't a setting you changed.
  if (after === null || after === undefined) return null;
  return changeOf(DomainSetting.AutoRenew, before ?? undefined, after);
}

function valueText(setting: DomainSetting, value: SettingValue): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (value.length === 0) return 'none';
  // A zone can run to dozens of records: say how many.
  if (setting === DomainSetting.Dns)
    return `${value.length} record${value.length === 1 ? '' : 's'}`;
  return value.join(', ');
}

/**
 * What a `changed` event says in Activity: "Auto-renew: on → off", or just
 * the new value when DomBot didn't know the old one. Null for any other event.
 */
export function changeText(
  e: Pick<DomainEvent, 'setting' | 'before' | 'after'>,
): string | null {
  if (!e.setting || e.after === undefined) return null;
  const after = valueText(e.setting, e.after);
  const text =
    e.before === undefined
      ? after
      : `${valueText(e.setting, e.before)} → ${after}`;
  return `${SETTING_LABEL[e.setting]}: ${text}`;
}

/** "A @ 203.0.113.7", "MX @ mail.example.com (10)": one DNS record for the log. */
export function dnsRecordLine(r: {
  type: string;
  name: string;
  value: string;
  priority?: number;
}): string {
  const priority = r.priority !== undefined ? ` (${r.priority})` : '';
  return `${r.type} ${r.name} ${r.value}${priority}`;
}
