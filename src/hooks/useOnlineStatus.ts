import { useEffect, useState } from 'react';
import { queueLength as queueLen } from '@/services/offline';
import { flushQueue } from '@/services/api';

// Tracks online/offline state and flushes the pending sync queue when
// connectivity returns.
export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const refreshQueue = () => setPending(queueLen());

    const onOnline = () => {
      update();
      refreshQueue();
      void flushQueue().then(() => refreshQueue());
    };
    const onOffline = () => {
      update();
      refreshQueue();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    refreshQueue();

    // also try flushing on mount in case queue accumulated while closed
    if (navigator.onLine) {
      void flushQueue().then(() => refreshQueue());
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const flush = async () => {
    const result = await flushQueue();
    setPending(queueLen());
    return result;
  };

  return { online, pending, flush };
}
