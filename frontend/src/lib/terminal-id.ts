export function getTerminalId(): string {
  const key = 'purim_terminal_id';
  const previous = localStorage.getItem(key);
  if (previous) return previous;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(key, id);
  return id;
}
