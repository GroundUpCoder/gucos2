// Modal dialog: a bottom sheet on mobile, centered panel from sm up. Built on
// Radix Dialog/AlertDialog — the c/cc shadcn precedent
// (c/frontend/src/components/ui/alert-dialog.tsx) — so an open dialog traps Tab
// and Shift+Tab cyclically, isolates the background, dismisses on Escape and
// backdrop press, and returns focus to the invoking element on close.
// Destructive dialogs are alertdialogs that focus the confirm button; input
// dialogs focus and select the field. Presentation mirrors c's dialog geometry.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import { Button } from './ui/button';

// These dialogs are state-driven — there is no Radix Trigger for the
// primitive to return focus to. document.activeElement at open time is not a
// reliable invoker either: a menu→dialog handoff means it still points inside
// the closing menu (Radix then skips the menu's own focus restore, because
// focus already moved into the dialog). So the last element focused outside
// every overlay is tracked continuously and focus is restored to it on close.
let lastExternalFocus: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('[role="menu"], [role="dialog"], [role="alertdialog"]')) return;
    lastExternalFocus = target;
  });
}

export function Dialog({ open, title, description, initial = '', confirmLabel = 'OK', destructive = false, onCancel, onConfirm }: { open: boolean; title: string; description?: ReactNode; initial?: string; confirmLabel?: string; destructive?: boolean; onCancel(): void; onConfirm(value: string): void }) {
  const [value, setValue] = useState(initial); const input = useRef<HTMLInputElement>(null), confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) setValue(initial); }, [open, initial]);
  const Root = destructive ? AlertDialogPrimitive.Root : DialogPrimitive.Root;
  const Portal = destructive ? AlertDialogPrimitive.Portal : DialogPrimitive.Portal;
  const Overlay = destructive ? AlertDialogPrimitive.Overlay : DialogPrimitive.Overlay;
  const Content = destructive ? AlertDialogPrimitive.Content : DialogPrimitive.Content;
  const Title = destructive ? AlertDialogPrimitive.Title : DialogPrimitive.Title;
  const Description = destructive ? AlertDialogPrimitive.Description : DialogPrimitive.Description;
  return <Root open={open} onOpenChange={o => { if (!o) onCancel(); }}>
    <Portal>
      <Overlay className="fixed inset-0 z-[60] bg-black/50" />
      <div className="fixed inset-0 z-[60] grid place-items-end sm:place-items-center">
        <Content
          data-testid="dialog"
          className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-lg border bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl outline-none"
          onOpenAutoFocus={e => { e.preventDefault(); const target = destructive ? confirm.current : input.current; target?.focus(); if (!destructive) input.current?.select(); }}
          onCloseAutoFocus={e => { e.preventDefault(); if (lastExternalFocus?.isConnected) lastExternalFocus.focus(); }}
          onPointerDownOutside={destructive ? () => onCancel() : undefined}
        >
          <div className="sm:hidden mx-auto mb-3 h-1 w-10 rounded bg-muted-foreground/40" />
          <Title className="font-semibold">{title}</Title>
          {description && <Description className="mt-1 text-sm text-muted-foreground" asChild><div>{description}</div></Description>}
          {!destructive && <input ref={input} value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onConfirm(value.trim()); }} className="mt-4 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" data-testid="dialog-input" />}
          <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button ref={confirm} variant={destructive ? 'destructive' : 'default'} onClick={() => onConfirm(value.trim())}>{confirmLabel}</Button></div>
        </Content>
      </div>
    </Portal>
  </Root>;
}
