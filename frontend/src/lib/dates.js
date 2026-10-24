export function parseServerDate(value) {
  const dateValue = typeof value === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return new Date(dateValue);
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
