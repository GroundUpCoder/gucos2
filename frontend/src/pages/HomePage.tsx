import { MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useKernelState } from '../kernel/context';

export default function HomePage() {
  const state = useKernelState();
  return (
    <div className="flex-1 overflow-y-auto" data-testid="home-page">
      <div className="max-w-2xl mx-auto p-4 md:py-8 space-y-4">
        <section className="rounded-lg border bg-card text-card-foreground p-6">
          <h1 className="text-lg font-semibold">gucOS</h1>
          <p className="text-sm text-muted-foreground mt-2">
            A real POSIX kernel, persistent filesystem, C compiler, networking, and packages in your browser.
          </p>
          <p className="text-xs text-muted-foreground mt-3" data-testid="ui-build">ui build {__BUILD_NUMBER__}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {state.status === 'ready' ? `image ${state.imageVersion ?? 'unknown'} · ${state.mode}` : state.message}
          </p>
        </section>
        <Link to="/chat" className="flex items-center gap-3 rounded-lg border bg-card text-card-foreground p-6 hover:bg-accent/50 transition-colors">
          <MessageSquare className="w-6 h-6 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="font-semibold">Chat</h2>
            <p className="text-sm text-muted-foreground">Talk to the gucOS agent — tools, threads, and durable local history.</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
