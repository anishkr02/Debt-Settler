export function updateAppBadge(count) {
  try {
    const numericCount = Number(count);
    const normalizedCount = Number.isFinite(numericCount) ? Math.max(0, Math.floor(numericCount)) : 0;
    if (normalizedCount > 0 && 'setAppBadge' in navigator) {
      navigator.setAppBadge(normalizedCount).catch(() => {});
    } else if ('clearAppBadge' in navigator) {
      navigator.clearAppBadge().catch(() => {});
    }
  } catch {
    // The Badging API is optional and must not affect app behavior.
  }
}
