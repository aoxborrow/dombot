// How an account is named on screen.
//
// Every account record carries a label. Unless the user has given the account
// a nickname, that label is one DomBot assigned: `Default` for an account
// adopted from before multi-account support, `Main` for a first account added
// by an earlier version, and `Account N` otherwise. Those are not shown as
// written. They stand for a number, so two unnamed Namecheap accounts read
// "Namecheap #1" and "Namecheap #2", with no hierarchy implied. A nickname the
// user chose is always shown as it is.
//
// Storage and MCP keep the raw label; only display goes through here.

const NUMBERED = /^account (\d{1,4})$/i;

/** The number an unnamed account stands for, or null for a chosen nickname. */
export function accountNumber(label: string | undefined): number | null {
  const value = label?.trim() ?? '';
  if (!value || /^(default|main)$/i.test(value)) return 1;
  const match = NUMBERED.exec(value);
  return match ? Number(match[1]) : null;
}

/** True for a label DomBot assigned, i.e. the account has no nickname. */
export function isAutoLabel(label: string | undefined): boolean {
  return accountNumber(label) !== null;
}

/** The stored label for unnamed account number `n`. */
export function autoLabel(n: number): string {
  return `Account ${n}`;
}

/** The label alone, for a column that sits beside the registrar: "#2" or "Personal". */
export function accountDisplayLabel(label: string | undefined): string {
  const n = accountNumber(label);
  // A nickname is shown exactly as stored (it was trimmed when saved).
  return n === null ? label! : `#${n}`;
}

/**
 * Registrar plus account, for titles, filters and lists. A number only appears
 * when the registrar has sibling accounts to tell apart; a nickname always does.
 *
 *   Namecheap · Namecheap #2 · Namecheap · Personal
 */
export function accountTitle(
  registrarName: string,
  label: string | undefined,
  hasSiblings: boolean,
): string {
  const n = accountNumber(label);
  if (n === null) return `${registrarName} · ${label!}`;
  return hasSiblings ? `${registrarName} #${n}` : registrarName;
}

/** Just the part after the registrar name ("#2", "· Personal", or ""). */
export function accountSuffix(
  label: string | undefined,
  hasSiblings: boolean,
): string {
  const n = accountNumber(label);
  if (n === null) return ` · ${label!}`;
  return hasSiblings ? ` #${n}` : '';
}
