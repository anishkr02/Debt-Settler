export function parseServerDate(value) {
  const dateValue = typeof value === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return new Date(dateValue);
}

export function dayKey(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = parseServerDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDayLabel(value, now = new Date()) {
  const key = dayKey(value);
  if (!key) return '';

  const date = parseServerDate(value);
  const nowDate = parseServerDate(now);
  if (Number.isNaN(nowDate.getTime())) return '';

  const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const nowDay = Date.UTC(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const daysAgo = (nowDay - dateDay) / 86400000;

  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo >= 2 && daysAgo <= 6) {
    return date.toLocaleDateString([], { weekday: 'long' });
  }
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = parseServerDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTime(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = parseServerDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
