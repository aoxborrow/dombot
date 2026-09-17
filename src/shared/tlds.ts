/** Legacy gTLDs whose registries run no premium program — every name renews
 *  at one uniform rate. Used to skip per-name quotes (one sample prices the
 *  whole TLD). Extend as more flat-priced TLDs are confirmed. */
export const UNIFORM_TLDS = ['com', 'net', 'org', 'info', 'biz'] as const;

export function isUniformTld(tld: string): boolean {
  return (UNIFORM_TLDS as readonly string[]).includes(tld.toLowerCase());
}
