// Helpers shared by every screen that shows or copies a group join link.

export function buildJoinUrl(token) {
  return `${window.location.origin}/#join=${token}`;
}

// navigator.clipboard only exists on secure pages (https or localhost), so
// fall back to the old textarea trick. Returns true if the text was copied.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the legacy method
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
