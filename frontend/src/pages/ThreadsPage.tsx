// Thread management follows c/frontend/src/pages/ThreadsPage.tsx: an h1 header
// with an outline New action, a search row, and a single divided card list with
// hover rows. Secondary row actions (rename, pin, archive, fork) collapse into a
// per-row overflow menu; Delete stays visible as the row's destructive action.
import { useCallback, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Copy, MessageSquarePlus, Pencil, Pin, PinOff, Search, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { deleteThread, forkThread, searchThreads, updateThread, type ThreadSummary } from '../agent/repository';
import { useAgentSession } from '../agent/session';
import { useKernelState } from '../kernel/context';
import { Dialog } from '../components/Dialog';
import { RowMenu } from '../components/RowMenu';
import { Button } from '../components/ui/button';

export default function ThreadsPage() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]), [error, setError] = useState(''), [query, setQuery] = useState(''), [showArchived, setShowArchived] = useState(false), [confirmDelete, setConfirmDelete] = useState<string | null>(null), [renaming, setRenaming] = useState<string | null>(null), [title, setTitle] = useState('');
  const session = useAgentSession(), nav = useNavigate(), kernel = useKernelState(), busy = session.streaming;
  const refresh = useCallback((q = '') => searchThreads(q).then(v => { setThreads(v); setError('') }).catch(e => setError(String(e))), []);
  useEffect(() => { if (kernel.status !== 'ready') return; const timer = setTimeout(() => void refresh(query), 200); return () => clearTimeout(timer) }, [kernel.status, query, refresh]);
  const mutate = async (t: ThreadSummary, patch: { title?: string; archived?: boolean; pinned?: boolean }) => { if (busy) return; try { await updateThread(t, patch); setRenaming(null); await refresh(query) } catch (e) { setError(String(e)) } };
  const visible = threads.filter(t => showArchived || !t.archived), deleting = threads.find(t => t.id === confirmDelete) ?? null;
  return <div className="flex-1 overflow-y-auto" data-testid="threads-page"><div className="mx-auto max-w-2xl">
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <h1 className="flex-1 text-lg font-semibold">Threads</h1>
      <Button variant="outline" size="sm" data-testid="threads-new" disabled={busy} onClick={() => { nav('/chat'); session.newThread() }}><MessageSquarePlus />New</Button>
    </div>
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <label className="relative block min-w-0 flex-1"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><span className="sr-only">Search threads</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search titles and messages" className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-8 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" data-testid="thread-search" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-2 rounded p-1 hover:bg-accent"><X className="size-4" /></button>}</label>
        <label className="flex shrink-0 items-center gap-1.5 text-sm"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Archived</label>
      </div>
      {busy && <p role="status" className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">A turn is running. Thread open, rename, archive, pin, fork, and delete controls are disabled until it stops.</p>}
      {kernel.status !== 'ready' && <p className="text-sm text-muted-foreground">Loading gucOS…</p>}
      {error && <p role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {kernel.status === 'ready' && visible.length > 0 && <div className="overflow-hidden rounded-lg border bg-card divide-y divide-border/60">
        {visible.map(t => <article key={t.id} className={`flex items-center gap-2 px-3 py-2 hover:bg-accent/50 ${t.archived ? 'opacity-65' : ''}`} data-testid="thread-row">
          {renaming === t.id ? <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={e => { e.preventDefault(); void mutate(t, { title: title.trim() || t.title }) }}>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} aria-label="Thread title" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
            <Button size="sm" variant="outline">Save</Button><Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
          </form> : <>
            <button disabled={busy} data-testid="thread-open" className="min-w-0 flex-1 text-left disabled:opacity-40" onClick={() => void session.openThread(t).then(() => nav(`/chat/${t.id}`)).catch(e => setError(String(e)))}>
              <div className="flex items-center gap-1 truncate text-sm font-medium">{t.pinned && <Pin className="size-3 shrink-0 fill-current" />}{t.title}</div>
              <div className="text-xs text-muted-foreground">{t.model} · {new Date(t.updatedAt).toLocaleString()}</div>
              {t.corrupt && <div className="text-xs text-destructive">{t.corrupt}</div>}
            </button>
            <RowMenu disabled={busy} triggerLabel={`More actions for ${t.title}`} items={[
              { icon: <Pencil className="size-4" />, label: 'Rename', ariaLabel: `Rename ${t.title}`, onSelect: () => { setRenaming(t.id); setTitle(t.title) } },
              t.pinned
                ? { icon: <PinOff className="size-4" />, label: 'Unpin', ariaLabel: `Unpin ${t.title}`, onSelect: () => void mutate(t, { pinned: false }) }
                : { icon: <Pin className="size-4" />, label: 'Pin', ariaLabel: `Pin ${t.title}`, onSelect: () => void mutate(t, { pinned: true }) },
              t.archived
                ? { icon: <ArchiveRestore className="size-4" />, label: 'Restore', ariaLabel: `Restore ${t.title}`, onSelect: () => void mutate(t, { archived: false }) }
                : { icon: <Archive className="size-4" />, label: 'Archive', ariaLabel: `Archive ${t.title}`, onSelect: () => void mutate(t, { archived: true }) },
              { icon: <Copy className="size-4" />, label: 'Fork', ariaLabel: `Fork ${t.title}`, onSelect: () => { void forkThread(t).then(async fork => { await refresh(query); await session.openThread(fork); nav(`/chat/${fork.id}`) }).catch(e => setError(String(e))) } },
            ]} />
            <Button variant="ghost" size="icon-sm" className="text-destructive" disabled={busy} onClick={() => setConfirmDelete(t.id)} aria-label={`Delete ${t.title}`} title={`Delete ${t.title}`}><Trash2 /></Button>
          </>}
        </article>)}
      </div>}
      {kernel.status === 'ready' && !visible.length && !error && <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">{query ? 'No matching threads.' : 'No threads yet.'}</div>}
    </div>
  </div><Dialog open={deleting !== null} title={`Delete ${deleting?.title ?? 'thread'}?`} description="Permanently delete this local JSONL thread? This cannot be undone." confirmLabel="Delete" destructive onCancel={() => setConfirmDelete(null)} onConfirm={() => { if (!deleting) return; void deleteThread(deleting).then(() => { setConfirmDelete(null); return refresh(query) }).catch(e => setError(String(e))) }} /></div>
}
