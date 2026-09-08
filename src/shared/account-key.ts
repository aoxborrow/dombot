/** Legacy default IDs equal registrar IDs, preserving existing annotations. */
export function domainKey(d: {
  registrar: string;
  domainName: string;
  accountId?: string;
}): string {
  return `${d.accountId ?? d.registrar}:${d.domainName}`;
}
