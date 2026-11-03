import { useEffect, useState } from 'react';

/** Phone width: below Tailwind's `sm` (640px). */
export function useNarrowScreen(): boolean {
  const query = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}
