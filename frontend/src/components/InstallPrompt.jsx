import React, { useEffect, useState } from 'react';

const DISMISSED_KEY = 'debt_settle_install_dismissed';

export default function InstallPrompt() {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const [installEvent, setInstallEvent] = useState(null);
  const [visible, setVisible] = useState(() => {
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return false;
    try {
      if (localStorage.getItem(DISMISSED_KEY) === 'true') return false;
    } catch {
      return isIOS;
    }
    return isIOS;
  });

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === 'true';
    } catch {
      dismissed = false;
    }

    if (isStandalone || dismissed || isIOS) return undefined;

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, [isIOS]);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Keep the prompt dismissible when storage is unavailable.
    }
    setVisible(false);
  };

  const install = async () => {
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <section className="content-card mx-1 mb-4 flex items-center justify-between gap-3 bg-cream-50 p-4">
      <div className="min-w-0 text-sm font-semibold text-ink-900">
        {isIOS ? 'Tap the Share button, then Add to Home Screen' : 'Install Debt-Settle on your phone'}
      </div>
      {isIOS ? (
        <button onClick={dismiss} className="min-h-[44px] rounded-xl bg-brand-600 px-4 text-sm font-bold text-white">
          Got it
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={dismiss} className="min-h-[44px] px-2 text-xs font-semibold text-slate-600">
            Not now
          </button>
          <button onClick={install} className="min-h-[44px] rounded-xl bg-brand-600 px-4 text-sm font-bold text-white">
            Install
          </button>
        </div>
      )}
    </section>
  );
}
