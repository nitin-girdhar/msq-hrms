'use client';

import { useEffect, useState } from 'react';

/** True at the `lg` breakpoint and up. False on the server and first paint, so phones never flash the desktop layout. */
export function useWideScreen(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return wide;
}
