/**
 * How long a registrar or market API gets to answer one request. Answers
 * grow with the account: a seller with thousands of names and years of sales
 * waits on pages a small portfolio never notices, so this is generous.
 * Neither Afternic, Atom, Sedo nor the registrars publish a limit. Retries
 * multiply it, which the renderer's ceiling on a whole sync allows for.
 */
export const API_TIMEOUT_MS = 90_000;
