/** Compact "time ago" for last-refreshed labels, e.g. "3 hrs ago". Uses
 * abbreviated units so the label stays short. */
export function timeAgo(ms: number): string {
  const secs = Math.round((Date.now() - ms) / 1000);
  if (secs < 60) return 'just now';
  const units: [label: string, secs: number][] = [
    ['day', 86_400],
    ['hr', 3_600],
    ['min', 60],
  ];
  for (const [label, size] of units) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n} ${label}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}
