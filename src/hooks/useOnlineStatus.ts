import { useCallback, useEffect, useState } from 'react';
import { OFFLINE_QUEUE_CHANGED_EVENT, queueLength as queueLen } from '@/services/offline';
import { flushQueue } from '@/services/api';
import { supabase } from '@/services/supabase';

// Tracks online/offline state and flushes the pending sync queue when
// connectivity returns.
export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pending, setPending] = useState(0);
  const [queueError, setQueueError] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const refreshQueue = async () => {
      const { data } = await supabase.auth.getSession();
      try {
        setPending(data.session ? await queueLen(data.session.user.id) : 0);
        setQueueError(null);
      } catch (cause) {
        setQueueError(cause instanceof Error ? cause.message : 'Offline operational storage is unavailable.');
      }
    };

    const onOnline = () => {
      update();
      void refreshQueue();
    };
    const onOffline = () => {
      update();
      void refreshQueue();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const onQueueChanged = () => { void refreshQueue(); };
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, onQueueChanged);
    void refreshQueue();

    // Queue replay is started by App only after online identity and scope
    // revalidation complete. This prevents stale authorization on reconnect.

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, onQueueChanged);
    };
  }, []);

  const flush = useCallback(async () => {
    const result = await flushQueue();
    const { data } = await supabase.auth.getSession();
    setPending(data.session ? await queueLen(data.session.user.id) : 0);
    setQueueError(null);
    return result;
  }, []);

  return { online, pending, queueError, flush };
}
