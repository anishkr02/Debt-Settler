import React, { useState } from 'react';
import { APP_NAME, APK_URL } from '../lib/brand';

const DISMISSED_KEY = 'uddhar_apk_hint_dismissed';

export default function AndroidAppLink() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [expanded, setExpanded] = useState(false);

  const isAndroid = /Android/i.test(navigator.userAgent) && !/iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isAndroid || dismissed) return null;

  const isInstalled = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || navigator.standalone
    || document.referrer.startsWith('android-app://');

  if (isInstalled) return null;

  const hide = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Keep the link dismissible when storage is unavailable.
    }
    setDismissed(true);
  };

  return (
    <section className="content-card mx-1 mb-4 flex flex-wrap items-center justify-between gap-2 bg-cream-50 p-3 text-xs text-slate-700 sm:text-sm">
      <p className="font-semibold text-ink-900">Install not working? Get the Android app (beta)</p>
      <div className="flex items-center gap-2">
        <a
          href={APK_URL}
          rel="noopener"
          className="inline-flex min-h-[44px] items-center rounded-xl bg-brand-600 px-3 text-xs font-bold text-white"
        >
          Download APK
        </a>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="android-app-expectations"
          onClick={() => setExpanded((value) => !value)}
          className="min-h-[44px] px-1 text-xs font-semibold text-slate-600 underline"
        >
          What to expect
        </button>
        <button
          type="button"
          onClick={hide}
          aria-label="Hide Android app download link"
          className="min-h-[44px] px-1 text-xs font-semibold text-slate-500"
        >
          Hide
        </button>
      </div>
      {expanded && (
        <p id="android-app-expectations" className="w-full text-xs leading-relaxed text-slate-600">
          This file is not from the Play Store, so Android may ask you to (1) tap Keep when Chrome warns about the download, (2) allow Chrome to install unknown apps, and (3) tap Install anyway if Play Protect asks. The app only opens {APP_NAME}.
        </p>
      )}
    </section>
  );
}
