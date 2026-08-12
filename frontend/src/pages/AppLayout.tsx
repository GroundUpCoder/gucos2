// Presentation is an os-owned adaptation of c's shell with gucOS-owned Chat,
// Threads, and persistent composer; Clerk identity remains intentionally absent.
// Nav order and geometry mirror c/frontend/src/pages/AppLayout.tsx; os carries no
// wordmark in the header (the Home hero owns product identity).
import { Cpu, FolderOpen, History, Home, MessageSquare, Settings, SquareTerminal } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/ui/button';
import { useKernel, useKernelState } from '../kernel/context';
import { resetKernelStorage, type RecoveryScope } from '../kernel/kernel-recovery';
import { cn } from '../lib/utils';

const navItems = [
  { to: '/', label: 'Home', icon: Home, testId: 'nav-home' },
  { to: '/files/root', label: 'Files', icon: FolderOpen, testId: 'nav-files' },
  { to: '/chat', label: 'Chat', icon: MessageSquare, testId: 'nav-chat' },
  { to: '/term', label: 'Term', icon: SquareTerminal, testId: 'nav-term' },
  { to: '/processes', label: 'PS', icon: Cpu, testId: 'nav-processes' },
  { to: '/threads', label: 'Threads', icon: History, testId: 'nav-threads' },
] as const;

function FatalScreen({ message, recovering, recoveryError, onRepair, onFactoryReset }: {
  message: string;
  recovering: RecoveryScope | null;
  recoveryError: string | null;
  onRepair: () => void;
  onFactoryReset: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto grid place-items-center p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 text-center">
        <p className="text-sm font-medium text-destructive" data-testid="kernel-fatal">Kernel failed: {message}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          Repair reinstalls the regenerable system image and preserves your files.
          Factory reset also removes files, settings, and Chat history.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="outline" disabled={!!recovering} onClick={onRepair} data-testid="repair-system">
            {recovering === 'system' ? 'Repairing…' : 'Repair system image'}
          </Button>
          <Button variant="destructive" disabled={!!recovering} onClick={onFactoryReset} data-testid="factory-reset">
            Factory reset
          </Button>
        </div>
        {recoveryError && <p className="mt-3 text-sm text-destructive" data-testid="recovery-error">{recoveryError}</p>}
      </div>
    </div>
  );
}

export default function AppLayout() {
  const location = useLocation(), state = useKernelState(), kernel = useKernel();
  const [confirmFactory, setConfirmFactory] = useState(false), [recovering, setRecovering] = useState<RecoveryScope | null>(null), [recoveryError, setRecoveryError] = useState<string | null>(null);
  const reset = async (scope: RecoveryScope) => {
    setConfirmFactory(false); setRecoveryError(null); setRecovering(scope);
    try { kernel.prepareStorageReset(); await new Promise(resolve => setTimeout(resolve, 100)); await resetKernelStorage(scope); window.location.reload(); }
    catch (error) { setRecoveryError(error instanceof Error ? error.message : String(error)); setRecovering(null); }
  };
  const failureMessage = state.status === 'ready' ? 'Storage recovery failed' : state.message;
  return (
    <div id="app" className="flex flex-col h-dvh bg-background text-foreground safe-top" data-testid="app-layout">
      <header className="flex items-center justify-between px-3 md:px-4 py-2 border-b border-border shrink-0">
        <nav className="flex items-center gap-1.5 md:gap-2 min-w-0" aria-label="Main navigation">
          {navItems.map(({ to, label, icon: Icon, testId }) => {
            const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith('/' + to.split('/')[1]);
            return (
              <Link
                key={to} to={to} data-testid={testId} title={label}
                className={cn(
                  label === 'Home' ? 'flex items-center justify-center w-8 h-8 rounded-md shrink-0' : 'flex items-center gap-1.5 h-8 px-2 rounded-md text-sm shrink-0',
                  active ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                <Icon className="w-5 h-5" />
                <span className={label === 'Home' ? 'sr-only' : 'hidden sm:inline'}>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center justify-end gap-1 min-w-0">
          {state.status !== 'ready' && (
            <span id="status" className={cn('hidden md:block text-[11px] truncate max-w-48', state.status === 'fatal' || state.status === 'locked' ? 'text-destructive' : 'text-muted-foreground')}>
              {state.message}
            </span>
          )}
          <Link
            to="/settings" data-testid="nav-settings" title="Settings"
            className={cn('flex items-center justify-center w-9 h-9 rounded-md shrink-0', location.pathname === '/settings' ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}
          >
            <Settings className="w-5 h-5" />
          </Link>
        </div>
      </header>
      {state.status === 'locked' ? (
        <div className="flex-1 overflow-y-auto grid place-items-center p-4">
          <div className="w-full max-w-lg rounded-lg border bg-card p-6 text-center">
            <p className="text-sm">{state.message}</p>
            <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>Retry</Button>
          </div>
        </div>
      ) : state.status === 'fatal' || !!recovering || !!recoveryError ? (
        <>
          <FatalScreen
            message={failureMessage} recovering={recovering} recoveryError={recoveryError}
            onRepair={() => void reset('system')} onFactoryReset={() => setConfirmFactory(true)}
          />
          <Dialog
            open={confirmFactory} title="Factory reset gucOS?"
            description="This permanently removes gucOS files, settings, and Chat history stored in this browser. This action cannot be undone."
            confirmLabel="Erase and reset" destructive
            onCancel={() => setConfirmFactory(false)} onConfirm={() => void reset('factory')}
          />
        </>
      ) : (
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden"><Outlet /></main>
      )}
    </div>
  );
}
