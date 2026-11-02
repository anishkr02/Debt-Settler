import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export default function OfflineBanner() {
  const [connection, setConnection] = useState(() => (
    navigator.onLine ? 'online' : 'offline'
  ));
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handleOffline = () => {
      setConnection('offline');
      setDismissed(false);
    };
    const handleOnline = () => {
      setConnection((current) => (current === 'offline' ? 'reconnected' : 'online'));
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (connection === 'online' || dismissed) return null;

  const isOffline = connection === 'offline';

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-40 border-b border-amber-300 bg-amber-100 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-amber-950 shadow-sm"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 text-xs font-semibold">
        <span>
          {isOffline
            ? "You're offline. Showing what is already on your phone. Data loads when you're back online."
            : 'Back online'}
        </span>
        {isOffline ? (
          <span className="shrink-0 text-[10px] font-bold uppercase">Offline</span>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-amber-800 px-3 py-1.5 text-white hover:bg-amber-900"
            >
              Refresh
            </button>
            <button
              type="button"
              aria-label="Dismiss online notification"
              onClick={() => setDismissed(true)}
              className="rounded-lg p-1.5 text-amber-900 hover:bg-amber-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
