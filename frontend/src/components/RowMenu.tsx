// Shared row overflow menu (⋯) — the os progressive-disclosure pattern for
// secondary row actions, in the c ghost-icon idiom. Built on Radix
// DropdownMenu — the c/cc shadcn precedent
// (c/frontend/src/components/ui/dropdown-menu.tsx) — so the menu owns real
// menuitem roles, focus moves into the menu on open, ArrowUp/ArrowDown and
// Home/End navigate, Escape and outside press dismiss, and focus returns to
// the trigger on close (including after a selection).
import { MoreVertical } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

export type RowMenuItem = {
  icon: ReactNode;
  label: string;
  ariaLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export function RowMenu({ triggerLabel, triggerTestId, items, disabled }: {
  triggerLabel: string;
  triggerTestId?: string;
  items: RowMenuItem[];
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost" size="icon-sm"
          title={triggerLabel} aria-label={triggerLabel}
          disabled={disabled} data-testid={triggerTestId}
        >
          <MoreVertical />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-20 min-w-36 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {items.map(item => (
            <DropdownMenu.Item
              key={item.label} aria-label={item.ariaLabel} disabled={item.disabled}
              className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40', item.destructive && 'text-destructive')}
              onSelect={() => item.onSelect()}
            >
              {item.icon}{item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
