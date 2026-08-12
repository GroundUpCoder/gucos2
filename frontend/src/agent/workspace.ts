import { gucFs, FsError } from '../fs/kernel-fs';

export const WORKSPACE = '/root/agent';
export const STATE_ROOT = '/root/.guc/agent';
export const THREADS_ROOT = `${STATE_ROOT}/threads`;
export const PROFILES_ROOT = `${STATE_ROOT}/endpoint-profiles`;

async function mkdir(path: string): Promise<void> {
  try { await gucFs.mkdir(path); }
  catch (error) { if (!(error instanceof FsError) || error.code !== 'EEXIST') throw error; }
}

export async function ensureAgentWorkspace(): Promise<void> {
  for (const path of ['/root/.guc', STATE_ROOT, THREADS_ROOT, PROFILES_ROOT, WORKSPACE]) await mkdir(path);
  for (const path of [WORKSPACE, STATE_ROOT, THREADS_ROOT, PROFILES_ROOT]) {
    const stat = await gucFs.stat(path);
    if (!stat || stat.kind !== 'directory') throw new Error(`Chat storage path is not a directory: ${path}`);
  }
}

export function resolveAgentPath(input: string): string {
  if (!input || input.includes('\0')) throw new Error('path is required');
  const expanded = input === '~' ? '/root' : input.startsWith('~/') ? `/root/${input.slice(2)}` : input;
  const source = expanded.startsWith('/') ? expanded : `${WORKSPACE}/${expanded}`;
  const parts: string[] = [];
  for (const part of source.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

export async function ensureParent(path: string): Promise<void> {
  const parts = resolveAgentPath(path).split('/').slice(1, -1); let current = '';
  for (const part of parts) { current += `/${part}`; await mkdir(current); }
}
