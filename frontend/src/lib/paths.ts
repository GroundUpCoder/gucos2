export function normalizePath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.some(p => p === '.' || p === '..')) throw new Error(`Invalid path: ${path}`);
  return parts.join('/');
}
export const joinPath = (...parts: string[]) => normalizePath(parts.join('/'));
export const parentPath = (path: string) => normalizePath(path).split('/').slice(0, -1).join('/');
export const validName = (name: string) => !!name && name !== '.' && name !== '..' && !name.includes('/');
export function formatBytes(n: number): string { if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(1)} MB`; }
